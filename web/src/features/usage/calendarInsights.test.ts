import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import {
  addLocalDays,
  dayStartOf,
  type UsageSessionInput
} from "./usageAggregations";
import { buildUsageCalendar, type UsageCalendar } from "./usageCalendar";
import { calendarInsightsOf } from "./calendarInsights";

/**
 * 「一年洞察」数据层契约（Issue #199）：六条公式（§2.2）与取舍规则（§3）的
 * 逐条钉死——「有消耗」= costUsd > 0 与格子 0 档同口径、并列取最近段、环比
 * 等长对齐窗、全空年哨兵。时刻一律固定注入，断言不随运行日期漂移。
 *
 * 布景用 `calendarWith` 手搓：先 `buildUsageCalendar([], now)` 拿正确几何
 * （53 列 / pad / 窗口），再按「now−N 天 → costUsd」覆写对应天格——几何数学
 * 不重造。洞察只读 costUsd / dayStart，覆写后 level 与 quartiles 不再自洽
 * 无碍（本模块不消费它们）。
 */

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime(); // 2026-10-12 本地
const TODAY = dayStartOf(NOW);
const DAY_AT = (offset: number): number => addLocalDays(TODAY, offset);
const WINDOW_START = DAY_AT(-364);

/** 手搓 calendar：`{ "now−N 天": costUsd }` 覆写进 cells，其余保持空窗几何。 */
function calendarWith(now: number, costByOffset: Readonly<Record<number, number>>): UsageCalendar {
  const calendar = buildUsageCalendar([], now);
  const todayStart = dayStartOf(now);
  const patchByDay = new Map<number, number>();
  for (const [offset, cost] of Object.entries(costByOffset)) {
    patchByDay.set(addLocalDays(todayStart, Number(offset)), cost);
  }
  return {
    ...calendar,
    cells: calendar.cells.map((column) =>
      column.map((cell) =>
        cell.kind === "day" && patchByDay.has(cell.dayStart)
          ? { ...cell, costUsd: patchByDay.get(cell.dayStart)! }
          : cell
      )
    )
  };
}

/** 测试侧的天数差（与实现同一算法：逐日历日计数，不用 ms 除法）。 */
function daysBetween(fromDay: number, toDay: number): number {
  let count = 0;
  let cursor = fromDay;
  while (cursor < toDay) {
    cursor = addLocalDays(cursor, 1);
    count += 1;
  }
  return count;
}

/** cells 里 costUsd > 0 的天格计数（守卫用例的独立账）。 */
function activeCellCount(calendar: UsageCalendar): number {
  let count = 0;
  for (const column of calendar.cells) {
    for (const cell of column) {
      if (cell.kind === "day" && cell.costUsd > 0) count += 1;
    }
  }
  return count;
}

describe("calendarInsightsOf · 最长连胜", () => {
  it("单段：days / startDay / endDay", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-10": 1, "-9": 1, "-8": 1 }), NOW);
    expect(insights.longestStreak).toEqual({
      days: 3,
      startDay: DAY_AT(-10),
      endDay: DAY_AT(-8),
      touchesWindowStart: false
    });
  });

  it("多段取最长", () => {
    const insights = calendarInsightsOf(
      calendarWith(NOW, { "-10": 1, "-9": 1, "-8": 1, "-5": 1, "-4": 1, "-3": 1, "-2": 1, "-1": 1 }),
      NOW
    );
    expect(insights.longestStreak?.days).toBe(5);
    expect(insights.longestStreak?.endDay).toBe(DAY_AT(-1));
  });

  it("并列取最近一段（days 相同 → endDay 大者胜）", () => {
    const insights = calendarInsightsOf(
      calendarWith(NOW, { "-10": 1, "-9": 1, "-8": 1, "-5": 1, "-4": 1, "-3": 1 }),
      NOW
    );
    expect(insights.longestStreak?.days).toBe(3);
    expect(insights.longestStreak?.startDay).toBe(DAY_AT(-5));
    expect(insights.longestStreak?.endDay).toBe(DAY_AT(-3));
  });

  it("段起点落在窗口首日 → touchesWindowStart（真实长度是下界）", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-364": 1, "-363": 1 }), NOW);
    expect(insights.longestStreak?.touchesWindowStart).toBe(true);
    expect(insights.longestStreak?.startDay).toBe(WINDOW_START);
  });
});

