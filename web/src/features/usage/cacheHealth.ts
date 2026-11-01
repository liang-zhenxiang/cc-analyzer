/**
 * H7「缓存健康」的纯逻辑。
 *
 * 输入是按周聚合的 cacheRead 与 input token；命中率 = cacheRead ÷
 * (cacheRead + input)——与计费卡片里的缓存命中率同分子同分母（都是「读缓存
 * 的输入」占「全部输入」的比例），不另造口径。
 *
 * 口径：
 *   - 分母为 0（cacheRead 与 input 都是 0）→ 这一周 `hitRate: null`：没读数
 *     不是 0% 命中。两个计数器任一为负/非有限也按 null 处理。
 *   - 趋势只看**最近 4 周**里非 null 的周：≥3 个才比较，比较「最早一个非
 *     null」与「最晚一个非 null」的差；差 ≥ +5 个百分点算 improving，≤ −5
 *     pp 算 declining，其余 flat。不足 3 个非 null 周返回 null——三周里两周
 *     读数相同就宣布趋势，是拿噪声当信号。
 *   - `latest` 是最后一周的命中率（最后一周没读数就是 null，不回退到更早
 *     的周——「当前」不是「上次有数据的时候」）。
 */

export type CacheWeek = {
  weekStart: number;
  cacheReadTokens: number;
  inputTokens: number;
};

export type CacheWeekHealth = {
  weekStart: number;
  hitRate: number | null;
};

export type CacheTrend = "improving" | "flat" | "declining";

export type CacheHealth = {
  weeks: CacheWeekHealth[];
  trend: CacheTrend | null;
  latest: number | null;
};

/** 趋势窗口：最近 4 周。 */
export const TREND_WINDOW_WEEKS = 4;
/** 判定趋势至少要几个非 null 周。 */
export const TREND_MIN_WEEKS = 3;
/** 5 个百分点的变化才算「有趋势」。 */
export const TREND_THRESHOLD = 0.05;

/** 浮点比较容差：0.55 − 0.5 在 IEEE 754 里是 0.050000000000000044，按字面比会虚高。 */
const EPSILON = 1e-12;

function hitRateOf(week: CacheWeek): number | null {
  const cacheRead = week.cacheReadTokens;
  const input = week.inputTokens;
  if (!Number.isFinite(cacheRead) || !Number.isFinite(input) || cacheRead < 0 || input < 0) {
    return null;
  }
  const total = cacheRead + input;
  if (total <= 0) return null;
  return cacheRead / total;
}

export function cacheHealthOf(weekly: readonly CacheWeek[]): CacheHealth {
  const sorted = [...weekly].sort((a, b) => a.weekStart - b.weekStart);
  const weeks: CacheWeekHealth[] = sorted.map((week) => ({
    weekStart: week.weekStart,
    hitRate: hitRateOf(week)
  }));

  const latest = weeks.length > 0 ? weeks[weeks.length - 1].hitRate : null;

  const window = weeks.slice(-TREND_WINDOW_WEEKS);
  const rates = window
    .map((week) => week.hitRate)
    .filter((rate): rate is number => rate !== null);

  let trend: CacheTrend | null = null;
  if (rates.length >= TREND_MIN_WEEKS) {
    const first = rates[0];
    const last = rates[rates.length - 1];
    const diff = last - first;
    if (diff >= TREND_THRESHOLD - EPSILON) trend = "improving";
    else if (diff <= -TREND_THRESHOLD + EPSILON) trend = "declining";
    else trend = "flat";
  }

  return { weeks, trend, latest };
}
