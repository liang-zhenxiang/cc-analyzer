import { describe, expect, it } from "vitest";
import {
  classRate,
  estimateCost,
  MODEL_PRICING,
  PRICING_AS_OF,
  pricingFamilyFor,
  type CostEstimate,
  type ModelFamily,
  type PricingRateKey
} from "./pricingSnapshot";

const FAMILIES: readonly ModelFamily[] = ["opus", "sonnet", "haiku"];
const RATE_KEYS: readonly PricingRateKey[] = ["input", "output", "cacheWrite", "cacheRead"];

/** One model id per family, so `estimateCost` can be driven the normal way. */
const MODEL_OF: Record<ModelFamily, string> = {
  opus: "claude-opus-4-1-20250805",
  sonnet: "claude-sonnet-4-5-20250929",
  haiku: "claude-haiku-4-5-20251001"
};

function usdOf(result: CostEstimate): number {
  if (!("usd" in result)) throw new Error("应返回估算值，而不是未知模型");
  return result.usd;
}

describe("pricingSnapshot", () => {
  it("embeds the three Claude families with all four counter prices", () => {
    expect(MODEL_PRICING.sonnet).toEqual({ input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 });
    expect(MODEL_PRICING.opus).toEqual({ input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 });
    expect(MODEL_PRICING.haiku).toEqual({ input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 });
    // The snapshot date is part of the contract — the UI shows it next to every estimate.
    expect(PRICING_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches model ids to families by prefix", () => {
    expect(pricingFamilyFor("claude-sonnet-4-5-20250929")).toBe("sonnet");
    expect(pricingFamilyFor("claude-opus-4-1-20250805")).toBe("opus");
    expect(pricingFamilyFor("claude-haiku-4-5-20251001")).toBe("haiku");
    expect(pricingFamilyFor("claude-3-5-sonnet-20241022")).toBeNull();
    expect(pricingFamilyFor("gpt-4o")).toBeNull();
    expect(pricingFamilyFor("")).toBeNull();
  });

  it("prices each counter class at its own rate", () => {
    // 2M input × $3 + 1M output × $15 + 4M cache writes × $3.75 + 10M cache reads × $0.3 = $39
    const result = estimateCost(
      { input: 2_000_000, output: 1_000_000, cacheCreation: 4_000_000, cacheRead: 10_000_000 },
      "claude-sonnet-4-5-20250929"
    );
    expect(usdOf(result)).toBeCloseTo(39, 6);
  });

  it("prices opus at the opus tier", () => {
    const result = estimateCost(
      { input: 1_000_000, output: 1_000_000, cacheCreation: 0, cacheRead: 0 },
      "claude-opus-4-6"
    );
    expect(usdOf(result)).toBeCloseTo(90, 6);
  });

  it("prices haiku at the haiku tier", () => {
    const result = estimateCost(
      { input: 0, output: 0, cacheCreation: 2_000_000, cacheRead: 0 },
      "claude-haiku-4-5-20251001"
    );
    expect(usdOf(result)).toBeCloseTo(2.5, 6);
  });

  it("never prices an unknown model as zero", () => {
    const result = estimateCost(
      { input: 9_000_000, output: 9_000_000, cacheCreation: 9_000_000, cacheRead: 9_000_000 },
      "gemini-3-pro"
    );
    expect(result).toEqual({ unknownModel: true });
  });

  it("returns a known zero for a zero-usage known model", () => {
    const result = estimateCost(
      { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      "claude-haiku-4-5"
    );
    expect(result).toEqual({ usd: 0 });
  });

  // 口径 1（会话账单 PRD）：单价只有一个来源。这张表就是它——`classRate` 必须
  // 逐项等于表里的值，不能自己算、也不能有第二张表。
  it("classRate reads every family × class straight from MODEL_PRICING", () => {
    for (const family of FAMILIES) {
      for (const key of RATE_KEYS) {
        expect(classRate(family, key)).toBe(MODEL_PRICING[family][key]);
      }
    }
    // 快照值本身也要钉住：表被整体替换时这里必须有人先看见金额变了。
    expect(classRate("sonnet", "cacheRead")).toBe(0.3);
    expect(classRate("opus", "cacheWrite")).toBe(18.75);
    expect(classRate("haiku", "output")).toBe(5);
  });

  // 等价性：`estimateCost` 改成走 `classRate` 之后，数值必须与「手写四类乘加」
  // 一致到 1e-12。它另有 usageCalendar / usageSnapshot / UsageOverviewPage /
  // exportHtml 四处调用方，任何一位的漂移都是线上金额的漂移。
  it("estimateCost matches a hand-written four-class sum to 1e-12", () => {
    // 三个 family × 五组 token：全 0、单类、典型的缓存重读、六位数大值、
    // 刻意不对齐的非整数（避免「整除掩盖舍入」）。
    const tokenSets = [
      { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
      { input: 1_000_000, output: 0, cacheCreation: 0, cacheRead: 0 },
      { input: 2_000_000, output: 1_000_000, cacheCreation: 4_000_000, cacheRead: 10_000_000 },
      { input: 167_412, output: 38_997, cacheCreation: 51_003, cacheRead: 1_204_889 },
      { input: 987_654_321, output: 12_345_678, cacheCreation: 3_210_987, cacheRead: 4_567_890_123 }
    ];

    for (const family of FAMILIES) {
      for (const totals of tokenSets) {
        const expected =
          (totals.input / 1_000_000) * classRate(family, "input") +
          (totals.output / 1_000_000) * classRate(family, "output") +
          (totals.cacheCreation / 1_000_000) * classRate(family, "cacheWrite") +
          (totals.cacheRead / 1_000_000) * classRate(family, "cacheRead");

        const actual = usdOf(estimateCost(totals, MODEL_OF[family]));
        expect(actual).toBeCloseTo(expected, 12);

        // 同一组 token 用模型名之外的家族名走一遍也一致：定价只认 family，
        // 不认具体版本号（版本号换不了价，换价只能换整张快照）。
        expect(pricingFamilyFor(MODEL_OF[family])).toBe(family);
      }
    }
  });
});