describe("calendarInsightsOf · 当前连胜三态", () => {
  it("active：今天有消耗，从今天往回数", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-2": 1, "-1": 1, "0": 1 }), NOW);
    expect(insights.currentStreak).toEqual({
      kind: "active",
      days: 3,
      startDay: DAY_AT(-2)
    });
  });

  it("pending：今天无、昨天有——区间是该连续段的首末日", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-3": 1, "-2": 1, "-1": 1 }), NOW);
    expect(insights.currentStreak).toEqual({
      kind: "pending",
      days: 3,
      startDay: DAY_AT(-3),
      endDay: DAY_AT(-1)
    });
  });

  it("broken：昨天也无——lastActiveDay 与 idleDays（addLocalDays 计数），idleDays ≥ 2 恒成立", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-5": 1 }), NOW);
    expect(insights.currentStreak).toEqual({
      kind: "broken",
      lastActiveDay: DAY_AT(-5),
      idleDays: daysBetween(DAY_AT(-5), TODAY)
    });
    expect((insights.currentStreak as { idleDays: number }).idleDays).toBe(5);

    // broken 分支的前提是昨天也无活动 → lastActiveDay ≤ 前天 → idleDays ≥ 2。
    const tightest = calendarInsightsOf(calendarWith(NOW, { "-2": 1 }), NOW);
    expect(tightest.currentStreak).toEqual({
      kind: "broken",
      lastActiveDay: DAY_AT(-2),
      idleDays: 2
    });
  });

  it("防御：now 的 dayStart 不在窗口内时按窗口最后一天算（跨天挂机的理论边界）", () => {
    const calendar = calendarWith(NOW, { "0": 1 });
    // 三天后的 now：dayStart 越过窗口终点 → 「今天」回退为窗口最后一天。
    const insights = calendarInsightsOf(calendar, addLocalDays(NOW, 3));
    expect(insights.currentStreak).toEqual({
      kind: "active",
      days: 1,
      startDay: TODAY
    });
  });
});

describe("calendarInsightsOf · 最贵一天", () => {
  it("唯一最大", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-3": 1, "-7": 5 }), NOW);
    expect(insights.peakDay).toEqual({ dayStart: DAY_AT(-7), costUsd: 5 });
  });

  it("并列取最近（costUsd 相同 → dayStart 大者胜）", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-5": 2, "-3": 2 }), NOW);
    expect(insights.peakDay).toEqual({ dayStart: DAY_AT(-3), costUsd: 2 });
  });

  it("全空年 → null", () => {
    expect(calendarInsightsOf(calendarWith(NOW, {}), NOW).peakDay).toBeNull();
  });
});

describe("calendarInsightsOf · 最长空白", () => {
  it("基本段：单一消耗天把窗口切成三段空白，最长在前段且触及窗口首日", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-5": 1 }), NOW);
    expect(insights.longestGap).toEqual({
      days: daysBetween(WINDOW_START, DAY_AT(-6)) + 1,
      startDay: WINDOW_START,
      endDay: DAY_AT(-6),
      touchesWindowStart: true
    });
  });

  it("边缘段：全空年 = 整窗一个 365 天空白段", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, {}), NOW);
    expect(insights.longestGap).toEqual({
      days: 365,
      startDay: WINDOW_START,
      endDay: TODAY,
      touchesWindowStart: true
    });
  });

  it("365 天全有消耗 → null（理论态钉死）", () => {
    const allActive = Object.fromEntries(
      Array.from({ length: 365 }, (_, index) => [String(index - 364), 1])
    );
    expect(calendarInsightsOf(calendarWith(NOW, allActive), NOW).longestGap).toBeNull();
  });
});

describe("calendarInsightsOf · 活跃占比", () => {
  it("days = costUsd > 0 的计数（0 成本天不计），total 从天格实数", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, { "-3": 2, "-2": 0, "-1": 1 }), NOW);
    expect(insights.activeDays).toEqual({ days: 2, total: 365 });
  });
});

