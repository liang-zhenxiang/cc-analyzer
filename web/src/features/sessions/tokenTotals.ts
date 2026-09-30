import type { SessionRecord, SessionUsage } from "./types";

/**
 * The four token counters Claude Code records, kept apart.
 *
 * They are never folded into one "total tokens" figure: in real sessions
 * `cache_read` runs an order of magnitude above `input` and three above
 * `output`, and their sum describes nothing a reader could act on. `total`
 * exists only as the denominator behind the share column, and is never shown.
 *
 * These counts are read straight from the log — no estimate, no external
 * input — which is the whole reason they are worth trusting.
 */
export type TokenTotals = {
  input: number;
  cacheCreation: number;
  /** The `cache_creation` TTL split; `fiveMinute + oneHour === cacheCreation`. */
  cacheCreationFiveMinute: number;
  cacheCreationOneHour: number;
  cacheRead: number;
  output: number;
  /** Sum of the four counters — the share denominator, never displayed. */
  total: number;
};

function emptyTotals(): TokenTotals {
  return {
    input: 0,
    cacheCreation: 0,
    cacheCreationFiveMinute: 0,
    cacheCreationOneHour: 0,
    cacheRead: 0,
    output: 0,
    total: 0
  };
}

/**
 * Splits one call's cache writes into the 5-minute and 1-hour tiers.
 *
 * Claude Code omits `cache_creation.ephemeral_*` whenever the call wrote no
 * cache, so a missing sub-object is a zero rather than an unknown. Anything the
 * TTL split does not account for is attributed to the 5-minute tier — the API
 * default, and the fallback the ecosystem uses — so the two buckets always add
 * up to `cacheCreation`, and no cache write can quietly fall out of the report.
 */
export function splitCacheCreation(
  usage: SessionUsage,
  cacheCreation: number
): { fiveMinute: number; oneHour: number } {
  const fiveMinute = usage.cacheCreationFiveMinuteTokens ?? 0;
  const oneHour = usage.cacheCreationOneHourTokens ?? 0;
  const residual = cacheCreation - fiveMinute - oneHour;
  return {
    fiveMinute: fiveMinute + Math.max(0, residual),
    oneHour
  };
}

/**
 * Totals one session's records. Records are already de-duplicated by
 * `message.id` in the parser, so this is a straight sum — summing raw
 * assistant lines instead would over-count output and cache reads several-fold.
 */
export function tokenTotalsOf(records: readonly SessionRecord[]): TokenTotals {
  const totals = emptyTotals();
  for (const record of records) {
    const usage = record.usage;
    if (!usage) continue;
    const cacheCreation = usage.cacheCreationTokens ?? 0;
    const split = splitCacheCreation(usage, cacheCreation);
    totals.input += usage.inputTokens ?? 0;
    totals.cacheCreation += cacheCreation;
    totals.cacheCreationFiveMinute += split.fiveMinute;
    totals.cacheCreationOneHour += split.oneHour;
    totals.cacheRead += usage.cacheReadTokens ?? 0;
    totals.output += usage.outputTokens ?? 0;
  }
  totals.total =
    totals.input + totals.cacheCreation + totals.cacheRead + totals.output;
  return totals;
}

/** Share of the four counters, as a percentage; `null` when there is nothing to divide. */
export function shareOf(value: number, totals: TokenTotals): number | null {
  if (totals.total <= 0) return null;
  return (value / totals.total) * 100;
}
