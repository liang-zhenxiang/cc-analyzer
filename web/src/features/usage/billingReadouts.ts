import { useEffect, useMemo, useState } from "react";
import type { SessionRecord } from "../sessions/types";
import { clusterBillingBlocks, currentBlock, type BillingBlock } from "./billingWindow";
import { usePlan, type PlanSelection } from "./planLimits";
import { attributeQuota, type QuotaAttribution } from "./quotaAttribution";
import type { UsageSessionInput } from "./usageAggregations";
import { weeklyWindow, type WeeklyWindow } from "./weeklyWindow";

/**
 * 倒计时的新鲜度：窗口关闭时刻一直在走，读数必须跟着走。
 *
 * 这枚 tick 原先住在 `BillingWindowCard` 里。Issue #174 把「记录 → 计费窗口 →
 * 5 小时 / 滚动 7 天」这条序列收口到本模块后，卡不再自己起时钟：页面调用一次
 * `useBillingReadouts`，卡与快照导出共用同一份读数，同屏不可能出现两个 `now`。
 */
export const CLOCK_TICK_MS = 30_000;

/**
 * 「记录 → 计费窗口 → 两层限额」这条序列的纯结果：与时钟、与订阅计划都无关，
 * 只由 `(inputs, now, weeklyLimitTokens)` 决定。
 */
export type BillingWindowReadouts = {
  /** 所有会话记录按时间交错排序后的同一条流。 */
  records: SessionRecord[];
  /** `clusterBillingBlocks(records)` 的结果。 */
  blocks: BillingBlock[];
  /** `currentBlock(blocks, now)`：覆盖 `now` 的那个窗口；没有就是 `null`。 */
  active: BillingBlock | null;
  /** `weeklyWindow(records, weeklyLimitTokens, now)` 的结果。 */
  week: WeeklyWindow;
  /** `attributeQuota(inputs, active)` 的结果；没有窗口时是 `null`。 */
  attribution: QuotaAttribution | null;
};

/** 读数的完整形态：窗口数学 + 生成它用的 `now` 与计划（卡与快照共用同一份）。 */
export type BillingReadouts = BillingWindowReadouts & {
  now: number;
  plan: PlanSelection;
};

/**
 * 5 小时窗口与滚动 7 天共用同一条记录流：两层数字必须出自同一份日志，
 * 否则「本窗口消耗」与「7 天消耗」会在同屏互相打架。这段数学原先整段住在
 * `BillingWindowCard` 的渲染里，Issue #174 原样搬到这里——一行都没改。
 */
export function billingReadoutsOf(
  inputs: readonly UsageSessionInput[],
  now: number,
  weeklyLimitTokens: number | null
): BillingWindowReadouts {
  // Interleave every session's records into one time-ordered stream:
  // billing windows are machine-wide, not per-session.
  const records: SessionRecord[] = [];
  for (const input of inputs) records.push(...input.records);
  records.sort((a, b) => a.timestamp - b.timestamp);

  const blocks = clusterBillingBlocks(records);
  const active = currentBlock(blocks, now);
  return {
    records,
    blocks,
    active,
    week: weeklyWindow(records, weeklyLimitTokens, now),
    // 归因也在这条序列里收口（Issue #174）：面板与快照导出吃同一份 `attribution`，
    // 同屏与文件里的 Top 会话不可能各算一遍。
    attribution: active ? attributeQuota(inputs, active) : null
  };
}

/**
 * 页面级的唯一一处读数组装：内部取订阅计划、内部持那枚 30 秒 tick，返回同屏
 * 所有计费读数——表盘、5 小时层、滚动 7 天层、归因面板与快照导出都吃这一份。
 *
 * `nowProp` 仅供测试注入（与重构前 `BillingWindowCard` 的 `now` prop 同款语义）：
 * 给了它就不再走时钟，读数停在这一刻。
 */
export function useBillingReadouts(
  inputs: readonly UsageSessionInput[],
  nowProp?: number
): BillingReadouts {
  const plan = usePlan();
  const [, setTick] = useState(0);
  const now = nowProp ?? Date.now();

  useEffect(() => {
    if (nowProp !== undefined) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [nowProp]);

  return useMemo(
    () => ({ now, plan, ...billingReadoutsOf(inputs, now, plan.weeklyLimitTokens) }),
    [inputs, now, plan]
  );
}
