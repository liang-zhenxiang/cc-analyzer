import { describe, expect, it } from "vitest";
import { sessionDurationsOf } from "./sessionDurations";

const MIN = 60_000;
const HOUR = 3_600_000;

describe("sessionDurationsOf", () => {
  it("splits durations on every bucket boundary", () => {
    const durations = [
      0,
      299_999,
      300_000,
      899_999,
      900_000,
      3_599_999,
      3_600_000,
      14_399_999,
      14_400_000
    ];
    const result = sessionDurationsOf(durations);
    expect(result).not.toBeNull();
    expect(result!.buckets.map((bucket) => bucket.count)).toEqual([2, 2, 2, 2, 1]);
    expect(result!.buckets.map((bucket) => bucket.id)).toEqual([
      "under5min",
      "5to15min",
      "15to60min",
      "1to4h",
      "4hplus"
    ]);
    // 9 个值的中位数是第 5 个（900_000）。
    expect(result!.medianMs).toBe(900_000);
    expect(result!.unmeasurable).toBe(0);
  });

  it("counts single-record sessions in the shortest bucket and as unmeasurable", () => {
    const result = sessionDurationsOf([null, 900_000]);
    expect(result!.buckets[0]!.count).toBe(1);
    expect(result!.buckets[2]!.count).toBe(1);
    expect(result!.unmeasurable).toBe(1);
    // 中位数只算可计时的会话。
    expect(result!.medianMs).toBe(900_000);
  });

  it("treats negative and non-finite durations as unmeasurable, not as zero", () => {
    const result = sessionDurationsOf([Number.NaN, -5, 1_000_000]);
    expect(result!.unmeasurable).toBe(2);
    expect(result!.buckets[0]!.count).toBe(2);
    expect(result!.buckets[2]!.count).toBe(1);
    expect(result!.medianMs).toBe(1_000_000);
  });

  it("averages the two middle values for an even number of measurable sessions", () => {
    expect(sessionDurationsOf([100, 300])!.medianMs).toBe(200);
    expect(sessionDurationsOf([100, 200, 300])!.medianMs).toBe(200);
  });

  it("places each duration in exactly one bucket", () => {
    const result = sessionDurationsOf([30_000, 10 * MIN, 30 * MIN, 2 * HOUR, 5 * HOUR]);
    expect(result!.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 1, 1]);
    expect(result!.buckets.map((bucket) => bucket.label)).toEqual([
      "不足 5 分钟",
      "5–15 分钟",
      "15–60 分钟",
      "1–4 小时",
      "≥ 4 小时"
    ]);
  });

  it("returns null for empty input and for input with nothing measurable", () => {
    expect(sessionDurationsOf([])).toBeNull();
    expect(sessionDurationsOf([null, null])).toBeNull();
    expect(sessionDurationsOf([Number.NaN, null])).toBeNull();
  });
});
