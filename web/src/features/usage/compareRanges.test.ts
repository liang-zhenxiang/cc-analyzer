import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  compareStats,
  modelDistribution,
  previousRange,
  projectDistribution,
  rangeLabel,
  rangesOverlap,
  statsForRange,
  type CompareRange,
  type RangeStats
} from "./compareRanges";

/**
 * 「对照」纯逻辑的测试。所有日期用本地 `Date` 构造、断言也用本地日历，
 * 因此在任何时区跑都成立；金额用 `toBeCloseTo` 对账，避免二进制小数。
 */

/** 本地自然日零点。 */
function day(year: number, month: number, date: number): number {
  return new Date(year, month - 1, date).getTime();
}

/** 本地时刻（精确到分钟）。 */
function at(year: number, month: number, date: number, hour = 10, minute = 0): number {
  return new Date(year, month - 1, date, hour, minute).getTime();
}

/** 2026-11-21 18:00，局部「今天」；区间 A 默认取 11/15–11/21。 */
const NOW = at(2026, 11, 21, 18);

let seq = 0;
function record(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(
  input: number,
  output = 0,
  cacheCreation = 0,
  cacheRead = 0
): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

function inputOf(projectLabel: string, records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel };
}

function rangeOf(startDay: number, days: number): CompareRange {
  return { startDay, days };
}

function stats(patch: Partial<RangeStats> = {}): RangeStats {
  return {
    sessions: 0,
    messages: 0,
    tokens: 0,
    usd: 0,
    unpricedSessions: 0,
    activeDays: 0,
    avgSessionMs: null,
    ...patch
  };
}

const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-1-20250805";
const A_RANGE = rangeOf(day(2026, 11, 15), 7); // 11/15–11/21

describe("previousRange", () => {
  it("steps back by exactly the same number of days", () => {
    expect(previousRange(rangeOf(day(2026, 11, 15), 7))).toEqual(
      rangeOf(day(2026, 11, 8), 7)
    );
  });

  it("crosses a month boundary", () => {
    // 11/03 − 7 天 = 10/27（10 月有 31 天）。
    expect(previousRange(rangeOf(day(2026, 11, 3), 7))).toEqual(
      rangeOf(day(2026, 10, 27), 7)
    );
  });

  it("crosses a year boundary", () => {
    // 2026-01-05 − 7 天 = 2025-12-29。
    expect(previousRange(rangeOf(day(2026, 1, 5), 7))).toEqual(
      rangeOf(day(2025, 12, 29), 7)
    );
  });

  it("counts Feb 29 in a leap year", () => {
    // 2028 是闰年：03/01 − 7 天 = 02/23（中间经过 02/29）。
    expect(previousRange(rangeOf(day(2028, 3, 1), 7))).toEqual(
      rangeOf(day(2028, 2, 23), 7)
    );
    // 单日区间紧邻闰日：02/29 的上一天是 02/28。
    expect(previousRange(rangeOf(day(2028, 2, 29), 1))).toEqual(
      rangeOf(day(2028, 2, 28), 1)
    );
  });

  it("normalizes a non-positive day count to one day", () => {
    expect(previousRange(rangeOf(day(2026, 11, 15), 0))).toEqual(
      rangeOf(day(2026, 11, 14), 1)
    );
  });
});

describe("rangesOverlap", () => {
  const a = rangeOf(day(2026, 11, 15), 7); // 11/15–11/21

  it("treats touching edges as non-overlapping", () => {
    expect(rangesOverlap(a, rangeOf(day(2026, 11, 22), 7))).toBe(false);
    expect(rangesOverlap(rangeOf(day(2026, 11, 8), 7), a)).toBe(false);
  });

  it("detects identical, partial and nested overlaps", () => {
    expect(rangesOverlap(a, rangeOf(day(2026, 11, 15), 7))).toBe(true);
    expect(rangesOverlap(a, rangeOf(day(2026, 11, 20), 7))).toBe(true);
    expect(rangesOverlap(a, rangeOf(day(2026, 11, 17), 2))).toBe(true);
  });

  it("returns false for ranges separated by a gap", () => {
    expect(rangesOverlap(a, rangeOf(day(2026, 11, 23), 1))).toBe(false);
  });
});

