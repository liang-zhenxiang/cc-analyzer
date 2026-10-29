import { sessionTitle } from "../sessions/metadataCache";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import type { SessionRecord } from "../sessions/types";

/**
 * 对话心跳（F8）的数据层：取窗口内**最近一个有活动的自然日**，把 user /
 * assistant / tool 三类记录压成三条分钟通道。
 *
 * 口径（与设计规格 §2.8 一致）：
 *
 * - 只画 `user` / `assistant` / `tool`。`wait` 是合成的停顿行，`system` 是
 *   压缩边界——它们不是「有人在说话」的节奏，画进来会把安静误读成活动。
 * - 竖线高度 = 该分钟内的记录条数。**不做折线**：没有事件的分钟不该连出
 *   一条不存在的线。
 * - 最长静默 = 当天相邻两条记录之间的最大间隔。零宽间隔不是停顿，单条
 *   记录没有「相邻」，两者都返回 `null`。
 *
 * 支持两种范围：`day` 跨会话看一天；`session` 只看一个会话（会话选项按
 * 窗口内最近活动时间排序，缺省取最近的那个）。
 */

export type HeartbeatChannelId = "user" | "assistant" | "tool";
export type HeartbeatScope = "day" | "session";

export type HeartbeatPulse = {
  /** 当天第几分钟，0–1439。 */
  minute: number;
  count: number;
};

export type HeartbeatChannel = {
  id: HeartbeatChannelId;
  label: string;
  total: number;
  /** 该通道单分钟计数的峰值；为 0 时该通道只有基线。 */
  peak: number;
  /** 按 minute 升序，只含有事件的分钟。 */
  pulses: HeartbeatPulse[];
};

export type HeartbeatSilence = {
  startTs: number;
  endTs: number;
  durationMs: number;
};

export type HeartbeatSessionOption = {
  key: string;
  label: string;
  latestTs: number;
};

export type HeartbeatData = {
  /** `null` = 窗口内没有可画的记录（空态）。 */
  dayStart: number | null;
  scope: HeartbeatScope;
  channels: HeartbeatChannel[];
  /** 当天被画出的记录总数。 */
  records: number;
  longestSilence: HeartbeatSilence | null;
  /** 窗口内有活动的会话，按最近活动时间降序——单会话模式的选择项。 */
  sessions: HeartbeatSessionOption[];
  selectedSessionKey: string | null;
  selectedSessionLabel: string | null;
};

export const HEARTBEAT_CHANNEL_LABELS: Record<HeartbeatChannelId, string> = {
  user: "用户",
  assistant: "助手",
  tool: "工具"
};

/** 与 aggregateRange / toolCensus 同一份窗口边界。 */
function windowStartOf(days: number, now: number): number {
  return addLocalDays(dayStartOf(now), -(Math.max(1, Math.floor(days)) - 1));
}

function channelOf(record: SessionRecord): HeartbeatChannelId | null {
  if (record.kind === "user") return "user";
  if (record.kind === "assistant") return "assistant";
  if (record.kind === "tool") return "tool";
  return null;
}

type Event = { at: number; channel: HeartbeatChannelId; sessionKey: string };

function emptyChannels(): HeartbeatChannel[] {
  return (["user", "assistant", "tool"] as const).map((id) => ({
    id,
    label: HEARTBEAT_CHANNEL_LABELS[id],
    total: 0,
    peak: 0,
    pulses: []
  }));
}

/** 「2 小时 14 分」——轴下的静默标注。 */
export function formatSilence(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 分";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
  return `${minutes} 分`;
}

/** 「2h14m」——读数行里的紧凑写法。 */
export function formatSilenceCompact(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

export function buildHeartbeat(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  options: { scope?: HeartbeatScope; sessionKey?: string } = {}
): HeartbeatData {
  const scope = options.scope ?? "day";
  const startTs = windowStartOf(days, now);

  const events: Event[] = [];
  const sessionLatest = new Map<string, HeartbeatSessionOption>();

  inputs.forEach((input, index) => {
    const key = input.session?.path ?? `input-${index}`;
    const label = input.session ? sessionTitle(input.session) : input.projectLabel;
    for (const record of input.records) {
      if (record.timestamp < startTs) continue;
      const channel = channelOf(record);
      if (!channel) continue;
      events.push({ at: record.timestamp, channel, sessionKey: key });
      const known = sessionLatest.get(key);
      if (
        !known ||
        record.timestamp > known.latestTs ||
        (record.timestamp === known.latestTs && label.localeCompare(known.label) < 0)
      ) {
        sessionLatest.set(key, { key, label, latestTs: record.timestamp });
      }
    }
  });

  const sessions = [...sessionLatest.values()].sort(
    (a, b) => b.latestTs - a.latestTs || a.label.localeCompare(b.label) || a.key.localeCompare(b.key)
  );

  let scoped = events;
  let selectedSessionKey: string | null = null;
  let selectedSessionLabel: string | null = null;
  if (scope === "session" && sessions.length > 0) {
    const selected =
      sessions.find((session) => session.key === options.sessionKey) ?? sessions[0];
    selectedSessionKey = selected.key;
    selectedSessionLabel = selected.label;
    scoped = events.filter((event) => event.sessionKey === selected.key);
  }

  if (scoped.length === 0) {
    return {
      dayStart: null,
      scope,
      channels: emptyChannels(),
      records: 0,
      longestSilence: null,
      sessions,
      selectedSessionKey,
      selectedSessionLabel
    };
  }

  // 最近一个有活动的自然日：取被画出的记录里最晚的时间戳所在的本地日。
  const latestTs = scoped.reduce((max, event) => Math.max(max, event.at), 0);
  const dayStart = dayStartOf(latestTs);
  const dayEnd = addLocalDays(dayStart, 1);
  const dayEvents = scoped.filter((event) => event.at >= dayStart && event.at < dayEnd);

  const buckets = new Map<HeartbeatChannelId, Map<number, number>>();
  for (const id of ["user", "assistant", "tool"] as const) buckets.set(id, new Map());

  const timestamps: number[] = [];
  for (const event of dayEvents) {
    const bucket = buckets.get(event.channel)!;
    const minute = Math.min(1439, Math.max(0, Math.floor((event.at - dayStart) / 60_000)));
    bucket.set(minute, (bucket.get(minute) ?? 0) + 1);
    timestamps.push(event.at);
  }

  const channels = emptyChannels().map((channel) => {
    const bucket = buckets.get(channel.id)!;
    const pulses = [...bucket.entries()]
      .map(([minute, count]) => ({ minute, count }))
      .sort((a, b) => a.minute - b.minute);
    const total = pulses.reduce((sum, pulse) => sum + pulse.count, 0);
    const peak = pulses.reduce((max, pulse) => Math.max(max, pulse.count), 0);
    return { ...channel, total, peak, pulses };
  });

  // 最大相邻间隔，并列取更早的一对（`>` 而非 `>=`）。
  timestamps.sort((a, b) => a - b);
  let longestSilence: HeartbeatSilence | null = null;
  for (let index = 0; index + 1 < timestamps.length; index += 1) {
    const gap = timestamps[index + 1] - timestamps[index];
    if (gap > 0 && (longestSilence === null || gap > longestSilence.durationMs)) {
      longestSilence = { startTs: timestamps[index], endTs: timestamps[index + 1], durationMs: gap };
    }
  }

  return {
    dayStart,
    scope,
    channels,
    records: dayEvents.length,
    longestSilence,
    sessions,
    selectedSessionKey,
    selectedSessionLabel
  };
}
