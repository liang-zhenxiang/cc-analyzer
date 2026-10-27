import type { UsageSessionInput, UsageTotals } from "./usageAggregations";
import { addLocalDays, dayStartOf, formatDayLabel, totalsSum } from "./usageAggregations";

/**
 * 用量年报（E4）：把一整年的会话折成一张年报数字。纯数据层——年份过滤、
 * 各项之最、并列裁决全部在这里定死，视图只排版。
 *
 * 口径（全部复用既有权威来源，不自建第二套）：
 * - token 只计 record.usage 四计数之和（`totalsSum` 同款）；
 * - 消息数按 message 条数（user/assistant、非 compactSummary——与
 *   `aggregateSession` 同口径，这里独立实现同一判定，因为年报只扫目标年，
 *   借 aggregateSession 会把全年份都聚合再丢掉大半）；
 * - 活跃天 = 有任何记录的本地日（`dayStartOf` 同键）；
 * - 自然周周一起始（`weeklyDigest.weekStartOf` 同款几何），costliestWeek =
 *   窗口 token 最大的周，并列取更早；
 * - topMonth 并列取更早月，topModel 并列取字典序，peakDay 并列取更早日
 *   ——三处并列裁决都写死在比较函数里，同输入必同输出。
 *
 * year 过滤后可能没有任何记录 → 返回 null（界面写「这一年没有数据」，
 * 不是一份全 0 的年报：全 0 会冒充「认真用过」）。
 */

export type AnnualReport = {
  year: number;
  totalTokens: number;
  totalMessages: number;
  activeDays: number;
  /** "M/D"（`formatDayLabel` 同款，不补零）。 */
  firstDay: string;
  lastDay: string;
  /** 数据起点晚于当年 1 月 1 日 → true，界面写「数据从 X 开始」。 */
  dataStartsMidYear: boolean;
  /** token 最大的月（1–12）；并列取更早月。无消耗月时 null（活跃但全无 usage）。 */
  topMonth: { month: number; tokens: number } | null;
  /** token 最大的模型；并列取模型名字典序。 */
  topModel: { model: string; tokens: number } | null;
  /** 最长连续活跃天数（本地日连续，DST 用 addLocalDays 逐日判）。 */
  longestStreakDays: number;
  /** token 最大的自然周（周一起始）；并列取更早周。 */
  costliestWeek: { weekStartLabel: string; tokens: number } | null;
  /** token 最大的单日；并列取更早日。 */
  peakDay: { date: string; tokens: number } | null;
};

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/** 本地自然周的周一零点（weeklyDigest.weekStartOf 同款几何，独立内联以免跨模块私有依赖）。 */
function weekStartOf(ts: number): number {
  const day = dayStartOf(ts);
  const weekday = new Date(day).getDay();
  const offset = (weekday - 1 + 7) % 7;
  return addLocalDays(day, -offset);
}

function addUsage(target: UsageTotals, usage: NonNullable<UsageSessionInput["records"][number]["usage"]>): void {
  target.input += usage.inputTokens ?? 0;
  target.output += usage.outputTokens ?? 0;
  target.cacheCreation += usage.cacheCreationTokens ?? 0;
  target.cacheRead += usage.cacheReadTokens ?? 0;
}

/**
 * 年报。`year` 缺省取 records 里最新记录的本地年份；无任何记录时返回
 * null（没有「默认年」可取）。目标年过滤后为空同样返回 null。
 */