describe("rangeLabel", () => {
  it("prints month/day for a same-year range", () => {
    expect(rangeLabel(rangeOf(day(2026, 11, 15), 7))).toBe("11/15–11/21");
  });

  it("prints month/day when the range crosses a month but not a year", () => {
    expect(rangeLabel(rangeOf(day(2026, 11, 28), 7))).toBe("11/28–12/4");
  });

  it("includes both years when the range crosses a year", () => {
    expect(rangeLabel(rangeOf(day(2025, 12, 29), 7))).toBe(
      "2025/12/29–2026/1/4"
    );
  });

  it("does not repeat itself for a single-day range", () => {
    expect(rangeLabel(rangeOf(day(2026, 11, 15), 1))).toBe("11/15");
  });
});

describe("statsForRange", () => {
  it("returns honest zeros for an empty range", () => {
    expect(statsForRange([], A_RANGE, NOW)).toEqual({
      sessions: 0,
      messages: 0,
      tokens: 0,
      usd: 0,
      unpricedSessions: 0,
      activeDays: 0,
      avgSessionMs: null
    });
  });

  it("reads one session's messages, tokens, cost and wall-clock span", () => {
    const records = [
      record(at(2026, 11, 15, 10, 0), { kind: "user" }),
      record(at(2026, 11, 15, 10, 5), {
        model: SONNET,
        usage: usage(1_000_000)
      }),
      record(at(2026, 11, 15, 10, 10), {
        model: SONNET,
        usage: usage(0, 100_000)
      })
    ];

    const result = statsForRange([inputOf("alpha", records)], A_RANGE, NOW);

    expect(result.sessions).toBe(1);
    expect(result.messages).toBe(3);
    expect(result.tokens).toBe(1_100_000);
    // sonnet：1M input × $3/M + 0.1M output × $15/M = $3 + $1.5。
    expect(result.usd).toBeCloseTo(4.5, 10);
    expect(result.unpricedSessions).toBe(0);
    expect(result.activeDays).toBe(1);
    expect(result.avgSessionMs).toBe(10 * 60_000);
  });

  it("counts active days from any record and messages only from real speech", () => {
    const records = [
      record(at(2026, 11, 15, 10), { kind: "user" }),
      record(at(2026, 11, 16, 10), { kind: "assistant" }),
      record(at(2026, 11, 17, 10), { kind: "tool", toolName: "Bash" }),
      record(at(2026, 11, 18, 10), { kind: "user", compactSummary: true })
    ];

    const result = statsForRange([inputOf("alpha", records)], A_RANGE, NOW);

    // tool 与 compact summary 都不算消息，但都会让那一天成为活跃日。
    expect(result.messages).toBe(2);
    expect(result.activeDays).toBe(4);
  });

  it("clips records at the range edges and drops sessions with no in-window record", () => {
    const straddling = inputOf("alpha", [
      record(at(2026, 11, 14, 23), { model: SONNET, usage: usage(900_000) }),
      record(at(2026, 11, 15, 0, 30), { model: SONNET, usage: usage(100_000) })
    ]);
    const outside = inputOf("beta", [
      record(at(2026, 11, 10, 12), { model: SONNET, usage: usage(500_000) })
    ]);

    const result = statsForRange([straddling, outside], A_RANGE, NOW);

    expect(result.sessions).toBe(1);
    expect(result.tokens).toBe(100_000);
    // 窗口内只剩一条记录：首末差为 0，而不是用窗口外那条凑跨度。
    expect(result.avgSessionMs).toBe(0);
    expect(result.usd).toBeCloseTo(0.3, 10);
  });

  it("excludes unpriced sessions from cost and nulls the whole range amount", () => {
    const priced = inputOf("alpha", [
      record(at(2026, 11, 15, 10), { model: SONNET, usage: usage(1_000_000) })
    ]);
    const unpriced = inputOf("beta", [
      record(at(2026, 11, 16, 10), { model: "gpt-4o", usage: usage(500_000) })
    ]);

    const result = statsForRange([priced, unpriced], A_RANGE, NOW);

    expect(result.sessions).toBe(2);
    expect(result.tokens).toBe(1_500_000);
    expect(result.usd).toBeNull();
    expect(result.unpricedSessions).toBe(1);
  });

  it("treats a session as unpriced when any of its models is unpriced", () => {
    const mixedModels = inputOf("alpha", [
      record(at(2026, 11, 15, 10), { model: SONNET, usage: usage(100_000) }),
      record(at(2026, 11, 15, 11), { model: "gpt-4o", usage: usage(100_000) })
    ]);
    const priced = inputOf("beta", [
      record(at(2026, 11, 16, 10), { model: SONNET, usage: usage(1_000_000) })
    ]);

    const result = statsForRange([mixedModels, priced], A_RANGE, NOW);

    expect(result.sessions).toBe(2);
    expect(result.unpricedSessions).toBe(1);
    expect(result.usd).toBeNull();
  });

  it("keeps a session with no usage at $0 rather than calling it unpriced", () => {
    const result = statsForRange(
      [inputOf("alpha", [record(at(2026, 11, 15, 10), { kind: "user" })])],
      A_RANGE,
      NOW
    );

    expect(result.sessions).toBe(1);
    expect(result.tokens).toBe(0);
    expect(result.usd).toBe(0);
    expect(result.unpricedSessions).toBe(0);
  });

  it("keeps adjacent ranges separate: the older B never absorbs the newer A", () => {
    const older = rangeOf(day(2026, 11, 8), 7); // B: 11/08–11/14
    const newer = rangeOf(day(2026, 11, 15), 7); // A: 11/15–11/21
    const inputs = [
      inputOf("old", [
        record(at(2026, 11, 9), { kind: "user" }),
        record(at(2026, 11, 10), { model: SONNET, usage: usage(100_000) })
      ]),
      inputOf("new", [
        record(at(2026, 11, 16), { kind: "user" }),
        record(at(2026, 11, 17), { kind: "user" }),
        record(at(2026, 11, 18), { model: SONNET, usage: usage(900_000) })
      ])
    ];

    // 故意把「B 段结束那天」当 now 传进来：只有下界、没有上界的过滤会把
    // 11/16–11/18 的记录也算进 B，读数会悄悄偏大且不报错。
    const endOfB = at(2026, 11, 14, 23, 59);
    const bStats = statsForRange(inputs, older, endOfB);

    expect(bStats.sessions).toBe(1);
    expect(bStats.messages).toBe(2);
    expect(bStats.tokens).toBe(100_000);
    expect(bStats.activeDays).toBe(2);
    expect(bStats.usd).toBeCloseTo(0.3, 10);

    const aStats = statsForRange(inputs, newer, NOW);
    expect(aStats.sessions).toBe(1);
    expect(aStats.messages).toBe(3);
    expect(aStats.tokens).toBe(900_000);
  });

  it("treats a range that starts after today as empty", () => {
    const future = rangeOf(day(2026, 11, 22), 7);
    const records = [
      record(at(2026, 11, 22, 9), { model: SONNET, usage: usage(100_000) })
    ];

    expect(statsForRange([inputOf("alpha", records)], future, NOW).sessions).toBe(0);
  });
});

