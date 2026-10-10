import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { BillingWindowCard } from "./BillingWindowCard";
import { setPlan } from "./planLimits";
import type { UsageSessionInput } from "./usageAggregations";

const T0 = new Date(2026, 9, 2, 9, 0, 0).getTime();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

function record(at: number, input = 10_000): SessionRecord {
  return {
    id: `r-${at}`,
    kind: "assistant",
    timestamp: at,
    usage: { inputTokens: input, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  } as unknown as SessionRecord;
}

function inputsOf(records: SessionRecord[]): UsageSessionInput[] {
  return [{ records, projectLabel: "-repo-demo" }];
}

/** 周层的断言作用域：卡内还有 5 小时层，读数不能裸查。 */
function weeklySection() {
  return screen.getByLabelText("周用量（滚动 7 天）");
}

describe("BillingWindowCard", () => {
  afterEach(() => {
    cleanup();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  });

  it("无任何会话 → 整卡不渲染", () => {
    const { container } = render(<BillingWindowCard inputs={[]} now={T0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("读出窗口开启时刻与关闭倒计时，读数标注读自日志", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0), record(T0 + HOUR)])} now={T0 + 2 * HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getByText("09:00")).toBeInTheDocument();
    // 5h 窗口已过 2h → 还剩 3 小时
    expect(within(card).getByText("3 时 0 分")).toBeInTheDocument();
    expect(within(card).getAllByText("读自日志").length).toBeGreaterThan(0);
  });

  it("未选计划：只有消耗没有百分比，提示去设置选择", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getByText("未选计划")).toBeInTheDocument();
    expect(within(card).getByText(/未选择订阅计划/)).toBeInTheDocument();
  });

  it("选了计划：仪表读出限额百分比的可访问名与估算口径说明", () => {
    setPlan({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: null });
    render(<BillingWindowCard inputs={inputsOf([record(T0, 19_000)])} now={T0 + HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(screen.getByRole("img", { name: /已用 100%/ })).toBeInTheDocument();
    expect(within(card).getByText(/社区整理的估算值/)).toBeInTheDocument();
  });

  it("样本不足时速度与预测都说样本不足，不编数字", () => {
    setPlan({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: null });
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + 10 * 60_000} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getAllByText("样本不足")).toHaveLength(2);
  });

  it("样本充足时给出推算徽章与预计到达的具体时刻", () => {
    setPlan({ id: "pro", limitTokens: 38_000, weeklyLimitTokens: null });
    // 2h 消耗 19k → 9.5k/h，剩 19k → 再过 2h 到限额
    render(<BillingWindowCard inputs={inputsOf([record(T0, 19_000)])} now={T0 + 2 * HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    // 推算徽章（圆点；完整句子在可访问名上）共三枚：5h 层的速度与预测两枚，
    // 加上周层日均线的一枚（同为「按消耗速度推算」的口径，未设预算时周层没有别的）。
    expect(within(card).getAllByLabelText(/数据来源：按消耗速度推算/)).toHaveLength(3);
    // T0+2h 起再 2h → 13:00（同日）
    expect(within(card).getByText("10-02 13:00")).toBeInTheDocument();
  });
});

