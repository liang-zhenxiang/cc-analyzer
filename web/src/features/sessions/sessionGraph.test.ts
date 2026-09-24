import { describe, expect, it, vi } from "vitest";
import {
  durationBreakdownOptionsFromGraph,
  MAX_SESSION_GRAPH_DEPTH,
  parseWorkflowRun,
  resolveSessionGraph
} from "./sessionGraph";
import { parseJsonlText } from "./parseJsonl";
import { createSessionParseCache } from "./sessionParseCache";
import type { Bridges } from "../../api/types";
import mainFixture from "../../../tests/fixtures/session-graph/main.jsonl?raw";
import childFixture from "../../../tests/fixtures/session-graph/subagents/agent-child.jsonl?raw";
import grandchildFixture from "../../../tests/fixtures/session-graph/agents/agent-grandchild.jsonl?raw";
import workflowFixture from "../../../tests/fixtures/session-graph/subagents/workflows/run-1.json?raw";
import workflowChildFixture from "../../../tests/fixtures/session-graph/subagents/workflows/run-1/agent-workflow-child.jsonl?raw";

type Directory = Array<{ name: string; is_dir: boolean; is_file: boolean }>;

function entry(name: string, kind: "file" | "dir" = "file") {
  return { name, is_dir: kind === "dir", is_file: kind === "file" };
}

function createGraphBridges({
  files = {},
  directories = {}
}: {
  files?: Record<string, string>;
  directories?: Record<string, Directory>;
} = {}): Bridges {
  return {
    fs: {
      readDir: vi.fn(async (path: string) => directories[path] ?? []),
      readText: vi.fn(async (path: string) => {
        if (!(path in files)) throw new Error(`不可读: ${path}`);
        return files[path];
      }),
      readHead: vi.fn(async () => ""),
      writeText: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ is_file: true, size: 1, mtime_ms: 1 })),
      homeDir: vi.fn(async () => "/tmp"),
      appDataDir: vi.fn(async () => "/tmp/app")
    }
  } as unknown as Bridges;
}

function sessionJsonl(input: {
  sessionId: string;
  records: Array<Record<string, unknown>>;
}): string {
  return input.records.map((record) => JSON.stringify(record)).join("\n");
}

function jsonl(records: Array<Record<string, unknown>>): string {
  return records.map((record) => JSON.stringify(record)).join("\n");
}

function userEvent(sessionId: string, uuid: string, timestamp: string, text: string) {
  return {
    type: "user",
    sessionId,
    timestamp,
    uuid,
    message: { role: "user", content: text }
  };
}

function agentToolUse(sessionId: string, uuid: string, timestamp: string, toolUseId: string) {
  return {
    type: "assistant",
    sessionId,
    timestamp,
    uuid,
    message: {
      id: `${uuid}-message`,
      model: "claude",
      content: [{ type: "tool_use", id: toolUseId, name: "Agent", input: {} }]
    }
  };
}

function agentToolResult(
  sessionId: string,
  uuid: string,
  timestamp: string,
  toolUseId: string,
  result: string,
  toolUseResult?: Record<string, unknown>,
  childSessionMetadata?: Record<string, unknown>
) {
  return {
    type: "user",
    sessionId,
    timestamp,
    uuid,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: result }]
    },
    ...(toolUseResult ? { toolUseResult } : {}),
    ...(childSessionMetadata ?? {})
  };
}

function assistantTextEvent(sessionId: string, uuid: string, timestamp: string, text: string) {
  return {
    type: "assistant",
    sessionId,
    timestamp,
    uuid,
    message: {
      id: `${uuid}-message`,
      model: "claude",
      content: [{ type: "text", text }]
    }
  };
}

function workflowToolUse(
  sessionId: string,
  uuid: string,
  timestamp: string,
  toolUseId: string
) {
  return {
    type: "assistant",
    sessionId,
    timestamp,
    uuid,
    message: {
      id: `${uuid}-message`,
      model: "claude",
      content: [{ type: "tool_use", id: toolUseId, name: "Workflow", input: {} }]
    }
  };
}

function workflowToolResult(
  sessionId: string,
  uuid: string,
  timestamp: string,
  toolUseId: string,
  toolUseResult: Record<string, unknown>
) {
  return {
    type: "user",
    sessionId,
    timestamp,
    uuid,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: "done" }]
    },
    toolUseResult
  };
}

