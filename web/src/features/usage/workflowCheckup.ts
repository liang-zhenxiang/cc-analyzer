import type { SessionRecord } from "../sessions/types";
import { formatTokenCount } from "../../lib/format";
import { formatAxisValue } from "./charts/chartPrimitives";
import { rangeLabel, statsForRange } from "./compareRanges";
import { compactionStats } from "./compactionStats";
import { DEFAULT_CONTEXT_THRESHOLD } from "./contextHealth";
import { contextPeakOf } from "./contextQuantiles";
import { mergeErrorStats } from "./errorStats";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 工作流体检（Issue #391）的纯逻辑层：五条绝对阈值规则，各自产出一句可
 * 复算的事实、一份分子分母证据与一条处方。组件不碰时钟、不做 I/O，只排版
 * 这里的结果（口径见 docs/design/workflow-checkup.md §0.3–§0.5）。
 *
 * 三条不可让步的约定：
 * - **未知 ≠ 0**：缺 usage 的会话不进上下文与缓存的分母；缺工具事实的
 *   会话不进委派的分母；缺 errorExtract 的会话不进错误的分母。事实句用
 *   实际进入分母的样本数，不把没扫到的事实说成 0。
 * - **分母不许借错**：压缩频率的分母是窗口内有记录的会话数（`statsForRange`），
 *   不是「发生过压缩的会话数」（`compactionStats.sessions`）；缓存命中率的
 *   分母是 `input + cacheCreation + cacheRead`，不是周报的
 *   `input + cacheRead`；错误份额的分母是全部工具失败，失败率的分母是该
 *   工具调用。
 * - **严格不等号**：除 `error-focus` 的份额（≥ 60%）外，触发线与关注线都是
 *   严格比较——恰好等于阈值不触发 / 不升级。
 */

export type CheckupLevel = "focus" | "notice" | "observe";

export type CheckupId =
  | "context-pressure"
  | "error-focus"
  | "compaction-rate"
  | "cache-hit"
  | "delegation";

export type CheckupEvidenceRow = {
  label: string;
  value: string;
  numeric: boolean;
};

export type CheckupMeter = {
  value: number;
  max: number;
  threshold: number;
  direction: "above" | "below";
  caption: string;
};

export type CheckupEvidence = {
  rows: CheckupEvidenceRow[];
  meter: CheckupMeter | null;
};

export type CheckupAction =
  | { kind: "advice"; text: string }
  | { kind: "jump"; text: string; linkLabel: "打开错误档"; target: "errors" }
  | null;

export type CheckupItem = {
  id: CheckupId;
  level: CheckupLevel;
  dimension: string;
  /** 已格式化的事实句，数字已嵌入（§3.0 定稿）。 */
  fact: string;
  action: CheckupAction;
  /** 仅 observe 项有值。 */
  note: string | null;
  /** 同级排序用；由规则自己的判定读数与触发线算出。 */
  intensity: number;
  evidence: CheckupEvidence;
};

export type WorkflowCheckup = {
  status: "ok" | "quiet" | "insufficient" | "empty";
  /** 最多 4 条，已排序；quiet / insufficient / empty 时为空。 */
  items: CheckupItem[];
  /** 样本达标的检查项数（分母）。 */
  checked: number;
  /** 规则总数（首版 5）。 */
  total: number;
  ineligible: number;
  /** 触发但因上限没显示的条数。 */
  dropped: number;
  /** 触发总数，不受 4 条上限影响。 */
  counts: { focus: number; notice: number; observe: number };
  /** 形如「4 项检查里 2 项值得看一眼」；非 ok 状态为空串。 */
  summary: string;
  insufficient: { sessions: number; toolCalls: number; tokens: number } | null;
  window: { startDay: number; days: number; label: string };
};

/**
 * 阈值全部具名导出：事实句与证据都从这里派生，改常量时文案必须跟着变。
 * 除 `errorShare`（≥）外，所有比较都是严格不等号。
 */
export const CHECKUP_THRESHOLDS = {
  /** 上下文判定线 = 压缩阈值 × 该比例（当前 200K × 85% = 170K）。 */
  contextPeakRatio: 0.85,
  contextTriggerShare: 0.25,
  contextFocusShare: 0.5,
  contextMinSessions: 8,

  errorShare: 0.6,
  errorTriggerRate: 0.1,
  errorFocusRate: 0.2,
  errorMinToolCalls: 20,

  compactionTriggerRate: 0.4,
  compactionFocusRate: 0.8,
  compactionMinEvents: 3,
  compactionMinSessions: 5,

  cacheTriggerRate: 0.15,
  cacheFocusRate: 0.08,
  cacheMinTokens: 5_000_000,

  delegationTriggerRate: 0.05,
  delegationMinSessions: 20,

  maxItems: 4,
  totalRules: 5
} as const;

