/**
 * I9 模型切换热力：一个会话里换过几次模型，按「没换 / 换一次 / 换多次」归类。
 *
 * 契约边界（与设计稿 §2-④ 一致）：
 *   - 输入 `models` 是**按时间序的原始 model 序列，可重复**（不要把同一模型
 *     连续出现或「换回旧模型」的重复去掉）；「去重 + 只保留带 usage 的记录」
 *     是调用方的职责，在 usageAggregations 那一趟扫描里完成。
 *   - 切换数 = 逐个比较相邻元素，数「与前一条不同」的次数：A→B→A 是 2 次
 *     （换回旧模型同样是切换），A→A→A 是 0 次，空序列 / 单元素是 0 次。
 *   - `switchRate` = 至少切换过一次的会话占比，即 (once + multi) / 总会话数；
 *     0 个会话返回 null（没有分母，不写 0）。
 */

export type ModelSwitchHeat = {
  /** 全程一个模型（含 0 个模型）的会话数。 */
  never: number;
  /** 恰好切换一次的会话数。 */
  once: number;
  /** 切换两次及以上的会话数（含换回旧模型）。 */
  multi: number;
  /** (once + multi) / 总会话数；无会话时为 null。 */
  switchRate: number | null;
};

export type ModelSwitchSession = {
  /** 按时间序排列的原始模型 id 序列（可重复，调用方不去重）。 */
  models: readonly string[];
};

export function modelSwitchHeatOf(
  sessions: readonly ModelSwitchSession[]
): ModelSwitchHeat | null {
  if (sessions.length === 0) return null;

  let never = 0;
  let once = 0;
  let multi = 0;

  for (const session of sessions) {
    let switches = 0;
    for (let index = 1; index < session.models.length; index += 1) {
      if (session.models[index] !== session.models[index - 1]) switches += 1;
    }
    if (switches === 0) never += 1;
    else if (switches === 1) once += 1;
    else multi += 1;
  }

  return {
    never,
    once,
    multi,
    switchRate: (once + multi) / sessions.length
  };
}
