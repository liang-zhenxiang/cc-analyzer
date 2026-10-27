import type { ContextSample } from "../sessions/types";

/**
 * E7 上下文健康分：把「水位有多满、压缩过几次、出血过几处」压成一个 0–100
 * 的整数，并给一句人话。分数是**惩罚式**的：先看水位，再扣压缩与出血。
 *
 * 口径（写死在这里，界面不再另算）：
 *   - 水位分 = 100 − round(平均 maxRatio × 100)，maxRatio = 该次调用的
 *     contextTokens / 压缩阈值，clamp 到 [0,1]。用样本的**平均**比例而不是
 *     峰值：单次偶发的大提示词不该把整段会话判成“紧张”。
 *   - 压缩惩罚 = min(30, compactCount × 6)：压缩是“已经付过的代价”，
 *     一次 6 分，封顶 30（再多次也只说明同一件事）。
 *   - 出血惩罚 = min(30, bleedCount × 10)：每处 10 分，封顶 30。
 *   - score = clamp(水位分 − 压缩惩罚 − 出血惩罚, 0, 100)，整数。
 *   - grade：≥75 健康、≥50 偏紧、<50 紧张。
 *   - samples 为空 → score 为 **null**（不是 0）、grade「无数据」、summary
 *     「没有上下文读数」——没有读数和“读数为零”是两件事。
 *   - thresholdTokens 非有限或 ≤ 0 时退回默认 200_000；无效样本（非有限
 *     contextTokens）跳过，不按 0 水位混进均值。
 *
 * 摘要必须按实际值拼（平均水位、压缩次数、出血处数、分档结论），不写死。
 */

export type ContextHealthGrade = "健康" | "偏紧" | "紧张" | "无数据";

export type ContextHealth = {
  /** 0–100 整数；没有任何样本时为 null。 */
  score: number | null;
  grade: ContextHealthGrade;
  /** 一句中文摘要，按实际值拼出。 */
  summary: string;
};

export const DEFAULT_CONTEXT_THRESHOLD = 200_000;
export const COMPACT_PENALTY_PER_EVENT = 6;
export const BLEED_PENALTY_PER_EVENT = 10;
export const MAX_PENALTY = 30;
export const HEALTHY_SCORE = 75;
export const TIGHT_SCORE = 50;

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** 把调用方传的次数规整为非负整数；非法值按 0（没有可扣的东西）。 */
function countOf(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function penaltyOf(count: number, perEvent: number): number {
  return Math.min(MAX_PENALTY, count * perEvent);
}

function gradeOf(score: number): Exclude<ContextHealthGrade, "无数据"> {
  if (score >= HEALTHY_SCORE) return "健康";
  if (score >= TIGHT_SCORE) return "偏紧";
  return "紧张";
}

function verdictOf(grade: Exclude<ContextHealthGrade, "无数据">): string {
  if (grade === "健康") return "健康，余量充足";
  if (grade === "偏紧") return "偏紧但可控";
  return "紧张，建议尽快清理或收尾";
}

/**
 * 计算健康分。纯函数：阈值由调用方传入，不读全局配置。
 */
export function buildContextHealth(
  samples: readonly ContextSample[],
  compactCount: number,
  bleedCount: number,
  thresholdTokens: number = DEFAULT_CONTEXT_THRESHOLD
): ContextHealth {
  const threshold =
    Number.isFinite(thresholdTokens) && thresholdTokens > 0
      ? thresholdTokens
      : DEFAULT_CONTEXT_THRESHOLD;

  const ratios = samples
    .map((sample) => sample.contextTokens)
    .filter((tokens) => Number.isFinite(tokens))
    .map((tokens) => clamp(tokens / threshold, 0, 1));

  if (ratios.length === 0) {
    return { score: null, grade: "无数据", summary: "没有上下文读数" };
  }

  const averageRatio = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  const averagePercent = Math.round(averageRatio * 100);
  const waterScore = 100 - averagePercent;

  const compacts = countOf(compactCount);
  const bleeds = countOf(bleedCount);
  const compactPenalty = penaltyOf(compacts, COMPACT_PENALTY_PER_EVENT);
  const bleedPenalty = penaltyOf(bleeds, BLEED_PENALTY_PER_EVENT);

  const score = clamp(waterScore - compactPenalty - bleedPenalty, 0, 100);
  const grade = gradeOf(score);

  return {
    score,
    grade,
    summary: `平均水位 ${averagePercent}%，压缩 ${compacts} 次，出血 ${bleeds} 处——${verdictOf(grade)}`
  };
}
