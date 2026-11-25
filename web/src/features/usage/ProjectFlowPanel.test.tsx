import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { resetFontScaleForTest, setFontScale } from "../settings/fontScale";
import {
  addLocalDays,
  dayStartOf,
  formatDayLabel,
  type UsageSessionInput
} from "./usageAggregations";
import { formatTokenCount } from "../../lib/format";
import {
  flowChartHeight,
  flowLaneTop,
  flowPlotWidth,
  flowSlot,
  flowX,
  FLOW_PLOT_LEFT
} from "./projectFlow";
import { ProjectFlowPanel } from "./ProjectFlowPanel";

/**
 * Issue #388 的界面层（规格 §7.2）：探针契约、颜色映射、悬停、选中、键盘、
 * live region、等价表与四种空态。几何断言与纯函数层用同一组常量，
 * 不重抄数字。
 */

const NOW = new Date(2026, 10, 24, 12, 0, 0).getTime();
const DAYS = 5;

let seq = 0;

function record(timestamp: number, tokens?: number): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...(tokens === undefined
      ? {}
      : {
          usage: {
            inputTokens: tokens,
            outputTokens: 0,
            cacheCreationTokens: 0,
            cacheReadTokens: 0
          }
        })
  };
}

function dayStarts(): number[] {
  const today = dayStartOf(NOW);
  return Array.from({ length: DAYS }, (_, index) =>
    addLocalDays(today, index - (DAYS - 1))
  );
}

function noonOf(dayStart: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0).getTime();
}

function project(name: string, daily: readonly number[]): UsageSessionInput {
  const starts = dayStarts();
  const records = daily.flatMap((tokens, index) =>
    tokens > 0 ? [record(noonOf(starts[index]), tokens)] : []
  );
  return {
    projectLabel: `-work-${name}`,
    projectPath: `/work/${name}`,
    records
  };
}

/** 5 个项目、每天都有读数：tone 1..5，第 0/1 条总量最高。 */
function fiveLanes(): UsageSessionInput[] {
  return [
    project("alpha", [100, 0, 200, 50, 0]),
    project("beta", [50, 100, 0, 0, 100]),
    project("gamma", [0, 20, 30, 40, 10]),
    project("delta", [10, 10, 10, 10, 10]),
    project("epsilon", [5, 5, 5, 5, 5])
  ];
}

/** 两个项目、窗口内只有两天有读数：命中「某天合计为 0」的悬停分支。 */
function sparseTwoLanes(): UsageSessionInput[] {
  return [project("alpha", [100, 0, 0, 0, 0]), project("beta", [0, 50, 0, 0, 0])];
}

/** N 个总量严格递减的项目，用来覆盖 Top 6 + 尾部 / 恰好 7 个项目。 */
function rankedProjects(count: number): UsageSessionInput[] {
  return Array.from({ length: count }, (_, index) =>
    project(`p${index + 1}`, new Array<number>(DAYS).fill((count - index) * 100))
  );
}

/** 默认 960 兜底宽度下的绘图宽度与每日槽宽（与组件同源）。 */
const PLOT_WIDTH = flowPlotWidth(960);
const SLOT = flowSlot(PLOT_WIDTH, DAYS);
const CHART_WIDTH = 960;

function renderPanel(inputs: UsageSessionInput[]) {
  return render(<ProjectFlowPanel inputs={inputs} days={DAYS} now={NOW} />);
}

function group(): HTMLElement {
  return screen.getByRole("group", { name: "项目流量河流图（可交互）" });
}

function svg(): SVGSVGElement {
  const element = document.querySelector<SVGSVGElement>('svg[data-probe="ribbon-chart"]');
  if (!element) throw new Error("ribbon-chart 未渲染");
  return element;
}

function tones(): string[] {
  return Array.from(document.querySelectorAll("[data-ribbon-tone]")).map(
    (node) => node.getAttribute("data-ribbon-tone") ?? ""
  );
}

function hoverDay(dayIndex: number) {
  fireEvent.pointerMove(svg(), {
    clientX: flowX(dayIndex, SLOT),
    clientY: flowLaneTop(0) + 18
  });
}

beforeEach(() => {
  setFontScale(1);
});

afterEach(() => {
  resetFontScaleForTest(1);
  seq = 0;
});

