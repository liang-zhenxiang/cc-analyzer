import type { SessionRecord, SessionUsage, CompactEvent } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { tokenTotalsOf } from "../sessions/tokenTotals";

/**
 * Pure aggregation over parsed sessions: the usage dashboard's whole data
 * model. Tokens are always the four counters Claude Code records, never one
 * folded number (same stance as `tokenTotals.ts`).
 *
 * Day buckets follow the **local calendar day** of each record's timestamp —
 * the user's "today", not UTC — and a session spanning midnight attributes
 * each record to the day it happened on, per design.md §3.
 */

/** The four token counters the dashboard aggregates. */
export type UsageTotals = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
};

/** Per local day: token totals plus the messages that landed on that day. */
export type DayBucket = UsageTotals & { messages: number };

/** Per model: token totals plus the priced calls that used it. */
export type ModelBucket = UsageTotals & { messages: number };

/** Per project label: token totals plus the sessions attributed to it. */
export type ProjectBucket = UsageTotals & { sessions: number };

/**
 * Mergeable aggregate. `hourly` is indexed `[getDay()][hour]` — 0 = Sunday,
 * matching `Date.getDay()` — so no conversion happens between parsing and
 * aggregating; the heatmap reorders rows for display only.
 */
export type UsageAggregate = {
  sessionCount: number;
  messages: number;
  totals: UsageTotals;
  daily: Map<number, DayBucket>;
  models: Map<string, ModelBucket>;
  projects: Map<string, ProjectBucket>;
  hourly: number[][];
};

/** One session's contribution; the project label lives at session level. */
export type UsageSessionInput = {
  records: readonly SessionRecord[];
  projectLabel: string;
  /**
   * The session's actual working directory, when the log carried one. Buckets
   * stay keyed by `projectLabel` (the encoded directory name); this is carried
   * alongside so the view can print a real project name instead of the
   * identifier — see `formatProjectPath`.
   */
  projectPath?: string;
  /**
   * Compact boundaries from this session's log (J1), carried for the
   * compaction panel (J3) — `aggregateSessionInput` itself ignores them; the
   * windowed `compactionStats` reads them separately.
   */
  compactEvents?: readonly CompactEvent[];
  /**
   * The scan's `SessionMeta` for this session, when the input came from a real
   * scan (hand-built fakes in tests omit it). The compaction panel's top-3 rows
   * need it to reopen the session in the analyzer.
   */
  session?: SessionMeta;
};

/** A day series point, zero-filled when nothing happened that day. */
export type DailyPoint = DayBucket & { dayStart: number };

/** One slice of a Top-N distribution (`其他` folds the tail). */
export type UsageSlice = { label: string; value: number };

export type UsageKpi = {
  sessions: number;
  messages: number;
  /** Sum of the four counters — the KPI headline figure. */
  tokens: number;
};

export type RangeAggregate = UsageAggregate & {
  dailySeries: DailyPoint[];
  topProjects: UsageSlice[];
  topModels: UsageSlice[];
  kpi: UsageKpi;
};

export const UNKNOWN_MODEL_LABEL = "未知模型";
export const OTHER_LABEL = "其他";
export const DEFAULT_TOP_N = 6;

