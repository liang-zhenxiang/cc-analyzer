import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TreeView } from "./TreeView";
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

function parsed(records: SessionRecord[], extra: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: "root-session",
    path: "/repo/project/root.jsonl",
    startedAt: 0,
    endedAt: 800,
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

const workflowRun: WorkflowRun = {
  runId: "run-1",
  workflowName: "Release",
  summary: "",
  status: "completed",
  startTs: 400,
  durationMs: 120,
  agentCount: 1,
  totalTokens: 1,
  totalToolCalls: 1,
  phases: [],
  resultText: "",
  resultTruncated: false,
  logs: []
};

const childSession = parsed([tool("child-tool", "direct", 200, 100)], {
  sessionId: "child-a",
  path: "/repo/project/subagents/agent-child-a.jsonl",
  isSubagent: true,
  startedAt: 200,
  endedAt: 350
});

function sampleSession(): ParsedSession {
  return parsed([
    tool("direct-1", "direct", 0, 50),
    tool("agent-1", "delegated", 200, 150, {
      toolName: "Agent",
      text: "review the parser",
      childSessionId: "child-a",
      childSession
    }),
    tool("workflow-1", "workflow", 400, 120, { toolName: "Workflow", workflowRun }),
    tool("ask-1", "wait", 600, 40, { toolName: "AskUserQuestion" })
  ]);
}

function setup(overrides: {
  highlightId?: string | null;
  onLocateInLog?: (recordId: string) => void;
} = {}) {
  const onSelect = vi.fn();
  const onAnalyze = vi.fn();
  const onEnterChildSession = vi.fn();
  render(
    <TreeView
      session={sampleSession()}
      graph={null}
      selection={null}
      selectedId={null}
      highlightId={overrides.highlightId ?? null}
      onSelect={onSelect}
      onAnalyze={onAnalyze}
      onEnterChildSession={onEnterChildSession}
      onLocateInLog={overrides.onLocateInLog}
    />
  );
  return { onSelect, onAnalyze, onEnterChildSession };
}

// Nested child sessions repeat category labels such as 等用户, so scope by aria-level.
function maybeRow(name: RegExp, level: number): HTMLElement | undefined {
  return screen
    .queryAllByRole("treeitem", { name })
    .find((node) => node.getAttribute("aria-level") === String(level));
}

function row(name: RegExp, level: number): HTMLElement {
  const match = maybeRow(name, level);
  if (!match) throw new Error(`no treeitem matching ${name} at level ${level}`);
  return match;
}

describe("TreeView", () => {
  it("renders the duration hierarchy with per-node durations", () => {
    setup();

    expect(within(row(/等用户/, 2)).getByText("40ms")).toBeInTheDocument();
    expect(within(row(/本地工具/, 2)).getByText("320ms")).toBeInTheDocument();
    expect(within(row(/直接工具/, 3)).getByText("50ms")).toBeInTheDocument();
    expect(within(row(/委派 Agent/, 3)).getByText("150ms")).toBeInTheDocument();
    expect(within(row(/workflow/, 3)).getByText("120ms")).toBeInTheDocument();
    expect(within(row(/LLM 计算/, 2)).getByText("440ms")).toBeInTheDocument();
  });

  it("expands and collapses child rows", async () => {
    const user = userEvent.setup();
    setup();

    expect(row(/直接工具/, 3)).toBeInTheDocument();

    await user.click(
      within(row(/本地工具/, 2)).getByRole("button", { name: "收起 本地工具" })
    );
    expect(maybeRow(/直接工具/, 3)).toBeUndefined();
    expect(
      within(row(/本地工具/, 2)).getByRole("button", { name: "展开 本地工具" })
    ).toBeInTheDocument();

    await user.click(
      within(row(/本地工具/, 2)).getByRole("button", { name: "展开 本地工具" })
    );
    expect(row(/直接工具/, 3)).toBeInTheDocument();
  });

  it("selects the record behind a node", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();

    await user.click(screen.getByRole("button", { name: "Agent child-a · review the parser" }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ fullId: "agent-1", toolCategory: "delegated" })
    );
  });

  it("nests the child session and offers drill-in plus analysis", async () => {
    const user = userEvent.setup();
    const { onAnalyze, onEnterChildSession } = setup();

    expect(screen.getByText(/子会话 child-a/)).toBeInTheDocument();

    const agentRow = row(/Agent child-a/, 4);
    await user.click(within(agentRow).getByRole("button", { name: "进入子会话" }));
    expect(onEnterChildSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "child-a" })
    );

    await user.click(within(agentRow).getByRole("button", { name: "用 claude 分析此子agent" }));
    expect(onAnalyze).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "agent", durationMs: 150 })
    );
  });

  it("exposes analysis for workflow nodes", async () => {
    const user = userEvent.setup();
    const { onAnalyze } = setup();

    const workflowRow = row(/Release/, 4);
    await user.click(within(workflowRow).getByRole("button", { name: "分析" }));

    expect(onAnalyze).toHaveBeenCalledWith(expect.objectContaining({ label: "Release" }));
  });

  it("asks the page to locate the matching log row", async () => {
    const user = userEvent.setup();
    const onLocateInLog = vi.fn();
    setup({ onLocateInLog });

    const agentRow = row(/Agent child-a/, 4);
    await user.click(within(agentRow).getByRole("button", { name: "定位日志" }));

    expect(onLocateInLog).toHaveBeenCalledWith("agent-1");
  });

  it("shows node details when a row is clicked", async () => {
    const user = userEvent.setup();
    setup();

    expect(screen.getByRole("note")).toHaveTextContent("点节点查看详情");

    await user.click(row(/本地工具/, 2));

    const detail = screen.getByRole("region", { name: "节点详情" });
    expect(detail).toHaveTextContent("本地工具");
    expect(detail).toHaveTextContent("直接工具 / 委派子 agent / workflow 三者区间并集");
  });

  it("offers the 仅分析所选时间块 toggle", async () => {
    const user = userEvent.setup();
    const onWindowOnlyChange = vi.fn();
    render(
      <TreeView
        session={sampleSession()}
        graph={null}
        selection={{ start: 0, end: 400 }}
        selectedId={null}
        onSelect={vi.fn()}
        onAnalyze={vi.fn()}
        onEnterChildSession={vi.fn()}
        windowOnly={false}
        onWindowOnlyChange={onWindowOnlyChange}
      />
    );

    await user.click(screen.getByLabelText("仅分析所选时间块"));
    expect(onWindowOnlyChange).toHaveBeenCalledWith(true);
  });

  it("keeps nested child sessions inside the one tree", () => {
    setup();

    // The delegated node carries a child session, whose nodes repeat the same
    // category labels. They are nested deeper treeitems inside the parent tree,
    // not a second tree container, so the hierarchy stays a single tree.
    expect(screen.getByRole("treeitem", { name: /子会话 child-a/ })).toBeInTheDocument();
    expect(screen.getAllByRole("tree")).toHaveLength(1);
    expect(screen.getByRole("tree", { name: "耗时树" })).toBeInTheDocument();

    const levels = screen
      .getAllByRole("treeitem")
      .map((node) => Number(node.getAttribute("aria-level")));
    expect(Math.max(...levels)).toBeGreaterThanOrEqual(5);
  });
});
