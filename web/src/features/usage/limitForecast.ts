import type { BillingBlock } from "./billingWindow";
import { totalsSum } from "./usageAggregations";

/**
 * 「限额预报」的纯逻辑（Round CC F5）。
 *
 * 它和 `billingWindow.predictLimitReach` 回答的不是同一个问题：
 * - `predictLimitReach` 回答「**会不会**触顶、几点触顶」，样本不足时直接闭嘴；
 * - 这里回答「**按当前速率走完这个窗口**，用量会到限额的百分之几」，所以即使
 *   已经不可能触顶，它也要给一个数——它是读者判断「这个窗口我还剩多少余量」
 *   的依据，不是告警。
 *
 * 界面上的每一行都必须带「若保持此速率」：这是线性外推，不是事实。所以本模块
 * 不返回「安全 / 危险」这类判断词，只返回数字与时刻，措辞留给界面。
 */

export type LimitForecast = {
  /** 窗口结束时的预计用量，相对自设限额的百分比（未四舍五入）。 */
  projectedPct: number;
  /** 保持当前速率会触顶的时刻；不触顶（或在窗口关闭后才到）时为 `null`。 */
  hitTime: number | null;
  /** 当前速率，tokens / 小时。 */
  burnPerHour: number;
};

/**
 * 窗口已过这么多比例且用量仍为 0 时，停止预测增长。
 *
 * 分母是「已过时长」，用 0 除出来的速率没有定义；更关键的是，一个走了 4 小时
 * 还是 0 的窗口，把「0 / 4h」外推成「整窗 0」是对的，把样本不足硬拗成一条斜线
 * 是错的。
 */
export const SETTLED_FRACTION = 0.8;

/** 「速度 ≥ 限额的 100%/h」——整行换 warning 色的阈值（满分额一小时烧完）。 */
export const HOT_BURN_SHARE_PER_HOUR = 1;

const MS_PER_HOUR = 3_600_000;

/**
 * 窗口结束时的预计用量。
 *
 * @param block 当前的 5 小时计费窗口（`readouts.active`）。
 * @param planLimitTokens 自设的窗口限额；`null` = 没选计划，这时**不能**预报：
 *   没有分母就没有百分比，界面索性不渲染这一行（返回 `null` 让调用方整行消失，
 *   而不是印一个 0%）。
 * @param now 读数时刻，默认取本机时钟。
 */
export function buildLimitForecast(
  block: BillingBlock,
  planLimitTokens: number | null,
  now: number = Date.now()
): LimitForecast | null {
  if (planLimitTokens === null || !Number.isFinite(planLimitTokens) || planLimitTokens <= 0) {
    return null;
  }

  const windowMs = block.end - block.start;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return null;

  const consumed = totalsSum(block.totals);
  const elapsedMs = Math.max(0, Math.min(now, block.end) - block.start);

  // 已经是 0 用量 + 窗口过了大半：保持「0」这个读数，不做增长预测。
  const settled = consumed === 0 && elapsedMs >= windowMs * SETTLED_FRACTION;
  // 窗口刚开（elapsed 0）时速率无定义：报当前用量，不报一个编出来的速度。
  const burnPerHour = settled || elapsedMs <= 0 ? 0 : consumed / (elapsedMs / MS_PER_HOUR);

  const remainingMs = Math.max(0, block.end - now);
  const projectedTokens = consumed + burnPerHour * (remainingMs / MS_PER_HOUR);
  const projectedPct = (projectedTokens / planLimitTokens) * 100;

  let hitTime: number | null = null;
  if (burnPerHour > 0) {
    const tokensLeft = planLimitTokens - consumed;
    // 已经触顶：那一刻就是现在，不是「未来的某个时刻」。
    if (tokensLeft <= 0) {
      hitTime = now;
    } else {
      const reachAt = now + (tokensLeft / burnPerHour) * MS_PER_HOUR;
      // 窗口关闭时额度重置，之后才到限额的预测没有意义（同 `predictLimitReach`）。
      hitTime = reachAt < block.end ? reachAt : null;
    }
  }

  return { projectedPct, hitTime, burnPerHour };
}

/**
 * 「整行该不该变 warning 色」：速率达到限额的 100%/h。
 *
 * 放在模型层而不是界面里，是为了让这个阈值只有一个定义——猜一个「看起来红色
 * 才对」的数字，比不标还糟。
 */
export function isHotBurn(forecast: LimitForecast, planLimitTokens: number): boolean {
  if (!Number.isFinite(planLimitTokens) || planLimitTokens <= 0) return false;
  if (!Number.isFinite(forecast.burnPerHour) || forecast.burnPerHour <= 0) return false;
  return forecast.burnPerHour >= planLimitTokens * HOT_BURN_SHARE_PER_HOUR;
}
