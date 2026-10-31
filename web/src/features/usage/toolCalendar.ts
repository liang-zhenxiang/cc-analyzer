import type { ToolBucketKey, ToolCallFact } from "./toolCensus";
import { censusKeyId } from "./toolCensus";
import { monthKeyOf, monthSpanBetween, monthIndexOf } from "./monthlyReport";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 工具月历（G6）：每个工具一条「按月调用次数」的迷你条形序列，挂在工具
 * 普查旁的「按月」视图。纯数据层——回归/弃用（连续 2 个月 0 后又有）交给
 * 视觉判断，模型层不硬编码：一眼看空的月份就是月历的全部表达。
 *
 * 口径与 toolCensus（N3）严格同源，两图相邻、同工具总数必须对得上：
 * - 身份：`censusKeyId`（builtin:Bash / skill:名 / mcp:server / subagent:类型）
 *   ——MCP 同样按 server 聚合，桶级身份与普查完全一致；
 * - 计数：吃 `UsageSessionInput.toolCalls` 事实（提取层 `extractToolCalls`
 *   的产出，含 sidechain、含未配对 tool_use——「调用确实发起过」，普查如此
 *   月历也如此，缺 toolCalls 字段的手造输入对本模块不可见，同普查约定）；
 * - 窗口：与 G4 月报同一条月几何（`monthSpanBetween` 单一来源），但事件源
 *   是 records + toolCalls 的时间戳并集——sidechain 事实可能晚于最后一条
 *   主链记录，只看 records 会把尾巴月裁掉。
 *
 * 排序：总调用数降序取前 12（TOOL_CALENDAR_MAX_TOOLS），并列按展示名字典
 * 序——与普查 buckets 的排序规则同款，两图行序尽量一致。
 */

export const TOOL_CALENDAR_MAX_TOOLS = 12;

/** 一格月历：某工具在某自然月的调用次数。 */
export type ToolMonthCell = {
  year: number;
  /** 1–12。 */
  month: number;
  calls: number;
};

/** 一条工具行：12 个月（或窗口更短时按窗口）的调用序列。 */
export type ToolCalendarRow = {
  /** 稳定身份（`censusKeyId` 输出；MCP 按 server）。 */
  key: string;
  /** 展示名（工具名 / skill 名 / MCP server / subagent 类型）——labelOf 同款。 */
  label: string;
  /** 逐月调用次数（含空月，calls: 0）；(year, month) 升序。 */
  months: ToolMonthCell[];
  /** 窗口内总调用数（排序用；= months.calls 之和）。 */
  totalCalls: number;
};

/** key → 展示名（toolCensus.labelOf 同款四分支，独立内联以免依赖私有函数）。 */
function keyLabel(key: ToolBucketKey): string {
  switch (key.kind) {
    case "builtin":
      return key.toolName;
    case "skill":
      return key.skillName;
    case "subagent":
      return key.subagentType;
    case "mcp":
      return key.server;
  }
}

/**
 * 工具月历。无任何 toolCalls 事实 → 空数组（没有工具可画，界面走空态）；
 * 有事实但窗口只覆盖一个月 → 每行一张格（序列长度 = 窗口月数，不硬凑 12）。
 */
export function toolCalendar(
  sessions: readonly UsageSessionInput[],
  now: number = Date.now()
): ToolCalendarRow[] {
  // 窗口事件源：records 与 toolCalls 的时间戳并集（都取本地自然月）。
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  const see = (ts: number): void => {
    if (firstTs === null || ts < firstTs) firstTs = ts;
    if (lastTs === null || ts > lastTs) lastTs = ts;
  };
  for (const session of sessions) {
    for (const record of session.records) see(record.timestamp);
    if (session.toolCalls) for (const fact of session.toolCalls) see(fact.timestamp);
  }
  if (firstTs === null || lastTs === null) return [];

  const span = monthSpanBetween(firstTs, Math.max(lastTs, now));

  // 桶：工具身份 → 逐月调用数（按窗口下标攒数组，直接寻址不加 Map 中间层）。
  const monthSlot = new Map<number, number>();
  span.forEach((key, i) => monthSlot.set(monthIndexOf(key), i));
  const cells = new Map<string, { label: string; calls: number[] }>();
  for (const session of sessions) {
    const facts: readonly ToolCallFact[] = session.toolCalls ?? [];
    for (const fact of facts) {
      const key = censusKeyId(fact.key);
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = { label: keyLabel(fact.key), calls: Array.from({ length: span.length }, () => 0) };
        cells.set(key, bucket);
      }
      const slot = monthSlot.get(monthIndexOf(monthKeyOf(fact.timestamp)));
      if (slot !== undefined) bucket.calls[slot] += 1;
    }
  }

  const rows: ToolCalendarRow[] = [...cells.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    months: span.map((m, i) => ({ year: m.year, month: m.month, calls: bucket.calls[i] })),
    totalCalls: bucket.calls.reduce((sum, n) => sum + n, 0)
  }));

  rows.sort((a, b) => b.totalCalls - a.totalCalls || a.label.localeCompare(b.label));
  return rows.slice(0, TOOL_CALENDAR_MAX_TOOLS);
}
