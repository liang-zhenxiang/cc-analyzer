import { formatClock, formatTokenCount } from "../../lib/format";
import type { AnomalyDay } from "./anomalyDays";
import type { LimitForecast } from "./limitForecast";
import type { WeeklyDigest } from "./weeklyDigest";

/**
 * H1「晨报」的纯逻辑。
 *
 * 它不重新算任何聚合——输入就是既有模块的输出（周战报、异常日、限额预报、
 * 错误总数、昨日/前日用量）。这个模块只做两件事：按写死的优先级挑 3 条以内
 * 值得一早看一眼的事实，并把每条压成一句中文短句。
 *
 * 为什么排序写死而不是打权重分：晨报只有 3 个位置，「三件事按重要性排」比
 * 「六个维度加权求和」更好解释，也更不容易在阈值边缘抖来抖去。优先级：
 *
 *   1. budget   预算将穿（预计 ≥ 限额的 85%）——最可能造成当天决策变化；
 *   2. anomaly  最近 7 天出现 z ≥ 2 的异常日——「昨天不对劲」需要立刻知道；
 *   3. errors   错误总数 ≥ 10 条——量大到已经不是偶发；
 *   4. spike    昨日相对前日 ≥ +50%——陡增先于陡降，因为陡增意味着继续烧；
 *   5. drop     昨日相对前日 ≤ −50%——多半想问「我是不是没怎么干活」；
 *   6. quiet    连续 0 消息 ≥ 3 天——兜底提醒，别让晨报整天空着。
 *
 * 少于 3 条就少给：空着的 rank 不编内容，晨报不该为了凑数说废话。
 */

export type BriefingKind = "spike" | "drop" | "anomaly" | "budget" | "errors" | "quiet";

/** 点开晨报条目后要去的位置（页面锚点由界面层映射）。 */
export type BriefingTarget = "usage" | "errors" | "milestones" | "lab";

export type BriefingItem = {
  /** 稳定 id：同一种 kind 至多一条，因此 kind 即可区分。 */
  id: string;
  /** 1–3，1 最重要。 */
  rank: number;
  kind: BriefingKind;
  /** 中文短句，≤ 20 字，不带惊叹号。 */
  headline: string;
  /** 可选的第二行：数字依据，界面决定是否展示。 */
  detail?: string;
  target: BriefingTarget;
};

export type DailyBriefing = {
  items: BriefingItem[];
  /** 生成时刻（毫秒）。纯逻辑不读时钟：由调用方传入或走默认参数。 */
  generatedAt: number;
};

export type BriefingInput = {
  weekly: WeeklyDigest;
  anomalies: AnomalyDay[];
  forecast: LimitForecast | null;
  errorStats: { total: number } | null;
  /** 昨日 token 合计。 */
  yesterdayTokens: number;
  /** 前日 token 合计；作为环比的分母。 */
  prevTokens: number;
  /**
   * 连续「0 消息」的天数（含今天/昨天），由调用方按日历算好。
   *
   * 为什么不在模块里自己算：输入契约里没有逐日消息数，硬从 token 为 0 推
   * 「0 消息」会把「在跑长任务没回话」误判成安静。没有这个字段时安静提醒
   * 这条不触发，也不拿别的信号凑。
   */
  quietDays?: number;
};

export const MAX_BRIEFING_ITEMS = 3;
/** 预算告警线：预计用量达到限额的 85%。 */
export const BUDGET_ALERT_PCT = 85;
/** 错误聚集线：窗口内错误总数 ≥ 10。 */
export const ERROR_ALERT_TOTAL = 10;
/** 环比陡增/陡降线：±50%。 */
export const SWING_RATIO = 0.5;
/** 安静提醒线：连续 ≥ 3 天没有消息。 */
export const QUIET_ALERT_DAYS = 3;
/** 异常日只看最近 7 天。 */
export const ANOMALY_RECENT_DAYS = 7;
/** 异常日的 z 分数门槛（与 anomalyDays 的 spike 判定一致）。 */
export const ANOMALY_Z_ALERT = 2;

const DAY_MS = 86_400_000;

/** 一条晨报草稿：还没拿到 rank。 */
type Candidate = Omit<BriefingItem, "rank">;

const targetOf: Record<BriefingKind, BriefingTarget> = {
  budget: "usage",
  anomaly: "usage",
  spike: "usage",
  drop: "usage",
  errors: "errors",
  // 安静时顺手引导去看里程碑：不是「你偷懒了」，是「这周想留下什么」。
  quiet: "milestones"
};

function isFiniteCount(value: number): boolean {
  return Number.isFinite(value);
}

/** 「YYYY-MM-DD」（UTC 日号）→ UTC 零点毫秒；解析失败返回 null。 */
function dayMsOf(label: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const ms = Date.UTC(year, month - 1, day);
  const probe = new Date(ms);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return ms;
}

