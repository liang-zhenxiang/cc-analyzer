import type { UsageTotals, UsageSessionInput } from "./usageAggregations";
import { aggregateAll, formatDayLabel, totalsSum } from "./usageAggregations";

/**
 * 「开发者海报」的纯逻辑（D5）：把全史用量压成一张海报要印的那几行字。
 *
 * 所有数字读 `aggregateAll` 的既有口径——四计数器求和用 `totalsSum`、消息数
 * 读聚合的 `messages`、小时分布读 `hourly`——本模块不重新遍历 records 做第二
 * 次求和：第二套加法迟早和用量页对不上。
 *
 * 「没有数据」的字符串字段一律写 "—"（em dash）：不知道不冒充成 0，这是
 * 全站口径（同 costLedger 的金额列、sessionId 的缺省）。
 */

/** 海报上的一行读数。`topProject` / `topModel` 为 null = 没有任何 token 数据。 */
export type PosterStats = {
  /** 四计数器合计（`kpi.tokens` 同款口径）。 */
  totalTokens: number;
  /** user + assistant 的消息数，压缩摘要不算（聚合 `messages` 同款口径）。 */
  totalMessages: number;
  /** 有动静的本地日天数：daily 桶里 messages 或 token 非零的日子。 */
  activeDays: number;
  /** token 总量最大的项目标签；并列取字典序更小者；零数据 → null。 */
  topProject: string | null;
  /** token 总量最大的模型；并列取字典序更小者；零数据 → null。 */
  topModel: string | null;
  /** 消息最多的小时区间，形如 "14:00–15:00"（本地时区；23 点右端回绕到 00）。 */
  peakHourLabel: string;
  /** 最早活跃日，"M/D"（`formatDayLabel` 同款，不补零）；零数据 → "—"。 */
  firstDay: string;
  /** 最晚活跃日，"M/D"；零数据 → "—"。 */
  lastDay: string;
  /** 最后一个会话的 metadata sessionId；缺失写 "—"。 */
  sessionId: string;
};

const MISSING_LABEL = "—";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** `9 → "09:00–10:00"`；23 点的右端回绕到 00 点（区间是闭开的一小时段）。 */
function hourRangeLabel(hour: number): string {
  return `${pad2(hour)}:00–${pad2((hour + 1) % 24)}:00`;
}

/**
 * token 总量最大的桶标签；并列取字典序更小者——与 `topSlices` 同一条平局
 * 规则（localeCompare，不是码点序，中文标签才符合「字典序」的直觉）。
 * 没有任何正 token 的桶时返回 null：「没有数据」不是「第一名是 0」。
 */
function topLabelOf(buckets: ReadonlyMap<string, UsageTotals>): string | null {
  let best: string | null = null;
  let bestValue = 0;
  for (const [label, totals] of buckets) {
    const value = totalsSum(totals);
    if (value <= 0) continue;
    if (
      value > bestValue ||
      (value === bestValue && best !== null && label.localeCompare(best) < 0)
    ) {
      best = label;
      bestValue = value;
    }
  }
  return best;
}

/**
 * 消息最多的小时（0–23）；并列取更早的小时。输入是聚合的 `hourly`
 * （`[getDay()][hour]` 的消息计数），先跨星期压平成 24 桶再比。全零返回 null。
 */
function peakHourOf(hourly: ReadonlyArray<ReadonlyArray<number>>): number | null {
  let bestHour: number | null = null;
  let bestCount = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    let count = 0;
    for (const day of hourly) {
      count += day[hour] ?? 0;
    }
    // 严格大于：并列时保留先扫到的（更早的）小时。
    if (count > bestCount) {
      bestCount = count;
      bestHour = hour;
    }
  }
  return bestHour;
}

export function buildPosterStats(sessions: UsageSessionInput[], now?: number): PosterStats {
  // `now` 目前不参与任何字段：海报印的是全史事实，不随读数时刻变化。保留参数
  // 是为了与 aggregateRange / buildWeeklyDigest 一族 API 对齐（调用方可钉死
  // 时刻），也给未来的窗口化预留同一个调用点。
  void now;

  const aggregate = aggregateAll(sessions);

  let activeDays = 0;
  let firstDayStart: number | null = null;
  let lastDayStart: number | null = null;
  for (const [dayStart, bucket] of aggregate.daily) {
    if (bucket.messages > 0 || totalsSum(bucket) > 0) activeDays += 1;
    if (firstDayStart === null || dayStart < firstDayStart) firstDayStart = dayStart;
    if (lastDayStart === null || dayStart > lastDayStart) lastDayStart = dayStart;
  }

  const peakHour = peakHourOf(aggregate.hourly);
  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : undefined;

  return {
    totalTokens: totalsSum(aggregate.totals),
    totalMessages: aggregate.messages,
    activeDays,
    topProject: topLabelOf(aggregate.projects),
    topModel: topLabelOf(aggregate.models),
    peakHourLabel: peakHour === null ? MISSING_LABEL : hourRangeLabel(peakHour),
    firstDay: firstDayStart === null ? MISSING_LABEL : formatDayLabel(firstDayStart),
    lastDay: lastDayStart === null ? MISSING_LABEL : formatDayLabel(lastDayStart),
    sessionId: lastSession?.session?.sessionId ?? MISSING_LABEL
  };
}