describe("BillingWindowCard · 滚动 7 天层", () => {
  afterEach(() => {
    cleanup();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  });

  it("滚动 7 天读数与「不是官方重置窗口」的说明同时在场", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0), record(T0 + HOUR)])} now={T0 + 2 * HOUR} />);
    const weekly = weeklySection();
    expect(within(weekly).getByText("滚动 7 天", { exact: true })).toBeInTheDocument();
    // 两条记录都在 7 天窗内 → 20,000
    expect(within(weekly).getByText("20,000")).toBeInTheDocument();
    expect(within(weekly).getByText(/不是官方重置窗口/)).toBeInTheDocument();
  });

  it("两个限额层各有层名，5 小时层不因为新增周层而失语", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getByText("5 小时窗口", { exact: true })).toBeInTheDocument();
    expect(within(card).getByText("滚动 7 天", { exact: true })).toBeInTheDocument();
  });

  it("未设周预算：只显示消耗与对照信息，不渲染任何百分比字符串", () => {
    // 即使 5h 层选了计划，周层没预算也不给百分比——分母缺一档就少一档比率。
    setPlan({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: null });
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + HOUR} />);
    const weekly = weeklySection();
    expect(within(weekly).getByText(/未设周预算/)).toBeInTheDocument();
    expect(within(weekly).queryByText(/\d+\s*%/)).toBeNull();
    // 上一周期没有数据时如实说 0，不造一个 ±100% 的「趋势」。
    expect(within(weekly).getByText("上一周期 0")).toBeInTheDocument();
  });

  it("两边都有数据时给出较上一周期的百分比", () => {
    render(
      <BillingWindowCard inputs={inputsOf([record(T0 - 8 * DAY), record(T0)])} now={T0 + HOUR} />
    );
    const weekly = weeklySection();
    expect(within(weekly).getByText("较上一周期 0%")).toBeInTheDocument();
  });

  it("设了周预算：出现预算百分比、日均推算与推算徽章", () => {
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 100_000 });
    // 两个不同本地日 → activeDays 2，可推算；消耗 30k → 30%。
    render(
      <BillingWindowCard inputs={inputsOf([record(T0 - 3 * DAY), record(T0, 20_000)])} now={T0 + HOUR} />
    );
    const weekly = weeklySection();
    expect(within(weekly).getByText(/周预算已用 30%/)).toBeInTheDocument();
    expect(within(weekly).getByText(/按日均推算 .* 触达/)).toBeInTheDocument();
    expect(within(weekly).getAllByLabelText(/按近 7 天日均外推/)).toHaveLength(1);
  });

  it("活动日不足 → 推算位明说样本不足，不编日期", () => {
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 100_000 });
    // 全部记录都在同一个本地日 → activeDays 1。
    render(<BillingWindowCard inputs={inputsOf([record(T0), record(T0 + HOUR)])} now={T0 + 2 * HOUR} />);
    const weekly = weeklySection();
    expect(within(weekly).getByText("样本不足，不外推")).toBeInTheDocument();
    expect(within(weekly).queryByText(/按日均推算/)).toBeNull();
  });

  it("已超周预算 → 说已达预算，不给出过去的触达时刻", () => {
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 15_000 });
    render(
      <BillingWindowCard inputs={inputsOf([record(T0 - 3 * DAY), record(T0)])} now={T0 + HOUR} />
    );
    const weekly = weeklySection();
    expect(within(weekly).getByText("已达预算")).toBeInTheDocument();
  });
});

/**
 * 「本窗口消耗 Top 会话」（Issue #151）的组件用例。夹具里的会话语料与
 * `quotaAttribution.test.ts` 同形状：归因靠元数据合并、靠记录算 token；
 * 期望值全部由夹具算出（窗口总量 = 各会话 token 之和 = 表盘那个数）。
 */
function meta(path: string, patch: Partial<SessionMeta> = {}): SessionMeta {
  return { path, projectLabel: "-repo-demo", hasRecords: true, mtimeMs: 0, sizeBytes: 0, ...patch };
}

/** 一个会话输入：`tokens` 里每一项是窗口内第 i 分钟的一条记录。 */
function sessionInput(
  path: string,
  title: string,
  tokens: number[],
  extra: { projectLabel?: string; projectPath?: string; withMeta?: boolean } = {}
): UsageSessionInput {
  const projectLabel = extra.projectLabel ?? "-repo-demo";
  return {
    records: tokens.map((value, index) => record(T0 + index * MINUTE, value)),
    projectLabel,
    projectPath: extra.projectPath,
    session:
      extra.withMeta === false ? undefined : meta(path, { customTitle: title, projectLabel })
  };
}

function renderCard(inputs: UsageSessionInput[], onOpenSession?: (session: SessionMeta) => void) {
  const view = render(
    <BillingWindowCard inputs={inputs} now={T0 + HOUR} onOpenSession={onOpenSession} />
  );
  return { ...view, card: screen.getByLabelText("计费窗口") };
}

function panelOf(container: HTMLElement): HTMLElement {
  const panel = container.querySelector<HTMLElement>('[data-probe="attribution-panel"]');
  expect(panel).not.toBeNull();
  return panel!;
}

function attributionList(): HTMLElement {
  return screen.getByRole("list", { name: "本窗口消耗最多的会话" });
}

