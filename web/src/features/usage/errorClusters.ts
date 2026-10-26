import type { ErrorEvent } from "./errorStats";

/**
 * 「错误聚类」的纯逻辑（Round CC F7）。
 *
 * 错误事件列表按时间倒序回答「刚才炸了什么」；聚类回答「我到底在跟几个问题
 * 打架」——同一个工具、同一条报错反复出现时，列表里是 40 行，聚类里是 1 行。
 * 所以这里的分组键只有两个维度：工具 + 归一化首行。
 *
 * 归一化只做两件保守的事：取首行、trim、截 80 字符。**不做**路径/数字/ID
 * 的模板化替换——那会把「ENOENT: /a/b/c」与「ENOENT: /x/y」合并成一个，也能
 * 把两条真正不同的失败合并成一个。宁可聚类偏细，也不能让两条不同的错误
 * 冒充同一个问题：合并错了，用户按下「这个我修过了」就再也不会看它。
 */

/** 界面一屏能扫的行数；超出部分不折尾——错误聚类不是分布图。 */
export const CLUSTER_LIMIT = 8;

/** 归一化首行的上限（字符，按码点算，不劈开代理对）。 */
export const FIRST_LINE_MAX_CHARS = 80;

/** API 错误没有工具名：给它们一个固定标签，好让「工具」这一列不留空。 */
export const API_CLUSTER_LABEL = "API";

/** 工具错误却缺 `toolName`（编排层写坏的行）：单独一档，不冒充 API。 */
export const UNKNOWN_TOOL_LABEL = "未知工具";

/** 错误消息为空时的占位——空串在表格里像渲染失败。 */
export const EMPTY_FIRST_LINE_LABEL = "（无摘要）";

export type ErrorCluster = {
  /** 分组键：`toolName` + 归一化首行，界面拿它做 React key。 */
  key: string;
  /** 展示用工具名（API 错误为 `API`）。 */
  toolName: string;
  /** 归一化后的错误首行（≤ 80 字符）。 */
  firstLine: string;
  count: number;
  firstAt: number;
  lastAt: number;
  /** 样本事件：跳回会话定位用。整簇都没有 `recordId` 时为 `null`。 */
  sampleRecordId: string | null;
  sampleSessionPath: string;
};

/**
 * 归一化：首行 + trim + 截断。
 *
 * 截断走 `Array.from`，因为按 UTF-16 长度切会把 emoji / 生僻字劈成半个代理对，
 * 屏幕上变成 ``。80 个码点足够识别一条报错（实测报错的首行多在 30–60）。
 */
export function normalizeFirstLine(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  const trimmed = firstLine.trim();
  if (trimmed === "") return EMPTY_FIRST_LINE_LABEL;
  return Array.from(trimmed).slice(0, FIRST_LINE_MAX_CHARS).join("");
}

function toolNameOf(event: ErrorEvent): string {
  if (event.kind === "api") return API_CLUSTER_LABEL;
  return event.toolName ?? UNKNOWN_TOOL_LABEL;
}

/** 内部状态：`sampleAt` 是「当前样本的原始顺序位」，取最小者。 */
type MutableCluster = ErrorCluster & { sampleAt: number };

/**
 * 按「工具 + 归一化首行」聚类，按次数降序、并列按首次出现升序。
 *
 * @param events `stats.events`（时间倒序），顺序不影响结果，只在并列时用来
 *   保持稳定——最后一级 tiebreak 是 key，保证同样输入永远同样输出。
 * @param limit 最多返回几簇（默认 8）。
 */
export function buildErrorClusters(
  events: readonly ErrorEvent[],
  limit: number = CLUSTER_LIMIT
): ErrorCluster[] {
  if (limit <= 0) return [];

  const clusters = new Map<string, MutableCluster>();

  for (const event of events) {
    if (!Number.isFinite(event.timestamp)) continue;

    const toolName = toolNameOf(event);
    const firstLine = normalizeFirstLine(event.preview);
    const key = `${toolName}\u0000${firstLine}`;

    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = {
        key,
        toolName,
        firstLine,
        count: 0,
        firstAt: event.timestamp,
        lastAt: event.timestamp,
        sampleRecordId: null,
        sampleSessionPath: event.path,
        sampleAt: Number.POSITIVE_INFINITY
      };
      clusters.set(key, cluster);
    }

    cluster.count += 1;
    if (event.timestamp < cluster.firstAt) cluster.firstAt = event.timestamp;
    if (event.timestamp > cluster.lastAt) cluster.lastAt = event.timestamp;

    // 样本取**最早**一条带 recordId 的事件：点进去看到的是这个问题第一次
    // 发生的地方，而不是它烧到第 40 次时的现场（`recordId` 为 null 的
    // sidechain 行不能当跳转目标）。
    if (event.recordId !== null && event.timestamp < cluster.sampleAt) {
      cluster.sampleRecordId = event.recordId;
      cluster.sampleSessionPath = event.path;
      cluster.sampleAt = event.timestamp;
    }
  }

  return Array.from(clusters.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.firstAt !== b.firstAt) return a.firstAt - b.firstAt;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    })
    .slice(0, limit)
    .map(({ key, toolName, firstLine, count, firstAt, lastAt, sampleRecordId, sampleSessionPath }) => ({
      key,
      toolName,
      firstLine,
      count,
      firstAt,
      lastAt,
      sampleRecordId,
      sampleSessionPath
    }));
}
