import { formatDateTime, formatDuration, formatTokenCount } from "../../lib/format";
import { contextSeriesOf } from "./contextSeries";
import { buildLogRows } from "./logRows";
import type { LogRow } from "./logRows";
import type { ParsedSession, SessionRecord } from "./types";

/**
 * 单会话「档案」的 Markdown 生成（Round GG G3）。
 *
 * 档案是给人看的一页纸：元信息、统计、工具清单、时间线摘要。它与 HTML 报告
 * （exportHtml.ts）是两种版次——报告要能独立打开、带样式与图表；档案只求
 * **可粘贴、可归档、可 diff**，所以只出纯 Markdown，不嵌样式、不引外部链接。
 *
 * ## 隐私红线（Issue #284）
 *
 * 档案会被用户贴进 Issue、发给同事、传上聊天工具，所以它**只承载聚合数字与
 * 结构性事实**：
 *
 * - 消息原文不进档案（连首行摘要也不进）——时间线只写「类型 + 动作」；
 * - 文件绝对路径、cwd 全路径不进档案——项目名只取路径最后一段（`/repo/alpha`
 *   → `alpha`），拿不到 cwd 时写「（未知项目）」而不是从会话文件路径反推，
 *   因为那同样是一条绝对路径；
 * - 工具清单只有工具名与调用次数，没有参数、没有命令内容；
 * - 错误只计数，不摘录报错文本（报错里常有路径与凭据片段）。
 *
 * 这条红线由测试逐条盯着：测试数据里埋了路径与消息原文，断言它们在成品里
 * 一次都不出现。
 */

/** 时间线摘要最多几行——再多就不叫「摘要」，而是把日志表搬进了档案。 */
export const ARCHIVE_TIMELINE_LIMIT = 10;

/** 超限时省略号本身占一行，首尾的分配见 {@link timelineLines}。 */
const TIMELINE_HEAD = 4;

/** 项目名取 cwd 的最后一段；空串、根目录与缺失一律落到占位词。 */
export function projectNameOfCwd(cwd: string | undefined): string {
  if (!cwd) return "（未知项目）";
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const segment = trimmed.split(/[\\/]/).pop() ?? "";
  return segment === "" ? "（未知项目）" : segment;
}

/**
 * 档案文件名。`id` 来自会话文件，理论上可能是任意字符串；路径分隔符与
 * 空格会让保存对话框把文件名解释成子目录或截断，所以统一折成 `-`。
 */
export function archiveFileName(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `cca-session-${safe || "unknown"}.md`;
}

function sumUsage(records: readonly SessionRecord[]) {
  let input = 0;
  let output = 0;
  let cacheWrite = 0;
  let cacheRead = 0;
  for (const record of records) {
    const usage = record.usage;
    if (!usage) continue;
    input += usage.inputTokens ?? 0;
    output += usage.outputTokens ?? 0;
    cacheWrite += usage.cacheCreationTokens ?? 0;
    cacheRead += usage.cacheReadTokens ?? 0;
  }
  return { input, output, cacheWrite, cacheRead };
}

/**
 * 主模型 = 出现次数最多的 model id；并列时取字符序最小者，保证同样输入
 * 永远同样输出。返回 null 表示这个会话没有任何模型标记（例如纯手工记录）。
 */
