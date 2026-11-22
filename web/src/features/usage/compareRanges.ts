import type { SessionRecord } from "../sessions/types";
import { tokenTotalsOf } from "../sessions/tokenTotals";
import { estimateCost } from "./pricingSnapshot";
import { usageTokens } from "./projectArena";
import {
  UNKNOWN_MODEL_LABEL,
  addLocalDays,
  dayStartOf,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 「对照」的纯逻辑层（Issue #377）：两个等长或不等长的本地自然日区间，
 * 各算一份读数与分布，再由界面并排渲染。
 *
 * 口径与既有面板一致，不另起一套：
 * - 区间是**本地自然日**闭区间，边界一律走 `dayStartOf` / `addLocalDays`
 *   （DST 日 23/25 小时，毫秒除法会漂一天）；
 * - token = 四计数器之和（`tokenTotalsOf`），成本 = `estimateCost` 单一计价；
 * - 未定价模型的会话**整体**退出成本、计入 `unpricedSessions`，该段 `usd`
 *   记为 `null`——不做 token 折算，也不做部分求和；
 * - 消息 = user/assistant 且非 compact summary（与 `aggregateSession` 同判定）；
 * - 活跃天 = 区间内出现过任何记录（不限 message、不限带 usage）的本地日
 *   （与年报同口径）；
 * - 时长 = 会话首末记录差（墙钟跨度，不是活跃时长），按会话平均。
 *
 * 区间只裁记录，不裁会话：一条跨边界的会话在每段里只贡献自己落在该段的
 * 记录（与 `aggregateRange` 同款语义）。
 */

/** 一个本地自然日区间：`startDay` 必须是 `dayStartOf` 的结果，`days` ≥ 1。 */
export type CompareRange = { startDay: number; days: number };

/** 区间读数。金额与平均时长没有样本时为 `null`，绝不印成 0。 */
export type RangeStats = {
  sessions: number;
  messages: number;
  tokens: number;
  /** 任一会话未定价时为 `null`；空区间为 0（没有未知价，也没有花费）。 */
  usd: number | null;
  /** 因未定价模型被排除出成本口径的会话数。 */
  unpricedSessions: number;
  activeDays: number;
  /** 会话首末记录差的平均值；空区间为 `null`。 */
  avgSessionMs: number | null;
};

export type CompareMetric = {
  key: "sessions" | "messages" | "tokens" | "usd" | "activeDays" | "avgSessionMs";
  a: number | null;
  b: number | null;
  /** 相对变化：a 相对 b 的百分比；b 为 0 或任一为 null 时为 null。 */
  deltaPct: number | null;
  /** 差值的语义方向：只有 usd 是 "up-bad"，其余是 "neutral"。 */
  direction: "neutral" | "up-bad";
};

export type DistributionRow = {
  key: string;
  label: string;
  a: number;
  b: number;
  /** 各自段内占比（0–1）；该段总 token 为 0 时为 0。 */
  aShare: number;
  bShare: number;
  onlyIn: "a" | "b" | null;
};

/**
 * 天数归一：区间是整自然日，小数/0/NaN 都按 1 天处理。调用方（预设按钮）
 * 不会传这些值，但纯逻辑层不把非法输入算成一个负长度的窗口。
 */
function normalizeDays(days: number): number {
  return Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
}

/** 区间起点：冻结成 `dayStartOf` 的本地零点（外部传时间戳也安全）。 */
function rangeStart(range: CompareRange): number {
  return dayStartOf(range.startDay);
}

/** 区间右边界（开区间）：区间最后一天的次日零点。 */
function rangeEndExclusive(range: CompareRange): number {
  return addLocalDays(rangeStart(range), normalizeDays(range.days));
}

/**
 * 区间实际可统计的右边界：不越过「今天结束」。
 *
 * `now` 的职责只有这一条：预设区间都止于今天，但纯逻辑层仍要挡住「起点
 * 在未来」的区间——否则未来日会被当成「0 消耗的真实日」参与活跃天与平均
 * 时长。把上界锁到明天零点而不是 `now` 本身，才不会把今天已经发生的记录
 * 裁掉。
 */
function windowBounds(range: CompareRange, now: number): { start: number; end: number } {
  const end = rangeEndExclusive(range);
  const todayEnd = addLocalDays(dayStartOf(now), 1);
  return { start: rangeStart(range), end: Math.min(end, todayEnd) };
}

/**
 * 紧邻的上一个等长区间：`{startDay, days}` → `{startDay - days, days}`。
 * 首尾相接（新区间终点 = 原区间起点前一天）因此不重叠。
 */
export function previousRange(range: CompareRange): CompareRange {
  const days = normalizeDays(range.days);
  return { startDay: addLocalDays(rangeStart(range), -days), days };
}

/**
 * 两个区间是否落在同一个本地自然日上。半开区间比较：首尾相接不算重叠
 * （`a` 的次日零点 = `b` 的起点 → 无交集）。
 */
export function rangesOverlap(a: CompareRange, b: CompareRange): boolean {
  return rangeStart(a) < rangeEndExclusive(b) && rangeStart(b) < rangeEndExclusive(a);
}

/**
 * 区间标签：同年 `11/15–11/21`，跨年带年份 `2025/12/29–2026/1/4`。
 * 单日区间不退化成 `11/15–11/15`。不补零，与 `formatDayLabel` 的字面一致。
 */
export function rangeLabel(range: CompareRange): string {
  const start = rangeStart(range);
  const end = addLocalDays(start, normalizeDays(range.days) - 1);
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (start === end) {
    return `${startDate.getMonth() + 1}/${startDate.getDate()}`;
  }
  if (startDate.getFullYear() === endDate.getFullYear()) {
    return `${startDate.getMonth() + 1}/${startDate.getDate()}–${endDate.getMonth() + 1}/${endDate.getDate()}`;
  }
  return (
    `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}` +
    `–${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()}`
  );
}

/** 半开窗口内的记录；区间只裁记录，不重排会话。 */
function recordsInWindow(
  records: readonly SessionRecord[],
  start: number,
  end: number
): SessionRecord[] {
  return records.filter((record) => record.timestamp >= start && record.timestamp < end);
}

function totalsOf(usage: NonNullable<SessionRecord["usage"]>): UsageTotals {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
}

/**
 * 一条会话在窗口内的成本：**整条会话**要么全部计价，要么全部退出——只要
 * 出现一条未收录定价的记录，就返回 `unpriced`，调用方不计它的部分和。
 */
function sessionCost(records: readonly SessionRecord[]): { usd: number; unpriced: boolean } {
  let usd = 0;
  for (const record of records) {
    const usage = record.usage;
    if (!usage) continue;
    const estimate = estimateCost(totalsOf(usage), record.model ?? UNKNOWN_MODEL_LABEL);
    if ("unknownModel" in estimate) return { usd: 0, unpriced: true };
    usd += estimate.usd;
  }
  return { usd, unpriced: false };
}

/** 首末记录差（墙钟跨度，不扣等待）；单条记录为 0。 */
function durationMsOf(records: readonly SessionRecord[]): number {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (record.timestamp < first) first = record.timestamp;
    if (record.timestamp > last) last = record.timestamp;
  }
  return first === Number.POSITIVE_INFINITY ? 0 : last - first;
}

