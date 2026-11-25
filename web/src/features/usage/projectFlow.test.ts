import { describe, expect, it } from "vitest";
import { formatShareText } from "../../lib/format";
import type { SessionRecord } from "../sessions/types";
import { niceAxisMax } from "./charts/chartPrimitives";
import {
  addLocalDays,
  dayStartOf,
  formatDayLabel,
  type UsageSessionInput
} from "./usageAggregations";
import {
  buildFlowXTicks,
  buildLanePaths,
  buildProjectFlow,
  flowChartHeight,
  flowDayAtX,
  flowLaneBaseline,
  flowLaneTop,
  flowNameBaseline,
  flowPeakLane,
  flowPlotWidth,
  flowSelectBarY,
  flowSlot,
  flowSwatchY,
  flowTickStep,
  flowX,
  flowXLabelBaselineY,
  flowYMaxLabelY,
  flowYZeroLabelY,
  FLOW_LANE_HEIGHT,
  FLOW_PLOT_LEFT,
  monotoneTangents,
  sampleFlowSegment
} from "./projectFlow";

/**
 * 纯函数层（Issue #388 §7.1）。时间一律用本地日历构造，断言也走本地日历，
 * 因此这套用例在任何时区的 runner 上都成立；DST 那一条按 `weeklyWindow.test.ts`
 * 的既有做法临时切到 America/New_York，切不动时显式跳过而不是让断言恒真。
 */

const NOW = new Date(2026, 10, 24, 12, 0, 0).getTime();

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

/** 窗口的本地日零点（与 labWindow 同一公式）。 */
function dayStartsOf(days: number, now: number): number[] {
  const today = dayStartOf(now);
  return Array.from({ length: days }, (_, index) =>
    addLocalDays(today, index - (days - 1))
  );
}

/** 某天的本地正午：跨 DST 也稳稳落在那一天。 */
function noonOf(dayStart: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0).getTime();
}

function project(
  label: string,
  name: string,
  daily: readonly number[],
  now: number = NOW
): UsageSessionInput {
  const starts = dayStartsOf(daily.length, now);
  const records = daily.flatMap((tokens, index) =>
    tokens > 0 ? [record(noonOf(starts[index]), tokens)] : []
  );
  return {
    projectLabel: label,
    projectPath: `/work/${name}`,
    records
  };
}

/** 每天都有 token 的 N 个项目：第 i 个项目每天 `(i + 1) × step`。 */
function rankedProjects(
  count: number,
  days: number,
  step = 50,
  now: number = NOW
): UsageSessionInput[] {
  return Array.from({ length: count }, (_, index) => {
    const name = `p${index + 1}`;
    return project(`-work-${name}`, name, new Array<number>(days).fill((index + 1) * step), now);
  });
}

