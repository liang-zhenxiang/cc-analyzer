import type { UsageSessionInput } from "./usageAggregations";

/**
 * 上下文分位数（G7）：窗口内全体会话的上下文峰值分布——P50/P75/P90/P99
 * 与最大值，回答「我的会话一般吃多少上下文、最狠的一次吃到多少」。
 *
 * 口径：
 *   - 每个会话的「上下文峰值」= 会话内 records 的 max(input + cacheCreation
 *     + cacheRead)，与 sessionQuery.minContextPeak / contextSeriesOf 的
 *     「整份提示词」同一口径。没有任何带 usage 记录的会话峰值为 0——它
 *     确实没有消耗过上下文，0 是真值不是未知。
 *   - 分位数用**最近邻插值（nearest-rank）**：把样本升序排好，第
 *     ceil(p·n) 个（1 基）就是 p 分位——与 toolHealth.p95Ms 同一方法，
 *     那里的理由在这里同样成立：读数必须是样本里真实出现过的值，会话数
 *     只有几十个，线性插值会在两个真实峰值之间编造一个没发生过的数。
 *   - 样本不足（会话数 < 2）时全部字段 null——单个会话的「分布」没有
 *     统计意义，count 照实报数（toolHealth 的「样本不足不硬拗」同款）。
 *   - max 单独给：P99 在小样本下经常就是最大值，但 max 语义独立（「最狠
 *     的一次」），不靠 P99 兼职。
 */

/** 一组上下文峰值分位读数；样本不足时各分位与 max 全为 null。 */
export type ContextQuantiles = {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
  /** 参与统计的会话数（含峰值为 0 的会话）。 */
  count: number;
};

/** 与 toolHealth.p95Ms 同一最近邻分位：升序样本的第 ceil(p·n) 个（1 基）。 */
function nearestRank(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1];
}

/**
 * 全体会话的上下文峰值分位。纯函数：不做窗口过滤——传进来的 sessions
 * 就是要统计的那段区间。
 */
export function contextQuantiles(sessions: readonly UsageSessionInput[]): ContextQuantiles {
  const peaks: number[] = [];
  for (const session of sessions) {
    let peak = 0;
    for (const record of session.records) {
      const usage = record.usage;
      if (!usage) continue;
      const context =
        (usage.inputTokens ?? 0) +
        (usage.cacheCreationTokens ?? 0) +
        (usage.cacheReadTokens ?? 0);
      if (context > peak) peak = context;
    }
    peaks.push(peak);
  }

  if (peaks.length < 2) {
    return { p50: null, p75: null, p90: null, p99: null, max: null, count: peaks.length };
  }

  peaks.sort((a, b) => a - b);
  return {
    p50: nearestRank(peaks, 0.5),
    p75: nearestRank(peaks, 0.75),
    p90: nearestRank(peaks, 0.9),
    p99: nearestRank(peaks, 0.99),
    max: peaks[peaks.length - 1],
    count: peaks.length
  };
}
