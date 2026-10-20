import type { ContextSample, SessionRecord } from "./types";
import type { LogRow } from "./logRows";
import { stripAnsi } from "../../lib/ansi";
import { formatDuration, formatTokenCount } from "../../lib/format";
import { estimateCost } from "../usage/pricingSnapshot";

/**
 * Pure data layer behind the replay view: one session flattened into a film.
 *
 * No React, no `Date.now()`, no I/O — every input is passed in. The view owns
 * the clock (`requestAnimationFrame`, visibility handling); this module only
 * answers "what does the film look like at real time T".
 *
 * Three readings the interface must not blur, and which this module keeps
 * apart on purpose:
 *
 * - **Wall clock, not "active duration".** `start`/`end` are the earliest and
 *   latest record timestamps. The session header's duration is a union of
 *   activity intervals; the two numbers differ by design, and the UI must say
 *   「墙钟」 when it prints this one.
 * - **Unknown is `null`, never `0`.** A cost that cannot be priced and a token
 *   count that was never recorded are both reported as missing (via
 *   `costUnknownEvents` / `eventsWithoutUsage`), not folded into a zero that
 *   reads like a measurement.
 * - **The playback head is not "the nearest event".** Between two events the
 *   frame names the pause (`gap`) and leaves `current` on the event that has
 *   actually happened; events ahead of the head are never counted in `passed`.
 */

export type ReplayKind =
  | "user"
  | "llm"
  | "tool"
  | "subagent"
  | "workflow"
  | "wait"
  | "compact";

/**
 * Playback time base.
 *
 * `"real"` maps wall-clock time linearly onto `progress`.
 *
 * `"compressed"` keeps the first `REPLAY_WARP_LEAD_MS` (90 s) at 1× and plays
 * everything after it at `REPLAY_WARP_RATE` (2% speed): a 47-minute session
 * spends 90 s on its first 90 s and 2% of its remaining wall clock on the rest.
 * The warp is a strictly increasing, continuous piecewise-linear function, so
 * `progressAt` and `realMsAt` are exact inverses.
 */
export type ReplayMode = "real" | "compressed";

/** Real milliseconds played at 1× before the compressed mode slows down. */
export const REPLAY_WARP_LEAD_MS = 90_000;
/** Speed after the lead-in: 0.02 means 2% of real time. */
export const REPLAY_WARP_RATE = 0.02;

/** A costliest-minute window is one minute wide, endpoints inclusive. */
const COSTLIEST_WINDOW_MS = 60_000;

export type ReplayEvent = {
  id: string;
  kind: ReplayKind;
  /** Real timestamp (ms) the event happened / started. */
  at: number;
  /**
   * Measured duration in ms, or `null` when the log carries no duration for
   * this kind of event. Zero is a measurement (an instant); `null` is not.
   */
  durationMs: number | null;
  /** Row label (`ROW_KIND_LABELS` vocabulary, plus merged labels). */
  label: string;
  /** Single-line, ANSI-free summary. */
  detail: string;
  isError: boolean;
  tokensPrompt: number;
  tokensOutput: number;
  /**
   * `null` when the pricing snapshot cannot price this event, **or** when the
   * event carries no token reading at all. The two are told apart by
   * `costUnknownEvents` and `eventsWithoutUsage`.
   */
  costUsd: number | null;
  rowId: string;
};

export type ReplayMarkKind =
  | "start"
  | "first-error"
  | "costliest-minute"
  | "longest-gap"
  | "compact";

export type ReplayMark = {
  id: string;
  kind: ReplayMarkKind;
  at: number;
  /** Default label in the log's vocabulary; the view may render its own copy. */
  label: string;
  /** Concrete numbers (tokens, duration) — never a claim the data cannot back. */
  detail: string;
};

export type ReplayTotals = {
  events: number;
  /** Tool-call events: `tool`, `subagent` and `workflow` kinds. */
  tools: number;
  errors: number;
  compactions: number;
  tokensPrompt: number;
  tokensOutput: number;
  /**
   * Sum of the **priced** events; `null` when not one event could be priced
   * (not "the cost is zero"). Unpriced events are excluded and counted in
   * `costUnknownEvents`.
   */
  costUsd: number | null;
  /** Events whose usage reading exists but whose model has no price. */
  costUnknownEvents: number;
  /**
   * Model-call events with **no usage reading at all** — the calls whose token
   * contribution is unknown rather than zero. User / tool / wait / compact
   * events are structurally usage-less and are not counted here: they never
   * had a reading to miss, and counting them would paint expected structure as
   * missing data.
   */
  eventsWithoutUsage: number;
};