/** 同级排序的稳定次序：规则序号即设计里的规则顺序。 */
const RULE_ORDER: Record<CheckupId, number> = {
  "context-pressure": 1,
  "error-focus": 2,
  "compaction-rate": 3,
  "cache-hit": 4,
  delegation: 5
};

const LEVEL_RANK: Record<CheckupLevel, number> = {
  focus: 0,
  notice: 1,
  observe: 2
};

const DIMENSION: Record<CheckupId, string> = {
  "context-pressure": "上下文压力",
  "error-focus": "错误集中",
  "compaction-rate": "压缩频次",
  "cache-hit": "缓存利用率",
  delegation: "委派使用"
};

/** 天数归一：与 `aggregateRange` / `previousRange` 同一条规则。 */
function normalizeDays(days: number): number {
  return Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
}

/** 窗口内的记录：本地自然日闭区间 [startDay, 次日零点)。 */
function inWindow(
  records: readonly SessionRecord[],
  start: number,
  end: number
): SessionRecord[] {
  return records.filter((record) => record.timestamp >= start && record.timestamp < end);
}

/**
 * 证据里的比率读数：一位小数。有值但四舍五入到 0.0 的写 `<0.1%`——把
 * 「很小」与「没有」分开（同 `formatShareText` 的立场）。证据区固定精度，
 * 不受 `formatFactPercent` 的自适应精度影响。
 */