/**
 * 一个区间的读数。没有记录落进窗口的会话不计数（`sessions` 是「区间内
 * 有活动的会话数」，不是扫描到的文件数）。
 */
export function statsForRange(
  inputs: readonly UsageSessionInput[],
  range: CompareRange,
  now: number = Date.now()
): RangeStats {
  const bounds = windowBounds(range, now);
  let sessions = 0;
  let messages = 0;
  let tokens = 0;
  let usd = 0;
  let unpricedSessions = 0;
  let totalDurationMs = 0;
  const activeDays = new Set<number>();

  for (const input of inputs) {
    const records = recordsInWindow(input.records, bounds.start, bounds.end);
    if (records.length === 0) continue;

    sessions += 1;
    for (const record of records) {
      activeDays.add(dayStartOf(record.timestamp));
      if (
        (record.kind === "user" || record.kind === "assistant") &&
        record.compactSummary !== true
      ) {
        messages += 1;
      }
    }
    tokens += tokenTotalsOf(records).total;
    totalDurationMs += durationMsOf(records);

    const cost = sessionCost(records);
    if (cost.unpriced) unpricedSessions += 1;
    else usd += cost.usd;
  }

  return {
    sessions,
    messages,
    tokens,
    // 任一未定价会话存在 → 该段金额不可相加，给 null 而不是「已知部分的和」。
    usd: unpricedSessions > 0 ? null : usd,
    unpricedSessions,
    activeDays: activeDays.size,
    avgSessionMs: sessions > 0 ? totalDurationMs / sessions : null
  };
}

/**
 * `(a - b) / b * 100`。b 为 0 / 任一为 null 时给 null：从 0 到任何数的
 * 「增长率」是无穷大而不是一个可读的百分比，界面应显示「—」。
 */
function relativeChange(a: number | null, b: number | null): number | null {
  if (a === null || b === null || b === 0) return null;
  return ((a - b) / b) * 100;
}

