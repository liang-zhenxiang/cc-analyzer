import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordDetailPanel } from "./RecordDetailPanel";
import { parseJsonlText } from "./parseJsonl";
import type { SessionRecord, WorkflowRun } from "./types";

const record: SessionRecord = {
  id: "abc",
  fullId: "full-record-id",
  kind: "tool",
  timestamp: 0,
  durationMs: 10,
  text: "summary",
  isError: false,
  childSessionId: "child-1",
  childSessionPath: "/tmp/child",
  raw: { hello: "world" }
};

test("copies record id and exposes child records", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn() };
  const system = { openFolder: vi.fn() };
  const childSession = parseJsonlText("{}", "/tmp/child.jsonl", { isSubagent: true });
  render(
    <RecordDetailPanel
      record={{ ...record, childSession }}
      clipboard={clipboard as never}
      system={system as never}
      onLocate={() => undefined}
    />
  );

  await user.click(screen.getByRole("button", { name: "复制 ID" }));
  expect(clipboard.writeText).toHaveBeenCalledWith("full-record-id");
  expect(screen.getByRole("region", { name: "子 agent 记录" })).toBeInTheDocument();
});

test("renders exotic raw payloads without blanking the panel", () => {
  const cyclic: Record<string, unknown> = { hello: "world", tokens: 9_007_199_254_740_993n };
  cyclic.self = cyclic;

  render(
    <RecordDetailPanel
      record={{ ...record, raw: cyclic }}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  const raw = screen.getByRole("region", { name: "记录原文" });
  expect(raw).toHaveTextContent("9007199254740993n");
  expect(raw).toHaveTextContent("[循环引用]");
});

const workflowRun: WorkflowRun = {
  runId: "run-1",
  workflowName: "Release",
  summary: "run release",
  status: "completed",
  startTs: 1000,
  durationMs: 500,
  agentCount: 2,
  totalTokens: 42,
  totalToolCalls: 3,
  phases: ["Plan", "Execute"],
  resultText: "released",
  resultTruncated: false,
  logs: ["started", "finished"]
};

const workflowChildSession = parseJsonlText(
  JSON.stringify({
    type: "assistant",
    sessionId: "workflow-child",
    timestamp: "1970-01-01T00:00:01.000Z",
    uuid: "workflow-child-record",
    isSidechain: true,
    message: {
      id: "workflow-child-message",
      model: "claude",
      content: [{ type: "text", text: "workflow child record" }]
    }
  }),
  "/tmp/workflow-child.jsonl",
  { isSubagent: true }
);

const workflowRecord: SessionRecord = {
  ...record,
  fullId: "workflow-use",
  toolName: "Workflow",
  toolCategory: "workflow",
  childSessionId: "workflow-child",
  childSessionPath: "/tmp/workflow-child.jsonl",
  workflowRun,
  childSessions: [workflowChildSession]
};

test("shows workflow summary and child sessions", () => {
  render(
    <RecordDetailPanel
      record={workflowRecord}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn(), openClaudeTerminal: vi.fn() } as never}
      onLocate={() => undefined}
      graphWarnings={["Workflow 运行记录读取失败"]}
    />
  );

  expect(screen.getByRole("region", { name: "Workflow 摘要" })).toHaveTextContent("Release");
  expect(screen.getByText("Plan → Execute")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Workflow 子 agent 1" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "会话图警告" })).toHaveTextContent(
    "Workflow 运行记录读取失败"
  );
});

test("lists every workflow field, log line and result", () => {
  render(
    <RecordDetailPanel
      record={workflowRecord}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn(), openClaudeTerminal: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  const summary = screen.getByRole("region", { name: "Workflow 摘要" });
  expect(summary).toHaveTextContent("状态");
  expect(summary).toHaveTextContent("completed");
  expect(summary).toHaveTextContent("子 agent");
  expect(summary).toHaveTextContent("2");
  expect(summary).toHaveTextContent("运行时长");
  expect(summary).toHaveTextContent("500ms");
  expect(summary).toHaveTextContent("开始时间");
  expect(summary).toHaveTextContent("Token");
  expect(summary).toHaveTextContent("42");
  expect(summary).toHaveTextContent("工具调用");
  expect(summary).toHaveTextContent("3");
  expect(summary).toHaveTextContent("阶段");
  expect(summary).toHaveTextContent("Plan → Execute");
  expect(summary).toHaveTextContent("run release");
  expect(screen.getByLabelText("Workflow 日志")).toHaveTextContent("started");
  expect(screen.getByLabelText("Workflow 日志")).toHaveTextContent("finished");
  expect(screen.getByLabelText("Workflow 结果")).toHaveTextContent("released");
});

test("marks a truncated workflow result and hides missing fields", () => {
  const withTruncation: WorkflowRun = {
    ...workflowRun,
    workflowName: "",
    status: "",
    startTs: null,
    totalTokens: null,
    totalToolCalls: null,
    phases: [],
    logs: [],
    resultText: "partial",
    resultTruncated: true
  };
  render(
    <RecordDetailPanel
      record={{ ...workflowRecord, workflowRun: withTruncation }}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn(), openClaudeTerminal: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  const summary = screen.getByRole("region", { name: "Workflow 摘要" });
  expect(summary).toHaveTextContent("Workflow");
  expect(summary).toHaveTextContent("未知");
  expect(summary).toHaveTextContent("—");
  expect(summary).not.toHaveTextContent("started");
  expect(screen.getByRole("note")).toHaveTextContent("结果已截断");
  expect(screen.getByLabelText("Workflow 结果")).toHaveTextContent("partial");
});

test("copies summary and opens the child session folder", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn() };
  const system = { openFolder: vi.fn() };
  render(
    <RecordDetailPanel
      record={record}
      clipboard={clipboard as never}
      system={system as never}
      onLocate={() => undefined}
    />
  );

  await user.click(screen.getByRole("button", { name: "复制摘要" }));
  await user.click(screen.getByRole("button", { name: "打开位置" }));
  expect(clipboard.writeText).toHaveBeenCalledWith("summary");
  expect(system.openFolder).toHaveBeenCalledWith("/tmp");
});

