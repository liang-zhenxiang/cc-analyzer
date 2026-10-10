import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { BILLING_WINDOW_MS, clusterBillingBlocks, currentBlock } from "./billingWindow";
import { totalsSum, type UsageSessionInput } from "./usageAggregations";
import { weeklyWindow } from "./weeklyWindow";
import { buildTrayReadout, recentSessionsFor, TRAY_LOOKBACK_MS } from "./quotaReadout";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date(2026, 9, 2, 12, 0, 0).getTime();

const NO_PLAN = { id: "none" as const, limitTokens: null, weeklyLimitTokens: null };

function meta(path: string, mtimeMs: number): SessionMeta {
  return { path, projectLabel: "repo-demo", mtimeMs, sizeBytes: 10, hasRecords: true };
}

function rec(at: number, tokens = 1_000): SessionRecord {
  return {
    id: `r-${at}`,
    kind: "assistant",
    timestamp: at,
    usage: {
      inputTokens: tokens,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0
    }
  } as unknown as SessionRecord;
}

function input(records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "repo-demo" };
}

describe("recentSessionsFor", () => {
  it("收窄窗口是 5h 与 14d 的并集（5h 是子集）", () => {
    expect(TRAY_LOOKBACK_MS).toBeGreaterThan(BILLING_WINDOW_MS);
    expect(TRAY_LOOKBACK_MS).toBe(14 * DAY);
  });

  it("边界含在内：正好 now−5h / now−14d 的会话都要收进来", () => {
    const sessions = [
      meta("/now.jsonl", NOW),
      meta("/five-hours.jsonl", NOW - 5 * HOUR),
      meta("/just-over-five-hours.jsonl", NOW - 5 * HOUR - 1),
      meta("/fourteen-days.jsonl", NOW - 14 * DAY),
      meta("/older-than-fourteen-days.jsonl", NOW - 14 * DAY - 1)
    ];

    const kept = recentSessionsFor(sessions, NOW).map((session) => session.path);

    expect(kept).toEqual([
      "/now.jsonl",
      "/five-hours.jsonl",
      "/just-over-five-hours.jsonl",
      "/fourteen-days.jsonl"
    ]);
  });
});

describe("buildTrayReadout", () => {
  it("空输入不造读数：block 为 null、周窗口全 0、没有百分比", () => {
    const readout = buildTrayReadout([], NO_PLAN, NOW);

    expect(readout.block).toBeNull();
    expect(readout.weekly).toEqual({ usedTokens: 0, percent: null, days: 7 });
    expect(readout.computedAt).toBe(NOW);
    expect(readout.hasEstimate).toBe(false);
  });

  it("无预算：只给消耗，percent 是 null 而不是 0", () => {
    const readout = buildTrayReadout([input([rec(NOW - HOUR, 5_000)])], NO_PLAN, NOW);

    expect(readout.block?.usedTokens).toBe(5_000);
    expect(readout.block?.percent).toBeNull();
    expect(readout.weekly.usedTokens).toBe(5_000);
    expect(readout.weekly.percent).toBeNull();
    // 读数是纯日志消耗，没有任何分母 → 不保守地说是估算。
    expect(readout.hasEstimate).toBe(false);
  });

  it("有预算：percent 按分母算，超预算照实 >100", () => {
    const plan = { id: "custom" as const, limitTokens: 2_000, weeklyLimitTokens: null };
    const readout = buildTrayReadout([input([rec(NOW - HOUR, 5_000)])], plan, NOW);

    expect(readout.block?.percent).toBe(250);
    expect(readout.hasEstimate).toBe(true);
  });

  it("周预算走同一套分母逻辑", () => {
    const plan = { id: "custom" as const, limitTokens: null, weeklyLimitTokens: 10_000 };
    const readout = buildTrayReadout([input([rec(NOW - HOUR, 2_500)])], plan, NOW);

    expect(readout.block?.percent).toBeNull();
    expect(readout.weekly.percent).toBe(25);
    expect(readout.hasEstimate).toBe(true);
  });

  it("与用量页同一口径：交错排序后走同一批纯函数", () => {
    // 两个会话的 records 刻意交错：窗口是按时间排序后的全局流，不是逐会话的。
    const first = input([rec(NOW - 6 * HOUR, 1_000), rec(NOW - 2 * HOUR, 2_000)]);
    const second = input([rec(NOW - 4 * HOUR, 3_000), rec(NOW - 3 * HOUR, 4_000)]);
    const readout = buildTrayReadout([first, second], NO_PLAN, NOW);

    // 独立地照 BillingWindowCard 的组流顺序再算一遍。
    const merged = [...first.records, ...second.records].sort(
      (a, b) => a.timestamp - b.timestamp
    );
    const active = currentBlock(clusterBillingBlocks(merged), NOW);
    const week = weeklyWindow(merged, null, NOW);

    expect(active).not.toBeNull();
    expect(readout.block).toEqual({
      usedTokens: totalsSum(active!.totals),
      percent: null,
      startsAt: active!.start,
      endsAt: active!.end
    });
    expect(readout.weekly.usedTokens).toBe(totalsSum(week.consumed));
  });
});
