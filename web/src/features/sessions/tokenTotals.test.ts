import { describe, expect, it } from "vitest";
import { shareOf, splitCacheCreation, tokenTotalsOf } from "./tokenTotals";
import { costProvenanceOf } from "./costProvenance";
import type { SessionRecord, SessionUsage } from "./types";

function usageRecord(usage: SessionUsage | undefined, id = "llm-1"): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp: 0,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    usage
  };
}

describe("tokenTotalsOf", () => {
  it("keeps the four counters apart instead of folding them into one number", () => {
    const totals = tokenTotalsOf([
      usageRecord({
        inputTokens: 12,
        outputTokens: 34,
        cacheCreationTokens: 2,
        cacheReadTokens: 3
      })
    ]);

    expect(totals).toEqual({
      input: 12,
      cacheCreation: 2,
      cacheCreationFiveMinute: 2,
      cacheCreationOneHour: 0,
      cacheRead: 3,
      output: 34,
      total: 51
    });
  });

  it("attributes cache writes with no TTL breakdown to the 5-minute tier", () => {
    // Upstream omits `cache_creation.ephemeral_*` on some calls; the residual has
    // to land somewhere, and 5 minutes is the API default. The invariant that
    // matters is that the two tiers still add up to the row above them.
    const totals = tokenTotalsOf([
      usageRecord({ inputTokens: 200, outputTokens: 60, cacheCreationTokens: 500, cacheReadTokens: 30000 })
    ]);

    expect(totals.cacheCreationFiveMinute).toBe(500);
    expect(totals.cacheCreationOneHour).toBe(0);
    expect(totals.cacheCreationFiveMinute + totals.cacheCreationOneHour).toBe(
      totals.cacheCreation
    );
  });

  it("adds the TTL split up to the cache-creation total when both are present", () => {
    const totals = tokenTotalsOf([
      usageRecord({
        cacheCreationTokens: 1000,
        cacheCreationFiveMinuteTokens: 600,
        cacheCreationOneHourTokens: 400
      })
    ]);

    expect(totals.cacheCreationFiveMinute).toBe(600);
    expect(totals.cacheCreationOneHour).toBe(400);
  });

  it("treats a missing cache counter as zero, never as unknown", () => {
    const totals = tokenTotalsOf([usageRecord({ inputTokens: 30, outputTokens: 10 })]);

    expect(totals.cacheCreation).toBe(0);
    expect(totals.cacheRead).toBe(0);
    expect(totals.total).toBe(40);
  });

  it("ignores records without usage and reports an empty session as all zeros", () => {
    const user: SessionRecord = {
      id: "user-1",
      fullId: "user-1",
      kind: "user",
      timestamp: 0,
      durationMs: 0,
      text: "hi",
      isError: false,
      raw: {}
    };

    const totals = tokenTotalsOf([user, usageRecord(undefined)]);

    expect(totals.total).toBe(0);
    expect(shareOf(totals.input, totals)).toBeNull();
    expect(costProvenanceOf(totals).reason).toBe("本次会话没有 token 记录");
  });

  it("keeps the cache-read share honest on a real-shaped session", () => {
    // The shape that motivated the panel: 50000 of 51950 tokens are cache reads,
    // so a merged "input" would print ~98% of the session under one wrong name.
    const totals = tokenTotalsOf([
      usageRecord({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationTokens: 1000,
        cacheCreationFiveMinuteTokens: 600,
        cacheCreationOneHourTokens: 400,
        cacheReadTokens: 20000
      }),
      usageRecord({
        inputTokens: 200,
        outputTokens: 60,
        cacheCreationTokens: 500,
        cacheReadTokens: 30000
      }),
      usageRecord({ inputTokens: 30, outputTokens: 10 })
    ]);

    expect(totals).toEqual({
      input: 330,
      cacheCreation: 1500,
      cacheCreationFiveMinute: 1100,
      cacheCreationOneHour: 400,
      cacheRead: 50000,
      output: 120,
      total: 51950
    });
    expect(shareOf(totals.cacheRead, totals)).toBeCloseTo(96.25, 2);
    expect(shareOf(totals.input, totals)).toBeCloseTo(0.635, 3);
  });
});

describe("splitCacheCreation", () => {
  it("never lets a cache write fall out of the split", () => {
    // A split that accounts for less than the total (upstream under-reports the
    // tiers) must not silently drop the remainder.
    expect(splitCacheCreation({ cacheCreationFiveMinuteTokens: 100 }, 400)).toEqual({
      fiveMinute: 400,
      oneHour: 0
    });
    expect(splitCacheCreation({ cacheCreationOneHourTokens: 100 }, 400)).toEqual({
      fiveMinute: 300,
      oneHour: 100
    });
  });
});

describe("costProvenanceOf", () => {
  it("says the cost is unknown rather than showing a zero", () => {
    const totals = tokenTotalsOf([usageRecord({ inputTokens: 1, outputTokens: 1 })]);

    expect(costProvenanceOf(totals)).toEqual({
      label: "成本未知",
      reason: "未收录该模型定价"
    });
  });
});
