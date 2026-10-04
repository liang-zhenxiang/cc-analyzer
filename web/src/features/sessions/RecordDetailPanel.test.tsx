import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordDetailPanel } from "./RecordDetailPanel";
import { parseJsonlText } from "./parseJsonl";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { SessionRecord, WorkflowRun } from "./types";

/**
 * 面板的复制结果通过 `useNotifications()` 反馈，所以渲染时必须带 provider
 * ——否则 hook 会抛「必须在 NotificationProvider 内使用」。
 */
function renderWithNotifications(ui: ReactElement) {
  return render(<NotificationProvider>{ui}</NotificationProvider>);
}

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
  renderWithNotifications(
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

  renderWithNotifications(
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
  renderWithNotifications(
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
  renderWithNotifications(
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
  renderWithNotifications(
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
  renderWithNotifications(
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
  renderWithNotifications(
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
  renderWithNotifications(
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
  renderWithNotifications(
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
  renderWithNotifications(
    <RecordDetailPanel
      record={detailed}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  // 15 = 5 input + 10 cache read：标签必须写出这一点，否则「输入 15」会被当成 input_tokens。
  expect(screen.getByText("提示词(含缓存) 15 / 输出 2")).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "API 错误" })).toHaveTextContent(
    "overloaded_error (529)"
  );
  expect(screen.getByRole("region", { name: "工具输入" })).toHaveTextContent("ls -la");
  expect(screen.getByRole("region", { name: "工具输出" })).toHaveTextContent("total 0");
  expect(screen.getByRole("region", { name: "结构化结果" })).toHaveTextContent("stdout 7 字符");
});

test("hides the child folder shortcut for an out-of-tree path", () => {
  renderWithNotifications(
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
  renderWithNotifications(
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

test("收起详情：关闭按钮把「收起」这件事交给页面", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  renderWithNotifications(
    <RecordDetailPanel
      record={record}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
      onClose={onClose}
    />
  );

  // 面板自己不持有选中状态，收起必须回传给页面——否则点了没反应。
  await user.click(screen.getByRole("button", { name: "收起详情" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("没有 onClose 时不渲染关闭按钮（调用方没提供收起能力）", () => {
  renderWithNotifications(
    <RecordDetailPanel
      record={record}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  expect(screen.queryByRole("button", { name: "收起详情" })).toBeNull();
});

test("复制成功后给出成功提示，不只是静默写入剪贴板", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn(async () => undefined) };
  renderWithNotifications(
    <RecordDetailPanel
      record={record}
      clipboard={clipboard as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
      sessionId="3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11"
      sessionPath="/tmp/sessions/session.jsonl"
    />
  );

  await user.click(screen.getByRole("button", { name: "复制 ID" }));
  expect(await screen.findByText("已复制记录 ID")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "复制摘要" }));
  expect(await screen.findByText("已复制摘要")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "复制会话 ID" }));
  expect(await screen.findByText("已复制会话 ID")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "复制路径" }));
  expect(await screen.findByText("已复制会话路径")).toBeInTheDocument();

  // 提示是给用户看的：它渲染在 aria-live 的实时区域里，屏幕阅读器会播报。
  // （不按 role=status 查：<output> 自己就是 status，会和容器撞名。）
  expect(screen.getByText("已复制会话路径").closest("[aria-live='polite']")).not.toBeNull();
});

test("复制失败时除了就地错误也弹一条错误提示", async () => {
  const user = userEvent.setup();
  const clipboard = {
    writeText: vi.fn(async () => {
      throw new Error("剪贴板不可用");
    })
  };
  renderWithNotifications(
    <RecordDetailPanel
      record={record}
      clipboard={clipboard as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  await user.click(screen.getByRole("button", { name: "复制摘要" }));
  const message = "复制摘要 失败: 剪贴板不可用";
  expect(screen.getByRole("alert")).toHaveTextContent(message);
  // 就地 alert 之外还要有一条 toast：前者会被下一次操作或切换记录抹掉，
  // 后者（实时区域里的那一条）才是「失败一定看得见」的保证。
  const liveToasts = screen
    .getAllByText(message)
    .filter((element) => element.closest("[aria-live='polite']"));
  expect(liveToasts).toHaveLength(1);
});

/**
 * 「复制摘要」的语义是「最能代表这条记录的一段文本」，**不是** `record.text`。
 * 这一组用例就是这条语义的看门人：谁把按钮直接接回 `record.text`，会在这里失败。
 */
test("复制摘要：record.text 非空时原样复制，不被回退逻辑改写", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn(async () => undefined) };
  // 前后空白与换行都要原样带出去：屏幕上「记录原文」显示的就是它。
  const text = "  第一行\n  第二行  ";
  renderWithNotifications(
    <RecordDetailPanel
      record={{ ...record, text }}
      clipboard={clipboard as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  await user.click(screen.getByRole("button", { name: "复制摘要" }));
  expect(clipboard.writeText).toHaveBeenCalledWith(text);
});

test("复制摘要：record.text 为空串时回退到工具调用，写进剪贴板的不是空串", async () => {
  const user = userEvent.setup();
  const clipboard = { writeText: vi.fn(async (_text: string) => undefined) };
  renderWithNotifications(
    <RecordDetailPanel
      record={{ ...record, kind: "tool", text: "", toolName: "Read", toolInput: { filePath: "/repo/demo/app.ts" } }}
      clipboard={clipboard as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  await user.click(screen.getByRole("button", { name: "复制摘要" }));
  const copied = clipboard.writeText.mock.calls[0][0] as string;
  expect(copied.length).toBeGreaterThan(0);
  expect(copied).toContain("Read");
  expect(copied).toContain("/repo/demo/app.ts");
});

test("复制摘要：真的没有内容时按钮禁用并说明原因，而不是静默写空串", async () => {
  renderWithNotifications(
    <RecordDetailPanel
      record={{
        ...record,
        kind: "user",
        text: "",
        toolName: undefined,
        toolInput: undefined,
        toolResult: undefined,
        structuredResult: undefined,
        workflowRun: undefined
      }}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  expect(screen.getByRole("button", { name: "复制摘要" })).toBeDisabled();
  expect(screen.getByText(/无可复制内容/)).toBeInTheDocument();
});

test("复制摘要：有内容的记录不显示「无可复制内容」", () => {
  renderWithNotifications(
    <RecordDetailPanel
      record={record}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  expect(screen.getByRole("button", { name: "复制摘要" })).toBeEnabled();
  expect(screen.queryByText(/无可复制内容/)).toBeNull();
});

test("工具输出按终端原色渲染，且 DOM 里不留转义字节", () => {
  const ESC = "\u001b";
  const { container } = renderWithNotifications(
    <RecordDetailPanel
      record={{
        ...record,
        toolName: "Bash",
        toolResult:
          `${ESC}[2K${ESC}[31m✗ build failed${ESC}[0m\n` +
          `${ESC}]0;window title\u0007progress 10%\rprogress 100%`,
        structuredResult: undefined
      }}
      clipboard={{ writeText: vi.fn() } as never}
      system={{ openFolder: vi.fn() } as never}
      onLocate={() => undefined}
    />
  );

  const output = screen.getByRole("region", { name: "工具输出" });
  // 文本里不能有 ESC；回车重写按终端语义收敛到最后一段。
  expect(output.textContent).not.toContain(ESC);
  expect(output.textContent).toContain("✗ build failed");
  expect(output.textContent).toContain("progress 100%");

  // 颜色是主题变量（深浅两套值），不是写死的十六进制。
  const colored = Array.from(output.querySelectorAll("span")).find(
    (node) => node.style.color.length > 0
  );
  expect(colored?.style.color).toBe("var(--ansi-1)");

  // 会话内容不可信：样式只能来自解析器，不能带出任何原始字符串片段。
  for (const node of Array.from(container.querySelectorAll("[style]"))) {
    expect(node.getAttribute("style")).not.toMatch(/url\(|expression/i);
  }
});
