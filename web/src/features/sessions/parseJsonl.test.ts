import { describe, expect, it } from "vitest";
import { parseJsonlText, parseJsonlTextAsync } from "./parseJsonl";

import fixture from "../../../tests/fixtures/session-basic.jsonl?raw";
import enhancedFixture from "../../../tests/fixtures/session-parser-enhanced.jsonl?raw";
import tokenFixture from "../../../tests/fixtures/session-token-usage.jsonl?raw";

describe("parseJsonlText", () => {
  it("produces the same session as the chunked async parser", async () => {
    const sync = parseJsonlText(enhancedFixture, "/tmp/session.jsonl");
    const progress: number[] = [];
    const chunked = await parseJsonlTextAsync(
      enhancedFixture,
      "/tmp/session.jsonl",
      {},
      (fraction) => progress.push(fraction)
    );

    expect(chunked).toEqual(sync);
    expect(progress.at(-1)).toBe(1);
  });

  it("yields between chunks for large sessions", async () => {
    const line = JSON.stringify({
      type: "user",
      sessionId: "big",
      timestamp: "1970-01-01T00:00:01.000Z",
      uuid: "big-user",
      message: { role: "user", content: "hello" }
    });
    const text = Array.from({ length: 4500 }, () => line).join("\n");
    const progress: number[] = [];

    const parsed = await parseJsonlTextAsync(text, "/tmp/big.jsonl", {}, (fraction) =>
      progress.push(fraction)
    );

    expect(parsed.records).toHaveLength(4500);
    // Two chunk boundaries (2000/4000) plus the final 1.
    expect(progress.filter((fraction) => fraction < 1)).toHaveLength(2);
  });

  it("pairs tool_use with tool_result from message content", () => {
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");
    expect(session.sessionId).toBe("3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11");
    expect(session.cwd).toBe("/repo/demo");

    const assistant = session.records.find((record) => record.fullId === "assistant-1");
    expect(assistant).toMatchObject({
      kind: "assistant",
      model: "claude-sonnet-4",
      text: "我先读取示例文件。",
      usage: { inputTokens: 12, outputTokens: 34 }
    });

    const tool = session.records.find((record) => record.fullId === "tool-1");
    expect(tool).toMatchObject({
      kind: "tool",
      timestamp: Date.parse("2026-01-02T03:04:08.000Z"),
      durationMs: 1500,
      toolName: "Read",
      toolCategory: "direct",
      isError: false,
      toolResult: "export const app = 1;"
    });
    expect(tool?.toolInput).toEqual({ filePath: "/repo/demo/app.ts" });
  });

  it("groups real turns and records the wall-clock span", () => {
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");
    expect(session.turns).toHaveLength(2);
    expect(session.turns[0].records.map((record) => record.kind)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant"
    ]);
    expect(session.turns[0].startedAt).toBe(Date.parse("2026-01-02T03:04:05.000Z"));
    expect(session.turns[0].endedAt).toBe(Date.parse("2026-01-02T03:04:11.000Z"));
    expect(session.startedAt).toBe(session.turns[0].startedAt);
    expect(session.endedAt).toBe(Date.parse("2026-01-02T03:05:01.000Z"));
  });

  it.each([
    ["Agent", "delegated"],
    ["Task", "delegated"],
    ["Workflow", "workflow"],
    ["AskUserQuestion", "wait"],
    ["Read", "direct"]
  ] as const)("classifies %s as %s", (toolName, expected) => {
    const session = parseJsonlText(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-02T03:04:08.000Z",
        message: { id: "msg", model: "claude", content: [{ type: "tool_use", id: "tool-1", name: toolName, input: {} }] }
      }),
      "/tmp/tool.jsonl"
    );
    const tool = session.records.find((record) => record.kind === "tool");
    expect(tool?.toolCategory).toBe(expected);
  });

  it("leaves records without a tool name unclassified", () => {
    const session = parseJsonlText(
      JSON.stringify({ type: "user", timestamp: "2026-01-02T03:04:05.000Z", message: { content: "hello" } }),
      "/tmp/user.jsonl"
    );
    expect(session.records[0].toolName).toBeUndefined();
    expect(session.records[0].toolCategory).toBeUndefined();
  });

  it("retains top-level child-session links", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:08.000Z",
          uuid: "assistant-tool",
          message: { id: "msg", model: "claude", content: [{ type: "tool_use", id: "tool-1", name: "Agent", input: {} }] }
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-02T03:04:10.000Z",
          uuid: "tool-result",
          childSessionId: "child-1",
          childSessionPath: "/tmp/child-1.jsonl",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }] }
        })
      ].join("\n"),
      "/tmp/parent.jsonl"
    );
    const tool = session.records.find((record) => record.kind === "tool");
    expect(tool?.childSessionId).toBe("child-1");
    expect(tool?.childSessionPath).toBe("/tmp/child-1.jsonl");
  });

  it("preserves an unmatched tool use with a warning", () => {
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");
    const unmatched = session.records.find((record) => record.fullId === "tool-unmatched");
    expect(unmatched?.unmatched).toBe(true);
    expect(session.unmatchedToolUses).toHaveLength(1);
    expect(session.unmatchedToolUses[0].fullId).toBe("tool-unmatched");
    expect(session.warnings.join(" ")).toContain("tool-unmatched");
  });

  it("does not discard malformed lines", () => {
    const session = parseJsonlText(`${fixture}\n{invalid}\n`, "/tmp/broken.jsonl");
    expect(session.records).toHaveLength(7);
    expect(session.warnings).toHaveLength(2);
    expect(session.warnings.join(" ")).toContain("第 9 行解析失败");
    expect(session.warnings.join(" ")).toContain("tool-unmatched");
  });
});

