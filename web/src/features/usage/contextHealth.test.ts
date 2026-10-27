import { describe, expect, it } from "vitest";
import {
  buildContextHealth,
  COMPACT_PENALTY_PER_EVENT,
  DEFAULT_CONTEXT_THRESHOLD,
  HEALTHY_SCORE,
  MAX_PENALTY,
  TIGHT_SCORE
} from "./contextHealth";
import type { ContextSample } from "../sessions/types";

function sample(contextTokens: number, index = 0): ContextSample {
  return {
    uuid: `s${index}`,
    timestamp: 1_700_000_000_000 + index,
    contextTokens,
    outputTokens: 0,
    model: "claude-sonnet-4-5"
  };
}

function samples(...tokens: readonly number[]): ContextSample[] {
  return tokens.map((value, index) => sample(value, index));
}

describe("buildContextHealth", () => {
  it("reports 无数据 with a null score when there are no samples", () => {
    expect(buildContextHealth([], 3, 2)).toEqual({
      score: null,
      grade: "无数据",
      summary: "没有上下文读数"
    });
  });

  it("scores a quarter-full context as 75 (healthy boundary)", () => {
    const health = buildContextHealth(samples(50_000, 50_000, 50_000), 0, 0);
    expect(health.score).toBe(75);
    expect(health.grade).toBe("健康");
    expect(health.summary).toBe("平均水位 25%，压缩 0 次，出血 0 处——健康，余量充足");
    expect(HEALTHY_SCORE).toBe(75);
  });

  it("scores 74 as 偏紧 (just under the healthy line)", () => {
    const health = buildContextHealth(samples(52_000, 52_000, 52_000), 0, 0);
    expect(health.score).toBe(74);
    expect(health.grade).toBe("偏紧");
  });

  it("keeps 50 as 偏紧 and 49 as 紧张", () => {
    expect(buildContextHealth(samples(100_000), 0, 0)).toMatchObject({ score: 50, grade: "偏紧" });
    expect(buildContextHealth(samples(102_000), 0, 0)).toMatchObject({ score: 49, grade: "紧张" });
    expect(TIGHT_SCORE).toBe(50);
  });

  it("subtracts compaction and bleed penalties per event", () => {
    const health = buildContextHealth(samples(50_000), 3, 1);
    expect(COMPACT_PENALTY_PER_EVENT).toBe(6);
    expect(health.score).toBe(75 - 18 - 10);
    expect(health.grade).toBe("紧张");
    expect(health.summary).toBe("平均水位 25%，压缩 3 次，出血 1 处——紧张，建议尽快清理或收尾");
  });

  it("caps each penalty at 30 even with many events", () => {
    // 水位为 0（ratio 1 → 0 分），压缩封顶 30、出血封顶 30 → 分数夹到 0。
    expect(MAX_PENALTY).toBe(30);
    const health = buildContextHealth(samples(200_000), 10, 5);
    expect(health.score).toBe(0);
    expect(health.grade).toBe("紧张");

    // 单侧封顶：满水位 100 − 压缩 30 = 70。
    expect(buildContextHealth(samples(0), 10, 0).score).toBe(70);
  });

  it("clamps the per-sample ratio to [0, 1]", () => {
    expect(buildContextHealth(samples(500_000), 0, 0).score).toBe(0);
    expect(buildContextHealth(samples(0), 0, 0).score).toBe(100);
  });

  it("honours an explicit threshold", () => {
    expect(buildContextHealth(samples(50_000), 0, 0, 100_000)).toMatchObject({
      score: 50,
      grade: "偏紧"
    });
    expect(DEFAULT_CONTEXT_THRESHOLD).toBe(200_000);
  });

  it("falls back to the default threshold when the argument is unusable", () => {
    expect(buildContextHealth(samples(50_000), 0, 0, 0).score).toBe(75);
    expect(buildContextHealth(samples(50_000), 0, 0, Number.NaN).score).toBe(75);
  });

  it("skips non-finite samples instead of counting them as 0% water", () => {
    const health = buildContextHealth([sample(Number.NaN), sample(50_000, 1)], 0, 0);
    expect(health.score).toBe(75);

    expect(buildContextHealth([sample(Number.NaN)], 0, 0).grade).toBe("无数据");
  });

  it("builds the summary from the actual values", () => {
    const health = buildContextHealth(samples(124_000), 3, 1);
    expect(health.summary).toBe("平均水位 62%，压缩 3 次，出血 1 处——紧张，建议尽快清理或收尾");
    expect(health.score).toBe(100 - 62 - 18 - 10);
  });

  it("floors fractional counts", () => {
    const health = buildContextHealth(samples(50_000), 2.9, 1.9);
    expect(health.score).toBe(75 - 12 - 10);
    expect(health.summary).toContain("压缩 2 次，出血 1 处");
  });
});
