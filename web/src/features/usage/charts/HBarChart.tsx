import { EmptyState } from "../../../components/EmptyState";
import { formatTokenCount } from "../../../lib/format";
import primitiveStyles from "./chartPrimitives.module.css";
import styles from "./HBarChart.module.css";

/** Horizontal bars for the per-project Top-N; lengths normalise to the max. */
export function HBarChart({
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
  if (data.length === 0) {
    return <EmptyState size="panel" title={emptyText} />;
  }

  const width = 720;
  const labelWidth = 170;
  const valueWidth = 76;
  const rowHeight = 26;
  const padTop = 4;
  const padBottom = 4;
  const plotWidth = width - labelWidth - valueWidth;
  const height = padTop + data.length * rowHeight + padBottom;
  const maxValue = Math.max(...data.map((point) => point.value), 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className={primitiveStyles.chart}>
      {data.map((point, index) => {
        const y = padTop + index * rowHeight;
        const barWidth = (point.value / maxValue) * plotWidth;
        return (
          <g key={`${point.label}-${index}`}>
            <text
              x={labelWidth - 8}
              y={y + rowHeight / 2 + 4}
              textAnchor="end"
              className={primitiveStyles.tickText}
            >
              {point.label}
            </text>
            <rect x={labelWidth} y={y + 5} width={barWidth} height={rowHeight - 10} className={styles.bar}>
              <title>{`${point.label}：${formatValue(point.value)}`}</title>
            </rect>
            <text
              x={labelWidth + barWidth + 8}
              y={y + rowHeight / 2 + 4}
              className={`${primitiveStyles.tickText} ${primitiveStyles.numeric}`}
            >
              {formatValue(point.value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