function budgetItem(forecast: LimitForecast | null): Candidate | null {
  if (!forecast) return null;
  if (!Number.isFinite(forecast.projectedPct) || forecast.projectedPct < BUDGET_ALERT_PCT) {
    return null;
  }
  const pct = Math.round(forecast.projectedPct);
  if (pct < BUDGET_ALERT_PCT) return null;
  return {
    id: "budget",
    kind: "budget",
    headline: `限额预计用到 ${pct}%`,
    detail:
      forecast.hitTime !== null
        ? `按当前速率 ${formatClock(forecast.hitTime)} 触顶`
        : `保持当前速率，窗口结束预计 ${pct}%`,
    target: targetOf.budget
  };
}

function anomalyItem(anomalies: readonly AnomalyDay[], now: number): Candidate | null {
  const earliest = now - ANOMALY_RECENT_DAYS * DAY_MS;
  let newest: { day: AnomalyDay; at: number } | null = null;
  for (const day of anomalies) {
    if (day.z === null || !Number.isFinite(day.z) || day.z < ANOMALY_Z_ALERT) continue;
    const at = dayMsOf(day.date);
    if (at === null) continue;
    // 「最近 7 天内」：日期落在 [now − 7 天, now]（含今天，允许本机时区导致的半天差）。
    if (at < earliest || at > now + DAY_MS) continue;
    if (newest === null || at > newest.at) newest = { day, at };
  }
  if (newest === null) return null;
  const z = newest.day.z as number;
  const sign = z >= 0 ? "+" : "";
  return {
    id: `anomaly-${newest.day.date}`,
    kind: "anomaly",
    headline: `${newest.day.date.slice(5)} 用量异常（${sign}${z.toFixed(1)}σ）`,
    detail: `当日 ${formatTokenCount(newest.day.tokens)} tok`,
    target: targetOf.anomaly
  };
}

function errorsItem(errorStats: { total: number } | null): Candidate | null {
  if (!errorStats) return null;
  if (!isFiniteCount(errorStats.total) || errorStats.total < ERROR_ALERT_TOTAL) return null;
  const total = Math.floor(errorStats.total);
  return {
    id: "errors",
    kind: "errors",
    headline: `错误聚集：共 ${total} 条`,
    detail: "点开错误面板看聚集在哪些工具或项目",
    target: targetOf.errors
  };
}

/** 环比陡增/陡降。分母 ≤ 0 时不判——没有基线就没有「百分比」。 */
function swingItem(yesterdayTokens: number, prevTokens: number): Candidate | null {
  if (!isFiniteCount(yesterdayTokens) || !isFiniteCount(prevTokens)) return null;
  if (prevTokens <= 0) return null;
  const ratio = (yesterdayTokens - prevTokens) / prevTokens;
  if (ratio >= SWING_RATIO) {
    const pct = Math.round(ratio * 100);
    return {
      id: "spike",
      kind: "spike",
      headline: `用量陡增：环比 +${pct}%`,
      detail: `昨日 ${formatTokenCount(yesterdayTokens)} tok，前日 ${formatTokenCount(prevTokens)} tok`,
      target: targetOf.spike
    };
  }
  if (ratio <= -SWING_RATIO) {
    const pct = Math.round(-ratio * 100);
    return {
      id: "drop",
      kind: "drop",
      headline: `用量陡降：环比 −${pct}%`,
      detail: `昨日 ${formatTokenCount(yesterdayTokens)} tok，前日 ${formatTokenCount(prevTokens)} tok`,
      target: targetOf.drop
    };
  }
  return null;
}

function quietItem(quietDays: number | undefined): Candidate | null {
  if (quietDays === undefined) return null;
  if (!isFiniteCount(quietDays) || quietDays < QUIET_ALERT_DAYS) return null;
  const days = Math.floor(quietDays);
  return {
    id: "quiet",
    kind: "quiet",
    headline: `已连续 ${days} 天零消息`,
    detail: "没有新对话，可以趁机回顾里程碑",
    target: targetOf.quiet
  };
}

/**
 * 生成晨报。`now` 只用于「最近 7 天」的锚点与 `generatedAt`——与
 * `buildLimitForecast` 一样默认取本机时钟，但测试可显式注入。
 */
export function briefingOf(input: BriefingInput, now: number = Date.now()): DailyBriefing {
  const anchor = Number.isFinite(now) ? now : Date.now();
  const candidates: Candidate[] = [];

  const budget = budgetItem(input.forecast);
  if (budget) candidates.push(budget);

  const anomaly = anomalyItem(input.anomalies, anchor);
  if (anomaly) candidates.push(anomaly);

  const errors = errorsItem(input.errorStats);
  if (errors) candidates.push(errors);

  const swing = swingItem(input.yesterdayTokens, input.prevTokens);
  if (swing) candidates.push(swing);

  const quiet = quietItem(input.quietDays);
  if (quiet) candidates.push(quiet);

  return {
    items: candidates.slice(0, MAX_BRIEFING_ITEMS).map((candidate, index) => ({
      ...candidate,
      rank: index + 1
    })),
    generatedAt: anchor
  };
}