describe("渲染与探针契约", () => {
  it("卡片、SVG、五条河道、唯一 tone 与 rank 都在", async () => {
    renderPanel(fiveLanes());

    expect(await screen.findByRole("region", { name: "项目流量" })).toBeInTheDocument();
    expect(document.querySelector('[data-probe="lab-ribbon"]')).not.toBeNull();
    expect(svg()).toBeInTheDocument();
    expect(document.querySelectorAll("[data-ribbon-lane]")).toHaveLength(5);
    expect(tones()).toEqual(["1", "2", "3", "4", "5"]);
    expect(
      Array.from(document.querySelectorAll("[data-ribbon-rank]")).map((node) =>
        node.getAttribute("data-ribbon-rank")
      )
    ).toEqual(["0", "1", "2", "3", "4"]);
    // 图高 = 44 × 河道数 + 28；与字号档无关。
    expect(svg().getAttribute("viewBox")).toBe(`0 0 ${CHART_WIDTH} ${flowChartHeight(5)}`);
  });

  it("SVG 摘要是一句可读的话，含项目数、token 与满格刻度", () => {
    renderPanel(fiveLanes());
    const label = screen.getByRole("img", { name: /^项目流量：/ }).getAttribute("aria-label");
    expect(label).toContain("5 个项目有用量");
    expect(label).toContain("token");
    expect(label).toContain("满格");
    expect(svg().getAttribute("data-ribbon-max")).toBe("200");
  });
});

describe("颜色映射", () => {
  it("彩色河道 fill 是 --chart-N-soft；SVG 内没有 opacity / color-mix", () => {
    renderPanel(fiveLanes());
    const alpha = document.querySelector('[data-ribbon-lane="-work-alpha"]');
    expect(alpha).not.toBeNull();
    const area = alpha!.querySelector("path");
    expect(area?.getAttribute("fill")).toBe("var(--chart-1-soft)");

    expect(svg().querySelectorAll("[opacity], [fill-opacity]")).toHaveLength(0);
    expect(svg().innerHTML).not.toContain("color-mix");
  });

  it("130% 字号重渲染后 tone 映射不变；点击选中后也不变", () => {
    const first = renderPanel(fiveLanes());
    const before = tones();
    first.unmount();

    setFontScale(1.3);
    renderPanel(fiveLanes());
    expect(tones()).toEqual(before);

    fireEvent.click(document.querySelector('[data-ribbon-hit="-work-beta"]')!);
    expect(tones()).toEqual(before);
  });

  it("尾部合计用中性面与虚线，不可选中", () => {
    renderPanel(rankedProjects(8));
    const lanes = document.querySelectorAll("[data-ribbon-lane]");
    expect(lanes).toHaveLength(7);
    const tail = document.querySelector('[data-ribbon-lane="__other__"]');
    expect(tail).not.toBeNull();
    expect(tail!.getAttribute("data-ribbon-tone")).toBe("neutral");
    expect(tail!.querySelector("path")?.getAttribute("fill")).toBe("var(--bg-active)");
    const edge = tail!.querySelectorAll("path")[1];
    expect(edge.getAttribute("stroke-dasharray")).toBe("4 3");

    fireEvent.click(document.querySelector('[data-ribbon-hit="__other__"]')!);
    expect(svg().getAttribute("data-ribbon-selected")).toBeNull();
    expect(screen.getByText(/第 7 条「其他 2 个」是总量第 7 名及以后项目的当日合计。/)).toBeInTheDocument();
  });

  it("恰好 7 个项目：第 7 条是真实项目名、中性色但可选中", () => {
    renderPanel(rankedProjects(7));
    const lanes = document.querySelectorAll("[data-ribbon-lane]");
    expect(lanes).toHaveLength(7);
    const seventh = document.querySelector('[data-ribbon-lane="-work-p7"]');
    expect(seventh).not.toBeNull();
    expect(seventh!.getAttribute("data-ribbon-tone")).toBe("neutral");
    expect(screen.getByText(/色板只有六档，第 7 名用中性色；它仍是单个项目，不是合计。/)).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-ribbon-hit="-work-p7"]')!);
    expect(svg().getAttribute("data-ribbon-selected")).toBe("-work-p7");
  });
});

