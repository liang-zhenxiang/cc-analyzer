import { describe, expect, test } from "vitest";
import { recordSummary } from "./recordSummary";
import type { SessionRecord, WorkflowRun } from "./types";

/** 只填被测分支关心的字段：其余留空即「没有内容」。 */
function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "abc",
    fullId: "full-record-id",
    kind: "assistant",
    timestamp: 0,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...overrides
  };
}

const workflowRun: WorkflowRun = {
  runId: "run-1",
  workflowName: "Release",
  summary: "跑了一次发布",
  status: "completed",
  startTs: 1000,
  durationMs: 500,
  agentCount: 2,
  totalTokens: 42,
  totalToolCalls: 3,
  phases: ["Plan"],
  resultText: "released",
  resultTruncated: false,
  logs: []
};

describe("recordSummary", () => {
  test("有文本时原样返回，一个字符都不改", () => {
    const text = "  第一行\n  第二行  ";
    expect(recordSummary(makeRecord({ text }))).toBe(text);
  });

  test("只有空白的文本不算内容，继续往后回退", () => {
    expect(recordSummary(makeRecord({ text: "   \n " }))).toBe("");
  });

  test("text 为空串（tool 记录就是这样）时回退到工具调用", () => {
    const summary = recordSummary(
      makeRecord({ kind: "tool", text: "", toolName: "Read", toolInput: { filePath: "/repo/app.ts" } })
    );
    expect(summary).toContain("Read");
    expect(summary).toContain("/repo/app.ts");
  });

  test("工具没有输入时用工具名兜底，而不是返回空串", () => {
    expect(recordSummary(makeRecord({ kind: "tool", text: "", toolName: "Bash" }))).toBe("Bash");
  });

  test("没有工具调用时用工具输出", () => {
    expect(
      recordSummary(makeRecord({ kind: "tool", text: "", toolResult: "total 0" }))
    ).toBe("total 0");
  });

  test("输出为空但有结构化结果时用结构化摘要", () => {
    const summary = recordSummary(
      makeRecord({
        kind: "tool",
        text: "",
        structuredResult: {
          toolName: "Bash",
          stdout: "total 0",
          stderr: "",
          interrupted: false,
          timedOutAfterMs: null
        }
      })
    );
    expect(summary).toBe("stdout 7 字符");
  });

  test("Workflow 记录回退到 workflow 摘要，其次才是结果文本", () => {
    expect(recordSummary(makeRecord({ text: "", workflowRun }))).toBe("跑了一次发布");
    expect(
      recordSummary(makeRecord({ text: "", workflowRun: { ...workflowRun, summary: "" } }))
    ).toBe("released");
  });

  test("什么都取不到时返回空串——由调用方据此禁用按钮", () => {
    expect(recordSummary(makeRecord())).toBe("");
  });

  test("终端转义序列在进剪贴板/CSV 之前被剥掉", () => {
    // 这段文本的去处是剪贴板、CSV 与报告，粘进终端或表格里带 `\u001b[31m`
    // 就是乱码；屏幕上的颜色由 AnsiText 直接读原文渲染。
    expect(recordSummary(makeRecord({ text: "\u001b[31m红色错误\u001b[0m" }))).toBe("红色错误");
    expect(
      recordSummary(
        makeRecord({ text: "", toolResult: "\u001b[1m粗体输出\u001b[0m" })
      )
    ).toBe("粗体输出");
    // 结构化结果（Bash 的 stdout/stderr）同样是原样抓取的转义序列。
    expect(
      recordSummary(
        makeRecord({
          text: "",
          structuredResult: {
            toolName: "Bash",
            stdout: "\u001b[32m✓ 12 passed\u001b[0m",
            stderr: "",
            interrupted: false,
            timedOutAfterMs: null
          }
        })
      )
    ).toBe("stdout 11 字符");
  });
});
