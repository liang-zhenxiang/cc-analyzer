import { formatTokenCount } from "../../../lib/format";
import styles from "./Gauge.module.css";

/**
 * Ring gauge for the billing window: one arc, the share of the plan limit
 * consumed. `progress` arrives clamped by the caller; a missing limit is
 * rendered as the neutral full ring (consumption readout still shown — no
 * denominator, no percentage, per the provenance stance).
 */
export function Gauge({
  progress,
  centerValue,
  centerLabel,
  ariaLabel
}: {
  /** 0..1; `null` renders the neutral ring (no plan selected). */
  progress: number | null;
  centerValue: string;
  centerLabel: string;
  ariaLabel: string;
}) {
  const size = 120;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = progress === null ? null : Math.min(1, Math.max(0, progress));
  const dash = clamped === null ? 0 : clamped * circumference;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={ariaLabel}
      className={styles.gauge}
    >
      {/* 底环中性灰；进度弧走 chart-1 软硬两档：弧是窄描边（实色允许），
          环心留给大号读数。 */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--border)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--chart-1, var(--accent))"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={clamped === null ? styles.inert : styles.progress}
      />
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        className={styles.centerValue}
      >
        {centerValue}
      </text>
      <text
        x="50%"
        y="62%"
        textAnchor="middle"
        className={styles.centerLabel}
      >
        {centerLabel}
      </text>
    </svg>
  );
}

/** Formats a gauge center value without importing the page's formatting. */
export function gaugeTokenText(value: number): string {
  return formatTokenCount(value);
}