describe("BillingWindowCard · 本窗口消耗 Top 会话", () => {
  afterEach(() => {
    cleanup();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  });

  it("多会话：标题、列表名、来源、百分比与占比条都在，分母是表盘那个数", () => {
    const { container, card } = renderCard([
      sessionInput("/sessions/a.jsonl", "会话 A", [3_000]),
      sessionInput("/sessions/b.jsonl", "会话 B", [1_000])
    ]);
    const panel = panelOf(container);
    expect(within(card).getByRole("heading", { name: "本窗口消耗 Top 会话" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本窗口消耗 Top 会话" })).toBe(panel);

    const list = attributionList();
    expect(within(list).getAllByRole("button")).toHaveLength(2);
    // 窗口总量 3,000 + 1,000 = 4,000（表盘中心那个数）→ 75.0% / 25.0%
    expect(within(list).getByText("75.0%")).toBeInTheDocument();
    expect(within(list).getByText("25.0%")).toBeInTheDocument();
    expect(within(list).getByText("3,000 tok")).toBeInTheDocument();
    expect(within(list).getByText("1,000 tok")).toBeInTheDocument();

    const bars = panel.querySelectorAll<HTMLElement>('[data-probe="attribution-row-bar"]');
    expect(bars).toHaveLength(2);
    expect(bars[0].style.width).toBe("75%");
    expect(bars[1].style.width).toBe("25%");
    // 整块只有一枚来源圆点，读自日志
    expect(within(panel).getByLabelText("数据来源：读自日志")).toBeInTheDocument();
  });

  it("分母脚注：屏幕上只有分母定义这一句，完整口径在 title 与 aria-label", () => {
    const { container } = renderCard([sessionInput("/sessions/a.jsonl", "会话 A", [1_000])]);
    const footnote = container.querySelector<HTMLElement>('[data-probe="attribution-footnote"]')!;
    expect(footnote.textContent).toBe("占比分母 = 本窗口总消耗（与表盘中心同一个数）。");
    expect(footnote.getAttribute("title")).toContain("精确占比之和恒为 100%");
    expect(footnote.getAttribute("aria-label")).toContain("四舍五入");
  });

  it("窗口内 6 个会话：5 行真实会话 + 「其余 1 个会话」，余项不是按钮", async () => {
    const onOpen = vi.fn();
    const inputs = [6_000, 5_000, 4_000, 3_000, 2_000, 1_000].map((tokens, index) =>
      sessionInput(`/sessions/s${index}.jsonl`, `会话 ${index}`, [tokens])
    );
    const { container } = renderCard(inputs, onOpen);

    expect(within(attributionList()).getAllByRole("button")).toHaveLength(5);
    const rest = container.querySelector<HTMLElement>('[data-probe="attribution-rest"]')!;
    expect(rest.tagName).toBe("LI");
    expect(rest.textContent).toContain("其余 1 个会话");
    // 余项是把尾部并起来的合并值：1,000 / 21,000 = 4.8%
    expect(rest.textContent).toContain("1,000 tok");
    expect(rest.textContent).toContain("4.8%");
    // 余项没有按钮语义、不进 Tab 顺序、点了也不打开会话
    expect(within(rest).queryByRole("button")).toBeNull();
    await userEvent.click(rest);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("窗口内恰好 5 个会话：5 行、没有余项，也不生成「其余 0 个会话」", () => {
    const inputs = [5_000, 4_000, 3_000, 2_000, 1_000].map((tokens, index) =>
      sessionInput(`/sessions/s${index}.jsonl`, `会话 ${index}`, [tokens])
    );
    const { container } = renderCard(inputs);
    const list = attributionList();
    expect(within(list).getAllByRole("button")).toHaveLength(5);
    expect(container.querySelector('[data-probe="attribution-rest"]')).toBeNull();
    expect(within(list).queryByText(/其余/)).toBeNull();
  });

  it("没有 onOpenSession：行仍列出但原生禁用，点击不触达任何回调", async () => {
    const { container } = renderCard([sessionInput("/sessions/a.jsonl", "会话 A", [1_000])]);
    const row = container.querySelector<HTMLButtonElement>('[data-probe="attribution-row"]')!;
    expect(row).toBeDisabled();
    expect(row.getAttribute("aria-label")).toMatch(/当前不可打开$/);
    expect(row.getAttribute("aria-label")).toMatch(/^会话 A（项目：repo-demo）/);
    expect(row.getAttribute("title")).toMatch(/当前不可打开$/);
    await userEvent.click(row);
    expect(row).toBeDisabled();
  });

  it("没有 SessionMeta 的输入：即使传了回调也禁用，标题回退项目标签", async () => {
    const onOpen = vi.fn();
    const { container } = renderCard(
      [sessionInput("/sessions/a.jsonl", "会话 A", [1_000], { withMeta: false })],
      onOpen
    );
    const row = container.querySelector<HTMLButtonElement>('[data-probe="attribution-row"]')!;
    expect(row).toBeDisabled();
    expect(row.textContent).toContain("-repo-demo");
    await userEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("点行把被点会话的 SessionMeta 交回 onOpenSession", async () => {
    const onOpen = vi.fn();
    const { container } = renderCard(
      [
        sessionInput("/sessions/a.jsonl", "会话 A", [3_000]),
        sessionInput("/sessions/b.jsonl", "会话 B", [1_000])
      ],
      onOpen
    );
    const rows = container.querySelectorAll<HTMLButtonElement>('[data-probe="attribution-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("aria-label")).toMatch(/^打开会话：会话 A/);
    expect(rows[0]).not.toBeDisabled();

    await userEvent.click(rows[1]);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].path).toBe("/sessions/b.jsonl");
    expect(onOpen.mock.calls[0][0].customTitle).toBe("会话 B");
  });

  it("窗口消耗为 0：整块不渲染，不画 0 行空列表", () => {
    const { container } = renderCard([sessionInput("/sessions/a.jsonl", "会话 A", [0])]);
    expect(container.querySelector('[data-probe="attribution-panel"]')).toBeNull();
    expect(screen.queryByText("本窗口消耗 Top 会话")).toBeNull();
  });

  it("归因面板与历史条同处右侧一列，DOM 顺序是归因在前、历史条在后", () => {
    const earlier = sessionInput("/sessions/a.jsonl", "会话 A", [1_000]);
    // 第二条记录落在下一个窗口：历史条因此有内容可画。
    const later: UsageSessionInput = {
      records: [record(T0 + 7 * HOUR, 2_000)],
      projectLabel: "-repo-demo",
      session: meta("/sessions/b.jsonl", { customTitle: "会话 B" })
    };
    const { container } = renderCard([earlier, later]);
    const panel = panelOf(container);
    const stack = panel.parentElement!;
    const historyLabel = within(stack).getByText("近几个窗口");

    expect(stack.children[0].contains(panel)).toBe(true);
    expect(stack.lastElementChild!.contains(historyLabel)).toBe(true);
  });

  it("0 token 的会话保留在地板位：0 tok / 0.0% / 空条；极小占比显示 <0.1%", () => {
    const { container } = renderCard([
      sessionInput("/sessions/a.jsonl", "会话 A", [100_000]),
      sessionInput("/sessions/tiny.jsonl", "很小的会话", [1]),
      sessionInput("/sessions/z.jsonl", "闲着的会话", [0])
    ]);
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-probe="attribution-row"]')
    );
    expect(rows).toHaveLength(3);

    const idle = rows.find((row) => row.textContent?.includes("闲着的会话"))!;
    expect(idle.textContent).toContain("0 tok");
    expect(idle.textContent).toContain("0.0%");
    // 0 token 只有轨道，没有填充（填充在内联 style 上没有宽度）
    expect(idle.querySelector('[data-probe="attribution-row-bar"]')!.getAttribute("style")).toBeNull();

    const tiny = rows.find((row) => row.textContent?.includes("很小的会话"))!;
    expect(tiny.textContent).toContain("<0.1%");
    // 非零就保底有一根 2px 的条（min-width 写在 .attributionBarFill 上）
    expect(tiny.querySelector('[data-probe="attribution-row-bar"]')).not.toBeNull();
  });

  it("隐私：可见文本、title、aria-label 都不出现完整路径与 cwd", () => {
    const { container } = renderCard([
      sessionInput("/Users/tester/.claude/projects/-repo-demo/s.jsonl", "会话 A", [1_000], {
        projectLabel: "-Users-tester-dev-demo",
        projectPath: "/Users/tester/dev/demo"
      })
    ]);
    const panel = panelOf(container);
    const surfaces: string[] = [panel.textContent ?? "", panel.innerHTML];
    for (const el of panel.querySelectorAll("[title], [aria-label]")) {
      surfaces.push(el.getAttribute("title") ?? "", el.getAttribute("aria-label") ?? "");
    }
    for (const text of surfaces) {
      expect(text).not.toContain("/Users/");
      expect(text).not.toContain("~/.claude");
    }
    // 项目名走 formatProjectPath：取 cwd 的 basename，不显示完整路径
    expect(
      panel.querySelector('[data-probe="attribution-row"]')!.getAttribute("aria-label")
    ).toContain("（项目：demo）");
  });
});

/**
 * 版面纪律读样式表：jsdom 不做布局，这里钉「规则写了没有」；真机由 GUI 门禁按
 * 行数 × 行高对账容器高度。判法照 ErrorState.test.tsx 的 rulesOf。
 */
const attributionCss = readFileSync(
  resolve(process.cwd(), "src/features/usage/BillingWindowCard.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

function cssRulesOf(source: string): Array<{ selectors: string[]; body: string }> {
  const out: Array<{ selectors: string[]; body: string }> = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    out.push({ selectors: match[1].split(",").map((item) => item.trim()), body: match[2] });
  }
  return out;
}

function cssBodyOf(selector: string): string {
  // 一个选择器可能出现在多条规则里（共享网格的一条 + 自己的修饰一条）：全并起来看。
  const bodies = cssRulesOf(attributionCss)
    .filter((item) => item.selectors.includes(selector))
    .map((item) => item.body);
  expect(bodies.length, `样式表里找不到 ${selector}`).toBeGreaterThan(0);
  return bodies.join("\n");
}

describe("BillingWindowCard · 归因面板样式纪律", () => {
  it("行高由令牌组成，列表 gap 为 0（真机按行数 × 行高对账容器高度）", () => {
    expect(cssBodyOf(".attributionRow")).toMatch(
      /height:\s*calc\(var\(--row-pad-y-tight\) \* 2 \+ var\(--lh-xs\)\)/
    );
    expect(cssBodyOf(".attributionRow")).toContain("grid-template-columns: minmax(0, 1fr) auto 56px 56px");
    expect(cssBodyOf(".attributionList")).toMatch(/gap:\s*0/);
  });

  it("标题单行省略；占比条复刻日志表那一档（56 × 6、非零最小 2px）", () => {
    const title = cssBodyOf(".attributionRowTitle");
    expect(title).toContain("overflow: hidden");
    expect(title).toContain("text-overflow: ellipsis");
    expect(title).toContain("white-space: nowrap");

    const track = cssBodyOf(".attributionBarTrack");
    expect(track).toContain("width: 56px");
    expect(track).toContain("height: var(--sp-15)");
    expect(track).toContain("background: var(--border-strong)");
    expect(cssBodyOf(".attributionBarFill")).toContain("min-width: var(--sp-05)");
    expect(cssBodyOf(".attributionBarFill")).toContain("background: var(--chart-1)");
    // 余项是合并值，降一档颜色提示「不是单个会话」
    expect(cssBodyOf(".attributionRestFill")).toContain("background: var(--chart-1-soft)");
  });

  it("右侧一列承接弹性尺寸：归因与历史条都不再各自拉伸成整行", () => {
    expect(cssBodyOf(".sideStack")).toContain("flex: 2 1 520px");
    // 历史图独占整行会被 SVG 的 width:100% + viewBox 放大到约 1.9 倍，
    // 纵轴标签互相压住——两块都不许自己带 flex。
    expect(cssBodyOf(".history")).not.toContain("flex:");
    expect(cssBodyOf(".attribution")).not.toContain("flex:");
  });

  it("悬停台阶用 --bg-active（--bg-hover 与面板底同色会看不见）；不可点的行无指针", () => {
    expect(cssBodyOf(".attributionRow:not(:disabled):hover")).toContain("background: var(--bg-active)");
    expect(cssBodyOf(".attributionRow:disabled")).toContain("opacity: 1");
    expect(cssBodyOf(".attributionRow:disabled")).toContain("cursor: default");
    // 余项行的分隔线用内阴影画，不占布局高度
    expect(cssBodyOf(".attributionRest")).toContain("box-shadow: inset 0 1px 0 var(--border)");
  });

  it("归因面板不含字面量颜色", () => {
    const panelCss = attributionCss.slice(attributionCss.indexOf(".attribution {"));
    expect(panelCss).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(panelCss).not.toMatch(/\brgba?\(/);
  });
});