export type ReplayFilm = {
  /**
   * Earliest log timestamp — the film's wall-clock start. Normally the first
   * record; a log-only boundary (a compact event the parser does not keep in
   * `records`) may extend it. See `filmSpan`.
   */
  start: number;
  /** Latest log timestamp — the film's wall-clock end. Same caveat as `start`. */
  end: number;
  /** Events in ascending `at` order (ties keep the row order). */
  events: ReplayEvent[];
  /** Landmarks, ascending by `at`, stable within one instant. */
  marks: ReplayMark[];
  totals: ReplayTotals;
  /**
   * Cumulative totals *through* each event (`cumulative[i]` includes
   * `events[i]`). Precomputed here so `frameAt` can stay O(log n) instead of
   * summing the prefix on every animation frame.
   */
  cumulative: ReplayTotals[];
};

export type ReplayFrame = {
  /**
   * Position on the film in `[0, 1]`. Zero-span films report `0` at every real
   * time (see `progressAt`); the view must render such a film without dividing
   * by a span.
   */
  progress: number;
  /** Playback head in real time (clamped to the film's wall-clock range). */
  at: number;
  /** Last event at or before the head; `null` before the first event. */
  current: ReplayEvent | null;
  /** The pause the head is inside, or `null` when it sits on an event. */
  gap: { start: number; end: number } | null;
  /** Totals of the events at or before the head. */
  passed: ReplayTotals;
  /** Last context sample at or before the head, `null` when none qualifies. */
  context: { tokens: number; at: number } | null;
};

/** Facts about one row that the public event shape would otherwise lose. */
type ReplayFacts = {
  event: ReplayEvent;
  hasUsage: boolean;
  hasModelCall: boolean;
};

function emptyTotals(): ReplayTotals {
  return {
    events: 0,
    tools: 0,
    errors: 0,
    compactions: 0,
    tokensPrompt: 0,
    tokensOutput: 0,
    costUsd: null,
    costUnknownEvents: 0,
    eventsWithoutUsage: 0
  };
}

function isToolKind(kind: ReplayKind): boolean {
  return kind === "tool" || kind === "subagent" || kind === "workflow";
}

/**
 * The row's measured duration. `LogRow.durationMs` is a number, so it cannot
 * tell "no measurement" from "measured zero" by itself; the row's structure
 * does:
 *
 * - synthesized wait rows carry their pause width in `gap`;
 * - compact band rows keep the boundary's own duration (which may be `null`);
 * - `na` rows (user prompts, compact bands) have no duration concept;
 * - activity rows keep their number, including a genuine `0`.
 */
function durationOfRow(row: LogRow): number | null {
  if (row.gap) return Math.max(0, row.gap.end - row.gap.start);
  if (row.compact) return row.compact.event.durationMs;
  if (row.status === "na") return null;
  return row.durationMs;
}

/** One-line, ANSI-free summary. `buildLogRows` already sanitises, but a hand-built row must not leak escapes into the stage. */
function detailOfRow(row: LogRow): string {
  return stripAnsi(row.summary).replace(/\s+/g, " ").trim();
}

function rowHasModelCall(row: LogRow): boolean {
  if (row.kind === "llm") return true;
  return row.records.some((record) => record.kind === "assistant");
}

/**
 * Prices one event from the exact four counters on its usage-bearing records.
 * `buildLogRows` keeps `row.records`, so the cache counters are still available
 * even though `row.tokens` only exposes prompt/output.
 *
 * All-or-nothing per event: if any usage-bearing record cannot be priced (no
 * model id or an unknown family), the event's cost is `null` rather than a
 * partial sum that would read as the whole truth.
 */