describe("calendarInsightsOf · 本月环比（等长对齐窗）", () => {
  it("now = 2026-10-13：N = 13，两侧只合计各自区间的 costUsd", () => {
    const now = new Date(2026, 9, 13, 9, 0, 0).getTime();
    // 本月第 5 天（10-05）与第 12 天（10-12）有消耗；上月第 2 天（09-02）计入、
    // 上月第 20 天（09-20）越出「上月第 1..13 天」不得计入。
    const calendar = calendarWith(now, { "-8": 2, "-1": 3, "-41": 4, "-23": 7 });
    const insights = calendarInsightsOf(calendar, now);
    expect(insights.monthCompare).toEqual({ days: 13, currentUsd: 5, previousUsd: 4 });
  });

  it("now = 2026-03-31：上月 2 月只有 28 天 → N = 28，2 月第 28 天计入", () => {
    const now = new Date(2026, 2, 31, 9, 0, 0).getTime();
    const calendar = calendarWith(now, { "-31": 6, "-3": 1 }); // 2-28 与 3-28
    const insights = calendarInsightsOf(calendar, now);
    expect(insights.monthCompare).toEqual({ days: 28, currentUsd: 1, previousUsd: 6 });
  });

  it("now = 2028-03-31（闰年）：2 月 29 天 → N = 29，2-29 计入", () => {
    const now = new Date(2028, 2, 31, 9, 0, 0).getTime();
    const calendar = calendarWith(now, { "-31": 8, "-2": 1 }); // 2028-2-29 与 3-29
    const insights = calendarInsightsOf(calendar, now);
    expect(insights.monthCompare).toEqual({ days: 29, currentUsd: 1, previousUsd: 8 });
  });

  it("now = 2026-10-01：N = 1（min(今天几号, 上月天数)）", () => {
    const now = new Date(2026, 9, 1, 9, 0, 0).getTime();
    const calendar = calendarWith(now, { "0": 3, "-30": 9 }); // 10-01 与 09-01
    const insights = calendarInsightsOf(calendar, now);
    expect(insights.monthCompare).toEqual({ days: 1, currentUsd: 3, previousUsd: 9 });
  });

  it("不变量：扫 12 个月锚点，两区间各 N 天、不越窗口、起点间隔恰为上月天数", () => {
    // 每月的 1 日 / 13 日 / 末日三个锚点（1 日钉 N=1，末日钉 N=上月天数截齐）。
    const anchors: number[] = [];
    for (let month = 0; month < 12; month += 1) {
      const monthEnd = new Date(2026, month + 1, 0).getDate();
      for (const day of [1, 13, monthEnd]) {
        anchors.push(new Date(2026, month, day, 9, 0, 0).getTime());
      }
    }
    for (const now of anchors) {
      const calendar = calendarWith(now, {});
      const insights = calendarInsightsOf(calendar, now);
      const compare = insights.monthCompare;
      const today = dayStartOf(now);
      const todayDate = new Date(today);
      const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).getTime();
      const lastMonthEnd = addLocalDays(monthStart, -1);
      const lastMonthDays = new Date(lastMonthEnd).getDate();
      const expectedN = Math.min(todayDate.getDate(), lastMonthDays);
      const windowFirst = addLocalDays(today, -364);

      expect(compare.days).toBe(expectedN);
      expect(compare.days).toBeGreaterThanOrEqual(1);
      // 上月首 = 上月末回退（上月几号 − 1）天；两区间首日间隔恰为上月天数。
      const prevStart = addLocalDays(lastMonthEnd, -(lastMonthDays - 1));
      expect(daysBetween(prevStart, monthStart)).toBe(lastMonthDays);
      // 两区间各 N 天（首日 + N−1 天 = 末日）且都不越出窗口。
      expect(addLocalDays(monthStart, expectedN - 1)).toBeLessThanOrEqual(today);
      expect(prevStart).toBeGreaterThanOrEqual(windowFirst);
      expect(addLocalDays(prevStart, expectedN - 1)).toBeLessThanOrEqual(today);
    }
  });
});

