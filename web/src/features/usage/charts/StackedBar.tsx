import { EmptyState } from "../../../components/EmptyState";
import { formatTokenCount } from "../../../lib/format";
import primitiveStyles from "./chartPrimitives.module.css";
import styles from "./StackedBar.module.css";

/**
 * Single-row stacked bar for the per-model share. Segment colors cycle
 * `--chart-1..6` — 6 is the categorical palette length in `tokens.css`, so
 * the modulo must stay in sync with it; inline `fill` is the one sanctioned
 * dynamic-token use, since a CSS module class name cannot be computed from
 * an index.
 */
export function StackedBar({
  data,
  formatValue = formatTokenCount,
  ariaLabel,
  emptyText = "暂无数据"
}: {
  data: { label: string; value: number }[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyText?: string;
}) {
  const total = data.reduce((sum, point) => sum + point.value, 0);
  if (data.length === 0 || total <= 0) {
    return <EmptyState size="panel" title={emptyText} />;
  }

  const width = 720;
  const height = 30;
  const pad = 2;
  const plotWidth = width - pad * 2;
  let x = pad;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className={primitiveStyles.chart}>
      {data.map((point, index) => {
        const segmentWidth = (point.value / total) * plotWidth;
        const segment = (
          <rect
            key={`${point.label}-${index}`}
            x={x}
            y={4}
            width={segmentWidth}
            height={height - 8}
            className={styles.segment}
            style={{ fill: `var(--chart-${(index % 6) + 1}, var(--accent))` }}
          >
            <title>{`${point.label}：${formatValue(point.value)}`}</title>
          </rect>
        );
        x += segmentWidth;
        return segment;
      })}
    </svg>
  );
}
