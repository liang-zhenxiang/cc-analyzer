import type { SessionRecord } from "../sessions/types";
import { dayStartOf, totalsSum, type UsageTotals } from "./usageAggregations";

/**
 * The subscription's second limit layer: a **rolling 7-day** consumption
 * window. Local logs cannot reveal Anthropic's official weekly reset moment,
 * so this module computes the one thing that can be stated exactly — the sum
 * over `(now - 7d, now]` — and compares it against an optional, user-set
 * budget. There is no `resetAt` field here on purpose: an unknown fact gets
 * no placeholder.
 */
export const WEEKLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fewer distinct active days than this and the daily mean describes one
 * sitting rather than the week — the same honesty rule as the 5h window's
 * `MIN_SAMPLE_MS`, scaled to a 7-day sample: extrapolating from a single
 * active day would just multiply a spike by seven.
 */
export const MIN_ACTIVE_DAYS = 2;

/** Deliberately has no reset field: the official weekly reset is unknowable from logs. */
export type WeeklyWindow = {
  /** Rolling 7 days `(now - 7d, now]` — exact, read from the log. */
  consumed: UsageTotals;
  /** The preceding 7 days `(now - 14d, now - 7d]`, for the period-over-period readout. */
  previousConsumed: UsageTotals;
  /** Distinct local days inside the window that carried usage records. */
  activeDays: number;
  /** The optional, user-set denominator; `null` means "no percentage anywhere". */
  limitTokens: number | null;
};

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/**
 * Sums usage-carrying records into the rolling window and its predecessor.
 * Boundaries are **absolute milliseconds** on purpose: across a DST
 * transition a calendar week is 167 or 169 hours, and deriving the boundary
 * by calendar-day arithmetic would let the window drift by an hour twice a
 * year. `dayStartOf` is only used to count active days, where the local
 * calendar day is the honest unit.
 */
export function weeklyWindow(
  records: readonly SessionRecord[],
  limitTokens: number | null,
  now: number = Date.now()
): WeeklyWindow {
  const consumed = emptyTotals();
  const previousConsumed = emptyTotals();
  const activeDays = new Set<number>();
  const windowStart = now - WEEKLY_WINDOW_MS;
  const previousStart = now - 2 * WEEKLY_WINDOW_MS;

  for (const record of records) {
    const usage = record.usage;
    // Only usage-carrying records meter anything — same rule as billing blocks.
    if (!usage) continue;
    const at = record.timestamp;
    if (at > windowStart && at <= now) {
      consumed.input += usage.inputTokens ?? 0;
      consumed.output += usage.outputTokens ?? 0;
      consumed.cacheCreation += usage.cacheCreationTokens ?? 0;
      consumed.cacheRead += usage.cacheReadTokens ?? 0;
      activeDays.add(dayStartOf(at));
    } else if (at > previousStart && at <= windowStart) {
      previousConsumed.input += usage.inputTokens ?? 0;
      previousConsumed.output += usage.outputTokens ?? 0;
      previousConsumed.cacheCreation += usage.cacheCreationTokens ?? 0;
      previousConsumed.cacheRead += usage.cacheReadTokens ?? 0;
    }
  }

  return { consumed, previousConsumed, activeDays: activeDays.size, limitTokens };
}

/** Same shape as the 5h window's `LimitPrediction`, at weekly granularity. */
export type WeeklyLimitPrediction =
  | { reachAt: number; tokensPerDay: number }
  | { insufficientSample: true }
  | { noLimit: true };

/**
 * When the user-set budget will be reached at the rolling week's daily mean.
 * The mean divides by the full 7 days — idle days inside the window are part
 * of the observed pace, not noise to be divided out.
 */
export function predictWeeklyLimitReach(
  window: WeeklyWindow,
  now: number = Date.now()
): WeeklyLimitPrediction {
  const { limitTokens } = window;
  if (limitTokens === null || limitTokens <= 0) return { noLimit: true };
  if (window.activeDays < MIN_ACTIVE_DAYS) return { insufficientSample: true };
  const consumed = totalsSum(window.consumed);
  // A zero-consumption week (all-zero usage objects) would divide by zero and
  // claim "never reached"; an empty week says nothing about the pace ahead.
  if (consumed <= 0) return { insufficientSample: true };
  const tokensPerDay = consumed / 7;
  const remaining = limitTokens - consumed;
  if (remaining <= 0) return { reachAt: now, tokensPerDay };
  return { reachAt: now + (remaining / tokensPerDay) * 86_400_000, tokensPerDay };
}
