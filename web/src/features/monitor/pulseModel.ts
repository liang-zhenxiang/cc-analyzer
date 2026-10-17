import { basename, sessionDirectory } from "../../lib/path";
import {
  compactionAnchors,
  contextSeriesOf,
  type CompactionAnchor
} from "../sessions/contextSeries";
import { sessionTitle, type SessionMeta } from "../sessions/metadataCache";
import type {
  CompactEvent,
  ContextSample,
  SessionRecord,
  SessionUsage
} from "../sessions/types";
import { BILLING_WINDOW_MS } from "../usage/billingWindow";
import { totalsSum } from "../usage/usageAggregations";

/**
 * 脉搏视图的纯逻辑层（design.md §5）。这里每个函数都只吃显式输入、
 * 显式 `now`，不读全局时钟也不碰文件系统——渲染组件与 `usePulseFeed`
 * 共享同一份被测试钉死的口径。
 */

/** 新近度阈值：≤2 分钟算「刚有记录」。 */
export const LIVE_MS = 120_000;
/** 新近度阈值：≤15 分钟算「最近还有记录」。 */
export const RECENT_MS = 900_000;

export type Recency = "live" | "recent" | "idle";

/**
 * 三档新近度。两个阈值都是**闭区间**：正好 120 秒、正好 900 秒仍算上一档——
 * 毫秒级的抖动不该把刚写完的会话推进「更早」。
 *
 * 负年龄（日志时间戳领先本机时钟）按「刚刚」处理：它确实刚写过。
 * 非有限的年龄无法比较，就说「更早」——「live」是一句事实断言，不能靠猜。
 */
export function recencyOf(ageMs: number): Recency {
  if (!Number.isFinite(ageMs)) return "idle";
  const age = Math.max(0, ageMs);
  if (age <= LIVE_MS) return "live";
  if (age <= RECENT_MS) return "recent";
  return "idle";
}

const MINUTE_MS = 60_000;

/** 速率曲线的默认桶数：最近 60 分钟（R3）。 */
export const RATE_BUCKET_MINUTES = 60;

/**
 * 本地整分钟的起点。走本地日期字段而不是 `Math.floor(ts / 60000) * 60000`：
 * 后者只有在本地偏移是整分钟时才等价，而日历聚合（`dayStartOf`）走的也是本地字段，
 * 两条口径必须一致，否则「今天 12:05 这一分钟」在两张图里会差一截。
 */
function minuteStartOf(timestamp: number): number {
  const date = new Date(timestamp);
  date.setSeconds(0, 0);
  return date.getTime();
}

export type RateBucket = {
  /** 桶起点的本地整分钟（ms）。 */
  start: number;
  /** 桶内四类 token 之和（`totalsSum` 口径）。 */
  tokens: number;
  /** 只有「包含 now 的那一桶」为 true——它还没走完，不能当整分钟画（R3）。 */
  partial: boolean;
};

/**
 * 最近 `minutes` 个本地整分钟的 token 桶，最后一桶是当前这（未走完的）分钟。
 * 无 `usage` 的记录不计；跨分钟边界的记录归到它 `timestamp` 所在的那一分钟。
 */
export function rateBuckets(
  records: readonly SessionRecord[],
  now: number,
  minutes: number = RATE_BUCKET_MINUTES
): RateBucket[] {
  // `now` 缺失时整个窗口都不成立；桶数不是正整数时也没有可画的窗口。
  if (!Number.isFinite(now) || !Number.isFinite(minutes) || minutes < 1) return [];

  const count = Math.floor(minutes);
  const lastStart = minuteStartOf(now);
  const buckets: RateBucket[] = [];
  const indexByStart = new Map<number, number>();
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    // 先按 epoch 回退再重新对齐，夏令时切换点上也不会漂出整分钟。
    const start = minuteStartOf(lastStart - offset * MINUTE_MS);
    indexByStart.set(start, buckets.length);
    buckets.push({ start, tokens: 0, partial: offset === 0 });
  }

  for (const record of listOf(records)) {
    const usage = record.usage;
    if (!usage) continue;
    const timestamp = record.timestamp;
    // 非有限时间戳按「不属于任何窗口」处理：它一旦算出 NaN 索引就会把整条曲线带歪。
    if (!Number.isFinite(timestamp)) continue;
    const index = indexByStart.get(minuteStartOf(timestamp));
    if (index === undefined) continue;
    buckets[index].tokens += tokensOf(usage);
  }

  return buckets;
}