function costOfRow(row: LogRow): { hasUsage: boolean; pricedUsd: number | null } {
  let hasUsage = false;
  let pricedUsd = 0;
  for (const record of row.records) {
    const usage = record.usage;
    if (!usage) continue;
    hasUsage = true;
    if (!record.model) return { hasUsage, pricedUsd: null };
    const estimate = estimateCost(
      {
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
        cacheCreation: usage.cacheCreationTokens ?? 0,
        cacheRead: usage.cacheReadTokens ?? 0
      },
      record.model
    );
    if ("unknownModel" in estimate) return { hasUsage, pricedUsd: null };
    pricedUsd += estimate.usd;
  }
  return { hasUsage, pricedUsd: hasUsage ? pricedUsd : null };
}

function toFacts(row: LogRow): ReplayFacts {
  const cost = costOfRow(row);
  const hasModelCall = rowHasModelCall(row);
  return {
    hasUsage: cost.hasUsage,
    hasModelCall,
    event: {
      id: row.id,
      kind: row.kind,
      at: row.timestamp,
      durationMs: durationOfRow(row),
      label: row.label,
      detail: detailOfRow(row),
      isError: row.status === "error",
      tokensPrompt: row.tokens?.prompt ?? 0,
      tokensOutput: row.tokens?.output ?? 0,
      costUsd: cost.pricedUsd,
      rowId: row.id
    }
  };
}

/**
 * Wall-clock span: earliest → latest log timestamp.
 *
 * Records normally define it (R2 rule 1) and win because row synthesis moves
 * timestamps around (gap rows are trimmed to the previous activity, merged
 * LLM+tool rows reach back to their response start). But a compact boundary is
 * a log record the parser consumes into `compactEvents` — it is *not* in
 * `records`, and when it is the last line of the file it would fall outside a
 * records-only span and could never be played. So events may extend the span;
 * in the common case they sit inside it and the records alone are the answer.
 *
 * An empty film is `0 → 0`.
 */
function filmSpan(
  records: readonly SessionRecord[],
  events: readonly ReplayEvent[]
): { start: number; end: number } {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  const consider = (timestamp: number) => {
    if (!Number.isFinite(timestamp)) return;
    if (timestamp < start) start = timestamp;
    if (timestamp > end) end = timestamp;
  };
  for (const record of records) consider(record.timestamp);
  for (const event of events) consider(event.at);
  if (start === Number.POSITIVE_INFINITY) return { start: 0, end: 0 };
  return { start, end };
}