function formatCheckupPercent(ratio: number): string {
  const percent = ratio * 100;
  if (percent > 0 && percent < 0.05) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/**
 * 事实句里的「判定读数」百分比（§3.0 自适应精度）：显示值必须满足两条——
 * 1. 显示值与判定线的比较结论，与真实值与判定线的比较结论一致；
 * 2. 显示值不得恰好等于判定线。
 *
 * 从 0 位小数试到 2 位：`14.96%` 在 `< 15%` 下 0 位得到 `15%`（相等）、
 * 1 位得到 `15.0%`（仍相等），到 2 位才得到 `14.96%`。`value` 与
 * `threshold` 都是 0–1 的比率，`direction` 是规则成立的方向（above = 读数
 * 高于线才成立，below = 低于线才成立）。
 *
 * 真实值恰好落在判定线上时两条约束不可同时满足（任何显示要么等于线、
 * 要么改变比较结论）；此时退回两位小数，保持读数真实。
 */
export function formatFactPercent(
  value: number,
  threshold: number,
  direction: "above" | "below"
): string {
  const percent = value * 100;
  const line = threshold * 100;
  for (const digits of [0, 1, 2]) {
    const factor = 10 ** digits;
    const shown = Math.round(percent * factor) / factor;
    const shownRelational = direction === "above" ? shown > line : shown < line;
    const trueRelational = direction === "above" ? percent > line : percent < line;
    const onLine = Math.abs(shown - line) < 1e-9;
    if (shownRelational === trueRelational && !onLine) {
      return `${shown.toFixed(digits)}%`;
    }
  }
  return `${(Math.round(percent * 100) / 100).toFixed(2)}%`;
}

/**
 * 刻度条的上限：取覆盖读数与判定线的 1 / 2 / 2.5 / 5 × 10ⁿ 天花板，与
 * `niceAxisMax` 同一取整规则，但本层不依赖图表组件（纯数据模块不引 React）。
 */
function meterMax(value: number, threshold: number): number {
  const top = Math.max(value, threshold, 1e-9);
  const exponent = Math.floor(Math.log10(top));
  const base = 10 ** exponent;
  const scaled = top / base;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * base;
}

function intensityAbove(reading: number, trigger: number): number {
  return (reading - trigger) / trigger;
}

function intensityBelow(reading: number, trigger: number): number {
  return (trigger - reading) / trigger;
}

function levelOfAbove(reading: number, focusLine: number): CheckupLevel {
  return reading > focusLine ? "focus" : "notice";
}

function levelOfBelow(reading: number, focusLine: number): CheckupLevel {
  return reading < focusLine ? "focus" : "notice";
}

function windowEvidenceRow(windowText: string): CheckupEvidenceRow {
  return { label: "窗口", value: windowText, numeric: false };
}

/** 上下文压力条目（§0.4 第一行）。 */
function contextItem(
  atOrAbove: number,
  sessions: number,
  share: number,
  windowText: string
): CheckupItem {
  const { contextPeakRatio, contextTriggerShare, contextFocusShare } = CHECKUP_THRESHOLDS;
  const line = DEFAULT_CONTEXT_THRESHOLD * contextPeakRatio;
  const lineLabel = formatAxisValue(line);
  const thresholdLabel = formatAxisValue(DEFAULT_CONTEXT_THRESHOLD);
  const triggerPercent = Math.round(contextTriggerShare * 100);
  const focusPercent = Math.round(contextFocusShare * 100);
  const ratioPercent = Math.round(contextPeakRatio * 100);
  return {
    id: "context-pressure",
    level: levelOfAbove(share, contextFocusShare),
    dimension: DIMENSION["context-pressure"],
    // 分子按 `peak >= 判定线` 计。文案必须说「不低于」而不是「超过」：峰值
    // 恰好等于 170K 的会话计入分子，写「超过」会对读者说谎。
    fact:
      `${atOrAbove} / ${sessions} 个会话的上下文峰值不低于 ${lineLabel}` +
      `（压缩阈值 ${thresholdLabel} 的 ${ratioPercent}%）`,
    action: {
      kind: "advice",
      text: "在接近上限前开新会话，而不是硬接——压缩一次会丢掉整段上下文"
    },
    note: null,
    intensity: intensityAbove(share, contextTriggerShare),
    evidence: {
      rows: [
        { label: "计数", value: `${atOrAbove} / ${sessions} 个会话（有 usage 的会话）`, numeric: false },
        { label: "读数", value: formatCheckupPercent(share), numeric: true },
        {
          label: "判定",
          value:
            `峰值 ≥ ${lineLabel}（压缩阈值 ${thresholdLabel} 的 ${ratioPercent}%）` +
            ` · 触发 > ${triggerPercent}% · 关注 > ${focusPercent}%`,
          numeric: false
        },
        { label: "样本", value: `${sessions} 个会话（下限 ${CHECKUP_THRESHOLDS.contextMinSessions}）`, numeric: false },
        windowEvidenceRow(windowText)
      ],
      meter: {
        value: share * 100,
        max: meterMax(share * 100, contextTriggerShare * 100),
        threshold: contextTriggerShare * 100,
        direction: "above",
        caption:
          `${formatCheckupPercent(share)} · 判定线 ${triggerPercent}% · 高于判定线才成立`
      }
    }
  };
}

/** 错误集中条目（§0.4 第二行）：份额负责排序，失败率负责级别。 */
function errorItem(
  toolName: string,
  toolErrors: number,
  totalToolErrors: number,
  toolCalls: number,
  share: number,
  rate: number,
  allToolCalls: number,
  windowText: string
): CheckupItem {
  const { errorShare, errorTriggerRate, errorFocusRate, errorMinToolCalls } = CHECKUP_THRESHOLDS;
  const shareTrigger = Math.round(errorShare * 100);
  const rateTrigger = Math.round(errorTriggerRate * 100);
  const rateFocus = Math.round(errorFocusRate * 100);
  return {
    id: "error-focus",
    level: levelOfAbove(rate, errorFocusRate),
    dimension: DIMENSION["error-focus"],
    fact:
      `全部 ${totalToolErrors} 次工具失败里有 ${toolErrors} 次来自 ${toolName}` +
      `（${Math.round(share * 100)}%），${toolName} 失败率` +
      ` ${formatFactPercent(rate, errorTriggerRate, "above")}`,
    action: {
      kind: "jump",
      text: `去看错误档案里 ${toolName} 的前三个失败签名`,
      linkLabel: "打开错误档",
      target: "errors"
    },
    note: null,
    // 同级排序用失败集中度（份额），级别用失败率——两个数都在证据里。
    intensity: intensityAbove(share, errorShare),
    evidence: {
      rows: [
        {
          label: "失败集中度",
          value: `${formatCheckupPercent(share)}（${toolErrors} / ${totalToolErrors} 次工具失败）`,
          numeric: true
        },
        {
          label: "失败率",
          value: `${formatCheckupPercent(rate)}（${toolName} ${toolErrors} / ${toolCalls} 次调用）`,
          numeric: true
        },
        {
          label: "判定",
          value:
            `份额 ≥ ${shareTrigger}% 且失败率 > ${rateTrigger}%` +
            ` · 关注 失败率 > ${rateFocus}%`,
          numeric: false
        },
        {
          label: "样本",
          value: `全部 ${allToolCalls} 次工具调用（下限 ${errorMinToolCalls}）`,
          numeric: false
        },
        windowEvidenceRow(windowText)
      ],
      meter: {
        value: share * 100,
        max: meterMax(share * 100, errorShare * 100),
        threshold: errorShare * 100,
        direction: "above",
        caption:
          `${formatCheckupPercent(share)} · 判定线 ${shareTrigger}% · 高于判定线才成立`
      }
    }
  };
}

/** 压缩频次条目（§0.4 第三行）。 */
function compactionItem(
  sessions: number,
  count: number,
  rate: number,
  windowText: string
): CheckupItem {
  const { compactionTriggerRate, compactionFocusRate, compactionMinSessions } = CHECKUP_THRESHOLDS;
  const perSession = sessions / count;
  return {
    id: "compaction-rate",
    level: levelOfAbove(rate, compactionFocusRate),
    dimension: DIMENSION["compaction-rate"],
    fact:
      `${sessions} 个会话里发生了 ${count} 次压缩，` +
      `平均每 ${perSession.toFixed(1)} 个会话压一次`,
    action: {
      kind: "advice",
      text: "把长任务拆成多次会话，每次带更少的历史"
    },
    note: null,
    intensity: intensityAbove(rate, compactionTriggerRate),
    evidence: {
      rows: [
        { label: "计数", value: `${count} 次压缩 / ${sessions} 个会话（有记录的会话）`, numeric: false },
        {
          label: "读数",
          value: `${rate.toFixed(2)} 次/会话（每 ${perSession.toFixed(1)} 个会话一次）`,
          numeric: true
        },
        {
          label: "判定",
          value:
            `触发 > ${compactionTriggerRate.toFixed(2)} 次/会话` +
            ` · 关注 > ${compactionFocusRate.toFixed(2)} 次/会话`,
          numeric: false
        },
        {
          label: "样本",
          value: `${sessions} 个会话（下限 ${compactionMinSessions}）`,
          numeric: false
        },
        windowEvidenceRow(windowText)
      ],
      meter: {
        value: rate,
        max: meterMax(rate, compactionTriggerRate),
        threshold: compactionTriggerRate,
        direction: "above",
        caption:
          `${rate.toFixed(2)} 次/会话 · 判定线 ${compactionTriggerRate.toFixed(2)} 次/会话` +
          ` · 高于判定线才成立`
      }
    }
  };
}

/** 缓存利用率条目（§0.4 第四行）：分母是三项之和，不是周报的两项。 */
function cacheItem(
  cacheRead: number,
  denominator: number,
  rate: number,
  windowText: string
): CheckupItem {
  const { cacheTriggerRate, cacheFocusRate, cacheMinTokens } = CHECKUP_THRESHOLDS;
  const triggerPercent = Math.round(cacheTriggerRate * 100);
  const focusPercent = Math.round(cacheFocusRate * 100);
  const floor = cacheMinTokens;
  return {
    id: "cache-hit",
    level: levelOfBelow(rate, cacheFocusRate),
    dimension: DIMENSION["cache-hit"],
    fact:
      rate < 0.01
        ? "输入侧只有不到 1% 来自缓存读取——大部分上下文每次都在重新写入"
        : `输入侧只有 ${formatFactPercent(rate, cacheTriggerRate, "below")}` +
          " 来自缓存读取——大部分上下文每次都在重新写入",
    action: {
      kind: "advice",
      text: "同一件事尽量在同一个会话里做完；频繁重启会让缓存反复失效"
    },
    note: null,
    intensity: intensityBelow(rate, cacheTriggerRate),
    evidence: {
      rows: [
        {
          label: "计数",
          value:
            `缓存读取 ${formatTokenCount(cacheRead)} / 输入侧 ${formatTokenCount(denominator)} token` +
            "（input + cacheCreation + cacheRead）",
          numeric: false
        },
        {
          label: "读数",
          value:
            rate < 0.01
              ? `${formatCheckupPercent(rate)}（不足 1%）`
              : formatCheckupPercent(rate),
          numeric: true
        },
        {
          label: "判定",
          value: `触发 < ${triggerPercent}% · 关注 < ${focusPercent}%`,
          numeric: false
        },
        {
          label: "样本",
          value: `窗口 ${formatAxisValue(floor)} token（下限 ${formatAxisValue(floor)}）`,
          numeric: false
        },
        windowEvidenceRow(windowText)
      ],
      meter: {
        value: rate * 100,
        max: meterMax(rate * 100, cacheTriggerRate * 100),
        threshold: cacheTriggerRate * 100,
        direction: "below",
        caption:
          `${formatCheckupPercent(rate)} · 判定线 ${triggerPercent}% · 低于判定线才成立`
      }
    }
  };
}

/** 委派使用条目（§0.4 第五行）：恒为 observe，永远没有处方。 */
function delegationItem(
  sessions: number,
  used: number,
  rate: number,
  windowText: string
): CheckupItem {
  const { delegationTriggerRate, delegationMinSessions } = CHECKUP_THRESHOLDS;
  const triggerPercent = Math.round(delegationTriggerRate * 100);
  return {
    id: "delegation",
    level: "observe",
    dimension: DIMENSION.delegation,
    fact:
      used === 0
        ? `${sessions} 个会话里没有一个用过子 agent`
        : `${sessions} 个会话里只有 ${used} 个用过子 agent`,
    action: null,
    note: "这一项只陈述事实，不给建议——是否适合委派取决于具体任务。",
    intensity: intensityBelow(rate, delegationTriggerRate),
    evidence: {
      rows: [
        { label: "计数", value: `${used} / ${sessions} 个有工具事实的会话用过子 agent`, numeric: false },
        { label: "读数", value: formatCheckupPercent(rate), numeric: true },
        { label: "判定", value: `触发 < ${triggerPercent}%`, numeric: false },
        {
          label: "样本",
          value: `${sessions} 个会话（下限 ${delegationMinSessions}）`,
          numeric: false
        },
        windowEvidenceRow(windowText)
      ],
      meter: null
    }
  };
}

/** 排序：级别 → intensity 降序 → 规则序号（同级同强度顺序恒定）。 */
function sortItems(items: CheckupItem[]): CheckupItem[] {
  return [...items].sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      b.intensity - a.intensity ||
      RULE_ORDER[a.id] - RULE_ORDER[b.id]
  );
}

