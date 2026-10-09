import type { CompactionAnchor } from "./contextSeries";
import type { CompactEvent, ContextSample } from "./types";

/**
 * Pure geometry for the context-pressure chart (design spec §2.2). Everything
 * here is deterministic on its inputs so the downsampling rules — the ones the
 * mutation checks guard — are testable without a render tree.
 */

/** Downsampling target: roughly one kept point per viewBox pixel column. */
export const CURVE_TARGET_POINTS = 720;

/**
 * Indices of the samples the chart keeps.
 *
 * Long sessions carry 5k+ samples, so the series is bucketed at
 * `ceil(N / target)` samples per bucket and each bucket keeps only its
 * minimum and maximum (in original order). Three kinds of points are forced
 * to survive regardless of bucketing:
 *
 * - every compaction cliff edge (the pre-side last sample and the post-side
 *   first sample) — plain min/max bucketing can round a cliff off, and the
 *   cliff is the story this chart exists to tell;
 * - the global peak, which carries the only direct label.
 */
export function downsampleCurve(
  samples: readonly ContextSample[],
  forced: readonly number[] = [],
  target: number = CURVE_TARGET_POINTS
): number[] {
  const count = samples.length;
  if (count === 0) return [];
  if (count <= target) return Array.from({ length: count }, (_, index) => index);

  const kept = new Set<number>();
  for (const index of forced) {
    if (Number.isInteger(index) && index >= 0 && index < count) kept.add(index);
  }

  const bucketSize = Math.ceil(count / target);
  for (let start = 0; start < count; start += bucketSize) {
    const end = Math.min(start + bucketSize, count);
    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (samples[index].contextTokens < samples[minIndex].contextTokens) minIndex = index;
      if (samples[index].contextTokens > samples[maxIndex].contextTokens) maxIndex = index;
    }
    kept.add(minIndex);
    kept.add(maxIndex);
  }

  return [...kept].sort((a, b) => a - b);
}

/** Index of the highest `contextTokens` sample (first one on ties). */
export function peakSampleIndex(samples: readonly ContextSample[]): number {
  let best = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].contextTokens > samples[best].contextTokens) best = index;
  }
  return best;
}

export type CurveGeometryOptions = {
  width: number;
  height: number;
  padLeft: number;
  padRight: number;
  padTop: number;
  padBottom: number;
  /** Sample count; the x domain is the ordinals 1..count. */
  count: number;
  /** Y domain ceiling (0 is the area baseline). */
  maxValue: number;
};

export type CurveGeometry = {
  padLeft: number;
  padTop: number;
  plotWidth: number;
  plotHeight: number;
  /** Pixel distance between adjacent sample ordinals. */
  step: number;
  xAt(index: number): number;
  yAt(value: number): number;
};

/** viewBox coordinate mapping: sample ordinal → x, token value → y. */
export function curveGeometry(options: CurveGeometryOptions): CurveGeometry {
  const plotWidth = options.width - options.padLeft - options.padRight;
  const plotHeight = options.height - options.padTop - options.padBottom;
  const { count, maxValue } = options;
  // A single sample still needs a position: centre of the plot.
  const step = count > 1 ? plotWidth / (count - 1) : plotWidth / 2;
  const xAt = (index: number) =>
    count > 1
      ? options.padLeft + Math.min(Math.max(index, 0), count - 1) * step
      : options.padLeft + step;
  const safeMax = maxValue > 0 ? maxValue : 1;
  const yAt = (value: number) => options.padTop + (1 - value / safeMax) * plotHeight;
  return { padLeft: options.padLeft, padTop: options.padTop, plotWidth, plotHeight, step, xAt, yAt };
}

/** Hit band width around each compaction marker (design §2.2: never aim at a 10px dot). */
export const EVENT_HIT_WIDTH = 24;

export type EventMarkerGeometry = {
  eventId: string;
  /** Vertical hairline x: midway between the pre-edge and post-edge samples. */
  x: number;
  /** Diamond centre y: the pre-side context size (or the metadata's preTokens). */
  y: number;
  hitX: number;
  hitWidth: number;
  hitY: number;
  hitHeight: number;
};

/**
 * The three-piece marker per compaction: hairline x, diamond y and the hit
 * rectangle the pointer and keyboard share. The hairline sits between the
 * cliff's two samples; the diamond rides it at the pre-side value.
 */
export function eventMarkerGeometries(
  anchors: readonly CompactionAnchor[],
  events: readonly CompactEvent[],
  samples: readonly ContextSample[],
  geometry: CurveGeometry,
  hitWidth: number = EVENT_HIT_WIDTH
): EventMarkerGeometry[] {
  const count = samples.length;
  const eventById = new Map(events.map((event) => [event.id, event]));
  return anchors.map((anchor) => {
    const xBefore = anchor.beforeIndex >= 0 ? geometry.xAt(anchor.beforeIndex) : geometry.padLeft;
    // A compaction at the very end has no post sample: extrapolate one step.
    const xAfter =
      anchor.afterIndex < count
        ? geometry.xAt(anchor.afterIndex)
        : Math.min(geometry.padLeft + geometry.plotWidth, xBefore + geometry.step);
    const x = (xBefore + xAfter) / 2;
    const preValue =
      anchor.beforeIndex >= 0
        ? samples[anchor.beforeIndex].contextTokens
        : (eventById.get(anchor.eventId)?.preTokens ?? 0);
    return {
      eventId: anchor.eventId,
      x,
      y: geometry.yAt(preValue),
      hitX: x - hitWidth / 2,
      hitWidth,
      hitY: geometry.padTop,
      hitHeight: geometry.plotHeight
    };
  });
}

export type PeakLabelPlacement = { x: number; y: number; anchor: "middle" | "start" };

/**
 * The peak label's clearance from the curve stroke. It was 4 until the J2
 * visual review caught the label grazing the stroke in dense regions; 7 keeps
 * the text clear of the 2px stroke plus its neighbours without looking
 * detached. Colliding markers still add their own dodge on top.
 */
export const PEAK_LABEL_OFFSET = 7;

/**
 * The one direct label on the chart (the peak). Sits `PEAK_LABEL_OFFSET` above
 * the point; when an event marker stands within `clearance` the label dodges
 * up and to the right instead of overlapping the diamond or the hairline.
 */
export function peakLabelPlacement(
  peakIndex: number,
  peakValue: number,
  geometry: CurveGeometry,
  markers: readonly EventMarkerGeometry[],
  fontSize: number,
  clearance = 36
): PeakLabelPlacement {
  const x = geometry.xAt(peakIndex);
  const collides = markers.some((marker) => Math.abs(marker.x - x) < clearance);
  const y = Math.max(
    geometry.yAt(peakValue) - PEAK_LABEL_OFFSET - (collides ? 6 : 0),
    geometry.padTop + fontSize
  );
  return collides ? { x: x + 6, y, anchor: "start" } : { x, y, anchor: "middle" };
}

/** Index of the position closest to `x`; `positions` must be ascending. */
export function nearestPositionIndex(positions: readonly number[], x: number): number {
  let low = 0;
  let high = positions.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (positions[mid] < x) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && Math.abs(positions[low - 1] - x) <= Math.abs(positions[low] - x)) return low - 1;
  return low;
}

/** Diamond outline as a path, centred at (cx, cy) with circumradius r. */
export function diamondPath(cx: number, cy: number, r: number): string {
  return `M${cx},${cy - r}L${cx + r},${cy}L${cx},${cy + r}L${cx - r},${cy}Z`;
}