export function annualReportOf(sessions: readonly UsageSessionInput[], year?: number): AnnualReport | null {
  // 先定目标年：显式参数优先，否则最新记录的本地年。
  let targetYear = year;
  if (targetYear === undefined) {
    let latest: number | null = null;
    for (const session of sessions) {
      for (const record of session.records) {
        if (latest === null || record.timestamp > latest) latest = record.timestamp;
      }
    }
    if (latest === null) return null;
    targetYear = new Date(latest).getFullYear();
  }

  const totalTokens: UsageTotals = emptyTotals();
  let totalMessages = 0;
  const tokensByDay = new Map<number, UsageTotals>();
  const tokensByModel = new Map<string, UsageTotals>();

  for (const session of sessions) {
    for (const record of session.records) {
      if (new Date(record.timestamp).getFullYear() !== targetYear) continue;

      // 活跃天按「有任何记录的本地日」——不限 message、不限带 usage。
      const dayStart = dayStartOf(record.timestamp);
      let dayBucket = tokensByDay.get(dayStart);
      if (!dayBucket) {
        dayBucket = emptyTotals();
        tokensByDay.set(dayStart, dayBucket);
      }

      // 消息条数与 aggregateSession 同判定。
      if (
        (record.kind === "user" || record.kind === "assistant") &&
        record.compactSummary !== true
      ) {
        totalMessages += 1;
      }

      const recordUsage = record.usage;
      if (!recordUsage) continue;
      addUsage(dayBucket, recordUsage);
      addUsage(totalTokens, recordUsage);
      const model = record.model ?? "未知模型";
      let modelBucket = tokensByModel.get(model);
      if (!modelBucket) {
        modelBucket = emptyTotals();
        tokensByModel.set(model, modelBucket);
      }
      addUsage(modelBucket, recordUsage);
    }
  }

  if (tokensByDay.size === 0) return null;

  const dayStarts = [...tokensByDay.keys()].sort((a, b) => a - b);
  const firstDayStart = dayStarts[0];
  const lastDayStart = dayStarts[dayStarts.length - 1];

  // 月/周/模型/日四个「之最」，并列裁决写在比较里。
  const tokensByMonth = new Map<number, number>();
  const tokensByWeek = new Map<number, number>();
  for (const [dayStart, totals] of tokensByDay) {
    const month = new Date(dayStart).getMonth() + 1; // 1–12（界面直接可读）
    tokensByMonth.set(month, (tokensByMonth.get(month) ?? 0) + totalsSum(totals));
    const weekStart = weekStartOf(dayStart);
    tokensByWeek.set(weekStart, (tokensByWeek.get(weekStart) ?? 0) + totalsSum(totals));
  }

  let topMonth: AnnualReport["topMonth"] = null;
  for (const [month, tokens] of tokensByMonth) {
    if (topMonth === null || tokens > topMonth.tokens) {
      topMonth = { month, tokens };
    }
    // 并列取更早月：月号小者胜，只有更小月才能推翻。
    else if (tokens === topMonth.tokens && month < topMonth.month) {
      topMonth = { month, tokens };
    }
  }

  let costliestWeekStart: number | null = null;
  let costliestWeekTokens = 0;
  for (const [weekStart, tokens] of tokensByWeek) {
    if (tokens > costliestWeekTokens || (tokens === costliestWeekTokens && costliestWeekStart !== null && weekStart < costliestWeekStart)) {
      costliestWeekStart = weekStart;
      costliestWeekTokens = tokens;
    }
  }

  let topModel: AnnualReport["topModel"] = null;
  for (const [model, totals] of tokensByModel) {
    const tokens = totalsSum(totals);
    if (topModel === null || tokens > topModel.tokens) {
      topModel = { model, tokens };
    } else if (tokens === topModel.tokens && model.localeCompare(topModel.model) < 0) {
      topModel = { model, tokens };
    }
  }

  let peakDay: AnnualReport["peakDay"] = null;
  for (const dayStart of dayStarts) {
    const tokens = totalsSum(tokensByDay.get(dayStart)!);
    if (peakDay === null || tokens > peakDay.tokens) {
      peakDay = { date: formatDayLabel(dayStart), tokens };
    }
    // 并列取更早日：dayStarts 已升序，后来的等值不推翻——天然满足，无需分支。
  }

  // 最长连续活跃段：升序日键逐日判 addLocalDays(prev,1)===day。
  let longestStreakDays = 0;
  let run = 0;
  let prev: number | null = null;
  for (const dayStart of dayStarts) {
    run = prev !== null && addLocalDays(prev, 1) === dayStart ? run + 1 : 1;
    prev = dayStart;
    if (run > longestStreakDays) longestStreakDays = run;
  }

  const januaryFirst = new Date(targetYear, 0, 1).getTime();
  return {
    year: targetYear,
    totalTokens: totalsSum(totalTokens),
    totalMessages,
    activeDays: dayStarts.length,
    firstDay: formatDayLabel(firstDayStart),
    lastDay: formatDayLabel(lastDayStart),
    dataStartsMidYear: firstDayStart > januaryFirst,
    topMonth: topMonth && topMonth.tokens > 0 ? topMonth : null,
    topModel: topModel && topModel.tokens > 0 ? topModel : null,
    longestStreakDays,
    costliestWeek:
      costliestWeekStart !== null && costliestWeekTokens > 0
        ? { weekStartLabel: formatDayLabel(costliestWeekStart), tokens: costliestWeekTokens }
        : null,
    peakDay: peakDay && peakDay.tokens > 0 ? peakDay : null
  };
}
