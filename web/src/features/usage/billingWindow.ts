import type { SessionRecord } from "../sessions/types";
import { totalsSum, type UsageTotals } from "./usageAggregations";

/**
 * Claude Code's billing windows ("blocks" in ccusage's vocabulary): usage is
 * metered in ~5-hour windows that start with the first activity after the
 * previous window closed — a session does not renew mid-block, and a gap does
 * not close a block early. Rule (ccusage `blocks`, non-consecutive variant):
 *
 *   the first record starts a block [T, T + 5h); every record whose timestamp
 *   falls inside joins it; the first record at or after T + 5h starts the next.
 *
 * All of this is derived from local log timestamps — no network, no official
 * API — which is exactly why every derived figure must carry provenance.
 */
export const BILLING_WINDOW_MS = 5 * 60 * 60 * 1000;

export type BillingBlock = {
  start: number;
  /** Exclusive: `start + 5h`. */
  end: number;
  totals: UsageTotals;
  messages: number;
};

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/**
 * Clusters records into billing blocks. Input must be sorted by timestamp
 * (parser output is); a single pass keeps it O(n).
 */
export function clusterBillingBlocks(
  records: readonly SessionRecord[]
): BillingBlock[] {
  const blocks: BillingBlock[] = [];
  for (const record of records) {
    const last = blocks[blocks.length - 1];
    if (!last || record.timestamp >= last.end) {
      blocks.push({
        start: record.timestamp,
        end: record.timestamp + BILLING_WINDOW_MS,
        totals: emptyTotals(),
        messages: 0
      });
    }
    const block = blocks[blocks.length - 1];
    block.messages += 1;
    const usage = record.usage;
    if (usage) {
      block.totals.input += usage.inputTokens ?? 0;
      block.totals.output += usage.outputTokens ?? 0;
      block.totals.cacheCreation += usage.cacheCreationTokens ?? 0;
      block.totals.cacheRead += usage.cacheReadTokens ?? 0;
    }
  }
  return blocks;
}

/** The block whose window covers `now`, if any — the dashboard's headline. */
export function currentBlock(
  blocks: readonly BillingBlock[],
  now: number
): BillingBlock | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    // The latest block wins even if `now` is past its end: the window has
    // closed but the meter reading is still "what that block consumed".
    if (now >= block.start) return block;
  }
  return null;
}

/**
 * Average burn over the block's elapsed span. Sample honesty: a block with
 * less than `MIN_SAMPLE_MS` of elapsed time produces a rate that says more
 * about startup spikes than about the afternoon ahead, so it reports
 * `insufficientSample` and the UI must say so instead of extrapolating.
 */
export const MIN_SAMPLE_MS = 30 * 60 * 1000;

export type BurnRate =
  | { tokensPerHour: number; elapsedMs: number }
  | { insufficientSample: true };

export function burnRateOf(
  block: BillingBlock,
  now: number = Date.now()
): BurnRate {
  const elapsedMs = Math.max(0, Math.min(now, block.end) - block.start);
  if (elapsedMs < MIN_SAMPLE_MS) return { insufficientSample: true };
  return {
    tokensPerHour: (totalsSum(block.totals) / elapsedMs) * 3_600_000,
    elapsedMs
  };
}

/**
 * When the plan limit will be reached at the current rate, as a concrete
 * timestamp — monitor users' loudest complaint was getting a duration ("2h
 * left") with no clock time to anchor it to.
 */
export type LimitPrediction =
  | { reachAt: number; tokensPerHour: number }
  | { insufficientSample: true }
  | { noLimit: true };

export function predictLimitReach(
  block: BillingBlock,
  limitTokens: number | null,
  now: number = Date.now()
): LimitPrediction {
  if (limitTokens === null || limitTokens <= 0) return { noLimit: true };
  const rate = burnRateOf(block, now);
  if ("insufficientSample" in rate) return { insufficientSample: true };
  const consumed = totalsSum(block.totals);
  const remaining = limitTokens - consumed;
  if (remaining <= 0) return { reachAt: now, tokensPerHour: rate.tokensPerHour };
  return {
    reachAt: now + (remaining / rate.tokensPerHour) * 3_600_000,
    tokensPerHour: rate.tokensPerHour
  };
}
