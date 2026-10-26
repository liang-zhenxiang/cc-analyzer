import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { buildWeeklyDigest, isEmptyDigest, weekStartOf } from "./weeklyDigest";

/** 本地时刻（`new Date(y, m, d, h, min)`）——本模块全部按本地日历算，夹具也按本地写。 */
const at = (year: number, month: number, day: number, hour = 12, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

/** 2026-10-19 是周一；本周 = 10/19 00:00 起，上周 = 10/12 00:00 起。 */
const NOW = at(2026, 10, 21, 12, 0);

function recordOf(
  timestamp: number,
  options: {
    kind?: SessionRecord["kind"];
    model?: string;
    usage?: SessionRecord["usage"];
    compactSummary?: boolean;
  } = {}
): SessionRecord {
  return {
    id: `r-${timestamp}-${options.kind ?? "assistant"}`,
    fullId: `f-${timestamp}-${options.kind ?? "assistant"}`,
    kind: options.kind ?? "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    model: options.model,
    usage: options.usage,
    compactSummary: options.compactSummary,
    raw: {}
  } as unknown as SessionRecord;
}

function inputOf(...records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "proj" };
}

describe("weeklyDigest · 周界（本地自然周、周一起始）", () => {
  it("anchors every timestamp on the Monday of its own local week", () => {
    expect(weekStartOf(at(2026, 10, 21, 12))).toBe(at(2026, 10, 19, 0));
    // 周一零点属于新的一周（半开区间 [start, end) 的左端）。
    expect(weekStartOf(at(2026, 10, 19, 0))).toBe(at(2026, 10, 19, 0));
    // 周日是**上一个**周一的尾巴，不是下一周的开头——这正是「周一起始」
    // 与 `getDay()` 直觉最容易错开的一天。
    expect(weekStartOf(at(2026, 10, 25, 23, 59))).toBe(at(2026, 10, 19, 0));
  });

  it("puts a boundary record in exactly one week and drops what falls outside both", () => {
    const digest = buildWeeklyDigest(
      [
        inputOf(
          recordOf(at(2026, 10, 12, 0), { usage: { inputTokens: 1_000 } }), // 上周一 00:00 含
          recordOf(at(2026, 10, 19, 0), { usage: { inputTokens: 2_000 } }), // 本周一 00:00 含
          recordOf(at(2026, 10, 26, 0), { usage: { inputTokens: 4_000 } }) // 下周一 00:00 不含
        )
      ],
      NOW
    );
    expect(digest.lastWeek.tokens).toBe(1_000);
    expect(digest.thisWeek.tokens).toBe(2_000);
  });
});

