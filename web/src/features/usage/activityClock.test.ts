import { describe, expect, it } from "vitest";
import { buildActivityClock } from "./activityClock";

/**
 * 纯逻辑夹具：周 × 小时 的 7×24 网格压成 24 小时合计，比的是小时级总量，
 * 不是「哪一天」——时钟只画一天里的节奏。
 */

function grid(...rows: Array<Record<number, number>>): number[][] {
  return rows.map((row) => Array.from({ length: 24 }, (_, hour) => row[hour] ?? 0));
}

describe("buildActivityClock", () => {
  it("always returns 24 hours and an honest empty signature for empty input", () => {
    const clock = buildActivityClock([]);
    expect(clock.hours).toHaveLength(24);
    expect(clock.hours.map((hour) => hour.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
    expect(clock.total).toBe(0);
    expect(clock.max).toBe(0);
    expect(clock.peakHour).toBeNull();
    expect(clock.hours.every((hour) => !hour.peak && hour.total === 0)).toBe(true);
  });

  it("sums the same hour across all seven weekdays", () => {
    const clock = buildActivityClock(
      grid({ 9: 3 }, { 9: 4 }, { 9: 1 }, {}, {}, {}, { 18: 2 })
    );
    expect(clock.hours[9].total).toBe(8);
    expect(clock.hours[18].total).toBe(2);
    expect(clock.total).toBe(10);
    expect(clock.max).toBe(8);
    expect(clock.peakHour).toBe(9);
    expect(clock.hours[9].peak).toBe(true);
    expect(clock.hours[18].peak).toBe(false);
  });

  it("marks the busiest hour and keeps the earliest one on a tie", () => {
    const clock = buildActivityClock(grid({ 5: 10 }, { 7: 10 }, { 5: 2 }));
    expect(clock.max).toBe(12);
    expect(clock.peakHour).toBe(5);
    expect(clock.hours.filter((hour) => hour.peak).map((hour) => hour.hour)).toEqual([5]);
  });

  it("survives ragged rows without inventing hours", () => {
    const clock = buildActivityClock([[0, 2, 3]]);
    expect(clock.hours).toHaveLength(24);
    expect(clock.hours[1].total).toBe(2);
    expect(clock.hours[2].total).toBe(3);
    expect(clock.hours[23].total).toBe(0);
    expect(clock.total).toBe(5);
  });

  it("ignores negative and non-finite cells instead of counting them", () => {
    const malformed = [[Number.NaN, -5, 2, Number.POSITIVE_INFINITY, 1]];
    const clock = buildActivityClock(malformed as number[][]);
    expect(clock.total).toBe(3);
    expect(clock.hours[2].total).toBe(2);
    expect(clock.hours[4].total).toBe(1);
    expect(clock.max).toBe(2);
    expect(clock.peakHour).toBe(2);
  });

  it("repeats the max on every hour so a renderer never has to pass it separately", () => {
    const clock = buildActivityClock(grid({ 12: 4 }, { 12: 6 }));
    expect(clock.hours.every((hour) => hour.max === 10)).toBe(true);
  });
});
