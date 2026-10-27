import type { AnomalyDay } from "./anomalyDays";
import type { TrendChannel } from "./trendChannel";
import {
  BAR_PAD_BOTTOM,
  BAR_PAD_LEFT,
  BAR_PAD_RIGHT,
  BAR_PAD_TOP,
  BAR_WIDTH,
  BarChart
} from "./charts/BarChart";
import { niceAxisMax } from "./charts/chartPrimitives";
import styles from "./DailyTrendChart.module.css";

/**
 * The daily bar chart plus two explainers drawn in the *same* plot box:
 *
 * - E1 trend channel: the 7-day moving average (solid, `--chart-1`) and the
 *   regression fit from the model (dashed, `--text-tertiary`).
 * - E2 anomaly days: a small ▲/▼ above the bar, because colour alone cannot
 *   carry direction (dips and spikes would look identical).
 *
 * Geometry is imported from `BarChart` rather than re-derived: an overlay that
 * guesses the padding drifts by a few pixels on every theme and screenshot.
 *
 * The forward projection the model returns (7 days past the window) has no
 * room on this axis: the plot's right padding is 10px, so seven future days
 * would either be invisible or require moving the bars to a different x
 * domain. The dashed line therefore shows the same slope across the recent
 * 14 days and out to the right edge — a projection, labelled as one, without
 * inventing future dates on an axis that has none.
 */
export function DailyTrendChart({
  data,
  trend,
  anomalies,
  height = 170,
  ariaLabel
}: {
  data: { label: string; value: number }[];
  trend: TrendChannel;
  /** Index-aligned with `data`: `null` where the day is not anomalous. */
  anomalies: readonly (AnomalyDay | null)[];
  height?: number;
  ariaLabel: string;
}) {
  const count = data.length;
  const plotWidth = BAR_WIDTH - BAR_PAD_LEFT - BAR_PAD_RIGHT;
  const plotHeight = height - BAR_PAD_TOP - BAR_PAD_BOTTOM;
  const maxValue = niceAxisMax(Math.max(0, ...data.map((point) => point.value)));
  const slot = count > 0 ? plotWidth / count : plotWidth;
  const centreX = (index: number) => BAR_PAD_LEFT + index * slot + slot / 2;
  const yOf = (value: number) =>
    BAR_PAD_TOP + plotHeight - Math.min(1, Math.max(0, value / maxValue)) * plotHeight;

  const maPoints = trend.ma7
    .map((value, index) => (value === null ? null : `${centreX(index).toFixed(1)},${yOf(value).toFixed(1)}`))
    .filter((point): point is string => point !== null);

  // The fit is anchored on the last moving-average point; walking backwards
  // over `FIT_DAYS` keeps the dashed line inside the plot.
  const FIT_DAYS = 14;
  const lastMaIndex = trend.ma7.reduce<number>(
    (last, value, index) => (value === null ? last : index),
    -1
  );
  let fitPoints: string[] = [];
  if (trend.slopePerDay !== null && lastMaIndex >= 0 && count >= FIT_DAYS) {
    const anchor = trend.ma7[lastMaIndex];
    if (anchor !== null) {
      const startIndex = Math.max(0, lastMaIndex - (FIT_DAYS - 1));
      const points: string[] = [];
      for (let index = startIndex; index <= lastMaIndex; index += 1) {
        const value = anchor + trend.slopePerDay * (index - lastMaIndex);
        points.push(`${centreX(index).toFixed(1)},${yOf(Math.max(0, value)).toFixed(1)}`);
      }
      // Carrying the same slope to the right edge is the only room this plot
      // has for a forward read; the honest alternative (seven extra days) would
      // rescale the bars away from the axis labels above them.
      const edgeValue = anchor + trend.slopePerDay * ((BAR_WIDTH - BAR_PAD_RIGHT - centreX(lastMaIndex)) / slot);
      points.push(
        `${(BAR_WIDTH - BAR_PAD_RIGHT).toFixed(1)},${yOf(Math.max(0, edgeValue)).toFixed(1)}`
      );
      fitPoints = points;
    }
  }

  const anomalyMarks = anomalies
    .map((day, index) => (day && day.kind !== "-" && day.z !== null ? { day, index } : null))
    .filter((mark): mark is { day: AnomalyDay; index: number } => mark !== null);
  const judged = anomalies.some((day) => day !== null && day.z !== null);
  const legend =
    count === 0
      ? "所选范围内没有消耗，趋势线无可画"
      : [
          maPoints.length >= 2 ? "实线＝7 天移动平均" : `均线需要 7 天数据，当前只有 ${count} 天`,
          fitPoints.length >= 2 ? "虚线＝按最近 14 天外推" : "外推需要 14 天数据",
          anomalyMarks.length > 0
            ? "▲＝异常日（z ≥ 2）"
            : judged
              ? "所选范围内没有异常日（|z| ≥ 2）"
              : "历史不足，暂不判定异常"
        ].join(" · ");

  if (count === 0) {
    return (
      <div className={styles.wrap}>
        <BarChart data={data} height={height} ariaLabel={ariaLabel} />
        <p className={styles.legend}>{legend}</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.stack}>
        <BarChart data={data} height={height} ariaLabel={ariaLabel} />
        <svg
          className={styles.overlay}
          viewBox={`0 0 ${BAR_WIDTH} ${height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          data-probe="trend-overlay"
        >
          {maPoints.length >= 2 ? (
            <polyline className={styles.ma} points={maPoints.join(" ")} data-probe="trend-ma" />
          ) : null}
          {fitPoints.length >= 2 ? (
            <polyline
              className={styles.fit}
              points={fitPoints.join(" ")}
              data-probe="trend-forecast"
            />
          ) : null}
        </svg>
        <div className={styles.marks} data-probe="anomaly-marks">
          {anomalyMarks.map(({ day, index }) => {
            const barHeight = Math.max((day.tokens / maxValue) * plotHeight, 1.5);
            const top = BAR_PAD_TOP + plotHeight - barHeight - 6;
            return (
              <span
                key={`${day.date}-${day.kind}`}
                className={`${styles.mark} ${day.kind === "dip" ? styles.dip : styles.spike}`}
                style={{
                  left: `${((centreX(index) / BAR_WIDTH) * 100).toFixed(2)}%`,
                  top: `${((top / height) * 100).toFixed(2)}%`
                }}
                title={`该日 ${day.tokens.toLocaleString("en-US")} tok，相对前 7 天 z=${
                  day.z! > 0 ? "+" : ""
                }${day.z!.toFixed(1)}`}
              />
            );
          })}
        </div>
      </div>
      <p className={styles.legend}>{legend}</p>
    </div>
  );
}
