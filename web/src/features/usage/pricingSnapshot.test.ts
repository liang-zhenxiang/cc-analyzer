import { describe, expect, it } from "vitest";
import {
  estimateCost,
  MODEL_PRICING,
  PRICING_AS_OF,
  pricingFamilyFor,
  type CostEstimate
} from "./pricingSnapshot";

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
});
