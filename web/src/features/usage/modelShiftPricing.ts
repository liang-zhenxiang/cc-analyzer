import type { UsageSessionInput, UsageTotals } from "./usageAggregations";
import { estimateCost, MODEL_PRICING, type CostEstimate, type ModelFamily } from "./pricingSnapshot";

/**
 * 换模计价（D3）：同一批 records 里出现过 ≥2 个不同 model id 的会话，按
 * 「换成目标模型 X 重算一遍成本」给出对照——回答「如果这批活交给 opus 干，
 * 账单会是多少」。
 *
 * 计价口径只有一条：`pricingSnapshot.estimateCost`（全项目唯一计价口径，
 * 绝不自建价格表）。actualUsd 用原模型的 family 价，shiftedUsd 把同一组
 * 四计数器按目标 family 重乘一遍——token 数不变，只有价换。
 *
 * unknownModel 一律转 null，绝不 0：0 是「算过了，是零」，null 是「没法算」，
 * 两者在界面上必须是两种话。目标模型遍历 PRICING 已知的三个 family 的代表
 * 模型名（从 MODEL_PRICING 的键族取现用代表字符串，见 SHIFT_TARGETS）。
 */

/** 每个 family 一个代表模型 id——`pricingFamilyFor` 只认前缀，代表名即身份。 */
export const SHIFT_TARGETS: ReadonlyArray<{ family: ModelFamily; model: string }> = [
  { family: "opus", model: "claude-opus-4-1-20250805" },
  { family: "sonnet", model: "claude-sonnet-4-5-20250929" },
  { family: "haiku", model: "claude-haiku-4-5-20251001" }
];

/** 一个源模型的换模对照行。actualUsd/shiftedUsd 里的 null = 未知模型（不可计价）。 */
export type ModelShiftRow = {
  from: string;
  records: number;
  actualUsd: number | null;
  shiftedUsd: Array<{ to: string; usd: number | null }>;
};

function usdOf(result: CostEstimate): number | null {
  return "usd" in result ? result.usd : null;
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/**
 * 换模对照（跨会话）：遍历 sessions，凡是在 records 的 models bucket 里
 * 出现的模型各算一行；只出现在一个会话里的模型也各占一行（from 分组，
 * records 计数与 aggregateSession 的 models bucket 同口径——带 usage 的
 * assistant 记录）。「同一批 records 出现 ≥2 个 model id 才展示」的门槛
 * 由视图判断，数据层照实返回所有 from 行；空输入返回空数组。known from
 * 的行里，「换到自己」那一格恒等于 actualUsd——天然的对账行，能自证
 * 口径一致。
 */
export function modelShiftBreakdown(sessions: readonly UsageSessionInput[]): ModelShiftRow[] {
  // from → { records, totals }；models bucket 的口径：record.usage 存在才入桶。
  const byModel = new Map<string, { records: number; totals: UsageTotals }>();

  for (const session of sessions) {
    for (const record of session.records) {
      const recordUsage = record.usage;
      if (!recordUsage) continue;
      const model = record.model;
      if (!model) continue;
      let bucket = byModel.get(model);
      if (!bucket) {
        bucket = { records: 0, totals: emptyTotals() };
        byModel.set(model, bucket);
      }
      bucket.records += 1;
      bucket.totals.input += recordUsage.inputTokens ?? 0;
      bucket.totals.output += recordUsage.outputTokens ?? 0;
      bucket.totals.cacheCreation += recordUsage.cacheCreationTokens ?? 0;
      bucket.totals.cacheRead += recordUsage.cacheReadTokens ?? 0;
    }
  }

  return [...byModel.entries()].map(([from, bucket]) => {
    // unknown from 模型 → 全 null（含 shiftedUsd）：换模对照的前提是有「原价」
    // 这个锚点，锚点缺失时给出「换到 opus 是 $X」反而暗示原价已知。
    const actualUsd = usdOf(estimateCost(bucket.totals, from));
    return {
      from,
      records: bucket.records,
      actualUsd,
      shiftedUsd: SHIFT_TARGETS.map(({ model }) => ({
        to: model,
        usd: actualUsd === null ? null : usdOf(estimateCost(bucket.totals, model))
      }))
    };
  });
}

// 防御性自检：SHIFT_TARGETS 必须恰好覆盖 MODEL_PRICING 的三个 family——
// 快照换 family 集合时（增删 family）这里在模块加载期就报错，而不是让
// 换模面板静默少一列。
const targetFamilies = new Set(SHIFT_TARGETS.map((target) => target.family));
for (const family of Object.keys(MODEL_PRICING) as ModelFamily[]) {
  if (!targetFamilies.has(family)) {
    throw new Error(`modelShiftPricing: SHIFT_TARGETS 缺少 family ${family} 的代表模型`);
  }
}
