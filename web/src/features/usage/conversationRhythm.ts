/**
 * H4「对话节奏谱」的纯逻辑。
 *
 * 输入是一个会话里**用户消息**的时间戳（顺序不限，这里先排序）。输出的
 * gaps 是相邻两条用户消息的间隔；统计量只描述「人说话的节奏」，不描述
 * assistant 的生成速度。
 *
 * 判据（写死，便于解释）：
 *   - 快问快追：中位间隔 < 2 分钟，且「快间隔」（< 60 秒）占比 ≥ 60%。
 *   - 长考后一击：中位间隔 ≥ 10 分钟。
 *   - 其余：匀速。
 * 两条主判据实际互斥（中位 < 2 分钟与中位 ≥ 10 分钟不可能同时成立），但
 * 仍按顺序判：快问快追优先，长考次之，最后匀速。
 *
 * 少于 3 条用户消息返回 null：2 条消息只有 1 个间隔，中位数与占比都没有
 * 意义，硬算出来的标签是编的。
 */

export type RhythmGap = { gapMs: number };

export type RhythmLabel = "快问快追" | "匀速" | "长考后一击";

export type ConversationRhythm = {
  gaps: RhythmGap[];
  medianMs: number;
  p90Ms: number;
  longestMs: number;
  /** gap < 60 秒的个数。 */
  bursts: number;
  label: RhythmLabel;
};

/** 最少消息条数：更少时样本不足。 */
export const MIN_RHYTHM_MESSAGES = 3;
/** 「快间隔」上限：60 秒（严格小于）。 */
export const BURST_GAP_MS = 60_000;
/** 快问快追：中位间隔 < 2 分钟。 */
export const FAST_MEDIAN_MS = 2 * 60_000;
/** 快问快追：快间隔占比 ≥ 60%。 */
export const FAST_BURST_SHARE = 0.6;
/** 长考后一击：中位间隔 ≥ 10 分钟。 */
export const THINK_MEDIAN_MS = 10 * 60_000;

function medianOf(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 最近秩法（nearest-rank）的 p90：ceil(0.9·n) 名，1 起。 */
function percentile90(sorted: readonly number[]): number {
  const index = Math.max(0, Math.ceil(sorted.length * 0.9) - 1);
  return sorted[index];
}

export function rhythmOf(userTimestamps: readonly number[]): ConversationRhythm | null {
  const times = userTimestamps.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (times.length < MIN_RHYTHM_MESSAGES) return null;

  const gaps: RhythmGap[] = [];
  for (let index = 1; index < times.length; index += 1) {
    gaps.push({ gapMs: times[index] - times[index - 1] });
  }
  const gapValues = gaps.map((gap) => gap.gapMs);
  const sortedGaps = [...gapValues].sort((a, b) => a - b);

  const medianMs = medianOf(sortedGaps);
  const p90Ms = percentile90(sortedGaps);
  const longestMs = sortedGaps[sortedGaps.length - 1];
  const bursts = gapValues.filter((gap) => gap < BURST_GAP_MS).length;
  const burstShare = bursts / gaps.length;

  const label: RhythmLabel =
    medianMs < FAST_MEDIAN_MS && burstShare >= FAST_BURST_SHARE
      ? "快问快追"
      : medianMs >= THINK_MEDIAN_MS
        ? "长考后一击"
        : "匀速";

  return { gaps, medianMs, p90Ms, longestMs, bursts, label };
}
