import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import {
  buildSandboxBaseline,
  cacheHitFloorPct,
  initialLevers,
  simulateSandbox,
  type SandboxLevers
} from "./costSandbox";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 全用本地日历构造时间：窗口边界与 `dayStartOf` 同一套算术，跑在任何时区
 * 都成立。金额取定价快照的整数值，断言到小数点后三位。
 */

const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20250929";
const OPUS = "claude-opus-4-1-20250929";

let seq = 0;

function usage(
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

function record(model: string | undefined, value: SessionUsage | undefined): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: NOW - 3_600_000,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    model,
    usage: value
  };
}

function inputsOf(records: SessionRecord[]): UsageSessionInput[] {
  return [{ records, projectLabel: "-repo-demo" }];
}

const levers = (patch: Partial<SandboxLevers> = {}): SandboxLevers => ({
  cacheHitPct: 0,
  takeoverPct: 0,
  outputCutPct: 0,
  ...patch
});

describe("buildSandboxBaseline", () => {
  it("空输入：没有调用、没有成本、没有最便宜模型", () => {
    const baseline = buildSandboxBaseline([], 30, NOW);
    expect(baseline.callsPriced).toBe(0);
    expect(baseline.callsUnpriced).toBe(0);
    expect(baseline.currentUsd).toBe(0);
    expect(baseline.currentHitRate).toBe(0);
    expect(baseline.cheapestModel).toBeNull();
    expect(baseline.cheapestLabel).toBeNull();
  });

  it("未定价模型只计数，不进入成本", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([
        record(SONNET, usage(1_000_000, 0, 0, 0)),
        record("some-other-vendor", usage(1_000_000, 0, 0, 0)),
        record(undefined, usage(1_000_000, 0, 0, 0))
      ]),
      30,
      NOW
    );
    expect(baseline.callsPriced).toBe(1);
    expect(baseline.callsUnpriced).toBe(2);
    expect(baseline.currentUsd).toBeCloseTo(3, 3);
  });

  it("命中率 = cacheRead / (cacheRead + cacheCreation)，与 input 无关", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(9_000_000, 0, 250_000, 750_000))]),
      30,
      NOW
    );
    expect(baseline.currentHitRate).toBeCloseTo(0.75, 6);
    expect(baseline.cacheableTokens).toBe(1_000_000);
    expect(baseline.cacheReadTokens).toBe(750_000);
    expect(cacheHitFloorPct(baseline)).toBe(75);
  });

  it("最便宜模型取本窗口已定价档位最低者（Haiku 优先于 Sonnet / Opus）", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([
        record(OPUS, usage(1000, 0, 0, 0)),
        record(SONNET, usage(1000, 0, 0, 0)),
        record(HAIKU, usage(1000, 0, 0, 0))
      ]),
      30,
      NOW
    );
    expect(baseline.cheapestModel).toBe(HAIKU);
    expect(baseline.cheapestLabel).toBe("Haiku 4.5");
  });

  it("窗口外的记录不参与建模", () => {
    const old = record(SONNET, usage(1_000_000, 0, 0, 0));
    old.timestamp = new Date(2026, 7, 1, 12, 0).getTime();
    const baseline = buildSandboxBaseline(inputsOf([old]), 7, NOW);
    expect(baseline.callsPriced).toBe(0);
    expect(baseline.currentUsd).toBe(0);
  });
});

describe("initialLevers / cacheHitFloorPct", () => {
  it("初始假设不是全 0：命中率 +20pp（封顶 95）、接管 25%、输出 15%", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(0, 0, 500_000, 500_000))]),
      30,
      NOW
    );
    expect(initialLevers(baseline)).toEqual({
      cacheHitPct: 70,
      takeoverPct: 25,
      outputCutPct: 15
    });
  });

  it("当前命中率已高时初始值封顶 95，下界也停在 95", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(0, 0, 10_000, 990_000))]),
      30,
      NOW
    );
    expect(initialLevers(baseline).cacheHitPct).toBe(95);
    expect(cacheHitFloorPct(baseline)).toBe(95);
  });
});