describe("calendarInsightsOf · 全空年哨兵与输入顺序无关", () => {
  it("全空年：longestStreak / peakDay 为 null，currentStreak 是 broken 的哨兵", () => {
    const insights = calendarInsightsOf(calendarWith(NOW, {}), NOW);
    expect(insights.longestStreak).toBeNull();
    expect(insights.peakDay).toBeNull();
    expect(insights.currentStreak).toEqual({ kind: "broken", lastActiveDay: null, idleDays: 0 });
    expect(insights.activeDays.days).toBe(0);
  });

  it("输入顺序无关：同 facts 不同 cells 内部顺序的 calendar 输出相等", () => {
    const base = calendarWith(NOW, { "-10": 1, "-9": 1, "-8": 1, "-1": 2 });
    const reordered: UsageCalendar = {
      ...base,
      // 列倒排 + 列内倒排：拍平排序后应与原 calendar 逐字段一致。
      cells: [...base.cells]
        .reverse()
        .map((column) => [...column].reverse())
    };
    expect(calendarInsightsOf(reordered, NOW)).toEqual(calendarInsightsOf(base, NOW));
  });
});

describe("calendarInsightsOf · 与 buildUsageCalendar 对账（真 inputs）", () => {
  let seq = 0;
  const record = (at: number, tokens: number): SessionRecord => {
    seq += 1;
    return {
      id: `r${seq}`,
      fullId: `r${seq}`,
      kind: "assistant",
      timestamp: at,
      durationMs: 0,
      text: "",
      isError: false,
      raw: {},
      usage: { inputTokens: tokens },
      model: "claude-sonnet-4-5"
    };
  };
  const metaOf = (path: string): SessionMeta => ({
    path,
    projectLabel: "-repo-insights",
    cwd: "/repo/insights",
    hasRecords: true,
    mtimeMs: 0,
    sizeBytes: 0
  });
  /** 一个会话一条 sonnet 记录（$3/MTok input）。 */
  const sessionAt = (path: string, dayStart: number, tokens: number): UsageSessionInput => ({
    records: [record(dayStart + 10 * 3_600_000, tokens)],
    projectLabel: "-repo-insights",
    projectPath: "/repo/insights",
    session: metaOf(path)
  });

  it("activeDays 与 cells 里 costUsd > 0 的计数一致；恒等式（§2.3）成立", () => {
    const inputs = [
      sessionAt("/sessions/a.jsonl", DAY_AT(-4), 100_000),
      sessionAt("/sessions/b.jsonl", DAY_AT(-3), 200_000),
      sessionAt("/sessions/c.jsonl", DAY_AT(-1), 300_000),
      sessionAt("/sessions/d.jsonl", TODAY, 400_000)
    ];
    const calendar = buildUsageCalendar(inputs, NOW);
    const insights = calendarInsightsOf(calendar, NOW);

    expect(insights.activeDays.days).toBe(activeCellCount(calendar));
    // 恒等式：activeDays.days ≥ 1 ⇔ peakDay ≠ null ⇔ longestStreak ≠ null。
    expect(insights.activeDays.days).toBeGreaterThanOrEqual(1);
    expect(insights.peakDay).not.toBeNull();
    expect(insights.longestStreak).not.toBeNull();
    // 真账顺手钉两句：连胜 2 天（昨天到今天）、最贵是今天（$1.20）。
    expect(insights.longestStreak).toEqual({
      days: 2,
      startDay: DAY_AT(-1),
      endDay: TODAY,
      touchesWindowStart: false
    });
    expect(insights.peakDay!.dayStart).toBe(TODAY);
    expect(insights.peakDay!.costUsd).toBeCloseTo(1.2, 10);
    expect(insights.currentStreak).toEqual({
      kind: "active",
      days: 2,
      startDay: DAY_AT(-1)
    });
  });

  it("恒等式的空侧：无消耗输入 → activeDays.days = 0 ⇔ peakDay 与 longestStreak 均为 null", () => {
    const calendar = buildUsageCalendar([], NOW);
    const insights = calendarInsightsOf(calendar, NOW);
    expect(insights.activeDays.days).toBe(0);
    expect(insights.peakDay).toBeNull();
    expect(insights.longestStreak).toBeNull();
  });
});
