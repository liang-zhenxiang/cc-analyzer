import type { LogRowKind } from "./logRows";

export type TimeRange = { start: number; end: number };

export type RowKindFilter = LogRowKind;
export type RowStatusFilter = "ok" | "error";
export type DurationMode = "gt" | "lt" | "between";

/**
 * Filters the log view. Filtering works on *rows* (after the user+model and
 * model+tool merges), so a kind here is a row kind, not a raw record kind.
 */
export type RecordFilter = {
  search: string;
  kinds: Set<RowKindFilter>;
  statuses: Set<RowStatusFilter>;
  durationMode: DurationMode;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  timeRange: TimeRange | null;
};

export const emptyFilter: RecordFilter = {
  search: "",
  kinds: new Set(),
  statuses: new Set(),
  durationMode: "gt",
  minDurationMs: null,
  maxDurationMs: null,
  timeRange: null
};
