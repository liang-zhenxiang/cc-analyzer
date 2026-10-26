/**
 * F4「节奏时钟」的数据形状：把 `周 × 小时` 的计数折成 24 个小时的合计，
 * 只保留画图需要的比例（`max`）与峰值身份。纯函数：不碰 DOM、不读时钟。
 *
 * 与热力图共用同一份 `range.hourly`（7 行 × 24 列），所以切换视图时数字
 * 不变、只换画法；`total`/`max` 也由这里一次算好，组件不重复求和。
 */

export type ClockHour = {
  /** Local hour, 0–23. */
  hour: number;
  /** Sum over the seven weekday rows. */
  total: number;
  /** Largest hourly total (the radius denominator), repeated for convenience. */
  max: number;
  /** True for the single busiest hour; the earliest one on a tie. */
  peak: boolean;
};

export type ActivityClock = {
  /** Always 24 entries, index = hour. */
  hours: ClockHour[];
  total: number;
  max: number;
  /** Busiest hour, `null` when every hour is empty. */
  peakHour: number | null;
};

export function buildActivityClock(hourly: ReadonlyArray<ReadonlyArray<number>>): ActivityClock {
  const totals = Array.from({ length: 24 }, (_, hour) => {
    let sum = 0;
    for (const week of hourly) {
      const value = week[hour];
      // Ragged or malformed rows contribute nothing — a missing reading is not a zero reading.
      if (Number.isFinite(value) && value > 0) sum += value;
    }
    return sum;
  });
  const total = totals.reduce((sum, value) => sum + value, 0);
  const max = totals.reduce((best, value) => (value > best ? value : best), 0);
  // `indexOf` keeps the earliest hour on a tie.
  const peakHour = max > 0 ? totals.indexOf(max) : null;

  return {
    hours: totals.map((value, hour) => ({
      hour,
      total: value,
      max,
      peak: hour === peakHour
    })),
    total,
    max,
    peakHour
  };
}
