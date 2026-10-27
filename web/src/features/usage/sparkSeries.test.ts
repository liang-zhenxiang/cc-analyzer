import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPARK_HEIGHT,
  DEFAULT_SPARK_STROKE,
  DEFAULT_SPARK_WIDTH,
  sparkSeries
} from "./sparkSeries";

describe("sparkSeries", () => {
  it("returns an empty, flat series for empty input", () => {
    expect(sparkSeries([])).toEqual({ points: [], min: 0, max: 0, flat: true });
  });

  it("centres a single point", () => {
    const series = sparkSeries([5]);
    expect(series.flat).toBe(true);
    expect(series.min).toBe(5);
    expect(series.max).toBe(5);
    expect(series.points).toEqual([{ x: DEFAULT_SPARK_WIDTH / 2, y: DEFAULT_SPARK_HEIGHT / 2 }]);
  });

  it("pins two points to the left and right edges with y flipped", () => {
    const series = sparkSeries([0, 10]);
    const pad = DEFAULT_SPARK_STROKE / 2;
    expect(series.min).toBe(0);
    expect(series.max).toBe(10);
    expect(series.flat).toBe(false);
    expect(series.points).toHaveLength(2);
    expect(series.points[0]!.x).toBeCloseTo(pad, 10);
    expect(series.points[1]!.x).toBeCloseTo(DEFAULT_SPARK_WIDTH - pad, 10);
    // 值大在上：0 在下、10 在上。
    expect(series.points[0]!.y).toBeCloseTo(DEFAULT_SPARK_HEIGHT - pad, 10);
    expect(series.points[1]!.y).toBeCloseTo(pad, 10);
  });

  it("maps a monotonic run to strictly decreasing y", () => {
    const series = sparkSeries([1, 2, 3, 4], { width: 56, height: 16 });
    const x = series.points.map((point) => point.x);
    const expectedX = [0.75, 0.75 + 54.5 / 3, 0.75 + (54.5 * 2) / 3, 55.25];
    expectedX.forEach((value, index) => expect(x[index]).toBeCloseTo(value, 10));
    for (let index = 1; index < series.points.length; index += 1) {
      expect(series.points[index]!.y).toBeLessThan(series.points[index - 1]!.y);
      expect(series.points[index]!.x).toBeGreaterThan(series.points[index - 1]!.x);
    }
  });

  it("draws a flat line through the middle when max === min", () => {
    const series = sparkSeries([5, 5, 5]);
    expect(series.flat).toBe(true);
    expect(series.points.map((point) => point.y)).toEqual([8, 8, 8]);
    expect(series.points.map((point) => point.x)).toEqual([0.75, 28, 55.25]);
  });

  it("honours width, height and strokeWidth options", () => {
    const series = sparkSeries([0, 1], { width: 100, height: 20, strokeWidth: 2 });
    expect(series.points).toEqual([
      { x: 1, y: 19 },
      { x: 99, y: 1 }
    ]);
  });

  it("centres a single point inside custom dimensions", () => {
    expect(sparkSeries([3], { width: 100, height: 20 }).points).toEqual([{ x: 50, y: 10 }]);
  });

  it("reports the data extremes, not the padded pixels", () => {
    const series = sparkSeries([3, -2, 7]);
    expect(series.min).toBe(-2);
    expect(series.max).toBe(7);
    // 最大值在上边缘（padY），最小值在下边缘（height − padY）。
    expect(series.points[1]!.y).toBeCloseTo(DEFAULT_SPARK_HEIGHT - 0.75, 10);
    expect(series.points[2]!.y).toBeCloseTo(0.75, 10);
  });
});
