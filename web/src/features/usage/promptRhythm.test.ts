import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildPromptRhythm,
  formatRhythmChars,
  formatRhythmInterval
} from "./promptRhythm";

/** 固定时间基：2026-10-15 09:00 本地。 */
const NOW = new Date(2026, 9, 15, 18, 0).getTime();
const BASE = new Date(2026, 9, 15, 9, 0).getTime();
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function record(timestamp: number, text: string, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `r-${timestamp}-${text.length}`,
    fullId: `r-${timestamp}-${text.length}`,
    kind: "user",
    timestamp,
    durationMs: 0,
    text,
    isError: false,
    raw: {},
    ...patch
  };
}

function input(projectLabel: string, records: SessionRecord[]): UsageSessionInput {
  return { projectLabel, records };
}

describe("buildPromptRhythm（F10 提示词节奏）", () => {
  it("空输入：没有样本、没有点、中位数为 null", () => {
    const data = buildPromptRhythm([], 30, NOW);
    expect(data.sampleCount).toBe(0);
    expect(data.plottedCount).toBe(0);
    expect(data.points).toEqual([]);
    expect(data.medianIntervalMs).toBeNull();
    expect(data.medianChars).toBeNull();
    expect(data.medianX).toBeNull();
    expect(data.projects).toEqual([]);
  });

  it("单条用户消息：没有「上一条」，只计数不画点", () => {
    const data = buildPromptRhythm([input("p", [record(BASE, "你好")])], 30, NOW);
    expect(data.sampleCount).toBe(1);
    expect(data.plottedCount).toBe(0);
    expect(data.skipped.noPrevious).toBe(1);
  });

  it("两条消息：间隔与字数进入对数坐标，项目拿到第一个颜色", () => {
    const data = buildPromptRhythm(
      [input("p", [record(BASE, "hello"), record(BASE + MIN, "abc")])],
      30,
      NOW
    );
    expect(data.plottedCount).toBe(1);
    const point = data.points[0];
    expect(point.intervalMs).toBe(MIN);
    expect(point.chars).toBe(3);
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(1);
    expect(point.y).toBeCloseTo(Math.log(3) / Math.log(10_000), 10);
    expect(point.colorIndex).toBe(0);
    expect(data.medianIntervalMs).toBe(MIN);
    expect(data.medianChars).toBe(3);
    expect(data.medianX).toBeCloseTo(point.x, 10);
    expect(data.medianY).toBeCloseTo(point.y, 10);
  });

  it("字数按 Unicode 码点算：emoji 是 1 个字符而不是 2 个", () => {
    const data = buildPromptRhythm(
      [input("p", [record(BASE, "a"), record(BASE + MIN, "😀")])],
      30,
      NOW
    );
    expect(data.points[0].chars).toBe(1);
    expect(data.points[0].y).toBeCloseTo(0, 10);
  });

  it("过滤：0 字、< 5 秒、> 24 小时、> 1 万字分别计数，不画点", () => {
    const data = buildPromptRhythm(
      [
        input("p", [
          record(BASE, "a"),
          record(BASE + 4 * SEC, "b"),
          record(BASE + 4 * SEC + 25 * HOUR, "c"),
          record(BASE + 4 * SEC + 25 * HOUR + MIN, "d".repeat(10_001)),
          record(BASE + 4 * SEC + 25 * HOUR + 2 * MIN, "")
        ])
      ],
      30,
      NOW
    );
    expect(data.sampleCount).toBe(5);
    expect(data.plottedCount).toBe(0);
    expect(data.skipped).toEqual({
      noPrevious: 1,
      empty: 1,
      tooShort: 1,
      tooLong: 1,
      tooBig: 1
    });
  });

  it("对数轴 0 值：间隔 0 与 0 字都不会产生 NaN 坐标", () => {
    const data = buildPromptRhythm(
      [
        input("p", [
          record(BASE, "a"),
          record(BASE, "b"),
          record(BASE + MIN, ""),
          record(BASE + 2 * MIN, "c")
        ])
      ],
      30,
      NOW
    );
    expect(data.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(
      true
    );
    expect(data.points.map((point) => point.chars)).toEqual([1]);
  });

  it("项目按消息数取前 6，第 7 名及以后用中性色", () => {
    const records = Array.from({ length: 7 }, (_, index) =>
      record(BASE + index * MIN, `p${index + 1}`)
    );
    const data = buildPromptRhythm(
      records.map((item, index) => input(`p${index + 1}`, [item])),
      30,
      NOW
    );
    expect(data.projects.map((project) => project.label)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7"
    ]);
    expect(data.projects.map((project) => project.colorIndex)).toEqual([
      0,
      1,
      2,
      3,
      4,
      5,
      null
    ]);
    expect(data.points.some((point) => point.colorIndex === null)).toBe(true);
  });

  it("中位数：偶数样本取中间两项的平均", () => {
    const data = buildPromptRhythm(
      [
        input("p", [
          record(BASE, "a"),
          record(BASE + 10 * SEC, "b".repeat(10)),
          record(BASE + 30 * SEC, "c".repeat(20)),
          record(BASE + 60 * SEC, "d".repeat(30)),
          record(BASE + 120 * SEC, "e".repeat(40))
        ])
      ],
      30,
      NOW
    );
    // 间隔：10s / 20s / 30s / 60s → 中位 25s；字数：10 / 20 / 30 / 40 → 25。
    expect(data.medianIntervalMs).toBe(25 * SEC);
    expect(data.medianChars).toBe(25);
  });

  it("压缩摘要 / 系统注入 / 中断标记不是用户说的话", () => {
    const data = buildPromptRhythm(
      [
        input("p", [
          record(BASE, "真实", {}),
          record(BASE + MIN, "摘要", { compactSummary: true }),
          record(BASE + 2 * MIN, "注入", { isSynthetic: true }),
          record(BASE + 3 * MIN, "中断", { isInterrupt: true }),
          record(BASE + 4 * MIN, "真实二")
        ])
      ],
      30,
      NOW
    );
    expect(data.sampleCount).toBe(2);
    expect(data.plottedCount).toBe(1);
  });

  it("窗口边界：早于窗口起点的用户消息不参与，也不充当「上一条」", () => {
    const data = buildPromptRhythm(
      [input("p", [record(NOW - 40 * DAY, "旧"), record(BASE, "新一"), record(BASE + MIN, "新二")])],
      30,
      NOW
    );
    expect(data.sampleCount).toBe(2);
    expect(data.plottedCount).toBe(1);
    expect(data.skipped.noPrevious).toBe(1);
    expect(data.points[0].intervalMs).toBe(MIN);
  });

  it("文案：间隔与字数按中文短句输出", () => {
    expect(formatRhythmInterval(42 * SEC)).toBe("42 秒");
    expect(formatRhythmInterval(10 * MIN)).toBe("10 分");
    expect(formatRhythmInterval(164 * MIN)).toBe("2 小时 44 分");
    expect(formatRhythmInterval(DAY)).toBe("1 天");
    expect(formatRhythmChars(180)).toBe("180 字");
    expect(formatRhythmChars(1200)).toBe("1.2k 字");
    expect(formatRhythmChars(0)).toBe("0 字");
  });
});