describe("PAR-002 parser metadata", () => {
  it("keeps the first valid metadata when later events conflict", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "progress",
          sessionId: "first-session",
          session_id: "first-session-id",
          cwd: "/repo/first",
          gitBranch: "first-branch",
          version: "1.0.0",
          timestamp: "2026-01-02T03:04:05.000Z"
        }),
        JSON.stringify({
          type: "user",
          sessionId: "later-session",
          session_id: "later-session-id",
          cwd: "/repo/later",
          gitBranch: "later-branch",
          version: "2.0.0",
          timestamp: "2026-01-02T03:04:06.000Z",
          message: { content: "hello" }
        })
      ].join("\n"),
      "/tmp/metadata-conflict.jsonl"
    );

    expect(session.sessionId).toBe("first-session");
    expect(session.cwd).toBe("/repo/first");
    expect(session.gitBranch).toBe("first-branch");
    expect(session.version).toBe("1.0.0");
  });

  it("uses the first valid session_id and falls back to path only at return", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "progress",
          sessionId: "",
          timestamp: "2026-01-02T03:04:05.000Z"
        }),
        JSON.stringify({
          type: "user",
          session_id: "id-from-session-id-field",
          timestamp: "2026-01-02T03:04:06.000Z",
          message: { content: "hello" }
        })
      ].join("\n"),
      "/tmp/session-id-fallback.jsonl"
    );

    expect(session.sessionId).toBe("id-from-session-id-field");
    expect(session.path).toBe("/tmp/session-id-fallback.jsonl");
  });

  it("records system turn durations and skipped event counts", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({ type: "system", subtype: "turn_duration", timestamp: "2026-01-02T03:04:06.000Z", durationMs: 2500 }),
        JSON.stringify({ type: "progress", timestamp: "2026-01-02T03:04:06.100Z" }),
        JSON.stringify({ type: "system", timestamp: "2026-01-02T03:04:06.200Z" }),
        JSON.stringify({ type: "user", isMeta: true, timestamp: "2026-01-02T03:04:06.300Z", message: { content: "meta" } }),
        JSON.stringify({ type: "user", timestamp: "2026-01-02T03:04:07.000Z", message: { content: "hello" } })
      ].join("\n"),
      "/tmp/metadata.jsonl"
    );

    expect(session.systemTurnDurations).toEqual([
      { timestamp: Date.parse("2026-01-02T03:04:06.000Z"), durationMs: 2500 }
    ]);
    expect(session.skippedCounts).toEqual({
      progress: 1,
      system: 1,
      "user-meta": 1
    });
    expect(session.records.map((record) => record.text)).toEqual(["hello"]);
  });

  it("warns for a user event without a valid timestamp", () => {
    const session = parseJsonlText(
      JSON.stringify({ type: "user", message: { content: "no timestamp" } }),
      "/tmp/no-timestamp.jsonl"
    );

    expect(session.records).toEqual([]);
    expect(session.warnings).toHaveLength(1);
    expect(session.warnings[0]).toContain("缺少有效时间戳");
  });
});