describe("workflow run parser", () => {
  it("parses workflow metadata, phases, logs, and result", () => {
    const run = parseWorkflowRun(
      "run-1",
      JSON.stringify({
        workflowName: "Release",
        summary: "执行发布流程",
        status: "completed",
        startTime: 1000,
        durationMs: 500,
        agentCount: 2,
        totalTokens: 120,
        totalToolCalls: 7,
        phases: [{ title: "Plan" }, { title: "Execute" }],
        logs: ["started", "finished"],
        result: { summary: "released" }
      })
    );

    expect(run).toEqual({
      runId: "run-1",
      workflowName: "Release",
      summary: "执行发布流程",
      status: "completed",
      startTs: 1000,
      durationMs: 500,
      agentCount: 2,
      totalTokens: 120,
      totalToolCalls: 7,
      phases: ["Plan", "Execute"],
      resultText: JSON.stringify({ summary: "released" }, null, 2),
      resultTruncated: false,
      logs: ["started", "finished"]
    });
  });

  it("truncates oversized workflow results", () => {
    const value = "x".repeat(4100);
    const run = parseWorkflowRun("run-1", JSON.stringify({ result: value }));
    expect(run?.resultTruncated).toBe(true);
    expect(run?.resultText.startsWith("x".repeat(4000))).toBe(true);
    expect(run?.resultText).toContain("…（已截断，原始 4100 字符）");
  });

  it("returns null for invalid JSON or non-object JSON", () => {
    expect(parseWorkflowRun("run-1", "{invalid")).toBeNull();
    expect(parseWorkflowRun("run-1", "[]")).toBeNull();
    expect(parseWorkflowRun("run-1", "null")).toBeNull();
  });

  it("drops malformed phases and logs instead of failing or leaking types", () => {
    const run = parseWorkflowRun(
      "run-1",
      JSON.stringify({
        workflowName: 12,
        summary: null,
        status: ["completed"],
        startTime: "3000",
        durationMs: "1000",
        agentCount: null,
        phases: "Plan → Execute",
        logs: [1, "started", null, "finished", { level: "warn" }],
        result: 42
      })
    );

    expect(run).toEqual({
      runId: "run-1",
      // Strings fall back to "", numbers to null (see WorkflowRun).
      workflowName: "",
      summary: "",
      status: "",
      startTs: null,
      durationMs: 0,
      agentCount: 0,
      totalTokens: null,
      totalToolCalls: null,
      phases: [],
      resultText: "42",
      resultTruncated: false,
      logs: ["started", "finished"]
    });
  });

  it("keeps only phases that carry a title", () => {
    const run = parseWorkflowRun(
      "run-1",
      JSON.stringify({ phases: [{ title: "Plan" }, {}, "Execute", { title: "" }, null] })
    );

    expect(run?.phases).toEqual(["Plan"]);
  });

  it("keeps the maximum depth constant at four", () => {
    expect(MAX_SESSION_GRAPH_DEPTH).toBe(4);
  });
});

