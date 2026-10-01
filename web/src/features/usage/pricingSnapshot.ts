import type { UsageTotals } from "./usageAggregations";

/**
 * Offline pricing snapshot, in USD per million tokens. The whole table is
 * replaced as one unit on upgrade (new prices + new `PRICING_AS_OF` together) —
 * no partial synthesis, and never a network request from the app.
 */
export const PRICING_AS_OF = "2026-10-01";

export type ModelFamily = "opus" | "sonnet" | "haiku";

/** USD / MTok, one price per counter class. */
export type FamilyPricing = {
  input: number;
  output: number;
  /** Priced as a cache write (`cache_creation_input_tokens`). */
  cacheWrite: number;
  cacheRead: number;
};

export const MODEL_PRICING: Record<ModelFamily, FamilyPricing> = {
  opus: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  sonnet: { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 },
  haiku: { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 }
};

const FAMILY_PREFIXES: ReadonlyArray<readonly [ModelFamily, string]> = [
  ["opus", "claude-opus"],
  ["sonnet", "claude-sonnet"],
  ["haiku", "claude-haiku"]
];

/**
 * Family-prefix match: `claude-sonnet-4-5-20250929` lands in the sonnet tier.
 * Anything else (including other vendors' models) is unknown — the caller
 * must surface that, never price it at zero.
 */
export function pricingFamilyFor(model: string): ModelFamily | null {
  for (const [family, prefix] of FAMILY_PREFIXES) {
    if (model.startsWith(prefix)) return family;
  }
  return null;
}

/**
 * `Σ(tokens / 1M × price)` per counter class — each model priced at its own
 * family's rates, no "average model price" blending.
 */
export type CostEstimate = { usd: number } | { unknownModel: true };

export function estimateCost(totals: UsageTotals, model: string): CostEstimate {
  const family = pricingFamilyFor(model);
  if (!family) return { unknownModel: true };
  const pricing = MODEL_PRICING[family];
  const usd =
    (totals.input / 1_000_000) * pricing.input +
    (totals.output / 1_000_000) * pricing.output +
    (totals.cacheCreation / 1_000_000) * pricing.cacheWrite +
    (totals.cacheRead / 1_000_000) * pricing.cacheRead;
  return { usd };
}
