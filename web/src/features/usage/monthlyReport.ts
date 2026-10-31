import type { UsageSessionInput } from "./usageAggregations";
import { UNKNOWN_MODEL_LABEL, dayStartOf } from "./usageAggregations";

/**
 * 用量月报（G4）：窗口内逐月一张卡——token / 消息 / 活跃日 / 主力模型 +
 * partial 标记。纯数据层，视图只排版。
 *
 * 口径与年报（annualReport）逐条对齐——月报是年报旁的兄弟档，同一年各月
 * 卡片加总必须能与年报对账，因此不自建任何新口径：
 * - token 只计 record.usage 四计数之和（`totalsSum` 同款算术）；
 * - 消息数按 user/assistant 且非 compactSummary 的记录条数；
 * - 活跃天 = 有任何记录的本地日（不限 message、不限带 usage）；
 * - topModel 按 usage 记录数（与 sessionCompare 的 models share 同口径：
 *   只有带 usage 的记录才进桶，比的是「用了多少次」不是「烧了多少」），
 *   并列取模型名字典序更小者，该月零 usage → null。
 *
 * 窗口：最早记录所在自然月 → max(最新记录, now) 所在自然月（aggregateRange
 * 同样不设上界，晚于 now 的记录照常入窗）。首末月之间逐月出卡，中间无记录
 * 的月份照常出卡（全 0、topModel null——诚实空月：空是「这月没用」，不冒充
 * 也不跳过）。首末月可能是半月（数据从月中开始 / 本月尚未过完）：数字不做
 * 任何折算，另给 partial: true 由界面决定是否弱化显示——用户看到的「这个月」
 * 本来就是「这个月到目前」，卡上不写「半月」二字。
 *
 * sessions 无任何记录 → months 为空数组（没有窗口可谈，界面走空态，而不是
 * 一张冒充观察过的全 0 卡）。
 */

/** 自然月键；month 为 1–12（界面直接可读，不用 0 基月号）。 */
export type MonthKey = { year: number; month: number };

/** 一张月卡。tokens 是四计数之和的单一数字（与 KPI 同构）。 */
export type MonthCard = {
  year: number;
  /** 1–12。 */
  month: number;
  /** 该月 usage 四计数之和。 */
  tokens: number;
  /** 该月 user/assistant 非 compactSummary 记录数。 */
  messages: number;
  /** 该月有任何记录的本地日数。 */
  activeDays: number;
  /** usage 记录数最多的模型；并列字典序更小；零 usage 月 null。 */
  topModel: string | null;
  /** 首月数据从月中开始 / 末月尚未过完 → true；完整观察月恒 false。 */
  partial: boolean;
};

export type MonthlyReport = { months: MonthCard[] };

/** 时间戳的本地自然月（与 `dayStartOf` 同款本地日历几何）。 */
export function monthKeyOf(ts: number): MonthKey {
  const date = new Date(ts);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}

/** 月的稳定数值键（Map 键 / 窗口成员判断共用一份）。 */
export function monthIndexOf({ year, month }: MonthKey): number {
  return year * 12 + (month - 1);
}