describe("weeklyDigest · 两周读数", () => {
  it("prices each week model by model and counts sessions plus messages once per week", () => {
    const digest = buildWeeklyDigest(
      [
        inputOf(
          // 本周：sonnet 1M 输入 = $3，haiku 1M 输出 = $5。
          recordOf(at(2026, 10, 20, 9), { model: "claude-sonnet-4-5", usage: { inputTokens: 1_000_000 } }),
          recordOf(at(2026, 10, 20, 10), { model: "claude-haiku-4-5", usage: { outputTokens: 1_000_000 } }),
          recordOf(at(2026, 10, 20, 11), { kind: "user" }),
          recordOf(at(2026, 10, 20, 11), { kind: "tool" })
        ),
        // 上周：同一个会话也说过话 → 两周各记一次会话。
        inputOf(recordOf(at(2026, 10, 13, 9), { kind: "user" }))
      ],
      NOW
    );

    expect(digest.thisWeek.tokens).toBe(2_000_000);
    expect(digest.thisWeek.usd).toBeCloseTo(8, 12);
    expect(digest.thisWeek.sessions).toBe(1);
    // 只数 user / assistant：tool 记录不是「消息」。
    expect(digest.thisWeek.messages).toBe(3);
    expect(digest.lastWeek.tokens).toBe(0);
    expect(digest.lastWeek.usd).toBe(0);
    expect(digest.lastWeek.sessions).toBe(1);
    expect(digest.lastWeek.messages).toBe(1);
  });

  it("counts one session in both weeks when it kept talking across the boundary", () => {
    const digest = buildWeeklyDigest(
      [
        inputOf(
          recordOf(at(2026, 10, 18, 23), { kind: "user" }),
          recordOf(at(2026, 10, 19, 1), { kind: "user" })
        )
      ],
      NOW
    );
    expect(digest.lastWeek.sessions).toBe(1);
    expect(digest.thisWeek.sessions).toBe(1);
  });

  it("keeps the tokens of an unpriced model but reports the week's USD as unknown", () => {
    const digest = buildWeeklyDigest(
      [
        inputOf(
          recordOf(at(2026, 10, 20, 9), { model: "claude-sonnet-4-5", usage: { inputTokens: 1_000_000 } }),
          recordOf(at(2026, 10, 20, 10), { model: "gemini-3-pro", usage: { inputTokens: 500_000 } })
        )
      ],
      NOW
    );

    // token 照算——少算一半输入比不给金额更糟。
    expect(digest.thisWeek.tokens).toBe(1_500_000);
    // 但金额整体未知：$3 + 未知不能写成 $3。
    expect(digest.thisWeek.usd).toBeNull();
    // 两侧有一侧未知，环比也就没有意义。
    expect(digest.deltas.usd).toBeNull();
  });

  it("excludes compact summaries from the message count", () => {
    const digest = buildWeeklyDigest(
      [
        inputOf(
          recordOf(at(2026, 10, 20, 9), { kind: "user" }),
          recordOf(at(2026, 10, 20, 10), { kind: "user", compactSummary: true })
        )
      ],
      NOW
    );
    expect(digest.thisWeek.messages).toBe(1);
  });
});

describe("weeklyDigest · 环比与空态", () => {
  it("computes percent deltas against last week", () => {
    const digest = buildWeeklyDigest(
      [
        inputOf(
          recordOf(at(2026, 10, 20, 9), { model: "claude-sonnet-4-5", usage: { inputTokens: 3_000_000 } }),
          recordOf(at(2026, 10, 13, 9), { model: "claude-sonnet-4-5", usage: { inputTokens: 2_000_000 } })
        )
      ],
      NOW
    );
    // 3M vs 2M token，$9 vs $6：都是 +50%。
    expect(digest.deltas.tokens).toBeCloseTo(50, 12);
    expect(digest.deltas.usd).toBeCloseTo(50, 12);
    expect(digest.deltas.messages).toBeCloseTo(0, 12);
  });

  it("returns null deltas instead of a fabricated percentage when there is no baseline", () => {
    const digest = buildWeeklyDigest(
      [inputOf(recordOf(at(2026, 10, 20, 9), { kind: "user" }))],
      NOW
    );
    // 上周全 0：没有基线就没有百分比（不是 +100%）。
    expect(digest.deltas.tokens).toBeNull();
    expect(digest.deltas.messages).toBeNull();
    expect(digest.deltas.sessions).toBeNull();
  });

  it("reports an empty digest as empty rather than as four zeroes", () => {
    const digest = buildWeeklyDigest([], NOW);
    expect(digest.thisWeek).toEqual({ tokens: 0, usd: 0, sessions: 0, messages: 0 });
    expect(digest.lastWeek).toEqual({ tokens: 0, usd: 0, sessions: 0, messages: 0 });
    expect(digest.deltas).toEqual({ tokens: null, usd: null, sessions: null, messages: null });
    expect(isEmptyDigest(digest)).toBe(true);
  });

  it("is not empty once either week carried usage", () => {
    const digest = buildWeeklyDigest(
      [inputOf(recordOf(at(2026, 10, 13, 9), { usage: { inputTokens: 900 } }))],
      NOW
    );
    expect(isEmptyDigest(digest)).toBe(false);
  });
});
