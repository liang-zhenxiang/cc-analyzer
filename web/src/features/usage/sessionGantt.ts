import type { UsageSessionInput, UsageTotals } from "./usageAggregations";
import { totalsSum } from "./usageAggregations";
import { sessionTitle } from "../sessions/metadataCache";

/**
 * 会话甘特（D7）：把若干会话折成时间轴上的条——每条一个会话，长度是
 * records 首末 timestamp 差（墙钟口径，与 sessionCompare/logRows 同源：
 * 不看 durationMs、不看 meta.mtime），粗细由 tokens 定（视图层映射）。
 *
 * overlapCount = 与该会话时间区间相交的其他会话数（含端点相触：end ===
 * other.start 算相交——「同一分钟收尾再开工」在时间轴上就是挨着的两条，
 * 不算重叠会谎称串行）。maxOverlaps = overlapCount 的最大值，视图拿它
 * 决定泳道数。spanStart/spanEnd = 全体会话（含每条自身的 start/end）的
 * min/max；空输入时两者相等（都取 now），视图渲染空轴而不是崩溃。
 */

/** 一条甘特条。tokens 是四计数器之和（与 KPI 同口径的单一数字）。 */
export type GanttRow = {
  label: string;
  projectLabel: string;
  start: number;
  end: number;
  tokens: number;
  overlapCount: number;
};

export type GanttData = {
  rows: GanttRow[];
  maxOverlaps: number;
  spanStart: number;
  spanEnd: number;
};

/** 单会话时间区间：records 首末 timestamp；空 records 时 start === end === undefined 参与方不计。 */
type SessionSpan = { start: number; end: number };

function spanOf(records: readonly UsageSessionInput["records"][number][]): SessionSpan | null {
  if (records.length === 0) return null;
  let start = records[0].timestamp;
  let end = records[0].timestamp;
  for (const record of records) {
    if (record.timestamp < start) start = record.timestamp;
    if (record.timestamp > end) end = record.timestamp;
  }
  return { start, end };
}

/**
 * 甘特数据。rows 按 start 升序（同 start 时按 end 升序，再按 label 字典序
 * ——完全并列时输出仍稳定，同输入必同输出）。`now` 缺省 Date.now()，
 * 只用于空输入时给出 span 的落点（有会话时 span 来自会话自身）。
 */
export function buildGantt(
  sessions: readonly UsageSessionInput[],
  now: number = Date.now()
): GanttData {
  const spans = sessions
    .map((session) => ({ session, span: spanOf(session.records) }))
    .filter((entry): entry is { session: UsageSessionInput; span: SessionSpan } => entry.span !== null);

  const rows: GanttRow[] = spans.map(({ session, span }) => {
    // tokens 复用 UsageTotals 四计数器之和——不再自建一套「会话 token」口径。
    const totals: UsageTotals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    for (const record of session.records) {
      const usage = record.usage;
      if (!usage) continue;
      totals.input += usage.inputTokens ?? 0;
      totals.output += usage.outputTokens ?? 0;
      totals.cacheCreation += usage.cacheCreationTokens ?? 0;
      totals.cacheRead += usage.cacheReadTokens ?? 0;
    }
    return {
      // 有 meta 时用列表页同一标题优先级（customTitle > agentName > aiTitle
      // > userPrompt > projectLabel）；手造输入没有 meta，落到 projectLabel。
      label: session.session ? sessionTitle(session.session) : session.projectLabel,
      projectLabel: session.projectLabel,
      start: span.start,
      end: span.end,
      tokens: totalsSum(totals),
      overlapCount: 0
    };
  });

  // 稳定排序：start ↑，end ↑，label 字典序兜底。
  rows.sort((a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label));

  // 两两判交：含端点相触（a.start <= b.end && b.start <= a.end）。
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[i].start <= rows[j].end && rows[j].start <= rows[i].end) {
        rows[i].overlapCount += 1;
        rows[j].overlapCount += 1;
      }
    }
  }

  let spanStart = now;
  let spanEnd = now;
  if (rows.length > 0) {
    spanStart = Number.POSITIVE_INFINITY;
    spanEnd = Number.NEGATIVE_INFINITY;
    for (const row of rows) {
      if (row.start < spanStart) spanStart = row.start;
      if (row.end > spanEnd) spanEnd = row.end;
    }
  }

  const maxOverlaps = rows.reduce((max, row) => Math.max(max, row.overlapCount), 0);

  return { rows, maxOverlaps, spanStart, spanEnd };
}
