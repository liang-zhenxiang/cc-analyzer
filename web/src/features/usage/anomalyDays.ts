import type { TrendDay } from "./trendChannel";

/**
 * E2 异常日：给每一天一个「相对前 7 天」的 z 分数，标出陡升（spike）与陡降
 * （dip）。目的是在趋势图上点出「哪天不对劲」，而不是发明新的 token 指标。
 *
 * 口径：
 *   - z = (tokens − mean7) / sd7。mean7/sd7 只用**当天之前**的相邻 7 天
 *     （不含当天），不够 7 天有多少用多少，少于 2 天给 null——样本不足时
 *     报「异常」比不报更误导。
 *   - sd7 用样本标准差（除以 n−1）；sd7 为 0（每天完全一样）时 z 也置
 *     null：恒定序列里没有「异常」这个概念，不能靠 0 除出差值。
 *   - |z| ≥ 2 且高于均值记 spike、≤ −2 记 dip，其余（含正常日）kind 为
 *     "-"。阈值按 2σ 经验值，不按百分位切——n=2 时百分位会退化。
 *   - 日期按 UTC 日号（`YYYY-MM-DD`）比较；只要有一行日期解析不了，就退回
 *     「数组里前 7 个点」的窗口，保证不因一行坏数据整表变 null。
 *   - 全部日子都返回（升序），kind "-" 的普通日也返回，由界面自己筛。
 */

export type AnomalyKind = "spike" | "dip" | "-";

export type AnomalyDay = {
  date: string;
  tokens: number;
  /** 相对前 7 天的 z 分数；样本不足或 sd 为 0 时为 null。 */
  z: number | null;
  kind: AnomalyKind;
};


export const NEIGHBOUR_DAYS = 7;
export const MIN_NEIGHBOURS = 2;
export const Z_THRESHOLD = 2;

const DAY_MS = 86_400_000;
const DATE_LABEL = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayNumberOf(label: string): number | null {
  const match = DATE_LABEL.exec(label);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(timestamp)) return null;
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp / DAY_MS;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 样本标准差（n−1）；调用方保证 n ≥ 2。 */
function sampleStandardDeviation(values: readonly number[], average: number): number {
  const squared = values.reduce((sum, value) => sum + (value - average) ** 2, 0);
  return Math.sqrt(squared / (values.length - 1));
}

/**
 * 计算每一天的异常分数。纯函数：不读时钟，输入即范围。
 */
export function buildAnomalyDays(daily: readonly TrendDay[]): AnomalyDay[] {
  const points = daily.map((point) => ({
    date: point.date,
    tokens: point.tokens,
    day: dayNumberOf(point.date)
  }));

  const useCalendar = points.every((point) => point.day !== null);
  const ordered = [...points].sort((a, b) => {
    if (a.day !== null && b.day !== null) return a.day - b.day;
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });

  return ordered.map((point, index) => {
    let neighbourValues: number[];
    if (useCalendar && point.day !== null) {
      const day = point.day;
      neighbourValues = ordered
        .filter(
          (other) =>
            other.day !== null &&
            other.day >= day - NEIGHBOUR_DAYS &&
            other.day <= day - 1
        )
        .map((other) => other.tokens);
    } else {
      neighbourValues = ordered
        .slice(Math.max(0, index - NEIGHBOUR_DAYS), index)
        .map((other) => other.tokens);
    }

    const measured = neighbourValues.filter((value) => Number.isFinite(value));
    let z: number | null = null;
    if (measured.length >= MIN_NEIGHBOURS && Number.isFinite(point.tokens)) {
      const average = mean(measured);
      const deviation = sampleStandardDeviation(measured, average);
      if (deviation > 0) z = (point.tokens - average) / deviation;
    }

    const kind: AnomalyKind =
      z !== null && z >= Z_THRESHOLD ? "spike" : z !== null && z <= -Z_THRESHOLD ? "dip" : "-";

    return { date: point.date, tokens: point.tokens, z, kind };
  });
}