/**
 * 窗口内的**实测**速率，单位 tokens/小时——与 `burnRateOf` 同单位，便于并排显示。
 * 只统计 `[now - windowMs, now]` 内的记录，不外推、不补零：窗口未走满时它就是窗口内的均值。
 */
export function recentRate(
  records: readonly SessionRecord[],
  now: number,
  windowMs: number
): number {
  // 窗口长度非正或非有限时没有速率可言，返回 0 而不是 Infinity/NaN。
  if (!Number.isFinite(now) || !Number.isFinite(windowMs) || windowMs <= 0) return 0;

  const from = now - windowMs;
  let tokens = 0;
  for (const record of listOf(records)) {
    const usage = record.usage;
    if (!usage) continue;
    const timestamp = record.timestamp;
    // 上界含在内（窗口是闭区间）；未来的时间戳不算——时钟偏移时宁可少算，
    // 也不能让一条还没发生的记录抬高速率。
    if (!Number.isFinite(timestamp) || timestamp < from || timestamp > now) continue;
    tokens += tokensOf(usage);
  }
  return (tokens / windowMs) * 3_600_000;
}

/** 上下文曲线的默认样本数：最近 40 次调用（R5）。 */
export const CONTEXT_PANEL_DEFAULT_COUNT = 40;

export type ContextPanel = {
  /** `contextSeriesOf` 的尾部 `count` 个样本（不足则全取）。 */
  samples: ContextSample[];
  /** 断崖锚点，索引已平移到 `samples` 坐标系里。 */
  anchors: CompactionAnchor[];
};

/**
 * 上下文窗口：尾部截断后的样本 + 落在窗口内的压缩断崖。
 *
 * 锚点先在**整条序列**上定位再整体左移，并丢掉窗口外的那些：如果直接对截断后的
 * 序列调用 `compactionAnchors`，被截掉的那次压缩会退化到 `beforeIndex = -1`，
 * 在图上画出一条位于窗口最左边、其实并不存在的断崖。
 */
export function contextPanel(
  records: readonly SessionRecord[],
  events: readonly CompactEvent[],
  count: number = CONTEXT_PANEL_DEFAULT_COUNT
): ContextPanel {
  const all = contextSeriesOf(listOf(records));
  const limit = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : CONTEXT_PANEL_DEFAULT_COUNT;
  const start = Math.max(0, all.length - limit);
  const samples = all.slice(start);

  const anchors = compactionAnchors(all, listOf(events))
    // 断崖要画得出来，得同时看得见崖上（beforeIndex）与崖下（afterIndex）两个样本。
    .filter((anchor) => anchor.beforeIndex >= start && anchor.afterIndex < all.length)
    .map((anchor) => ({
      ...anchor,
      beforeIndex: anchor.beforeIndex - start,
      afterIndex: anchor.afterIndex - start
    }));

  return { samples, anchors };
}

/** 参考带至少要 3 次压缩才画（R5）。 */
export const COMPACTION_BAND_MIN_SAMPLES = 3;
/** 参考带只取最近 5 次压缩（R5）。 */
export const COMPACTION_BAND_MAX_SAMPLES = 5;

export type CompactionBand =
  | { min: number; max: number; n: number }
  | { insufficient: true; n: number };

/**
 * 自动压缩前的上下文体量区间（R5）。
 *
 * 只认 `trigger === "auto"` 且 `preTokens !== null` 的事件：手动 `/compact`
 * 不是模型的自动阈值，混进来会把「离自动压缩还有多远」算歪；`preTokens` 为
 * null 是「日志里没有这个数」，不是 0。取最近至多 5 次，n < 3 不画。
 *
 * 前置条件：`events` 按文件顺序（即时间顺序）给出，`parseJsonl` 的输出就是这个顺序。
 */
export function compactionBand(events: readonly CompactEvent[]): CompactionBand {
  const preTokens: number[] = [];
  for (const event of listOf(events)) {
    if (event.trigger !== "auto") continue;
    // 非有限的 preTokens 会污染 min/max（NaN 比较恒假），按「没有这个数」丢掉。
    if (event.preTokens === null || !Number.isFinite(event.preTokens)) continue;
    preTokens.push(event.preTokens);
  }

  const recent = preTokens.slice(-COMPACTION_BAND_MAX_SAMPLES);
  const n = recent.length;
  if (n < COMPACTION_BAND_MIN_SAMPLES) return { insufficient: true, n };
  return { min: Math.min(...recent), max: Math.max(...recent), n };
}