/** Finds the first index whose `at` is greater than `value` (upper bound). */
function upperBoundEventAt(events: readonly ReplayEvent[], value: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (events[mid].at <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function addEventTotals(
  running: ReplayTotals,
  event: ReplayEvent,
  facts: ReplayFacts
): ReplayTotals {
  const priced = event.costUsd;
  return {
    events: running.events + 1,
    tools: running.tools + (isToolKind(event.kind) ? 1 : 0),
    errors: running.errors + (event.isError ? 1 : 0),
    compactions: running.compactions + (event.kind === "compact" ? 1 : 0),
    tokensPrompt: running.tokensPrompt + event.tokensPrompt,
    tokensOutput: running.tokensOutput + event.tokensOutput,
    costUsd:
      running.costUsd === null && priced === null
        ? null
        : (running.costUsd ?? 0) + (priced ?? 0),
    costUnknownEvents:
      running.costUnknownEvents + (facts.hasUsage && priced === null ? 1 : 0),
    eventsWithoutUsage:
      running.eventsWithoutUsage + (facts.hasModelCall && !facts.hasUsage ? 1 : 0)
  };
}

/** Stable mark rank within one instant: start → compact → error → everything else. */
const MARK_RANK: Record<ReplayMarkKind, number> = {
  start: 0,
  compact: 1,
  "first-error": 2,
  "costliest-minute": 3,
  "longest-gap": 3
};

/**
 * The busiest minute: the 60-second window starting at each event, endpoints
 * included. Ties go to the earlier start (`>` not `>=`). Token volume is
 * prompt + output — the two counters a row exposes.
 *
 * No mark is produced when no event has a positive reading: every window would
 * tie at zero, and a 「最烧一分钟」 pointing at a zero is a claim the data does
 * not support.
 */
function costliestMinute(events: readonly ReplayEvent[]): ReplayMark | null {
  if (events.length === 0) return null;
  const prefix = new Array<number>(events.length + 1);
  prefix[0] = 0;
  for (let index = 0; index < events.length; index += 1) {
    prefix[index + 1] =
      prefix[index] + events[index].tokensPrompt + events[index].tokensOutput;
  }

  let bestSum = 0;
  let bestIndex = -1;
  let bestCount = 0;
  for (let index = 0; index < events.length; index += 1) {
    const end = upperBoundEventAt(events, events[index].at + COSTLIEST_WINDOW_MS);
    const sum = prefix[end] - prefix[index];
    if (sum > bestSum) {
      bestSum = sum;
      bestIndex = index;
      bestCount = end - index;
    }
  }
  if (bestIndex < 0) return null;

  const at = events[bestIndex].at;
  return {
    id: "costliest-minute",
    kind: "costliest-minute",
    at,
    label: "最烧一分钟",
    detail: `${formatTokenCount(bestSum)} tok · ${bestCount} 个事件`
  };
}

/**
 * Largest gap between adjacent event timestamps, tie to the earlier pair. A
 * single event has no adjacent pair, and a zero-width "gap" is not a pause, so
 * neither produces a mark.
 */
function longestGap(events: readonly ReplayEvent[]): ReplayMark | null {
  let bestGap = 0;
  let bestIndex = -1;
  for (let index = 0; index + 1 < events.length; index += 1) {
    const gap = events[index + 1].at - events[index].at;
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  }
  if (bestIndex < 0) return null;
  return {
    id: "longest-gap",
    kind: "longest-gap",
    at: events[bestIndex].at,
    label: "最长停顿",
    detail: formatDuration(bestGap)
  };
}

function buildMarks(events: readonly ReplayEvent[], start: number, end: number): ReplayMark[] {
  if (events.length === 0) return [];

  const entries: Array<{ mark: ReplayMark; order: number }> = [];
  const push = (mark: ReplayMark) => entries.push({ mark, order: entries.length });

  push({
    id: "start",
    kind: "start",
    at: start,
    label: "起点",
    detail: `${formatDuration(Math.max(0, end - start))} · ${events.length} 个事件`
  });

  const firstError = events.find((event) => event.isError);
  if (firstError) {
    const detail = firstError.detail
      ? `${firstError.label} · ${firstError.detail}`
      : firstError.label;
    push({
      id: "first-error",
      kind: "first-error",
      at: firstError.at,
      label: "首次失败",
      detail
    });
  }

  const costliest = costliestMinute(events);
  if (costliest) push(costliest);

  const gap = longestGap(events);
  if (gap) push(gap);

  let compactOrdinal = 0;
  for (const event of events) {
    if (event.kind !== "compact") continue;
    compactOrdinal += 1;
    push({
      id: `compact:${event.id}`,
      kind: "compact",
      at: event.at,
      label: `压缩 #${compactOrdinal}`,
      detail: event.detail
    });
  }

  return entries
    .sort(
      (a, b) =>
        a.mark.at - b.mark.at ||
        MARK_RANK[a.mark.kind] - MARK_RANK[b.mark.kind] ||
        a.order - b.order
    )
    .map((entry) => entry.mark);
}

/**
 * Builds the film from the log rows (already duration-attributed, compact
 * bands included) and the session's records (for the wall-clock span).
 *
 * Rows are re-sorted defensively: `buildLogRows` sorts before duration
 * attribution, and that pass can push a synthesized wait row later, so the
 * returned array is not guaranteed to be ascending. The sort is stable on the
 * original order, so simultaneous events keep the log's own sequence.
 */
export function buildReplayFilm(
  rows: readonly LogRow[],
  records: readonly SessionRecord[]
): ReplayFilm {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => a.row.timestamp - b.row.timestamp || a.index - b.index)
    .map((entry) => entry.row);

  const facts = ordered.map(toFacts);
  const events = facts.map((fact) => fact.event);
  const { start, end } = filmSpan(records, events);

  const cumulative: ReplayTotals[] = [];
  let running = emptyTotals();
  for (const fact of facts) {
    running = addEventTotals(running, fact.event, fact);
    cumulative.push(running);
  }

  const totals =
    cumulative.length > 0 ? { ...cumulative[cumulative.length - 1] } : emptyTotals();

  return { start, end, events, marks: buildMarks(events, start, end), totals, cumulative };
}

/** Forward warp: real elapsed ms → compressed elapsed ms. */
function warp(elapsedMs: number): number {
  if (elapsedMs <= REPLAY_WARP_LEAD_MS) return elapsedMs;
  return (
    REPLAY_WARP_LEAD_MS + (elapsedMs - REPLAY_WARP_LEAD_MS) * REPLAY_WARP_RATE
  );
}

/** Inverse warp: compressed elapsed ms → real elapsed ms. */
function unwarp(elapsedMs: number): number {
  if (elapsedMs <= REPLAY_WARP_LEAD_MS) return elapsedMs;
  return (
    REPLAY_WARP_LEAD_MS + (elapsedMs - REPLAY_WARP_LEAD_MS) / REPLAY_WARP_RATE
  );
}

function spanOf(film: ReplayFilm): number {
  return film.end - film.start;
}

/**
 * Real time → progress in `[0, 1]`.
 *
 * A zero-span film (all records at one instant, or an empty film) always
 * reports `0`: there is no distance to have travelled, and `0` is the one
 * progress value that cannot be mistaken for a travelled fraction.
 */
export function progressAt(film: ReplayFilm, realMs: number, mode: ReplayMode): number {
  const span = spanOf(film);
  if (!(span > 0)) return 0;
  const position = Number.isNaN(realMs) ? film.start : realMs;
  const elapsed = Math.min(Math.max(position - film.start, 0), span);
  if (mode === "compressed") {
    const total = warp(span);
    return total > 0 ? warp(elapsed) / total : 0;
  }
  return elapsed / span;
}

/**
 * Progress → real time. This is the exact inverse of `progressAt`: it unwraps
 * the same piecewise-linear curve and the same clamping. A zero-span film maps
 * every progress to its single instant (`start === end`).
 */
export function realMsAt(film: ReplayFilm, progress: number, mode: ReplayMode): number {
  const span = spanOf(film);
  if (!(span > 0)) return film.start;
  const target = Number.isNaN(progress) ? 0 : progress;
  const clamped = Math.min(Math.max(target, 0), 1);
  if (mode === "compressed") {
    return film.start + unwarp(clamped * warp(span));
  }
  return film.start + clamped * span;
}

/** Index of the last sample with `timestamp <= at`; -1 when none qualifies. */
function lastSampleIndexAtOrBefore(
  samples: readonly ContextSample[],
  at: number
): number {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].timestamp <= at) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

