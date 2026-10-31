import { API_CLUSTER_LABEL, EMPTY_FIRST_LINE_LABEL, UNKNOWN_TOOL_LABEL } from "../usage/errorClusters";
import type { ErrorEvent } from "../usage/errorStats";

/**
 * 错误档案的聚类逻辑（Round GG G5）。
 *
 * 与「错误聚类」（errorClusters.ts，Round CC F7）的分工：
 *
 * - F7 是**现场视图**：按工具 + 原文首行分组，主张「宁可聚类偏细，也不能把
 *   两条不同的失败合并成同一个问题」，所以只截断、不做模板化；
 * - G5 是**档案视图**：跨会话回答「这周我到底在跟几个问题打架」，用户会拿它
 *   逐条销账，所以这里把同一条模板错误（`ENOENT: /a/b` 与 `ENOENT: /x/y`、
 *   `timeout after 30000ms` 与 `timeout after 45000ms`）归到一类，并给出
 *   首末时间、涉及会话数与一条代表性消息。
 *
 * 两套口径都**只消费 `ErrorEvent`**（errorStats.extractErrorEvents 的产物），
 * 不各自去解析原始 JSONL——错误判定（哪个字段算错误、哪些行是 sidechain）
 * 只能有一处，否则两条视图会对同一份日志给出不同的错误数。
 */

/** 签名上限：60 个码点。够看清模板，又不至于把整段堆栈拖进表格。 */
export const SIGNATURE_MAX_CHARS = 60;

/** 代表性消息上限：200 个码点。 */
export const SAMPLE_MAX_CHARS = 200;

export type ErrorArchiveGroup = {
  /** 归一化后的错误模板；同一 (工具, 签名) 的 key 也用它。 */
  signature: string;
  /** 展示用工具名（API 错误为 `API`，缺 toolName 的工具错误为「未知工具」）。 */
  tool: string;
  count: number;
  firstAt: number;
  lastAt: number;
  /** 涉及会话路径，去重；按首次出现时间排序，保证同样输入同样输出。 */
  sessionIds: string[];
  /** 该类最早一条的原始消息（≤200 码点）。 */
  sample: string;
};

function codePoints(text: string): string[] {
  return Array.from(text);
}

function truncateCodePoints(text: string, limit: number): string {
  const chars = codePoints(text);
  return chars.length <= limit ? text : chars.slice(0, limit).join("");
}

/**
 * 把一条错误消息折成「模板签名」。
 *
 * 归一化规则（顺序固定，测试逐条盯着）：
 *
 * 1. 去终端转义序列（`\u001b[31m` 一类）——颜色码不是错误内容；
 * 2. 只取首行、trim——堆栈的后续行对「是哪类问题」没有增量信息；
 * 3. 引号内容 → `<…>`（报错里最常变的部分引号、命令与文件片段）；
 * 4. 路径 → `<path>`（Unix 两段以上 `/x/y` 与 Windows `C:\x\y`）；
 * 5. 独立数字 → `<n>`（超时毫秒、行号、HTTP 码、端口）；
 * 6. 连续空白折叠为一个空格；
 * 7. 截 60 个码点（按码点切，不劈代理对）；空串落到「（无摘要）」。
 *
 * 保守边界：只替换**整段**路径与**独立**数字，不做子串替换——`gpt-5` 里的
 * `5` 不是独立数字，不会被折成 `gpt-<n>`。
 */
export function errorSignature(text: string): string {
  const stripped = text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  const firstLine = (stripped.split("\n")[0] ?? "").trim();
  if (firstLine === "") return EMPTY_FIRST_LINE_LABEL;

  let normalized = firstLine;
  normalized = normalized.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, "<…>");
  normalized = normalized.replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]+/g, "<path>");
  normalized = normalized.replace(/(?:\/[\w.@+-]+){2,}\/?/g, "<path>");
  normalized = normalized.replace(/(^|[^A-Za-z0-9_.-])(\d+(?:\.\d+)?)/g, "$1<n>");
  normalized = normalized.replace(/\s+/g, " ").trim();

  return truncateCodePoints(normalized, SIGNATURE_MAX_CHARS);
}

function toolLabelOf(event: ErrorEvent): string {
  if (event.kind === "api") return API_CLUSTER_LABEL;
  return event.toolName ?? UNKNOWN_TOOL_LABEL;
}

type MutableGroup = ErrorArchiveGroup & { firstSeenAt: number; firstSeenOrder: number };

/**
 * 按 (工具, 模板签名) 聚类。
 *
 * 排序：次数降序；并列按签名升序，再并列按工具名升序——最后一级让输出与
 * 输入顺序无关，同样的错误集合永远得到同样的表格。
 */
export function buildErrorArchive(events: readonly ErrorEvent[]): ErrorArchiveGroup[] {
  const groups = new Map<string, MutableGroup>();

  events.forEach((event, order) => {
    if (!Number.isFinite(event.timestamp)) return;

    const tool = toolLabelOf(event);
    const signature = errorSignature(event.preview);
    const key = `${tool}\u0000${signature}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        signature,
        tool,
        count: 0,
        firstAt: event.timestamp,
        lastAt: event.timestamp,
        sessionIds: [],
        sample: truncateCodePoints(event.preview, SAMPLE_MAX_CHARS),
        firstSeenAt: event.timestamp,
        firstSeenOrder: order
      };
      groups.set(key, group);
    }

    group.count += 1;
    if (event.timestamp < group.firstAt) group.firstAt = event.timestamp;
    if (event.timestamp > group.lastAt) group.lastAt = event.timestamp;
    if (!group.sessionIds.includes(event.path)) group.sessionIds.push(event.path);

    // 代表性消息取**最早**一条：看见的是问题第一次发生时的现场。时间相同
    // 时按输入顺序，保证稳定。
    if (
      event.timestamp < group.firstSeenAt ||
      (event.timestamp === group.firstSeenAt && order < group.firstSeenOrder)
    ) {
      group.sample = truncateCodePoints(event.preview, SAMPLE_MAX_CHARS);
      group.firstSeenAt = event.timestamp;
      group.firstSeenOrder = order;
    }
  });

  return Array.from(groups.values())
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const bySignature = a.signature.localeCompare(b.signature);
      if (bySignature !== 0) return bySignature;
      return a.tool.localeCompare(b.tool);
    })
    .map(({ signature, tool, count, firstAt, lastAt, sessionIds, sample }) => ({
      signature,
      tool,
      count,
      firstAt,
      lastAt,
      sessionIds,
      sample
    }));
}