describe("resolveSessionGraph agents", () => {
  it("indexes agents and attaches a direct child session", async () => {
    const rootText = sessionJsonl({
      sessionId: "root",
      records: [
        {
          type: "user",
          sessionId: "root",
          timestamp: "1970-01-01T00:00:00.000Z",
          uuid: "root-user",
          message: { role: "user", content: "start" }
        },
        {
          type: "assistant",
          sessionId: "root",
          timestamp: "1970-01-01T00:00:01.000Z",
          uuid: "agent-use",
          message: {
            id: "root-message",
            model: "claude",
            content: [{ type: "tool_use", id: "agent-use", name: "Agent", input: {} }]
          }
        },
        {
          type: "user",
          sessionId: "root",
          timestamp: "1970-01-01T00:00:03.000Z",
          uuid: "agent-result",
          message: {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "agent-use", content: "done" }]
          },
          toolUseResult: { agentId: "child" }
        }
      ]
    });
    const childText = sessionJsonl({
      sessionId: "child",
      records: [
        {
          type: "user",
          sessionId: "child",
          timestamp: "1970-01-01T00:00:01.000Z",
          uuid: "child-user",
          message: { role: "user", content: "child prompt" }
        }
      ]
    });

    const bridges = createGraphBridges({
      files: {
        "/repo/session-graph/subagents/agent-child.jsonl": childText
      },
      directories: {
        "/repo/session-graph/subagents": [entry("agent-child.jsonl")],
        "/repo/session-graph/agents": [],
        "/repo/session-graph/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");
    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.agentPaths).toEqual({
      child: "/repo/session-graph/subagents/agent-child.jsonl"
    });
    expect(graph.agentSessions.child?.sessionId).toBe("child");
    expect(graph.agentSessions.child?.isSubagent).toBe(true);
    expect(graph.sessions).toHaveLength(2);
    expect(graph.root.records.find((record) => record.fullId === "agent-use")?.childSession?.sessionId).toBe("child");
  });

  it("reuses a shared child parse cache across resolutions", async () => {
    const childPath = "/repo/session-graph/subagents/agent-child.jsonl";
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:02.000Z",
        "agent-use",
        "done",
        { agentId: "child" }
      )
    ]);
    const childText = jsonl([
      userEvent("child", "child-user", "1970-01-01T00:00:01.000Z", "child prompt")
    ]);
    const bridges = createGraphBridges({
      files: { [childPath]: childText },
      directories: {
        "/repo/session-graph/subagents": [entry("agent-child.jsonl")],
        "/repo/session-graph/agents": [],
        "/repo/session-graph/subagents/workflows": []
      }
    });
    const childCache = createSessionParseCache();

    const first = await resolveSessionGraph(
      parseJsonlText(rootText, "/repo/session-graph/main.jsonl"),
      bridges,
      { childCache }
    );
    const second = await resolveSessionGraph(
      parseJsonlText(rootText, "/repo/session-graph/main.jsonl"),
      bridges,
      { childCache }
    );

    expect(first.agentSessions.child?.sessionId).toBe("child");
    expect(second.agentSessions.child?.sessionId).toBe("child");
    expect(vi.mocked(bridges.fs.readText).mock.calls.filter(([path]) => path === childPath)).toHaveLength(1);
    expect(vi.mocked(bridges.fs.stat).mock.calls.filter(([path]) => path === childPath)).toHaveLength(2);
  });

  it("finds subagents in the session directory next to the session file", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:02.000Z",
        "agent-use",
        "done",
        { agentId: "child" }
      )
    ]);
    const childText = jsonl([
      userEvent("child", "child-user", "1970-01-01T00:00:01.000Z", "child prompt")
    ]);
    // Claude Code stores <project>/<sessionId>.jsonl with its agents under
    // <project>/<sessionId>/subagents, not next to the jsonl file.
    const bridges = createGraphBridges({
      files: { "/repo/real-layout/abc/subagents/agent-child.jsonl": childText },
      directories: {
        "/repo/real-layout/abc/subagents": [entry("agent-child.jsonl")],
        "/repo/real-layout/abc/agents": [],
        "/repo/real-layout/abc/subagents/workflows": []
      }
    });

    const graph = await resolveSessionGraph(
      parseJsonlText(rootText, "/repo/real-layout/abc.jsonl"),
      bridges
    );

    expect(graph.agentPaths.child).toBe("/repo/real-layout/abc/subagents/agent-child.jsonl");
    expect(graph.agentSessions.child?.sessionId).toBe("child");
    expect(graph.unresolvedAgentToolIds).toEqual([]);
  });

  it("recursively resolves nested agents and falls back to agentId text", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:02.000Z",
        "agent-use",
        "done\nagentId: child"
      )
    ]);
    const childText = jsonl([
      userEvent("child", "child-user", "1970-01-01T00:00:01.000Z", "child prompt"),
      agentToolUse("child", "nested-use", "1970-01-01T00:00:02.000Z", "nested-use"),
      agentToolResult(
        "child",
        "nested-result",
        "1970-01-01T00:00:03.000Z",
        "nested-use",
        "done",
        { agentId: "grandchild" }
      )
    ]);
    const grandchildText = jsonl([
      userEvent("grandchild", "grandchild-user", "1970-01-01T00:00:01.000Z", "grandchild prompt"),
      assistantTextEvent(
        "grandchild",
        "grandchild-done",
        "1970-01-01T00:00:02.000Z",
        "grandchild finished"
      )
    ]);

    const bridges = createGraphBridges({
      files: {
        "/repo/session-graph/subagents/agent-child.jsonl": childText,
        "/repo/session-graph/subagents/agents/agent-grandchild.jsonl": grandchildText
      },
      directories: {
        "/repo/session-graph/subagents": [entry("agent-child.jsonl")],
        "/repo/session-graph/subagents/agents": [entry("agent-grandchild.jsonl")],
        "/repo/session-graph/subagents/workflows": []
      }
    });

    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");
    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.agentSessions.child?.sessionId).toBe("child");
    expect(
      graph.agentSessions.child?.records.find((record) => record.fullId === "nested-use")
        ?.childSession?.sessionId
    ).toBe("grandchild");
    expect(graph.sessions.map((session) => session.sessionId)).toEqual([
      "grandchild",
      "child",
      "root"
    ]);
  });

  it("reuses a cached child session without duplicating warnings", async () => {
    const childPath = "/repo/duplicate/subagents/agent-shared.jsonl";
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use-1", "1970-01-01T00:00:01.000Z", "agent-use-1"),
      agentToolResult(
        "root",
        "agent-result-1",
        "1970-01-01T00:00:02.000Z",
        "agent-use-1",
        "done",
        { agentId: "shared" }
      ),
      agentToolUse("root", "agent-use-2", "1970-01-01T00:00:03.000Z", "agent-use-2"),
      agentToolResult(
        "root",
        "agent-result-2",
        "1970-01-01T00:00:04.000Z",
        "agent-use-2",
        "done",
        { agentId: "shared" }
      )
    ]);
    const childText = jsonl([
      userEvent("shared", "shared-user", "1970-01-01T00:00:01.000Z", "shared prompt")
    ]);
    const bridges = createGraphBridges({
      files: { [childPath]: childText },
      directories: {
        "/repo/duplicate/subagents": [entry("agent-shared.jsonl")],
        "/repo/duplicate/agents": [],
        "/repo/duplicate/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/duplicate/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.warnings).toEqual([]);
    expect(vi.mocked(bridges.fs.readText).mock.calls.filter(([path]) => path === childPath)).toHaveLength(1);
    expect(graph.root.records.filter((record) => record.toolCategory === "delegated")).toHaveLength(2);
  });

  it("prefers the first discovered path for a duplicate agentId", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:02.000Z",
        "agent-use",
        "done",
        { agentId: "dup" }
      )
    ]);
    const childText = jsonl([
      userEvent("dup", "dup-user", "1970-01-01T00:00:01.000Z", "dup prompt")
    ]);
    const bridges = createGraphBridges({
      files: {
        "/repo/duplicate-agent/subagents/agent-dup.jsonl": childText,
        "/repo/duplicate-agent/agents/agent-dup.jsonl": childText
      },
      directories: {
        "/repo/duplicate-agent/subagents": [entry("agent-dup.jsonl")],
        "/repo/duplicate-agent/agents": [entry("agent-dup.jsonl")],
        "/repo/duplicate-agent/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/duplicate-agent/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.agentPaths.dup).toBe("/repo/duplicate-agent/subagents/agent-dup.jsonl");
  });

  it("detects a cycle without infinite recursion", async () => {
    const agentAPath = "/repo/cycle/subagents/agent-a.jsonl";
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "root-agent-use", "1970-01-01T00:00:01.000Z", "root-agent-use"),
      agentToolResult(
        "root",
        "root-agent-result",
        "1970-01-01T00:00:02.000Z",
        "root-agent-use",
        "done",
        { agentId: "a" }
      )
    ]);
    const agentAText = jsonl([
      userEvent("a", "a-user", "1970-01-01T00:00:01.000Z", "agent a"),
      agentToolUse("a", "cycle-use", "1970-01-01T00:00:02.000Z", "cycle-use"),
      agentToolResult(
        "a",
        "cycle-result",
        "1970-01-01T00:00:03.000Z",
        "cycle-use",
        "done",
        { agentId: "a" }
      )
    ]);
    const bridges = createGraphBridges({
      files: { [agentAPath]: agentAText },
      directories: {
        "/repo/cycle/subagents": [entry("agent-a.jsonl")],
        "/repo/cycle/agents": [],
        "/repo/cycle/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/cycle/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.cyclePaths).toContain(agentAPath);
    expect(graph.warnings.join("\n")).toContain("循环引用");
    expect(vi.mocked(bridges.fs.readText).mock.calls.filter(([path]) => path === agentAPath)).toHaveLength(1);
  });

  it("truncates graphs deeper than four", async () => {
    const paths = Array.from({ length: 5 }, (_, index) =>
      `/repo/depth/subagents/agent-child${index + 1}.jsonl`
    );
    const rootRecords = [
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "root-agent-use", "1970-01-01T00:00:01.000Z", "root-agent-use"),
      agentToolResult(
        "root",
        "root-agent-result",
        "1970-01-01T00:00:02.000Z",
        "root-agent-use",
        "done",
        { agentId: "child1" },
        { childSessionPath: paths[0] }
      )
    ];
    const files: Record<string, string> = {};
    for (const [index, path] of paths.entries()) {
      const sessionId = `child${index + 1}`;
      const nextPath = paths[index + 1];
      const records: Array<Record<string, unknown>> = [
        userEvent(sessionId, `${sessionId}-user`, "1970-01-01T00:00:01.000Z", `${sessionId} prompt`)
      ];
      if (nextPath) {
        records.push(
          agentToolUse(
            sessionId,
            `${sessionId}-agent-use`,
            "1970-01-01T00:00:02.000Z",
            `${sessionId}-agent-use`
          ),
          agentToolResult(
            sessionId,
            `${sessionId}-agent-result`,
            "1970-01-01T00:00:03.000Z",
            `${sessionId}-agent-use`,
            "done",
            { agentId: `child${index + 2}` },
            { childSessionPath: nextPath }
          )
        );
      }
      files[path] = jsonl(records);
    }
    const bridges = createGraphBridges({
      files,
      directories: {
        "/repo/depth/subagents": paths.map((path) => entry(path.split("/").at(-1)!)),
        "/repo/depth/agents": [],
        "/repo/depth/subagents/workflows": []
      }
    });
    const root = parseJsonlText(
      jsonl(rootRecords),
      "/repo/depth/main.jsonl"
    );

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.depthTruncatedPaths).toContain(paths[4]);
    expect(graph.agentSessions.child4).toBeDefined();
    expect(graph.agentSessions.child5).toBeUndefined();
    expect(graph.sessions.map((session) => session.sessionId)).toEqual([
      "child4",
      "child3",
      "child2",
      "child1",
      "root"
    ]);
  });
});

