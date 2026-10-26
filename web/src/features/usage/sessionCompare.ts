import type { SessionRecord } from "../sessions/types";
import {
  aggregateSession,
  totalsSum,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 会话对比（D1）：两个会话逐字段并排 + 差异倍率，纯数据层。
 *
 * 口径全部复用既有权威来源，不新建第二套：
 * - tokens/messages/models 复用 `aggregateSession`（usageAggregations）——
 *   与看板聚合同一函数，两侧数字不可能漂移；
 * - durationMinutes 用 records 首末 timestamp 差（墙钟口径，与 logRows 的
 *   会话时长同源——不看 durationMs，也不看 meta 的 mtime）；
 * - models 的 share 按 usage 记录数占比（与 aggregateSession 的 models
 *   bucket `messages` 字段同一口径：只有带 usage 的 assistant 记录才进桶）。
 *
 * ratio = 大 / 小 − 1（谁大谁算被比对象，与输入顺序无关）；任何一侧为 0
 * 时 ratio 为 null——「0 比任何数」不是倍数关系，渲染层应显示「—」而不是 ∞。
 */

/** 一侧的并排数字；tokens 是四计数器结构（与看板同构，不折成单值）。 */
export type SessionCompareSide = {
  label: string;
  tokens: UsageTotals;
  messages: number;
  models: Array<{ model: string; share: number }>;
  durationMinutes: number;
  records: number;
};

/** 可比字段的差异：ratio = 大 / 小 − 1，任一侧为 0 时 null。 */
export type SessionCompareDiff = {
  field: "tokens" | "messages" | "durationMinutes" | "records";
  ratio: number | null;
};

export type SessionCompareResult = {
  a: SessionCompareSide;
  b: SessionCompareSide;
  diffs: SessionCompareDiff[];
};

/** 首末 timestamp 差（分钟，浮点）。空 records 时 0；同刻首末亦为 0。 */
function durationMinutesOf(records: readonly SessionRecord[]): number {
  if (records.length === 0) return 0;
  let first = records[0].timestamp;
  let last = records[0].timestamp;
  for (const record of records) {
    if (record.timestamp < first) first = record.timestamp;
    if (record.timestamp > last) last = record.timestamp;
  }
  return (last - first) / 60_000;
}

/** 大/小 − 1；任何一侧为 0 时 null（零倍率没有意义，绝不返回 Infinity）。 */
function ratioOf(a: number, b: number): number | null {
  if (a === 0 || b === 0) return null;
  const big = Math.max(a, b);
  const small = Math.min(a, b);
  return big / small - 1;
}

/**
 * 把一侧会话折成并排数字。share 按 models bucket 的 usage 记录数占比
 * （`messages` 字段），分母为带 usage 的记录总数；无 usage 记录时为空数组
 * （不硬造 100% 的单条目）。排序与 aggregateSession 的桶序一致之外再加
 * share 降序 + 模型名稳定序，保证同输入同输出。
 */
function sideOf(label: string, { records }: UsageSessionInput): SessionCompareSide {
  const aggregate = aggregateSession(records);
  const usageRecords = [...aggregate.models.values()].reduce((sum, bucket) => sum + bucket.messages, 0);
  const models =
    usageRecords > 0
      ? [...aggregate.models.entries()]
          .map(([model, bucket]) => ({ model, share: bucket.messages / usageRecords }))
          .sort((x, y) => y.share - x.share || x.model.localeCompare(y.model))
      : [];
  return {
    label,
    tokens: aggregate.totals,
    messages: aggregate.messages,
    models,
    durationMinutes: durationMinutesOf(records),
    records: records.length
  };
}

/**
 * 两个会话并排对比。a/b 的 label 由调用方给定（列表页给会话标题，
 * 测试给简短名），字段口径见文件头注释。
 */
export function compareSessions(
  a: UsageSessionInput,
  b: UsageSessionInput
): SessionCompareResult {
  const sideA = sideOf(a.projectLabel, a);
  const sideB = sideOf(b.projectLabel, b);
  return {
    a: sideA,
    b: sideB,
    diffs: [
      { field: "tokens", ratio: ratioOf(totalsSum(sideA.tokens), totalsSum(sideB.tokens)) },
      { field: "messages", ratio: ratioOf(sideA.messages, sideB.messages) },
      { field: "durationMinutes", ratio: ratioOf(sideA.durationMinutes, sideB.durationMinutes) },
      { field: "records", ratio: ratioOf(sideA.records, sideB.records) }
    ]
  };
}
