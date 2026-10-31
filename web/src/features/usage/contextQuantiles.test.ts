import { describe, expect, it } from "vitest";
import { contextQuantiles } from "./contextQuantiles";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

const BASE = new Date(2026, 9, 10, 9, 0).getTime();
const MIN = 60_000;

let seq = 0;
function record(at: number, contextTokens?: number): SessionRecord {
  seq += 1;
  const usage: SessionUsage | undefined =
    contextTokens === undefined
      ? undefined
      : { inputTokens: contextTokens, cacheReadTokens: 0, cacheCreationTokens: 0 };
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    usage
  };
}

/** 峰值 = usage 的 input（这里的 fixture 只填 input，cache 系为 0）。 */
function sessionAt(peak: number, at = BASE): UsageSessionInput {
  // 峰值只有一条记录时就是它；多条时留一条小的作对照。
  return {
    projectLabel: "p",
    records: peak > 0 ? [record(at, peak), record(at + MIN, 1)] : [record(at)]
  };
}

describe("contextQuantiles", () => {
  it("空输入 → 全 null，count 0", () => {
    expect(contextQuantiles([])).toEqual({
      p50: null,
      p75: null,
      p90: null,
      p99: null,
      max: null,
      count: 0
    });
  });

  it("单会话（样本不足）→ 全 null，count 1", () => {
    const result = contextQuantiles([sessionAt(50_000)]);
    expect(result.p50).toBeNull();
    expect(result.p99).toBeNull();
    expect(result.max).toBeNull();
    expect(result.count).toBe(1);
  });

  it("两会话：p50/p75/p90/p99 按最近邻取真实样本", () => {
    // 样本 [10_000, 20_000]：ceil(0.5*2)=1 → p50=10_000；ceil(0.75*2)=2 → 20_000；
    // ceil(0.9*2)=2；ceil(0.99*2)=2。
    const result = contextQuantiles([sessionAt(10_000), sessionAt(20_000)]);
    expect(result.p50).toBe(10_000);
    expect(result.p75).toBe(20_000);
    expect(result.p90).toBe(20_000);
    expect(result.p99).toBe(20_000);
    expect(result.max).toBe(20_000);
    expect(result.count).toBe(2);
  });

  it("四会话手算对照：每个分位都是样本里真实出现过的值", () => {
    // 样本升序 [100, 200, 300, 400]（×1000）。
    // p50: ceil(2)=2 → 200；p75: ceil(3)=3 → 300；p90: ceil(3.6)=4 → 400；p99: ceil(3.96)=4 → 400。
    const result = contextQuantiles([
      sessionAt(300_000),
      sessionAt(100_000),
      sessionAt(400_000),
      sessionAt(200_000)
    ]);
    expect(result.p50).toBe(200_000);
    expect(result.p75).toBe(300_000);
    expect(result.p90).toBe(400_000);
    expect(result.p99).toBe(400_000);
    expect(result.max).toBe(400_000);
  });

  it("会话内多记录取 max 而不是求和（与 contextSeries 的 contextTokens 单值同源）", () => {
    const session: UsageSessionInput = {
      projectLabel: "p",
      records: [record(BASE, 30_000), record(BASE + MIN, 90_000), record(BASE + 2 * MIN, 10_000)]
    };
    const result = contextQuantiles([session, sessionAt(50_000)]);
    // 样本 [90_000, 50_000] → p50 = 50_000（排序后 [50_000, 90_000]，ceil(1)=1）。
    expect(result.p50).toBe(50_000);
    expect(result.max).toBe(90_000);
  });

  it("contextTokens = input + cacheCreation + cacheRead（cache 系计入峰值）", () => {
    const session: UsageSessionInput = {
      projectLabel: "p",
      records: [
        {
          ...record(BASE),
          usage: { inputTokens: 10_000, cacheCreationTokens: 50_000, cacheReadTokens: 40_000 }
        }
      ]
    };
    const result = contextQuantiles([session, sessionAt(1_000)]);
    expect(result.max).toBe(100_000);
  });

  it("无 usage 的会话峰值为 0，照常计数", () => {
    const bare: UsageSessionInput = { projectLabel: "bare", records: [record(BASE)] };
    const result = contextQuantiles([bare, sessionAt(5_000)]);
    expect(result.count).toBe(2);
    expect(result.p50).toBe(0);
    expect(result.max).toBe(5_000);
  });
});