describe("graph duration options", () => {
  it("builds duration overrides from resolved sessions", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:02.000Z",
        "agent-use",
        "done",
        { agentId: "child" }
      ),
      workflowToolUse("root", "workflow-use", "1970-01-01T00:00:03.000Z", "workflow-use"),
      workflowToolResult(
        "root",
        "workflow-result",
        "1970-01-01T00:00:04.000Z",
        "workflow-use",
        {
          runId: "run-1",
          workflowName: "Release",
          taskId: "task-1",
          scriptPath: "",
          status: "completed"
        }
      )
    ]);
    const childText = jsonl([
      userEvent("child", "child-user", "1970-01-01T00:00:01.000Z", "child prompt"),
      assistantTextEvent("child", "child-done", "1970-01-01T00:00:01.500Z", "child finished")
    ]);
    const workflowJson = JSON.stringify({
      workflowName: "Release",
      summary: "",
      status: "completed",
      startTime: 3000,
      durationMs: 500,
      agentCount: 1,
      totalTokens: 42,
      totalToolCalls: 3,
      phases: [{ title: "Plan" }],
      logs: [],
      result: "released"
    });
    const bridges = createGraphBridges({
      files: {
        "/repo/duration/subagents/agent-child.jsonl": childText,
        "/repo/duration/subagents/workflows/run-1.json": workflowJson
      },
      directories: {
        "/repo/duration/subagents": [entry("agent-child.jsonl")],
        "/repo/duration/agents": [],
        "/repo/duration/subagents/workflows": [entry("run-1", "dir")]
      }
    });
    const root = parseJsonlText(rootText, "/repo/duration/main.jsonl");
    const graph = await resolveSessionGraph(root, bridges);
    const options = durationBreakdownOptionsFromGraph(graph);

    expect(options.childSessionIntervals?.child).toEqual({ start: 1000, end: 1500 });
    expect(options.workflowIntervals?.["run-1"]).toEqual({ start: 3000, end: 3500 });
  });
});