/**
 * The frame at a real timestamp.
 *
 * `samples` must be ascending by timestamp — `contextSeriesOf` already returns
 * them that way; this function binary-searches instead of sorting, because it
 * runs once per animation frame.
 *
 * `mode` only changes the reported `progress` (the frame's content is a
 * function of real time alone). Pass the playback mode so the head the view
 * paints and `frame.progress` stay on the same clock; the default `"real"`
 * keeps the three-argument signature from the spec working.
 */
export function frameAt(
  film: ReplayFilm,
  realMs: number,
  samples: readonly ContextSample[],
  mode: ReplayMode = "real"
): ReplayFrame {
  const at = Number.isNaN(realMs)
    ? film.start
    : Math.min(Math.max(realMs, film.start), film.end);
  const index = upperBoundEventAt(film.events, at) - 1;
  const current = index >= 0 ? film.events[index] : null;
  const passed = index >= 0 ? { ...film.cumulative[index] } : emptyTotals();

  let gap: ReplayFrame["gap"] = null;
  if (current && at > current.at && index + 1 < film.events.length) {
    gap = { start: current.at, end: film.events[index + 1].at };
  }

  const sampleIndex = lastSampleIndexAtOrBefore(samples, at);
  const context =
    sampleIndex >= 0
      ? { tokens: samples[sampleIndex].contextTokens, at: samples[sampleIndex].timestamp }
      : null;

  return {
    progress: progressAt(film, at, mode),
    at,
    current,
    gap,
    passed,
    context
  };
}