/**
 * 活跃会话的窗口：最近 5 小时内有记录/mtime（R2）。与 5 小时计费窗口是同一个
 * 时长，直接取 `BILLING_WINDOW_MS`，两个数字在仓库里只有一处定义。
 */
export const RECENT_ACTIVITY_WINDOW_MS = BILLING_WINDOW_MS;

export type SessionRowInput = {
  session: SessionMeta;
  records: readonly SessionRecord[];
  /** 由 `usePulseFeed` 从文件头解析出的标题（§4）；读不到时留空走兜底。 */
  title?: string | null;
};

export type SessionRow = {
  path: string;
  /** 已经过兜底的展示标题，不会为空串。 */
  title: string;
  projectLabel: string;
  /** `now − 最近一次记录/mtime`；换算成负数时夹到 0（时钟偏移下不显示未来）。 */
  ageMs: number;
  recency: Recency;
  /** 排序与年龄所用的时间点：mtime 与记录时间戳的较大者。 */
  lastActivityMs: number;
};

/**
 * 活跃会话行：最近 5 小时内有 mtime 或记录更新的会话，按最近活动时间倒序。
 * 只陈述「多久前有新记录」，不声称会话正在运行（design.md §8 的推论限制）。
 */
export function sessionRows(
  inputs: readonly SessionRowInput[],
  now: number
): SessionRow[] {
  if (!Number.isFinite(now)) return [];

  const cutoff = now - RECENT_ACTIVITY_WINDOW_MS;
  const rows: SessionRow[] = [];
  for (const input of listOf(inputs)) {
    const lastActivityMs = lastActivityOf(input);
    // mtime 与记录时间都读不到：这条会话放不进时间轴，宁可不列它，也不编一个时间。
    if (lastActivityMs === null) continue;
    // 边界含在内：正好 5 小时前有活动的会话仍算活跃（与 `recentSessionsFor` 的收窄口径一致）。
    if (lastActivityMs < cutoff) continue;

    const ageMs = Math.max(0, now - lastActivityMs);
    rows.push({
      path: input.session.path,
      title: rowTitle(input),
      projectLabel: input.session.projectLabel,
      ageMs,
      recency: recencyOf(ageMs),
      lastActivityMs
    });
  }

  // 时间相同时按路径排序：两次列表顺序不同不能让行来回跳。
  return rows.sort(
    (a, b) =>
      b.lastActivityMs - a.lastActivityMs ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );
}

/** 兜底标题：项目标签 + 会话 id 前 8 位，不留空（§4）。 */
export function fallbackSessionTitle(session: SessionMeta): string {
  // 已补全的元数据里若有真标题就直接用（归档会话走这条）；活跃会话必然 pending，
  // 拿不到标题也没关系——id 从文件名取，Claude Code 的会话文件名就是 <sessionId>.jsonl。
  const known = sessionTitle(session);
  if (known !== session.projectLabel) return known;

  const id = session.sessionId ?? basename(sessionDirectory(session.path));
  const prefix = id.trim().slice(0, 8);
  return prefix ? `${session.projectLabel} · ${prefix}` : session.projectLabel;
}

function rowTitle(input: SessionRowInput): string {
  const explicit = input.title?.trim();
  return explicit ? explicit : fallbackSessionTitle(input.session);
}

function lastActivityOf(input: SessionRowInput): number | null {
  let latest = Number.isFinite(input.session.mtimeMs) ? input.session.mtimeMs : null;
  for (const record of input.records) {
    const timestamp = record.timestamp;
    if (!Number.isFinite(timestamp)) continue;
    if (latest === null || timestamp > latest) latest = timestamp;
  }
  return latest;
}

/** 四类 token 之和；缺字段是 0（`SessionUsage` 的约定），非有限值同样降级为 0。 */
function tokensOf(usage: SessionUsage): number {
  return totalsSum({
    input: finiteOrZero(usage.inputTokens),
    output: finiteOrZero(usage.outputTokens),
    cacheCreation: finiteOrZero(usage.cacheCreationTokens),
    cacheRead: finiteOrZero(usage.cacheReadTokens)
  });
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 输入集合可能是 undefined/null（调用方的数据还没到位）。整条脉搏视图挂在
 * 一次渲染里，缺数据时给一个空窗口比抛异常炸掉整个页面好。
 */
function listOf<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}
