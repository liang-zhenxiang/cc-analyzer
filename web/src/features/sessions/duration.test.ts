import { describe, expect, it } from "vitest";
import { computeDurationBreakdown, unionIntervals } from "./duration";
import type { SessionRecord, ToolCategory, Turn } from "./types";
import durationFixture from "../../../tests/fixtures/session-duration-model.jsonl?raw";
import { parseJsonlText } from "./parseJsonl";

function tool(
  id: string,
  category: ToolCategory,
  start: number,
  durationMs: number,
  extra: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "tool",
    timestamp: start,
    durationMs,
    text: "",
    isError: false,
    toolName: "Tool",
    toolCategory: category,
    raw: {},
    ...extra
  };
}

const turn = (index: number, startedAt: number, endedAt: number): Turn => ({
  index,
  startedAt,
  endedAt,
  records: []
});

describe("unionIntervals", () => {
  it("unions overlapping intervals without double counting", () => {
    expect(
      unionIntervals([
        { start: 0, end: 100 },
        { start: 50, end: 150 }
      ])
    ).toBe(150);
  });
});

describe("computeDurationBreakdown", () => {
  it("unions overlapping intervals", () => {
    const records = [
      tool("a", "direct", 0, 100),
      tool("b", "direct", 50, 100),
      tool("c", "delegated", 200, 50)
    ];
    const result = computeDurationBreakdown(records, 0, 300);

    expect(result.direct).toBe(150);
    expect(result.delegated).toBe(50);
    expect(result.compute).toBe(100);
  });

  it("unions all local tool categories before deriving compute time", () => {
    const records = [
      tool("direct-a", "direct", 0, 100),
      tool("direct-b", "direct", 50, 100),
      tool("delegated", "delegated", 200, 50),
      tool("workflow", "workflow", 225, 50)
    ];
    const result = computeDurationBreakdown(records, 0, 300);

    expect(result.localTool).toBe(225);
    expect(result.direct).toBe(150);
    expect(result.delegated).toBe(50);
    expect(result.workflow).toBe(50);
    expect(result.compute).toBe(75);
  });

  it("removes local tool overlap from user wait time", () => {
    const records = [
      tool("direct", "direct", 0, 100),
      tool("ask", "wait", 50, 100, { toolName: "AskUserQuestion" })
    ];
    const result = computeDurationBreakdown(records, 0, 200);

    expect(result.direct).toBe(100);
    expect(result.waitUser).toBe(50);
    expect(result.compute).toBe(50);
  });

  it("adds inter-turn gaps to wait time in a main session", () => {
    const records = [tool("direct", "direct", 0, 100)];
    const result = computeDurationBreakdown(records, 0, 250, {
      isSubagent: false,
      turns: [turn(0, 0, 100), turn(1, 150, 200)]
    });

    expect(result.waitUser).toBe(50);
    expect(result.compute).toBe(100);
  });

  it("ignores inter-turn gaps in a subagent session", () => {
    const records = [tool("direct", "direct", 0, 100)];
    const result = computeDurationBreakdown(records, 0, 250, {
      isSubagent: true,
      turns: [turn(0, 0, 100), turn(1, 150, 200)]
    });

    expect(result.waitUser).toBe(0);
    expect(result.compute).toBe(150);
  });

  it("prefers the child session interval for delegated time and clips it to the window", () => {
    const records = [
      tool("delegated", "delegated", 0, 200, { childSessionPath: "/tmp/child.jsonl" })
    ];
    const result = computeDurationBreakdown(records, 0, 200, {
      childSessionIntervals: {
        "/tmp/child.jsonl": { start: 50, end: 100 }
      }
    });

    expect(result.delegated).toBe(50);
    expect(result.compute).toBe(150);
  });

  it("falls back to the parsed tool interval when an override is invalid", () => {
    const records = [
      tool("delegated", "delegated", 0, 200, { childSessionPath: "/tmp/child.jsonl" })
    ];
    const result = computeDurationBreakdown(records, 0, 200, {
      childSessionIntervals: {
        "/tmp/child.jsonl": { start: 150, end: 100 }
      }
    });

    expect(result.delegated).toBe(200);
    expect(result.compute).toBe(0);
  });

  it("prefers the workflow interval from workflow metadata and clips it to the window", () => {
    const records = [
      tool("workflow", "workflow", 0, 200, {
        toolName: "Workflow",
        structuredResult: {
          toolName: "Workflow",
          runId: "run-1",
          taskId: "task-1",
          workflowName: "Release",
          scriptPath: "/tmp/workflow.json",
          status: "running"
        }
      })
    ];
    const result = computeDurationBreakdown(records, 0, 200, {
      workflowIntervals: {
        "run-1": { start: 50, end: 100 }
      }
    });

    expect(result.workflow).toBe(50);
    expect(result.compute).toBe(150);
  });

  it("clips record intervals to the active statistics window", () => {
    const records = [tool("direct", "direct", 0, 200)];
    const result = computeDurationBreakdown(records, 50, 100);

    expect(result.direct).toBe(50);
    expect(result.compute).toBe(0);
  });

  it("matches the manual duration breakdown for the fixed fixture", () => {
    const session = parseJsonlText(durationFixture, "/tmp/session-duration-model.jsonl");
    const result = computeDurationBreakdown(session.records, session.startedAt, session.endedAt, {
      turns: session.turns,
      childSessionIntervals: {
        "/tmp/child.jsonl": { start: 1000, end: 2000 }
      },
      workflowIntervals: {
        "run-1": { start: 2000, end: 2800 }
      }
    });

    expect(result).toEqual({
      total: 6000,
      localTool: 3500,
      waitUser: 1300,
      direct: 1800,
      delegated: 1000,
      workflow: 800,
      compute: 1200
    });
  });
});

