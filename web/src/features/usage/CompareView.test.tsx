import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { CompareView, type CompareAPreset, type CompareBPreset } from "./CompareView";
import type { CompareRange } from "./compareRanges";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 「对照」视图的呈现口径测试。纯数据层由 `compareRanges.test.ts` 覆盖，这里只
 * 钉「界面层最容易做错」的几件事：重叠优先于空态、差值的逐项方向、成本的未定价
 * 脚注、项目并集、堆叠条跨行同色、日趋势按「第 N 天」对齐。
 */

const viewCss = readFileSync(
  resolve(process.cwd(), "src/features/usage/CompareView.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

/** 取某个选择器所在规则块的声明体（逗号分组也成立：选择器之后到 `{` 之间没有 `{`）。 */
function ruleBodyFor(selector: string): string {
  const index = viewCss.indexOf(selector);
  expect(index, `样式表里找不到 ${selector}`).toBeGreaterThanOrEqual(0);
  const open = viewCss.indexOf("{", index);
  const close = viewCss.indexOf("}", open);
  return viewCss.slice(open + 1, close);
}

function day(year: number, month: number, date: number): number {
  return new Date(year, month - 1, date).getTime();
}

function at(year: number, month: number, date: number, hour = 10, minute = 0): number {
  return new Date(year, month - 1, date, hour, minute).getTime();
}

/** 2026-11-21 18:00，局部「今天」；A 默认 11/15–11/21，B 默认 11/08–11/14。 */
const NOW = at(2026, 11, 21, 18);

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

function usage(input: number, output = 0): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: 0,
    cacheReadTokens: 0
  };
}

const SONNET = "claude-sonnet-4-5-20250929";
const RANGE_A = (): CompareRange => ({ startDay: day(2026, 11, 15), days: 7 });
const RANGE_B = (): CompareRange => ({ startDay: day(2026, 11, 8), days: 7 });

function inputOf(projectLabel: string, records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel };
}

function renderCompare(
  inputs: UsageSessionInput[],
  {
    rangeA = RANGE_A(),
    rangeB = RANGE_B(),
    presetA = "7" as CompareAPreset,
    presetB = "previous" as CompareBPreset,
    onChangeA = vi.fn(),
    onChangeB = vi.fn(),
    projectPaths = new Map<string, string>()
  }: {
    rangeA?: CompareRange;
    rangeB?: CompareRange;
    presetA?: CompareAPreset;
    presetB?: CompareBPreset;
    onChangeA?: (preset: CompareAPreset) => void;
    onChangeB?: (preset: CompareBPreset) => void;
    projectPaths?: ReadonlyMap<string, string>;
  } = {}
) {
  return render(
    <CompareView
      inputs={inputs}
      now={NOW}
      rangeA={rangeA}
      rangeB={rangeB}
      presetA={presetA}
      presetB={presetB}
      onChangeA={onChangeA}
      onChangeB={onChangeB}
      projectPaths={projectPaths}
    />
  );
}

function readoutRow(metric: string): HTMLElement {
  const row = document.querySelector(`[data-probe="compare-readout-row"][data-metric="${metric}"]`);
  expect(row, `找不到指标行 ${metric}`).not.toBeNull();
  return row as HTMLElement;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CompareView · 区间选择", () => {
  it("两栏各有独立的 radiogroup，B 多一个「上一个等长区间」，解析结果常显", () => {
    renderCompare([]);

    const groupA = screen.getByRole("radiogroup", { name: "区间 A 的预设" });
    const groupB = screen.getByRole("radiogroup", { name: "区间 B 的预设" });
    expect(groupA).toBeInTheDocument();
    expect(groupB).toBeInTheDocument();

    expect(groupA.querySelectorAll('[role="radio"]')).toHaveLength(3);
    const bLabels = [...groupB.querySelectorAll('[role="radio"]')].map((node) => node.textContent);
    expect(bLabels).toEqual(["近 7 天", "近 30 天", "近 90 天", "上一个等长区间"]);

    // 解析结果：完整年月日 + 天数，常显。
    expect(screen.getByText("2026-11-15 ~ 2026-11-21 · 7 天")).toBeInTheDocument();
    expect(screen.getByText("2026-11-08 ~ 2026-11-14 · 7 天")).toBeInTheDocument();
  });

  it("切换预设会回调 onChange（父级负责重算区间）", async () => {
    const onChangeA = vi.fn();
    renderCompare([], { onChangeA });

    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    await user.click(
      within(screen.getByRole("radiogroup", { name: "区间 A 的预设" })).getByRole("radio", {
        name: "近 30 天"
      })
    );

    expect(onChangeA).toHaveBeenCalledWith("30");
  });
});

