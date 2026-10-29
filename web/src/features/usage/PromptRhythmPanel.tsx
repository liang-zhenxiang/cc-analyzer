import { useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatClock } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildPromptRhythm,
  formatRhythmChars,
  formatRhythmInterval,
  logPosition,
  RHYTHM_MAX_CHARS,
  RHYTHM_MAX_INTERVAL_MS,
  RHYTHM_MIN_INTERVAL_MS,
  RHYTHM_MIN_SAMPLES,
  type RhythmProject
} from "./promptRhythm";
import styles from "./PromptRhythmPanel.module.css";
import primitives from "./charts/chartPrimitives.module.css";

/**
 * F10「提示词节奏」：每个用户提示一个点。
 *
 * 横轴 = 与上一条用户消息的间隔（5 秒 – 24 小时，对数）；纵轴 = 提示字数
 * （1 – 1 万字，对数）；颜色 = 消息数前 6 的项目，其余中性色。中位十字用
 * `--text-tertiary` 虚线，交点右上方给读数。点不做焦点目标——读屏走摘要、
 * 中位读数与图例。
 */

const WIDTH = 720;
const HEIGHT = 260;
const LEFT = 44;
const RIGHT = 12;
const TOP = 12;
const BOTTOM = 28;
const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;

const X_TICKS = [
  { value: 10_000, label: "10 秒" },
  { value: 60_000, label: "1 分" },
  { value: 600_000, label: "10 分" },
  { value: 3_600_000, label: "1 小时" },
  { value: 21_600_000, label: "6 小时" },
  { value: RHYTHM_MAX_INTERVAL_MS, label: "24 小时" }
];
const Y_TICKS = [
  { value: 10, label: "10" },
  { value: 100, label: "100" },
  { value: 1_000, label: "1k" },
  { value: 10_000, label: "10k" }
];
/** 「其他」图例的开关键；项目名不可能是这个串（它带下划线前缀）。 */
const OTHER_SENTINEL = "__other__";
const SERIES_CLASSES = [
  styles.series1,
  styles.series2,
  styles.series3,
  styles.series4,
  styles.series5,
  styles.series6
];

function seriesClass(colorIndex: number | null): string {
  return colorIndex === null ? styles.other : SERIES_CLASSES[colorIndex];
}

