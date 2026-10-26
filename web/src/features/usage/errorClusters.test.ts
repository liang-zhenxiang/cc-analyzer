import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "./errorStats";
import {
  API_CLUSTER_LABEL,
  buildErrorClusters,
  CLUSTER_LIMIT,
  EMPTY_FIRST_LINE_LABEL,
  FIRST_LINE_MAX_CHARS,
  normalizeFirstLine,
  UNKNOWN_TOOL_LABEL
} from "./errorClusters";

const T0 = new Date(2026, 9, 2, 9, 0, 0).getTime();

function eventOf(overrides: Partial<ErrorEvent> = {}): ErrorEvent {
  return {
    kind: "tool",
    timestamp: T0,
    toolName: "Bash",
    apiStatus: null,
    recordId: "rec-1",
    path: "/logs/a.jsonl",
    projectLabel: "proj",
    preview: "Error: boom",
    ...overrides
  };
}

describe("errorClusters · 分组", () => {
  it("folds repeated failures of one tool and one message into a single row", () => {
    const clusters = buildErrorClusters([
      eventOf({ timestamp: T0 + 3_000 }),
      eventOf({ timestamp: T0, preview: "Error: boom\n  at stack line" }),
      eventOf({ timestamp: T0 + 1_000 }),
      eventOf({ preview: "Error: other", recordId: "rec-2" })
    ]);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toMatchObject({ toolName: "Bash", firstLine: "Error: boom", count: 3 });
    expect(clusters[0].firstAt).toBe(T0);
    expect(clusters[0].lastAt).toBe(T0 + 3_000);
    expect(clusters[1]).toMatchObject({ firstLine: "Error: other", count: 1 });
  });

  it("keeps different tools with the same message apart", () => {
    const clusters = buildErrorClusters([
      eventOf({ toolName: "Bash" }),
      eventOf({ toolName: "Read", recordId: "rec-2" })
    ]);
    expect(clusters).toHaveLength(2);
    expect(new Set(clusters.map((cluster) => cluster.toolName))).toEqual(new Set(["Bash", "Read"]));
  });

  it("labels API failures and tool events that lost their tool name", () => {
    const clusters = buildErrorClusters([
      eventOf({ kind: "api", toolName: undefined, preview: "API Error: 529 overloaded" }),
      eventOf({ kind: "tool", toolName: undefined, preview: "bad shape" }),
      eventOf({ preview: "   " })
    ]);
    const labels = clusters.map((cluster) => `${cluster.toolName}|${cluster.firstLine}`);
    expect(labels).toContain(`${API_CLUSTER_LABEL}|API Error: 529 overloaded`);
    expect(labels).toContain(`${UNKNOWN_TOOL_LABEL}|bad shape`);
    expect(labels).toContain(`Bash|${EMPTY_FIRST_LINE_LABEL}`);
  });
});

describe("errorClusters · 归一化首行", () => {
  it("takes the first line, trims it and never splits a surrogate pair", () => {
    expect(normalizeFirstLine("  Error: x  \nstack")).toBe("Error: x");
    // 100 个 emoji（每个是 1 个码点、2 个 UTF-16 单元）：按码点截断到 80。
    const wide = "💥".repeat(100);
    const normalized = normalizeFirstLine(wide);
    expect(Array.from(normalized)).toHaveLength(FIRST_LINE_MAX_CHARS);
    expect(normalized.endsWith("\uFFFD")).toBe(false);
    expect(normalized.length).toBe(FIRST_LINE_MAX_CHARS * 2);
  });

  it("normalizes the same way for grouping and for display", () => {
    const clusters = buildErrorClusters([
      eventOf({ preview: "  ENOENT: /a/b  \nsecond line" }),
      eventOf({ preview: "ENOENT: /a/b", recordId: "rec-2" })
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].firstLine).toBe("ENOENT: /a/b");
  });
});

describe("errorClusters · 排序与样本", () => {
  it("orders by count, then by first occurrence, then by key", () => {
    const clusters = buildErrorClusters([
      eventOf({ preview: "later", timestamp: T0 + 5_000 }),
      eventOf({ preview: "early", timestamp: T0, recordId: "rec-2" }),
      eventOf({ preview: "twice", timestamp: T0 + 1_000 }),
      eventOf({ preview: "twice", timestamp: T0 + 2_000, recordId: "rec-3" })
    ]);
    expect(clusters.map((cluster) => cluster.firstLine)).toEqual(["twice", "early", "later"]);
  });

  it("samples the earliest event that can actually be opened", () => {
    const clusters = buildErrorClusters([
      eventOf({ timestamp: T0, recordId: null, path: "/logs/sidechain.jsonl" }),
      eventOf({ timestamp: T0 + 1_000, recordId: "rec-mid", path: "/logs/mid.jsonl" }),
      eventOf({ timestamp: T0 + 2_000, recordId: "rec-late", path: "/logs/late.jsonl" })
    ]);
    expect(clusters[0].sampleRecordId).toBe("rec-mid");
    expect(clusters[0].sampleSessionPath).toBe("/logs/mid.jsonl");
  });

  it("falls back to a null record id when no event in the cluster has one", () => {
    const clusters = buildErrorClusters([
      eventOf({ timestamp: T0, recordId: null, path: "/logs/sidechain.jsonl" })
    ]);
    expect(clusters[0].sampleRecordId).toBeNull();
    expect(clusters[0].sampleSessionPath).toBe("/logs/sidechain.jsonl");
  });

  it("keeps the eight busiest clusters by default and honours an explicit limit", () => {
    const events = Array.from({ length: 12 }, (_, index) =>
      eventOf({ preview: `failure ${index}`, recordId: `rec-${index}` })
    );
    expect(buildErrorClusters(events)).toHaveLength(CLUSTER_LIMIT);
    expect(buildErrorClusters(events, 3)).toHaveLength(3);
    expect(buildErrorClusters(events, 0)).toEqual([]);
    expect(buildErrorClusters([])).toEqual([]);
  });
});