/**
 * 五条规则 + 样本判定 + 级别/排序/上限。纯函数：同一输入每次得到同一组值、
 * 同一顺序、同一组级别。
 */
export function buildWorkflowCheckup(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number = Date.now()
): WorkflowCheckup {
  const windowDays = normalizeDays(days);
  const todayStart = dayStartOf(now);
  const startDay = addLocalDays(todayStart, -(windowDays - 1));
  const end = addLocalDays(todayStart, 1);
  const label = rangeLabel({ startDay, days: windowDays });
  const windowText = `近 ${windowDays} 天 · ${label}`;

  const stats = statsForRange(inputs, { startDay, days: windowDays }, now);
  const contextLine = DEFAULT_CONTEXT_THRESHOLD * CHECKUP_THRESHOLDS.contextPeakRatio;

  // 一轮窗口内的逐会话扫描：上下文峰值、缓存三项、委派事实互不借分母。
  let usageSessions = 0;
  let sessionsAtOrAboveLine = 0;
  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let toolFactSessions = 0;
  let delegatedSessions = 0;

  for (const input of inputs) {
    const records = inWindow(input.records, startDay, end);
    if (records.length === 0) continue;

    const peak = contextPeakOf({ ...input, records });
    if (peak !== null) {
      usageSessions += 1;
      if (peak >= contextLine) sessionsAtOrAboveLine += 1;
    }

    for (const record of records) {
      const usage = record.usage;
      if (!usage) continue;
      inputTokens += usage.inputTokens ?? 0;
      cacheCreationTokens += usage.cacheCreationTokens ?? 0;
      cacheReadTokens += usage.cacheReadTokens ?? 0;
    }

    if (input.toolCalls !== undefined) {
      toolFactSessions += 1;
      const usedDelegation = input.toolCalls.some(
        (fact) =>
          fact.timestamp >= startDay &&
          fact.timestamp < end &&
          (fact.key.kind === "subagent" || fact.sidechain === true)
      );
      if (usedDelegation) delegatedSessions += 1;
    }
  }

  const errorStats = mergeErrorStats(inputs, windowDays, now);
  const compaction = compactionStats(inputs, windowDays, now);

  const sessionCount = stats.sessions;
  const cacheDenominator = inputTokens + cacheCreationTokens + cacheReadTokens;

  const contextShare = usageSessions > 0 ? sessionsAtOrAboveLine / usageSessions : 0;
  const topError = errorStats.byTool[0];
  const totalToolErrors = errorStats.total.tool;
  const errorShare =
    topError && totalToolErrors > 0 ? topError.errors / totalToolErrors : 0;
  const errorRate = topError?.rate ?? 0;
  const compactionRate = sessionCount > 0 ? compaction.count / sessionCount : 0;
  const cacheRate = cacheDenominator > 0 ? cacheReadTokens / cacheDenominator : 0;
  const delegationRate = toolFactSessions > 0 ? delegatedSessions / toolFactSessions : 0;

  const contextEligible = usageSessions >= CHECKUP_THRESHOLDS.contextMinSessions;
  const errorEligible = errorStats.toolCalls >= CHECKUP_THRESHOLDS.errorMinToolCalls;
  const compactionEligible = sessionCount >= CHECKUP_THRESHOLDS.compactionMinSessions;
  const cacheEligible = cacheDenominator >= CHECKUP_THRESHOLDS.cacheMinTokens;
  const delegationEligible = toolFactSessions >= CHECKUP_THRESHOLDS.delegationMinSessions;

  let checked = 0;
  if (contextEligible) checked += 1;
  if (errorEligible) checked += 1;
  if (compactionEligible) checked += 1;
  if (cacheEligible) checked += 1;
  if (delegationEligible) checked += 1;

  const triggered: CheckupItem[] = [];

  if (contextEligible && contextShare > CHECKUP_THRESHOLDS.contextTriggerShare) {
    triggered.push(contextItem(sessionsAtOrAboveLine, usageSessions, contextShare, windowText));
  }

  if (
    errorEligible &&
    topError &&
    errorShare >= CHECKUP_THRESHOLDS.errorShare &&
    errorRate > CHECKUP_THRESHOLDS.errorTriggerRate
  ) {
    triggered.push(
      errorItem(
        topError.toolName,
        topError.errors,
        totalToolErrors,
        topError.calls,
        errorShare,
        errorRate,
        errorStats.toolCalls,
        windowText
      )
    );
  }

  if (
    compactionEligible &&
    compactionRate > CHECKUP_THRESHOLDS.compactionTriggerRate &&
    compaction.count >= CHECKUP_THRESHOLDS.compactionMinEvents
  ) {
    triggered.push(
      compactionItem(sessionCount, compaction.count, compactionRate, windowText)
    );
  }

  if (cacheEligible && cacheRate < CHECKUP_THRESHOLDS.cacheTriggerRate) {
    triggered.push(cacheItem(cacheReadTokens, cacheDenominator, cacheRate, windowText));
  }

  if (delegationEligible && delegationRate < CHECKUP_THRESHOLDS.delegationTriggerRate) {
    triggered.push(
      delegationItem(toolFactSessions, delegatedSessions, delegationRate, windowText)
    );
  }

  const counts = { focus: 0, notice: 0, observe: 0 };
  for (const item of triggered) counts[item.level] += 1;

  const status: WorkflowCheckup["status"] =
    sessionCount === 0
      ? "empty"
      : checked === 0
        ? "insufficient"
        : counts.focus + counts.notice === 0
          ? "quiet"
          : "ok";

  const sorted = sortItems(triggered);
  const items =
    status === "ok" ? sorted.slice(0, CHECKUP_THRESHOLDS.maxItems) : [];
  const dropped = status === "ok" ? Math.max(0, sorted.length - items.length) : 0;

  return {
    status,
    items,
    checked,
    total: CHECKUP_THRESHOLDS.totalRules,
    ineligible: CHECKUP_THRESHOLDS.totalRules - checked,
    dropped,
    counts,
    summary:
      status === "ok"
        ? `${checked} 项检查里 ${counts.focus + counts.notice} 项值得看一眼`
        : "",
    insufficient:
      status === "insufficient"
        ? {
            sessions: stats.sessions,
            toolCalls: errorStats.toolCalls,
            tokens: stats.tokens
          }
        : null,
    window: { startDay, days: windowDays, label }
  };
}
