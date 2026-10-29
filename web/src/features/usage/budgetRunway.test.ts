import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildBudgetRunway,
  compactTokenLabel,
  runwayActualPoints,
  runwayAxisMax,
  RUNWAY_MIN_ACTIVE_DAYS
} from "./budgetRunway";
import { addLocalDays, dayStartOf } from "./usageAggregations";
import { weekStartOf } from "./weeklyDigest";

/** 固定到周三中午：本周已有三天位置，预测与已用都好断言。 */
const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const MONDAY = weekStartOf(NOW);
const WEEK_END = addLocalDays(MONDAY, 7);

let seq = 0;

function usage(tokens: number): SessionUsage {
  return {
    inputTokens: tokens,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0
  };
}

function record(at: number, tokens: number): SessionRecord {
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
    model: "claude-sonnet-4-5-20250929",
    usage: usage(tokens)
  };
}

function inputOf(records: SessionRecord[]): UsageSessionInput[] {
  return [{ records, projectLabel: "-repo-demo" }];
}

const DAY_MS = 86_400_000;

describe("buildBudgetRunway", () => {
  it("空输入、未设预算：没有数据，也不画任何东西", () => {
    const runway = buildBudgetRunway([], NOW, null);
    expect(runway.hasData).toBe(false);
    expect(runway.used).toBe(0);
    expect(runway.budget).toBeNull();
    expect(runway.activeDays).toBe(0);
    expect(runway.prediction).toBeNull();
    expect(runway.days.map((day) => day.label)).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
    expect(runway.weekStart).toBe(MONDAY);
    expect(runway.weekEnd).toBe(WEEK_END);
  });

  it("自然周边界：周一的 00:00 计入，上一周最后一毫秒不计入", () => {
    const runway = buildBudgetRunway(
      inputOf([
        record(MONDAY - 1, 5000),
        record(MONDAY, 700),
        record(MONDAY + 1000, 300)
      ]),
      NOW,
      null
    );
    expect(runway.used).toBe(1000);
    expect(runway.days[0].tokens).toBe(1000);
    expect(runway.days.reduce((sum, day) => sum + day.tokens, 0)).toBe(1000);
  });

  it("跨天累计：周一 1000、周二 2000、周三 3000", () => {
    const runway = buildBudgetRunway(
      inputOf([
        record(addLocalDays(MONDAY, 0) + 9 * 3_600_000, 1000),
        record(addLocalDays(MONDAY, 1) + 9 * 3_600_000, 2000),
        record(addLocalDays(MONDAY, 2) + 9 * 3_600_000, 3000)
      ]),
      NOW,
      null
    );
    expect(runway.used).toBe(6000);
    expect(runway.activeDays).toBe(3);
    expect(runway.days.slice(0, 3).map((day) => day.cumulative)).toEqual([1000, 3000, 6000]);
  });

  it("活跃日 ≥ 2 时按活跃日日均外推到周日 24:00", () => {
    const runway = buildBudgetRunway(
      inputOf([
        record(addLocalDays(MONDAY, 0) + 9 * 3_600_000, 1000),
        record(addLocalDays(MONDAY, 1) + 9 * 3_600_000, 1000)
      ]),
      NOW,
      null
    );
    expect(runway.tokensPerDay).toBe(1000);
    const remainingDays = (WEEK_END - NOW) / DAY_MS;
    expect(runway.prediction).not.toBeNull();
    expect(runway.prediction!.remainingDays).toBeCloseTo(remainingDays, 9);
    expect(runway.prediction!.total).toBeCloseTo(2000 + 1000 * remainingDays, 6);
  });

  it("活跃日不足 2 天：不推算落地速度", () => {
    const runway = buildBudgetRunway(
      inputOf([record(addLocalDays(MONDAY, 0) + 9 * 3_600_000, 1000)]),
      NOW,
      null
    );
    expect(runway.activeDays).toBe(1);
    expect(runway.activeDays).toBeLessThan(RUNWAY_MIN_ACTIVE_DAYS);
    expect(runway.tokensPerDay).toBeNull();
    expect(runway.prediction).toBeNull();
  });

  it("设了预算且已超：overNow 与 projectedOver 同时成立", () => {
    const runway = buildBudgetRunway(
      inputOf([
        record(addLocalDays(MONDAY, 0) + 9 * 3_600_000, 5000),
        record(addLocalDays(MONDAY, 1) + 9 * 3_600_000, 5000)
      ]),
      NOW,
      4000
    );
    expect(runway.budget).toBe(4000);
    expect(runway.overNow).toBe(true);
    expect(runway.projectedOver).toBe(true);
    expect(runway.overBy).toBeGreaterThan(0);
  });

  it("设了预算但仍在预算内：overBy 为 0", () => {
    const runway = buildBudgetRunway(
      inputOf([
        record(addLocalDays(MONDAY, 0) + 9 * 3_600_000, 100),
        record(addLocalDays(MONDAY, 1) + 9 * 3_600_000, 100)
      ]),
      NOW,
      100_000
    );
    expect(runway.overNow).toBe(false);
    expect(runway.projectedOver).toBe(false);
    expect(runway.overBy).toBe(0);
  });

  it("0 消耗但设了预算：仍有数据（画预算线），但不推算速度", () => {
    const runway = buildBudgetRunway([], NOW, 120_000);
    expect(runway.hasData).toBe(true);
    expect(runway.used).toBe(0);
    expect(runway.budget).toBe(120_000);
    expect(runway.activeDays).toBe(0);
    expect(runway.prediction).toBeNull();
  });

  it("非法预算（0 / 负数 / NaN）按未设处理", () => {
    for (const value of [0, -1, Number.NaN]) {
      expect(buildBudgetRunway([], NOW, value).budget).toBeNull();
    }
  });
});