/** Local midnight of the given timestamp, used as the canonical day key. */
export function dayStartOf(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Adds calendar days to a local day key (DST-safe: via date components). */
export function addLocalDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

/**
 * Short axis label for a day key, e.g. `9/28`. The slash is deliberate: the
 * dashboard's other axis is wall-clock (`18:05`, a billing window's start), and
 * `9-28` next to it reads like a score rather than a date.
 */
export function formatDayLabel(dayStart: number): string {
  const date = new Date(dayStart);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function totalsSum(totals: UsageTotals): number {
  return totals.input + totals.output + totals.cacheCreation + totals.cacheRead;
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

function emptyHourly(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

export function emptyAggregate(): UsageAggregate {
  return {
    sessionCount: 0,
    messages: 0,
    totals: emptyTotals(),
    daily: new Map(),
    models: new Map(),
    projects: new Map(),
    hourly: emptyHourly()
  };
}

function addUsage(target: UsageTotals, usage: SessionUsage): void {
  target.input += usage.inputTokens ?? 0;
  target.output += usage.outputTokens ?? 0;
  target.cacheCreation += usage.cacheCreationTokens ?? 0;
  target.cacheRead += usage.cacheReadTokens ?? 0;
}

/** Adds one `UsageTotals` into another — the merge-side counterpart of `addUsage`. */
function addTotals(target: UsageTotals, source: UsageTotals): void {
  target.input += source.input;
  target.output += source.output;
  target.cacheCreation += source.cacheCreation;
  target.cacheRead += source.cacheRead;
}

/**
 * Session-level totals reuse `tokenTotalsOf` — the same battle-tested sum the
 * TokenPanel shows — so the dashboard and the per-session panel can never
 * disagree about what one session consumed.
 */
function sessionTotals(records: readonly SessionRecord[]): UsageTotals {
  const totals = tokenTotalsOf(records);
  return {
    input: totals.input,
    output: totals.output,
    cacheCreation: totals.cacheCreation,
    cacheRead: totals.cacheRead
  };
}

/**
 * Aggregates one session's records. `messages` counts user + assistant
 * records (conversation activity), excluding compact summaries; usage is read
 * from any record carrying a `usage` object — the parser only attaches it to
 * assistant records — and is bucketed by that record's own local day and model.
 */
export function aggregateSession(records: readonly SessionRecord[]): UsageAggregate {
  const aggregate = emptyAggregate();
  aggregate.sessionCount = 1;
  aggregate.totals = sessionTotals(records);

  for (const record of records) {
    if (record.kind !== "user" && record.kind !== "assistant") continue;
    // A compact summary is a continuation artifact, not user speech — it must
    // not count as a message any more than a system event would.
    if (record.compactSummary === true) continue;
    aggregate.messages += 1;

    const dayStart = dayStartOf(record.timestamp);
    let day = aggregate.daily.get(dayStart);
    if (!day) {
      day = { ...emptyTotals(), messages: 0 };
      aggregate.daily.set(dayStart, day);
    }
    day.messages += 1;

    const at = new Date(record.timestamp);
    aggregate.hourly[at.getDay()][at.getHours()] += 1;

    const usage = record.usage;
    if (!usage) continue;
    addUsage(day, usage);

    const model = record.model ?? UNKNOWN_MODEL_LABEL;
    let modelBucket = aggregate.models.get(model);
    if (!modelBucket) {
      modelBucket = { ...emptyTotals(), messages: 0 };
      aggregate.models.set(model, modelBucket);
    }
    addUsage(modelBucket, usage);
    modelBucket.messages += 1;
  }

  return aggregate;
}

/**
 * `aggregateSession` plus project attribution: the one entry point that knows
 * the session's project label, so the progressive scan hook (step 5) merges
 * these one by one.
 */
export function aggregateSessionInput({ records, projectLabel }: UsageSessionInput): UsageAggregate {
  const aggregate = aggregateSession(records);
  if (projectLabel) {
    aggregate.projects.set(projectLabel, { ...aggregate.totals, sessions: 1 });
  }
  return aggregate;
}

/** Merges `source` into `target` (mutating) — the progressive-aggregation loop. */
export function mergeInto(target: UsageAggregate, source: UsageAggregate): UsageAggregate {
  target.sessionCount += source.sessionCount;
  target.messages += source.messages;
  addTotals(target.totals, source.totals);

  for (const [dayStart, bucket] of source.daily) {
    let day = target.daily.get(dayStart);
    if (!day) {
      day = { ...emptyTotals(), messages: 0 };
      target.daily.set(dayStart, day);
    }
    addTotals(day, bucket);
    day.messages += bucket.messages;
  }

  for (const [model, bucket] of source.models) {
    let merged = target.models.get(model);
    if (!merged) {
      merged = { ...emptyTotals(), messages: 0 };
      target.models.set(model, merged);
    }
    addTotals(merged, bucket);
    merged.messages += bucket.messages;
  }

  for (const [label, bucket] of source.projects) {
    let merged = target.projects.get(label);
    if (!merged) {
      merged = { ...emptyTotals(), sessions: 0 };
      target.projects.set(label, merged);
    }
    addTotals(merged, bucket);
    merged.sessions += bucket.sessions;
  }

  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      target.hourly[day][hour] += source.hourly[day][hour];
    }
  }

  return target;
}

/** Pure merge: `mergeAggregate(a, b)` leaves both inputs untouched. */
export function mergeAggregate(a: UsageAggregate, b: UsageAggregate): UsageAggregate {
  const merged = emptyAggregate();
  mergeInto(merged, a);
  mergeInto(merged, b);
  return merged;
}

/** Merges every session with no time-window filtering (whole-history view). */
export function aggregateAll(sessions: readonly UsageSessionInput[]): UsageAggregate {
  const aggregate = emptyAggregate();
  for (const session of sessions) {
    mergeInto(aggregate, aggregateSessionInput(session));
  }
  return aggregate;
}

function buildDailySeries(
  daily: Map<number, DayBucket>,
  startTs: number,
  todayStart: number
): DailyPoint[] {
  const points: DailyPoint[] = [];
  for (let dayStart = startTs; dayStart <= todayStart; dayStart = addLocalDays(dayStart, 1)) {
    const bucket = daily.get(dayStart);
    points.push({ dayStart, ...(bucket ?? { ...emptyTotals(), messages: 0 }) });
  }
  return points;
}

function topSlices(buckets: ReadonlyMap<string, UsageTotals>, topN: number): UsageSlice[] {
  const sorted = [...buckets.entries()]
    .map(([label, totals]) => ({ label, value: totalsSum(totals) }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (sorted.length <= topN) return sorted;
  const tail = sorted.slice(topN).reduce((sum, slice) => sum + slice.value, 0);
  return [...sorted.slice(0, topN), { label: OTHER_LABEL, value: tail }];
}

/**
 * Windowed aggregation for the dashboard: only records whose timestamp falls
 * on one of the last `days` local days (today included) are counted — a
 * session straddling the window edge contributes just its in-window records.
 * Returns view-ready series and Top-N distributions on top of the aggregate.
 */
export function aggregateRange(
  sessions: readonly UsageSessionInput[],
  days: number,
  now: number = Date.now()
): RangeAggregate {
  const windowDays = Math.max(1, Math.floor(days));
  const todayStart = dayStartOf(now);
  const startTs = addLocalDays(todayStart, -(windowDays - 1));

  const aggregate = emptyAggregate();
  for (const session of sessions) {
    const inWindow = session.records.filter((record) => record.timestamp >= startTs);
    if (inWindow.length === 0) continue;
    mergeInto(aggregate, aggregateSessionInput({ records: inWindow, projectLabel: session.projectLabel }));
  }

  return {
    ...aggregate,
    dailySeries: buildDailySeries(aggregate.daily, startTs, todayStart),
    topProjects: topSlices(aggregate.projects, DEFAULT_TOP_N),
    topModels: topSlices(aggregate.models, DEFAULT_TOP_N),
    kpi: {
      sessions: aggregate.sessionCount,
      messages: aggregate.messages,
      tokens: totalsSum(aggregate.totals)
    }
  };
}
