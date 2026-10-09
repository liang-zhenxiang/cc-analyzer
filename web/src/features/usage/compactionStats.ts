import type { CompactEvent } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * Pure aggregation behind the usage dashboard's compaction panel (J3, design
 * §4). The window follows the page's time-range control — the same local-day
 * crop as `aggregateRange`: a session straddling the edge contributes just its
 * in-window events.
 */

export type CompactionSessionSlice = {
  /** The scan's meta, when the input carried one — the top-3 rows reopen it. */
  session: SessionMeta | null;
  /** Display name, already resolved through `sessionTitle` (falls back to the
   * project label for hand-built inputs). */
  label: string;
  count: number;
  autoCount: number;
  manualCount: number;
  /** Σ (pre − post) over this session's in-window events with both numbers. */
  droppedTokens: number;
};

export type CompactionStats = {
  /** In-window compactions across all sessions. */
  count: number;
  autoCount: number;
  manualCount: number;
  /** Sessions that triggered at least one in-window compaction. */
  sessions: number;
  /**
   * Σ over every in-window event of (preTokens − postTokens).
   *
   * **Why not read `droppedTokens` (cumulativeDroppedTokens)?** It is already
   * cumulative *within one session*: summing it across events double-counts,
   * and summing the per-session maxima across sessions would still double-count
   * whenever several sessions compact. per-event pre − post is the only
   * additive quantity. Events missing pre/post contribute 0 — a partial sum
   * rather than a guess (data constraint 4: never re-sum a cumulative).
   */
  droppedTokens: number;
  /** Top sessions by dropped tokens, at most 3 (design §4). */
  topSessions: CompactionSessionSlice[];
};

export const COMPACTION_TOP_N = 3;

function inWindowEvents(
  sessions: readonly UsageSessionInput[],
  startTs: number
): Array<{ input: UsageSessionInput; events: CompactEvent[] }> {
  const result: Array<{ input: UsageSessionInput; events: CompactEvent[] }> = [];
  for (const input of sessions) {
    const events = (input.compactEvents ?? []).filter((event) => event.timestamp >= startTs);
    if (events.length > 0) result.push({ input, events });
  }
  return result;
}

/**
 * Windowed compaction aggregation. `trigger` is counted auto when verbatim
 * `"auto"`, manual otherwise (including null / a future value) — the same
 * split the session-side event bar uses, so the two never disagree.
 */
export function compactionStats(
  sessions: readonly UsageSessionInput[],
  days: number,
  now: number = Date.now()
): CompactionStats {
  const windowDays = Math.max(1, Math.floor(days));
  const startTs = addLocalDays(dayStartOf(now), -(windowDays - 1));

  const slices = inWindowEvents(sessions, startTs).map(({ input, events }) => {
    const autoCount = events.filter((event) => event.trigger === "auto").length;
    return {
      session: input.session ?? null,
      label: input.session ? sessionTitle(input.session) : input.projectLabel,
      count: events.length,
      autoCount,
      manualCount: events.length - autoCount,
      droppedTokens: events.reduce(
        (sum, event) =>
          event.preTokens !== null && event.postTokens !== null
            ? sum + (event.preTokens - event.postTokens)
            : sum,
        0
      )
    };
  });

  const count = slices.reduce((sum, slice) => sum + slice.count, 0);
  const autoCount = slices.reduce((sum, slice) => sum + slice.autoCount, 0);
  return {
    count,
    autoCount,
    manualCount: count - autoCount,
    sessions: slices.length,
    droppedTokens: slices.reduce((sum, slice) => sum + slice.droppedTokens, 0),
    topSessions: [...slices].sort((a, b) => b.droppedTokens - a.droppedTokens).slice(0, COMPACTION_TOP_N)
  };
}
