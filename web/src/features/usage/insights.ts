import { formatModelId, formatProjectPath, formatTokenCount } from "../../lib/format";
import type { CompareRange, DistributionRow, RangeStats } from "./compareRanges";
import {
  modelDistribution,
  previousRange,
  projectDistribution,
  statsForRange
} from "./compareRanges";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 「值得注意的变化」（Issue #383）的纯逻辑层：把「对照」反过来用——应用
 * 自己选「最近 N 天 vs 上一个等长区间」，筛出达到阈值的几项差异，只陈述
 * 事实，不评价、不生成。
 *
 * 数据口径全部复用既有实现，不另起一套：
 * - 区间 = `previousRange` 的本地自然日窗口，与对照视图同源；
 * - 模型 / 项目占比 = `modelDistribution` / `projectDistribution`（token 加权）；
 * - 会话数 / 活跃天 / 总量 / 平均时长 = `statsForRange`；
 * - 工具调用失败率 = `errorExtract` 的分子（tool 事件）与分母（逐日
 *   toolCalls），与「错误」档同一个提取通道（含 sidechain）；
 * - 压缩次数 = `compactEvents` 的窗口内事件，会话数同上。
 *
 * 每条洞察是两组可复算数字之差；样本达不到下限就不产出，不写「样本不足」
 * 占位。文本只由下方模板拼出，模板里没有任何判断词。
 */

export const INSIGHT_THRESHOLDS = {
  modelSharePp: 20,
  projectSharePp: 20,
  errorRatePp: 5,
  compactionPerSession: 0.5,
  sessionLengthPct: 50,
  dailyTokensPct: 50,
  minSessions: 5,
  minToolCalls: 20,
  minActiveDays: 7,
  maxInsights: 5
} as const;

export type InsightKind =
  | "model"
  | "project"
  | "errorRate"
  | "compaction"
  | "sessionLength"
  | "dailyTokens";

export type Insight = {
  kind: InsightKind;
  /** 一句话事实，形如「Opus 占比从 21% 升到 58%」。数字已格式化。 */
  text: string;
  /** 排序用：变化幅度 ÷ 阈值。 */
  intensity: number;
  /** 依据：两段的原始读数，供展开区与测试核对。 */
  evidence: { label: string; before: number; after: number }[];
  /** 方向语义：只有错误率是 up-bad，其余 neutral。 */
  direction: "neutral" | "up-bad";
};

/** 排序时的稳定次序：规则序号即列表顺序。 */
const RULE_ORDER: Record<InsightKind, number> = {
  model: 1,
  project: 2,
  errorRate: 3,
  compaction: 4,
  sessionLength: 5,
  dailyTokens: 6
};

/**
 * 压缩频率的归一底数：把「次/会话」写成「每 10 个会话多少次」，既好读
 * 又保留一位小数（阈值 0.5 次/会话 = 每 10 个会话 5 次，边界可辨）。
 */
export const COMPACTION_BASE_SESSIONS = 10;

const MINUTE_MS = 60_000;

/**
 * 阈值比较留一点浮点余量：`0.58 - 0.38` 在二进制里是 0.19999999999999996，
 * 恰好等于阈值的样本不应因为最后一位误差被吞掉。
 */
const EPSILON = 1e-9;

function atLeast(value: number, threshold: number): boolean {
  return value >= threshold - EPSILON;
}

/** 与 `aggregateRange` / `previousRange` 同一条天数归一。 */
function normalizeDays(days: number): number {
  return Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
}

/**
 * 区间实际可统计的半开边界。与 `compareRanges` 内部的 `windowBounds` 同口径：
 * 右界不越过「今天结束」，起点是本地零点。
 */
function boundsOf(range: CompareRange, now: number): { start: number; end: number } {
  const start = dayStartOf(range.startDay);
  const end = addLocalDays(start, normalizeDays(range.days));
  const todayEnd = addLocalDays(dayStartOf(now), 1);
  return { start, end: Math.min(end, todayEnd) };
}

function directionWord(after: number, before: number): "升" | "降" {
  return after > before ? "升" : "降";
}