describe("坐标轴与今天线", () => {
  it("y 轴只有 2 个标签（zero / max），今天线在最后一天 band 中心", () => {
    renderPanel(fiveLanes());
    const labels = document.querySelectorAll("[data-ribbon-y-label]");
    expect(labels).toHaveLength(2);
    expect(document.querySelector('[data-ribbon-y-label="zero"]')?.textContent).toBe("0");
    expect(document.querySelector('[data-ribbon-y-label="max"]')?.textContent).toBe("200");

    const today = document.querySelector("[data-ribbon-today]");
    expect(today).not.toBeNull();
    expect(Number(today!.getAttribute("x1"))).toBeCloseTo(flowX(DAYS - 1, SLOT), 1);
  });
});

describe("悬停", () => {
  it("在已知日 band 中心派发 pointermove：游标 x 对得上、点与 tooltip 行数等于河道数", () => {
    renderPanel(fiveLanes());
    hoverDay(2);

    const cursor = document.querySelector("[data-ribbon-cursor]");
    expect(cursor).not.toBeNull();
    const x = Number(cursor!.getAttribute("x1"));
    expect(Math.abs(x - (FLOW_PLOT_LEFT + 2.5 * SLOT))).toBeLessThanOrEqual(0.5);

    const dots = document.querySelectorAll("[data-ribbon-dot]");
    expect(dots).toHaveLength(5);

    const tooltip = document.querySelector("[data-ribbon-tooltip]");
    expect(tooltip).not.toBeNull();
    expect(document.querySelectorAll("[data-ribbon-tooltip-row]")).toHaveLength(5);
    expect(tooltip!.textContent).toContain(formatDayLabel(addLocalDays(dayStartOf(NOW), -2)));
    expect(tooltip!.textContent).toContain("当天");
    // 浮层先量后定位，且被 clamp 在视口 8px 边距内。
    expect(parseFloat((tooltip as HTMLElement).style.left)).toBeGreaterThanOrEqual(8);
    expect(parseFloat((tooltip as HTMLElement).style.top)).toBeGreaterThanOrEqual(8);
  });

  it("某天合计为 0 时只画竖线、不画点，tooltip 说明没有用量", () => {
    renderPanel(sparseTwoLanes());
    hoverDay(2);

    expect(document.querySelector("[data-ribbon-cursor]")).not.toBeNull();
    expect(document.querySelectorAll("[data-ribbon-dot]")).toHaveLength(0);
    expect(document.querySelector("[data-ribbon-tooltip]")?.textContent).toContain(
      "这一天没有用量记录"
    );
  });

  it("指针离开后游标、点与 tooltip 一起消失", () => {
    renderPanel(fiveLanes());
    hoverDay(2);
    expect(document.querySelector("[data-ribbon-cursor]")).not.toBeNull();

    fireEvent.pointerLeave(svg());
    expect(document.querySelector("[data-ribbon-cursor]")).toBeNull();
    expect(document.querySelectorAll("[data-ribbon-dot]")).toHaveLength(0);
    expect(document.querySelector("[data-ribbon-tooltip]")).toBeNull();
  });
});

describe("点击选中", () => {
  it("点第 2 条河：选中 2px、其余降级为 1px 且填充不变；再点取消", () => {
    renderPanel(fiveLanes());
    const fillBefore = document
      .querySelector('[data-ribbon-lane="-work-alpha"] path')
      ?.getAttribute("fill");
    const hit = document.querySelector('[data-ribbon-hit="-work-beta"]');

    fireEvent.click(hit!);
    expect(svg().getAttribute("data-ribbon-selected")).toBe("-work-beta");

    const betaEdge = document
      .querySelector('[data-ribbon-lane="-work-beta"]')
      ?.querySelectorAll("path")[1];
    expect(betaEdge?.getAttribute("stroke-width")).toBe("2");
    expect(betaEdge?.hasAttribute("data-ribbon-dim")).toBe(false);

    const alphaEdge = document
      .querySelector('[data-ribbon-lane="-work-alpha"]')
      ?.querySelectorAll("path")[1];
    expect(alphaEdge?.getAttribute("stroke-width")).toBe("1");
    expect(alphaEdge?.hasAttribute("data-ribbon-dim")).toBe(true);
    expect(
      document.querySelector('[data-ribbon-lane="-work-alpha"] path')?.getAttribute("fill")
    ).toBe(fillBefore);

    expect(document.querySelector('[data-ribbon-select-bar="-work-beta"]')).not.toBeNull();
    // 图下读数行（等价表里也有「窗口合计」，所以不能按整页文本定位）。
    expect(document.querySelector('[data-probe="lab-ribbon"]')?.textContent).toContain(
      "占本窗口"
    );

    fireEvent.click(hit!);
    expect(svg().getAttribute("data-ribbon-selected")).toBeNull();
  });

  it("Escape 清除选中", () => {
    renderPanel(fiveLanes());
    fireEvent.click(document.querySelector('[data-ribbon-hit="-work-gamma"]')!);
    expect(svg().getAttribute("data-ribbon-selected")).toBe("-work-gamma");

    group().focus();
    fireEvent.keyDown(group(), { key: "Escape" });
    expect(svg().getAttribute("data-ribbon-selected")).toBeNull();
  });
});