describe("compareStats", () => {
  it("computes (a - b) / b and keeps the metric order", () => {
    const a = stats({
      sessions: 15,
      messages: 120,
      tokens: 1_000,
      usd: 12,
      activeDays: 5,
      avgSessionMs: 600_000
    });
    const b = stats({
      sessions: 10,
      messages: 100,
      tokens: 2_000,
      usd: 8,
      activeDays: 5,
      avgSessionMs: 900_000
    });

    const metrics = compareStats(a, b);

    expect(metrics.map((metric) => metric.key)).toEqual([
      "sessions",
      "messages",
      "tokens",
      "usd",
      "activeDays",
      "avgSessionMs"
    ]);
    expect(metrics.map((metric) => metric.deltaPct)).toEqual([
      50,
      20,
      -50,
      50,
      0,
      ((600_000 - 900_000) / 900_000) * 100
    ]);
  });

  it("returns null when the denominator is zero, on either side", () => {
    const metrics = compareStats(
      stats({ sessions: 5, tokens: 0, usd: 0, avgSessionMs: 100 }),
      stats({ sessions: 0, tokens: 0, usd: 0, avgSessionMs: 0 })
    );
    const byKey = (key: string) => metrics.find((metric) => metric.key === key)!;

    expect(byKey("sessions").deltaPct).toBeNull();
    expect(byKey("tokens").deltaPct).toBeNull();
    expect(byKey("usd").deltaPct).toBeNull();
    expect(byKey("avgSessionMs").deltaPct).toBeNull();
  });

  it("returns null when either side is null", () => {
    const metrics = compareStats(
      stats({ usd: null, avgSessionMs: null, unpricedSessions: 1 }),
      stats({ usd: 10, avgSessionMs: 1_000 })
    );
    const byKey = (key: string) => metrics.find((metric) => metric.key === key)!;

    expect(byKey("usd").deltaPct).toBeNull();
    expect(byKey("avgSessionMs").deltaPct).toBeNull();
  });

  it("marks only cost as up-bad", () => {
    const directions = compareStats(stats(), stats()).map((metric) => [
      metric.key,
      metric.direction
    ]);

    expect(directions).toEqual([
      ["sessions", "neutral"],
      ["messages", "neutral"],
      ["tokens", "neutral"],
      ["usd", "up-bad"],
      ["activeDays", "neutral"],
      ["avgSessionMs", "neutral"]
    ]);
  });
});

