import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import { weekStartOf } from "./weeklyDigest";
import { WEEKDAY_LABELS } from "./charts/chartPrimitives";

/**
 * 每周预算跑道（Round FF F9）的纯逻辑。
 *
 * 与 `weeklyWindow` 的「滚动 7×24h」刻意不是一个量：这条跑道对齐**本地自然周
 * （周一起）**，回答的是「这周按现在的速度会在周几撞上预算」。自然周的日期
 * 算术走 `weekStartOf` / `addLocalDays`，不另写一套。
 *
 * 诚实性规则：
 * - 未设预算 → 不产生任何百分比、不画预算线；实际线与预测线照画（「这周在怎么
 *   烧」与预算无关）。
 * - 活跃日 < 2 天 → 不推算落地速度（与 `weeklyWindow` 的 `MIN_ACTIVE_DAYS`
 *   同一条规则：把一次冲刺乘以七天不是预测，是放大）。
 * - 超预算不表达成「错误」，只给「超出多少」的事实。
 */

/** 与 weeklyWindow 同一门槛：少于两个活跃日就不外推。 */
export const RUNWAY_MIN_ACTIVE_DAYS = 2;

const DAY_MS = 86_400_000;

export type RunwayDay = {
  dayStart: number;
  /** 周一…周日。 */
  label: string;
  /** 这一天内的 token 消耗（四类之和）。 */
  tokens: number;
  /** 截至这一天结束的累计消耗。 */
  cumulative: number;
};

export type RunwayPrediction = {
  /** 按日均外推到周日 24:00 的累计 token。 */
  total: number;
  tokensPerDay: number;
  /** 从 now 到下周一的剩余天数（含小数）。 */
  remainingDays: number;
};

export type BudgetRunway = {
  weekStart: number;
  weekEnd: number;
  /** 周一至周日七格（不管有没有消耗都齐）。 */
  days: RunwayDay[];
  /** 截至 now 的累计消耗。 */
  used: number;
  /** 自设的周预算；null = 未设（不出现任何百分比）。 */
  budget: number | null;
  /** 窗口内有消耗的自然日数。 */
  activeDays: number;
  /** 本周已有活跃日的日均；不足两个活跃日或没有消耗时为 null。 */
  tokensPerDay: number | null;
  /** 外推到周日 24:00；不可推算时为 null。 */
  prediction: RunwayPrediction | null;
  /** 已用是否已经超过预算。 */
  overNow: boolean;
  /** 按预测终点算是否超出预算。 */
  projectedOver: boolean;
  /** 超出的 token 数（按预测终点；没有预算时为 0）。 */
  overBy: number;
  /** 本周是否有可画的数据（有消耗，或至少设了预算）。 */
  hasData: boolean;
};

/** 图表标签用的紧凑 token 写法（86k / 1.2M）；读数列仍用 formatTokenCount。 */
export function compactTokenLabel(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
}

function usageTokens(
  usage: NonNullable<UsageSessionInput["records"][number]["usage"]>
): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

/**
 * 窗口 = 本地自然周（周一起），与页头的「近 N 天」无关。预算只认用户自设
 * 的数字（`PlanSelection.weeklyLimitTokens`），预设档位没有周数字。
 */
export function buildBudgetRunway(
  inputs: readonly UsageSessionInput[],
  now: number,
  weeklyLimitTokens: number | null
): BudgetRunway {
  const weekStart = weekStartOf(now);
  const weekEnd = addLocalDays(weekStart, 7);
  const dayStarts = Array.from({ length: 7 }, (_, index) => addLocalDays(weekStart, index));
  const indexByDay = new Map(dayStarts.map((dayStart, index) => [dayStart, index]));
  const dailyTokens = Array.from({ length: 7 }, () => 0);

  for (const input of inputs) {
    for (const record of input.records) {
      const usage = record.usage;
      if (!usage) continue;
      if (record.timestamp < weekStart || record.timestamp >= weekEnd) continue;
      const index = indexByDay.get(dayStartOf(record.timestamp));
      if (index === undefined) continue;
      dailyTokens[index] += usageTokens(usage);
    }
  }

  let cumulative = 0;
  const days: RunwayDay[] = dayStarts.map((dayStart, index) => {
    cumulative += dailyTokens[index];
    return {
      dayStart,
      label: WEEKDAY_LABELS[index],
      tokens: dailyTokens[index],
      cumulative
    };
  });

  const used = cumulative;
  const activeDays = dailyTokens.filter((tokens) => tokens > 0).length;
  const budget =
    weeklyLimitTokens !== null && Number.isFinite(weeklyLimitTokens) && weeklyLimitTokens > 0
      ? weeklyLimitTokens
      : null;

  const tokensPerDay =
    activeDays >= RUNWAY_MIN_ACTIVE_DAYS && used > 0 ? used / activeDays : null;

  let prediction: RunwayPrediction | null = null;
  if (tokensPerDay !== null && now < weekEnd) {
    const remainingDays = (weekEnd - now) / DAY_MS;
    prediction = {
      total: used + tokensPerDay * remainingDays,
      tokensPerDay,
      remainingDays
    };
  }

  const projected = prediction?.total ?? used;
  const overNow = budget !== null && used > budget;
  const projectedOver = budget !== null && projected > budget;
  const overBy = budget !== null && projected > budget ? projected - budget : 0;

  return {
    weekStart,
    weekEnd,
    days,
    used,
    budget,
    activeDays,
    tokensPerDay,
    prediction,
    overNow,
    projectedOver,
    overBy,
    hasData: used > 0 || budget !== null
  };
}

/**
 * 实际线的折点：周一零点 → 每个已过去的自然日结束；今天停在 now。
 * 未来的日子没有数据，不补零、不画到周日。
 */
export function runwayActualPoints(runway: BudgetRunway, now: number): Array<{ t: number; value: number }> {
  const points: Array<{ t: number; value: number }> = [{ t: runway.weekStart, value: 0 }];
  const todayIndex = Math.max(
    0,
    Math.min(6, runway.days.findIndex((day) => day.dayStart === dayStartOf(now)))
  );
  for (let index = 0; index <= todayIndex; index += 1) {
    const day = runway.days[index];
    const at = index === todayIndex ? now : addLocalDays(day.dayStart, 1);
    const value = index === todayIndex ? runway.used : day.cumulative;
    // 周一一早 now 可能等于 dayStart，此时第一个点与起点重合——保留它，
    // 折线仍从零开始，不需要特判。
    points.push({ t: Math.max(at, runway.weekStart), value });
  }
  return points;
}

/** y 轴上界：预算、已用、预测终点都要落在图内，至少留 5% 头部空间。 */
export function runwayAxisMax(runway: BudgetRunway): number {
  const projected = runway.prediction?.total ?? runway.used;
  return Math.max(
    (runway.budget ?? 0) * 1.05,
    runway.used * 1.1,
    projected * 1.02,
    1
  );
}