describe("键盘", () => {
  it("只有外层一个 Tab 停点；焦点环落在第 1 条河", async () => {
    renderPanel(fiveLanes());
    const card = document.querySelector('[data-probe="lab-ribbon"]')!;
    expect(card.querySelectorAll('[tabindex="0"]')).toHaveLength(1);

    group().focus();
    const ring = await waitFor(() => {
      const node = document.querySelector("[data-ribbon-focus-ring]");
      expect(node).not.toBeNull();
      return node!;
    });
    expect(Number(ring.getAttribute("y"))).toBe(flowLaneTop(0) - 3);
  });

  it("Home / ArrowRight / ArrowDown / Enter / Escape 与 preventDefault", async () => {
    renderPanel(fiveLanes());
    const el = group();
    el.focus();
    const cursor = await waitFor(() => {
      const node = document.querySelector("[data-ribbon-cursor]");
      expect(node).not.toBeNull();
      return node!;
    });

    // 焦点进入时落在今天。
    expect(Number(cursor.getAttribute("x1"))).toBeCloseTo(flowX(DAYS - 1, SLOT), 1);

    expect(fireEvent.keyDown(el, { key: "Home" })).toBe(false);
    expect(
      Number(document.querySelector("[data-ribbon-cursor]")!.getAttribute("x1"))
    ).toBeCloseTo(flowX(0, SLOT), 1);

    expect(fireEvent.keyDown(el, { key: "ArrowRight" })).toBe(false);
    expect(
      Number(document.querySelector("[data-ribbon-cursor]")!.getAttribute("x1"))
    ).toBeCloseTo(flowX(1, SLOT), 1);

    expect(fireEvent.keyDown(el, { key: "ArrowDown" })).toBe(false);
    const ring = document.querySelector("[data-ribbon-focus-ring]");
    expect(Number(ring!.getAttribute("y"))).toBe(flowLaneTop(1) - 3);

    expect(fireEvent.keyDown(el, { key: "Enter" })).toBe(false);
    expect(svg().getAttribute("data-ribbon-selected")).toBe("-work-beta");

    expect(fireEvent.keyDown(el, { key: "Escape" })).toBe(false);
    expect(svg().getAttribute("data-ribbon-selected")).toBeNull();
  });

  it("聚焦滚入视口的 scroll 不会清掉刚就位的游标；之后的滚动仍会关闭", () => {
    renderPanel(fiveLanes());
    const el = group();
    act(() => {
      el.focus();
    });

    // 浏览器在 Tab 聚焦时把元素滚入视口，随后派发一个 scroll（Chromium 下几乎
    // 紧跟 focus，WebKit 下可能晚一帧）。旧实现会在这里把刚立起来的游标清掉。
    fireEvent.scroll(window);
    expect(svg().getAttribute("data-ribbon-cursor-day")).toBe(String(DAYS - 1));
    expect(document.querySelector("[data-ribbon-cursor]")).not.toBeNull();
    expect(document.querySelector("[data-ribbon-tooltip]")).not.toBeNull();

    // 守卫只吞第一条：下一条 scroll（无论多久以后）都按既有语义关闭。
    fireEvent.scroll(window);
    expect(svg().getAttribute("data-ribbon-cursor-day")).toBeNull();
    expect(document.querySelector("[data-ribbon-cursor]")).toBeNull();
    expect(document.querySelector("[data-ribbon-tooltip]")).toBeNull();
  });

  it("滚轮 / PageDown 先解除守卫，用户滚动不会被吞", () => {
    const first = renderPanel(fiveLanes());
    act(() => group().focus());
    fireEvent.wheel(window, { deltaY: 120 });
    fireEvent.scroll(window);
    expect(svg().getAttribute("data-ribbon-cursor-day")).toBeNull();
    first.unmount();

    renderPanel(fiveLanes());
    act(() => group().focus());
    fireEvent.keyDown(group(), { key: "PageDown" });
    fireEvent.scroll(window);
    expect(svg().getAttribute("data-ribbon-cursor-day")).toBeNull();
  });

  it("live region 报日期、当前河、token 与占比；锁定后含「已锁定」", () => {
    renderPanel(fiveLanes());
    const el = group();
    el.focus();
    fireEvent.keyDown(el, { key: "ArrowLeft" });

    const live = document.querySelector("[data-ribbon-live]");
    expect(live).not.toBeNull();
    expect(live!.textContent).toContain(formatDayLabel(addLocalDays(dayStartOf(NOW), -1)));
    expect(live!.textContent).toContain("alpha");
    expect(live!.textContent).toContain("token");
    expect(live!.textContent).toContain("%");

    fireEvent.keyDown(el, { key: "Enter" });
    expect(live!.textContent).toContain("已锁定");
  });
});

