import { describe, expect, it, vi } from "vitest";
import { parseJsonlText } from "./parseJsonl";
import {
  buildReport,
  buildFilteredReport,
  buildTimeBlockReport,
  buildWholeSessionReport,
  generateReport,
  ReportCancelledError,
  reportSignature
} from "./report";
import { emptyFilter } from "./filters";
import { buildLogRows, recordsOfRows } from "./logRows";
import { resetThresholds, setThresholds } from "../settings/thresholds";
import type { Bridges, ExecTextResult, RunLinesResult } from "../../api/types";
import type { ParsedSession, ParsedSessionGraph, SessionRecord, WorkflowRun } from "./types";
import fixture from "../../../tests/fixtures/session-basic.jsonl?raw";

type StreamHarness = {
  bridges: Bridges;
  runLines: ReturnType<typeof vi.fn>;
  release: () => void;
};

function createStreamHarness({
  streamSupported = true,
  lines = [],
  outcome = { ok: true, stderr: "" },
  hang = false
}: {
  streamSupported?: boolean;
  lines?: string[];
  outcome?: RunLinesResult;
  hang?: boolean;
} = {}): StreamHarness {
  let settle: ((value: RunLinesResult) => void) | null = null;
  const release = () => {
    settle?.({ ok: false, error: "分析已取消", stderr: "" });
    settle = null;
  };
  const runLines = vi.fn(
    async (
      _cmd: string,
      args: string[],
      _stdinText: string | null,
      _timeoutMs: number | null,
      _label: string | null,
      onLine: (line: string) => void,
      onStreamId?: (streamId: string) => void
    ): Promise<RunLinesResult> => {
      expect(args).toEqual(streamSupported ? ["-p", "--verbose", "--include-partial-messages", "--output-format", "stream-json"] : ["-p"]);
      onStreamId?.("stream-1");
      for (const line of lines) onLine(line);
      if (hang) {
        return new Promise<RunLinesResult>((resolve) => {
          settle = resolve;
        });
      }
      return outcome;
    }
  );
  const execText = vi.fn(async (): Promise<ExecTextResult> => ({
    ok: streamSupported,
    out: streamSupported ? "--include-partial-messages --output-format stream-json" : "",
    error: undefined
  }));

  return {
    runLines,
    release,
    bridges: {
      proc: { runLines, execText }
    } as unknown as Bridges
  };
}

/**
 * Gives a harness bridges a filesystem holding exactly `existing`. No version
 * manager is installed, so `readDir` fails for every root — the state a machine
 * relying on a plain PATH install is in.
 */
function attachFs(
  bridges: Bridges,
  { home = "/Users/tester", existing = [] }: { home?: string; existing?: string[] } = {}
): Bridges {
  (bridges as unknown as { fs: unknown }).fs = {
    homeDir: async () => home,
    stat: async (path: string) => {
      if (!existing.includes(path)) throw new Error("文件或目录不存在");
      return { is_file: true, size: 1, mtime_ms: 1 };
    },
    readDir: async () => {
      throw new Error("读取目录失败: 文件或目录不存在");
    }
  };
  return bridges;
}

function createGraphReportFixture() {
  const childSession: ParsedSession = {
    sessionId: "child",
    path: "/tmp/child.jsonl",
    isSubagent: true,
    startedAt: 0,
    endedAt: 500,
    records: [],
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    sidechainMessages: []
  };
  const base = parseJsonlText(fixture, "/tmp/session.jsonl");
  const agentRecord: SessionRecord = {
    ...base.records[0],
    fullId: "agent-use",
    kind: "tool",
    toolName: "Agent",
    toolCategory: "delegated",
    timestamp: 0,
    durationMs: 1000,
    childSessionId: "child",
    childSessionPath: "/tmp/child.jsonl",
    childSession
  };
  const workflowRun: WorkflowRun = {
    runId: "run-1",
    workflowName: "Release",
    summary: "",
    status: "completed",
    startTs: 1000,
    durationMs: 500,
    agentCount: 1,
    totalTokens: 42,
    totalToolCalls: 3,
    phases: ["Plan"],
    resultText: "released",
    resultTruncated: false,
    logs: []
  };
  const workflowRecord: SessionRecord = {
    ...base.records[0],
    fullId: "workflow-use",
    kind: "tool",
    toolName: "Workflow",
    toolCategory: "workflow",
    timestamp: 1000,
    durationMs: 1000,
    workflowRun
  };
  const session: ParsedSession = {
    ...base,
    sessionId: "graph-root",
    startedAt: 0,
    endedAt: 4000,
    records: [agentRecord, workflowRecord],
    turns: [{ index: 0, startedAt: 0, endedAt: 4000, records: [agentRecord, workflowRecord] }]
  };
  const graph: ParsedSessionGraph = {
    root: session,
    sessions: [session, childSession],
    agentPaths: { child: "/tmp/child.jsonl" },
    agentSessions: { child: childSession },
    workflowRuns: { "run-1": workflowRun },
    unresolvedAgentToolIds: [],
    unresolvedWorkflowToolIds: [],
    depthTruncatedPaths: [],
    cyclePaths: [],
    warnings: []
  };

  return { session, graph };
}