describe("CompareView · 重叠阻断", () => {
  it("重叠时只出提示，不出表格与图；控件保持可用", () => {
    renderCompare([], {
      rangeA: { startDay: day(2026, 11, 15), days: 7 }, // 11/15–11/21
      rangeB: { startDay: day(2026, 11, 18), days: 7 } // 11/18–11/24
    });

    const notice = document.querySelector('[data-probe="compare-overlap"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("两段区间重叠，无法对照");
    // 重叠 4 天（11-18 ~ 11-21）。
    expect(notice!.textContent).toContain("当前重叠 4 天（11-18 ~ 11-21）");
    // 结果区（表格 / 图）不出现，但控件仍在。
    expect(document.querySelector('[data-probe="compare-readouts"]')).toBeNull();
    expect(document.querySelector('[data-probe="compare-trend"]')).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "区间 A 的预设" })).toBeInTheDocument();
  });

  it("完全重合时正文换成「同一段时间跟自己比没有意义」", () => {
    const same = RANGE_A();
    renderCompare([], { rangeA: same, rangeB: { ...same } });

    const notice = document.querySelector('[data-probe="compare-overlap"]');
    expect(notice).not.toBeNull();
    expect(notice!.textContent).toContain("两个区间完全重合");
  });

  it("重叠优先于空态：两段都空且重叠时先说重叠", () => {
    renderCompare([], {
      rangeA: { startDay: day(2026, 11, 15), days: 7 },
      rangeB: { startDay: day(2026, 11, 15), days: 7 }
    });

    expect(document.querySelector('[data-probe="compare-overlap"]')).not.toBeNull();
    expect(screen.queryByText("这两个区间都没有记录")).toBeNull();
  });
});

describe("CompareView · 空态", () => {
  it("两段都空：panel 空态，控件保留", () => {
    renderCompare([], {
      rangeA: { startDay: day(2026, 11, 1), days: 7 },
      rangeB: { startDay: day(2026, 10, 1), days: 7 }
    });

    expect(screen.getByText("这两个区间都没有记录")).toBeInTheDocument();
    expect(
      screen.getByText("换两个有记录的时间段再对照。A 与 B 不能重叠。")
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "区间 A 的预设" })).toBeInTheDocument();
    expect(document.querySelector('[data-probe="compare-readouts"]')).toBeNull();
  });

  it("A 有、B 空：表照常，B 列 0、差值为 —，表下说明没有基线", () => {
    const inputs = [
      inputOf("-repo-alpha", [
        record(at(2026, 11, 16, 10), { kind: "user" }),
        record(at(2026, 11, 16, 10, 10), { model: SONNET, usage: usage(1_000_000) })
      ])
    ];
    // B 窗口里没有任何记录。
    renderCompare(inputs, {
      rangeA: RANGE_A(),
      rangeB: { startDay: day(2026, 10, 1), days: 7 }
    });

    const sessions = readoutRow("sessions");
    expect(sessions.querySelectorAll("td")[0]).toHaveTextContent("1");
    expect(sessions.querySelectorAll("td")[1]).toHaveTextContent("0");
    const delta = sessions.querySelector('[data-tone="none"]');
    expect(delta).not.toBeNull();
    expect(delta).toHaveTextContent("—");
    expect(screen.getByText(/区间 B 内没有记录，差值没有基线/)).toBeInTheDocument();
  });

  it("A 空、B 有：A 列 0，说明差值以 B 为基线", () => {
    const inputs = [
      inputOf("-repo-alpha", [record(at(2026, 11, 9, 10), { model: SONNET, usage: usage(1_000_000) })])
    ];
    renderCompare(inputs, {
      rangeA: { startDay: day(2026, 10, 1), days: 7 },
      rangeB: RANGE_B()
    });

    expect(readoutRow("sessions").querySelectorAll("td")[0]).toHaveTextContent("0");
    expect(screen.getByText(/区间 A 内没有记录：读数按 0 计，差值以 B 为基线/)).toBeInTheDocument();
  });
});