describe("simulateSandbox", () => {
  it("0 杠杆 = 现状（三个差值都是 0）", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(1_000_000, 1_000_000, 0, 0))]),
      30,
      NOW
    );
    const result = simulateSandbox(baseline, levers());
    expect(result.hypotheticalUsd).toBeCloseTo(result.currentUsd, 9);
    for (const step of result.steps) expect(step.delta).toBeCloseTo(0, 9);
  });

  it("换模 100%：Sonnet 的输入按 Haiku 计价（$3 → $1）", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([
        record(SONNET, usage(1_000_000, 0, 0, 0)),
        record(HAIKU, usage(0, 0, 0, 0))
      ]),
      30,
      NOW
    );
    const result = simulateSandbox(baseline, levers({ takeoverPct: 100 }));
    expect(result.hypotheticalUsd).toBeCloseTo(1, 3);
    const swap = result.steps.find((step) => step.key === "swap")!;
    expect(swap.delta).toBeCloseTo(-2, 3);
  });

  it("接管 0% 时换模没有作用；50% 是线性的", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([
        record(SONNET, usage(1_000_000, 0, 0, 0)),
        record(HAIKU, usage(0, 0, 0, 0))
      ]),
      30,
      NOW
    );
    expect(simulateSandbox(baseline, levers({ takeoverPct: 0 })).hypotheticalUsd).toBeCloseTo(3, 3);
    expect(simulateSandbox(baseline, levers({ takeoverPct: 50 })).hypotheticalUsd).toBeCloseTo(2, 3);
  });

  it("缓存杠杆按目标命中率重算 cacheRead 与 cacheCreation（1M 写缓存 → 50% 命中）", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(0, 0, 1_000_000, 0))]),
      30,
      NOW
    );
    expect(baseline.currentUsd).toBeCloseTo(3.75, 3);
    const result = simulateSandbox(baseline, levers({ cacheHitPct: 50 }));
    // 500k 写 × 3.75 + 500k 读 × 0.3 = 1.875 + 0.15
    expect(result.hypotheticalUsd).toBeCloseTo(2.025, 3);
  });

  it("目标命中率低于当前值时不会抬高成本（夹回当前值）", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(0, 0, 250_000, 750_000))]),
      30,
      NOW
    );
    const atCurrent = simulateSandbox(baseline, levers({ cacheHitPct: 75 }));
    const below = simulateSandbox(baseline, levers({ cacheHitPct: 0 }));
    expect(below.hypotheticalUsd).toBeCloseTo(atCurrent.hypotheticalUsd, 9);
  });

  it("当前命中率高于 95% 时保持原值，不会被封顶拉低", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(0, 0, 10_000, 990_000))]),
      30,
      NOW
    );
    const result = simulateSandbox(baseline, levers({ cacheHitPct: 95 }));
    expect(result.hypotheticalUsd).toBeCloseTo(baseline.currentUsd, 9);
  });

  it("输出削减 50%：只动 output（$15 → $7.50）", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(SONNET, usage(0, 1_000_000, 0, 0))]),
      30,
      NOW
    );
    const result = simulateSandbox(baseline, levers({ outputCutPct: 50 }));
    expect(result.hypotheticalUsd).toBeCloseTo(7.5, 3);
    const output = result.steps.find((step) => step.key === "output")!;
    expect(output.delta).toBeCloseTo(-7.5, 3);
  });

  it("杠杆越界值被夹住：接管 150% 等同 100%，输出削减 80% 等同 50%", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([
        record(SONNET, usage(1_000_000, 1_000_000, 0, 0)),
        record(HAIKU, usage(0, 0, 0, 0))
      ]),
      30,
      NOW
    );
    const clamped = simulateSandbox(
      baseline,
      levers({ takeoverPct: 150, outputCutPct: 80 })
    );
    const atLimits = simulateSandbox(
      baseline,
      levers({ takeoverPct: 100, outputCutPct: 50 })
    );
    expect(clamped.hypotheticalUsd).toBeCloseTo(atLimits.hypotheticalUsd, 9);
  });

  it("窗口里只有 Opus：最便宜的就是 Opus，换模差值为 0", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([record(OPUS, usage(1_000_000, 0, 0, 0))]),
      30,
      NOW
    );
    expect(baseline.cheapestModel).toBe(OPUS);
    const result = simulateSandbox(baseline, levers({ takeoverPct: 100 }));
    const swap = result.steps.find((step) => step.key === "swap")!;
    expect(swap.delta).toBeCloseTo(0, 9);
  });

  it("五级读数：现状 → 缓存 → 换模 → 输出 → 假设成本，顺序固定", () => {
    const baseline = buildSandboxBaseline(
      inputsOf([
        record(SONNET, usage(1_000_000, 1_000_000, 500_000, 500_000)),
        record(HAIKU, usage(100_000, 0, 0, 0))
      ]),
      30,
      NOW
    );
    const result = simulateSandbox(
      baseline,
      { cacheHitPct: 80, takeoverPct: 50, outputCutPct: 20 }
    );
    expect(result.steps.map((step) => step.key)).toEqual([
      "current",
      "cache",
      "swap",
      "output",
      "final"
    ]);
    expect(result.steps[0].usd).toBeCloseTo(baseline.currentUsd, 9);
    expect(result.steps[4].usd).toBeCloseTo(result.hypotheticalUsd, 9);
    expect(result.hypotheticalUsd).toBeLessThanOrEqual(baseline.currentUsd + 1e-9);
  });
});