describe("PAR-002 assistant aggregation", () => {
  it("aggregates assistant chunks by message id without summing usage", () => {
    const messageId = "msg-aggregate";
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:08.000Z",
          uuid: "assistant-chunk-1",
          message: {
            id: messageId,
            model: "claude",
            content: [{ type: "text", text: "第一段" }],
            usage: { input_tokens: 10, output_tokens: 5 }
          }
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:09.000Z",
          uuid: "assistant-chunk-2",
          message: {
            id: messageId,
            model: "claude",
            content: [{ type: "text", text: "第二段" }],
            usage: { input_tokens: 99, output_tokens: 99 }
          }
        })
      ].join("\n"),
      "/tmp/aggregate.jsonl"
    );

    expect(session.records).toHaveLength(1);
    const assistant = session.records[0];
    expect(assistant).toMatchObject({
      kind: "assistant",
      assistantMessageId: messageId,
      text: "第一段\n第二段",
      timestamp: Date.parse("2026-01-02T03:04:09.000Z"),
      usage: { inputTokens: 10, outputTokens: 5 }
    });
    expect(assistant.sourceLineNumbers).toEqual([1, 2]);
    expect(assistant.contentBlocks?.map((block) => block.text)).toEqual(["第一段", "第二段"]);
  });

  it("moves main-session sidechain assistants out of records", () => {
    const sidechain = JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-02T03:04:08.000Z",
      uuid: "sidechain-1",
      isSidechain: true,
      message: { id: "sidechain-msg", model: "claude", content: [{ type: "text", text: "sidechain" }] }
    });
    const session = parseJsonlText(sidechain, "/tmp/sidechain.jsonl");
    expect(session.records).toEqual([]);
    expect(session.sidechainMessages).toHaveLength(1);
    expect(session.sidechainMessages[0]).toMatchObject({
      fullId: "sidechain-1",
      isSidechain: true,
      text: "sidechain"
    });

    const subagentSession = parseJsonlText(sidechain, "/tmp/subagent.jsonl", { isSubagent: true });
    expect(subagentSession.isSubagent).toBe(true);
    expect(subagentSession.records).toHaveLength(1);
    expect(subagentSession.sidechainMessages).toEqual([]);
  });

  it("keeps main-session sidechain tool uses out of records", () => {
    const session = parseJsonlText(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-02T03:04:08.000Z",
        uuid: "sidechain-1",
        isSidechain: true,
        message: {
          id: "sidechain-msg",
          model: "claude",
          content: [{ type: "tool_use", id: "sidechain-tool-1", name: "Read", input: { filePath: "/repo/app.ts" } }]
        }
      }),
      "/tmp/sidechain-tool.jsonl"
    );

    expect(session.records).toEqual([]);
    expect(session.sidechainMessages).toHaveLength(2);
    expect(session.sidechainMessages.find((record) => record.kind === "tool")).toMatchObject({
      fullId: "sidechain-tool-1",
      isSidechain: true,
      toolName: "Read",
      toolInput: { filePath: "/repo/app.ts" }
    });
  });

  it("pairs a main-session sidechain tool result with its sidechain tool use", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:08.000Z",
          uuid: "sidechain-1",
          isSidechain: true,
          message: {
            id: "sidechain-msg",
            model: "claude",
            content: [{ type: "tool_use", id: "sidechain-tool-1", name: "Read", input: {} }]
          }
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-02T03:04:10.000Z",
          isSidechain: true,
          message: {
            content: [{ type: "tool_result", tool_use_id: "sidechain-tool-1", content: "export const app = 1;", is_error: true }]
          }
        })
      ].join("\n"),
      "/tmp/sidechain-tool-result.jsonl"
    );

    expect(session.records).toEqual([]);
    expect(session.sidechainMessages.find((record) => record.kind === "tool")).toMatchObject({
      fullId: "sidechain-tool-1",
      durationMs: 2000,
      isError: true,
      toolResult: "export const app = 1;"
    });
    expect(session.warnings).toEqual([]);
    expect(session.unmatchedToolUses).toEqual([]);
  });

  it("uses source lines to break timestamp ties caused by assistant aggregation", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-02T03:04:10.000Z",
          uuid: "user-later-line",
          message: { content: "user" }
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:01.000Z",
          uuid: "assistant-earlier-line",
          message: { id: "aggregate-msg", model: "claude", content: [{ type: "text", text: "first" }] }
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:10.000Z",
          uuid: "assistant-later-line",
          message: { id: "aggregate-msg", model: "claude", content: [{ type: "text", text: "second" }] }
        })
      ].join("\n"),
      "/tmp/timestamp-tie.jsonl"
    );

    expect(session.records.map((record) => [record.lineNumber, record.text])).toEqual([
      [1, "user"],
      [2, "first\nsecond"]
    ]);
  });

  it("uses source lines to break sidechain timestamp ties", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:10.000Z",
          uuid: "sidechain-later-line",
          isSidechain: true,
          message: { id: "sidechain-later", model: "claude", content: [{ type: "text", text: "later line" }] }
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:01.000Z",
          uuid: "sidechain-earlier-line",
          isSidechain: true,
          message: { id: "sidechain-aggregate", model: "claude", content: [{ type: "text", text: "first" }] }
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:10.000Z",
          uuid: "sidechain-aggregate-later-line",
          isSidechain: true,
          message: { id: "sidechain-aggregate", model: "claude", content: [{ type: "text", text: "second" }] }
        })
      ].join("\n"),
      "/tmp/sidechain-timestamp-tie.jsonl"
    );

    expect(session.sidechainMessages.map((record) => [record.lineNumber, record.text])).toEqual([
      [1, "later line"],
      [2, "first\nsecond"]
    ]);
  });
});