function dominantModel(records: readonly SessionRecord[]): { model: string; kinds: number } | null {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record.model) continue;
    counts.set(record.model, (counts.get(record.model) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const entries = Array.from(counts.entries()).sort((a, b) =>
    b[1] === a[1] ? a[0].localeCompare(b[0]) : b[1] - a[1]
  );
  return { model: entries[0][0], kinds: counts.size };
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** 一条时间线：时刻 + 类型 + 动作。**故意不带 summary**——summary 是消息原文/路径。 */
function timelineLine(row: LogRow): string {
  const parts = [row.label, row.action];
  if (row.status === "error") parts.push("失败");
  return `- ${formatClockSeconds(row.timestamp)} · ${parts.filter(Boolean).join(" · ")}`;
}

function formatClockSeconds(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * 时间线抽样：≤10 行。超限时保留「开头怎么起、结尾怎么收」——档案读者最想
 * 知道的是这两端，中间用一行省略号交代跳过了多少。
 */
export function timelineLines(rows: readonly LogRow[], limit = ARCHIVE_TIMELINE_LIMIT): string[] {
  if (limit <= 0) return [];
  if (rows.length <= limit) return rows.map(timelineLine);

  const head = Math.min(TIMELINE_HEAD, limit);
  const tail = Math.max(0, limit - head - 1);
  const omitted = rows.length - head - tail;
  return [
    ...rows.slice(0, head).map(timelineLine),
    `- （中间省略 ${omitted} 条）`,
    ...rows.slice(rows.length - tail).map(timelineLine)
  ];
}

/** 工具调用次数：按次数降序，并列按工具名字典序。 */
export function toolCounts(records: readonly SessionRecord[]): Array<{ tool: string; count: number }> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (!record.toolName) continue;
    counts.set(record.toolName, (counts.get(record.toolName) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => (b.count === a.count ? a.tool.localeCompare(b.tool) : b.count - a.count));
}

export type SessionArchiveOptions = {
  /** 时间线最多几行（默认 {@link ARCHIVE_TIMELINE_LIMIT}）。 */
  timelineLimit?: number;
};

/**
 * 生成会话档案的 Markdown 文本。
 *
 * 纯函数：不读时钟、不读文件系统、不依赖渲染环境——同一份 ParsedSession
 * 永远得到逐字节相同的档案（保存对话框与测试都靠这一点）。
 */
export function buildSessionArchive(
  session: ParsedSession,
  options: SessionArchiveOptions = {}
): string {
  const records = session.records;
  const userMessages = records.filter(
    (record) => record.kind === "user" && record.compactSummary !== true
  ).length;
  const assistantMessages = records.filter((record) => record.kind === "assistant").length;
  const tokens = sumUsage(records);
  const samples = contextSeriesOf(records);
  const contextPeak = samples.reduce((max, sample) => Math.max(max, sample.contextTokens), 0);
  const compactions = session.compactEvents?.length ?? 0;
  const errors = records.filter((record) => record.isError).length;
  const model = dominantModel(records);
  const duration = Math.max(0, session.endedAt - session.startedAt);

  const modelText = model === null ? "—" : model.kinds > 1 ? `${model.model} 等 ${model.kinds} 种` : model.model;

  const lines: string[] = [];
  lines.push("# 会话档案", "");
  lines.push(
    "> 只含聚合数字与结构性事实：不含消息原文、文件路径与会话工作目录。",
    ""
  );

  lines.push("## 元信息", "");
  lines.push("| 项目 | 值 |", "| --- | --- |");
  lines.push(`| 项目 | ${escapeCell(projectNameOfCwd(session.cwd))} |`);
  lines.push(`| 模型 | ${escapeCell(modelText)} |`);
  lines.push(`| 开始 | ${formatDateTime(session.startedAt)} |`);
  lines.push(`| 结束 | ${formatDateTime(session.endedAt)} |`);
  lines.push(`| 时长 | ${formatDuration(duration)} |`);
  lines.push(`| 记录数 | ${records.length} |`);
  lines.push("");

  lines.push("## 统计", "");
  lines.push("| 指标 | 值 |", "| --- | --- |");
  lines.push(`| 消息数 | 用户 ${userMessages} · LLM ${assistantMessages} |`);
  lines.push(`| 输入 tokens | ${formatTokenCount(tokens.input)} |`);
  lines.push(`| 输出 tokens | ${formatTokenCount(tokens.output)} |`);
  lines.push(`| 缓存写入 tokens | ${formatTokenCount(tokens.cacheWrite)} |`);
  lines.push(`| 缓存读取 tokens | ${formatTokenCount(tokens.cacheRead)} |`);
  lines.push(`| 上下文峰值 | ${formatTokenCount(contextPeak)} |`);
  lines.push(`| 压缩次数 | ${compactions} |`);
  lines.push(`| 错误数 | ${errors} |`);
  lines.push("");

  lines.push("## 工具清单", "");
  const tools = toolCounts(records);
  if (tools.length === 0) {
    lines.push("没有工具调用。", "");
  } else {
    lines.push("| 工具 | 调用数 |", "| --- | --- |");
    for (const row of tools) {
      lines.push(`| ${escapeCell(row.tool)} | ${row.count} |`);
    }
    lines.push("");
  }

  lines.push("## 时间线摘要", "");
  const rows = buildLogRows(records, session.turns, session.compactEvents ?? []);
  const timeline = timelineLines(rows, options.timelineLimit ?? ARCHIVE_TIMELINE_LIMIT);
  if (timeline.length === 0) {
    lines.push("没有可摘要的记录。", "");
  } else {
    lines.push(...timeline, "");
  }

  return lines.join("\n");
}