/** 百分比读数（evidence 里的单位），统一四舍五入到整数展示。 */
export function formatInsightPercent(value: number): string {
  return `${Math.round(value)}%`;
}

/** 平均会话时长读数（分钟）；不足一分钟用秒，避免把 40 秒印成 0。 */
export function formatInsightMinutes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 分钟";
  if (value < 1) return `${Math.max(1, Math.round(value * 60))} 秒`;
  return `${Math.round(value)} 分钟`;
}

/** 日均 token 读数：复用全站 token 写法（小于百万保留精确值）。 */
export function formatInsightTokens(value: number): string {
  return formatTokenCount(Math.round(value));
}

/** 每 10 个会话的压缩次数：最多一位小数，整数不带 `.0`。 */
export function formatInsightCompaction(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

type ToolWindow = { calls: number; errors: number };

/**
 * 一个窗口内的工具调用失败读数。分子与分母都取 `errorExtract`：提取趟已经
 * 把 sidechain 记录合并进来，且分子沿用「等用户输入不算失败」的白名单规则
 * （见 `errorStats`）。没有 `errorExtract` 的输入两边都不计入，绝不用
 * `records` 的主链数据补位——那会让分子分母跨域。
 */
function toolWindowOf(
  inputs: readonly UsageSessionInput[],
  start: number,
  end: number
): ToolWindow {
  let calls = 0;
  let errors = 0;
  for (const input of inputs) {
    const extract = input.errorExtract;
    if (!extract) continue;
    for (const [dayStart, facts] of extract.days) {
      if (dayStart < start || dayStart >= end) continue;
      for (const count of facts.toolCalls.values()) calls += count;
    }
    for (const event of extract.events) {
      if (event.kind !== "tool") continue;
      if (event.timestamp < start || event.timestamp >= end) continue;
      errors += 1;
    }
  }
  return { calls, errors };
}

function compactionCountOf(
  inputs: readonly UsageSessionInput[],
  start: number,
  end: number
): number {
  let count = 0;
  for (const input of inputs) {
    for (const event of input.compactEvents ?? []) {
      if (event.timestamp >= start && event.timestamp < end) count += 1;
    }
  }
  return count;
}

/**
 * 模型 / 项目占比规则的共用逻辑：两段都非空时，取变化最大的那一项。
 * 变化并列时按展示名排序，保证输出稳定。
 */
function shareInsight(
  rows: readonly DistributionRow[],
  threshold: number,
  kind: "model" | "project",
  displayLabel: (row: DistributionRow) => string,
  textOf: (label: string, before: number, after: number) => string
): Insight | null {
  let totalA = 0;
  let totalB = 0;
  for (const row of rows) {
    totalA += row.a;
    totalB += row.b;
  }
  // 任一段没有可加权 token 时没有基线：不把「0% → 100%」当成变化。
  if (totalA <= 0 || totalB <= 0) return null;

  let best: { row: DistributionRow; change: number; label: string } | null = null;
  for (const row of rows) {
    const change = Math.abs(row.aShare - row.bShare) * 100;
    if (!atLeast(change, threshold)) continue;
    const label = displayLabel(row);
    if (
      best === null ||
      change > best.change + EPSILON ||
      (Math.abs(change - best.change) <= EPSILON && label.localeCompare(best.label) < 0)
    ) {
      best = { row, change, label };
    }
  }
  if (best === null) return null;

  // a = 当前窗口，b = 对照窗口；文本按「从 before 到 after」的顺序读。
  const before = best.row.bShare * 100;
  const after = best.row.aShare * 100;
  return {
    kind,
    text: textOf(best.label, before, after),
    intensity: best.change / threshold,
    evidence: [{ label: best.label, before, after }],
    direction: "neutral"
  };
}

function modelInsight(
  inputs: readonly UsageSessionInput[],
  current: CompareRange,
  previous: CompareRange,
  now: number
): Insight | null {
  const rows = modelDistribution(inputs, current, previous, now);
  return shareInsight(
    rows,
    INSIGHT_THRESHOLDS.modelSharePp,
    "model",
    (row) => formatModelId(row.label),
    (label, before, after) =>
      `${label} 占比从 ${formatInsightPercent(before)} ${directionWord(after, before)}到 ${formatInsightPercent(after)}`
  );
}

function projectInsight(
  inputs: readonly UsageSessionInput[],
  current: CompareRange,
  previous: CompareRange,
  now: number
): Insight | null {
  // 与页面同一条名字解析：第一个真实 cwd 获胜，退回编码目录名。
  const projectPaths = new Map<string, string>();
  for (const input of inputs) {
    if (input.projectPath && !projectPaths.has(input.projectLabel)) {
      projectPaths.set(input.projectLabel, input.projectPath);
    }
  }
  const rows = projectDistribution(
    inputs,
    current,
    previous,
    now,
    Number.POSITIVE_INFINITY
  );
  return shareInsight(
    rows,
    INSIGHT_THRESHOLDS.projectSharePp,
    "project",
    (row) => formatProjectPath(row.label, projectPaths.get(row.label)),
    (label, before, after) =>
      `${label} 的用量占比从 ${formatInsightPercent(before)} ${directionWord(after, before)}到 ${formatInsightPercent(after)}`
  );
}

function errorRateInsight(
  inputs: readonly UsageSessionInput[],
  current: CompareRange,
  previous: CompareRange,
  now: number
): Insight | null {
  const currentBounds = boundsOf(current, now);
  const previousBounds = boundsOf(previous, now);
  const afterWindow = toolWindowOf(inputs, currentBounds.start, currentBounds.end);
  const beforeWindow = toolWindowOf(inputs, previousBounds.start, previousBounds.end);
  const { minToolCalls, errorRatePp } = INSIGHT_THRESHOLDS;
  if (afterWindow.calls < minToolCalls || beforeWindow.calls < minToolCalls) return null;

  const after = (afterWindow.errors / afterWindow.calls) * 100;
  const before = (beforeWindow.errors / beforeWindow.calls) * 100;
  const change = Math.abs(after - before);
  if (!atLeast(change, errorRatePp)) return null;

  return {
    kind: "errorRate",
    text: `工具调用失败率从 ${formatInsightPercent(before)} ${directionWord(after, before)}到 ${formatInsightPercent(after)}`,
    intensity: change / errorRatePp,
    evidence: [{ label: "工具调用失败率", before, after }],
    // 指标语义固定：失败率上升是坏事。下降时 UI 自行反色，方向标签不变。
    direction: "up-bad"
  };
}

function compactionInsight(
  inputs: readonly UsageSessionInput[],
  current: CompareRange,
  previous: CompareRange,
  now: number,
  currentSessions: number,
  previousSessions: number
): Insight | null {
  // 两段都要有会话，否则「次/会话」没有分母。
  if (currentSessions <= 0 || previousSessions <= 0) return null;

  const currentBounds = boundsOf(current, now);
  const previousBounds = boundsOf(previous, now);
  const afterRate =
    compactionCountOf(inputs, currentBounds.start, currentBounds.end) / currentSessions;
  const beforeRate =
    compactionCountOf(inputs, previousBounds.start, previousBounds.end) / previousSessions;
  const change = Math.abs(afterRate - beforeRate);
  if (!atLeast(change, INSIGHT_THRESHOLDS.compactionPerSession)) return null;

  const before = beforeRate * COMPACTION_BASE_SESSIONS;
  const after = afterRate * COMPACTION_BASE_SESSIONS;
  return {
    kind: "compaction",
    text: `平均每 ${COMPACTION_BASE_SESSIONS} 个会话压缩次数从 ${formatInsightCompaction(before)} 次 ${directionWord(after, before)}到 ${formatInsightCompaction(after)} 次`,
    intensity: change / INSIGHT_THRESHOLDS.compactionPerSession,
    evidence: [
      { label: `每 ${COMPACTION_BASE_SESSIONS} 个会话压缩次数`, before, after }
    ],
    direction: "neutral"
  };
}

function sessionLengthInsight(current: RangeStats, previous: RangeStats): Insight | null {
  const { minSessions, sessionLengthPct } = INSIGHT_THRESHOLDS;
  if (current.sessions < minSessions || previous.sessions < minSessions) return null;

  const afterMs = current.avgSessionMs;
  const beforeMs = previous.avgSessionMs;
  // 基线为 0 时百分比没有定义（不是「涨了无穷多」）。
  if (afterMs === null || beforeMs === null || beforeMs <= 0) return null;

  const pct = Math.abs(((afterMs - beforeMs) / beforeMs) * 100);
  if (!atLeast(pct, sessionLengthPct)) return null;

  const before = beforeMs / MINUTE_MS;
  const after = afterMs / MINUTE_MS;
  return {
    kind: "sessionLength",
    text: `平均会话时长从 ${formatInsightMinutes(before)} ${directionWord(after, before)}到 ${formatInsightMinutes(after)}`,
    intensity: pct / sessionLengthPct,
    evidence: [{ label: "平均会话时长", before, after }],
    direction: "neutral"
  };
}

function dailyTokensInsight(current: RangeStats, previous: RangeStats): Insight | null {
  const { minActiveDays, dailyTokensPct } = INSIGHT_THRESHOLDS;
  if (current.activeDays < minActiveDays || previous.activeDays < minActiveDays) return null;

  // 「日均」= 每个活跃日的 token：活跃日不足 7 天时该比值噪声太大。
  const before = previous.tokens / previous.activeDays;
  const after = current.tokens / current.activeDays;
  if (before <= 0) return null;

  const pct = Math.abs(((after - before) / before) * 100);
  if (!atLeast(pct, dailyTokensPct)) return null;

  return {
    kind: "dailyTokens",
    text: `活跃日均 token 从 ${formatInsightTokens(before)} ${directionWord(after, before)}到 ${formatInsightTokens(after)}`,
    intensity: pct / dailyTokensPct,
    evidence: [{ label: "活跃日均 token", before, after }],
    direction: "neutral"
  };
}

type Candidate = Insight & { rule: number };

/**
 * 最近 `days` 天 vs 上一个等长区间的变化清单。
 *
 * - `days` 跟随页面区间控件（默认 30），归一规则与 `aggregateRange` 一致；
 * - 当前窗口 = 今天往前 `days` 个本地日（今天含在内），对照窗口 =
 *   `previousRange` 推出的紧邻等长区间；
 * - 没有达到阈值或样本不足的规则不产出（不占位）；
 * - 按 `intensity`（变化幅度 ÷ 阈值）降序，同值按规则序号，最多 5 条。
 */
export function buildInsights(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): Insight[] {
  const windowDays = normalizeDays(days);
  const current: CompareRange = {
    startDay: addLocalDays(dayStartOf(now), -(windowDays - 1)),
    days: windowDays
  };
  const previous = previousRange(current);

  const currentStats = statsForRange(inputs, current, now);
  const previousStats = statsForRange(inputs, previous, now);

  const candidates: Candidate[] = [];
  const add = (rule: number, insight: Insight | null) => {
    if (insight) candidates.push({ ...insight, rule });
  };

  add(RULE_ORDER.model, modelInsight(inputs, current, previous, now));
  add(RULE_ORDER.project, projectInsight(inputs, current, previous, now));
  add(RULE_ORDER.errorRate, errorRateInsight(inputs, current, previous, now));
  add(
    RULE_ORDER.compaction,
    compactionInsight(
      inputs,
      current,
      previous,
      now,
      currentStats.sessions,
      previousStats.sessions
    )
  );
  add(RULE_ORDER.sessionLength, sessionLengthInsight(currentStats, previousStats));
  add(RULE_ORDER.dailyTokens, dailyTokensInsight(currentStats, previousStats));

  candidates.sort((a, b) => {
    const byIntensity = b.intensity - a.intensity;
    if (Math.abs(byIntensity) > EPSILON) return byIntensity;
    return a.rule - b.rule;
  });

  return candidates.slice(0, INSIGHT_THRESHOLDS.maxInsights).map((candidate) => ({
    kind: candidate.kind,
    text: candidate.text,
    intensity: candidate.intensity,
    evidence: candidate.evidence,
    direction: candidate.direction
  }));
}
