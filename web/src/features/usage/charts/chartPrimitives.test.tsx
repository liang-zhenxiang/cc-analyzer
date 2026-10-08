import { describe, expect, it } from "vitest";
import { axisTicks, formatAxisValue, niceAxisMax } from "./chartPrimitives";

/** 1 / 2 / 5 × 10ⁿ —— 刻度步长唯一可接受的尾数。 */
const NICE_MANTISSAS = [1, 2, 5];
/** 标签只允许整数，或一位小数的 K / M（`1.5M`）；`66.7K` 这种就是等分三份的指纹。 */
const READABLE_LABEL = /^\d+(\.\d)?[KMB]?$/;

function mantissaOf(value: number): number {
  return value / 10 ** Math.floor(Math.log10(value));
}

describe("axisTicks", () => {
  it("把 200K 的轴刻成 0 / 50K / 100K / 150K / 200K", () => {
    // PRD 里点名的例子：等分三份会给出 66.7K / 133.3K。
    expect(axisTicks(niceAxisMax(200_000), 3)).toEqual([0, 50_000, 100_000, 150_000, 200_000]);
  });

  it("步长是 1 / 2 / 5 × 10ⁿ，且每个刻度都是它的整数倍", () => {
    const maxima = [1, 2, 3, 42, 3_000, 88_400, 200_000, 1_234_567, 2_500_000, 5_784_080_022];
    for (const raw of maxima) {
      const max = niceAxisMax(raw);
      const ticks = axisTicks(max, 3);
      const step = ticks[1];
      expect(step).toBeGreaterThan(0);
      expect(NICE_MANTISSAS).toContain(mantissaOf(step));
      expect(Number.isInteger(step)).toBe(true);
      for (const tick of ticks) {
        expect(Number.isInteger(tick)).toBe(true);
        expect(tick % step).toBe(0);
        expect(formatAxisValue(tick)).toMatch(READABLE_LABEL);
      }
      // 最后一格就是轴顶，网格线的几何（等距）由此不受影响。
      expect(ticks[ticks.length - 1]).toBe(max);
    }
  });

  it("退化输入不产生空轴或 NaN 刻度", () => {
    expect(axisTicks(0)).toEqual([0, 1]);
    expect(axisTicks(Number.NaN)).toEqual([0, 1]);
    expect(axisTicks(-5)).toEqual([0, 1]);
  });
});