describe("等价表", () => {
  it("一行一条河，列头与尾部名字都在", () => {
    renderPanel(rankedProjects(8));
    const table = screen.getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "项目",
      "窗口合计",
      "占本窗口",
      "峰值日",
      "峰值 token",
      "有记录天数"
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(8); // 表头 + 7 条河
    const tailRow = within(table).getByText("其他 2 个项目").closest("tr");
    expect(tailRow).not.toBeNull();
    // p7 200 + p8 100（每天），各 5 天 → 尾部窗口合计 1,500 token。
    expect(within(tailRow as HTMLElement).getByText(`${formatTokenCount(1500)} token`)).toBeInTheDocument();
  });
});

describe("空态", () => {
  function expectEmpty(reason: string, title: RegExp) {
    expect(document.querySelector(`[data-ribbon-empty="${reason}"]`)).not.toBeNull();
    expect(screen.getByText(title)).toBeInTheDocument();
    expect(document.querySelector('svg[data-probe="ribbon-chart"]')).toBeNull();
  }

  it("无会话", () => {
    renderPanel([]);
    expectEmpty("no-sessions", /所选范围内没有会话/);
  });

  it("有会话但没有 token 用量", () => {
    renderPanel([
      {
        projectLabel: "-work-alpha",
        projectPath: "/work/alpha",
        records: [record(noonOf(dayStarts()[0]))]
      }
    ]);
    expectEmpty("no-tokens", /所选范围内有会话，但没有 token 用量/);
    expect(screen.getByText(/要么日志缺少 usage 计数/)).toBeInTheDocument();
  });

  it("只有 1 天有读数", () => {
    renderPanel([
      project("alpha", [100, 0, 0, 0, 0]),
      project("beta", [50, 0, 0, 0, 0])
    ]);
    expectEmpty("single-day", /只有 1 天有 token 读数/);
  });

  it("只有 1 个项目", () => {
    renderPanel([project("alpha", [10, 20, 0, 0, 0])]);
    expectEmpty("single-project", /只有 1 个项目有记录/);
    expect(screen.getByText(/合计 30 token/)).toBeInTheDocument();
  });

  it("数据恢复后重新画出图（空态不缓存）", () => {
    const { rerender } = renderPanel([]);
    expect(document.querySelector('svg[data-probe="ribbon-chart"]')).toBeNull();
    rerender(<ProjectFlowPanel inputs={fiveLanes()} days={DAYS} now={NOW} />);
    expect(document.querySelector('svg[data-probe="ribbon-chart"]')).not.toBeNull();
    expect(document.querySelectorAll("[data-ribbon-lane]")).toHaveLength(5);
  });
});