describe("resolveSessionGraph workflows", () => {
  it("resolves the representative session graph fixture", async () => {
    const files = {
      "/repo/session-graph/main.jsonl": mainFixture,
      "/repo/session-graph/subagents/agent-child.jsonl": childFixture,
      "/repo/session-graph/agents/agent-grandchild.jsonl": grandchildFixture,
      "/repo/session-graph/subagents/workflows/run-1.json": workflowFixture,
      "/repo/session-graph/subagents/workflows/run-1/agent-workflow-child.jsonl": workflowChildFixture
    };
    const directories = {
      "/repo/session-graph/subagents": [entry("agent-child.jsonl")],
      "/repo/session-graph/agents": [entry("agent-grandchild.jsonl")],
      "/repo/session-graph/subagents/workflows": [entry("run-1", "dir")],
      "/repo/session-graph/subagents/workflows/run-1": [entry("agent-workflow-child.jsonl")]
    };
    const bridges = createGraphBridges({ files, directories });
    const root = parseJsonlText(mainFixture, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.root.records.find((record) => record.fullId === "agent-use")?.childSession?.sessionId).toBe("graph-child");
    expect(
      graph.agentSessions.child?.records.find((record) => record.fullId === "nested-use")
        ?.childSession?.sessionId
    ).toBe("graph-grandchild");
    expect(graph.root.records.find((record) => record.fullId === "workflow-use")?.workflowRun).toMatchObject({
      runId: "run-1",
      workflowName: "Release",
      startTs: 3000,
      durationMs: 1000,
      phases: ["Plan", "Execute"]
    });
    expect(graph.root.records.find((record) => record.fullId === "workflow-use")?.childSessions?.[0]?.sessionId).toBe(
      "graph-workflow-child"
    );
    expect(graph.sessions).toHaveLength(4);
    expect(graph.warnings).toEqual([]);
  });

  it("parses workflow JSON and links workflow child agents", async () => {
    const workflowJson = JSON.stringify({
      workflowName: "Release",
      summary: "run release",
      status: "completed",
      startTime: 1000,
      durationMs: 500,
      agentCount: 1,
      totalTokens: 42,
      totalToolCalls: 3,
      phases: [{ title: "Plan" }],
      logs: ["started"],
      result: "released"
    });
    const childText = jsonl([
      userEvent("workflow-child", "workflow-child-user", "1970-01-01T00:00:01.000Z", "workflow prompt"),
      assistantTextEvent(
        "workflow-child",
        "workflow-child-done",
        "1970-01-01T00:00:02.000Z",
        "workflow child finished"
      )
    ]);
    const rootText = jsonl([
      workflowToolUse("root", "workflow-use", "1970-01-01T00:00:01.000Z", "workflow-use"),
      workflowToolResult(
        "root",
        "workflow-result",
        "1970-01-01T00:00:02.000Z",
        "workflow-use",
        {
          runId: "run-1",
          workflowName: "Release",
          taskId: "task-1",
          scriptPath: "/tmp/workflow.js",
          status: "completed"
        }
      )
    ]);

    const bridges = createGraphBridges({
      files: {
        "/repo/session-graph/subagents/workflows/run-1.json": workflowJson,
        "/repo/session-graph/subagents/workflows/run-1/agent-workflow-child.jsonl": childText
      },
      directories: {
        "/repo/session-graph/subagents/workflows": [entry("run-1", "dir")],
        "/repo/session-graph/subagents/workflows/run-1": [entry("agent-workflow-child.jsonl")]
      }
    });

    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");
    const graph = await resolveSessionGraph(root, bridges);
    const record = graph.root.records.find((item) => item.fullId === "workflow-use");

    expect(record?.workflowRun).toMatchObject({
      runId: "run-1",
      workflowName: "Release",
      startTs: 1000,
      durationMs: 500,
      phases: ["Plan"]
    });
    expect(record?.childSessions?.map((session) => session.sessionId)).toEqual(["workflow-child"]);
    expect(graph.workflowRuns["run-1"].workflowName).toBe("Release");
  });

  it("records unresolved workflows without throwing", async () => {
    const rootText = jsonl([
      workflowToolUse("root", "workflow-use", "1970-01-01T00:00:01.000Z", "workflow-use"),
      workflowToolResult(
        "root",
        "workflow-result",
        "1970-01-01T00:00:02.000Z",
        "workflow-use",
        {
          runId: "missing",
          workflowName: "Missing",
          taskId: "task-1",
          scriptPath: "",
          status: "failed"
        }
      )
    ]);
    const bridges = createGraphBridges({
      files: {},
      directories: {
        "/repo/session-graph/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);
    expect(graph.unresolvedWorkflowToolIds).toContain("workflow-use");
    expect(graph.warnings.join("\n")).toContain("Workflow 运行记录读取失败");
  });

  it("skips a workflow whose runId escapes the session directory", async () => {
    const rootText = jsonl([
      workflowToolUse("root", "workflow-use", "1970-01-01T00:00:01.000Z", "workflow-use"),
      workflowToolResult(
        "root",
        "workflow-result",
        "1970-01-01T00:00:02.000Z",
        "workflow-use",
        {
          runId: "../../secret",
          workflowName: "Escape",
          taskId: "task-1",
          scriptPath: "",
          status: "failed"
        }
      )
    ]);
    const bridges = createGraphBridges({
      files: {},
      directories: {
        "/repo/session-graph/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.unresolvedWorkflowToolIds).toContain("workflow-use");
    expect(graph.warnings.join("\n")).toContain("runId 非法");
    expect(
      vi.mocked(bridges.fs.readText).mock.calls.some(([path]) => path.includes("secret"))
    ).toBe(false);
  });

  it("warns and keeps going when the workflow JSON is invalid", async () => {
    const rootText = jsonl([
      workflowToolUse("root", "workflow-use", "1970-01-01T00:00:01.000Z", "workflow-use"),
      workflowToolResult(
        "root",
        "workflow-result",
        "1970-01-01T00:00:02.000Z",
        "workflow-use",
        {
          runId: "run-1",
          workflowName: "Broken",
          taskId: "task-1",
          scriptPath: "",
          status: "failed"
        }
      )
    ]);
    const bridges = createGraphBridges({
      files: { "/repo/session-graph/subagents/workflows/run-1.json": "{invalid" },
      directories: {
        "/repo/session-graph/subagents/workflows": [entry("run-1.json")]
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.unresolvedWorkflowToolIds).toContain("workflow-use");
    expect(graph.warnings.join("\n")).toContain("Workflow 运行记录读取失败");
  });

  it("detects a workflow child cycle without infinite recursion", async () => {
    const childPath = "/repo/session-graph/subagents/workflows/run-1/agent-cycle.jsonl";
    const workflowJson = JSON.stringify({
      workflowName: "Cycle",
      summary: "cycle",
      status: "failed",
      startTime: 1000,
      durationMs: 100,
      agentCount: 1,
      totalTokens: 1,
      totalToolCalls: 1,
      phases: [],
      logs: [],
      result: "cycle"
    });
    const childText = jsonl([
      userEvent("workflow-child", "workflow-child-user", "1970-01-01T00:00:01.000Z", "workflow child"),
      workflowToolUse("workflow-child", "workflow-cycle-use", "1970-01-01T00:00:02.000Z", "workflow-cycle-use"),
      workflowToolResult(
        "workflow-child",
        "workflow-cycle-result",
        "1970-01-01T00:00:03.000Z",
        "workflow-cycle-use",
        {
          runId: "run-1",
          workflowName: "Cycle",
          taskId: "task-1",
          scriptPath: "/tmp/workflow.js",
          status: "failed"
        }
      )
    ]);
    const rootText = jsonl([
      workflowToolUse("root", "workflow-use", "1970-01-01T00:00:01.000Z", "workflow-use"),
      workflowToolResult(
        "root",
        "workflow-result",
        "1970-01-01T00:00:02.000Z",
        "workflow-use",
        {
          runId: "run-1",
          workflowName: "Cycle",
          taskId: "task-1",
          scriptPath: "/tmp/workflow.js",
          status: "failed"
        }
      )
    ]);

    const bridges = createGraphBridges({
      files: {
        "/repo/session-graph/subagents/workflows/run-1.json": workflowJson,
        [childPath]: childText
      },
      directories: {
        "/repo/session-graph/subagents/workflows": [entry("run-1", "dir")],
        "/repo/session-graph/subagents/workflows/run-1": [entry("agent-cycle.jsonl")]
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.cyclePaths).toContain(childPath);
    expect(graph.warnings.join("\n")).toContain("循环引用");
    expect(vi.mocked(bridges.fs.readText).mock.calls.filter(([path]) => path === childPath)).toHaveLength(1);
    expect(graph.sessions.map((session) => session.sessionId)).toEqual(["workflow-child", "root"]);
  });
});

describe("resolveSessionGraph robustness", () => {
  it("warns when an indexed child session cannot be read", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:03.000Z",
        "agent-use",
        "done",
        { agentId: "child" }
      )
    ]);
    const bridges = createGraphBridges({
      // The directory index knows the child, but reading it fails.
      files: {},
      directories: {
        "/repo/session-graph/subagents": [entry("agent-child.jsonl")],
        "/repo/session-graph/agents": [],
        "/repo/session-graph/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.sessions).toHaveLength(1);
    expect(graph.unresolvedAgentToolIds).toEqual(["agent-use"]);
    expect(graph.warnings.join("\n")).toContain("Agent 子会话读取失败");
    expect(graph.warnings.join("\n")).not.toContain("未找到 Agent 子会话");
  });

  it("ignores unreadable subagent and workflow directories", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:03.000Z",
        "agent-use",
        "done",
        { agentId: "child" }
      )
    ]);
    const bridges = createGraphBridges();
    bridges.fs.readDir = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    // Directory scanning is best effort: no crash, and the missing child is
    // reported as an unresolved agent rather than as a directory error.
    expect(graph.sessions).toHaveLength(1);
    expect(graph.agentPaths).toEqual({});
    expect(graph.unresolvedAgentToolIds).toEqual(["agent-use"]);
    expect(graph.warnings.join("\n")).toContain("未找到 Agent 子会话");
    expect(graph.warnings.join("\n")).not.toContain("EACCES");
  });
});

describe("session graph path scoping", () => {
  it("refuses to read a child session outside the session tree", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:03.000Z",
        "agent-use",
        "done",
        undefined,
        { childSessionPath: "/etc/passwd" }
      )
    ]);
    const bridges = createGraphBridges({
      files: { "/etc/passwd": "root:x:0:0:root:/root:/bin/sh" },
      directories: {
        "/repo/session-graph/subagents": [],
        "/repo/session-graph/agents": [],
        "/repo/session-graph/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.warnings.join("\n")).toContain("已忽略越界的子会话路径：/etc/passwd");
    expect(graph.unresolvedAgentToolIds).toEqual(["agent-use"]);
    expect(vi.mocked(bridges.fs.readText).mock.calls.map(([path]) => path)).not.toContain(
      "/etc/passwd"
    );
    expect(graph.sessions).toHaveLength(1);
  });

  it("still resolves a child session inside the session directory", async () => {
    const rootText = jsonl([
      userEvent("root", "root-user", "1970-01-01T00:00:00.000Z", "start"),
      agentToolUse("root", "agent-use", "1970-01-01T00:00:01.000Z", "agent-use"),
      agentToolResult(
        "root",
        "agent-result",
        "1970-01-01T00:00:03.000Z",
        "agent-use",
        "done",
        undefined,
        { childSessionPath: "/repo/session-graph/subagents/agent-child.jsonl" }
      )
    ]);
    const childText = jsonl([
      userEvent("child", "child-user", "1970-01-01T00:00:01.000Z", "child prompt")
    ]);
    const bridges = createGraphBridges({
      files: { "/repo/session-graph/subagents/agent-child.jsonl": childText },
      directories: {
        "/repo/session-graph/subagents": [],
        "/repo/session-graph/agents": [],
        "/repo/session-graph/subagents/workflows": []
      }
    });
    const root = parseJsonlText(rootText, "/repo/session-graph/main.jsonl");

    const graph = await resolveSessionGraph(root, bridges);

    expect(graph.warnings).toEqual([]);
    expect(graph.sessions).toHaveLength(2);
    expect(
      graph.root.records.find((record) => record.fullId === "agent-use")?.childSession?.sessionId
    ).toBe("child");
  });
});
