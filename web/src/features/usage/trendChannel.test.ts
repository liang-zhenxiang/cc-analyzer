import { describe, expect, it } from "vitest";
import {
  buildTrendChannel,
  FLAT_THRESHOLD_RATIO,
  MA_WINDOW,
  type TrendDay
} from "./trendChannel";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 9, 1); // 2026-10-01

function days(values: readonly number[], startDay = 1): TrendDay[] {
  return values.map((tokens, index) => ({
    date: new Date(START + (startDay - 1 + index) * DAY_MS).toISOString().slice(0, 10),
    tokens
  }));
}

describe("buildTrendChannel", () => {
  it("returns an empty channel for empty input", () => {
    expect(buildTrendChannel([])).toEqual({
      ma7: [],
      slopePerDay: null,
      forecast7: [],
      direction: "样本不足"
    });
  });

  it("keeps ma7 null until a full 7-day window exists", () => {
    const channel = buildTrendChannel(days([1, 2, 3, 4, 5, 6]));
    expect(channel.ma7).toEqual([null, null, null, null, null, null]);
    expect(channel.slopePerDay).toBeNull();
    expect(channel.direction).toBe("样本不足");
    // 日期照常给出：不知道值 ≠ 不知道哪天。
    expect(channel.forecast7.map((point) => point.date)).toEqual([
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13"
    ]);
    expect(channel.forecast7.every((point) => point.value === null)).toBe(true);
  });

  it("gives the last ma7 on the 7th day but no slope yet", () => {
    const channel = buildTrendChannel(days([100, 100, 100, 100, 100, 100, 100]));
    expect(channel.ma7).toEqual([null, null, null, null, null, null, 100]);
    expect(channel.slopePerDay).toBeNull();
    expect(channel.direction).toBe("样本不足");
    expect(channel.forecast7.every((point) => point.value === null)).toBe(true);
  });

  it("reports 上升 on a linear +10/day run with exact extrapolation", () => {
    const channel = buildTrendChannel(days(Array.from({ length: 13 }, (_, index) => 100 + index * 10)));
    expect(channel.ma7).toEqual([null, null, null, null, null, null, 130, 140, 150, 160, 170, 180, 190]);
    expect(channel.slopePerDay).toBeCloseTo(10, 10);
    expect(channel.direction).toBe("上升");
    expect(channel.forecast7.map((point) => point.value)).toEqual([200, 210, 220, 230, 240, 250, 260]);
    expect(channel.forecast7[0]?.date).toBe("2026-10-14");
    expect(channel.forecast7[6]?.date).toBe("2026-10-20");
  });

  it("reports 下降 and clamps negative extrapolation to 0", () => {
    const channel = buildTrendChannel(days(Array.from({ length: 13 }, (_, index) => 100 - index * 8)));
    expect(channel.slopePerDay).toBeCloseTo(-8, 10);
    expect(channel.direction).toBe("下降");
    // 锚点 28，每天 −8：20, 12, 4, 然后 clamp 到 0。
    expect(channel.forecast7.map((point) => point.value)).toEqual([20, 12, 4, 0, 0, 0, 0]);
  });

  it("calls a slope below 2% of the daily mean 平稳", () => {
    const channel = buildTrendChannel(days(Array.from({ length: 13 }, (_, index) => 182 + index * 3)));
    expect(channel.slopePerDay).toBeCloseTo(3, 10);
    expect(channel.direction).toBe("平稳");
    expect(FLAT_THRESHOLD_RATIO).toBe(0.02);
  });

  it("does not call exactly 2% flat", () => {
    const channel = buildTrendChannel(days(Array.from({ length: 13 }, (_, index) => 200 + (index - 6) * 4)));
    expect(channel.slopePerDay).toBeCloseTo(4, 10);
    expect(channel.direction).toBe("上升");
  });

  it("keeps non-finite tokens out of the moving average instead of counting them as 0", () => {
    const values = Array.from({ length: 13 }, () => 100);
    values[5] = Number.NaN;
    const channel = buildTrendChannel(days(values));
    expect(channel.ma7.slice(6, 12)).toEqual([null, null, null, null, null, null]);
    expect(channel.ma7[12]).toBe(100);
    expect(channel.slopePerDay).toBeNull();
  });

  it("falls back to a readable date suffix when the last label cannot be parsed", () => {
    const input = days(Array.from({ length: 13 }, (_, index) => 100 + index * 10));
    input[12] = { date: "not-a-date", tokens: 220 };
    const channel = buildTrendChannel(input);
    expect(channel.forecast7[0]?.date).toBe("not-a-date+1");
    expect(channel.forecast7[6]?.date).toBe("not-a-date+7");
  });

  it("keeps the moving-average window constant", () => {
    expect(MA_WINDOW).toBe(7);
  });
});