describe("computeDurationBreakdown edge cases", () => {
  it("resolves a delegated override by childSessionPath, then id, then fullId", () => {
    const options = {
      childSessionIntervals: {
        "/tmp/child.jsonl": { start: 0, end: 40 },
        "child-id": { start: 0, end: 70 },
        "record-full-id": { start: 0, end: 100 }
      }
    };
    const window = { start: 0, end: 200 };

    const byPath = tool("record-full-id", "delegated", 0, 200, {
      childSessionPath: "/tmp/child.jsonl",
      childSessionId: "child-id"
    });
    const byId = tool("record-full-id", "delegated", 0, 200, { childSessionId: "child-id" });
    const byFullId = tool("record-full-id", "delegated", 0, 200);

    expect(computeDurationBreakdown([byPath], 0, 200, options).delegated).toBe(40);
    expect(computeDurationBreakdown([byId], 0, 200, options).delegated).toBe(70);
    expect(computeDurationBreakdown([byFullId], 0, 200, options).delegated).toBe(100);
    expect(computeDurationBreakdown([byPath], window.start, window.end, options).delegated).toBe(40);
  });

  it("ignores inverted or non-finite record intervals", () => {
    const records = [
      tool("negative", "direct", 100, -50),
      tool("infinite", "direct", 0, Number.POSITIVE_INFINITY),
      tool("nan", "direct", Number.NaN, 40),
      tool("valid", "direct", 0, 30)
    ];

    const result = computeDurationBreakdown(records, 0, 200);

    expect(result.direct).toBe(30);
    expect(result.compute).toBe(170);
  });

  it("returns nothing for an inverted window and plain arithmetic for a past one", () => {
    const records = [tool("a", "direct", 100, 50)];

    const inverted = computeDurationBreakdown(records, 200, 100);
    expect(inverted.total).toBe(0);
    expect(inverted.direct).toBe(0);

    // A window that ends before it starts is clamped to zero, a window that
    // simply sits outside the records keeps its own length.
    const negative = computeDurationBreakdown(records, -100, -50);
    expect(negative.total).toBe(50);
    expect(negative.direct).toBe(0);
  });

  it("clips intervals that only partly overlap the window", () => {
    const records = [tool("straddling", "direct", -50, 200)];

    const result = computeDurationBreakdown(records, 0, 100);

    expect(result.direct).toBe(100);
    expect(result.compute).toBe(0);
  });
});
