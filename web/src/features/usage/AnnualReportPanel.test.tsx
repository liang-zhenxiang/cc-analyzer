import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AnnualReportPanel } from "./AnnualReportPanel";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 用量年报（E4）的组件用例：六张卡在场、空态诚实、跨年只统计数据所在年。
 * 期望值全部由夹具算出（不写死纯逻辑层已经钉过的数字），这样真出回归时
 * 是「卡片没画出来」而不是「某个数字变了」——后者该由 `annualReport.test.ts` 报。
 */

/** 本地日历构造，任何时区下成立。 */
function at(year: number, month: number, day: number, hour = 10): number {
  return new Date(year, month - 1, day, hour).getTime();
}

let seq = 0;
function record(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(input: number): SessionUsage {
  return { inputTokens: input };
}

function inputOf(records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "p" };
}

/** 2026-03-02（周一）起：3/2 两条、3/3 一条、3/10 一条。 */
function yearFixture(): UsageSessionInput[] {
  return [
    inputOf([
      record(at(2026, 3, 2, 9), { kind: "user", text: "hi" }),
      record(at(2026, 3, 2, 10), { usage: usage(1000), model: "claude-sonnet-4-5-20250929" }),
      record(at(2026, 3, 3, 10), { usage: usage(2000), model: "claude-sonnet-4-5-20250929" }),
      record(at(2026, 3, 10, 10), { usage: usage(4000), model: "claude-sonnet-4-5-20250929" })
    ])
  ];
}

