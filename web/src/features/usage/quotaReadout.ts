import type { TrayReadout } from "../../api/types";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { BILLING_WINDOW_MS, clusterBillingBlocks, currentBlock } from "./billingWindow";
import type { PlanSelection } from "./planLimits";
import { totalsSum, type UsageSessionInput } from "./usageAggregations";
import { WEEKLY_WINDOW_MS, weeklyWindow } from "./weeklyWindow";

/**
 * 常驻读数的扫描下界：5 小时窗口需要 `mtimeMs ≥ now − 5h`，周窗口（滚动 7 天
 * + 上一周期对照）需要 `mtimeMs ≥ now − 14d`。前者的集合是后者的子集，所以两段
 * 的并集就是 14 天——按它收窄，**一次列目录、一次解析**，5 小时的读数是这次解析
 * 结果的子集，不额外再扫一遍。
 *
 * 归档副本的 `mtimeMs` 是**原始 mtime**（见 metadataCache.ts 的 `SessionMeta`
 * 注释），所以这条收窄对归档会话同样成立：不会因为会话被归档而漏掉或误收。
 */
export const TRAY_LOOKBACK_MS = Math.max(BILLING_WINDOW_MS, 2 * WEEKLY_WINDOW_MS);

/**
 * 按 mtime 收窄到「可能影响当前读数」的会话。边界**含在内**：正好等于
 * `now − 14d`（上一周期的边界点）的会话也要收进来。
 */
export function recentSessionsFor(
  sessions: readonly SessionMeta[],
  now: number
): SessionMeta[] {
  const cutoff = now - TRAY_LOOKBACK_MS;
  return sessions.filter((session) => session.mtimeMs >= cutoff);
}

/**
 * 比率的唯一算法，与用量页 BillingWindowCard 同一立场：没有分母（没设预算）
 * 就没有比率，返回 `null` 而不是 0——0 会假装「读了但消耗为零」。超预算照实
 * 给 >100，不夹到 100。
 */
function percentOf(usedTokens: number, limitTokens: number | null): number | null {
  if (limitTokens === null || limitTokens <= 0) return null;
  return (usedTokens / limitTokens) * 100;
}

/**
 * 把一批会话输入折成托盘的读数。口径**必须**与用量页一致：records 交错后按
 * timestamp 排序（计费窗口是全机器共享的，不是逐会话的），再交给同一批纯函数
 * `clusterBillingBlocks` / `currentBlock` / `weeklyWindow`——这里不新写窗口数学。
 */
export function buildTrayReadout(
  inputs: readonly UsageSessionInput[],
  plan: PlanSelection,
  now: number
): TrayReadout {
  // 与 BillingWindowCard 的组流顺序逐字一致：先交错，再按时间排序。
  const records: SessionRecord[] = [];
  for (const input of inputs) records.push(...input.records);
  records.sort((a, b) => a.timestamp - b.timestamp);

  const active = currentBlock(clusterBillingBlocks(records), now);
  const activeUsed = active === null ? 0 : totalsSum(active.totals);
  const block =
    active === null
      ? null
      : {
          usedTokens: activeUsed,
          percent: percentOf(activeUsed, plan.limitTokens),
          startsAt: active.start,
          endsAt: active.end
        };

  const week = weeklyWindow(records, plan.weeklyLimitTokens, now);
  const weeklyUsed = totalsSum(week.consumed);
  const weekly = {
    usedTokens: weeklyUsed,
    percent: percentOf(weeklyUsed, plan.weeklyLimitTokens),
    days: WEEKLY_WINDOW_MS / 86_400_000
  };

  // 保守标注：读数里只要出现比率，分母就不是日志事实——预设限额是社区估算
  // （planLimits.ts 的「估算」provenance），自设预算也只是使用者的假设；两者都
  // 够不上「读自日志」。只有完全没有比率的纯消耗读数才敢说全部来自日志。
  const hasEstimate =
    (block !== null && block.percent !== null) || weekly.percent !== null;

  return { block, weekly, computedAt: now, hasEstimate };
}
