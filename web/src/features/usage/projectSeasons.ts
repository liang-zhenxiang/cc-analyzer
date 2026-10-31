import { monthKeyOf, monthSpanOf, type MonthKey } from "./monthlyReport";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 项目季节（G8）：每个项目一条「按季度 token 占比」的四段堆叠条 + 文字。
 * 表达的是项目的生命周期——精力何时投在哪，而不是绝对量（绝对量在 G4 月报）。
 *
 * 口径：
 * - token：usage 四计数之和（与 G4/aggregateRange 同款），只数对话记录
 *   （kind user/assistant 且非 compactSummary）；
 * - 季度：自然季（Q1=1–3 月 …），本地时区，按记录 timestamp 归季；
 * - share 分母 = 该项目自身的窗口内总 token（不是全局总量）——条与条之间
 *   不可比是刻意的：季节形状是各项目自己的事；
 * - 窗口：与 G4 月报同一条月几何（`monthSpanOf` 单一来源），窗口覆盖到的
 *   季度全部保留（空季度 share: 0 留在数组里，UI 不用补位）；
 * - 项目排序：total 降序、并列按 projectLabel 字典序（topSlices 同款规则）；
 * - 超过 8 个项目（PROJECT_SEASONS_MAX_PROJECTS）时，前 8 之外合并成
 *   「其他」（label 固定 "其他"）——并入后 share 按桶内 token 重算，
 *   分母是并入项目的 token 之和（仍是「桶内自比」口径）。
 */

/** 前台最多直接展示的项目数，其余并入「其他」。 */
export const PROJECT_SEASONS_MAX_PROJECTS = 8;

/** 「其他」桶的固定展示名。 */
export const OTHER_PROJECTS_LABEL = "其他";

/** 一个季度格：该项目该季的 token 与占自身总量的比例。 */
export type ProjectQuarterCell = {
  year: number;
  /** 1–4。 */
  q: number;
  tokens: number;
  /** 该季 token / 该项目（或「其他」桶）窗口内总 token；空季为 0。 */
  share: number;
};

/** 一条项目行。 */
export type ProjectSeasonRow = {
  /** 项目名（或「其他」）。 */
  project: string;
  /** 窗口内逐季序列（升序，含空季）；长度 = 窗口覆盖的季数。 */
  quarters: ProjectQuarterCell[];
  /** 窗口内总 token（排序用）。 */
  total: number;
};

/** 月 key → 季度 key（自然季：Q1=1–3 月 …）。 */
function quarterOf({ year, month }: MonthKey): { year: number; q: number } {
  return { year, q: Math.floor((month - 1) / 3) + 1 };
}

const quarterId = (k: { year: number; q: number }): string => `${k.year}-Q${k.q}`;

/**
 * 项目季节。空 sessions → 空数组；窗口只覆盖一季 → 每行一格。
 * 无任何 usage 的项目 total 为 0、share 全 0——诚实保留行，界面可按
 * total 过滤，但模型层不擅自裁剪（G4 空月卡同款约定）。
 */
export function projectSeasons(
  sessions: readonly UsageSessionInput[],
  now: number = Date.now()
): ProjectSeasonRow[] {
  const span = monthSpanOf(sessions, now);
  if (span.length === 0) return [];

  // 窗口覆盖的季度序列（升序去重）。
  const quarters: { year: number; q: number }[] = [];
  const quarterSlot = new Map<string, number>();
  for (const month of span) {
    const q = quarterOf(month);
    const id = quarterId(q);
    if (!quarterSlot.has(id)) {
      quarterSlot.set(id, quarters.length);
      quarters.push(q);
    }
  }

  // 项目 → 逐季 token（按窗口季度下标直接寻址）。
  const cells = new Map<string, number[]>();
  for (const session of sessions) {
    let arr = cells.get(session.projectLabel);
    if (!arr) {
      arr = Array.from({ length: quarters.length }, () => 0);
      cells.set(session.projectLabel, arr);
    }
    for (const record of session.records) {
      const isConversation =
        (record.kind === "user" || record.kind === "assistant") && record.compactSummary !== true;
      if (!isConversation || !record.usage) continue;
      // token 口径：usage 四计数之和（totalsSum 同款，含 cache）。
      const tokens =
        (record.usage.inputTokens ?? 0) +
        (record.usage.outputTokens ?? 0) +
        (record.usage.cacheCreationTokens ?? 0) +
        (record.usage.cacheReadTokens ?? 0);
      const slot = quarterSlot.get(quarterId(quarterOf(monthKeyOf(record.timestamp))));
      // 窗口由 records 定义，正常必命中；越界（异常时间戳）丢弃不算错。
      if (slot !== undefined) arr[slot] += tokens;
    }
  }

  // 排序：total 降序、并列 projectLabel 字典序。
  const sorted = [...cells.entries()].sort((a, b) => {
    const ta = a[1].reduce((s, n) => s + n, 0);
    const tb = b[1].reduce((s, n) => s + n, 0);
    return tb - ta || a[0].localeCompare(b[0]);
  });

  // 前 8 之外并入「其他」（桶内逐季求和，保持同一条季度几何）。
  const kept = sorted.slice(0, PROJECT_SEASONS_MAX_PROJECTS);
  const rest = sorted.slice(PROJECT_SEASONS_MAX_PROJECTS);
  const merged: [string, number[]][] = kept;
  if (rest.length > 0) {
    const other = Array.from({ length: quarters.length }, () => 0);
    for (const [, arr] of rest) {
      for (let i = 0; i < arr.length; i++) other[i] += arr[i];
    }
    merged.push([OTHER_PROJECTS_LABEL, other]);
    // 「其他」桶参与排序：按并入后的 total 重新插入正确位置。
    merged.sort((a, b) => {
      const ta = a[1].reduce((s, n) => s + n, 0);
      const tb = b[1].reduce((s, n) => s + n, 0);
      return tb - ta || a[0].localeCompare(b[0]);
    });
  }

  const toRow = ([label, arr]: [string, number[]]): ProjectSeasonRow => {
    const total = arr.reduce((s, n) => s + n, 0);
    return {
      project: label,
      quarters: quarters.map((q, i) => ({
        year: q.year,
        q: q.q,
        tokens: arr[i],
        share: total > 0 ? arr[i] / total : 0
      })),
      total
    };
  };

  return merged.map(toRow);
}
