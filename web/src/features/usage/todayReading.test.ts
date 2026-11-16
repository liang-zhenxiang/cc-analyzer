import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { storyLog } from "./storyLog";
import { todayReadingOf } from "./todayReading";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 「今天」KPI 的读取口径（Issue #342）。这些用例故意把时钟钉在本地午夜附近
 * ——「今天」是本地自然日，UTC 比较 / 24 小时减法都会在跨午夜时给出错误答案。
 */

let seq = 0;
function recordOf(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `today-${seq}`,
    fullId: `s0:today-${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    usage: { inputTokens: 100, outputTokens: 20, cacheCreationTokens: 3, cacheReadTokens: 400 },
    raw: {},
    ...patch
  };
}

function inputOf(records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "-repo-demo" };
}

/** 本地 2026-11-16 00:30——刚过午夜，最容易暴露「今天」判断错误。 */
const NOW = new Date(2026, 10, 16, 0, 30).getTime();
const LATE_YESTERDAY = new Date(2026, 10, 15, 23, 50).getTime();
const EARLY_TODAY = new Date(2026, 10, 16, 0, 5).getTime();
const YESTERDAY_NOON = new Date(2026, 10, 15, 12, 0).getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  seq = 0;
});

describe("todayReadingOf · 本地自然日边界", () => {
  it("午夜前开工、午夜后继续的会话属于昨天，今天读数为 0", () => {
    // 会话按首条记录归属开工日（storyLog 的既定口径）：23:50 开工就属于 11/15。
    const session = inputOf([
      recordOf(LATE_YESTERDAY, { kind: "user", usage: undefined }),
      recordOf(EARLY_TODAY)
    ]);
    const days = storyLog([session]);
    expect(days[0].date).toBe("2026-11-15");

    expect(todayReadingOf(days, Date.now())).toEqual({ tokens: 0, sessions: 0, messages: 0 });
  });

  it("午夜后开工的会话算今天，且只取今天那一行", () => {
    const yesterday = inputOf([recordOf(YESTERDAY_NOON)]);
    const today = inputOf([
      recordOf(EARLY_TODAY, { kind: "user", usage: undefined }),
      recordOf(EARLY_TODAY + 60_000)
    ]);
    const days = storyLog([yesterday, today]);
    expect(days.map((day) => day.date)).toEqual(["2026-11-16", "2026-11-15"]);

    // 21:00 之后才写进今天的记录也不影响归属：开工日是今天。
    expect(todayReadingOf(days, Date.now())).toEqual({
      tokens: 523,
      sessions: 1,
      messages: 2
    });
  });
});

describe("todayReadingOf · 今天没有记录", () => {
  it("最新一天是昨天时返回 0（页面据此显示 0，而不是隐藏整格）", () => {
    const days = storyLog([inputOf([recordOf(YESTERDAY_NOON)])]);
    expect(days[0].date).toBe("2026-11-15");
    expect(todayReadingOf(days, Date.now())).toEqual({ tokens: 0, sessions: 0, messages: 0 });
  });

  it("空窗口返回 0", () => {
    expect(todayReadingOf([], Date.now())).toEqual({ tokens: 0, sessions: 0, messages: 0 });
  });
});

describe("todayReadingOf · 子 agent 记录", () => {
  it("今天只有 sidechain 记录时仍计入今天", () => {
    // 子 agent 的记录是会话记录的一部分，storyLog 不按 isSidechain 剔除。
    const days = storyLog([
      inputOf([
        recordOf(EARLY_TODAY, { isSidechain: true }),
        recordOf(EARLY_TODAY + 30_000, { isSidechain: true })
      ])
    ]);

    expect(todayReadingOf(days, Date.now())).toEqual({
      tokens: 1046,
      sessions: 1,
      messages: 2
    });
  });
});
