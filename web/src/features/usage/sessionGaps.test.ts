import { describe, expect, it } from "vitest";
import { sessionGapHistogram } from "./sessionGaps";

const BASE = 1_000_000;

function startsAfter(gaps: readonly number[]): number[] {
  const starts = [BASE];
  for (const gap of gaps) starts.push(starts[starts.length - 1]! + gap);
  return starts;
}

describe("sessionGapHistogram", () => {
  it("falls on every bucket boundary", () => {
    const gaps = [
      59_999,
      60_000,
      599_999,
      600_000,
      3_599_999,
      3_600_000,
      14_399_999,
      14_400_000,
      86_399_999,
      86_400_000
    ];
    const result = sessionGapHistogram(startsAfter(gaps));
    expect(result).not.toBeNull();
    expect(result!.buckets.map((bucket) => bucket.count)).toEqual([1, 2, 2, 2, 2, 1]);
    expect(result!.buckets.map((bucket) => bucket.id)).toEqual([
      "under1min",
      "1to10min",
      "10to60min",
      "1to4h",
      "4to24h",
      "over24h"
    ]);
    // 10 个间隔的中位数取中间两个（3_599_999 与 3_600_000）的均值。
    expect(result!.medianMs).toBe((3_599_999 + 3_600_000) / 2);
    expect(result!.skipped).toBe(0);
  });

  it("sorts the timestamps, so input order does not matter", () => {
    const result = sessionGapHistogram([BASE + 1_000, BASE, BASE + 5_000]);
    expect(result!.buckets[0]!.count).toBe(2);
    expect(result!.medianMs).toBe(2_500);
  });

  it("counts equal timestamps as a zero-length gap", () => {
    const result = sessionGapHistogram([BASE, BASE]);
    expect(result!.buckets[0]!.count).toBe(1);
    expect(result!.medianMs).toBe(0);
  });

  it("skips null timestamps and reports how many were skipped", () => {
    const result = sessionGapHistogram([BASE, null, BASE + 5_000]);
    expect(result!.skipped).toBe(1);
    expect(result!.buckets[0]!.count).toBe(1);
    expect(result!.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(1);
  });

  it("returns null when fewer than two valid timestamps remain", () => {
    expect(sessionGapHistogram([])).toBeNull();
    expect(sessionGapHistogram([BASE])).toBeNull();
    expect(sessionGapHistogram([BASE, null])).toBeNull();
    expect(sessionGapHistogram([null, null])).toBeNull();
    expect(sessionGapHistogram([Number.NaN, BASE])).toBeNull();
  });

  it("puts exactly one gap in each bucket for the six canonical gaps", () => {
    const gaps = [30_000, 300_000, 1_800_000, 7_200_000, 43_200_000, 90_000_000];
    const result = sessionGapHistogram(startsAfter(gaps));
    expect(result!.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(result!.buckets.map((bucket) => bucket.label)).toEqual([
      "不足 1 分钟",
      "1–10 分钟",
      "10–60 分钟",
      "1–4 小时",
      "4–24 小时",
      "超过 24 小时"
    ]);
  });
});