describe("distribution", () => {
  const A = rangeOf(day(2026, 1, 1), 7); // 1/1–1/7
  const B = rangeOf(day(2026, 1, 8), 7); // 1/8–1/14
  const JAN_NOW = at(2026, 1, 20, 12);

  const inputs: UsageSessionInput[] = [
    inputOf("alpha", [
      record(at(2026, 1, 2), { model: SONNET, usage: usage(500_000) }),
      record(at(2026, 1, 10), { model: SONNET, usage: usage(100_000) })
    ]),
    inputOf("beta", [
      record(at(2026, 1, 3), { model: SONNET, usage: usage(300_000) }),
      record(at(2026, 1, 11), { model: OPUS, usage: usage(500_000) })
    ]),
    inputOf("gamma", [
      record(at(2026, 1, 4), { model: SONNET, usage: usage(100_000) })
    ]),
    inputOf("delta", [
      record(at(2026, 1, 12), { model: SONNET, usage: usage(100_000) })
    ]),
    inputOf("", [
      record(at(2026, 1, 5), { model: SONNET, usage: usage(999_999) })
    ])
  ];

  it("aggregates projects by token, shares by range total, and flags one-sided rows", () => {
    const rows = projectDistribution(inputs, A, B, JAN_NOW);

    // 排序：a+b 降序；合计相同的 gamma / delta 按标签字典序。
    expect(rows.map((row) => row.key)).toEqual([
      "beta",
      "alpha",
      "delta",
      "gamma"
    ]);

    const alpha = rows.find((row) => row.key === "alpha")!;
    expect(alpha.a).toBe(500_000);
    expect(alpha.b).toBe(100_000);
    expect(alpha.aShare).toBeCloseTo(500_000 / 900_000, 10);
    expect(alpha.bShare).toBeCloseTo(100_000 / 700_000, 10);
    expect(alpha.onlyIn).toBeNull();

    const gamma = rows.find((row) => row.key === "gamma")!;
    expect(gamma.onlyIn).toBe("a");
    expect(gamma.bShare).toBe(0);

    const delta = rows.find((row) => row.key === "delta")!;
    expect(delta.onlyIn).toBe("b");
    expect(delta.aShare).toBe(0);

    // 空项目标签不参与分布，也不进分母（alpha+beta+gamma 合计 900k）。
    expect(rows.some((row) => row.key === "")).toBe(false);
  });

  it("applies the top-N limit after sorting", () => {
    const rows = projectDistribution(inputs, A, B, JAN_NOW, 2);

    expect(rows.map((row) => row.key)).toEqual(["beta", "alpha"]);
  });

  it("keeps ties deterministic by label", () => {
    const tied = [
      inputOf("zulu", [record(at(2026, 1, 2), { usage: usage(100_000) })]),
      inputOf("alpha", [record(at(2026, 1, 2), { usage: usage(100_000) })])
    ];

    expect(projectDistribution(tied, A, B, JAN_NOW).map((row) => row.key)).toEqual([
      "alpha",
      "zulu"
    ]);
  });

  it("aggregates models by token with unknown models labelled, not dropped", () => {
    // 模型分布按记录自己的 model 聚合，与会话的项目标签无关——单独一组输入，
    // 避免与上面的项目夹具互相干扰。缺 model 的记录归「未知模型」。
    const modelInputs: UsageSessionInput[] = [
      inputOf("alpha", [
        record(at(2026, 1, 2), { model: SONNET, usage: usage(500_000) }),
        record(at(2026, 1, 10), { model: SONNET, usage: usage(100_000) })
      ]),
      inputOf("beta", [
        record(at(2026, 1, 3), { model: OPUS, usage: usage(300_000) }),
        record(at(2026, 1, 11), { usage: usage(100_000) })
      ]),
      inputOf("gamma", [record(at(2026, 1, 4), { usage: usage(100_000) })])
    ];
    const rows = modelDistribution(modelInputs, A, B, JAN_NOW);
    const byKey = (key: string) => rows.find((row) => row.key === key)!;

    // sonnet 600k、opus 300k、未知模型 200k → 降序。
    expect(rows.map((row) => row.key)).toEqual([SONNET, OPUS, "未知模型"]);

    const sonnet = byKey(SONNET);
    expect(sonnet.a).toBe(500_000);
    expect(sonnet.b).toBe(100_000);
    expect(sonnet.aShare).toBeCloseTo(500_000 / 900_000, 10);
    expect(sonnet.bShare).toBeCloseTo(100_000 / 200_000, 10);
    expect(sonnet.onlyIn).toBeNull();

    expect(byKey(OPUS).onlyIn).toBe("a");
    expect(byKey(OPUS).b).toBe(0);
    expect(byKey(OPUS).aShare).toBeCloseTo(300_000 / 900_000, 10);
    expect(byKey("未知模型").onlyIn).toBeNull();
    expect(byKey("未知模型").a).toBe(100_000);
    expect(byKey("未知模型").b).toBe(100_000);
  });

  it("ignores records without usage and empty ranges", () => {
    const onlyChatter = [
      inputOf("alpha", [record(at(2026, 1, 2), { kind: "user" })])
    ];
    const empty = rangeOf(day(2026, 3, 1), 7);

    expect(modelDistribution(onlyChatter, A, B, JAN_NOW)).toEqual([]);
    expect(projectDistribution(onlyChatter, A, B, JAN_NOW)).toEqual([]);
    expect(projectDistribution(inputs, empty, empty, JAN_NOW)).toEqual([]);
  });
});
