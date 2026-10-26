import type { SessionRecord, SessionUsage } from "../sessions/types";
import {
  addLocalDays,
  dayStartOf,
  totalsSum,
  UNKNOWN_MODEL_LABEL,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";
import { estimateCost } from "./pricingSnapshot";

/**
 * 「周战报」的纯逻辑（Round CC F3）。
 *
 * 周界是**本地自然周、周一起始**——与 `weeklyWindow.ts` 的「滚动 7 天」不是同
 * 一个量，这里刻意不复用它的取值函数：滚动窗口回答「我最近用量怎样」（对齐官方
 * 限额的滑动语义），自然周回答「这周比上周怎样」（对齐人复盘时的日历）。日期
 * 数学仍走 `dayStartOf` / `addLocalDays`，不另写一套周算术——DST 那种一天 23
 * 或 25 小时的坑只在那里解过一次。
 *
 * 本模块只算数、不格式化：金额与 token 的显示形态由界面决定（模型层不负责
 * 千分位，这条口径在本仓库里已经重复了四轮）。
 */

/** 本地自然周的起始日：周一（`Date.getDay()` 口径，0 = 周日）。 */
export const WEEK_START_DAY = 1;

/** 一周的一列读数。`usd === null` = 这一周里有未收录定价的模型。 */
export type DigestFigure = {
  tokens: number;
  usd: number | null;
  sessions: number;
  messages: number;
};

/** 变化率（百分比，未四舍五入）；分母为 0 或任一侧不可定价时为 `null`。 */
export type DigestDelta = {
  tokens: number | null;
  usd: number | null;
  sessions: number | null;
  messages: number | null;
};

export type WeeklyDigest = {
  thisWeek: DigestFigure;
  lastWeek: DigestFigure;
  deltas: DigestDelta;
};

type WeekAccumulator = {
  totals: UsageTotals;
  /** 逐模型单独计价——没有「平均模型价」这种东西（同 `usageSnapshot.costOf`）。 */
  models: Map<string, UsageTotals>;
  messages: number;
  sessions: number;
};

const emptyTotals = (): UsageTotals => ({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });

const emptyAccumulator = (): WeekAccumulator => ({
  totals: emptyTotals(),
  models: new Map<string, UsageTotals>(),
  messages: 0,
  sessions: 0
});

function addUsage(target: UsageTotals, usage: SessionUsage): void {
  target.input += usage.inputTokens ?? 0;
  target.output += usage.outputTokens ?? 0;
  target.cacheCreation += usage.cacheCreationTokens ?? 0;
  target.cacheRead += usage.cacheReadTokens ?? 0;
}

/**
 * 会话记录里的一条「消息」，口径与 `aggregateSession` 完全一致：只认 user /
 * assistant，且压缩摘要不算——它是续接产生的工件，不是谁说的话。三处口径
 * 必须同源，否则「消息数」在页面上会出现两个值。
 */
function isConversationMessage(record: SessionRecord): boolean {
  if (record.kind !== "user" && record.kind !== "assistant") return false;
  return record.compactSummary !== true;
}

/** 本地自然周的周一零点（含）。 */
export function weekStartOf(ts: number): number {
  const day = dayStartOf(ts);
  const weekday = new Date(day).getDay();
  const offset = (weekday - WEEK_START_DAY + 7) % 7;
  return addLocalDays(day, -offset);
}

/**
 * 环比百分比。
 *
 * 上周为 0 时返回 `null` 而不是 100% / ∞：那时候不是「涨了」，是还没有基线，
 * 编一个数字出来只会让读者以为读到了趋势。`usd` 任一侧为 `null`（未知价）
 * 同样返回 `null`——两边不同分母的百分比没有意义。
 */
function deltaOf(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * 一周的估算成本：逐模型按自己的族价折算后相加。
 *
 * 只要这一周里出现过**任何一个**未收录定价的模型就整体返回 `null`，而不是把
 * 认得的那些加起来当作总额——「$3.20 + 未知」写成 $3.20 是账单形状的谎话。
 * 与 `usageSnapshot.costOf` 的 `hasUnknown` 是同一个立场，区别只在展示层：
 * 那边同时给出 `unknownTokens` 让用户看见缺口，这里只留 `null`，表格里的五列
 * 不因为一个未知模型就多两列。
 */
function usdOf(accumulator: WeekAccumulator): number | null {
  let usd = 0;
  for (const [model, totals] of accumulator.models) {
    const estimate = estimateCost(totals, model);
    if ("unknownModel" in estimate) return null;
    usd += estimate.usd;
  }
  return usd;
}

function figureOf(accumulator: WeekAccumulator): DigestFigure {
  return {
    tokens: totalsSum(accumulator.totals),
    usd: usdOf(accumulator),
    sessions: accumulator.sessions,
    messages: accumulator.messages
  };
}

/**
 * 两周战报。单趟 O(records) 扫描，不排序、不建索引——它挂在渲染路径上，
 * 和页面上其它聚合走同一条预算。
 *
 * `now` 决定「本周」，未来的时间戳（日志时间比本机快）不会落进任何一周：区间
 * 是半开的 `[start, end)`，宁可少算一条已经写进来的记录，也不让「本周」包含
 * 还没发生的事。
 */
export function buildWeeklyDigest(
  inputs: readonly UsageSessionInput[],
  now: number
): WeeklyDigest {
  const thisStart = weekStartOf(now);
  const thisEnd = addLocalDays(thisStart, 7);
  const lastStart = addLocalDays(thisStart, -7);

  const thisAcc = emptyAccumulator();
  const lastAcc = emptyAccumulator();

  for (const input of inputs) {
    // 会话数按「这一周里说过话」计一次，而不是按会话跨越的次数——一个会话在
    // 两周都有消息就两周各算一次，这才是「本周做了几个会话」。
    let touchedThis = false;
    let touchedLast = false;

    for (const record of input.records) {
      const timestamp = record.timestamp;
      if (!Number.isFinite(timestamp)) continue;

      const accumulator =
        timestamp >= thisStart && timestamp < thisEnd
          ? thisAcc
          : timestamp >= lastStart && timestamp < thisStart
            ? lastAcc
            : null;
      if (accumulator === null) continue;

      if (accumulator === thisAcc) touchedThis = true;
      else touchedLast = true;

      if (isConversationMessage(record)) accumulator.messages += 1;

      const usage = record.usage;
      if (!usage) continue;
      addUsage(accumulator.totals, usage);

      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      let modelTotals = accumulator.models.get(model);
      if (!modelTotals) {
        modelTotals = emptyTotals();
        accumulator.models.set(model, modelTotals);
      }
      addUsage(modelTotals, usage);
    }

    if (touchedThis) thisAcc.sessions += 1;
    if (touchedLast) lastAcc.sessions += 1;
  }

  const thisWeek = figureOf(thisAcc);
  const lastWeek = figureOf(lastAcc);

  return {
    thisWeek,
    lastWeek,
    deltas: {
      tokens: deltaOf(thisWeek.tokens, lastWeek.tokens),
      usd:
        thisWeek.usd === null || lastWeek.usd === null
          ? null
          : deltaOf(thisWeek.usd, lastWeek.usd),
      sessions: deltaOf(thisWeek.sessions, lastWeek.sessions),
      messages: deltaOf(thisWeek.messages, lastWeek.messages)
    }
  };
}

/**
 * 两周都没有可看的量时界面写「还没有可对比的周」，而不是四行 `0`。
 * 判据只看会话与 token：只有消息、没有任何模型调用的周仍然是一周有内容。
 */
export function isEmptyDigest(digest: WeeklyDigest): boolean {
  return (
    digest.thisWeek.sessions === 0 &&
    digest.lastWeek.sessions === 0 &&
    digest.thisWeek.tokens === 0 &&
    digest.lastWeek.tokens === 0
  );
}