test("surfaces clipboard and system action failures", async () => {
  const user = userEvent.setup();
  const clipboard = {
    writeText: vi.fn(async () => {
      throw new Error("剪贴板不可用");
    })
  };
  const system = {
    openFolder: vi.fn(async () => {
      throw new Error("目录不可访问");
    }),
    openClaudeTerminal: vi.fn(async () => {
      throw new Error("找不到 osascript");
    })
  };
  render(
    <RecordDetailPanel
      record={record}
      clipboard={clipboard as never}
      system={system as never}
      onLocate={() => undefined}
      sessionId="3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11"
    />
  );

  await user.click(screen.getByRole("button", { name: "复制 ID" }));
  expect(screen.getByRole("alert")).toHaveTextContent("复制 ID 失败: 剪贴板不可用");

  await user.click(screen.getByRole("button", { name: "复制摘要" }));
  expect(screen.getByRole("alert")).toHaveTextContent("复制摘要 失败: 剪贴板不可用");

  await user.click(screen.getByRole("button", { name: "打开位置" }));
  expect(screen.getByRole("alert")).toHaveTextContent("打开位置 失败: 目录不可访问");

  await user.click(screen.getByRole("button", { name: "打开 Claude 终端" }));
  expect(screen.getByRole("alert")).toHaveTextContent("打开 Claude 终端 失败: 找不到 osascript");
});

test("opens Claude terminal for the active session", async () => {
  const user = userEvent.setup();
  const system = { openFolder: vi.fn(), openClaudeTerminal: vi.fn() };
  render(
    <RecordDetailPanel
      record={record}
      clipboard={{ writeText: vi.fn() } as never}
      system={system as never}
      onLocate={() => undefined}
      sessionId="3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11"
    />
  );

  await user.click(screen.getByRole("button", { name: "打开 Claude 终端" }));
  expect(system.openClaudeTerminal).toHaveBeenCalledWith("3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11");
});

test("copies session identity and opens the session folder", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn() };
  const system = { openFolder: vi.fn() };
  render(
    <RecordDetailPanel
      record={record}
      clipboard={clipboard as never}
      system={system as never}
      onLocate={() => undefined}
      sessionId="3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11"
      sessionPath="/tmp/sessions/session.jsonl"
    />
  );

  await user.click(screen.getByRole("button", { name: "复制会话 ID" }));
  await user.click(screen.getByRole("button", { name: "复制路径" }));
  await user.click(screen.getByRole("button", { name: "打开会话文件夹" }));
  expect(clipboard.writeText).toHaveBeenNthCalledWith(1, "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11");
  expect(clipboard.writeText).toHaveBeenNthCalledWith(2, "/tmp/sessions/session.jsonl");
  expect(system.openFolder).toHaveBeenCalledWith("/tmp/sessions");
});

test("shows tokens, tool input/output, structured results, and API errors", () => {
  const detailed: SessionRecord = {
    ...record,
    toolName: "Bash",
    model: "claude-sonnet-4",
    usage: { inputTokens: 5, outputTokens: 2, cacheReadTokens: 10 },
    toolInput: { command: "ls -la" },
    toolResult: "total 0",
    structuredResult: {
      toolName: "Bash",
      stdout: "total 0",
      stderr: "",
      interrupted: false,
      timedOutAfterMs: null
    },
    apiError: { kind: "overloaded_error", status: 529 }
  };
  render(
    <RecordDetailPanel
      record={detailed}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  expect(screen.getByText("输入 15 / 输出 2")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "API 错误" })).toHaveTextContent(
    "overloaded_error (529)"
  );
  expect(screen.getByRole("region", { name: "工具输入" })).toHaveTextContent("ls -la");
  expect(screen.getByRole("region", { name: "工具输出" })).toHaveTextContent("total 0");
  expect(screen.getByRole("region", { name: "结构化结果" })).toHaveTextContent("stdout 7 字符");
});

test("hides the child folder shortcut for an out-of-tree path", () => {
  render(
    <RecordDetailPanel
      record={{ ...record, childSessionPath: "/etc/passwd" }}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
      sessionPath="/repo/project/session.jsonl"
    />
  );

  expect(screen.queryByRole("button", { name: "打开位置" })).toBeNull();
});

test("keeps the child folder shortcut for a path inside the session tree", () => {
  render(
    <RecordDetailPanel
      record={{
        ...record,
        childSessionPath: "/repo/project/session/subagents/agent-child.jsonl"
      }}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
      sessionPath="/repo/project/session.jsonl"
    />
  );

  expect(screen.getByRole("button", { name: "打开位置" })).toBeInTheDocument();
});