describe("CompareView · 时长读数口径", () => {
  it("平均会话时长：单元格走紧凑写法，悬浮里的绝对差仍说中文", () => {
    const inputs = [
      // A：一次 1h20m 的会话；B：一次 30m 的会话。
      inputOf("-repo-alpha", [
        record(at(2026, 11, 16, 9), { model: SONNET, usage: usage(1_000) }),
        record(at(2026, 11, 16, 10, 20), { model: SONNET, usage: usage(1_000) })
      ]),
      inputOf("-repo-beta", [
        record(at(2026, 11, 9, 10), { model: SONNET, usage: usage(1_000) }),
        record(at(2026, 11, 9, 10, 30), { model: SONNET, usage: usage(1_000) })
      ])
    ];
    renderCompare(inputs);

    const row = readoutRow("avgSessionMs");
    expect(row.querySelectorAll("td")[0]).toHaveTextContent("1h20m0s");
    expect(row.querySelectorAll("td")[1]).toHaveTextContent("30m0s");
    // 悬浮提示是叙述句，保留中文写法；两值差 50 分钟。
    expect(row.querySelector("td[title]")).toHaveAttribute("title", "绝对差 +50 分");
  });
});

describe("CompareView · 差值符号与颜色", () => {
  it("中性行只给数字与方向，成本行才涨红跌绿", () => {
    const inputs = [
      // A：两段会话，成本 $6。
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(1_000_000) })]),
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10, 10), { model: SONNET, usage: usage(1_000_000) })]),
      // B：一段会话，成本 $1.5。
      inputOf("-repo-beta", [record(at(2026, 11, 9, 10), { model: SONNET, usage: usage(500_000) })])
    ];
    renderCompare(inputs);

    const sessions = readoutRow("sessions");
    const sessionsDelta = sessions.querySelector("[data-direction]") as HTMLElement;
    // 2 vs 1 → +100%（中性）。
    expect(sessionsDelta).toHaveAttribute("data-direction", "neutral");
    expect(sessionsDelta).toHaveAttribute("data-tone", "up");
    expect(sessionsDelta).toHaveTextContent("+100%");
    expect(sessionsDelta.querySelector(".arrow, [class*='arrow']")).toHaveTextContent("▲");
    expect(sessionsDelta).toHaveAttribute("aria-label", "A 比 B 增加 100%");

    const cost = readoutRow("usd");
    const costDelta = cost.querySelector("[data-direction]") as HTMLElement;
    // $6 vs $1.5 → +300%（成本涨是坏事）。
    expect(costDelta).toHaveAttribute("data-direction", "up-bad");
    expect(costDelta).toHaveAttribute("data-tone", "up");
    expect(costDelta).toHaveTextContent("+300%");

    // 颜色规则：中性行禁止绿/红，成本行 up=danger、down=success。
    expect(ruleBodyFor('.deltaCell[data-direction="neutral"][data-tone="up"] .deltaValue')).toContain(
      "color: var(--text-secondary)"
    );
    expect(ruleBodyFor('.deltaCell[data-direction="up-bad"][data-tone="up"] .deltaValue')).toContain(
      "color: var(--danger)"
    );
    expect(
      ruleBodyFor('.deltaCell[data-direction="up-bad"][data-tone="down"] .deltaValue')
    ).toContain("color: var(--success)");
    // 中性选择器里不能出现彩色的数据墨水。
    expect(ruleBodyFor('.deltaCell[data-direction="neutral"][data-tone="up"] .deltaValue')).not.toMatch(
      /--danger|--success/
    );
  });

  it("下降用 U+2212 真减号；四舍五入到 0 写「持平」而不是「0%」", () => {
    const inputs = [
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(500_000) })]),
      inputOf("-repo-beta", [
        record(at(2026, 11, 9, 10), { model: SONNET, usage: usage(1_000_000) }),
        record(at(2026, 11, 9, 10, 10), { model: SONNET, usage: usage(1_000_000) })
      ])
    ];
    renderCompare(inputs);

    const costDelta = readoutRow("usd").querySelector("[data-direction]") as HTMLElement;
    expect(costDelta).toHaveAttribute("data-tone", "down");
    // 成本 $0.5M → $2M：-75%，减号是 U+2212（不是 ASCII 连字符）。
    expect(costDelta).toHaveTextContent("−75%");
    expect(costDelta.textContent).not.toContain("-75%");

    const active = readoutRow("activeDays").querySelector("[data-direction]") as HTMLElement;
    expect(active).toHaveAttribute("data-tone", "flat");
    expect(active).toHaveTextContent("持平");
    expect(active.textContent).not.toContain("0%");
  });
});

