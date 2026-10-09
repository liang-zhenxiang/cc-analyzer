import { EmptyState } from "../../../components/EmptyState";
import { formatTokenCount } from "../../../lib/format";
import primitiveStyles from "./chartPrimitives.module.css";
import styles from "./StackedBar.module.css";

/**
 * Single-row stacked bar for the per-model share. Segment colors cycle
 * `--chart-1..6` — 6 is the categorical palette length in `tokens.css`, so
 * the modulo must stay in sync with it; inline `fill` is the one sanctioned
 * dynamic-token use, since a CSS module class name cannot be computed from
 * an index. `palette` overrides the cycle per segment (compaction's auto/manual
 * pair is chart-1 × chart-4 — adjacent chart-1/2 collapses under CVD, see
 * design §1-8).
 */
export function StackedBar({
  data,
  formatValue = formatTokenCount,
  ariaLabel,
  emptyText = "暂无数据",
  palette
}: {
  /** `hint` is the untruncated identity behind a shortened `label` — see HBarChart. */
  data: { label: string; value: number; hint?: string }[];
  formatValue?: (value: number) => string;
  ariaLabel: string;
  emptyText?: string;
  /** Per-segment colours as css `var()` strings; falls back to the cycle above. */
  palette?: Array<{ fill: string; stroke: string }>;
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
            /* design.md §6 从严：整行全宽的堆叠段属大面积填充，走 soft；
               实色只出现在 1px 分段描边与图例小色块（小徽章允许实色）。 */
            style={
              palette?.[index] ?? {
                fill: `var(--chart-${(index % 6) + 1}-soft, var(--accent-soft))`,
                stroke: `var(--chart-${(index % 6) + 1}, var(--accent))`
              }
            }
          >
            <title>{`${point.hint ?? point.label}：${formatValue(point.value)}`}</title>
          </rect>
        );
        x += segmentWidth;
        return segment;
      })}
    </svg>
  );
}
