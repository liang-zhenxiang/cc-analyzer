import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  arenaSideOf,
  buildProjectDaily,
  mainModelOf,
  usageTokens,
  windowDayStarts
} from "./projectArena";

/**
 * Round CC / F2 的纯逻辑。
 *
 * 口径只有一个：窗口按本地日切、含今天、只看落在窗口里的记录——与
 * `aggregateRange` 逐条对齐，所以这里的断言写的是**具体 token 数与下标**，
 * 不是「非零」。
 */

/** 2026-01-15 18:00（本地）。 */
const NOW = new Date(2026, 0, 15, 18, 0).getTime();
const ALPHA = "-work-alpha";
const BETA = "-work-beta";
const GAMMA = "-work-gamma";

/** The local instant at `hour` on the day `dayOffset` days from Jan 15. */
function at(dayOffset: number, hour = 12): number {
  return new Date(2026, 0, 15 + dayOffset, hour).getTime();
}

function recordOf(
  id: string,
  timestamp: number,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...overrides
  };
}

function usageOf(input: number, output = 0): SessionUsage {
  return { inputTokens: input, outputTokens: output };
}

function inputOf(
  label: string,
  records: SessionRecord[],
  projectPath?: string
): UsageSessionInput {
  const input: UsageSessionInput = { projectLabel: label, records };
  if (projectPath) input.projectPath = projectPath;
  return input;
}

describe("windowDayStarts", () => {
  it("returns local day starts, oldest first, with today as the last one", () => {
    const days = windowDayStarts(7, NOW);
    expect(days).toHaveLength(7);
    expect(days[6]).toBe(new Date(2026, 0, 15).getTime());
    expect(days[0]).toBe(new Date(2026, 0, 9).getTime());
    expect(days[3]).toBe(new Date(2026, 0, 12).getTime());
  });

  it("floors fractional day counts and never returns an empty window", () => {
    expect(windowDayStarts(2.9, NOW)).toHaveLength(2);
    expect(windowDayStarts(0, NOW)).toEqual([new Date(2026, 0, 15).getTime()]);
  });
});

describe("buildProjectDaily", () => {
  const inputs = [
    inputOf(ALPHA, [
      recordOf("a-today", at(0), { usage: usageOf(1_000_000, 100_000) }),
      recordOf("a-yesterday", at(-1), { usage: usageOf(200_000) }),
      // Outside a 7-day window: must not leak into any bar.
      recordOf("a-old", at(-10), { usage: usageOf(9_000_000) }),
      // No usage: contributes nothing.
      recordOf("a-tool", at(0), { kind: "tool" })
    ]),
    inputOf(BETA, [recordOf("b-today", at(0), { usage: usageOf(300_000) })])
  ];

  it("splits the window's daily series into A and B with real day indices", () => {
    const daily = buildProjectDaily(inputs, 7, ALPHA, BETA, NOW);
    expect(daily.days).toHaveLength(7);
    expect(daily.days[6].dayStart).toBe(new Date(2026, 0, 15).getTime());
    expect(daily.a).toEqual([0, 0, 0, 0, 0, 200_000, 1_100_000]);
    expect(daily.b).toEqual([0, 0, 0, 0, 0, 0, 300_000]);
  });

  it("ignores projects that are not on either side", () => {
    const daily = buildProjectDaily(
      [...inputs, inputOf(GAMMA, [recordOf("g-today", at(0), { usage: usageOf(50_000) })])],
      7,
      ALPHA,
      BETA,
      NOW
    );
    expect(daily.a.reduce((sum, value) => sum + value, 0)).toBe(1_300_000);
    expect(daily.b.reduce((sum, value) => sum + value, 0)).toBe(300_000);
    expect(daily.a).not.toContain(50_000);
    expect(daily.b).not.toContain(50_000);
  });

  it("puts a project compared with itself into A only", () => {
    const daily = buildProjectDaily(inputs, 7, ALPHA, ALPHA, NOW);
    expect(daily.a).toEqual([0, 0, 0, 0, 0, 200_000, 1_100_000]);
    expect(daily.b.every((value) => value === 0)).toBe(true);
  });
});

describe("arenaSideOf", () => {
  it("reports total, per-day average, peak and the peak day index", () => {
    expect(arenaSideOf([0, 100, 0, 50])).toEqual({
      total: 150,
      average: 37.5,
      peak: 100,
      peakDay: 1
    });
  });

  it("marks all-zero bars with no peak day instead of day 0", () => {
    expect(arenaSideOf([0, 0, 0])).toEqual({
      total: 0,
      average: 0,
      peak: 0,
      peakDay: -1
    });
    expect(arenaSideOf([])).toEqual({ total: 0, average: 0, peak: 0, peakDay: -1 });
  });
});

describe("mainModelOf", () => {
  it("picks the model with the most tokens and skips records without usage", () => {
    const inputs = [
      inputOf(ALPHA, [
        recordOf("a-sonnet", at(0), {
          model: "claude-sonnet-4-5-20250929",
          usage: usageOf(1_000_000)
        }),
        recordOf("a-opus", at(-1), {
          model: "claude-opus-4-1-20250805",
          usage: usageOf(500_000)
        }),
        // No usage: cannot vote, even though it names a third model.
        recordOf("a-haiku", at(-1), { model: "claude-haiku-4-5" })
      ])
    ];
    expect(mainModelOf(inputs, 7, ALPHA, NOW)).toEqual({
      model: "claude-sonnet-4-5-20250929",
      tokens: 1_000_000
    });
  });

  it("breaks a token tie on the raw model id so the answer is stable", () => {
    const inputs = [
      inputOf(ALPHA, [
        recordOf("a-sonnet", at(0), {
          model: "claude-sonnet-4-5-20250929",
          usage: usageOf(100_000)
        }),
        recordOf("a-opus", at(-1), {
          model: "claude-opus-4-1-20250805",
          usage: usageOf(100_000)
        })
      ])
    ];
    expect(mainModelOf(inputs, 7, ALPHA, NOW).model).toBe("claude-opus-4-1-20250805");
  });

  it("counts a usage-carrying record with no model as 未知模型", () => {
    const inputs = [
      inputOf(ALPHA, [recordOf("a-nomodel", at(0), { usage: usageOf(10_000) })])
    ];
    expect(mainModelOf(inputs, 7, ALPHA, NOW)).toEqual({ model: "未知模型", tokens: 10_000 });
  });

  it("returns null for a project with no usage in the window", () => {
    const inputs = [inputOf(ALPHA, [recordOf("a-old", at(-10), { usage: usageOf(5_000) })])];
    expect(mainModelOf(inputs, 7, ALPHA, NOW)).toEqual({ model: null, tokens: 0 });
  });
});

describe("usageTokens", () => {
  it("sums the four counters", () => {
    expect(
      usageTokens({
        inputTokens: 1_000,
        outputTokens: 24,
        cacheCreationTokens: 30,
        cacheReadTokens: 5
      })
    ).toBe(1_059);
    expect(usageTokens({})).toBe(0);
  });
});
