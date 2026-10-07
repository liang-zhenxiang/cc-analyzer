import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LogView } from "./LogView";
import { buildLogRows } from "./logRows";
import type { SessionRecord, Turn } from "./types";

// 注释剥掉再断言：CSS 里的说明文字本身就会提到 `.container td` / `waterfall`
// 这些标识符，不剥的话断言读的是注释、不是规则。
const logStyles = readFileSync(
  resolve(process.cwd(), "src/features/sessions/LogView.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");
const tokensStyles = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");

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

    // 「在树视图定位」已移入展开区顶部：先展开该行，再点展开区里的动作条。
    await user1.click(within(toolRow).getByRole("button", { name: "展开" }));
    await user1.click(screen.getByRole("button", { name: "在树视图定位" }));
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

  it("keeps the row's timeline span as the share tooltip (the deleted waterfall column had nothing else)", () => {
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
    // tooltip 要给出**位置**（起止时刻）、跨度与占比的分母——这正是被删掉的
    // waterfall 列独占的那部分信息，不能随着列一起消失。
    expect(
      within(toolRow).getByTitle(/→.*· 300ms · 30\.0%（占整会话）/)
    ).toBeInTheDocument();

    const llmRow = screen.getByText("LLM").closest("tr")!;
    // The model row spans [0, 100] on the 1000ms window.
    expect(within(llmRow).getByText("10.0%")).toBeInTheDocument();
  });

  it("表头全是中文，且没有独立的 waterfall 列", () => {
    setup();

    const headers = screen.getAllByRole("columnheader").map((th) => th.textContent ?? "");
    // 时间 / 类型 / 操作·摘要 / 提示词·输出 / 耗时 / 占比 / 状态 / 行操作（无文字）
    expect(headers).toHaveLength(8);
    expect(headers).not.toContain("waterfall");
    for (const header of headers.filter((text) => text.trim().length > 0)) {
      expect(header).toMatch(/[一-龥]/);
    }
  });

  it("失败行落在失败态样式上，正常行落在降档样式上", () => {
    const failed = base("tool-fail", {
      toolName: "Bash",
      toolCategory: "direct",
      timestamp: 100,
      durationMs: 10,
      isError: true,
      toolResult: "boom"
    });
    render(
      <LogView
        rows={buildLogRows([failed, read])}
        selectedId={null}
        highlightId={null}
        onSelect={vi.fn()}
        onLocateInTree={vi.fn()}
      />
    );

    const failedRow = screen.getByText("Bash").closest("tr")!;
    // 样式表里的取色由下面的 CSS 不变量用例守住；jsdom 不做层叠，这里只能断言
    // 渲染出来的是**哪两个类**——失败与正常必须分开。
    const failedClass = within(failedRow).getByText("失败").className;
    const okClass = within(failedRow.parentElement!).getByText("正常").className;
    expect(failedClass).toContain("error");
    expect(okClass).toContain("statusMuted");
    expect(failedClass).not.toBe(okClass);
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

/**
 * 表格的**列预算与语义**是 CSS 不变量：列宽、行高、取色都写在样式表里，
 * jsdom 不做层叠也不做排版，所以这几条按既有先例（SessionAnalyzerPage.layout.test.ts）
 * 直接读 `LogView.module.css` / `tokens.css` 断言。
 */
describe("表格列预算与语义（CSS 不变量）", () => {
  it("固定布局，且每一列的宽度都来自 --col-* 令牌", () => {
    expect(logStyles).toMatch(/\.container table\s*\{[^}]*table-layout:\s*fixed/s);
    // waterfall 列连同它的两条规则一起删掉，宽度并进摘要列。
    expect(logStyles).not.toContain("waterfall");
    for (const role of ["Time", "Type", "Tokens", "Num", "Share", "Status", "Actions"]) {
      expect(logStyles).toMatch(new RegExp(`\\.col${role}\\s*\\{[^}]*width:\\s*var\\(--col-[a-z]+\\)`));
    }
    // 列宽令牌定义在 tokens.css，不是散在组件里的字面量。
    for (const token of [
      "--col-time",
      "--col-type",
      "--col-num",
      "--col-tokens",
      "--col-share",
      "--col-status",
      "--col-actions"
    ]) {
      expect(tokensStyles).toContain(`${token}:`);
    }
  });

  it("行高收敛：数据行垫到 --row-h，表头补上数据行那条 1px 下边框", () => {
    expect(logStyles).toMatch(/\.container tbody tr\s*\{[^}]*height:\s*var\(--row-h\)/s);
    expect(logStyles).toMatch(/\.container th\s*\{[^}]*height:\s*calc\(var\(--row-h\) \+ 1px\)/s);
    // 会让整行高过 --row-h 的 24px 展开器不再撑行。
    expect(logStyles).toMatch(/\.actions\s*\{[^}]*height:\s*var\(--lh-sm\)/s);
  });

  it("失败态拿得到 --danger：基色不许写在 td 上盖住单元格自己的类", () => {
    expect(logStyles).toMatch(/\.error\s*\{[^}]*color:\s*var\(--danger\)/s);
    expect(logStyles).toMatch(/\.error\s*\{[^}]*font-weight:\s*600/s);
    // `.container td`（0,1,1）会把 `.error` / `.statusMuted` / `.tokens` / `.duration*`
    // （都是 0,1,0）的颜色全部盖掉——v0.11.0 起这些语义色就是这么失效的。
    expect(logStyles).not.toMatch(/\.container td[^{}]*\{[^}]*color:/s);
    expect(logStyles).toMatch(/\.container table\s*\{[^}]*color:\s*var\(--text\)/s);
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
    // 整张表渲染出来的**任何**文本节点里都不该有 ESC——折叠态的摘要走的是
    // logRows 的 stripAnsi，展开态走 AnsiText，两条路都不能漏字节。
    expect(document.body.textContent).not.toContain(ESC);
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
