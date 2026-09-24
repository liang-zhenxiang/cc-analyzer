import { describe, expect, it } from "vitest";
import { buildRowOffsets, computeSizedWindow, computeVirtualWindow } from "./virtualWindow";

describe("computeVirtualWindow", () => {
  it("renders everything when the list fits the viewport", () => {
    const result = computeVirtualWindow({
      count: 20,
      rowHeight: 32,
      scrollTop: 0,
      viewportHeight: 800
    });

    expect(result.start).toBe(0);
    expect(result.end).toBe(20);
    expect(result.padTop).toBe(0);
    expect(result.padBottom).toBe(0);
  });

  it("windows a large list around the scroll position", () => {
    const result = computeVirtualWindow({
      count: 10_000,
      rowHeight: 32,
      scrollTop: 32_000,
      viewportHeight: 640,
      overscan: 8
    });

    expect(result.start).toBe(1000 - 8);
    expect(result.end).toBe(1000 - 8 + 21 + 16);
    expect(result.padTop).toBe(result.start * 32);
    expect(result.padBottom).toBe((10_000 - result.end) * 32);
  });

  it("clamps at the end of the list", () => {
    const result = computeVirtualWindow({
      count: 100,
      rowHeight: 40,
      scrollTop: 99_999,
      viewportHeight: 400
    });

    expect(result.end).toBe(100);
    expect(result.padBottom).toBe(0);
  });

  it("handles empty lists and bad geometry", () => {
    expect(computeVirtualWindow({ count: 0, rowHeight: 32, scrollTop: 0, viewportHeight: 400 })).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0
    });
    expect(computeVirtualWindow({ count: 10, rowHeight: 0, scrollTop: 0, viewportHeight: 400 }).end).toBe(0);
  });
});

describe("computeSizedWindow", () => {
  const sizes = [34, 56, 56, 56, 34, 56];

  it("builds prefix offsets", () => {
    expect(buildRowOffsets([34, 56])).toEqual([0, 34, 90]);
    expect(buildRowOffsets([])).toEqual([0]);
    expect(buildRowOffsets([-10, 5])).toEqual([0, 0, 5]);
  });

  it("renders every row when the list fits the viewport", () => {
    const offsets = buildRowOffsets(sizes);
    const window = computeSizedWindow({ offsets, scrollTop: 0, viewportHeight: 800 });

    expect(window.start).toBe(0);
    expect(window.end).toBe(sizes.length);
    expect(window.padTop).toBe(0);
    expect(window.padBottom).toBe(0);
  });

  it("keeps the spacers proportional to the full list", () => {
    const tall = Array.from({ length: 400 }, (_, index) => (index % 5 === 0 ? 34 : 56));
    const offsets = buildRowOffsets(tall);
    const total = offsets[offsets.length - 1];
    const window = computeSizedWindow({
      offsets,
      scrollTop: Math.floor(total / 2),
      viewportHeight: 600,
      overscan: 6
    });

    expect(window.start).toBeGreaterThan(0);
    expect(window.end).toBeLessThan(tall.length);
    expect(window.padTop).toBe(offsets[window.start]);
    expect(window.padBottom).toBe(total - offsets[window.end]);
    expect(window.padTop + window.padBottom).toBeLessThan(total);
  });

  it("clamps at the end of the list", () => {
    const offsets = buildRowOffsets(sizes);
    const window = computeSizedWindow({ offsets, scrollTop: 99_999, viewportHeight: 400 });

    expect(window.end).toBe(sizes.length);
    expect(window.padBottom).toBe(0);
    expect(window.padTop).toBeLessThan(offsets[offsets.length - 1]);
  });

  it("handles an empty list", () => {
    expect(computeSizedWindow({ offsets: [], scrollTop: 0, viewportHeight: 400 })).toEqual({
      start: 0,
      end: 0,
      padTop: 0,
      padBottom: 0
    });
  });
});
