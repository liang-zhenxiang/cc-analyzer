import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogView } from "./LogView";
import { buildLogRows } from "./logRows";
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
    raw: { id },
    ...extra
  };
}

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
  usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100 },
  contentBlocks: [{ type: "text", text: "我先读一下解析器" }]
});
const read = base("read-1", {
  toolName: "Read",
  toolCategory: "direct",
  timestamp: 500,
  durationMs: 40,
  toolInput: { file_path: "/repo/src/parse.ts" },
  toolResult: "export function parse() {}",
  structuredResult: { toolName: "Read", filePath: "/repo/src/parse.ts" }
});

const turns: Turn[] = [{ index: 0, startedAt: 100, endedAt: 600, records: [user, assistant, read] }];

function setup(highlightId: string | null = null) {
  const onSelect = vi.fn();
  const onLocateInTree = vi.fn();
  render(
    <LogView
      rows={buildLogRows([user, assistant, read], turns)}
      selectedId={null}
      highlightId={highlightId}
      onSelect={onSelect}
      onLocateInTree={onLocateInTree}
    />
  );
  return { onSelect, onLocateInTree };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("LogView", () => {
  it("renders merged rows with tokens, duration, and status", () => {
    setup();

    const merged = screen.getByText("用户+LLM").closest("tr")!;
    expect(within(merged).getByText(/提问 \+ claude-sonnet-4/)).toBeInTheDocument();
    expect(within(merged).getByText("110 / 5")).toBeInTheDocument();
    expect(within(merged).getByText("300ms")).toBeInTheDocument();
    expect(within(merged).getByText("正常")).toBeInTheDocument();

    const toolRow = screen.getByText("工具").closest("tr")!;
    expect(within(toolRow).getByText("Read")).toBeInTheDocument();
    expect(within(toolRow).getByText("40ms")).toBeInTheDocument();
  });

  it("expands a tool row into input, output, and structured panels", async () => {
    const user1 = userEvent.setup();
    setup();

    const toolRow = screen.getByText("工具").closest("tr")!;
    await user1.click(within(toolRow).getByRole("button", { name: "展开" }));

    expect(screen.getByRole("region", { name: "工具输入" })).toHaveTextContent("/repo/src/parse.ts");
    expect(screen.getByRole("region", { name: "工具输出" })).toHaveTextContent(
      "export function parse() {}"
    );
    expect(screen.getByRole("region", { name: "结构化结果" })).toHaveTextContent(
      "文件 /repo/src/parse.ts"
    );
  });

  // 「表格要能滚动」这条不变量已经搬到 Playwright：
  // 它由布局（工作区 flex + pane 的 flex: 1）而非 JS 保证，
  // jsdom 没有排版引擎，在这里只能测到一串空字符串。
  // 见 e2e/smoke.spec.ts 的「日志表格在内部滚动」。

  it("selects the primary record and can locate it in the tree", async () => {
    const user1 = userEvent.setup();
    const { onSelect, onLocateInTree } = setup();

    const toolRow = screen.getByText("工具").closest("tr")!;
    await user1.click(within(toolRow).getByText("Read"));
    expect(onSelect).toHaveBeenCalledWith(read);

    await user1.click(within(toolRow).getByRole("button", { name: "在树视图定位" }));
    expect(onLocateInTree).toHaveBeenCalledWith("read-1");
  });

  it("scrolls the highlighted row into view", () => {
    setup("read-1");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("renders only a window of rows for very large logs", () => {
    const records = Array.from({ length: 500 }, (_, index) =>
      base(`tool-${index}`, {
        toolName: "Read",
        toolCategory: "direct",
        timestamp: index,
        durationMs: 1,
        text: `record ${index}`
      })
    );
    render(
      <LogView
        rows={buildLogRows(records)}
        selectedId={null}
        highlightId={null}
        onSelect={vi.fn()}
        onLocateInTree={vi.fn()}
      />
    );

    const rendered = screen.getAllByRole("row").length;
    expect(rendered).toBeGreaterThan(5);
    expect(rendered).toBeLessThan(100);
  });

  it("renders inter-turn wait rows without a record to select", async () => {
    const user1 = base("user-1", { kind: "user", timestamp: 0, text: "第一轮" });
    const assistant1 = base("llm-1", { kind: "assistant", timestamp: 100, text: "答" });
    const user2 = base("user-2", { kind: "user", timestamp: 900, text: "第二轮" });
    const rows = buildLogRows(
      [user1, assistant1, user2],
      [
        { index: 0, startedAt: 0, endedAt: 100, records: [user1, assistant1] },
        { index: 1, startedAt: 900, endedAt: 900, records: [user2] }
      ]
    );
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <LogView
        rows={rows}
        selectedId={null}
        highlightId={null}
        onSelect={onSelect}
        onLocateInTree={vi.fn()}
      />
    );

    const gapRow = screen.getByText(/等待用户输入（轮间间隙）/).closest("tr")!;
    expect(within(gapRow).getByText("等用户")).toBeInTheDocument();
    expect(within(gapRow).queryByRole("button", { name: "在树视图定位" })).toBeNull();

    await user.click(gapRow);
    expect(onSelect).not.toHaveBeenCalled();

    await user.click(within(gapRow).getByRole("button", { name: "展开" }));
    expect(screen.getByRole("region", { name: "等待区间" })).toHaveTextContent(
      "轮间间隙：上一条活动结束 → 下一条用户输入"
    );
  });

  it("shows share and waterfall against the active window", () => {
    const user = base("user-1", { kind: "user", timestamp: 0, text: "开始" });
    const llm = base("llm-1", { kind: "assistant", timestamp: 100, text: "答" });
    const tool = base("tool-1", {
      toolName: "Read",
      toolCategory: "direct",
      timestamp: 200,
      durationMs: 300
    });
    const rows = buildLogRows([user, llm, tool]);
    render(
      <LogView
        rows={rows}
        selectedId={null}
        highlightId={null}
        timeRange={{ start: 0, end: 1000 }}
        onSelect={vi.fn()}
        onLocateInTree={vi.fn()}
      />
    );

    const toolRow = screen.getByText("Read").closest("tr")!;
    expect(within(toolRow).getByText("30.0%")).toBeInTheDocument();
    expect(
      within(toolRow).getByTitle(/→.*· 工具 · 300ms/)
    ).toBeInTheDocument();

    const llmRow = screen.getByText("LLM").closest("tr")!;
    // The model row spans [0, 100] on the 1000ms window.
    expect(within(llmRow).getByText("10.0%")).toBeInTheDocument();
  });

  it("falls back to the row span for share and colours durations by magnitude", () => {
    const short = base("tool-1", {
      toolName: "Read",
      toolCategory: "direct",
      timestamp: 0,
      durationMs: 300
    });
    const seconds = base("tool-2", {
      toolName: "Bash",
      toolCategory: "direct",
      timestamp: 300,
      durationMs: 3_000
    });
    const minutes = base("tool-3", {
      toolName: "Write",
      toolCategory: "direct",
      timestamp: 3_300,
      durationMs: 70_000
    });
    const rows = buildLogRows([short, seconds, minutes]);
    render(
      <LogView
        rows={rows}
        selectedId={null}
        highlightId={null}
        onSelect={vi.fn()}
        onLocateInTree={vi.fn()}
      />
    );

    const shortRow = screen.getByText("Read").closest("tr")!;
    // Row span is 0 → 73300ms, so 300ms is well under a percent.
    expect(within(shortRow).getByText("0.4%")).toBeInTheDocument();
    expect(within(shortRow).getByText("300ms").className).toContain("durationMs");

    const secondsRow = screen.getByText("Bash").closest("tr")!;
    expect(within(secondsRow).getByText("3.00s").className).toContain("durationS");

    const minutesRow = screen.getByText("Write").closest("tr")!;
    expect(within(minutesRow).getByText("1m10s").className).toContain("durationM");
  });
});

describe("终端输出保真", () => {
  it("展开行里的工具输出按原色渲染，且不留转义字节", async () => {
    const ESC = "\u001b";
    const bash = base("bash-1", {
      toolName: "Bash",
      toolCategory: "direct",
      timestamp: 700,
      durationMs: 20,
      toolInput: { command: "npm run build" },
      toolResult: `${ESC}[2K${ESC}[31m✗ build failed${ESC}[0m\nprogress 10%\rprogress 100%`,
      structuredResult: {
        toolName: "Bash",
        stdout: `${ESC}[32m✓ 12 passed${ESC}[0m`,
        stderr: "",
        interrupted: false,
        timedOutAfterMs: null
      }
    });
    const ownTurns: Turn[] = [
      { index: 0, startedAt: 100, endedAt: 800, records: [user, assistant, bash] }
    ];
    render(
      <LogView
        rows={buildLogRows([user, assistant, bash], ownTurns)}
        selectedId={null}
        highlightId={null}
        onSelect={vi.fn()}
        onLocateInTree={vi.fn()}
      />
    );

    const bashRow = screen.getByText("Bash").closest("tr") as HTMLElement;
    await userEvent.click(within(bashRow).getByRole("button", { name: "展开" }));

    const panel = screen.getByRole("region", { name: "工具输出" });
    expect(panel.textContent).not.toContain(ESC);
    expect(panel.textContent).toContain("✗ build failed");
    // 回车重写按终端语义收敛到最终那一段。
    expect(panel.textContent).toContain("progress 100%");
    expect(panel.textContent).not.toContain("progress 10%");

    const colored = Array.from(panel.querySelectorAll("span")).find(
      (node) => node.style.color.length > 0
    );
    expect(colored?.style.color).toBe("var(--ansi-1)");
  });
});
