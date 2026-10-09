import { describe, expect, it } from "vitest";
import type { CompactionAnchor } from "./contextSeries";
import {
  curveGeometry,
  diamondPath,
  downsampleCurve,
  eventMarkerGeometries,
  nearestPositionIndex,
  peakLabelPlacement,
  peakSampleIndex
} from "./contextCurve";
import type { CompactEvent, ContextSample } from "./types";

function sample(index: number, contextTokens: number): ContextSample {
  return {
    uuid: `s-${index}`,
    timestamp: index * 1_000,
    contextTokens,
    outputTokens: 10,
    model: "claude"
  };
}

function samplesOf(values: number[]): ContextSample[] {
  return values.map((value, index) => sample(index, value));
}

function anchorOf(eventId: string, beforeIndex: number, afterIndex: number): CompactionAnchor {
  return { eventId, beforeIndex, afterIndex };
}

function eventOf(id: string, preTokens: number | null = 60_000): CompactEvent {
  return {
    id,
    timestamp: 2_500,
    trigger: "auto",
    preTokens,
    postTokens: 5_000,
    droppedTokens: 55_000,
    durationMs: 1_000,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null
  };
}

describe("downsampleCurve", () => {
  it("returns every index when the series already fits the target", () => {
    const kept = downsampleCurve(samplesOf([10, 20, 30, 40]), [], 720);
    expect(kept).toEqual([0, 1, 2, 3]);
  });

  it("keeps each bucket's min and max, in order", () => {
    // bucket size = ceil(10 / 3) = 4 → buckets [0..3], [4..7], [8..9].
    const values = [100, 10, 50, 60, 70, 5, 80, 90, 30, 20];
    const kept = downsampleCurve(samplesOf(values), [], 3);

    // [0..3] keeps max 100(0) and min 10(1); [4..7] keeps min 5(5) and max
    // 90(7); [8..9] keeps max 30(8) and min 20(9).
    expect(kept).toEqual([0, 1, 5, 7, 8, 9]);
  });

  it("forces the cliff edges to survive bucketing that would drop them", () => {
    // Bucket [0..2] alone keeps only 100 (max) and 5 (min); index 1 is neither.
    const values = [100, 90, 5];
    const naive = downsampleCurve(samplesOf(values), [], 1);
    expect(naive).not.toContain(1);

    const forced = downsampleCurve(samplesOf(values), [1], 1);
    expect(forced).toContain(1);
  });

  it("always includes the global peak index among the kept points", () => {
    const values = Array.from({ length: 50 }, (_, index) => index * 3);
    const peak = peakSampleIndex(samplesOf(values));
    const kept = downsampleCurve(samplesOf(values), [peak], 4);
    expect(kept).toContain(peak);
  });

  it("returns a sorted, deduplicated index list bounded by two points per bucket", () => {
    const values = Array.from({ length: 2_000 }, (_, index) => index);
    const kept = downsampleCurve(samplesOf(values), [999], 720);

    expect(kept).toEqual([...new Set(kept)].sort((a, b) => a - b));
    // bucket size = ceil(2000/720) = 3 → ≤ ceil(2000/3)*2 + 1 kept indices.
    expect(kept.length).toBeLessThanOrEqual(667 * 2 + 1);
    expect(kept).toContain(999);
  });

  it("falls back to every index for a series shorter than the bucket count", () => {
    expect(downsampleCurve([], [0, 3], 720)).toEqual([]);
  });
});

describe("curveGeometry", () => {
  const geometry = curveGeometry({
    width: 720,
    height: 220,
    padLeft: 56,
    padRight: 12,
    padTop: 22,
    padBottom: 22,
    count: 101,
    maxValue: 200_000
  });

  it("maps ordinals edge to edge and values from the baseline up", () => {
    expect(geometry.xAt(0)).toBe(56);
    expect(geometry.xAt(100)).toBeCloseTo(708, 5);
    expect(geometry.yAt(0)).toBeCloseTo(198, 5);
    expect(geometry.yAt(200_000)).toBe(22);
  });

  it("places a lone sample at the plot centre", () => {
    const single = curveGeometry({
      width: 720,
      height: 220,
      padLeft: 56,
      padRight: 12,
      padTop: 22,
      padBottom: 22,
      count: 1,
      maxValue: 10
    });
    expect(single.xAt(0)).toBeCloseTo(56 + single.plotWidth / 2, 5);
  });
});

