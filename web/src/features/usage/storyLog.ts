import type { SessionRecord } from "../sessions/types";
import { dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 工作日志（G1）：把窗口内的会话按本地自然日折成「那天干了什么」的叙事行。
 *
 * 会话归属日 = 该会话**首条记录**的本地日，不是末日——工作日志回答的是
 * 「那天我开始干了什么」，一个跨午夜的会话在叙事上属于开工那天（写到
 * 凌晨 2 点的会话是「那天晚上开工的活」），把它按末日归类会把同一个活
 * 讲到第二天头上。这和 aggregateSession 的按记录逐条归属日是两种口径、
 * 两种用途：热力图要的是「消耗落在哪」，叙事要的是「活从哪天开始」。
 *
 * 其余口径全部复用既有权威来源：
 *   - tokens = 会话内全部记录的四计数器之和（tokenTotalsOf 同源，缺省计数
 *     记 0）；逐日求和后是当天的会话级合计。
 *   - messages = user/assistant 且非 compactSummary 的记录数
 *     （aggregateSession.messages 同判定，compact 摘要是续接产物不算话）。
 *   - busiestHour = 当天**归属到该日**的会话里消息最多的整点（0–23），
 *     并列取更早（workHabits.peakHour 的「严格大于才换」同款）；当天没有
 *     消息时 null——不猜 0 点。
 *   - busiestHourShare = 该小时消息数 ÷ 当天消息总数（0–1）；没有消息时 0。
 *
 * 空 records 的会话没有归属日（首条记录不存在），直接跳过——「那天开了
 * 会话」这句话需要至少一条记录作证。
 *
 * 输出按日期倒序（最新的一天在最前，日志的阅读顺序）。
 */

/** 一天的叙事行。date 是本地日 YYYY-MM-DD（带补零，可直接做 key）。 */
export type StoryDay = {
  /** 本地自然日，YYYY-MM-DD。 */
  date: string;
  /** 归属到该日的会话数。 */
  sessions: number;
  /** 去重后的项目标签（字典序稳定）。 */
  projects: string[];
  /** 四计数器之和（与 KPI 同口径的单一数字）。 */
  tokens: number;
  /** user/assistant 非 compactSummary 的消息数。 */
  messages: number;
  /** 消息最多的整点（0–23，并列取更早）；当天无消息为 null。 */
  busiestHour: number | null;
  /** busiestHour 的消息数 ÷ 当天消息总数（0–1）；无消息为 0。 */
  busiestHourShare: number;
};

/** 本地日 YYYY-MM-DD（补零）。与快照文件名同款的手动拼法，无 locale 依赖。 */
function dateLabelOf(dayStart: number): string {
  const date = new Date(dayStart);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isMessage(record: SessionRecord): boolean {
  return (
    (record.kind === "user" || record.kind === "assistant") && record.compactSummary !== true
  );
}

function sessionTokens(records: readonly SessionRecord[]): number {
  // 四计数器之和；缺省计数按 0（SessionUsage 的约定），与 tokenTotalsOf 同源。
  let sum = 0;
  for (const record of records) {
    const usage = record.usage;
    if (!usage) continue;
    sum +=
      (usage.inputTokens ?? 0) +
      (usage.outputTokens ?? 0) +
      (usage.cacheCreationTokens ?? 0) +
      (usage.cacheReadTokens ?? 0);
  }
  return sum;
}

type DayAcc = {
  dayStart: number;
  sessions: number;
  projects: Set<string>;
  tokens: number;
  messages: number;
  /** 24 格整点直方图（消息口径）。 */
  hourly: number[];
};

function emptyAcc(dayStart: number): DayAcc {
  return {
    dayStart,
    sessions: 0,
    projects: new Set(),
    tokens: 0,
    messages: 0,
    hourly: new Array<number>(24).fill(0)
  };
}

/**
 * 按自然日聚合的叙事行。纯函数：不做窗口过滤——传进来的 sessions 就是
 * 要讲的那段区间（调用方通常先过 aggregateRange 的窗口边界）。
 */
export function storyLog(sessions: readonly UsageSessionInput[]): StoryDay[] {
  const byDay = new Map<number, DayAcc>();

  for (const session of sessions) {
    const records = session.records;
    if (records.length === 0) continue;

    // 归属日 = 首条记录（records 未必有序，取 min timestamp 更稳）的本地日。
    let firstTs = records[0].timestamp;
    for (const record of records) {
      if (record.timestamp < firstTs) firstTs = record.timestamp;
    }
    const dayStart = dayStartOf(firstTs);

    let acc = byDay.get(dayStart);
    if (!acc) {
      acc = emptyAcc(dayStart);
      byDay.set(dayStart, acc);
    }

    acc.sessions += 1;
    acc.projects.add(session.projectLabel);
    acc.tokens += sessionTokens(records);

    for (const record of records) {
      if (!isMessage(record)) continue;
      acc.messages += 1;
      acc.hourly[new Date(record.timestamp).getHours()] += 1;
    }
  }

  const days: StoryDay[] = [];
  for (const acc of byDay.values()) {
    // 最忙整点：严格大于才换 → 并列天然取更早（与 workHabits.peakHour 同款）。
    let busiestHour: number | null = null;
    let peakCount = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      if (acc.hourly[hour] > peakCount) {
        busiestHour = hour;
        peakCount = acc.hourly[hour];
      }
    }
    days.push({
      date: dateLabelOf(acc.dayStart),
      sessions: acc.sessions,
      projects: [...acc.projects].sort(),
      tokens: acc.tokens,
      messages: acc.messages,
      busiestHour,
      busiestHourShare: busiestHour === null ? 0 : peakCount / acc.messages
    });
  }

  // 日期倒序：最新在前（日志阅读顺序）。dayStart 是本地零点数值，直接比大小。
  days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return days;
}
