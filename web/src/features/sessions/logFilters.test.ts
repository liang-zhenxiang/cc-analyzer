import { describe, expect, it } from "vitest";
import { emptyFilter } from "./filters";
import { buildLogRows, filterLogRows, recordsOfRows } from "./logRows";
import type { SessionRecord, Turn } from "./types";

function base(id: string, extra: Partial<SessionRecord>): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "tool",
    timestamp: 0,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...extra
  };
}

const user = base("user-1", { kind: "user", timestamp: 0, text: "帮我看看" });
const failed = base("tool-1", {
  toolName: "Bash",
  toolCategory: "direct",
  timestamp: 100,
  durationMs: 500,
  text: "bash output",
  toolResult: "boom",
  isError: true
});
const slow = base("tool-2", {
  toolName: "Read",
  toolCategory: "direct",
  timestamp: 1_000,
  durationMs: 30_000,
  toolInput: { file_path: "/repo/src/app.ts" },
  toolResult: "file body"
});
const agent = base("tool-3", {
  toolName: "Agent",
  toolCategory: "delegated",
  timestamp: 40_000,
  durationMs: 2_000,
  childSessionPath: "/repo/subagents/agent-a.jsonl"
});

const turns: Turn[] = [{ index: 0, startedAt: 0, endedAt: 42_000, records: [user, failed, slow, agent] }];

function rows() {
  return buildLogRows([user, failed, slow, agent], turns);
}

describe("filterLogRows", () => {
  it("filters by row kind", () => {
    expect(rows()).toHaveLength(4);
    expect(filterLogRows(rows(), { ...emptyFilter, kinds: new Set(["subagent"]) })).toHaveLength(1);
    expect(filterLogRows(rows(), { ...emptyFilter, kinds: new Set(["tool"]) })).toHaveLength(2);
  });

  it("filters by status", () => {
    const failedRows = filterLogRows(rows(), { ...emptyFilter, statuses: new Set(["error"]) });
    expect(failedRows.map((row) => row.id)).toEqual(["tool-1"]);
  });

  it("applies gt/lt/between duration modes", () => {
    expect(
      filterLogRows(rows(), { ...emptyFilter, durationMode: "gt", minDurationMs: 10_000 }).map(
        (row) => row.id
      )
    ).toEqual(["tool-2"]);
    expect(
      filterLogRows(rows(), { ...emptyFilter, durationMode: "lt", minDurationMs: 1_000 }).map(
        (row) => row.id
      )
    ).toEqual(["user-1", "tool-1"]);
    expect(
      filterLogRows(rows(), {
        ...emptyFilter,
        durationMode: "between",
        minDurationMs: 600,
        maxDurationMs: 3_000
      }).map((row) => row.id)
    ).toEqual(["tool-3"]);
  });

  it("searches commands, paths and summaries", () => {
    expect(filterLogRows(rows(), { ...emptyFilter, search: "app.ts" }).map((row) => row.id)).toEqual(
      ["tool-2"]
    );
    expect(
      filterLogRows(rows(), { ...emptyFilter, search: "agent-a" }).map((row) => row.id)
    ).toEqual(["tool-3"]);
    expect(filterLogRows(rows(), { ...emptyFilter, search: "bash" }).map((row) => row.id)).toEqual([
      "tool-1"
    ]);
  });

  it("filters by the selected time range", () => {
    expect(
      filterLogRows(rows(), { ...emptyFilter, timeRange: { start: 900, end: 2_000 } }).map(
        (row) => row.id
      )
    ).toEqual(["tool-2"]);
  });
});

describe("recordsOfRows", () => {
  it("returns the records behind the visible rows once, in time order", () => {
    expect(recordsOfRows(rows()).map((record) => record.id)).toEqual([
      "user-1",
      "tool-1",
      "tool-2",
      "tool-3"
    ]);
  });
});