describe("CompareView · 未定价脚注", () => {
  it("只有出现未定价会话的一侧挂 † 与脚注，0 的一侧省略", () => {
    const inputs = [
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: "gpt-4o", usage: usage(100_000) })]),
      inputOf("-repo-beta", [record(at(2026, 11, 9, 10), { model: SONNET, usage: usage(1_000_000) })])
    ];
    renderCompare(inputs);

    const cost = readoutRow("usd");
    expect(cost.querySelectorAll("td")[0]).toHaveTextContent("†");
    expect(cost.querySelectorAll("td")[1]).not.toHaveTextContent("†");
    expect(screen.getByText(/† 区间 A 另有 1 个会话未定价/)).toBeInTheDocument();
    expect(screen.queryByText(/† 区间 B 另有/)).toBeNull();
    // 脚注里的 token 数是未定价那一段的四计数器之和。
    expect(screen.getByText(/† 区间 A 另有 1 个会话未定价（100,000 token）/)).toBeInTheDocument();
  });
});

describe("CompareView · 分布对比", () => {
  it("按项目：并集两段各算占比，只在一边出现的挂「仅 A / 仅 B」", () => {
    const inputs = [
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(1_000_000) })]),
      inputOf("-repo-beta", [record(at(2026, 11, 9, 10), { model: SONNET, usage: usage(500_000) })])
    ];
    renderCompare(inputs);

    const rows = document.querySelectorAll('[data-probe="compare-project-row"]');
    expect(rows).toHaveLength(2);
    const badge = document.querySelector('[data-probe="compare-project-row"] [class*="onlyBadge"]');
    expect(badge).not.toBeNull();
    // 两个项目各只出现在一侧。
    expect(screen.getByText("仅 A")).toBeInTheDocument();
    expect(screen.getByText("仅 B")).toBeInTheDocument();
  });

  it("按模型：同一个模型在两行必须同色（颜色映射建在并集上）", () => {
    const inputs = [
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(1_000_000) })]),
      inputOf("-repo-beta", [record(at(2026, 11, 9, 10), { model: SONNET, usage: usage(500_000) })])
    ];
    renderCompare(inputs);

    const rows = [...document.querySelectorAll('[data-probe="compare-model-row"]')];
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const segment = row.querySelector(`[data-model="${SONNET}"]`) as HTMLElement;
      expect(segment).not.toBeNull();
      expect(segment.getAttribute("data-color")).toBe("1");
    }
    // 两行同色：同一份 --segment-* 值。
    const first = rows[0].querySelector(`[data-model="${SONNET}"]`) as HTMLElement;
    const second = rows[1].querySelector(`[data-model="${SONNET}"]`) as HTMLElement;
    expect(first.style.getPropertyValue("--segment-fill")).toBe(
      second.style.getPropertyValue("--segment-fill")
    );
    expect(first.style.getPropertyValue("--segment-stroke")).toBe(
      second.style.getPropertyValue("--segment-stroke")
    );
    expect(first.style.getPropertyValue("--segment-fill")).toBe("var(--chart-1-soft)");

    // 大面积填充走 soft 令牌，实色只在 1px 描边；不给分段加 opacity。
    expect(ruleBodyFor(".modelSegment")).toContain("background: var(--segment-fill)");
    expect(ruleBodyFor(".modelSegment")).toContain("border-left: 1px solid var(--segment-stroke)");
    expect(ruleBodyFor(".modelSegment")).not.toContain("opacity");
  });

  it("一侧没有模型读数时该行换文案，而不是画一条空条", () => {
    const inputs = [
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(1_000_000) })])
    ];
    renderCompare(inputs, {
      rangeA: RANGE_A(),
      rangeB: { startDay: day(2026, 10, 1), days: 7 }
    });

    expect(screen.getByText("区间 B 没有模型读数")).toBeInTheDocument();
  });

  it("Top5 依次 chart-1..5，其余折进「其他」且不占 chart 色", () => {
    // 七个模型：前五个各 700k..300k，后两个各 100k——合计降序稳定。
    const models = [
      "claude-sonnet-4-5-20250929",
      "claude-opus-4-1-20250805",
      "claude-haiku-4-5-20251001",
      "claude-sonnet-4-20250514",
      "claude-opus-4-20250514",
      "claude-haiku-4-20250514",
      "claude-sonnet-3-7-20250219"
    ];
    const inputs = models.map((model, index) =>
      inputOf("-repo-alpha", [
        record(at(2026, 11, 16, 10), { model, usage: usage((7 - index) * 100_000) })
      ])
    );
    renderCompare(inputs);

    const legend = [...document.querySelectorAll('[data-probe="compare-model-legend"]')];
    expect(legend).toHaveLength(6);
    // 前五个各占一个 chart 色。
    expect(legend.slice(0, 5).map((node) => node.querySelector("[data-color]")!.getAttribute("data-color"))).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5"
    ]);
    // 其余折进「其他」：不占 chart 色，用 bg-active + border-strong。
    const other = legend[5].querySelector("[data-color='other']") as HTMLElement;
    expect(other).not.toBeNull();
    expect(other.style.getPropertyValue("--segment-fill")).toBe("var(--bg-active)");
    expect(other.style.getPropertyValue("--segment-stroke")).toBe("var(--border-strong)");
    expect(legend[5]).toHaveTextContent("其他");
  });
});