describe("窗口边界与日序列", () => {
  it("startTs 含、endTs 不含", () => {
    const starts = dayStartsOf(3, NOW);
    const endTs = addLocalDays(starts[2], 1);
    const flow = buildProjectFlow(
      [
        {
          projectLabel: "-work-alpha",
          projectPath: "/work/alpha",
          records: [
            record(starts[0], 100), // 正好落在起点：计入
            record(endTs, 500) // 正好落在终点：不计入
          ]
        }
      ],
      3,
      NOW
    );

    expect(flow.windowTokens).toBe(100);
    expect(flow.lanes[0].values).toEqual([100, 0, 0]);
    expect(flow.dayTotals).toEqual([100, 0, 0]);
  });

  it("跨午夜的会话按记录各自的本地日拆桶", () => {
    const flow = buildProjectFlow(
      [
        {
          projectLabel: "-work-alpha",
          projectPath: "/work/alpha",
          records: [
            record(new Date(2026, 10, 22, 23, 50).getTime(), 100),
            record(new Date(2026, 10, 23, 0, 10).getTime(), 50)
          ]
        }
      ],
      3,
      NOW
    );

    expect(flow.lanes[0].values).toEqual([100, 50, 0]);
    expect(flow.dayTotals).toEqual([100, 50, 0]);
    expect(flow.recordedDays).toBe(2);
  });

  it("日序列长度恒等于请求天数，每个键都是本地零点", () => {
    for (const requested of [1, 7, 30, 90]) {
      const flow = buildProjectFlow([], requested, NOW);
      expect(flow.days).toHaveLength(requested);

      const first = addLocalDays(dayStartOf(NOW), -(requested - 1));
      expect(flow.days[0]).toBe(first);
      for (const dayStart of flow.days) {
        const date = new Date(dayStart);
        expect(date.getHours()).toBe(0);
        expect(date.getMinutes()).toBe(0);
        expect(date.getSeconds()).toBe(0);
        expect(date.getMilliseconds()).toBe(0);
      }
      for (let index = 1; index < flow.days.length; index += 1) {
        const previous = new Date(flow.days[index - 1]);
        const next = new Date(flow.days[index]);
        const expected = new Date(
          previous.getFullYear(),
          previous.getMonth(),
          previous.getDate() + 1
        );
        expect(next.getTime()).toBe(expected.getTime());
      }
    }
  });

  it("跨夏令时不错位：日序列仍逐本地日历日推进（TZ=America/New_York）", (ctx) => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 前提自检：2026-03-08 是美国春令时，当天只有 23 小时。TZ 没生效的环境
      // 就明说跳过，不让断言变成恒真。
      const dayLength = new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime();
      if (dayLength !== 23 * 3_600_000) {
        ctx.skip();
        return;
      }

      const now = new Date(2026, 2, 10, 12, 0, 0).getTime();
      const flow = buildProjectFlow([], 5, now);

      expect(flow.days).toHaveLength(5);
      expect(flow.days[0]).toBe(new Date(2026, 2, 6).getTime());
      expect(flow.days[4]).toBe(new Date(2026, 2, 10).getTime());
      // 4 个日间隔里有 3/8 这个 23 小时的日子 → 95 小时，而不是 96。
      // 用 `+86_400_000` 推进的实现会在这里落到 01:00。
      expect(flow.days[4] - flow.days[0]).toBe(95 * 3_600_000);
      for (let index = 1; index < flow.days.length; index += 1) {
        const previous = new Date(flow.days[index - 1]);
        const next = new Date(flow.days[index]);
        expect(next.getDate()).toBe(previous.getDate() + 1);
        expect(next.getHours()).toBe(0);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});

describe("排名、Top 6 与尾部", () => {
  it("按总量降序；同分按显示名、再按 projectLabel；0 token 项目被排除", () => {
    const flow = buildProjectFlow(
      [
        project("-work-gamma", "gamma", [150, 50]),
        project("-work-beta", "beta", [50, 150]),
        project("-work-alpha", "alpha", [100, 200]),
        {
          // 有会话、有记录，但没有 usage：不参与排名。
          projectLabel: "-work-idle",
          projectPath: "/work/idle",
          records: [record(noonOf(dayStartsOf(2, NOW)[0]))]
        }
      ],
      2,
      NOW
    );

    expect(flow.lanes.map((lane) => lane.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(flow.lanes.map((lane) => lane.total)).toEqual([300, 200, 200]);
    expect(flow.projectCount).toBe(3);
    expect(flow.windowTokens).toBe(700);
  });

  it("显示名相同则按 projectLabel 字典序，且不同标签仍是两条河", () => {
    const flow = buildProjectFlow(
      [
        project("-work-z", "shared", [100, 0]),
        project("-work-a", "shared", [100, 0])
      ],
      2,
      NOW
    );

    expect(flow.lanes).toHaveLength(2);
    expect(flow.lanes.every((lane) => lane.name === "shared")).toBe(true);
    expect(flow.lanes.map((lane) => lane.key)).toEqual(["-work-a", "-work-z"]);
  });

  it("8 个项目 → 7 条河；尾部是逐日合计、中性色、不可选中", () => {
    const inputs = rankedProjects(8, 2);
    const flow = buildProjectFlow(inputs, 2, NOW);

    expect(flow.projectCount).toBe(8);
    expect(flow.lanes).toHaveLength(7);
    // 排名是总量**降序**：p8 … p3 进色板，p2 + p1 折成尾部。
    expect(flow.lanes.slice(0, 6).map((lane) => lane.name)).toEqual([
      "p8",
      "p7",
      "p6",
      "p5",
      "p4",
      "p3"
    ]);
    for (let index = 0; index < 6; index += 1) {
      expect(flow.lanes[index].tone).toBe(index + 1);
      expect(flow.lanes[index].isOther).toBe(false);
    }

    const other = flow.lanes[6];
    expect(other.key).toBe("__other__");
    expect(other.isOther).toBe(true);
    expect(other.tone).toBeNull();
    expect(other.name).toBe("其他 2 个项目");
    expect(other.shortName).toBe("其他 2 个");
    // 被折进来的是总量最小的 p2、p1：每天各 (2 + 1) × 50 = 150。
    expect(other.values).toEqual([150, 150]);
    expect(other.total).toBe(300);
    expect(other.total).toBe(flow.lanes[6].values.reduce((sum, value) => sum + value, 0));
    expect(other.activeDays).toBe(2);
  });

  it("恰好 7 个项目 → 第 7 条用真实项目名、中性色、不是合计", () => {
    const flow = buildProjectFlow(rankedProjects(7, 2), 2, NOW);

    expect(flow.lanes).toHaveLength(7);
    const seventh = flow.lanes[6];
    expect(seventh.isOther).toBe(false);
    expect(seventh.tone).toBeNull();
    // 降序排名：最后一个是最小的 p1，仍用它自己的真实名字。
    expect(seventh.name).toBe("p1");
    expect(seventh.key).toBe("-work-p1");
    expect(seventh.values).toEqual([50, 50]);
  });

  it("6 个项目 → 6 条河、无尾部、tones 1..6", () => {
    const flow = buildProjectFlow(rankedProjects(6, 2), 2, NOW);

    expect(flow.lanes).toHaveLength(6);
    expect(flow.lanes.map((lane) => lane.tone)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(flow.lanes.some((lane) => lane.isOther)).toBe(false);
  });

  it("峰值日并列取最早的一天", () => {
    const flow = buildProjectFlow(
      [project("-work-alpha", "alpha", [10, 50, 50, 10])],
      4,
      NOW
    );

    expect(flow.lanes[0].peakValue).toBe(50);
    expect(flow.lanes[0].peakDay).toBe(1);
  });

  it("摘要用的峰值河并列时取排名靠前的一条", () => {
    const flow = buildProjectFlow(
      [
        project("-work-alpha", "alpha", [30, 60]),
        project("-work-beta", "beta", [60, 30])
      ],
      2,
      NOW
    );

    expect(flow.lanes.map((lane) => lane.total)).toEqual([90, 90]);
    expect(flowPeakLane(flow.lanes)?.key).toBe("-work-alpha");
  });

  it("同一输入调用两次得到完全相同的顺序与 tone", () => {
    const inputs = [
      ...rankedProjects(9, 3),
      project("-work-tie-a", "tie", [100, 100, 100]),
      project("-work-tie-b", "tie", [100, 100, 100])
    ];
    const first = buildProjectFlow(inputs, 3, NOW);
    const second = buildProjectFlow(inputs, 3, NOW);

    expect(first.lanes.map((lane) => [lane.key, lane.tone, lane.total])).toEqual(
      second.lanes.map((lane) => [lane.key, lane.tone, lane.total])
    );
  });
});

describe("统一刻度", () => {
  it("max = niceAxisMax(所有绘制河道的单日最大值)", () => {
    const flow = buildProjectFlow(
      [
        project("-work-alpha", "alpha", [100, 250]),
        project("-work-beta", "beta", [50, 40]),
        project("-work-gamma", "gamma", [10, 20])
      ],
      2,
      NOW
    );

    expect(flow.rawMax).toBe(250);
    expect(flow.max).toBe(niceAxisMax(250));
  });

  it("尾部逐日合计超过任何单项目时刻度跟尾部走", () => {
    // 20 个项目：前 6 名每天各 1000 token，被折进来的 14 个合计每天 5250。
    // 单项目峰值撑不满河道，刻度必须跟尾部合计走，否则尾峰会溢出。
    const flow = buildProjectFlow(rankedProjects(20, 2), 2, NOW);
    const tail = flow.lanes[6];

    expect(tail.name).toBe("其他 14 个项目");
    expect(tail.values[0]).toBe(5250);
    expect(flow.rawMax).toBe(5250);
    expect(flow.max).toBe(niceAxisMax(5250));
    expect(flow.max).toBeGreaterThan(
      Math.max(...flow.lanes.slice(0, 6).map((lane) => lane.peakValue))
    );
  });
});

describe("单调三次曲线（Fritsch–Carlson）", () => {
  const laneTop = flowLaneTop(0);
  const baseline = flowLaneBaseline(0);

  function assertMonotoneInsideEndpoints(values: number[], max: number): void {
    const paths = buildLanePaths(values, { laneTop, baseline, max, slot: 40 });
    for (const segment of paths.segments) {
      const low = Math.min(segment.y0, segment.y1);
      const high = Math.max(segment.y0, segment.y1);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const { y } = sampleFlowSegment(segment, t);
        expect(Number.isFinite(y)).toBe(true);
        // y 落在两端点的闭区间内，且不越过河道上下边界。
        expect(y).toBeGreaterThanOrEqual(low - 1e-6);
        expect(y).toBeLessThanOrEqual(high + 1e-6);
        expect(y).toBeLessThanOrEqual(baseline + 1e-6);
        expect(y).toBeGreaterThanOrEqual(laneTop - 1e-6);
      }
    }
    expect(paths.line).not.toMatch(/NaN|Infinity/);
    expect(paths.line).toContain("C");
  }

  it("「高—0—高」不产生负面积，也不高于真实峰值", () => {
    const values = [100, 0, 100];
    const paths = buildLanePaths(values, { laneTop, baseline, max: 100, slot: 40 });

    expect(paths.segments).toHaveLength(2);
    assertMonotoneInsideEndpoints(values, 100);

    // 值不许超过 100 → y 不许高于满格时的 y。
    for (const segment of paths.segments) {
      const low = Math.min(segment.y0, segment.y1);
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        expect(sampleFlowSegment(segment, t).y).toBeGreaterThanOrEqual(low - 1e-6);
      }
    }
    // 0 值那天就落在基线上，不是「负面积」。
    expect(flowLaneTop(0) + FLOW_LANE_HEIGHT).toBe(baseline);
    expect(paths.segments[0].y1).toBe(baseline);
    expect(paths.segments[1].y0).toBe(baseline);
  });

  it("尖峰不被拉得比真实值更高，且穿过每一天的真实读数", () => {
    const values = [0, 0, 100, 0, 0];
    const paths = buildLanePaths(values, { laneTop, baseline, max: 100, slot: 40 });
    assertMonotoneInsideEndpoints(values, 100);

    for (const segment of paths.segments) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const { y } = sampleFlowSegment(segment, t);
        // 反算回值域：不许出现数据里没有的峰，也不许为负。
        const value = ((baseline - y) / FLOW_LANE_HEIGHT) * 100;
        expect(value).toBeGreaterThanOrEqual(-1e-6);
        expect(value).toBeLessThanOrEqual(100 + 1e-6);
      }
    }

    // t=0/1 就是真实日点：第 3 天（下标 2）是 100。
    expect(paths.segments[2].y0).toBe(laneTop);
    expect(paths.segments[2].x0).toBe(flowX(2, 40));
  });

  it("切线在局部极值处归零，相邻斜率异号时不外推", () => {
    expect(monotoneTangents([100, 0, 100])).toEqual([-100, 0, 100]);
    expect(monotoneTangents([0, 100, 100, 0])).toEqual([100, 0, 0, -100]);
    expect(monotoneTangents([42])).toEqual([0]);
    expect(monotoneTangents([])).toEqual([]);
  });

  it("面积路径在上沿之后落到基线并闭合", () => {
    const values = [10, 20, 5];
    const paths = buildLanePaths(values, { laneTop, baseline, max: 42, slot: 30 });
    expect(paths.area.startsWith(paths.line)).toBe(true);
    expect(paths.area.endsWith("Z")).toBe(true);
    expect(paths.area).toContain(`,${baseline}`);
    expect(paths.area.match(/L/g)).toHaveLength(2);
  });
});

describe("x 轴刻度抽稀", () => {
  const plotWidth = flowPlotWidth(960);

  it("90 天 + 100%：标签 ≤ 12，最后一天必有一个", () => {
    const days = dayStartsOf(90, NOW);
    const ticks = buildFlowXTicks(days, plotWidth, 1);

    expect(flowTickStep(90, plotWidth, 1)).toBe(14);
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(ticks[ticks.length - 1].index).toBe(89);
    expect(ticks[ticks.length - 1].label).toBe(formatDayLabel(days[89]));
    expect(ticks.every((tick) => tick.index >= 0 && tick.index < 90)).toBe(true);
  });

  it("90 天 + 130%：间距 ≥ 72.8，标签 ≤ 12，最后一天仍有标签", () => {
    const days = dayStartsOf(90, NOW);
    const ticks = buildFlowXTicks(days, plotWidth, 1.3);

    expect(ticks.length).toBeLessThanOrEqual(12);
    for (let index = 1; index < ticks.length; index += 1) {
      expect(ticks[index].x - ticks[index - 1].x).toBeGreaterThanOrEqual(72.8 - 1e-9);
    }
    expect(ticks[ticks.length - 1].index).toBe(89);
  });

  it("30 天是 3 天一步、7 天每天一个，x 落在绘图区内", () => {
    const thirty = buildFlowXTicks(dayStartsOf(30, NOW), plotWidth, 1);
    expect(flowTickStep(30, plotWidth, 1)).toBe(3);
    expect(thirty).toHaveLength(10);

    const seven = buildFlowXTicks(dayStartsOf(7, NOW), plotWidth, 1);
    expect(flowTickStep(7, plotWidth, 1)).toBe(1);
    expect(seven).toHaveLength(7);

    const slot = flowSlot(plotWidth, 30);
    for (const tick of thirty) {
      expect(tick.x).toBeGreaterThanOrEqual(FLOW_PLOT_LEFT);
      expect(tick.x).toBeLessThan(FLOW_PLOT_LEFT + plotWidth);
      expect(tick.x).toBe(flowX(tick.index, slot));
    }
  });
});

describe("空态四态与优先级", () => {
  it("窗口内没有会话 → no-sessions", () => {
    const outside = record(new Date(2025, 0, 1, 12, 0).getTime(), 100);
    const flow = buildProjectFlow(
      [{ projectLabel: "-work-alpha", projectPath: "/work/alpha", records: [outside] }],
      7,
      NOW
    );

    expect(flow.emptyReason).toBe("no-sessions");
    expect(flow.lanes).toEqual([]);
    expect(flow.windowTokens).toBe(0);
    expect(flow.days).toHaveLength(7);
  });

  it("有会话但没有 token → no-tokens", () => {
    const flow = buildProjectFlow(
      [
        {
          projectLabel: "-work-alpha",
          projectPath: "/work/alpha",
          records: [record(noonOf(dayStartsOf(7, NOW)[3]))]
        },
        project("-work-beta", "beta", [0, 0])
      ],
      7,
      NOW
    );

    expect(flow.emptyReason).toBe("no-tokens");
    expect(flow.recordedDays).toBe(0);
    expect(flow.projectCount).toBe(0);
  });

  it("只有 1 天有读数 → single-day，优先于 single-project", () => {
    const starts = dayStartsOf(7, NOW);
    const flow = buildProjectFlow(
      [
        {
          projectLabel: "-work-alpha",
          projectPath: "/work/alpha",
          records: [record(noonOf(starts[6]), 100)]
        },
        {
          projectLabel: "-work-beta",
          projectPath: "/work/beta",
          records: [record(noonOf(starts[6]), 50)]
        }
      ],
      7,
      NOW
    );

    expect(flow.recordedDays).toBe(1);
    expect(flow.projectCount).toBe(2);
    expect(flow.emptyReason).toBe("single-day");
  });

  it("只有 1 个项目 → single-project", () => {
    const flow = buildProjectFlow([project("-work-alpha", "alpha", [10, 20, 30])], 3, NOW);

    expect(flow.recordedDays).toBe(3);
    expect(flow.projectCount).toBe(1);
    expect(flow.emptyReason).toBe("single-project");
    expect(flow.lanes).toHaveLength(1);
  });

  it("两个项目、至少两天 → emptyReason 为 null 且至少 2 条河", () => {
    const flow = buildProjectFlow(
      [
        project("-work-alpha", "alpha", [10, 20]),
        project("-work-beta", "beta", [5, 15])
      ],
      2,
      NOW
    );

    expect(flow.emptyReason).toBeNull();
    expect(flow.lanes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("占比与格式", () => {
  it("每条河的窗口/当天占比之和为 1（浮点容差）", () => {
    const flow = buildProjectFlow(
      [
        project("-work-alpha", "alpha", [100, 200, 50]),
        project("-work-beta", "beta", [300, 100, 0]),
        project("-work-gamma", "gamma", [0, 40, 10])
      ],
      3,
      NOW
    );

    const windowSum = flow.lanes.reduce((sum, lane) => sum + lane.total, 0);
    expect(windowSum).toBe(flow.windowTokens);
    const windowShares = flow.lanes.map((lane) => lane.total / flow.windowTokens);
    expect(windowShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 10);

    for (let index = 0; index < flow.days.length; index += 1) {
      if (flow.dayTotals[index] === 0) continue;
      const dayShares = flow.lanes.map((lane) => lane.values[index] / flow.dayTotals[index]);
      expect(dayShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 10);
      const daySum = flow.lanes.reduce((sum, lane) => sum + lane.values[index], 0);
      expect(daySum).toBe(flow.dayTotals[index]);
    }
  });

  it("0 值显示 0.0%，极小的非零显示 <0.1%", () => {
    expect(formatShareText({ tokens: 0, share: 0 })).toBe("0.0%");
    expect(formatShareText({ tokens: 1, share: 0.0001 })).toBe("<0.1%");
    expect(formatShareText({ tokens: 5, share: 0.421 })).toBe("42.1%");
  });
});

describe("几何常量", () => {
  it("河道纵坐标与图高按 §1.3 的公式", () => {
    expect(flowLaneTop(0)).toBe(8);
    expect(flowLaneBaseline(0)).toBe(44);
    expect(flowLaneTop(6)).toBe(272);
    expect(flowLaneBaseline(6)).toBe(308);
    expect(flowChartHeight(7)).toBe(336);
    expect(flowChartHeight(2)).toBe(116);
  });

  it("绘图宽、槽宽与 band 中心", () => {
    expect(flowPlotWidth(960)).toBe(744);
    expect(flowPlotWidth(0)).toBe(744);
    expect(flowPlotWidth(300)).toBe(120);
    expect(flowSlot(744, 90)).toBeCloseTo(744 / 90, 10);
    expect(flowX(0, 10)).toBe(FLOW_PLOT_LEFT + 5);
    expect(flowX(9, 10)).toBe(FLOW_PLOT_LEFT + 95);
  });

  it("行内几何与指针命中按 §1.3 / §4.1", () => {
    expect(flowNameBaseline(0)).toBe(30);
    expect(flowSwatchY(0)).toBe(22);
    expect(flowSelectBarY(0)).toBe(16);
    expect(flowYMaxLabelY()).toBe(20);
    expect(flowYZeroLabelY()).toBe(40);
    expect(flowXLabelBaselineY(7)).toBe(322);

    const slot = flowSlot(744, 90);
    expect(flowDayAtX(FLOW_PLOT_LEFT, slot, 90)).toBe(0);
    expect(flowDayAtX(FLOW_PLOT_LEFT + slot * 0.5, slot, 90)).toBe(0);
    expect(flowDayAtX(flowX(3, slot), slot, 90)).toBe(3);
    expect(flowDayAtX(FLOW_PLOT_LEFT - 500, slot, 90)).toBe(0);
    expect(flowDayAtX(FLOW_PLOT_LEFT + slot * 200, slot, 90)).toBe(89);
  });
});
