import type { SessionRecord } from "../sessions/types";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 工作习惯（D8）：从用量页同一份 `UsageSessionInput` 里读「什么时候干活、
 * 能连干几天、单会话最长多久」。
 *
 * 口径（全部落在本地时区，与 aggregateSession / 用量页的热力图一致）：
 *   - 「消息」= `kind` 为 user 或 assistant 且 **不是 compactSummary** 的记录。
 *     compact summary 是续接产物，不算用户说的话（aggregateSession.messages
 *     同一口径）。
 *   - chrono 类型用**消息条数占比**衡量：5–11 点（含两端，7 个整点）与
 *     17–23 点（含两端，7 个整点）的占比之差。分母是**全部 24 小时**的消息数，
 *     这样两段占比可以直接相减成「百分点」；差 <15pp 说明作息重心两段都没有，
 *     就是「均衡」——不给用户按一个更窄的窗去猜倾向。
 *   - streak 只认真实有消息的本地日；连续判定用日历加法（addLocalDays，
 *     DST 安全），不是 `+86400000`。今天或昨天必须有活动，否则当前连击为 0
 *     （隔了一整天没干活，连击就断了）；从有活动的那天往回数。
 *   - longestSessionMinutes 用会话 records 的 min/max timestamp——含等待、
 *     工具、压缩这些行，因为「一个会话开了多久」问的是墙钟跨度，不是排除了
 *     等待的活跃时长（活跃时长另有 duration.ts 的分解口径，不要混用）。
 *   - peakHour 是消息最多的整点，并列取更早（更小的 hour）：5 点和 17 点同样
 *     多时取 5 点——与 replayModel 的「并列取更早」同款，不靠「下午更可能」
 *     这种猜测。
 */

/** 早鸟观察窗：5–11 点（含 5 与 11）。 */
export const MORNING_HOURS = { start: 5, end: 11 } as const;

/** 夜猫观察窗：17–23 点（含 17 与 23）。与早鸟窗同宽（7 小时），比较才公平。 */
export const EVENING_HOURS = { start: 17, end: 23 } as const;

/** 两窗占比差达到这个百分点才判早鸟/夜猫，否则均衡。 */
export const CHRONO_THRESHOLD_PP = 15;

export type ChronoType = "早鸟" | "夜猫" | "均衡";

export type WorkHabits = {
  chronoType: ChronoType;
  /** 从今天（或昨天）往回连续有消息的本地日数；今天和昨天都没活动为 0。 */
  currentStreak: number;
  /** 历史上最长的连续有消息本地日数。 */
  longestStreak: number;
  /** 单会话首末记录间隔（分钟，四舍五入）；没有 ≥2 条记录的会话为 0。 */
  longestSessionMinutes: number;
  /** 消息最多的整点；没有任何消息时为 null。 */
  peakHour: number | null;
  /** 峰值小时消息数 / 全部消息数，0–1；没有消息为 0。 */
  peakHourShare: number;
};

/** 一条消息记录（口径见模块头注释）：user/assistant 且非 compact summary。 */
function isMessage(record: SessionRecord): boolean {
  return (
    (record.kind === "user" || record.kind === "assistant") && record.compactSummary !== true
  );
}

function inWindow(hour: number, start: number, end: number): boolean {
  return hour >= start && hour <= end;
}

/**
 * 计算工作习惯。纯函数：`now` 显式传入，用于判定「今天/昨天」的连击锚点。
 */
export function workHabits(
  sessions: readonly UsageSessionInput[],
  now: number
): WorkHabits {
  const hourly = new Array<number>(24).fill(0);
  const activeDays = new Set<number>();
  let totalMessages = 0;
  let longestSessionMinutes = 0;

  for (const session of sessions) {
    // 最长会话与消息无关：没有对话也可能有记录（工具/等待行）。
    const records = session.records;
    if (records.length >= 2) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const record of records) {
        if (record.timestamp < min) min = record.timestamp;
        if (record.timestamp > max) max = record.timestamp;
      }
      const minutes = Math.round((max - min) / 60_000);
      if (minutes > longestSessionMinutes) longestSessionMinutes = minutes;
    }

    for (const record of records) {
      if (!isMessage(record)) continue;
      const at = new Date(record.timestamp);
      hourly[at.getHours()] += 1;
      activeDays.add(dayStartOf(record.timestamp));
      totalMessages += 1;
    }
  }

  let morning = 0;
  let evening = 0;
  for (let hour = MORNING_HOURS.start; hour <= MORNING_HOURS.end; hour += 1) {
    morning += hourly[hour];
  }
  for (let hour = EVENING_HOURS.start; hour <= EVENING_HOURS.end; hour += 1) {
    evening += hourly[hour];
  }
  const diffPp = totalMessages > 0 ? ((morning - evening) / totalMessages) * 100 : 0;
  const chronoType: ChronoType =
    diffPp >= CHRONO_THRESHOLD_PP ? "早鸟" : diffPp <= -CHRONO_THRESHOLD_PP ? "夜猫" : "均衡";

  // 当前连击：今天没消息就从昨天起算；两天都没有则 0（不是「从最后一次活动」无限往回数）。
  const today = dayStartOf(now);
  const yesterday = addLocalDays(today, -1);
  let anchor: number | null = activeDays.has(today) ? today : activeDays.has(yesterday) ? yesterday : null;
  let currentStreak = 0;
  while (anchor !== null && activeDays.has(anchor)) {
    currentStreak += 1;
    anchor = addLocalDays(anchor, -1);
  }

  // 历史最长：按日升序扫一遍，日历相邻（而不是 24h 差值）才算连续。
  const orderedDays = [...activeDays].sort((a, b) => a - b);
  let longestStreak = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of orderedDays) {
    run = previous !== null && addLocalDays(previous, 1) === day ? run + 1 : 1;
    if (run > longestStreak) longestStreak = run;
    previous = day;
  }

  let peakHour: number | null = null;
  let peakCount = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    // 严格大于才换：空位/并列都保留更早的那个小时。
    if (hourly[hour] > peakCount) {
      peakHour = hour;
      peakCount = hourly[hour];
    }
  }

  return {
    chronoType,
    currentStreak,
    longestStreak,
    longestSessionMinutes,
    peakHour,
    peakHourShare: peakHour === null ? 0 : peakCount / totalMessages
  };
}

/** 供测试与界面复用：某条记录落在哪个观察窗（null = 两窗之外）。 */
export function chronoWindowOf(hour: number): "morning" | "evening" | null {
  return inWindow(hour, MORNING_HOURS.start, MORNING_HOURS.end)
    ? "morning"
    : inWindow(hour, EVENING_HOURS.start, EVENING_HOURS.end)
      ? "evening"
      : null;
}
