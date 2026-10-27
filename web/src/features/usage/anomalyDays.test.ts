import { describe, expect, it } from "vitest";
import { buildAnomalyDays, MIN_NEIGHBOURS, Z_THRESHOLD } from "./anomalyDays";

const DAY_MS = 86_400_000;
const START = Date.UTC(2026, 9, 1); // 2026-10-01

function dayLabel(index: number): string {
  return new Date(START + index * DAY_MS).toISOString().slice(0, 10);
}

function series(values: readonly number[]): Array<{ date: string; tokens: number }> {
  return values.map((tokens, index) => ({ date: dayLabel(index), tokens }));
}

/**
 * 前三天 400/500/600 是全同 2σ 的标尺：均值 500、样本 sd 100，
 * 于是 z 就是 (tokens − 500) / 100，边界 1.99/2.0 可以用整数 token 钉住。
 */
function withProbe(tokens: number): ReturnType<typeof buildAnomalyDays> {
  return buildAnomalyDays(series([400, 500, 600, tokens]));
}

describe("buildAnomalyDays", () => {
  it("returns nothing for empty input", () => {
    expect(buildAnomalyDays([])).toEqual([]);
  });

  it("returns z null for the first day (no left neighbours)", () => {
    const result = buildAnomalyDays(series([400]));
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ date: "2026-10-01", tokens: 400, z: null, kind: "-" });
  });

  it("needs two neighbours before it computes a z", () => {
    const result = buildAnomalyDays(series([400, 500]));
    expect(result[0]?.z).toBeNull();
    expect(result[1]?.z).toBeNull();
    expect(MIN_NEIGHBOURS).toBe(2);
  });

  it("flags a clear spike and a clear dip", () => {
    expect(withProbe(800)[3]).toMatchObject({ z: 3, kind: "spike" });
    expect(withProbe(200)[3]).toMatchObject({ z: -3, kind: "dip" });
  });

  it("keeps the 2σ boundary: 1.99 is normal, 2.0 is spike", () => {
    const normal = withProbe(699)[3];
    expect(normal?.z).toBeCloseTo(1.99, 10);
    expect(normal?.kind).toBe("-");

    const spike = withProbe(700)[3];
    expect(spike?.z).toBeCloseTo(2, 10);
    expect(spike?.kind).toBe("spike");
  });

  it("keeps the −2σ boundary: −1.99 is normal, −2.0 is dip", () => {
    const normal = withProbe(301)[3];
    expect(normal?.z).toBeCloseTo(-1.99, 10);
    expect(normal?.kind).toBe("-");

    const dip = withProbe(300)[3];
    expect(dip?.z).toBeCloseTo(-2, 10);
    expect(dip?.kind).toBe("dip");
  });

  it("keeps z null when every day is identical (sd = 0)", () => {
    const result = buildAnomalyDays(series(Array.from({ length: 8 }, () => 100)));
    expect(result).toHaveLength(8);
    expect(result.every((day) => day.z === null && day.kind === "-")).toBe(true);
  });

  it("uses a trailing window, not the whole history", () => {
    // 第 4 天的窗口只有前 3 天（400/500/600，均值 500、sd 100），不是“全量”。
    const result = buildAnomalyDays(series([400, 500, 600, 1000]));
    expect(result[2]?.z).toBeCloseTo((600 - 450) / Math.sqrt(5000), 10);
    expect(result[3]?.z).toBeCloseTo((1000 - 500) / 100, 10);
    expect(result[3]?.kind).toBe("spike");
  });

  it("returns every day in ascending date order", () => {
    const result = buildAnomalyDays([
      { date: "2026-10-03", tokens: 300 },
      { date: "2026-10-01", tokens: 100 },
      { date: "2026-10-02", tokens: 200 }
    ]);
    expect(result.map((day) => day.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(Z_THRESHOLD).toBe(2);
  });

  it("falls back to index windows when a date cannot be parsed", () => {
    const result = buildAnomalyDays([
      { date: "d1", tokens: 400 },
      { date: "d2", tokens: 500 },
      { date: "d3", tokens: 600 },
      { date: "d4", tokens: 1000 }
    ]);
    // 第 4 天的窗口 = 前 3 个点（400/500/600，均值 500、sd 100）→ z = 5。
    expect(result[3]?.z).toBeCloseTo(5, 10);
    expect(result[3]?.kind).toBe("spike");
  });
});
