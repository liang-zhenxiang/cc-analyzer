import styles from "./chartPrimitives.module.css";

/**
 * Shared chrome for the hand-drawn SVG charts: axis math, gridlines, weekday
 * labels and the tabular-numeric class. Data ink (bar/cell/segment colors)
 * lives in each chart's own module; the frame stays neutral grey.

 * The `--chart-*` tokens arrive in step 4; until then every reference carries
 * `var(--accent)` as its fallback so the charts are already presentable.
 */

/** Weekday row labels, Monday-first display order. */
export const WEEKDAY_LABELS: readonly string[] = ["一", "二", "三", "四", "五", "六", "日"];

/** Maps a Monday-first display row back to a `Date.getDay()` index (0 = Sunday). */
export const WEEKDAY_ROW_TO_DAY: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

/** Rounds an axis maximum up to a 1 / 2 / 2.5 / 5 × 10^k ceiling. */
export function niceAxisMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const scaled = value / 10 ** exponent;
  const nice = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/** `steps + 1` tick values from 0 up to `max` — the 0 tick doubles as the baseline. */
export function axisTicks(max: number, steps = 3): number[] {
  return Array.from({ length: steps + 1 }, (_, index) => (max * index) / steps);
}

const compactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1
});

/** Compact tick text (`12K`, `1.2M`) — ticks are for scanning, not the record. */
export function formatAxisValue(value: number): string {
  return compactFormatter.format(value);
}

/** One horizontal gridline with its tick label; `strong` marks the baseline. */
export function GridLine({
  x1,
  x2,
  y,
  label,
  strong = false
}: {
  x1: number;
  x2: number;
  y: number;
  label?: string;
  strong?: boolean;
}) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} className={strong ? styles.axisLine : styles.gridLine} />
      {label !== undefined ? (
        <text x={x1 - 6} y={y + 4} textAnchor="end" className={`${styles.tickText} ${styles.numeric}`}>
          {label}
        </text>
      ) : null}
    </g>
  );
}
