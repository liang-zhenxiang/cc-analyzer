import type { SessionUsage } from "../sessions/types";
import {
  addLocalDays,
  dayStartOf,
  totalsSum,
  UNKNOWN_MODEL_LABEL,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 项目擂台的纯逻辑：窗口内的「按天 × 按项目」token 序列，口径与
 * `aggregateRange` 逐条对齐——本地日切日、窗口含今天、只算落在窗口里的记录。
 *
 * 与 `aggregateRange` 的唯一区别是这里不折叠 Top-N：擂台要比的是两个**具体**
 * 项目，折进「其他」就没有意义了。
 */

export function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

export function addUsage(target: UsageTotals, usage: SessionUsage): void {
  target.input += usage.inputTokens ?? 0;
  target.output += usage.outputTokens ?? 0;
  target.cacheCreation += usage.cacheCreationTokens ?? 0;
  target.cacheRead += usage.cacheReadTokens ?? 0;
}

/** The four counters summed — the same headline figure the dashboard uses. */
export function usageTokens(usage: SessionUsage): number {
  const totals = emptyTotals();
  addUsage(totals, usage);
  return totalsSum(totals);
}

/**
 * The window's local day keys, oldest first. `days` counts today as one of its
 * own days (7 天 = 今天 + 前 6 天), exactly like `aggregateRange`.
 */
export function windowDayStarts(days: number, now: number = Date.now()): number[] {
  const windowDays = Math.max(1, Math.floor(days));
  const todayStart = dayStartOf(now);
  const startTs = addLocalDays(todayStart, -(windowDays - 1));
  const out: number[] = [];
  for (let dayStart = startTs; dayStart <= todayStart; dayStart = addLocalDays(dayStart, 1)) {
    out.push(dayStart);
  }
  return out;
}

export type ProjectDaily = {
  days: { dayStart: number }[];
  a: number[];
  b: number[];
};

/**
 * Splits the window's daily token series into two projects.
 *
 * Records are attributed by their **own** local day (a session spanning
 * midnight lands on two bars), and a record without `usage` contributes zero —
 * the same treatment `aggregateSession` gives it.
 */
export function buildProjectDaily(
  inputs: readonly UsageSessionInput[],
  days: number,
  labelA: string,
  labelB: string,
  now: number = Date.now()
): ProjectDaily {
  const dayStarts = windowDayStarts(days, now);
  const indexOfDay = new Map(dayStarts.map((dayStart, index) => [dayStart, index]));
  const a = dayStarts.map(() => 0);
  const b = dayStarts.map(() => 0);
  const startTs = dayStarts[0] ?? 0;

  for (const input of inputs) {
    // The UI disables picking the same project twice; if a caller does it
    // anyway, A wins the row rather than double-counting into both sides.
    const target =
      input.projectLabel === labelA ? a : input.projectLabel === labelB ? b : null;
    if (!target) continue;

    for (const record of input.records) {
      if (record.timestamp < startTs) continue;
      const usage = record.usage;
      if (!usage) continue;
      const index = indexOfDay.get(dayStartOf(record.timestamp));
      if (index === undefined) continue;
      target[index] += usageTokens(usage);
    }
  }

  return { days: dayStarts.map((dayStart) => ({ dayStart })), a, b };
}

export type ArenaSide = {
  /** Window total across the daily bars. */
  total: number;
  /** Total ÷ number of days in the window (zero days included). */
  average: number;
  /** The largest single day. */
  peak: number;
  /** Index of that day, or -1 when every bar is zero. */
  peakDay: number;
};

export function arenaSideOf(daily: readonly number[]): ArenaSide {
  let total = 0;
  let peak = 0;
  let peakDay = -1;
  daily.forEach((value, index) => {
    total += value;
    if (value > peak) {
      peak = value;
      peakDay = index;
    }
  });
  return { total, average: daily.length > 0 ? total / daily.length : 0, peak, peakDay };
}

export type MainModel = {
  model: string | null;
  tokens: number;
};

/**
 * The project's dominant model in the window, by four-counter token sum.
 *
 * Ties break on the raw id so two equally-sized models always resolve the same
 * way (a chart that flickers between them on re-scan is worse than either).
 * Records without `usage` cannot vote; a usage-carrying record without a model
 * votes for `UNKNOWN_MODEL_LABEL`, matching the dashboard's legend.
 */
export function mainModelOf(
  inputs: readonly UsageSessionInput[],
  days: number,
  label: string,
  now: number = Date.now()
): MainModel {
  const dayStarts = windowDayStarts(days, now);
  const startTs = dayStarts[0] ?? 0;
  const byModel = new Map<string, UsageTotals>();

  for (const input of inputs) {
    if (input.projectLabel !== label) continue;
    for (const record of input.records) {
      if (record.timestamp < startTs) continue;
      const usage = record.usage;
      if (!usage) continue;
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      let totals = byModel.get(model);
      if (!totals) {
        totals = emptyTotals();
        byModel.set(model, totals);
      }
      addUsage(totals, usage);
    }
  }

  let best: MainModel = { model: null, tokens: -1 };
  for (const [model, totals] of byModel) {
    const tokens = totalsSum(totals);
    if (
      tokens > best.tokens ||
      (tokens === best.tokens && best.model !== null && model < best.model)
    ) {
      best = { model, tokens };
    }
  }
  return best.model === null ? { model: null, tokens: 0 } : best;
}
