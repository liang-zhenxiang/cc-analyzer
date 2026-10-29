import { formatModelId } from "../../lib/format";
import {
  addLocalDays,
  dayStartOf,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";
import { estimateCost, pricingFamilyFor, type ModelFamily } from "./pricingSnapshot";

/**
 * 成本沙盘（Round FF F4）的纯逻辑。
 *
 * **只模拟，不写回任何设置。** 三个杠杆按固定顺序叠加（顺序会改变乘法结果，
 * 所以写死）：缓存命中率 → 便宜模型接管比例 → 输出削减。
 *
 * 口径：
 * - 只对**已定价**的调用建模；未定价模型的调用报数，不摊到别的调用上。
 * - 「缓存命中率」= cacheRead / (cacheRead + cacheCreation)：两者是同一批可缓存
 *   prompt 的读/写两面，把命中率提上去就是把 cacheCreation 挪进 cacheRead，
 *   input / output 不动（与脚注「重算 cacheRead 与 cacheCreation」一致）。
 * - 「换模」按本窗口**最便宜的已定价模型**折算；窗口里只有 Opus 时最便宜的就是
 *   Opus，这一杆的差值因此可以是 0——那不是坏了，是窗口里没有更便宜的模型。
 * - 差值用正数表示「比上一级少了多少」；沙盘不承诺任何节约，全部是估算。
 */

export type SandboxLevers = {
  /** 目标缓存命中率（百分数，下界 = 当前命中率）。 */
  cacheHitPct: number;
  /** 便宜模型接管比例（百分数 0–100）。 */
  takeoverPct: number;
  /** 输出削减比例（百分数 0–50）。 */
  outputCutPct: number;
};

export type SandboxCall = {
  /** 该次调用的四类 token（已按记录自身模型定价）。 */
  totals: UsageTotals;
  model: string;
};

export type SandboxBaseline = {
  /** 现状估算成本（只含已定价调用）。 */
  currentUsd: number;
  callsPriced: number;
  callsUnpriced: number;
  /** cacheRead + cacheCreation（命中率的分母）。 */
  cacheableTokens: number;
  cacheReadTokens: number;
  /** 0–1；没有可缓存 token 时为 0。 */
  currentHitRate: number;
  /** 本窗口最便宜的已定价模型 id；没有已定价调用时为 null。 */
  cheapestModel: string | null;
  cheapestLabel: string | null;
  /** 已定价调用的逐条事实（模拟的唯一输入）。 */
  calls: readonly SandboxCall[];
};

export type SandboxStepKey = "current" | "cache" | "swap" | "output" | "final";

export type SandboxStep = {
  key: SandboxStepKey;
  label: string;
  /** 这一级的累计成本（瀑布柱顶 / 柱底）。 */
  usd: number;
  /** 相对上一级的变化（负数 = 更便宜）。 */
  delta: number;
};

export type SandboxResult = {
  currentUsd: number;
  hypotheticalUsd: number;
  steps: SandboxStep[];
};

const FAMILY_RANK: Record<ModelFamily, number> = { haiku: 0, sonnet: 1, opus: 2 };
export const MAX_CACHE_HIT_PCT = 95;
export const MAX_TAKEOVER_PCT = 100;
export const MAX_OUTPUT_CUT_PCT = 50;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function totalsOf(usage: NonNullable<UsageSessionInput["records"][number]["usage"]>): UsageTotals {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
}

function windowStartOf(days: number, now: number): number {
  const windowDays = Math.max(1, Math.floor(days));
  return addLocalDays(dayStartOf(now), -(windowDays - 1));
}

/** 收集窗口内可建模的调用事实。未定价与无 model 的记录只计数。 */
export function buildSandboxBaseline(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): SandboxBaseline {
  const startTs = windowStartOf(days, now);
  const calls: SandboxCall[] = [];
  const families = new Map<string, ModelFamily>();
  let callsUnpriced = 0;
  let cacheableTokens = 0;
  let cacheReadTokens = 0;
  let currentUsd = 0;

  for (const input of inputs) {
    for (const record of input.records) {
      const usage = record.usage;
      if (!usage) continue;
      if (record.timestamp < startTs) continue;
      const model = record.model;
      const family = model ? pricingFamilyFor(model) : null;
      if (!model || family === null) {
        callsUnpriced += 1;
        continue;
      }
      const totals = totalsOf(usage);
      const estimate = estimateCost(totals, model);
      if ("unknownModel" in estimate) {
        callsUnpriced += 1;
        continue;
      }
      calls.push({ totals, model });
      families.set(model, family);
      currentUsd += estimate.usd;
      cacheableTokens += totals.cacheCreation + totals.cacheRead;
      cacheReadTokens += totals.cacheRead;
    }
  }

  // 最便宜 = 定价档最低；同档内按模型 id 稳定排序（两个快照价格相同）。
  let cheapestModel: string | null = null;
  for (const [model, family] of families) {
    if (
      cheapestModel === null ||
      FAMILY_RANK[family] < FAMILY_RANK[families.get(cheapestModel)!] ||
      (FAMILY_RANK[family] === FAMILY_RANK[families.get(cheapestModel)!] &&
        model.localeCompare(cheapestModel) < 0)
    ) {
      cheapestModel = model;
    }
  }

  return {
    currentUsd,
    callsPriced: calls.length,
    callsUnpriced,
    cacheableTokens,
    cacheReadTokens,
    currentHitRate: cacheableTokens > 0 ? cacheReadTokens / cacheableTokens : 0,
    cheapestModel,
    cheapestLabel: cheapestModel === null ? null : formatModelId(cheapestModel),
    calls
  };
}

/** 初始假设：命中率 +20pp（封顶 95%）、接管 25%、输出削减 15%。不是全 0。 */
export function initialLevers(baseline: SandboxBaseline): SandboxLevers {
  const currentPct = Math.round(baseline.currentHitRate * 100);
  return {
    cacheHitPct: Math.min(MAX_CACHE_HIT_PCT, currentPct + 20),
    takeoverPct: 25,
    outputCutPct: 15
  };
}

/** 命中率滑杆的下界（百分数，向上取整，避免初始值落在范围外）。 */
export function cacheHitFloorPct(baseline: SandboxBaseline): number {
  return Math.min(MAX_CACHE_HIT_PCT, Math.ceil(baseline.currentHitRate * 100));
}

function adjustedForCache(
  call: SandboxCall,
  targetHit: number,
  currentHit: number
): UsageTotals {
  const cacheable = call.totals.cacheCreation + call.totals.cacheRead;
  // 目标不超过当前值时原样返回：否则四舍五入到 token 会产生 1 token 的假差值。
  if (cacheable <= 0 || targetHit <= currentHit + 1e-9) return call.totals;
  const newRead = Math.round(targetHit * cacheable);
  return {
    input: call.totals.input,
    output: call.totals.output,
    cacheCreation: cacheable - newRead,
    cacheRead: newRead
  };
}

function pricedUsd(totals: UsageTotals, model: string): number {
  const estimate = estimateCost(totals, model);
  return "unknownModel" in estimate ? 0 : estimate.usd;
}

/**
 * 按固定顺序推演。杠杆值会被夹到合法区间（命中率不低于当前命中率、不超过
 * 95%；接管 0–100%；输出削减 0–50%）——组件已经限了范围，纯函数仍自己兜底，
 * 因为手造输入与将来的调用方不该能造出负成本。
 */
export function simulateSandbox(
  baseline: SandboxBaseline,
  levers: SandboxLevers
): SandboxResult {
  const requestedHit = clamp(levers.cacheHitPct / 100, 0, 1);
  // 目标永远不低于当前命中率；当前已高于 95% 时保持原值（那一杆在界面上禁用）。
  const effectiveHit = Math.max(
    baseline.currentHitRate,
    Math.min(requestedHit, MAX_CACHE_HIT_PCT / 100)
  );
  const share = clamp(levers.takeoverPct / 100, 0, 1);
  const cut = clamp(levers.outputCutPct / 100, 0, MAX_OUTPUT_CUT_PCT / 100);
  const cheapest = baseline.cheapestModel;

  let afterCache = 0;
  let afterSwap = 0;
  let afterOutput = 0;

  for (const call of baseline.calls) {
    const cached = adjustedForCache(call, effectiveHit, baseline.currentHitRate);
    const atOriginal = pricedUsd(cached, call.model);
    const atCheapest = cheapest === null ? atOriginal : pricedUsd(cached, cheapest);

    afterCache += atOriginal;
    afterSwap += (1 - share) * atOriginal + share * atCheapest;

    const cutTotals: UsageTotals = { ...cached, output: cached.output * (1 - cut) };
    const cutOriginal = pricedUsd(cutTotals, call.model);
    const cutCheapest = cheapest === null ? cutOriginal : pricedUsd(cutTotals, cheapest);
    afterOutput += (1 - share) * cutOriginal + share * cutCheapest;
  }

  const steps: SandboxStep[] = [
    { key: "current", label: "现状", usd: baseline.currentUsd, delta: 0 },
    { key: "cache", label: "缓存", usd: afterCache, delta: afterCache - baseline.currentUsd },
    { key: "swap", label: "换模", usd: afterSwap, delta: afterSwap - afterCache },
    { key: "output", label: "输出", usd: afterOutput, delta: afterOutput - afterSwap },
    { key: "final", label: "假设成本", usd: afterOutput, delta: afterOutput - baseline.currentUsd }
  ];

  return {
    currentUsd: baseline.currentUsd,
    hypotheticalUsd: afterOutput,
    steps
  };
}