describe("report generation", () => {
  it("uses inter-turn gaps for whole session duration", () => {
    const base = parseJsonlText(fixture, "/tmp/session.jsonl");
    const record = { ...base.records[0], timestamp: 0, durationMs: 100 };
    const session: ParsedSession = {
      ...base,
      startedAt: 0,
      endedAt: 250,
      records: [record],
      turns: [
        { index: 0, startedAt: 0, endedAt: 100, records: [record] },
        { index: 1, startedAt: 150, endedAt: 200, records: [] }
      ]
    };

    const report = buildWholeSessionReport(session);

    expect(report).toContain("- 等用户: 50ms");
    expect(report).toContain("- 模型思考: 200ms");
  });

  it("includes whole and filtered report scopes", () => {
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");
    expect(buildWholeSessionReport(session)).toContain(`- 会话 ID: ${session.sessionId}`);
    expect(buildFilteredReport(session, session.records.slice(0, 1))).toContain("筛选后的 1 条记录");
  });

  it("includes time block scope", () => {
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");
    const report = buildTimeBlockReport(session, session.records, {
      start: session.startedAt,
      end: session.endedAt
    });
    expect(report).toContain("- 选区:");
  });

  it("reports the local tool union instead of summing overlapping categories", () => {
    const base = parseJsonlText(fixture, "/tmp/session.jsonl");
    const baseRecord = base.records[0];
    const direct = {
      ...baseRecord,
      fullId: "direct-overlap",
      kind: "tool" as const,
      toolName: "Read",
      toolCategory: "direct" as const,
      timestamp: 0,
      durationMs: 100
    };
    const delegated = {
      ...baseRecord,
      fullId: "delegated-overlap",
      kind: "tool" as const,
      toolName: "Agent",
      toolCategory: "delegated" as const,
      timestamp: 0,
      durationMs: 100
    };
    const session: ParsedSession = {
      ...base,
      startedAt: 0,
      endedAt: 200,
      records: [direct, delegated],
      turns: [{ index: 0, startedAt: 0, endedAt: 200, records: [direct, delegated] }]
    };

    const report = buildTimeBlockReport(session, session.records, {
      start: 0,
      end: 200
    });

    expect(report).toContain("- 本地工具: 100ms");
  });

  it("uses full session records for time block duration before clipping", () => {
    const base = parseJsonlText(fixture, "/tmp/session.jsonl");
    const record = {
      ...base.records[0],
      kind: "tool" as const,
      toolName: "Read",
      toolCategory: "direct" as const,
      timestamp: 0,
      durationMs: 200
    };
    const session: ParsedSession = {
      ...base,
      startedAt: 0,
      endedAt: 300,
      records: [record],
      turns: [
        { index: 0, startedAt: 0, endedAt: 100, records: [record] },
        { index: 1, startedAt: 120, endedAt: 300, records: [] }
      ]
    };

    // Empty records simulate a view filter dropping a tool whose interval
    // starts before the selected time block but overlaps it.
    const report = buildTimeBlockReport(session, [], {
      start: 50,
      end: 250
    });

    expect(report).toContain("- 本地工具: 150ms");
    expect(report).toContain("- 等用户: 0ms");
    expect(report).toContain("- 模型思考: 50ms");
  });

  it("uses graph-provided child and workflow intervals in whole reports", () => {
    const { session, graph } = createGraphReportFixture();
    const report = buildWholeSessionReport(session, graph);

    expect(report).toContain("- 子 agent: 500ms");
    expect(report).toContain("- workflow: 500ms");
  });

  it("clips graph-provided intervals in time block reports", () => {
    const { session, graph } = createGraphReportFixture();
    const report = buildTimeBlockReport(
      session,
      session.records,
      { start: 1200, end: 2000 },
      graph
    );

    expect(report).toContain("- 本地工具: 300ms");
    expect(report).toContain("- 模型思考: 500ms");
  });

  it("detects report signature changes", () => {
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");
    const before = reportSignature(session, "filtered", emptyFilter);
    const after = reportSignature(session, "filtered", { ...emptyFilter, search: "Read" });
    expect(before).not.toBe(after);
  });

  it("marks a report stale once the session graph contributes intervals", () => {
    const { session, graph } = createGraphReportFixture();
    const withoutGraph = reportSignature(session, "whole", emptyFilter);
    const withGraph = reportSignature(session, "whole", emptyFilter, graph);

    expect(withGraph).not.toBe(withoutGraph);
    expect(reportSignature(session, "whole", emptyFilter, null)).toBe(withoutGraph);
    expect(reportSignature(session, "whole", emptyFilter, graph)).toBe(withGraph);
  });

  it("builds the structured prompt sections for a whole-session report", () => {
    const { session, graph } = createGraphReportFixture();
    const prompt = buildReport({
      session,
      records: session.records,
      mode: "whole",
      filter: emptyFilter,
      graph
    });

    expect(prompt).toContain("# 角色");
    expect(prompt).toContain("# 口径（先看这条，再看数据）");
    expect(prompt).toContain("# 输出格式（严格遵守）");
    expect(prompt).toContain("# 质量硬约束");
    expect(prompt).toContain("# 待分析数据");
    expect(prompt).toContain("- 报告模式: 整会话分析");
    expect(prompt).toContain("文件地图 · 主文件");
    expect(prompt).toContain("深挖线索");
    for (const title of [
      "总览",
      "时序分桶",
      "最慢工具",
      "错误汇总",
      "子 agent 全量表",
      "workflow 全量表",
      "并行度",
      "文件地图",
      "取证指引",
      "记录明细"
    ]) {
      expect(prompt).toContain(`. ${title}`);
    }
  });

  it("adds node details in node mode", () => {
    const { session, graph } = createGraphReportFixture();
    const agent = {
      id: "agent-agent-use",
      kind: "agent" as const,
      label: "Agent child-a",
      durationMs: 1000,
      wallMs: 4000,
      span: { start: 0, end: 4000 },
      count: 1,
      segments: [{ start: 0, end: 1000 }],
      record: session.records[0]
    };
    const prompt = buildReport({
      session,
      records: session.records,
      mode: "node",
      filter: emptyFilter,
      graph,
      node: agent
    });

    expect(prompt).toContain("- 报告模式: 节点分析");
    expect(prompt).toContain("节点详情");
    expect(prompt).toContain("- 节点: Agent child-a");
  });

  it("truncates oversized prompt sections instead of dropping the report", () => {
    const { session, graph } = createGraphReportFixture();
    const template = session.records[0];
    const noisy = Array.from({ length: 300 }, (_, index) => ({
      ...template,
      id: `tool-${index}`,
      fullId: `tool-${index}`,
      timestamp: index,
      text: "x".repeat(2000)
    }));
    const prompt = buildReport({
      session: { ...session, records: noisy },
      records: noisy,
      mode: "whole",
      filter: emptyFilter,
      graph
    });

    expect(prompt).toContain("# 角色");
    expect(prompt).toContain("截断说明");
    expect(prompt.length).toBeLessThan(200_000);
  });

  it("caps the record detail table and says how many rows were dropped", () => {
    const { session, graph } = createGraphReportFixture();
    const template = session.records[0];
    const many = Array.from({ length: 450 }, (_, index) => ({
      ...template,
      id: `tool-${index}`,
      fullId: `tool-${index}`,
      timestamp: index,
      text: `row ${index}`
    }));

    const prompt = buildReport({
      session: { ...session, records: many },
      records: many,
      mode: "whole",
      filter: emptyFilter,
      graph
    });

    expect(prompt).toContain("按耗时降序取前 300 条；其余 150 条未列出");
  });

  it("honours the configured detail-row budget", () => {
    const { session, graph } = createGraphReportFixture();
    const template = session.records[0];
    const many = Array.from({ length: 60 }, (_, index) => ({
      ...template,
      id: `tool-${index}`,
      fullId: `tool-${index}`,
      timestamp: index,
      text: `row ${index}`
    }));

    setThresholds({ detailRows: 50 });
    try {
      const prompt = buildReport({
        session: { ...session, records: many },
        records: many,
        mode: "whole",
        filter: emptyFilter,
        graph
      });

      expect(prompt).toContain("按耗时降序取前 50 条；其余 10 条未列出");
    } finally {
      resetThresholds();
    }
  });

  it("honours the configured prompt budget", () => {
    const { session, graph } = createGraphReportFixture();
    const template = session.records[0];
    const noisy = Array.from({ length: 300 }, (_, index) => ({
      ...template,
      id: `tool-${index}`,
      fullId: `tool-${index}`,
      timestamp: index,
      text: "x".repeat(2000)
    }));

    setThresholds({ promptBytes: 16 * 1024 });
    try {
      const prompt = buildReport({
        session: { ...session, records: noisy },
        records: noisy,
        mode: "whole",
        filter: emptyFilter,
        graph
      });

      expect(prompt).toContain("报告超过 16 KB 上限");
    } finally {
      resetThresholds();
    }
  });

  it("cancels the running claude process when the signal aborts", async () => {
    const { bridges, runLines, release } = createStreamHarness({
      lines: [],
      hang: true
    });
    const cancelLines = vi.fn(async () => {
      release();
      return true;
    });
    bridges.proc.cancelLines = cancelLines;
    const controller = new AbortController();
    const { session } = createGraphReportFixture();

    const pending = generateReport(
      { session, records: session.records, mode: "whole", filter: emptyFilter },
      bridges,
      () => undefined,
      controller.signal
    );
    await vi.waitFor(() => expect(runLines).toHaveBeenCalled());
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(ReportCancelledError);
    expect(cancelLines).toHaveBeenCalledTimes(1);
  });

  it("returns claude cost and duration from the result event", async () => {
    const { bridges } = createStreamHarness({
      lines: [
        JSON.stringify({
          type: "result",
          session_id: "claude-session",
          result: "# 报告",
          total_cost_usd: 0.42,
          duration_ms: 4321
        })
      ]
    });
    const { session } = createGraphReportFixture();

    const result = await generateReport(
      { session, records: session.records, mode: "whole", filter: emptyFilter },
      bridges,
      () => undefined
    );

    expect(result).toMatchObject({
      text: "# 报告",
      claudeId: "claude-session",
      costUsd: 0.42,
      durationMs: 4321
    });
  });

  it("feeds graph intervals into the report handed to the claude CLI", async () => {
    const { bridges, runLines } = createStreamHarness({ lines: [] });
    const { session, graph } = createGraphReportFixture();

    await generateReport(
      { session, records: session.records, mode: "whole", filter: emptyFilter, graph },
      bridges,
      () => undefined
    );

    expect(runLines.mock.calls[0]?.[2]).toContain("- 子 agent: 500ms");
  });

  it("runs the resolved absolute path when the app's PATH has no claude", async () => {
    const installed = "/Users/tester/.local/bin/claude";
    const { bridges, runLines } = createStreamHarness({ lines: [] });
    bridges.proc.execText = vi.fn(async (cmd: string) =>
      cmd === "claude"
        ? { ok: false, out: "", error: "启动命令失败: No such file or directory (os error 2)" }
        : { ok: true, out: "--include-partial-messages --output-format stream-json" }
    );
    attachFs(bridges, { existing: [installed] });
    const { session } = createGraphReportFixture();

    await generateReport(
      { session, records: session.records, mode: "whole", filter: emptyFilter },
      bridges,
      () => undefined
    );

    expect(runLines).toHaveBeenCalledTimes(1);
    expect(runLines.mock.calls[0]?.[0]).toBe(installed);
    // `--help` still decides the argument set: resolving the command must not
    // cost the stream-json detection.
    expect(runLines.mock.calls[0]?.[1]).toEqual([
      "-p",
      "--verbose",
      "--include-partial-messages",
      "--output-format",
      "stream-json"
    ]);
  });

  it("says the install is unrunnable rather than claiming claude is missing", async () => {
    const installed = "/Users/tester/.local/bin/claude";
    const { bridges, runLines } = createStreamHarness({});
    bridges.proc.execText = vi.fn(async () => ({
      ok: false,
      out: "",
      error: "启动命令失败: Permission denied (os error 13)"
    }));
    attachFs(bridges, { existing: [installed] });
    const { session } = createGraphReportFixture();

    await expect(
      generateReport(
        { session, records: session.records, mode: "whole", filter: emptyFilter },
        bridges,
        () => undefined
      )
    ).rejects.toThrow(/找到 claude CLI 但无法执行它：\/Users\/tester\/\.local\/bin\/claude/);
    expect(runLines).not.toHaveBeenCalled();
  });

  it("fails fast with an actionable message when nothing can be resolved at all", async () => {
    const { bridges, runLines } = createStreamHarness({});
    bridges.proc.execText = vi.fn(async () => ({
      ok: false,
      out: "",
      error: "启动命令失败: No such file or directory (os error 2)"
    }));
    attachFs(bridges);
    const { session } = createGraphReportFixture();

    await expect(
      generateReport(
        { session, records: session.records, mode: "whole", filter: emptyFilter },
        bridges,
        () => undefined
      )
    ).rejects.toThrow(/未找到 claude CLI/);
    expect(runLines).not.toHaveBeenCalled();
  });

  it("renders assistant text blocks and final result metadata without raw JSON", async () => {
    const { bridges, runLines } = createStreamHarness({
      lines: [
        JSON.stringify({ type: "system", subtype: "init", session_id: "init-session" }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "# 助手报告" }] }
        }),
        JSON.stringify({ type: "result", session_id: "result-session", result: "# 最终报告" })
      ]
    });
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");

    const result = await generateReport(
      { session, records: session.records, mode: "whole", filter: emptyFilter },
      bridges,
      () => undefined
    );

    expect(result.text).toBe("# 最终报告");
    expect(result.claudeId).toBe("result-session");
    expect(result.text).not.toContain('"type":"assistant"');
    expect(result.text).not.toContain('"type":"result"');
    expect(runLines).toHaveBeenCalledTimes(1);
  });

  it("accumulates stream deltas and avoids duplicating the final result", async () => {
    const { bridges } = createStreamHarness({
      lines: [
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "# 流式报告\n" } }
        }),
        JSON.stringify({
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "- 结论" } }
        }),
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "# 流式报告\n- 结论" }] }
        }),
        JSON.stringify({ type: "result", result: "# 流式报告\n- 结论" })
      ]
    });
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");

    const result = await generateReport(
      { session, records: session.records, mode: "whole", filter: emptyFilter },
      bridges,
      () => undefined
    );

    expect(result.text).toBe("# 流式报告\n- 结论");
  });

  it("falls back to plain CLI output when stream-json is unavailable", async () => {
    const { bridges, runLines } = createStreamHarness({
      streamSupported: false,
      lines: ["# 普通 CLI 报告", "", "- 结论"]
    });
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");

    const result = await generateReport(
      { session, records: session.records, mode: "whole", filter: emptyFilter },
      bridges,
      () => undefined
    );

    expect(result.text).toBe("# 普通 CLI 报告\n\n- 结论");
    expect(runLines.mock.calls[0][1]).toEqual(["-p"]);
  });

  it("escapes newlines inside markdown table cells", () => {
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");
    const record = { ...session.records[0], text: "第一行\n第二行|表格" };

    const report = buildFilteredReport(session, [record]);

    expect(report).toContain("第一行 第二行");
    expect(report).not.toContain("第一行\n第二行");
  });

  it("surfaces a failed result event instead of rendering raw JSON", async () => {
    const { bridges } = createStreamHarness({
      lines: [
        JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, error: "超过最大轮数" })
      ]
    });
    const session = parseJsonlText(fixture, "/tmp/session.jsonl");

    await expect(
      generateReport(
        { session, records: session.records, mode: "whole", filter: emptyFilter },
        bridges,
        () => undefined
      )
    ).rejects.toThrow("Claude 分析失败: 超过最大轮数");
  });

  it("includes the filtered row distribution and token columns", () => {
    const { session, graph } = createGraphReportFixture();
    const rows = buildLogRows(session.records, session.turns);
    const prompt = buildReport({
      session,
      records: recordsOfRows(rows),
      rows,
      mode: "filtered",
      filter: emptyFilter,
      graph
    });

    expect(prompt).toContain("筛选后分布");
    expect(prompt).toContain("| 类型 | 条数 | 耗时合计 |");
    expect(prompt).toContain(
      "| 记录ID | 时间 | 类型 | 摘要 | 耗时 | 提示词tok(含缓存) | 输出tok | 状态 |"
    );
  });
});
