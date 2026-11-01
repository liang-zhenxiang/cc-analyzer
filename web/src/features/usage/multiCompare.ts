/**
 * 多选对照（I4）：2–4 个实体（项目/模型/工具）的指标并排与对照几何，纯数据层。
 *
 * 分工边界（§4.3）：**聚合由调用方做**——项目按 projectLabel、模型按
 * `aggregateSession` 的 models bucket、工具按 censusKeyId，全部走
 * usageAggregations 既有口径。本模块只做「对照几何」：份额、最优、离散度。
 *
 * 口径：
 * - `shares` = 该实体指标 ÷ 所选实体同指标之和（不是全体——对照是「选中的
 *   这几个互相比」，0 分母 → 0：一条数据都没有时不假装有比例）；
 * - `best` = tokens 最大者；**并列取字典序靠前**（id 的 localeCompare）——
 *   并列时随便挑一个都会让「为什么是它」无法回答，字典序是唯一可复现的
 *   平局裁决，写进注释就是契约；
 * - `spread` = (max − min) / max（tokens 维度的相对离散，0–1）；max ≤ 0 或
 *   只有一个实体时 null——「全部为 0」与「只有一个」都谈不上离散度。
 * - 少于 2 个实体 → 整个返回 null（「选择至少两个实体」是界面的事，
 *   数据层用 null 表达「对照不成立」）。
 */

/** 输入：已按实体聚合好的指标（聚合口径由调用方负责）。 */
export type MultiCompareEntity = {
  id: string;
  label: string;
  metrics: {
    sessions: number;
    tokens: number;
    messages: number;
    errors: number;
    activeDays: number;
  };
};

/** 输出行：原样带回 metrics + 两个份额（0–1，不乘 100——百分号是渲染层的事）。 */
export type MultiCompareRow = {
  id: string;
  label: string;
  metrics: MultiCompareEntity["metrics"];
  shares: { tokens: number; sessions: number };
};

export type MultiCompare = {
  rows: MultiCompareRow[];
  /** tokens 最大的实体（并列取 id 字典序靠前）；无实体时 null。 */
  best: { by: "tokens"; id: string } | null;
  /** (max−min)/max，tokens 维度；max ≤ 0 或 <2 实体时 null。 */
  spread: number | null;
};

export function multiCompareOf(
  dimension: "project" | "model" | "tool",
  entities: readonly MultiCompareEntity[]
): MultiCompare | null {
  // 维度本身不参与计算（几何与维度无关），只原样带回——调用方与界面
  // 需要它写 caption「按 {维度} 对照」。少于 2 个实体对照不成立。
  void dimension;
  if (entities.length < 2) return null;

  const tokensSum = entities.reduce((sum, e) => sum + e.metrics.tokens, 0);
  const sessionsSum = entities.reduce((sum, e) => sum + e.metrics.sessions, 0);

  const rows: MultiCompareRow[] = entities.map((entity) => ({
    id: entity.id,
    label: entity.label,
    metrics: entity.metrics,
    shares: {
      // 0 分母 → 0：一条数据都没有时不假装有比例。
      tokens: tokensSum > 0 ? entity.metrics.tokens / tokensSum : 0,
      sessions: sessionsSum > 0 ? entity.metrics.sessions / sessionsSum : 0
    }
  }));

  // best：tokens 最大，并列取 id 字典序靠前（可复现的平局裁决）。
  // 循环里带中间量 tokens 比较（对外形状不带它），所以先用局部宽类型。
  let bestInner: { by: "tokens"; id: string; tokens: number } | null = null;
  for (const entity of entities) {
    if (
      bestInner === null ||
      entity.metrics.tokens > bestInner.tokens ||
      (entity.metrics.tokens === bestInner.tokens &&
        entity.id.localeCompare(bestInner.id) < 0)
    ) {
      bestInner = { by: "tokens", id: entity.id, tokens: entity.metrics.tokens };
    }
  }
  // 对外形状收敛回声明类型（去掉中间量 tokens）。
  const best: MultiCompare["best"] =
    bestInner === null ? null : { by: bestInner.by, id: bestInner.id };

  const maxTokens = Math.max(...entities.map((e) => e.metrics.tokens));
  const minTokens = Math.min(...entities.map((e) => e.metrics.tokens));
  // max ≤ 0：全部为 0（或负数不该出现）时没有离散度可言。
  const spread = maxTokens > 0 ? (maxTokens - minTokens) / maxTokens : null;

  return { rows, best, spread };
}