describe("CompareView · 日趋势按第 N 天对齐", () => {
  it("x 域取两段长度的最大值；短区间不拉伸，A 7 点、B 30 点，首点对齐", () => {
    const inputs = [
      inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(1_000_000) })])
    ];
    // A = 7 天，B = 30 天（一整段在 A 之外，避免触发重叠阻断）。
    renderCompare(inputs, {
      rangeA: RANGE_A(),
      rangeB: { startDay: day(2026, 10, 1), days: 30 }
    });

    const svg = screen.getByRole("img", { name: "每日趋势对照图" });
    // 长度不同时补一句「比的是区间总量，不是日均」——不做归一化。
    expect(
      screen.getByText(/两段区间长度不同（A 7 天 \/ B 30 天）：计数类指标比的是区间总量，不是日均。/)
    ).toBeInTheDocument();
    // 每天一个命中矩形：x 域 = 30。
    expect(svg.querySelectorAll('[data-probe="compare-trend-hit"]')).toHaveLength(30);

    const lineA = svg.querySelector('[data-probe="compare-trend-a"]')!.getAttribute("points")!.trim();
    const lineB = svg.querySelector('[data-probe="compare-trend-b"]')!.getAttribute("points")!.trim();
    const pointsA = lineA.split(/\s+/);
    const pointsB = lineB.split(/\s+/);
    expect(pointsA).toHaveLength(7);
    expect(pointsB).toHaveLength(30);
    // 第 1 天两段共享同一个 x：横轴是「区间内第 N 天」，不是日历日期。
    expect(pointsA[0].split(",")[0]).toBe(pointsB[0].split(",")[0]);

    // x 轴刻度最多 7 个，且以「第 N 天」呈现。
    const xLabels = [...svg.querySelectorAll("text")]
      .map((node) => node.textContent ?? "")
      .filter((text) => /^第 \d+ 天$/.test(text));
    expect(xLabels).toHaveLength(7);
    expect(xLabels[0]).toBe("第 1 天");

    // 命中矩形给两段各自的日期与 token 数。
    const titles = [...svg.querySelectorAll("title")].map((node) => node.textContent ?? "");
    expect(titles[0]).toContain("第 1 天");
    expect(titles[0]).toContain("A 11-15：");
    expect(titles[0]).toContain("B 10-01：");
    // 短区间不拉伸：第 8 天之后的 A 侧写「不在区间内」。
    expect(titles[7]).toContain("A 不在区间内");
  });

  it("A 实线 chart-1、B 虚线 chart-4；一侧为空时线画在 0 上并注明", () => {
    renderCompare(
      [inputOf("-repo-alpha", [record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(1_000_000) })])],
      { rangeA: RANGE_A(), rangeB: { startDay: day(2026, 10, 1), days: 7 } }
    );

    expect(ruleBodyFor(".trendLineA")).toContain("stroke: var(--chart-1)");
    expect(ruleBodyFor(".trendLineA")).toContain("stroke-width: 2");
    expect(ruleBodyFor(".trendLineB")).toContain("stroke: var(--chart-4)");
    expect(ruleBodyFor(".trendLineB")).toContain("stroke-dasharray: 5 3");

    // 空的一侧：图例注明区间内没有记录。
    expect(
      screen.getByText(/B · 2026-10-01 ~ 2026-10-07（7 天）\s*· 区间内没有记录（0 token）/)
    ).toBeInTheDocument();
  });
});