function formatPointStamp(at: number): string {
  const date = new Date(at);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${formatClock(at)}`;
}

function toggleInSet(current: ReadonlySet<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function PromptRhythmPanel({
  inputs,
  days,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const data = useMemo(() => buildPromptRhythm(inputs, days, now), [inputs, days, now]);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  const topProjects: RhythmProject[] = data.projects.filter(
    (project) => project.colorIndex !== null
  );
  const hasOther = data.projects.some((project) => project.colorIndex === null);
  const visiblePoints = data.points.filter((point) =>
    point.colorIndex === null ? !hidden.has(OTHER_SENTINEL) : !hidden.has(point.projectLabel)
  );

  const skippedTotal =
    data.skipped.empty +
    data.skipped.tooShort +
    data.skipped.tooLong +
    data.skipped.tooBig;

  const firstPoint = data.points[0];
  const sameInterval =
    data.points.length > 1 &&
    data.points.every((point) => point.intervalMs === firstPoint.intervalMs);
  const sameChars =
    data.points.length > 1 && data.points.every((point) => point.chars === firstPoint.chars);
  const degenerateNote =
    sameInterval && sameChars
      ? "所有点的间隔与字数都相同，散点退化成一点。"
      : sameInterval
        ? "所有点的间隔相同，横轴退化成一列；不做抖动。"
        : sameChars
          ? "所有点的字数相同，纵轴退化成一排；不做抖动。"
          : "";

  const medianLabel =
    data.medianIntervalMs !== null && data.medianChars !== null
      ? `中位 ${formatRhythmInterval(data.medianIntervalMs)} · ${formatRhythmChars(data.medianChars)}`
      : null;

  if (data.sampleCount === 0) {
    return (
      <Panel
        title="提示词节奏"
        ariaLabel="提示词节奏"
        titleAs="h3"
        actions={<span className={styles.scope}>0 条用户消息</span>}
      >
        <div data-probe="lab-scatter">
          <EmptyState size="inline" title="所选范围内没有可读的用户消息" />
          <p className={styles.reason}>
            只统计用户原文；压缩摘要、系统注入与中断标记不算「说话」。
          </p>
        </div>
      </Panel>
    );
  }

  if (data.sampleCount < RHYTHM_MIN_SAMPLES || data.plottedCount === 0) {
    const title =
      data.plottedCount === 0
        ? "所有用户消息都落在可画范围之外"
        : `样本太少（${data.sampleCount} 条用户消息），散点读不出节奏`;
    return (
      <Panel
        title="提示词节奏"
        ariaLabel="提示词节奏"
        titleAs="h3"
        actions={<span className={styles.scope}>{`${data.sampleCount} 条用户消息`}</span>}
      >
        <div data-probe="lab-scatter">
          <EmptyState size="inline" title={title} />
          <p className={styles.reason}>
            {`散点需要至少 ${RHYTHM_MIN_SAMPLES} 条用户消息；间隔需在 5 秒到 24 小时之间，字数不超过 1 万。`}
          </p>
        </div>
      </Panel>
    );
  }

  const medianX =
    data.medianX === null ? null : LEFT + data.medianX * PLOT_WIDTH;
  const medianY =
    data.medianY === null ? null : TOP + (1 - data.medianY) * PLOT_HEIGHT;

  const summary = `提示词节奏：近 ${days} 天 ${data.sampleCount} 条用户消息，画出 ${data.plottedCount} 个点${
    medianLabel ? `；${medianLabel}` : ""
  }${skippedTotal > 0 ? `；${skippedTotal} 个点因间隔或长度超出范围未画出` : ""}。`;

  return (
    <Panel
      title="提示词节奏"
      ariaLabel="提示词节奏"
      titleAs="h3"
      actions={<span className={styles.scope}>{`${data.sampleCount} 条用户消息`}</span>}
    >
      <div data-probe="lab-scatter">
        <svg
          className={primitives.chart}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={summary}
        >
          {X_TICKS.map((tick) => {
            const x = LEFT + logPosition(tick.value, RHYTHM_MIN_INTERVAL_MS, RHYTHM_MAX_INTERVAL_MS) * PLOT_WIDTH;
            return (
              <g key={tick.value}>
                <line
                  x1={x}
                  x2={x}
                  y1={TOP}
                  y2={TOP + PLOT_HEIGHT}
                  className={primitives.gridLine}
                />
                <text
                  x={x}
                  y={HEIGHT - 10}
                  textAnchor="middle"
                  className={primitives.tickText}
                >
                  {tick.label}
                </text>
              </g>
            );
          })}

          {Y_TICKS.map((tick) => {
            const y = TOP + (1 - logPosition(tick.value, 1, RHYTHM_MAX_CHARS)) * PLOT_HEIGHT;
            return (
              <g key={tick.value}>
                <line
                  x1={LEFT}
                  x2={WIDTH - RIGHT}
                  y1={y}
                  y2={y}
                  className={primitives.gridLine}
                />
                <text
                  x={LEFT - 6}
                  y={y + 3}
                  textAnchor="end"
                  className={primitives.tickText}
                >
                  {tick.label}
                </text>
              </g>
            );
          })}

          <line
            x1={LEFT}
            x2={LEFT}
            y1={TOP}
            y2={TOP + PLOT_HEIGHT}
            className={primitives.axisLine}
          />
          <line
            x1={LEFT}
            x2={WIDTH - RIGHT}
            y1={TOP + PLOT_HEIGHT}
            y2={TOP + PLOT_HEIGHT}
            className={primitives.axisLine}
          />

          {medianX !== null ? (
            <line
              x1={medianX}
              x2={medianX}
              y1={TOP}
              y2={TOP + PLOT_HEIGHT}
              className={styles.medianLine}
            />
          ) : null}
          {medianY !== null ? (
            <line
              x1={LEFT}
              x2={WIDTH - RIGHT}
              y1={medianY}
              y2={medianY}
              className={styles.medianLine}
            />
          ) : null}

          {visiblePoints.map((point, index) => (
            <circle
              key={`${point.at}-${index}`}
              cx={LEFT + point.x * PLOT_WIDTH}
              cy={TOP + (1 - point.y) * PLOT_HEIGHT}
              r={2.6}
              className={`${styles.point} ${seriesClass(point.colorIndex)}`}
              data-rhythm-point={point.colorIndex ?? "other"}
            >
              <title>
                {`${point.projectLabel} · ${formatPointStamp(point.at)} · 间隔 ${formatRhythmInterval(point.intervalMs)} · ${point.chars} 字`}
              </title>
            </circle>
          ))}

          {medianX !== null && medianY !== null && medianLabel ? (
            <text
              x={medianX > WIDTH * 0.72 ? medianX - 6 : medianX + 6}
              y={medianY < TOP + 20 ? medianY + 14 : medianY - 6}
              textAnchor={medianX > WIDTH * 0.72 ? "end" : "start"}
              className={styles.medianLabel}
            >
              {medianLabel}
            </text>
          ) : null}
        </svg>

        <ul className={styles.legend} aria-label="项目图例（可点选隐藏）">
          {topProjects.map((project) => (
            <li key={project.label}>
              <button
                type="button"
                className={styles.legendItem}
                aria-pressed={!hidden.has(project.label)}
                onClick={() => setHidden((current) => toggleInSet(current, project.label))}
              >
                <span
                  className={`${styles.swatch} ${seriesClass(project.colorIndex)}`}
                  aria-hidden="true"
                />
                {project.label}
                <span className={styles.legendCount}>{project.messages}</span>
              </button>
            </li>
          ))}
          {hasOther ? (
            <li>
              <button
                type="button"
                className={styles.legendItem}
                aria-pressed={!hidden.has(OTHER_SENTINEL)}
                onClick={() => setHidden((current) => toggleInSet(current, OTHER_SENTINEL))}
              >
                <span
                  className={`${styles.swatch} ${styles.other}`}
                  aria-hidden="true"
                />
                其他
              </button>
            </li>
          ) : null}
        </ul>

        <p className={styles.footnote}>
          {`${degenerateNote}间隔 = 与上一条用户消息的时间差；字数 = 用户原文的 Unicode 码点数，不含压缩摘要、系统注入与中断标记。0 字的消息 ${data.skipped.empty} 条不计入；少于 5 秒 ${data.skipped.tooShort} 条、超过 24 小时 ${data.skipped.tooLong} 条或超过 1 万字 ${data.skipped.tooBig} 条未画出；首条消息 ${data.skipped.noPrevious} 条没有间隔。图例可点选隐藏项目，中位线按全部画出的点计算。`}
          {data.sampleCount <= 20 ? "样本较少，中位数仅供参考。" : ""}
        </p>
      </div>
    </Panel>
  );
}