function card(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

describe("AnnualReportPanel · 六张卡", () => {
  it("一年有数据时铺满六张卡，数字来自年报而不是视图里重算", () => {
    const { container } = render(<AnnualReportPanel inputs={yearFixture()} />);

    // 年度探针在根部（e2e 按它定位整档）。
    expect(container.querySelector('[data-probe="year-report"]')).not.toBeNull();

    // 六张卡 = 六块 region（Panel 的 aria-label 就是我给的卡名）。
    expect(screen.getAllByRole("region")).toHaveLength(6);

    const headline = card("第 2026 年总量");
    // 同一个数字出现两次是**刻意**的：大字给「一眼看到量级」，小字行给可核对的
    // 精确值（规格 §2.3 卡 1 = 一行大字 + 三行小字，其中一行就是总 token）。
    expect(within(headline).getAllByText("7,000")).toHaveLength(2);
    expect(within(headline).getByText(/2026-03-02 → 2026-03-10/)).toBeInTheDocument();
    // 标题里也有「已记录 3 天」，所以锚到小字行的 dd。
    expect(within(headline).getByText("3 天", { selector: "dd" })).toBeInTheDocument();

    expect(within(card("第 2026 年消息数")).getByText("4")).toBeInTheDocument();
    expect(within(card("第 2026 年最活跃的月份")).getByText(/3 月/)).toBeInTheDocument();
    expect(within(card("第 2026 年最活跃的月份")).getByText(/占全年 100.0%/)).toBeInTheDocument();
    expect(within(card("第 2026 年主力模型")).getByText("Sonnet 4.5")).toBeInTheDocument();
    // 数字与「天」是两个节点（单位降一档），所以查整格的文本。
    expect(card("第 2026 年最长连击").textContent).toContain("2天");
    // 最贵的一周：3/10 落在 3/9 起那一周（单条 4000），比 3/2 起那一周的
    // 3000 更大——这条断言同时钉住了「按周聚合」而不是「按天取最大」。
    const week = card("第 2026 年最贵的一周");
    expect(week.textContent).toContain("4,000");
    expect(week.textContent).toContain("3/9 起的一周"); // weekStartLabel 是 M/D，不补零
    // 诚实脚注：这张卡按 token 排名，不折算金额。
    expect(within(week).getByText(/按 token 量排名，不是金额/)).toBeInTheDocument();
  });

  it("数据从年中开始时，卡 1 的标题写起点而不是「2026 年报」", () => {
    render(<AnnualReportPanel inputs={yearFixture()} />);
    // 3/2 起才有记录 → 标题必须是那句实话。
    expect(
      screen.getByRole("region", { name: "第 2026 年总量" })
    ).toHaveAccessibleName("第 2026 年总量");
    expect(screen.getByText(/数据从 2026-03-02 开始（已记录 3 天）/)).toBeInTheDocument();
  });

  it("数据满一年时标题回到「2026 年报」，不写起点", () => {
    const inputs = [
      inputOf([
        record(at(2026, 1, 1, 0), { usage: usage(500) }),
        record(at(2026, 12, 31, 23), { usage: usage(500) })
      ])
    ];
    render(<AnnualReportPanel inputs={inputs} />);
    expect(screen.getByText("2026 年报")).toBeInTheDocument();
    expect(screen.queryByText(/数据从/)).toBeNull();
  });
});

describe("AnnualReportPanel · 空态与跨年", () => {
  it("没有可统计的记录时整档退化为一句实话 + 去扫描的提示，不画六张空卡", () => {
    const { container } = render(<AnnualReportPanel inputs={[]} />);
    expect(container.querySelector('[data-probe="year-report"]')).toBeNull();
    expect(screen.getByText("这一年没有记录")).toBeInTheDocument();
    expect(screen.getByText(/先在「会话」档扫描一次日志目录/)).toBeInTheDocument();
    // 空态只有一块 region（「用量年报」），不是六张卡。
    expect(screen.getAllByRole("region")).toHaveLength(1);
  });

  it("跨年数据只统计最新那一年，上一年的一条都不进来", () => {
    const inputs = [
      inputOf([
        record(at(2025, 6, 1), { usage: usage(999_000) }),
        record(at(2025, 12, 31), { usage: usage(888_000) })
      ]),
      inputOf([record(at(2026, 2, 5), { usage: usage(1_234) })])
    ];
    render(<AnnualReportPanel inputs={inputs} />);

    // 年 = 最新记录的本地年（2026）；2025 的两条不进任何一个数字。
    expect(within(card("第 2026 年总量")).getAllByText("1,234")).toHaveLength(2);
    expect(screen.queryByText(/1,887,000/)).toBeNull();
    expect(screen.queryByText(/888,000/)).toBeNull();
    // 这一年只有 2/5 一条 → 起点提示仍在。
    expect(screen.getByText(/数据从 2026-02-05 开始（已记录 1 天）/)).toBeInTheDocument();
  });

  it("只有消息、没有 usage 的年份：月份卡说事实，不编百分比", () => {
    const inputs = [inputOf([record(at(2026, 5, 5), { kind: "user", text: "hi" })])];
    render(<AnnualReportPanel inputs={inputs} />);
    expect(
      within(card("第 2026 年最活跃的月份")).getByText(/全年没有 token 读数/)
    ).toBeInTheDocument();
    expect(within(card("第 2026 年主力模型")).getByText(/没有可归因的模型/)).toBeInTheDocument();
  });
});

afterEach(cleanup);

  describe("AnnualReportPanel · G4 逐月区", () => {
  /** 2026-02 到 2026-04 三个月：2 月 1000、3 月 3000+4000、4 月 2000。 */
  function threeMonthsFixture(): UsageSessionInput[] {
    return [
      inputOf([
        record(at(2026, 2, 10, 9), { usage: usage(1000), model: "claude-sonnet-4-5-20250929" }),
        record(at(2026, 3, 2, 10), { usage: usage(3000), model: "claude-sonnet-4-5-20250929" }),
        record(at(2026, 3, 3, 10), { usage: usage(4000), model: "claude-opus-4-6" }),
        record(at(2026, 4, 1, 10), { usage: usage(2000), model: "claude-sonnet-4-5-20250929" })
      ])
    ];
  }

  it("横滚区在场：逐月卡按模型层升序，卡数 = 窗口月数", () => {
    render(<AnnualReportPanel inputs={threeMonthsFixture()} now={at(2026, 4, 30, 23)} />);
    const strip = screen.getByRole("list", { name: "逐月用量" });
    const cards = within(strip).getAllByRole("listitem");
    expect(cards).toHaveLength(3);
    // 升序：2 月在前（名字在按钮上，listitem 只负责横滚布局）。
    for (const [index, label] of ["1,000", "7,000", "2,000"].entries()) {
      const button = within(cards[index]).getByRole("button");
      expect(button).toHaveAttribute("aria-label", `2026 年 ${index + 2} 月 · ${label}`);
    }
  });

  it("partial 月弱化：opacity 类挂上，但按钮照常可点", async () => {
    const user = userEvent.setup();
    const onDrill = vi.fn();
    // 2/10 起、只到 4/1 → 首月（2 月，月中起）与末月（4 月，才过 1 天）都 partial，
    // 中间的 3 月整月都在窗口内不 partial。
    render(<AnnualReportPanel inputs={threeMonthsFixture()} onDrillMonth={onDrill} now={at(2026, 4, 30, 23)} />);
    const strip = screen.getByRole("list", { name: "逐月用量" });
    const cards = within(strip).getAllByRole("listitem");
    // partial 判定在模型层钉过（monthlyReport.test.ts），这里只钉「弱化类挂上」。
    const firstButton = cards[0].querySelector("button");
    const midButton = cards[1].querySelector("button");
    expect(firstButton?.className).not.toBe(midButton?.className);
    // partial 卡仍然可点（不禁用）。
    await user.click(within(cards[0]).getByRole("button"));
    expect(onDrill).toHaveBeenCalledWith(2026, 2);
  });

  it("点月卡上抛 onDrillMonth(year, month)", async () => {
    const user = userEvent.setup();
    const onDrill = vi.fn();
    render(<AnnualReportPanel inputs={threeMonthsFixture()} onDrillMonth={onDrill} now={at(2026, 4, 30, 23)} />);
    await user.click(screen.getByRole("button", { name: "2026 年 3 月 · 7,000" }));
    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledWith(2026, 3);
  });

  it("空月卡 topModel 写「—」，不编模型名", () => {
    // 3 月只有一条 user 消息（无 usage）→ 该月卡在场、token 0、模型 —。
    const inputs = [
      inputOf([
        record(at(2026, 2, 10), { usage: usage(1000), model: "claude-sonnet-4-5-20250929" }),
        record(at(2026, 3, 5), { kind: "user", text: "hi" })
      ])
    ];
    render(<AnnualReportPanel inputs={inputs} now={at(2026, 3, 31, 23)} />);
    const march = screen.getByRole("button", { name: "2026 年 3 月 · 0" });
    expect(within(march).getByText("—")).toBeInTheDocument();
  });
});