/** 指标顺序固定，界面按此顺序渲染行。 */
const METRIC_KEYS: ReadonlyArray<CompareMetric["key"]> = [
  "sessions",
  "messages",
  "tokens",
  "usd",
  "activeDays",
  "avgSessionMs"
];

/**
 * 并排读数：a 相对 b 的百分比变化。只有成本是「涨是坏事」
 * （周战报既有裁定），其余指标的方向本身不带褒贬。
 */
export function compareStats(a: RangeStats, b: RangeStats): CompareMetric[] {
  return METRIC_KEYS.map((key) => ({
    key,
    a: a[key],
    b: b[key],
    deltaPct: relativeChange(a[key], b[key]),
    direction: key === "usd" ? "up-bad" : "neutral"
  }));
}

/**
 * 把一段窗口的 token 累加到 `map`。`side` 决定写进 a 还是 b；`keyOf`
 * 返回 null 表示这条记录不参与分布（例如没有项目标签的会话）。
 */
function accumulateTokens(
  map: Map<string, { a: number; b: number }>,
  inputs: readonly UsageSessionInput[],
  bounds: { start: number; end: number },
  side: "a" | "b",
  keyOf: (input: UsageSessionInput, record: SessionRecord) => string | null
): void {
  for (const input of inputs) {
    for (const record of input.records) {
      if (record.timestamp < bounds.start || record.timestamp >= bounds.end) continue;
      // 没有 usage 的记录不产生 token，也不该凭空造出一行 0。
      if (!record.usage) continue;
      const key = keyOf(input, record);
      if (key === null) continue;
      let row = map.get(key);
      if (!row) {
        row = { a: 0, b: 0 };
        map.set(key, row);
      }
      row[side] += usageTokens(record.usage);
    }
  }
}

/**
 * 占比与排序：两段 token 之和降序，并列按 label 字典序（同 `topSlices`
 * 的稳定口径）。`limit` 为 null 时返回全部行——模型的堆叠条需要完整构成。
 * 占比的分母是**整段总量**，不是 Top-N 的小计。
 */
function distributionRows(
  map: ReadonlyMap<string, { a: number; b: number }>,
  limit: number | null
): DistributionRow[] {
  let totalA = 0;
  let totalB = 0;
  for (const row of map.values()) {
    totalA += row.a;
    totalB += row.b;
  }

  const rows: DistributionRow[] = [...map.entries()].map(([key, row]) => ({
    key,
    label: key,
    a: row.a,
    b: row.b,
    aShare: totalA > 0 ? row.a / totalA : 0,
    bShare: totalB > 0 ? row.b / totalB : 0,
    onlyIn: row.a > 0 && row.b === 0 ? "a" : row.b > 0 && row.a === 0 ? "b" : null
  }));

  rows.sort((x, y) => y.a + y.b - (x.a + x.b) || x.label.localeCompare(y.label));
  if (limit === null) return rows;
  return rows.slice(0, Math.max(0, Math.floor(limit)));
}

/**
 * 按项目的 token 分布（Top `limit`，默认 5）。项目身份取会话级
 * `projectLabel`；空标签无法成行，整条会话退出分布（与 `aggregateRange`
 * 的 projects bucket 同判定）。
 */
export function projectDistribution(
  inputs: readonly UsageSessionInput[],
  a: CompareRange,
  b: CompareRange,
  now: number = Date.now(),
  limit = 5
): DistributionRow[] {
  const map = new Map<string, { a: number; b: number }>();
  accumulateTokens(map, inputs, windowBounds(a, now), "a", (input) =>
    input.projectLabel ? input.projectLabel : null
  );
  accumulateTokens(map, inputs, windowBounds(b, now), "b", (input) =>
    input.projectLabel ? input.projectLabel : null
  );
  return distributionRows(map, limit);
}

/**
 * 按模型的 token 分布。模型身份取记录自己的 `model`，缺省归
 * `UNKNOWN_MODEL_LABEL`（与看板 models bucket 同判定）。返回完整构成，
 * 不截断——堆叠条要画出两段各自的 100%。
 */
export function modelDistribution(
  inputs: readonly UsageSessionInput[],
  a: CompareRange,
  b: CompareRange,
  now: number = Date.now()
): DistributionRow[] {
  const map = new Map<string, { a: number; b: number }>();
  const keyOf = (_input: UsageSessionInput, record: SessionRecord): string =>
    record.model ?? UNKNOWN_MODEL_LABEL;
  accumulateTokens(map, inputs, windowBounds(a, now), "a", keyOf);
  accumulateTokens(map, inputs, windowBounds(b, now), "b", keyOf);
  return distributionRows(map, null);
}
