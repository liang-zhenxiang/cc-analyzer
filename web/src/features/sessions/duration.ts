import type { SessionRecord, Turn } from "./types";
import type { TimeRange } from "./filters";

export type DurationBreakdown = {
  total: number;
  localTool: number;
  waitUser: number;
  direct: number;
  delegated: number;
  workflow: number;
  compute: number;
};

export type DurationBreakdownOptions = {
  isSubagent?: boolean;
  turns?: Turn[];
  childSessionIntervals?: Record<string, TimeRange>;
  workflowIntervals?: Record<string, TimeRange>;
};

export type DurationIntervals = {
  direct: TimeRange[];
  delegated: TimeRange[];
  workflow: TimeRange[];
  localTool: TimeRange[];
  waitUser: TimeRange[];
  compute: TimeRange[];
};

export function mergeIntervals(intervals: TimeRange[]): TimeRange[] {
  const ordered = intervals
    .filter((item) => item.end > item.start)
    .sort((a, b) => a.start - b.start);
  let current: TimeRange | null = null;
  const merged: TimeRange[] = [];

  for (const interval of ordered) {
    if (!current) {
      current = { ...interval };
      merged.push(current);
      continue;
    }

    if (interval.start <= current.end) {
      current.end = Math.max(current.end, interval.end);
    } else {
      current = { ...interval };
      merged.push(current);
    }
  }

  return merged;
}

export function subtractIntervals(subject: TimeRange[], masks: TimeRange[]): TimeRange[] {
  const subjects = mergeIntervals(subject);
  const subtracted = mergeIntervals(masks);
  const result: TimeRange[] = [];

  for (const interval of subjects) {
    let start = interval.start;

    for (const mask of subtracted) {
      if (mask.end <= start) continue;
      if (mask.start >= interval.end) break;
      if (mask.start > start) {
        result.push({ start, end: mask.start });
      }
      start = Math.max(start, mask.end);
      if (start >= interval.end) break;
    }

    if (start < interval.end) {
      result.push({ start, end: interval.end });
    }
  }

  return result;
}

export function complementIntervals(window: TimeRange, intervals: TimeRange[]): TimeRange[] {
  return subtractIntervals([window], intervals);
}

export function unionIntervals(intervals: TimeRange[]): number {
  return mergeIntervals(intervals).reduce(
    (total, interval) => total + interval.end - interval.start,
    0
  );
}

function clippedInterval(interval: TimeRange, window: TimeRange): TimeRange | null {
  const start = Math.max(window.start, interval.start);
  const end = Math.min(window.end, interval.end);
  return end > start ? { start, end } : null;
}

function mappedInterval(
  map: Record<string, TimeRange> | undefined,
  keys: Array<string | undefined>
): TimeRange | null {
  if (!map) return null;

  for (const key of keys) {
    if (!key) continue;
    const interval = map[key];
    if (
      interval &&
      Number.isFinite(interval.start) &&
      Number.isFinite(interval.end) &&
      interval.end > interval.start
    ) {
      return interval;
    }
  }

  return null;
}

export function recordInterval(
  record: SessionRecord,
  options: DurationBreakdownOptions,
  window: TimeRange
): TimeRange | null {
  const override =
    record.toolCategory === "delegated"
      ? mappedInterval(options.childSessionIntervals, [
          record.childSessionPath,
          record.childSessionId,
          record.fullId
        ])
      : record.toolCategory === "workflow"
        ? mappedInterval(options.workflowIntervals, [
            record.structuredResult?.toolName === "Workflow"
              ? record.structuredResult.runId
              : undefined,
            record.fullId
          ])
        : null;
  const interval =
    override ??
    parsedInterval(record.timestamp, record.timestamp + record.durationMs);

  return interval ? clippedInterval(interval, window) : null;
}

/**
 * A record's own interval. `durationMs` comes from a JSONL file, where
 * `1e999` parses to Infinity, so non-finite bounds are dropped instead of
 * swallowing the whole window.
 */
function parsedInterval(start: number, end: number): TimeRange | null {
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
}

function turnGaps(turns: Turn[] | undefined, window: TimeRange): TimeRange[] {
  if (!turns) return [];

  const ordered = [...turns].sort((a, b) => a.startedAt - b.startedAt);
  const gaps: TimeRange[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const gap = clippedInterval(
      {
        start: ordered[index - 1].endedAt,
        end: ordered[index].startedAt
      },
      window
    );
    if (gap) gaps.push(gap);
  }

  return gaps;
}

function categoryIntervals(
  records: SessionRecord[],
  category: SessionRecord["toolCategory"],
  options: DurationBreakdownOptions,
  window: TimeRange
): TimeRange[] {
  return records.flatMap((record) => {
    if (record.toolCategory !== category) return [];
    const interval = recordInterval(record, options, window);
    return interval ? [interval] : [];
  });
}

export function computeDurationBreakdown(
  records: SessionRecord[],
  sessionStart: number,
  sessionEnd: number,
  options: DurationBreakdownOptions = {}
): DurationBreakdown {
  const intervals = computeDurationIntervals(records, sessionStart, sessionEnd, options);

  return {
    total: Math.max(0, sessionEnd - sessionStart),
    localTool: unionIntervals(intervals.localTool),
    direct: unionIntervals(intervals.direct),
    delegated: unionIntervals(intervals.delegated),
    workflow: unionIntervals(intervals.workflow),
    waitUser: unionIntervals(intervals.waitUser),
    compute: unionIntervals(intervals.compute)
  };
}

export function computeDurationIntervals(
  records: SessionRecord[],
  sessionStart: number,
  sessionEnd: number,
  options: DurationBreakdownOptions = {}
): DurationIntervals {
  const window: TimeRange = { start: sessionStart, end: sessionEnd };
  const direct = categoryIntervals(records, "direct", options, window);
  const delegated = categoryIntervals(records, "delegated", options, window);
  const workflow = categoryIntervals(records, "workflow", options, window);
  const wait = categoryIntervals(records, "wait", options, window);
  const localTool = mergeIntervals([...direct, ...delegated, ...workflow]);
  const waitCandidates = options.isSubagent
    ? wait
    : [...wait, ...turnGaps(options.turns, window)];
  const waitUser = subtractIntervals(waitCandidates, localTool);

  return {
    direct,
    delegated,
    workflow,
    localTool,
    waitUser,
    compute: complementIntervals(window, [...localTool, ...waitUser])
  };
}
