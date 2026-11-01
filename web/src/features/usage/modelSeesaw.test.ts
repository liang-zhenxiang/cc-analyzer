import { describe, expect, it } from "vitest";
import { modelSeesaw } from "./modelSeesaw";
import type { UsageSessionInput } from "./usageAggregations";
import type { SessionRecord, SessionUsage } from "../sessions/types";

/**
 * H6 模型跷跷板：A 兴 B 衰、互不重叠（overlap 0）、跨年月序升序、
 * 精确匹配、空输入。
 */

const OPUS = "claude-opus-4-6-20260101";
const SONNET = "claude-sonnet-4-5-20250929";

function recordOf(
  id: string,
  timestamp: number,
  model: string,
  usage: SessionUsage
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
    model,
    usage
  };
}

function at(year: number, month: number, day = 15): number {
  return new Date(year, month - 1, day, 12).getTime();
}

/** 固定「现在」：monthSpanOf 的窗口末月 = max(最后记录月, now 所在月)。
 *  取 2026-01-15：所有 fixture 的最晚记录月都 >= 2026-01，末月由记录
 *  决定（now 不拉长窗口），首末月完全确定、不随真实时钟漂移。 */
const NOW = new Date(2026, 0, 15, 12).getTime();

function seesaw(
  sessions: readonly UsageSessionInput[],
  a = OPUS,
  b = SONNET
): ReturnType<typeof modelSeesaw> {
  return modelSeesaw(sessions, a, b, NOW);
}

function inputOf(records: SessionRecord[]): UsageSessionInput {
  return { projectLabel: "-repo-demo", records };
}

describe("modelSeesaw", () => {
  it("A 兴 B 衰：逐月此消彼长，overlap = 双侧非零的月数", () => {
    const result = seesaw(
      [
        inputOf([
          recordOf("m1a", at(2026, 1), OPUS, { inputTokens: 100 }),
          recordOf("m1b", at(2026, 1), SONNET, { inputTokens: 900 }),
          recordOf("m2a", at(2026, 2), OPUS, { inputTokens: 500 }),
          recordOf("m2b", at(2026, 2), SONNET, { inputTokens: 500 }),
          recordOf("m3a", at(2026, 3), OPUS, { inputTokens: 900 }),
          recordOf("m3b", at(2026, 3), SONNET, { inputTokens: 100 }),
          recordOf("m4a", at(2026, 4), OPUS, { inputTokens: 1000 })
          // 4 月 B 无记录：独占月照样列（tokensB 0），overlap 不数它。
        ])
      ],
      OPUS,
      SONNET
    );

    expect(result.months).toHaveLength(4);
    expect(result.months.map((m) => [m.tokensA, m.tokensB])).toEqual([
      [100, 900],
      [500, 500],
      [900, 100],
      [1000, 0]
    ]);
    // 1/2/3 月双侧非零；4 月 B 归零不算 overlap。
    expect(result.overlapMonths).toBe(3);
  });

  it("互不重叠：overlap 0，独占月各列各的（迁移形状）", () => {
    const result = seesaw(
      [
        inputOf([
          recordOf("s1", at(2026, 1), SONNET, { inputTokens: 100 }),
          recordOf("s2", at(2026, 2), SONNET, { inputTokens: 200 }),
          recordOf("o1", at(2026, 4), OPUS, { inputTokens: 400 }),
          recordOf("o2", at(2026, 5), OPUS, { inputTokens: 800 })
        ])
      ],
      OPUS,
      SONNET
    );

    // 窗口 1–5 月（含 3 月空月——两侧都 0 的月保留在序列里）。
    expect(result.months.map((m) => `${m.year}-${m.month}`)).toEqual([
      "2026-1",
      "2026-2",
      "2026-3",
      "2026-4",
      "2026-5"
    ]);
    expect(result.months.map((m) => [m.tokensA, m.tokensB])).toEqual([
      [0, 100],
      [0, 200],
      [0, 0],
      [400, 0],
      [800, 0]
    ]);
    expect(result.overlapMonths).toBe(0);
  });

  it("跨年：月序升序不因年界断裂", () => {
    const result = seesaw(
      [
        inputOf([
          recordOf("old-b", at(2025, 11), SONNET, { inputTokens: 100 }),
          recordOf("old-a", at(2025, 12), OPUS, { inputTokens: 200 }),
          recordOf("new-b", at(2026, 2), SONNET, { inputTokens: 300 })
        ])
      ],
      OPUS,
      SONNET
    );

    expect(result.months.map((m) => `${m.year}-${m.month}`)).toEqual([
      "2025-11",
      "2025-12",
      "2026-1",
      "2026-2"
    ]);
    // 2025-12 双侧非零（B 11 月、A 12 月、B 2 月——12 月只有 A）。
    expect(result.months.map((m) => [m.tokensA, m.tokensB])).toEqual([
      [0, 100],
      [200, 0],
      [0, 0],
      [0, 300]
    ]);
    expect(result.overlapMonths).toBe(0);
  });

  it("模型过滤精确匹配：大小写与前缀变体都不并入", () => {
    const result = seesaw(
      [
        inputOf([
          recordOf("exact", at(2026, 1), OPUS, { inputTokens: 100 }),
          recordOf("case", at(2026, 1), OPUS.toUpperCase(), { inputTokens: 999 }),
          recordOf("prefix", at(2026, 1), `${OPUS}-preview`, { inputTokens: 999 }),
          recordOf("other", at(2026, 1), "claude-haiku-4-5-20251001", { inputTokens: 999 })
        ])
      ],
      OPUS,
      SONNET
    );

    expect(result.months).toHaveLength(1);
    expect(result.months[0].tokensA).toBe(100); // 只数精确匹配的一条
    expect(result.months[0].tokensB).toBe(0);
    expect(result.overlapMonths).toBe(0);
  });

  it("token 是 usage 四计数之和（与 aggregateRange cross 同口径）", () => {
    const result = seesaw(
      [
        inputOf([
          recordOf("fat", at(2026, 1), OPUS, {
            inputTokens: 1000,
            outputTokens: 200,
            cacheCreationTokens: 50,
            cacheReadTokens: 3000
          })
        ])
      ],
      OPUS,
      SONNET
    );
    expect(result.months[0].tokensA).toBe(4250);
  });

  it("空输入：空数组、overlap 0", () => {
    const result = seesaw([], OPUS, SONNET);
    expect(result.months).toEqual([]);
    expect(result.overlapMonths).toBe(0);
  });
});