describe("PAR-002 user metadata and tool results", () => {
  it("extracts command names and interruption metadata", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-02T03:04:05.000Z",
          message: { content: "<command-name>compact</command-name>" }
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-02T03:04:06.000Z",
          message: { content: "[Request interrupted by user for tool use]" }
        })
      ].join("\n"),
      "/tmp/commands.jsonl"
    );

    expect(session.records[0]).toMatchObject({ commandName: "compact", isInterrupt: false });
    expect(session.records[1]).toMatchObject({ commandName: null, isInterrupt: true });
  });

  it("attaches structured results and truncates oversized text", () => {
    const oversized = "x".repeat(5 * 1024 + 10);
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-01-02T03:04:07.000Z",
          message: { id: "msg", model: "claude", content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } }] }
        }),
        JSON.stringify({
          type: "user",
          timestamp: "2026-01-02T03:04:08.000Z",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: oversized }] },
          toolUseResult: { stdout: oversized, stderr: "", interrupted: false }
        })
      ].join("\n"),
      "/tmp/structured.jsonl"
    );

    const tool = session.records.find((record) => record.kind === "tool");
    expect(tool?.structuredResult).toEqual({
      toolName: "Bash",
      stdout: oversized,
      stderr: "",
      interrupted: false,
      timedOutAfterMs: null
    });
    expect(tool?.resultTruncated).toBe(true);
    expect(tool?.toolResult).toHaveLength(5 * 1024);
    const hintLength = `[Truncated: showing first ${5 * 1024} of ${oversized.length} characters]`.length;
    const retainedLength = 5 * 1024 - hintLength;
    expect(tool?.toolResult?.startsWith(oversized.slice(0, retainedLength))).toBe(true);
    expect(tool?.toolResult).toBe(
      `${oversized.slice(0, retainedLength)}[Truncated: showing first ${retainedLength} of ${oversized.length} characters]`
    );
    expect(tool?.durationMs).toBe(1000);
  });
});

