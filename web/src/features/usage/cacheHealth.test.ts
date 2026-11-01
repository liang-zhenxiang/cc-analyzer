import { describe, expect, it } from "vitest";
import { cacheHealthOf, TREND_MIN_WEEKS, TREND_THRESHOLD, TREND_WINDOW_WEEKS } from "./cacheHealth";

let weekCursor = 0;
/** 一周的起点按周递增，保证排序稳定。 */
function week(cacheReadTokens: number, inputTokens: number, weekStart = ++weekCursor * 604_800_000) {
  return { weekStart, cacheReadTokens, inputTokens };
}

/** 命中率 r 的一周（r 为 null 时该周两个计数器都是 0）。 */
function weekOfRate(rate: number | null): { weekStart: number; cacheReadTokens: number; inputTokens: number } {
  if (rate === null) return week(0, 0);
  return week(rate * 1000, (1 - rate) * 1000);
}

describe("cacheHealthOf 命中率", () => {
  it("returns an empty health when there are no weeks", () => {
    expect(cacheHealthOf([])).toEqual({ weeks: [], trend: null, latest: null });
  });

  it("computes cacheRead / (cacheRead + input)", () => {
    const health = cacheHealthOf([week(50, 50)]);
    expect(health.weeks).toEqual([{ weekStart: 604_800_000, hitRate: 0.5 }]);
    expect(health.latest).toBe(0.5);
  });

  it("keeps a real 0% when input is positive", () => {
    expect(cacheHealthOf([week(0, 100)]).latest).toBe(0);
  });

  it("reports 100% when everything is read from cache", () => {
    expect(cacheHealthOf([week(100, 0)]).latest).toBe(1);
  });

  it("reports null when both counters are zero", () => {
    const health = cacheHealthOf([week(0, 0)]);
    expect(health.weeks[0].hitRate).toBeNull();
    expect(health.latest).toBeNull();
  });

  it("reports null for negative or non-finite counters", () => {
    expect(cacheHealthOf([week(-1, 100)]).latest).toBeNull();
    expect(cacheHealthOf([week(Number.NaN, 100)]).latest).toBeNull();
  });

  it("sorts weeks by weekStart and keeps the newest as latest", () => {
    const health = cacheHealthOf([
      { weekStart: 1_209_600_000, cacheReadTokens: 0, inputTokens: 1000 },
      { weekStart: 604_800_000, cacheReadTokens: 1000, inputTokens: 0 }
    ]);
    expect(health.weeks.map((entry) => entry.weekStart)).toEqual([604_800_000, 1_209_600_000]);
    expect(health.latest).toBe(0);
  });
});

describe("cacheHealthOf 趋势", () => {
  it("needs three non-null weeks in the last four", () => {
    expect(TREND_MIN_WEEKS).toBe(3);
    expect(TREND_WINDOW_WEEKS).toBe(4);
    expect(cacheHealthOf([weekOfRate(0.5), weekOfRate(0.9)]).trend).toBeNull();
  });

  it("compares the first and last non-null week inside the window", () => {
    const improving = cacheHealthOf([weekOfRate(0.9), weekOfRate(0.5), weekOfRate(0.5), weekOfRate(0.5), weekOfRate(0.55)]);
    expect(improving.trend).toBe("improving");

    const declining = cacheHealthOf([weekOfRate(0.9), weekOfRate(0.4), weekOfRate(0.7), weekOfRate(0.55)]);
    expect(declining.trend).toBe("declining");
  });

  it("requires a full 5pp move", () => {
    expect(TREND_THRESHOLD).toBe(0.05);
    expect(cacheHealthOf([weekOfRate(0.5), weekOfRate(0.5), weekOfRate(0.55)]).trend).toBe("improving");
    expect(cacheHealthOf([weekOfRate(0.5), weekOfRate(0.5), weekOfRate(0.549)]).trend).toBe("flat");
    expect(cacheHealthOf([weekOfRate(0.55), weekOfRate(0.5), weekOfRate(0.5)]).trend).toBe("declining");
    expect(cacheHealthOf([weekOfRate(0.549), weekOfRate(0.5), weekOfRate(0.5)]).trend).toBe("flat");
    expect(cacheHealthOf([weekOfRate(0.55), weekOfRate(0.5), weekOfRate(0.49)]).trend).toBe("declining");
  });

  it("ignores null weeks inside the window", () => {
    const health = cacheHealthOf([
      weekOfRate(0.5),
      weekOfRate(null),
      weekOfRate(0.6),
      weekOfRate(null),
      weekOfRate(0.7)
    ]);
    expect(health.weeks.map((entry) => entry.hitRate)).toEqual([0.5, null, 0.6, null, 0.7]);
    // 窗口 = 最近 4 周，非 null 只剩 0.6 与 0.7 → 不足 3 个。
    expect(health.trend).toBeNull();
  });

  it("looks only at the last four weeks", () => {
    const health = cacheHealthOf([
      weekOfRate(0.9),
      weekOfRate(0.5),
      weekOfRate(0.5),
      weekOfRate(0.5),
      weekOfRate(0.55)
    ]);
    // 只看最后 4 周 [0.5,0.5,0.5,0.55] → improving；若把首周 0.9 也算进来会误判 declining。
    expect(health.trend).toBe("improving");
  });

  it("still computes a window trend when the newest week is empty", () => {
    const health = cacheHealthOf([weekOfRate(0.5), weekOfRate(0.6), weekOfRate(0.7), weekOfRate(null)]);
    expect(health.weeks[3].hitRate).toBeNull();
    expect(health.trend).toBe("improving");
    expect(health.latest).toBeNull();
  });
});
