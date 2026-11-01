/**
 * H2「收工推演」的纯逻辑。
 *
 * 回答一个问题：如果每天从某个小时起就不再用 Claude（例如 17 点收工），
 * 历史用量里有多少 token 会被切掉、占比多大。数据是调用方给好的「按小时
 * 聚合」——跨午夜的会话，token 记在**记录实际发生的小时**上，这件事由聚合
 * 层负责；本模块只做算术，不重新归属任何记录。
 *
 * 口径：
 *   - `cutoffHour` = 每天从这一小时开始算「切掉」。17 表示保留 0–16 点、
 *     切掉 17–23 点；`24` 或 `0` 表示全天保留（0 当成「没有截断」而不是
 *     「0 点起全切」——这是产品语义：滑块拉到最左等于不砍）。
 *   - 小时不是 0–23 的整数、token 不是非负数：该行不计入任何一侧，并在
 *     文档里注明「坏读数不参与」——不把 -5 当成「负的用量」。
 *   - `cutShare` 四舍五入到 0.1%（0.001），与界面显示的百分比位数一致。
 *   - 输入为空返回 `null`：没有小时分布时，「全保留」和「全切掉」都是编的。
 */

export type HourlyTokens = {
  /** 本地小时，0–23。 */
  hour: number;
  tokens: number;
};

export type CutoffProjection = {
  keptTokens: number;
  cutTokens: number;
  /** cutTokens ÷ (kept + cut)，四舍五入到 0.1%。 */
  cutShare: number;
};

/** 每行小时聚合只接受整数小时。 */
function isValidHour(hour: number): boolean {
  return Number.isInteger(hour) && hour >= 0 && hour <= 23;
}

/** 把 cutShare 钉到 0.1% 的精度（0.001 = 1‰ = 0.1%）。 */
function roundShare(share: number): number {
  return Math.round(share * 1000) / 1000;
}

/**
 * @param hourlyTokens 历史按小时聚合的 token 数（顺序无关）。
 * @param cutoffHour 每天从此小时起不再使用；0–23，或 24 表示全天保留。
 */
export function projectCutoff(
  hourlyTokens: readonly HourlyTokens[],
  cutoffHour: number
): CutoffProjection | null {
  if (hourlyTokens.length === 0) return null;

  // 0 或 ≥24 都表示「不砍」；非法值（NaN、小数、负数）同样按不砍处理——
  // 滑块只会给整数，真收到坏值时不拿它把全天算成切掉。
  const keepAll =
    !Number.isInteger(cutoffHour) || cutoffHour <= 0 || cutoffHour >= 24;

  let keptTokens = 0;
  let cutTokens = 0;
  for (const row of hourlyTokens) {
    if (!isValidHour(row.hour)) continue;
    if (!Number.isFinite(row.tokens) || row.tokens < 0) continue;
    if (keepAll || row.hour < cutoffHour) keptTokens += row.tokens;
    else cutTokens += row.tokens;
  }

  const total = keptTokens + cutTokens;
  return {
    keptTokens,
    cutTokens,
    cutShare: total > 0 ? roundShare(cutTokens / total) : 0
  };
}