describe("runwayActualPoints", () => {
  it("周三中午：起点 + 周一、周二日终 + 周三 now", () => {
    const runway = buildBudgetRunway(
      inputOf([
        record(addLocalDays(MONDAY, 0) + 9 * 3_600_000, 1000),
        record(addLocalDays(MONDAY, 1) + 9 * 3_600_000, 2000),
        record(addLocalDays(MONDAY, 2) + 9 * 3_600_000, 3000)
      ]),
      NOW,
      null
    );
    const points = runwayActualPoints(runway, NOW);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual({ t: MONDAY, value: 0 });
    expect(points[1]).toEqual({ t: addLocalDays(MONDAY, 1), value: 1000 });
    expect(points[2]).toEqual({ t: addLocalDays(MONDAY, 2), value: 3000 });
    expect(points[3]).toEqual({ t: NOW, value: 6000 });
  });

  it("周一当天只有起点和 now 两个点", () => {
    const mondayNoon = MONDAY + 12 * 3_600_000;
    const runway = buildBudgetRunway(
      inputOf([record(MONDAY + 9 * 3_600_000, 500)]),
      mondayNoon,
      null
    );
    const points = runwayActualPoints(runway, mondayNoon);
    expect(points).toHaveLength(2);
    expect(points[1]).toEqual({ t: mondayNoon, value: 500 });
  });
});

describe("runwayAxisMax / compactTokenLabel", () => {
  it("上界覆盖预算、已用与预测终点，至少为 1", () => {
    const runway = buildBudgetRunway([], NOW, null);
    expect(runwayAxisMax(runway)).toBe(1);

    const withBudget = buildBudgetRunway([], NOW, 100_000);
    expect(runwayAxisMax(withBudget)).toBeCloseTo(105_000, 6);
  });

  it("紧凑写法：0 / 1k / 86k / 1.2M", () => {
    expect(compactTokenLabel(0)).toBe("0");
    expect(compactTokenLabel(999)).toBe("999");
    expect(compactTokenLabel(1000)).toBe("1k");
    expect(compactTokenLabel(86_000)).toBe("86k");
    expect(compactTokenLabel(1_200_000)).toBe("1.2M");
  });

  it("dayStartOf 只在本地日历里用，不参与周窗口边界", () => {
    expect(dayStartOf(NOW)).toBe(addLocalDays(MONDAY, 2));
  });
});
