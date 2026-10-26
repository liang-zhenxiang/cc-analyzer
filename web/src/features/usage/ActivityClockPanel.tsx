import { EmptyState } from "../../components/EmptyState";
import { formatTokenCount } from "../../lib/format";
import type { ActivityClock } from "./activityClock";
import styles from "./ActivityClockPanel.module.css";

/**
 * F4「节奏时钟」：把 `周 × 小时` 的 7×24 格折成 24 个小时极坐标扇区——
 * 半径 = 该小时总量相对峰值，颜色浓度 = 量级，峰值那一格加描边并标 `HH:00`。
 *
 * 纯 SVG（和 F1 同一策略：不引 chart 库）。数据与热力图同源（`range.hourly`），
 * 因此两档视图切换时数字不变、只换画法；扇区只用 `--chart-1` 一个色相。
 * 探针：`data-clock-hour` / `data-level` / `data-peak`。
 */

const SIZE = 320;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER = 124;
const INNER = 44;
const GAP_DEG = 1.2;
const LEVEL_CLASSES = [styles.level1, styles.level2, styles.level3, styles.level4];

function polar(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(radians), CY + radius * Math.sin(radians)];
}

/** One 15° annular sector; gap keeps neighbouring hours visually separable. */
function wedgePath(hour: number, radius: number): string {
  const start = hour * 15 + GAP_DEG / 2;
  const end = hour * 15 + 15 - GAP_DEG / 2;
  const [outerStartX, outerStartY] = polar(radius, start);
  const [outerEndX, outerEndY] = polar(radius, end);
  const [innerEndX, innerEndY] = polar(INNER, end);
  const [innerStartX, innerStartY] = polar(INNER, start);
  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${radius} ${radius} 0 0 1 ${outerEndX} ${outerEndY}`,
    `L ${innerEndX} ${innerEndY}`,
    `A ${INNER} ${INNER} 0 0 0 ${innerStartX} ${innerStartY}`,
    "Z"
  ].join(" ");
}

function levelOf(total: number, max: number): number {
  if (total <= 0 || max <= 0) return 0;
  // Four translucent steps, same idea as the heatmap's five opacity steps.
  return Math.min(4, Math.max(1, Math.ceil((total / max) * 4)));
}

export function ActivityClockPanel({ clock }: { clock: ActivityClock }) {
  if (clock.total <= 0 || clock.peakHour === null) {
    return (
      <div data-probe="clock-root">
        <EmptyState size="inline" title="没有可画的时段" />
      </div>
    );
  }

  const peak = clock.peakHour;
  const peakLabel = `${peak}:00`;

  return (
    <div data-probe="clock-root" className={styles.wrap}>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`活跃时段时钟：峰值 ${peakLabel}`}
      >
        {clock.hours.map((hour) => {
          const level = levelOf(hour.total, clock.max);
          if (level === 0) return null;
          const radius = INNER + (OUTER - INNER) * (hour.total / clock.max);
          const className = [styles.wedge, LEVEL_CLASSES[level - 1], hour.peak ? styles.peak : null]
            .filter(Boolean)
            .join(" ");
          return (
            <path
              key={hour.hour}
              d={wedgePath(hour.hour, radius)}
              className={className}
              data-clock-hour={hour.hour}
              data-level={level}
              data-peak={hour.peak ? "true" : undefined}
            >
              <title>{`${hour.hour}:00 · ${formatTokenCount(hour.total)} 条`}</title>
            </path>
          );
        })}

        {[0, 6, 12, 18].map((hour) => {
          const [x, y] = polar(OUTER + 16, hour * 15);
          return (
            <text key={hour} x={x} y={y + 3} textAnchor="middle" className={styles.hourLabel}>
              {`${hour}:00`}
            </text>
          );
        })}

        <text x={CX} y={CY - 5} textAnchor="middle" className={styles.peakLabel}>
          峰值
        </text>
        <text x={CX} y={CY + 15} textAnchor="middle" className={styles.peakHour}>
          {peakLabel}
        </text>
      </svg>

      <p className={styles.legend}>按小时聚合 · 半径 = 相对总量</p>
    </div>
  );
}
