/**
 * I3 会话间隔分布：相邻两次会话开始时刻的间隔，按六桶统计。
 *
 * 口径：
 *   - 只拿「会话开始时刻」排队，先按时间升序再取相邻差；输入顺序无关，
 *     调用方给乱序也不会算出负间隔。防御性地对差值取绝对值并注释：真出现
 *     负值说明数据坏了，宁可当成间隔也不让桶下标崩掉。
 *   - `null` / 非有限时间戳的会话跳过，计入 `skipped`——没有开始时刻就
 *     没有间隔，不能拿 0 代替（否则会造出一堆「<1 分钟」的假间隔）。
 *   - 有效时刻少于 2 个返回 null（没有间隔可算），界面显示样本不足；
 *   - 中位数偶数个取中间两个的均值。
 */

export type GapBucketId =
  | "under1min"
  | "1to10min"
  | "10to60min"
  | "1to4h"
  | "4to24h"
  | "over24h";

export type GapBucket = {
  id: GapBucketId;
  label: string;
  count: number;
};

export type SessionGapHistogram = {
  buckets: GapBucket[];
  medianMs: number | null;
  /** 开始时刻缺失（null / NaN）而无法参与排序的会话数。 */
  skipped: number;
};

/** 桶的右开边界：<1min / <10min / <1h / <4h / <24h / ≥24h。 */
const BOUNDARIES_MS = [60_000, 600_000, 3_600_000, 14_400_000, 86_400_000] as const;

const BUCKET_LABELS: ReadonlyArray<{ id: GapBucketId; label: string }> = [
  { id: "under1min", label: "不足 1 分钟" },
  { id: "1to10min", label: "1–10 分钟" },
  { id: "10to60min", label: "10–60 分钟" },
  { id: "1to4h", label: "1–4 小时" },
  { id: "4to24h", label: "4–24 小时" },
  { id: "over24h", label: "超过 24 小时" }
];

function bucketIndex(gap: number): number {
  for (let index = 0; index < BOUNDARIES_MS.length; index += 1) {
    if (gap < BOUNDARIES_MS[index]!) return index;
  }
  return BOUNDARIES_MS.length;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  if (!Number.isInteger(middle)) return sorted[Math.floor(middle)]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function sessionGapHistogram(
  startTimestamps: readonly (number | null)[]
): SessionGapHistogram | null {
  const valid: number[] = [];
  let skipped = 0;

  for (const timestamp of startTimestamps) {
    if (timestamp === null || !Number.isFinite(timestamp)) {
      skipped += 1;
      continue;
    }
    valid.push(timestamp);
  }

  if (valid.length < 2) return null;

  valid.sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < valid.length; index += 1) {
    // 已排序，差值本应非负；取绝对值只是防御坏数据，不让负间隔落进空桶。
    gaps.push(Math.abs(valid[index]! - valid[index - 1]!));
  }

  const buckets: GapBucket[] = BUCKET_LABELS.map((bucket) => ({ ...bucket, count: 0 }));
  for (const gap of gaps) buckets[bucketIndex(gap)]!.count += 1;

  return { buckets, medianMs: medianOf(gaps), skipped };
}
