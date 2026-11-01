/**
 * I1 会话时长分布：给「这个人的会话一般开多久」一个五桶直方图。
 *
 * 口径：
 *   - 输入是每会话的墙钟跨度 ms（`sessionFacts.durationMs`，首末记录间隔，
 *     与用量页 `longestSessionMinutes` 同口径），不是活跃时长；
 *   - `null` 表示单记录会话：量不出跨度。这种会话**计入「不足 5 分钟」桶**
 *     （它确实没持续），同时记进 `unmeasurable`，让界面能说「其中 N 个无法
 *     计时」——不能因为量不出就把它从分布里抹掉，也不能假装它有 0ms 跨度；
 *   - 负数 / NaN 同样按「无法量」处理（数据坏了不等于 0）；
 *   - 中位数只对有跨度的会话求，偶数个取中间两个的均值；
 *   - 一个可计时的会话都没有时返回 null，界面显示「没有可计时的会话」。
 */

export type DurationBucketId =
  | "under5min"
  | "5to15min"
  | "15to60min"
  | "1to4h"
  | "4hplus";

export type DurationBucket = {
  id: DurationBucketId;
  label: string;
  count: number;
};

export type DurationBuckets = {
  buckets: DurationBucket[];
  /** 可计时会话的中位跨度；没有可计时会话时为 null。 */
  medianMs: number | null;
  /** 单记录会话（及 NaN/负数）的条数——已计入「不足 5 分钟」桶。 */
  unmeasurable: number;
};

/** 桶的右开边界：<5min / <15min / <1h / <4h / ≥4h。 */
const BOUNDARIES_MS = [300_000, 900_000, 3_600_000, 14_400_000] as const;

const BUCKET_LABELS: ReadonlyArray<{ id: DurationBucketId; label: string }> = [
  { id: "under5min", label: "不足 5 分钟" },
  { id: "5to15min", label: "5–15 分钟" },
  { id: "15to60min", label: "15–60 分钟" },
  { id: "1to4h", label: "1–4 小时" },
  { id: "4hplus", label: "≥ 4 小时" }
];

function bucketIndex(duration: number): number {
  for (let index = 0; index < BOUNDARIES_MS.length; index += 1) {
    if (duration < BOUNDARIES_MS[index]!) return index;
  }
  return BOUNDARIES_MS.length;
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  if (!Number.isInteger(middle)) return sorted[Math.floor(middle)]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function sessionDurationsOf(
  durations: readonly (number | null)[]
): DurationBuckets | null {
  if (durations.length === 0) return null;

  const buckets: DurationBucket[] = BUCKET_LABELS.map((bucket) => ({ ...bucket, count: 0 }));
  const measured: number[] = [];
  let unmeasurable = 0;

  for (const duration of durations) {
    if (duration === null || !Number.isFinite(duration) || duration < 0) {
      unmeasurable += 1;
      // 量不出跨度的会话不是「0 分钟」，但也不能从分布里消失：单记录会话
      // 确实没有持续，归入最短桶并单独计数。
      buckets[0]!.count += 1;
      continue;
    }
    measured.push(duration);
    buckets[bucketIndex(duration)]!.count += 1;
  }

  if (measured.length === 0) return null;

  return { buckets, medianMs: medianOf(measured), unmeasurable };
}