function nextMonth({ year, month }: MonthKey): MonthKey {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

/**
 * 窗口覆盖的自然月序列（升序，含中间空月）。G4/G6/G8 共用这一条窗口规则
 * （单一来源，三张视图的首末月永远对齐）；空 sessions → 空数组。
 * 窗口由 records 定义：月报口径是「记录落在哪里」，与工具事实、usage 无关。
 */
export function monthSpanOf(
  sessions: readonly UsageSessionInput[],
  now: number = Date.now()
): MonthKey[] {
  let first: number | null = null;
  let last: number | null = null;
  for (const session of sessions) {
    for (const record of session.records) {
      if (first === null || record.timestamp < first) first = record.timestamp;
      if (last === null || record.timestamp > last) last = record.timestamp;
    }
  }
  if (first === null || last === null) return [];
  return monthSpanBetween(first, Math.max(last, now));
}

/**
 * 两个时间戳之间的自然月序列（升序，含中间月）。`monthSpanOf` 的底层——
 * G6 工具月历的事件源含 toolCalls 时间戳，直接传时间戳并集，不必绕道
 * 再扫一遍 records。
 */
export function monthSpanBetween(firstTs: number, lastTs: number): MonthKey[] {
  const start = monthKeyOf(firstTs);
  const end = monthKeyOf(lastTs);
  const span: MonthKey[] = [];
  for (let key = start; ; key = nextMonth(key)) {
    span.push(key);
    if (key.year === end.year && key.month === end.month) break;
  }
  return span;
}

/** 月内最后一天的本地零点（partial 末月判定用；day 取 0 即上一个月末）。 */
function lastDayStartOf({ year, month }: MonthKey): number {
  return new Date(year, month, 0).getTime();
}

/** topModel：usage 记录数最多者；并列字典序更小；无任何 usage → null。 */
function topModelOf(calls: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let bestCalls = 0;
  for (const [model, count] of calls) {
    if (best === null || count > bestCalls || (count === bestCalls && model.localeCompare(best) < 0)) {
      best = model;
      bestCalls = count;
    }
  }
  return best;
}

/**
 * 月报。partial 只标首末两张卡：中间月是完整观察月，没有「半月」可言——
 * 空月（没用）与半月（还没过完）是两回事，混标会让界面把空闲月也弱化。
 */
export function buildMonthlyReport(
  sessions: readonly UsageSessionInput[],
  now: number = Date.now()
): MonthlyReport {
  const span = monthSpanOf(sessions, now);
  if (span.length === 0) return { months: [] };

  type MonthAcc = {
    tokens: number;
    messages: number;
    activeDays: Set<number>;
    modelCalls: Map<string, number>;
  };
  const accs = new Map<number, MonthAcc>();

  let firstTs: number | null = null;
  for (const session of sessions) {
    for (const record of session.records) {
      if (firstTs === null || record.timestamp < firstTs) firstTs = record.timestamp;
      const index = monthIndexOf(monthKeyOf(record.timestamp));
      let acc = accs.get(index);
      if (!acc) {
        acc = { tokens: 0, messages: 0, activeDays: new Set(), modelCalls: new Map() };
        accs.set(index, acc);
      }
      // 活跃天按「有任何记录的本地日」——年报同口径，各月加总能与年报对账。
      acc.activeDays.add(dayStartOf(record.timestamp));
      if ((record.kind === "user" || record.kind === "assistant") && record.compactSummary !== true) {
        acc.messages += 1;
      }
      const recordUsage = record.usage;
      if (!recordUsage) continue;
      acc.tokens +=
        (recordUsage.inputTokens ?? 0) +
        (recordUsage.outputTokens ?? 0) +
        (recordUsage.cacheCreationTokens ?? 0) +
        (recordUsage.cacheReadTokens ?? 0);
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      acc.modelCalls.set(model, (acc.modelCalls.get(model) ?? 0) + 1);
    }
  }

  // 首月 partial：最早记录晚于当月 1 号（数据从月中开始，月初没有数据）。
  const firstMonthStart = new Date(span[0].year, span[0].month - 1, 1).getTime();
  const firstPartial = firstTs !== null && dayStartOf(firstTs) > firstMonthStart;
  // 末月 partial：now 还没到当月最后一天（本月只有「到目前为止」的数字）。
  const lastPartial = dayStartOf(now) < lastDayStartOf(span[span.length - 1]);

  const months = span.map((key, i) => {
    const acc = accs.get(monthIndexOf(key));
    return {
      year: key.year,
      month: key.month,
      tokens: acc?.tokens ?? 0,
      messages: acc?.messages ?? 0,
      activeDays: acc?.activeDays.size ?? 0,
      topModel: acc ? topModelOf(acc.modelCalls) : null,
      partial: (i === 0 && firstPartial) || (i === span.length - 1 && lastPartial)
    };
  });
  return { months };
}
