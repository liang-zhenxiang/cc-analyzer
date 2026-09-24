import { describe, expect, it } from "vitest";
import { buildDurationTree, durationWindow, type DurationNode } from "./durationTree";
import { computeDurationBreakdown } from "./duration";
import { MAX_SESSION_GRAPH_DEPTH } from "./sessionGraph";
import type { ParsedSession, SessionRecord, ToolCategory, WorkflowRun } from "./types";

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

function session(records: SessionRecord[], extra: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: "root-session",
    path: "/repo/project/root.jsonl",
    startedAt: 0,
    endedAt: 1000,
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    sidechainMessages: [],
    ...extra
  };
}

function child(id: string, startedAt: number, endedAt: number): ParsedSession {
  return session([tool(`${id}-tool`, "direct", startedAt, endedAt - startedAt)], {
    sessionId: id,
    path: `/repo/project/subagents/agent-${id}.jsonl`,
    isSubagent: true,
    startedAt,
    endedAt
  });
}

const workflowRun: WorkflowRun = {
  runId: "run-1",
  workflowName: "Release",
  summary: "",
  status: "completed",
  startTs: 400,
  durationMs: 100,
  agentCount: 1,
  totalTokens: 1,
  totalToolCalls: 1,
  phases: [],
  resultText: "",
  resultTruncated: false,
  logs: []
};

function sampleRecords(): SessionRecord[] {
  return [
    tool("direct-1", "direct", 0, 100),
    tool("agent-1", "delegated", 200, 100, {
      toolName: "Agent",
      text: "review the parser",
      childSessionId: "child-a",
      childSession: child("child-a", 200, 300)
    }),
    tool("workflow-1", "workflow", 400, 100, {
      toolName: "Workflow",
      workflowRun,
      childSessions: [child("workflow-child", 400, 450)]
    }),
    tool("ask-1", "wait", 600, 50, { toolName: "AskUserQuestion" })
  ];
}

function findNode(node: DurationNode, id: string): DurationNode | null {
  // Breadth-first: nested child sessions repeat category ids such as "workflow",
  // so the shallowest match must win.
  const queue: DurationNode[] = [node];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.id === id) return current;
    queue.push(...(current.children ?? []));
  }
  return null;
}

function maxDepth(node: DurationNode, depth = 0): number {
  const children = node.children ?? [];
  if (children.length === 0) return depth;
  return Math.max(...children.map((item) => maxDepth(item, depth + 1)));
}

describe("durationWindow", () => {
  it("clamps the selection to the session bounds", () => {
    const base = session([]);
    expect(durationWindow(base, null)).toEqual({ start: 0, end: 1000 });
    expect(durationWindow(base, { start: 150, end: 450 })).toEqual({ start: 150, end: 450 });
    expect(durationWindow(base, { start: -50, end: 5000 })).toEqual({ start: 0, end: 1000 });
    expect(durationWindow(base, { start: 800, end: 200 })).toEqual({ start: 200, end: 800 });
  });
});

describe("buildDurationTree", () => {
  it("matches the duration hierarchy and agrees with the duration breakdown", () => {
    const records = sampleRecords();
    const base = session(records);
    const tree = buildDurationTree(base, null, null);

    expect(tree.kind).toBe("root");
    expect((tree.children ?? []).map((node) => node.id)).toEqual([
      "waitUser",
      "localTool",
      "compute"
    ]);

    const localTool = findNode(tree, "localTool");
    expect((localTool?.children ?? []).map((node) => node.id)).toEqual([
      "direct",
      "delegated",
      "workflow"
    ]);

    const breakdown = computeDurationBreakdown(records, 0, 1000);
    expect(findNode(tree, "localTool")?.durationMs).toBe(breakdown.localTool);
    expect(findNode(tree, "direct")?.durationMs).toBe(breakdown.direct);
    expect(findNode(tree, "delegated")?.durationMs).toBe(breakdown.delegated);
    expect(findNode(tree, "workflow")?.durationMs).toBe(breakdown.workflow);
    expect(findNode(tree, "waitUser")?.durationMs).toBe(breakdown.waitUser);
    expect(findNode(tree, "compute")?.durationMs).toBe(breakdown.compute);

    expect(findNode(tree, "direct")?.count).toBe(1);
    expect(findNode(tree, "delegated")?.count).toBe(1);
  });

  it("clips node durations to the active time window", () => {
    const tree = buildDurationTree(session(sampleRecords()), null, {
      start: 150,
      end: 450
    });

    expect(findNode(tree, "direct")?.durationMs).toBe(0);
    expect(findNode(tree, "delegated")?.durationMs).toBe(100);
    expect(findNode(tree, "workflow")?.durationMs).toBe(50);
    expect(findNode(tree, "localTool")?.durationMs).toBe(150);
    expect(findNode(tree, "waitUser")?.durationMs).toBe(0);
    expect(findNode(tree, "compute")?.durationMs).toBe(150);
  });

  it("keeps the tree shape when the window hides every record", () => {
    const tree = buildDurationTree(session(sampleRecords()), null, {
      start: 900,
      end: 1000
    });

    expect(findNode(tree, "localTool")).not.toBeNull();
    expect(findNode(tree, "direct")).not.toBeNull();
    expect(findNode(tree, "workflow")).not.toBeNull();
    expect(findNode(tree, "direct")?.durationMs).toBe(0);
    expect(findNode(tree, "compute")?.durationMs).toBe(100);
  });

  it("nests child sessions under the agent and workflow nodes", () => {
    const tree = buildDurationTree(session(sampleRecords()), null, null);

    const agent = findNode(tree, "agent-agent-1");
    expect(agent?.label).toContain("Agent child-a");
    expect(agent?.childSession?.sessionId).toBe("child-a");
    expect(agent?.children?.[0]?.kind).toBe("root");
    expect(agent?.children?.[0]?.label).toContain("child-a");

    const workflow = findNode(tree, "workflow-workflow-1");
    expect(workflow?.label).toBe("Release");
    expect(workflow?.count).toBe(1);
    expect(workflow?.children?.[0]?.id).toContain("agent-workflow-child.jsonl");
  });

  it("stops descending when a child session points back at an ancestor", () => {
    const parent = session([]);
    const cycleRecord = tool("agent-cycle", "delegated", 0, 100, {
      toolName: "Agent",
      childSession: parent
    });
    parent.records = [cycleRecord];

    const tree = buildDurationTree(parent, null, null);
    const agent = findNode(tree, "agent-agent-cycle");

    expect(agent?.children).toBeUndefined();
    expect(maxDepth(tree)).toBeLessThanOrEqual(MAX_SESSION_GRAPH_DEPTH + 2);
  });
});