describe("eventMarkerGeometries", () => {
  it("puts the hairline midway between the cliff samples and the diamond at the pre value", () => {
    const samples = samplesOf([10_000, 20_000, 120_000, 8_000, 9_000]);
    const geometry = curveGeometry({
      width: 720,
      height: 220,
      padLeft: 56,
      padRight: 12,
      padTop: 22,
      padBottom: 22,
      count: samples.length,
      maxValue: 120_000
    });
    const markers = eventMarkerGeometries(
      [anchorOf("boundary-1", 2, 3)],
      [eventOf("boundary-1")],
      samples,
      geometry
    );

    expect(markers).toHaveLength(1);
    const marker = markers[0];
    expect(marker.x).toBeCloseTo((geometry.xAt(2) + geometry.xAt(3)) / 2, 5);
    expect(marker.y).toBeCloseTo(geometry.yAt(120_000), 5);
    // 24px 全高命中区：以竖线为中心、覆盖整个绘图高。
    expect(marker.hitWidth).toBe(24);
    expect(marker.hitX).toBeCloseTo(marker.x - 12, 5);
    expect(marker.hitY).toBe(22);
    expect(marker.hitHeight).toBeCloseTo(geometry.plotHeight, 5);
  });

  it("uses the metadata preTokens when no pre sample exists", () => {
    const samples = samplesOf([9_000, 8_000]);
    const geometry = curveGeometry({
      width: 720,
      height: 220,
      padLeft: 56,
      padRight: 12,
      padTop: 22,
      padBottom: 22,
      count: samples.length,
      maxValue: 60_000
    });
    const markers = eventMarkerGeometries(
      [anchorOf("early", -1, 0)],
      [eventOf("early", 60_000)],
      samples,
      geometry
    );

    expect(markers[0].y).toBeCloseTo(geometry.yAt(60_000), 5);
  });
});

describe("peakLabelPlacement", () => {
  const geometry = curveGeometry({
    width: 720,
    height: 220,
    padLeft: 56,
    padRight: 12,
    padTop: 22,
    padBottom: 22,
    count: 11,
    maxValue: 100
  });
  const markers = [
    { eventId: "e", x: geometry.xAt(5), y: 0, hitX: 0, hitWidth: 24, hitY: 0, hitHeight: 100 }
  ];

  it("sits 7px above the peak, centred, when no marker is near", () => {
    // 峰值取 70（不是 90）：7px 的避让在 90 的几何下会撞上 padTop + fontSize
    // 的 clamp 下限，量出来的就不是「离点一档」而是「clamp 后的地板」。
    const placement = peakLabelPlacement(2, 70, geometry, [], 11);
    // 字面量 7 而不是引用 PEAK_LABEL_OFFSET：有人把避让距离改回去（或改错档）时，
    // 这条断言要红——「标签与描边之间留一档呼吸」正是 J2 评审定的回归本体。
    expect(placement).toEqual({ x: geometry.xAt(2), y: geometry.yAt(70) - 7, anchor: "middle" });
  });

  it("dodges up and to the right when an event marker collides", () => {
    const placement = peakLabelPlacement(5, 70, geometry, markers, 11);
    expect(placement.anchor).toBe("start");
    expect(placement.x).toBeGreaterThan(geometry.xAt(5));
    expect(placement.y).toBeLessThan(geometry.yAt(70) - 7);
  });
});

describe("nearestPositionIndex", () => {
  it("snaps to the closest position, including exact hits", () => {
    const positions = [0, 100, 200, 300];
    expect(nearestPositionIndex(positions, 0)).toBe(0);
    expect(nearestPositionIndex(positions, 51)).toBe(1);
    expect(nearestPositionIndex(positions, 149)).toBe(1);
    expect(nearestPositionIndex(positions, 249)).toBe(2);
    expect(nearestPositionIndex(positions, 251)).toBe(3);
    expect(nearestPositionIndex(positions, 400)).toBe(3);
  });
});

describe("peakSampleIndex", () => {
  it("finds the first index carrying the maximum", () => {
    expect(peakSampleIndex(samplesOf([5, 9, 9, 3]))).toBe(1);
    expect(peakSampleIndex(samplesOf([1]))).toBe(0);
  });
});

describe("diamondPath", () => {
  it("draws a closed rhombus with the given circumradius", () => {
    expect(diamondPath(10, 20, 5)).toBe("M10,15L15,20L10,25L5,20Z");
  });
});
