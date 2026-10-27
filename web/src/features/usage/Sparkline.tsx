import { sparkSeries } from "./sparkSeries";
import styles from "./Sparkline.module.css";

/**
 * A tiny trend shape for a KPI tile. Deliberately dumb: no axis, no labels, no
 * title, and `aria-hidden` — the number beside it is the reading; this is the
 * shape of that number's last seven days.
 *
 * `sparkSeries` is the model layer's pure coordinate mapper (Round EE). A flat
 * series is drawn as a centre line rather than a polyline collapsed onto the
 * bottom edge, so "no change" does not read as "plummeted".
 */
export function Sparkline({
  values,
  width = 48,
  height = 14,
  strokeWidth = 1.5
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  // Fewer than two days is not a trend (the caller usually gates this too;
  // doing it here as well keeps the rule in one place).
  if (values.length < 2) return null;

  const series = sparkSeries(values, { width, height, strokeWidth });
  return (
    <svg
      className={styles.spark}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-probe="kpi-sparkline"
    >
      {series.flat ? (
        <line
          className={styles.line}
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          strokeWidth={strokeWidth}
        />
      ) : (
        <polyline
          className={styles.line}
          points={series.points.map((point) => `${point.x},${point.y}`).join(" ")}
          strokeWidth={strokeWidth}
        />
      )}
    </svg>
  );
}
