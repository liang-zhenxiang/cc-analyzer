import { EmptyState } from "../../../components/EmptyState";
import { WEEKDAY_LABELS, WEEKDAY_ROW_TO_DAY } from "./chartPrimitives";
import primitiveStyles from "./chartPrimitives.module.css";
import styles from "./Heatmap.module.css";

const CELL = 20;
const GAP = 2;
const LABEL_LEFT = 22;
const LABEL_TOP = 16;
const HOUR_STRIDE = 4;

/**
 * Opacity ladder for `--chart-1`. The hottest level stays below solid —
 * large-area fills (bars, areas, heat cells) are soft-only per design.md §6;
 * solid color is reserved for strokes, dots and small badges.
 */
const OPACITY_STEPS = [0, 0.3, 0.5, 0.68, 0.84];

/** The four non-empty levels, for the colour key. */
const LEGEND_LEVELS = OPACITY_STEPS.slice(1);

/**
 * 7×24 activity heatmap. `counts` is indexed `[getDay()][hour]` (0 = Sunday),
 * exactly as `usageAggregations` produces it; rows render Monday-first.
 *
 * The colour key is part of the component, not the caller: a heatmap whose
 * ladder is only visible as colour has no scale — a reader cannot tell "quiet"
 * from "half-empty legend". Empty cells are filled, never outlined, so the
 * outline means one thing only (this cell has data).
 */
export function Heatmap({
  counts,
  ariaLabel,
  emptyText = "暂无活跃时段"
}: {
  counts: number[][];
  ariaLabel: string;
  emptyText?: string;
}) {
  const total = counts.reduce((sum, row) => sum + row.reduce((a, b) => a + b, 0), 0);
  if (total <= 0) {
    return <EmptyState size="panel" title={emptyText} />;
  }

  const max = counts.reduce((highest, row) => Math.max(highest, ...row), 0);
  const width = LABEL_LEFT + 24 * CELL + 23 * GAP + 8;
  const height = LABEL_TOP + 7 * CELL + 6 * GAP + 6;

  return (
    <div className={styles.wrap}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className={primitiveStyles.chart}>
        {Array.from({ length: 24 }, (_, hour) =>
          hour % HOUR_STRIDE === 0 ? (
            <text
              key={hour}
              x={LABEL_LEFT + hour * (CELL + GAP)}
              y={12}
              className={`${primitiveStyles.tickText} ${primitiveStyles.numeric}`}
            >
              {hour}
            </text>
          ) : null
        )}
        {WEEKDAY_ROW_TO_DAY.map((day, rowIndex) => (
          <g key={day}>
            <text
              x={LABEL_LEFT - 8}
              y={LABEL_TOP + rowIndex * (CELL + GAP) + CELL / 2 + 4}
              textAnchor="end"
              className={primitiveStyles.tickText}
            >
              {WEEKDAY_LABELS[rowIndex]}
            </text>
            {Array.from({ length: 24 }, (_, hour) => {
              const count = counts[day]?.[hour] ?? 0;
              const level =
                count <= 0 ? 0 : Math.max(1, Math.ceil((count / max) * (OPACITY_STEPS.length - 1)));
              return (
                <rect
                  key={hour}
                  x={LABEL_LEFT + hour * (CELL + GAP)}
                  y={LABEL_TOP + rowIndex * (CELL + GAP)}
                  width={CELL}
                  height={CELL}
                  className={level === 0 ? styles.emptyCell : styles.cell}
                  fillOpacity={level === 0 ? undefined : OPACITY_STEPS[level]}
                >
                  <title>{`${WEEKDAY_LABELS[rowIndex]} ${hour}时：${count} 条消息`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
      {/* 色阶图例：格子本身是渐变，没有刻度就只能靠猜。四档与格子同一套阶梯。 */}
      <div className={styles.legend} data-heat-legend>
        <span className={styles.legendLabel}>少</span>
        {LEGEND_LEVELS.map((level) => (
          <span key={level} aria-hidden="true" className={styles.legendCell} style={{ opacity: level }} />
        ))}
        <span className={styles.legendLabel}>多</span>
      </div>
    </div>
  );
}
