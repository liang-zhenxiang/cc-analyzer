import { describe, expect, it } from "vitest";
import { buildLogRows, filterLogRows, tokensOf } from "./logRows";
import { emptyFilter } from "./filters";
import { parseJsonlText } from "./parseJsonl";
import type { SessionRecord, Turn } from "./types";
import ansiFixture from "../../../tests/fixtures/session-ansi.jsonl?raw";
import compactFixture from "../../../tests/fixtures/compact-session.jsonl?raw";

const ESC = "\u001b";

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

  it("keeps terminal escape sequences out of the table's one-line summaries", () => {
    // 夹具里的模型回复是 `\u001b[33m构建失败\u001b[0m：先修 …`：表格里必须只剩文字，
    // 否则用户看到的是一串控制字符，按可见文字搜也搜不到。
    const parsed = parseJsonlText(ansiFixture, "/repo/ansi/session.jsonl");
    const rows = buildLogRows(parsed.records, parsed.turns);

    const summaries = rows.map((row) => row.summary).join("\n");
    expect(summaries).not.toContain(ESC);
    // 颜色码被剥掉，但文字必须一字不少地留下——「按屏幕上的字搜」靠的就是它。
    expect(summaries).toContain("✓ 12 passed");
    expect(summaries).toContain("构建失败");
    expect(summaries).toContain("跑一下构建脚本");
  });

  it("does not blank a summary whose output ends with CRLF", () => {
    // 回归：把 `\r\n` 当「回到行首重写」会把整行清成空串——表格里那行会消失，
    // 搜索也搜不到。CRLF 是行尾，不是重写。
    const record = base("bash-crlf", {
      toolName: "Bash",
      toolCategory: "direct",
      text: "",
      toolResult: "line1\r\nline2\r\n"
    });
    const rows = buildLogRows([record], []);
    expect(rows[0].summary).toBe("line1");
    expect(rows[0].summary.length).toBeGreaterThan(0);
  });
});

/**
 * 压缩边界带行（J3，design §3）：用共享夹具 compact-session.jsonl（2 次压缩：
 * auto + manual，pre/post 齐全）走完整解析管线，断言注册、入序与摘要折叠。
 */
describe("buildLogRows · 压缩边界带行", () => {
  const parsed = parseJsonlText(compactFixture, "/repo/compact-demo/compact-session.jsonl");
  const events = parsed.compactEvents ?? [];
  const rows = buildLogRows(parsed.records, parsed.turns, events);

  const boundary1 = Date.UTC(2026, 2, 1, 9, 33, 57, 455);

  it("registers one full-width compact row per boundary, in boundary order", () => {
    const compactRows = rows.filter((row) => row.kind === "compact");
    expect(compactRows.map((row) => row.id)).toEqual([
      "compact-cs-boundary-001",
      "compact-cs-boundary-002"
    ]);
    expect(compactRows[0]).toMatchObject({
      kind: "compact",
      label: "压缩",
      action: "压缩 #1（自动）",
      summary: "167,400 → 11,200 tok · 丢弃 156,200 · 37.5s",
      timestamp: boundary1,
      status: "na",
      tokens: null,
      records: []
    });
    expect(compactRows[1].action).toBe("压缩 #2（手动）");
  });

  it("inserts the band row by boundary timestamp between its neighbours", () => {
    const index = rows.findIndex((row) => row.id === "compact-cs-boundary-001");
    expect(index).toBeGreaterThan(0);
    expect(rows[index - 1].timestamp).toBeLessThanOrEqual(boundary1);
    expect(rows[index + 1].timestamp).toBeGreaterThanOrEqual(boundary1);
  });

  it("folds the isCompactSummary message into the band row instead of a user row", () => {
    // 数据约束 #3：摘要是模型的重写工件，不是用户发言——表里不允许出现它的行。
    expect(rows.some((row) => row.records.some((record) => record.compactSummary === true))).toBe(
      false
    );
    const compact = rows.find((row) => row.id === "compact-cs-boundary-001")?.compact;
    expect(compact?.summaryRecord?.fullId).toBe("cs-summary-001");
    expect(compact?.summaryRecord?.text).toContain("This session is being continued");
  });

  it("resolves the survivor list against the session's records", () => {
    const compact = rows.find((row) => row.id === "compact-cs-boundary-001")?.compact;
    expect(compact?.survivors.map((record) => record.fullId)).toEqual([
      "cs-user-047",
      "cs-asst-047",
      "cs-user-048",
      "cs-asst-048",
      "cs-user-049",
      "cs-asst-049"
    ]);
  });

  it("synthesizes a system boundary record for the detail panel, outside records", () => {
    const compact = rows.find((row) => row.id === "compact-cs-boundary-001")?.compact;
    expect(compact?.record).toMatchObject({
      kind: "system",
      fullId: "cs-boundary-001",
      timestamp: boundary1
    });
    // 合成记录不进 row.records：报告与导出按记录聚合，不许被它污染。
    expect(rows.find((row) => row.id === "compact-cs-boundary-001")?.records).toEqual([]);
  });

  it("participates in the kind filter as 压缩", () => {
    const only = filterLogRows(rows, { ...emptyFilter, kinds: new Set(["compact"]) });
    expect(only.map((row) => row.kind)).toEqual(["compact", "compact"]);
    // 类型筛选不含压缩时，压缩行随其它类型一起被筛掉。
    const without = filterLogRows(rows, { ...emptyFilter, kinds: new Set(["user", "llm"]) });
    expect(without.some((row) => row.kind === "compact")).toBe(false);
  });

  it("matches the duration filter by compaction duration", () => {
    const slow = filterLogRows(rows, {
      ...emptyFilter,
      durationMode: "gt",
      minDurationMs: 40_000
    });
    // 37.455s 的 #1 被排除，41.2s 的 #2 留下。
    expect(slow.some((row) => row.id === "compact-cs-boundary-001")).toBe(false);
    expect(slow.some((row) => row.id === "compact-cs-boundary-002")).toBe(true);
  });
});
