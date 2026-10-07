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

/**
 * 把剥掉注释的样式表拆成 [选择器, 声明] 列表。够用即可：本项目没有 @media 嵌套，
 * 一旦引入，内层规则会整块匹配不上——测试以「规则数对不上」的方式提醒人回来把它
 * 写对，而不是悄悄放过。
 */
function cssRules(styles: string): { selector: string; declarations: Record<string, string> }[] {
  return [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const declarations: Record<string, string> = {};
    for (const piece of match[2].split(";")) {
      const at = piece.indexOf(":");
      if (at !== -1) declarations[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();
    }
    return { selector: match[1].trim().replace(/\s+/g, " "), declarations };
  });
}

/** 选择器里真的引用了 th / td 这两个标签——`width`、`thead` 里的子串都不算。 */
const CELL_TAG = /(?:^|[\s,>+~])(?:th|td)(?:[\s,{:>+~.]|$)/;

/** 把 `calc(16px * var(--font-scale))` / `18px` 这类值折算成 100% 字号下的像素数。 */
function basePixels(token: string): number {
  const match = new RegExp(`${token}:\\s*(?:calc\\()?(\\d+(?:\\.\\d+)?)px`).exec(tokensStyles);
  expect(match, `${token} 没在 tokens.css 里定义`).not.toBeNull();
  return Number(match![1]);
}

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

  it("行高收敛：表头行与数据行共用一条行高地板，不许再用 1px 补偿", () => {
    // 两行共用同一条行高地板——地板是两者共有的契约，不是给谁打的补丁。
    expect(logStyles).toMatch(
      /\.container thead tr,\s*\.container tbody tr\s*\{[^}]*height:\s*var\(--row-h\)/s
    );
    // 表头不得再靠 `calc(--row-h + 1px)` 补折叠边框：那是引擎相关的补偿，
    // macOS 上抵消、Linux headless 上正好差一像素（CI 报过 |差| = 1）。
    expect(logStyles).not.toMatch(/height:\s*calc\(var\(--row-h\)/);
    // 表头自己也**不写 height**：它的高度只由上面那条共用地板给。这条是 e2e 那个
    // 「把 thead tr 摘出地板 → 表头矮 2px」变异能成立的前提——表头一旦自带高度，
    // 地板对它就变成可有可无的声明，那条 e2e 也就变成了恒真。
    // 前置 `[\s;{]`：`line-height:` 里也含 `height:`，不加这个会把配对的行盒误判成补高。
    expect(logStyles).not.toMatch(/\.container th\s*\{[^}]*[\s;{]height:/s);
    // 行盒与字号**同级配对**（--fs-xs + --lh-xs）：跨级借 --lh-sm 会让表头内容
    // 恰好等于 --row-h（18 + 12），地板便不再是表头高度的来源。
    expect(logStyles).toMatch(/\.container th\s*\{[^}]*font-size:\s*var\(--fs-xs\)/s);
    expect(logStyles).toMatch(/\.container th\s*\{[^}]*line-height:\s*var\(--lh-xs\)/s);
    // 会让整行高过 --row-h 的 24px 展开器不再撑行。
    expect(logStyles).toMatch(/\.actions\s*\{[^}]*height:\s*var\(--lh-sm\)/s);
  });

  /**
   * 上面那条按正则验「某条规则还在」，看不见**后加的**第二条规则：`.container thead tr
   * { height: 32px }` 会把共用地板整个改掉，而正则照样匹配。这一条改成逐条清点规则，
   * 「表头与数据行同构」才算真的锁住——**这里是真正的保证，e2e 那条像素判据只是它的
   * 实机回声**（折叠边框在不同引擎里劈法不同，像素差最多到 2，见 log-table.spec.ts）。
   */
  it("表头与数据行同构：共用一条地板、表头不自带高度、内距同源", () => {
    const rules = cssRules(logStyles);
    const cellRules = rules.filter((rule) => CELL_TAG.test(rule.selector));
    const theadRules = rules.filter((rule) => rule.selector.includes("thead"));
    // 夹具健全性：规则真的解析出来了，否则下面每条 toEqual 都在空转。
    expect(cellRules.length).toBeGreaterThan(0);
    expect(theadRules.length).toBeGreaterThan(0);

    // 一、`thead` 只允许出现在那条共用的行高地板里，且只声明 `height: var(--row-h)`。
    // 表头自己写一个字面量高度、或补一个 `calc(var(--row-h) + 1px)`，都会让这里的
    // 数组多出一条，当场红。
    expect(
      theadRules.flatMap((rule) =>
        "height" in rule.declarations ? [[rule.selector, rule.declarations.height]] : []
      )
    ).toEqual([[".container thead tr, .container tbody tr", "var(--row-h)"]]);

    // 二、单元格（th / td）自己**一个 height 都不许有**——字面量、calc、别的令牌都不行。
    // 表头的高度只有一个来源：上面那条共用地板。这也是 e2e 那条「把 thead tr 摘出地板，
    // 表头掉到 29、低于地板」的变异能成立的前提。
    expect(
      cellRules.flatMap((rule) =>
        "height" in rule.declarations ? [[rule.selector, rule.declarations.height]] : []
      )
    ).toEqual([]);

    // 三、内距同源：表头单元格与数据行单元格的 padding 来自**同一条规则、同一组
    // `--row-pad-*` 令牌**。表头单独再写一份内距（哪怕数值相同）就等于两份独立声明，
    // 「改一处漏一处」的门就开了。
    expect(
      cellRules.flatMap((rule) =>
        "padding" in rule.declarations ? [[rule.selector, rule.declarations.padding]] : []
      )
    ).toEqual([[".container th, .container td", "var(--row-pad-y) var(--row-pad-x)"]]);

    // 四、地板真的比表头的内容盒高。内容盒 = --lh-xs + 两倍 --row-pad-y，
    // 地板 = --row-h = 两倍 --row-pad-y + --lh-sm，两者共用同一个 padding，于是判据
    // 化简为 `--lh-xs < --lh-sm`。同级配对（--fs-xs 配 --lh-xs）正是由此生效的：
    // 跨级借 --lh-sm 会让两者相等，地板对表头就变成一句可有可无的声明。
    expect(basePixels("--lh-xs")).toBeLessThan(basePixels("--lh-sm"));
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
