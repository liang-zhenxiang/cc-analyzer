import { monthKeyOf, monthSpanOf, type MonthKey } from "./monthlyReport";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 模型跷跷板（H6）：两个模型逐月 token 的「此消彼长」对照。
 *
 * 口径与为什么：
 * - 月几何用 `monthSpanOf`（自然月、本地时区、含中间空月）——与 G4 月报
 *   / G6 工具月历 / G8 项目季节共用同一条窗口规则，四张视图的首末月永远
 *   对齐（单一来源，不另造月几何）；
 * - tokens 按 usage 四计数之和（与 aggregateRange 的 cross 口径一致：
 *   只数带 usage 的记录，input + output + cacheCreation + cacheRead，
 *   缺计数按 0）；
 * - model 字符串精确匹配（大小写敏感）：模型 id 是稳定标识，模糊匹配
 *   会把 sonnet-4 与 sonnet-4-5 混进同一侧，跷跷板就失真了；调用方传
 *   censusKeyId 形状的模型名（与其他模型视图同一来源）；
 * - overlapMonths = 两侧都有 token 的月数：这是「同期对比」的样本量——
 *   两侧都非零才构成一个月的可比样本；
 * - 单模型独占的月照样列（另一侧 0）：这是「此消彼长」要显示的形状
 *   （切换迁移期正是一侧归零、另一侧起量的月）；
 * - 只收 A/B 的记录，其他模型的记录不进任何一侧也不影响窗口（窗口由
 *   全部 records 定义，monthSpanOf 的既有口径）。
 */

/** 一个自然月的双模型对照。 */
export type SeesawMonth = {
  year: number;
  /** 1–12。 */
  month: number;
  /** 模型 A 该月 token（四计数之和；无记录 0）。 */
  tokensA: number;
  /** 模型 B 该月 token。 */
  tokensB: number;
};

/** 跷跷板读数：逐月序列（升序，含空月）+ 双侧非零的重叠月数。 */
export type ModelSeesaw = {
  months: SeesawMonth[];
  /** 两侧都 >0 的月数（同期对比样本量）。 */
  overlapMonths: number;
};

/** 一条记录的双计数器（四计数之和，缺计数按 0——与 addUsage 同款）。 */
function usageSum(usage: {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

/** 逐月累加一个模型的 token（只数 model 精确匹配且带 usage 的记录）。 */
function accumulate(
  months: Map<number, { year: number; month: number; tokens: number }>,
  model: string,
  sessions: readonly UsageSessionInput[]
): void {
  for (const session of sessions) {
    for (const record of session.records) {
      if (record.model !== model || !record.usage) continue;
      const key = monthKeyOf(record.timestamp);
      const index = key.year * 12 + (key.month - 1);
      const bucket = months.get(index);
      if (bucket) bucket.tokens += usageSum(record.usage);
      else months.set(index, { year: key.year, month: key.month, tokens: usageSum(record.usage) });
    }
  }
}

/**
 * 模型 A vs B 的逐月 token 对照。空输入（或窗口内无任何记录）→
 * months 空数组、overlapMonths 0。`now` 兜底窗口末月（与 monthSpanOf
 * 同款：末月 = max(最后记录月, now 所在月)），测试注入固定值。
 */
export function modelSeesaw(
  sessions: readonly UsageSessionInput[],
  modelA: string,
  modelB: string,
  now: number = Date.now()
): ModelSeesaw {
  const a = new Map<number, { year: number; month: number; tokens: number }>();
  const b = new Map<number, { year: number; month: number; tokens: number }>();
  accumulate(a, modelA, sessions);
  accumulate(b, modelB, sessions);

  // 月序列用 monthSpanOf 的窗口（全部 records 定义首末月，now 兜底末月）；
  // A/B 独占月的记录也定义窗口——两侧的月序并集即 monthSpanOf 的产出。
  const span: MonthKey[] = monthSpanOf(sessions, now);
  const months: SeesawMonth[] = span.map((key) => {
    const index = key.year * 12 + (key.month - 1);
    return {
      year: key.year,
      month: key.month,
      tokensA: a.get(index)?.tokens ?? 0,
      tokensB: b.get(index)?.tokens ?? 0
    };
  });

  const overlapMonths = months.filter((m) => m.tokensA > 0 && m.tokensB > 0).length;
  return { months, overlapMonths };
}
