import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatUsd } from "../../lib/format";
import { useFontScale } from "../settings/fontScale";
import type { SessionMeta } from "../sessions/metadataCache";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { WEEKDAY_LABELS } from "./charts/chartPrimitives";
import {
  TERRAIN_BOTTOM,
  TERRAIN_HEIGHT,
  TERRAIN_LEFT,
  TERRAIN_TOP,
  TERRAIN_WIDTH,
  buildCostTerrain
} from "./costTerrain";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./CostTerrainPanel.module.css";

/**
 * 「成本地形」（F2）：周一至周日 × 24 小时的估算成本等高线地图。
 *
 * 色阶只借 `--cal-1..4`（时间格里的成本强度），等高线只画相邻格跨阈值的
 * 边界短线段——不插值，因为插值会在地图上画出日志里不存在的成本。格子不做
 * 焦点目标：168 个 Tab 停靠点不可用，图形摘要 + 常显峰值标注承担信息。
 */

const LEGEND_SWATCH = 9;
const LEGEND_GAP = 4;

export function CostTerrainPanel({
  inputs,
  days,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  /** F2 没有可点条目；保留接口，让十张实验室卡片的调用形状一致。 */
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const fontScale = useFontScale();
  // 130% 字号下刻度从 3h 放缓到 6h；字号只改字，标签数量由数据层收敛。
  const hourTickStep = fontScale >= 1.3 ? 6 : 3;
  const terrain = useMemo(
    () => buildCostTerrain(inputs, days, now, { hourTickStep }),
    [inputs, days, now, hourTickStep]
  );
  const [hovered, setHovered] = useState<string | null>(null);

  if (terrain.pricedCells === 0) {
    return (
      <div data-probe="lab-terrain">
        <Panel title="成本地形" ariaLabel="成本地形" titleAs="h3">
          <EmptyState size="inline" title="所选范围内没有可估算的成本" />
        </Panel>
      </div>
    );
  }

  const legendY = TERRAIN_HEIGHT - TERRAIN_BOTTOM + 14;
  const legendTextX = TERRAIN_LEFT + 5 * (LEGEND_SWATCH + LEGEND_GAP) + 4;
  const peak = terrain.peak;
  const peakLabel = peak
    ? {
        x: peak.x + peak.width / 2,
        y: Math.max(TERRAIN_TOP + 10, peak.y - 6),
        text: `${WEEKDAY_LABELS[peak.weekday]} ${peak.hour} 时 · ${formatUsd(peak.costUsd)}`
      }
    : null;

  const footnote =
    terrain.unknownCells > 0
      ? `按定价快照估算，不是账单；未定价模型的小时不计入，共 ${terrain.unknownCells} 小时受影响。等高线是阈值边界（p50/p80/p95），不做插值。`
      : "按定价快照估算，不是账单；本窗口没有未定价模型的小时。等高线是阈值边界（p50/p80/p95），不做插值。";

  return (
    <div data-probe="lab-terrain">
      <Panel
        title="成本地形"
        ariaLabel="成本地形"
        titleAs="h3"
        actions={
          <span className={styles.actions}>
            <span className={styles.scope}>{terrain.windowLabel}</span>
            <ProvenanceBadge provenance="estimated" />
          </span>
        }
      >
        <svg
          className={styles.chart}
          viewBox={`0 0 ${TERRAIN_WIDTH} ${TERRAIN_HEIGHT}`}
          role="img"
          aria-label={terrain.summary}
        >
          {terrain.hourTicks.map((tick) => (
            <text
              key={`hour-${tick.hour}`}
              x={tick.x}
              y={13}
              textAnchor="middle"
              className={styles.hourLabel}
            >
              {tick.hour}
            </text>
          ))}

          {WEEKDAY_LABELS.map((label, weekday) => {
            const first = terrain.rows[weekday][0];
            return (
              <text
                key={`weekday-${label}`}
                x={TERRAIN_LEFT - 8}
                y={first.y + first.height / 2 + 4}
                textAnchor="end"
                className={styles.weekdayLabel}
              >
                {label}
              </text>
            );
          })}

          {terrain.cells.map((cell) => {
            const key = `${cell.weekday}-${cell.hour}`;
            const isHovered = hovered === key;
            const title =
              cell.costUsd > 0
                ? `周${WEEKDAY_LABELS[cell.weekday]} ${cell.hour} 时 · ${formatUsd(cell.costUsd)}${cell.hasUnknown ? " · 含未定价模型" : ""} · 占本窗口成本 ${(cell.share * 100).toFixed(1)}%`
                : cell.hasUnknown
                  ? `周${WEEKDAY_LABELS[cell.weekday]} ${cell.hour} 时 · 含未定价模型，未计入成本`
                  : `周${WEEKDAY_LABELS[cell.weekday]} ${cell.hour} 时 · 无消耗`;
            return (
              <rect
                key={key}
                x={cell.x}
                y={cell.y}
                width={cell.width}
                height={cell.height}
                fill={cell.level > 0 ? `var(--cal-${cell.level})` : "var(--bg-inset)"}
                className={`${styles.cell} ${isHovered ? styles.cellHovered : ""}`}
                data-terrain-cell={key}
                data-terrain-hovered={isHovered ? "true" : undefined}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
              >
                <title>{title}</title>
              </rect>
            );
          })}

          {terrain.contours.map((contour) => (
            <g key={contour.key}>
              {contour.segments.map((segment) => (
                <line
                  key={segment.id}
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  className={styles.contour}
                  data-terrain-contour={contour.key}
                />
              ))}
              {contour.label ? (
                <text
                  x={contour.label.x}
                  y={contour.label.y}
                  textAnchor={contour.label.anchor}
                  className={styles.contourLabel}
                >
                  {formatUsd(contour.value)}
                </text>
              ) : null}
            </g>
          ))}

          {peak ? (
            <rect
              x={peak.x}
              y={peak.y}
              width={peak.width}
              height={peak.height}
              rx={2}
              className={styles.peak}
              data-terrain-peak="true"
            />
          ) : null}

          {peakLabel ? (
            <text
              x={peakLabel.x}
              y={peakLabel.y}
              textAnchor="middle"
              className={styles.peakLabel}
            >
              {peakLabel.text}
            </text>
          ) : null}

          {/* 图例：四档色块 + 一枚「无消耗」空槽。 */}
          {[1, 2, 3, 4].map((level) => (
            <rect
              key={`legend-${level}`}
              x={TERRAIN_LEFT + (level - 1) * (LEGEND_SWATCH + LEGEND_GAP)}
              y={legendY - LEGEND_SWATCH}
              width={LEGEND_SWATCH}
              height={LEGEND_SWATCH}
              rx={1}
              fill={`var(--cal-${level})`}
            />
          ))}
          <rect
            x={TERRAIN_LEFT + 4 * (LEGEND_SWATCH + LEGEND_GAP)}
            y={legendY - LEGEND_SWATCH}
            width={LEGEND_SWATCH}
            height={LEGEND_SWATCH}
            className={styles.legendEmpty}
          >
            <title>无消耗</title>
          </rect>
          <text x={legendTextX} y={legendY} className={styles.legendText}>
            估算成本 / 小时
          </text>
        </svg>
        <p className={styles.footnote}>{footnote}</p>
      </Panel>
    </div>
  );
}
