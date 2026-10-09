import type { CompactEvent, ContextSample, SessionRecord } from "./types";

/**
 * Per-call context-size series: one sample per assistant record that carries a
 * `usage` object, in ascending timestamp order. `contextTokens` is the whole
 * prompt that call fed the model — input + cache creation + cache read; a
 * missing counter is a zero per `SessionUsage`, not an unknown.
 *
 * After a compaction the series should drop from the `preTokens` magnitude to
 * the `postTokens` magnitude; that cliff is the story J2 draws from this data.
 */
export function contextSeriesOf(records: readonly SessionRecord[]): ContextSample[] {
  return records
    .filter((record) => record.kind === "assistant" && record.usage !== undefined)
    .map((record) => ({
      uuid: record.fullId,
      timestamp: record.timestamp,
      contextTokens:
        (record.usage?.inputTokens ?? 0) +
        (record.usage?.cacheReadTokens ?? 0) +
        (record.usage?.cacheCreationTokens ?? 0),
      outputTokens: record.usage?.outputTokens ?? 0,
      model: record.model ?? null
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export type CompactionAnchor = {
  eventId: string;
  /**
   * Sample index of the last pre-compaction call; -1 when the compaction
   * precedes every sample or nothing locates it.
   */
  beforeIndex: number;
  /** Sample index of the first post-compaction call; `samples.length` when none follows. */
  afterIndex: number;
};

/**
 * Locates each compact event on the context series. The boundary's
 * `logicalParentUuid` names the last message before compaction, so the sample
 * carrying that uuid is the cliff edge. When that message is not a sample (it
 * was a user message, or carried no usage) the boundary timestamp takes over:
 * the last sample at or before it becomes the edge.
 */
export function compactionAnchors(
  samples: readonly ContextSample[],
  events: readonly CompactEvent[]
): CompactionAnchor[] {
  return events.map((event) => {
    let beforeIndex = -1;
    if (event.logicalParentUuid !== null) {
      beforeIndex = samples.findIndex((sample) => sample.uuid === event.logicalParentUuid);
    }
    if (beforeIndex < 0) {
      beforeIndex = lastSampleAtOrBefore(samples, event.timestamp);
    }
    return { eventId: event.id, beforeIndex, afterIndex: beforeIndex + 1 };
  });
}

/** Index of the last sample whose timestamp is <= `ts`; -1 when none qualifies. */
function lastSampleAtOrBefore(samples: readonly ContextSample[], ts: number): number {
  let index = -1;
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].timestamp > ts) break;
    index = i;
  }
  return index;
}
