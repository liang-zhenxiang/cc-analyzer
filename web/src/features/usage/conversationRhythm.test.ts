import { describe, expect, it } from "vitest";
import {
  BURST_GAP_MS,
  FAST_BURST_SHARE,
  FAST_MEDIAN_MS,
  MIN_RHYTHM_MESSAGES,
  rhythmOf,
  THINK_MEDIAN_MS
} from "./conversationRhythm";

const T0 = 1_700_000_000_000;
const MIN = 60_000;

/** 从间隔数组还原时间戳（起点 T0）。 */
function stampsFrom(gaps: readonly number[]): number[] {
  const times = [T0];
  for (const gap of gaps) times.push(times[times.length - 1] + gap);
  return times;
}

describe("rhythmOf 样本门槛", () => {
  it("returns null for fewer than three messages", () => {
    expect(MIN_RHYTHM_MESSAGES).toBe(3);
    expect(rhythmOf([])).toBeNull();
    expect(rhythmOf([T0])).toBeNull();
    expect(rhythmOf([T0, T0 + MIN])).toBeNull();
  });

  it("accepts three messages and drops non-finite timestamps", () => {
    expect(rhythmOf([T0, T0 + MIN, T0 + 2 * MIN])).not.toBeNull();
    expect(rhythmOf([T0, Number.NaN, T0 + MIN, T0 + 2 * MIN])).not.toBeNull();
    expect(rhythmOf([T0, Number.NaN, T0 + MIN])).toBeNull();
  });

  it("sorts unordered timestamps", () => {
    const sorted = rhythmOf([T0, T0 + 2 * MIN, T0 + MIN]);
    const ordered = rhythmOf([T0, T0 + MIN, T0 + 2 * MIN]);
    expect(sorted).toEqual(ordered);
    expect(sorted!.gaps).toEqual([{ gapMs: MIN }, { gapMs: MIN }]);
  });
});

describe("rhythmOf 三类 label", () => {
  it("labels fast back-and-forth chat", () => {
    const rhythm = rhythmOf([T0, T0 + 30_000, T0 + 60_000, T0 + 90_000])!;
    expect(rhythm.gaps).toEqual([{ gapMs: 30_000 }, { gapMs: 30_000 }, { gapMs: 30_000 }]);
    expect(rhythm.medianMs).toBe(30_000);
    expect(rhythm.bursts).toBe(3);
    expect(rhythm.label).toBe("快问快追");
  });

  it("labels even, moderate pacing", () => {
    const rhythm = rhythmOf(stampsFrom([5 * MIN, 5 * MIN, 5 * MIN]))!;
    expect(rhythm.medianMs).toBe(5 * MIN);
    expect(rhythm.bursts).toBe(0);
    expect(rhythm.label).toBe("匀速");
  });

  it("labels long pauses between single messages", () => {
    const rhythm = rhythmOf(stampsFrom([15 * MIN, 15 * MIN, 15 * MIN]))!;
    expect(rhythm.medianMs).toBe(15 * MIN);
    expect(rhythm.label).toBe("长考后一击");
  });

  it("keeps the 2-minute median boundary exclusive", () => {
    // 间隔 30s/3.5min/30s/3.5min：中位 (30s+3.5min)/2 = 恰好 2min，且 bursts 只有一半。
    const rhythm = rhythmOf(stampsFrom([30_000, 3.5 * MIN, 30_000, 3.5 * MIN]))!;
    expect(rhythm.medianMs).toBe(FAST_MEDIAN_MS);
    expect(rhythm.bursts).toBe(2);
    expect(rhythm.label).toBe("匀速");
  });

  it("keeps the 10-minute median boundary inclusive", () => {
    const rhythm = rhythmOf(stampsFrom([10 * MIN, 10 * MIN, 10 * MIN]))!;
    expect(rhythm.medianMs).toBe(THINK_MEDIAN_MS);
    expect(rhythm.label).toBe("长考后一击");
  });
});

describe("rhythmOf 快间隔", () => {
  it("counts gaps strictly below 60 seconds", () => {
    expect(BURST_GAP_MS).toBe(60_000);
    const rhythm = rhythmOf(stampsFrom([59_999, 60_000, 59_999]))!;
    expect(rhythm.bursts).toBe(2);
  });

  it("requires a 60% burst share for 快问快追", () => {
    expect(FAST_BURST_SHARE).toBe(0.6);
    const atLine = rhythmOf(stampsFrom([30_000, 30_000, 30_000, 5 * MIN, 5 * MIN]))!;
    expect(atLine.bursts).toBe(3);
    expect(atLine.label).toBe("快问快追");

    const below = rhythmOf(stampsFrom([30_000, 30_000, 5 * MIN, 5 * MIN, 5 * MIN]))!;
    expect(below.bursts).toBe(2);
    expect(below.label).toBe("匀速");
  });

  it("counts identical timestamps as zero-gap bursts", () => {
    const rhythm = rhythmOf([T0, T0, T0])!;
    expect(rhythm.gaps).toEqual([{ gapMs: 0 }, { gapMs: 0 }]);
    expect(rhythm.label).toBe("快问快追");
  });
});

describe("rhythmOf 统计量", () => {
  it("reports median, p90 and longest", () => {
    // 间隔 1..10 分钟，p90 = 第 9 个（最近秩法）。
    const gaps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((minute) => minute * MIN);
    const rhythm = rhythmOf(stampsFrom(gaps))!;
    expect(rhythm.medianMs).toBe(5 * MIN + 30_000);
    expect(rhythm.p90Ms).toBe(9 * MIN);
    expect(rhythm.longestMs).toBe(10 * MIN);
  });

  it("averages the two middle gaps for an even gap count", () => {
    const rhythm = rhythmOf(stampsFrom([1 * MIN, 3 * MIN]))!;
    expect(rhythm.medianMs).toBe(2 * MIN);
  });
});
