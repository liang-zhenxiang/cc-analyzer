import { describe, expect, it } from "vitest";
import { buildLogRows, tokensOf } from "./logRows";
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

function turn(index: number, records: SessionRecord[]): Turn {
  return { index, startedAt: 0, endedAt: 1000, records };
}

describe("buildLogRows", () => {
  it("inserts a wait row for the gap between two turns", () => {
    const user1 = base("user-1", { kind: "user", timestamp: 100, text: "第一轮" });
    const assistant1 = base("llm-1", { kind: "assistant", timestamp: 200, text: "答" });
    const user2 = base("user-2", { kind: "user", timestamp: 900, text: "第二轮" });
    const assistant2 = base("llm-2", { kind: "assistant", timestamp: 1000, text: "答二" });

    const rows = buildLogRows(
      [user1, assistant1, user2, assistant2],
      [turn(0, [user1, assistant1]), turn(1, [user2, assistant2])]
    );

    const gap = rows.find((row) => row.gap);
    expect(gap).toMatchObject({
      id: "gap#1",
      label: "等用户",
      summary: "等待用户输入（轮间间隙）",
      timestamp: 200,
      durationMs: 700,
      status: "na",
      tokens: null,
      records: []
    });
    // Both turns merge into 用户+LLM rows that sit at the model timestamp, so
    // the gap row (200 → 900) sorts between them.
    expect(rows.map((row) => row.timestamp)).toEqual([200, 200, 1000]);
  });

  it("skips the gap when the previous turn produced no model or tool activity", () => {
    const user1 = base("user-1", { kind: "user", timestamp: 100, text: "第一轮" });
    const user2 = base("user-2", { kind: "user", timestamp: 900, text: "第二轮" });

    const rows = buildLogRows([user1, user2], [turn(0, [user1]), turn(1, [user2])]);

    expect(rows.some((row) => row.gap)).toBe(false);
  });

  it("skips the gap when the next prompt arrives before activity ends", () => {
    const user1 = base("user-1", { kind: "user", timestamp: 100, text: "第一轮" });
    const tool1 = base("tool-1", {
      toolName: "Bash",
      toolCategory: "direct",
      timestamp: 200,
      durationMs: 5000
    });
    const user2 = base("user-2", { kind: "user", timestamp: 900, text: "第二轮" });

    const rows = buildLogRows([user1, tool1, user2], [turn(0, [user1, tool1]), turn(1, [user2])]);

    expect(rows.some((row) => row.gap)).toBe(false);
  });

  it("merges the first user prompt and model response of a turn", () => {
    const user = base("user-1", {
      kind: "user",
      timestamp: 100,
      text: "帮我看看这个解析器"
    });
    const assistant = base("llm-1", {
      kind: "assistant",
      timestamp: 400,
      model: "claude-sonnet-4",
      text: "我先读一下解析器",
      usage: { inputTokens: 10, outputTokens: 5 }
    });

    const rows = buildLogRows([user, assistant], [turn(0, [user, assistant])]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "用户+LLM",
      action: "提问 + claude-sonnet-4",
      timestamp: 400,
      durationMs: 300,
      mergedWith: "user",
      tokens: { prompt: 10, output: 5 }
    });
    expect(rows[0].records).toEqual([user, assistant]);
  });

  it("keeps later model responses as their own rows", () => {
    const user = base("user-1", { kind: "user", timestamp: 100, text: "开始" });
    const first = base("llm-1", { kind: "assistant", timestamp: 200, text: "第一步" });
    const second = base("llm-2", { kind: "assistant", timestamp: 700, text: "第二步" });

    const rows = buildLogRows([user, first, second], [turn(0, [user, first, second])]);

    expect(rows.map((row) => row.id)).toEqual(["turn-user-1", "llm-2"]);
    expect(rows[1].label).toBe("LLM");
  });

  it("derives tool kinds, actions, and structured summaries", () => {
    const read = base("read-1", {
      toolName: "Read",
      toolCategory: "direct",
      timestamp: 10,
      durationMs: 40,
      toolResult: "file body",
      structuredResult: { toolName: "Read", filePath: "/repo/src/parse.ts" }
    });
    const agent = base("agent-1", {
      toolName: "Agent",
      toolCategory: "delegated",
      timestamp: 100,
      durationMs: 50,
      structuredResult: {
        toolName: "Agent",
        agentId: "a1",
        agentType: "explorer",
        totalDurationMs: null,
        totalTokens: null,
        totalToolUseCount: null,
        isAsync: false,
        description: "梳理解析流程",
        resolvedModel: "claude-sonnet-4"
      }
    });
    const workflow = base("workflow-1", {
      toolName: "Workflow",
      toolCategory: "workflow",
      timestamp: 200,
      durationMs: 60,
      structuredResult: {
        toolName: "Workflow",
        runId: "run-1",
        taskId: "t1",
        workflowName: "Release",
        scriptPath: "",
        status: "completed"
      }
    });

    const rows = buildLogRows([read, agent, workflow]);

    expect(rows.map((row) => row.kind)).toEqual(["tool", "subagent", "workflow"]);
    expect(rows[0]).toMatchObject({ action: "Read", summary: "/repo/src/parse.ts" });
    expect(rows[1]).toMatchObject({ action: "Agent · explorer", summary: "梳理解析流程" });
    expect(rows[2]).toMatchObject({ action: "Workflow · Release", summary: "Release" });
  });

  it("reports the whole prompt, cached or not, and marks failures", () => {
    const record = base("llm-1", {
      kind: "assistant",
      usage: {
        inputTokens: 3,
        outputTokens: 7,
        cacheCreationTokens: 11,
        cacheReadTokens: 100
      }
    });
    // 114 = 3 input + 11 cache write + 100 cache read. The field is `prompt`, not
    // `input`: calling 114 "输入" is what made the log column unreadable.
    expect(tokensOf(record)).toEqual({ prompt: 114, output: 7 });

    const failed = buildLogRows([
      base("tool-1", { toolName: "Bash", toolCategory: "direct", isError: true })
    ]);
    expect(failed[0].status).toBe("error");

    const user = buildLogRows([base("user-1", { kind: "user", text: "hi" })]);
    expect(user[0].status).toBe("na");
  });

  it("leaves rows unmerged when the turn pairing is unavailable", () => {
    const user = base("user-1", { kind: "user", timestamp: 100, text: "hi" });
    const assistant = base("llm-1", { kind: "assistant", timestamp: 200, text: "hello" });

    const rows = buildLogRows([user, assistant]);

    expect(rows.map((row) => row.id)).toEqual(["user-1", "llm-1"]);
    expect(rows.every((row) => row.mergedWith === null)).toBe(true);
  });

  it("folds a model response that started one tool into an LLM+工具 row", () => {
    const user = base("user-1", { kind: "user", timestamp: 0, text: "跑一下" });
    const first = base("llm-1", { kind: "assistant", timestamp: 100, text: "先看看" });
    const second = base("llm-2", {
      kind: "assistant",
      timestamp: 300,
      text: "执行",
      usage: { inputTokens: 30, outputTokens: 5 },
      contentBlocks: [{ type: "tool_use", id: "tool-1", name: "Bash" }]
    });
    const tool = base("tool-1", {
      toolName: "Bash",
      toolCategory: "direct",
      timestamp: 350,
      durationMs: 50
    });
    const turns = [turn(0, [user, first, second, tool])];

    const rows = buildLogRows([user, first, second, tool], turns);

    expect(rows.map((row) => row.label)).toEqual(["用户+LLM", "LLM+工具"]);
    expect(rows[0].durationMs).toBe(100);
    expect(rows[1]).toMatchObject({
      action: "tool_use + Bash",
      mergedWith: "tool",
      durationMs: 300,
      tokens: { prompt: 30, output: 5 }
    });
  });

  it("keeps a model response with several tools as its own row", () => {
    const user = base("user-1", { kind: "user", timestamp: 0, text: "跑一下" });
    const first = base("llm-1", { kind: "assistant", timestamp: 100, text: "先看看" });
    const second = base("llm-2", {
      kind: "assistant",
      timestamp: 300,
      text: "并行执行",
      contentBlocks: [
        { type: "tool_use", id: "tool-1", name: "Bash" },
        { type: "tool_use", id: "tool-2", name: "Read" }
      ]
    });
    const tool1 = base("tool-1", {
      toolName: "Bash",
      toolCategory: "direct",
      timestamp: 350,
      durationMs: 10
    });
    const tool2 = base("tool-2", {
      toolName: "Read",
      toolCategory: "direct",
      timestamp: 360,
      durationMs: 10
    });
    const turns = [turn(0, [user, first, second, tool1, tool2])];

    const rows = buildLogRows([user, first, second, tool1, tool2], turns);

    expect(rows.map((row) => row.label)).toEqual(["用户+LLM", "LLM", "工具", "工具"]);
  });

  it("attributes the gap before a standalone model response as its duration", () => {
    const user = base("user-1", { kind: "user", timestamp: 0, text: "开始" });
    const first = base("llm-1", { kind: "assistant", timestamp: 100, text: "第一步" });
    const second = base("llm-2", { kind: "assistant", timestamp: 600, text: "第二步" });
    const turns = [turn(0, [user, first, second])];

    const rows = buildLogRows([user, first, second], turns);

    expect(rows.map((row) => row.label)).toEqual(["用户+LLM", "LLM"]);
    expect(rows[1].durationMs).toBe(500);
  });
});
