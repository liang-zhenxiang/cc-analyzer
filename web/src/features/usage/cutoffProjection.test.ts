import { describe, expect, it } from "vitest";
import { projectCutoff } from "./cutoffProjection";

/** 0–23 点每小时各 100 token，共 2400。 */
function everyHour(tokens = 100) {
  return Array.from({ length: 24 }, (_, hour) => ({ hour, tokens }));
}

describe("projectCutoff", () => {
  it("returns null for an empty hour distribution", () => {
    expect(projectCutoff([], 17)).toBeNull();
  });

  it("keeps 0–16 and cuts 17–23 for a 17:00 cutoff", () => {
    expect(projectCutoff(everyHour(), 17)).toEqual({
      keptTokens: 1700,
      cutTokens: 700,
      // 700 / 2400 = 0.29166… → 0.1% 精度 = 0.292
      cutShare: 0.292
    });
  });

  it("keeps the morning for a 09:00 cutoff", () => {
    expect(projectCutoff(everyHour(), 9)).toEqual({
      keptTokens: 900,
      cutTokens: 1500,
      cutShare: 0.625
    });
  });

  it("treats 24 and 0 as no truncation", () => {
    for (const cutoff of [0, 24]) {
      expect(projectCutoff(everyHour(), cutoff)).toEqual({
        keptTokens: 2400,
        cutTokens: 0,
        cutShare: 0
      });
    }
  });

  it("treats an unusable cutoff as no truncation", () => {
    expect(projectCutoff(everyHour(), Number.NaN)?.keptTokens).toBe(2400);
    expect(projectCutoff(everyHour(), 17.5)?.keptTokens).toBe(2400);
  });

  it("counts only rows at or after the cutoff as cut", () => {
    const rows = [
      { hour: 0, tokens: 100 },
      { hour: 5, tokens: 100 },
      { hour: 6, tokens: 200 }
    ];
    expect(projectCutoff(rows, 5)).toEqual({
      keptTokens: 100,
      cutTokens: 300,
      cutShare: 0.75
    });
  });

  it("ignores rows with an invalid hour or a negative/NaN token count", () => {
    const rows = [
      { hour: 0, tokens: 100 },
      { hour: 99, tokens: 1000 },
      { hour: -1, tokens: 1000 },
      { hour: 3, tokens: Number.NaN },
      { hour: 4, tokens: -50 },
      { hour: 20, tokens: 100 }
    ];
    expect(projectCutoff(rows, 17)).toEqual({ keptTokens: 100, cutTokens: 100, cutShare: 0.5 });
  });

  it("reports a zero share when every counted row is zero", () => {
    expect(projectCutoff([{ hour: 0, tokens: 0 }, { hour: 20, tokens: 0 }], 17)).toEqual({
      keptTokens: 0,
      cutTokens: 0,
      cutShare: 0
    });
  });

  it("ignores row order", () => {
    const rows = everyHour().reverse();
    expect(projectCutoff(rows, 13)).toEqual(projectCutoff(everyHour(), 13));
  });

  it("rounds the share to one decimal of a percent", () => {
    // 1 小时保留、2 小时切掉 → 2/3 = 0.6666… → 0.667
    const rows = [
      { hour: 8, tokens: 100 },
      { hour: 18, tokens: 100 },
      { hour: 19, tokens: 100 }
    ];
    expect(projectCutoff(rows, 17)?.cutShare).toBe(0.667);
  });
});
