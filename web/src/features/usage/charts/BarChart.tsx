import { EmptyState } from "../../../components/EmptyState";
import { formatTokenCount } from "../../../lib/format";
import { axisTicks, formatAxisValue, GridLine, niceAxisMax } from "./chartPrimitives";
import primitiveStyles from "./chartPrimitives.module.css";
import styles from "./BarChart.module.css";

/** Column chart for the daily trend. Zero-value days still get their (flat) bar. */
export function BarChart({
  data,
  formatValue = formatTokenCount,
  ariaLabel,
  emptyText = "暂无数据",
  height = 220
}: {
  data: { label: string; value: number }[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyText?: string;
  height?: number;
}) {
  if (data.length === 0) {
    return <EmptyState size="panel" title={emptyText} />;
  }

  const width = 720;
  const padLeft = 56;
  const padRight = 10;
  const padTop = 8;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const maxValue = niceAxisMax(Math.max(...data.map((point) => point.value)));
  const ticks = axisTicks(maxValue, 3);
  const slot = plotWidth / data.length;
  const barWidth = Math.min(slot * 0.72, 36);
  // Thin the x labels so 90 days do not stamp 90 strings onto one axis.
  const labelStride = Math.ceil(data.length / 12);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className={primitiveStyles.chart}>
      {ticks.map((tick) => (
        <GridLine
          key={tick}
          x1={padLeft}
          x2={width - padRight}
          y={padTop + (1 - tick / maxValue) * plotHeight}
          label={formatAxisValue(tick)}
          strong={tick === 0}
        />
      ))}
      {data.map((point, index) => {
        const barHeight = (point.value / maxValue) * plotHeight;
        return (
          <rect
            key={`${point.label}-${index}`}
            x={padLeft + index * slot + (slot - barWidth) / 2}
            y={padTop + plotHeight - barHeight}
            width={barWidth}
            height={barHeight}
            className={styles.bar}
          >
            <title>{`${point.label}：${formatValue(point.value)}`}</title>
          </rect>
        );
      })}
      {data.map((point, index) =>
        index % labelStride === 0 ? (
          <text
            key={`label-${index}`}
            x={padLeft + index * slot + slot / 2}
            y={height - 6}
            textAnchor="middle"
            className={primitiveStyles.tickText}
          >
            {point.label}
          </text>
        ) : null
      )}
    </svg>
  );
}