describe("PAR-002 enhanced fixture", () => {
  it("preserves parser metadata, warnings, ordering, and structured results", () => {
    const session = parseJsonlText(enhancedFixture, "/tmp/session-parser-enhanced.jsonl");

    expect(session.sessionId).toBe("parser-session");
    expect(session.cwd).toBe("/repo/parser");
    expect(session.systemTurnDurations).toEqual([
      { timestamp: Date.parse("2026-01-02T06:00:01.000Z"), durationMs: 1500 }
    ]);
    expect(session.skippedCounts).toEqual({
      system: 1,
      progress: 1,
      "user-meta": 1,
      "user-task-notification": 1
    });

    const assistant = session.records.find(
      (record) => record.assistantMessageId === "assistant-message"
    );
    expect(assistant).toMatchObject({
      text: "开始",
      usage: { inputTokens: 10, outputTokens: 4 },
      sourceLineNumbers: [7, 9]
    });
    expect(session.sidechainMessages.map((record) => record.text)).toEqual(["sidechain"]);

    const bash = session.records.find((record) => record.fullId === "tool-bash");
    expect(bash).toMatchObject({
      durationMs: 1000,
      toolResult: "file one\nfile two",
      structuredResult: {
        toolName: "Bash",
        stdout: "file one\nfile two",
        stderr: "",
        interrupted: false,
        timedOutAfterMs: null
      }
    });
    const read = session.records.find((record) => record.fullId === "tool-read");
    expect(read?.structuredResult).toEqual({ toolName: "Read", filePath: "/repo/app.ts" });

    const tied = session.records.filter(
      (record) => record.assistantMessageId?.startsWith("tie-message")
    );
    expect(tied.map((record) => record.text)).toEqual(["tie a", "tie b"]);

    expect(session.unmatchedToolUses.map((record) => record.fullId)).toEqual(["tool-unmatched"]);
    expect(session.warnings.join("\n")).toContain("缺少有效时间戳");
    expect(session.warnings.join("\n")).toContain("解析失败");
  });
});

describe("PAR-002 token usage fixture", () => {
  it("extracts the four counters and the cache-creation TTL split", () => {
    const session = parseJsonlText(tokenFixture, "/tmp/session-token-usage.jsonl");

    const first = session.records.find((record) => record.assistantMessageId === "tok-msg-1");
    expect(first?.usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 1000,
      cacheReadTokens: 20000,
      cacheCreationFiveMinuteTokens: 600,
      cacheCreationOneHourTokens: 400
    });
  });

  it("leaves the TTL fields absent when upstream omits them", () => {
    const session = parseJsonlText(tokenFixture, "/tmp/session-token-usage.jsonl");

    const second = session.records.find((record) => record.assistantMessageId === "tok-msg-2");
    // Absent means "no breakdown reported", which the totals layer reads as a
    // zero — asserting the fields are missing keeps the parser from inventing one.
    expect(second?.usage).toEqual({
      inputTokens: 200,
      outputTokens: 60,
      cacheCreationTokens: 500,
      cacheReadTokens: 30000
    });

    const third = session.records.find((record) => record.assistantMessageId === "tok-msg-3");
    expect(third?.usage).toEqual({ inputTokens: 30, outputTokens: 10 });
  });
});

describe("parser defaults and malformed input", () => {
  it("returns an empty session for empty or whitespace-only files", () => {
    for (const text of ["", "\n\n"]) {
      const session = parseJsonlText(text, "/tmp/empty.jsonl");

      expect(session.sessionId).toBe("/tmp/empty.jsonl");
      expect(session.startedAt).toBe(0);
      expect(session.endedAt).toBe(0);
      expect(session.records).toEqual([]);
      expect(session.warnings).toEqual([]);
    }
  });

  it("counts unknown event types without creating records", () => {
    const session = parseJsonlText('{"type":"nothing-we-know"}', "/tmp/unknown.jsonl");

    expect(session.records).toEqual([]);
    expect(session.warnings).toEqual([]);
    // Skipped events are counted by their own type; lines without one are "unknown".
    expect(session.skippedCounts).toEqual({ "nothing-we-know": 1 });
    expect(parseJsonlText("{}", "/tmp/empty-object.jsonl").skippedCounts).toEqual({
      unknown: 1
    });
  });

  it("warns instead of guessing when an event has no usable timestamp", () => {
    const session = parseJsonlText('{"type":"user"}', "/tmp/no-fields.jsonl");

    expect(session.records).toEqual([]);
    expect(session.warnings).toHaveLength(1);
    expect(session.warnings[0]).toContain("缺少有效时间戳");
  });

  it("keeps a tool_use event that has no id", () => {
    const session = parseJsonlText(
      JSON.stringify({
        type: "assistant",
        timestamp: "1970-01-01T00:00:00.000Z",
        message: { id: "m", content: [{ type: "tool_use" }] }
      }),
      "/tmp/tool-without-id.jsonl"
    );

    expect(session.records).toHaveLength(1);
    expect(session.records[0].kind).toBe("assistant");
    expect(session.records[0].id).toBe("line-0");
    expect(session.warnings).toEqual([]);
  });
});
