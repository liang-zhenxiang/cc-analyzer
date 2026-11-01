import { describe, expect, it } from "vitest";
import { weekdayWeekendOf } from "./weekdayWeekend";

/** 本地日历日的正午，避免时区把午夜推到前一天。 */
function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month, day, hour).getTime();
}

// 2026-11-01 是周日（0），11-02 周一（1），11-07 周六（6）。
const SUNDAY = at(2026, 10, 1);
const MONDAY = at(2026, 10, 2);
const TUESDAY = at(2026, 10, 3);
const SATURDAY = at(2026, 10, 7);
const FRIDAY = at(2026, 9, 30);

describe("weekdayWeekendOf", () => {
  it("classifies by local calendar day: Sat/Sun are weekend", () => {
    const result = weekdayWeekendOf([
      { startTimestamp: SUNDAY, tokens: 1 },
      { startTimestamp: SATURDAY, tokens: 1 },
      { startTimestamp: MONDAY, tokens: 1 },
      { startTimestamp: FRIDAY, tokens: 1 }
    ]);
    expect(result).not.toBeNull();
    expect(result!.weekend.sessions).toBe(2);
    expect(result!.weekday.sessions).toBe(2);
  });

  it("aggregates sessions, tokens and active hours per side", () => {
    const result = weekdayWeekendOf([
      { startTimestamp: MONDAY, tokens: 100, activeHours: new Set([9, 10, 11]) },
      { startTimestamp: TUESDAY, tokens: 200, activeHours: new Set([14, 15]) },
      { startTimestamp: SATURDAY, tokens: 400, activeHours: new Set([10, 11, 12, 13]) },
      { startTimestamp: SUNDAY, tokens: 50, activeHours: new Set() }
    ]);
    expect(result!.weekday).toEqual({
      sessions: 2,
      tokens: 300,
      activeHours: 5,
      // 日历基准：5 个工作日。
      avgHoursPerDay: 1
    });
    expect(result!.weekend).toEqual({
      sessions: 2,
      tokens: 450,
      activeHours: 4,
      // 日历基准：2 个周末日。
      avgHoursPerDay: 2
    });
  });

  it("divides by the calendar days even when one side has no sessions", () => {
    const result = weekdayWeekendOf([
      { startTimestamp: SATURDAY, tokens: 10, activeHours: new Set([9, 10, 11, 12, 13, 14]) }
    ]);
    expect(result!.weekday).toEqual({ sessions: 0, tokens: 0, activeHours: 0, avgHoursPerDay: 0 });
    expect(result!.weekend.avgHoursPerDay).toBe(3);
  });

  it("counts distinct hours from a Set, ignoring duplicates", () => {
    const result = weekdayWeekendOf([
      { startTimestamp: MONDAY, tokens: 0, activeHours: new Set([9, 9, 10]) }
    ]);
    expect(result!.weekday.activeHours).toBe(2);
  });

  it("keeps missing activeHours at 0 while still dividing by the calendar days", () => {
    const result = weekdayWeekendOf([{ startTimestamp: MONDAY, tokens: 5 }]);
    expect(result!.weekday.sessions).toBe(1);
    expect(result!.weekday.activeHours).toBe(0);
    expect(result!.weekday.avgHoursPerDay).toBe(0);
  });

  it("skips invalid timestamps and returns null when nothing is classifiable", () => {
    const result = weekdayWeekendOf([
      { startTimestamp: Number.NaN, tokens: 1 },
      { startTimestamp: MONDAY, tokens: 2 }
    ]);
    expect(result!.weekday.sessions).toBe(1);
    expect(weekdayWeekendOf([{ startTimestamp: Number.NaN, tokens: 1 }])).toBeNull();
    expect(weekdayWeekendOf([])).toBeNull();
  });

  it("does not count non-finite tokens", () => {
    const result = weekdayWeekendOf([{ startTimestamp: MONDAY, tokens: Number.NaN }]);
    expect(result!.weekday.tokens).toBe(0);
  });
});
