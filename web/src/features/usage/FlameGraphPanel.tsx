import { useMemo } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { formatDuration } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { useFontScale } from "../settings/fontScale";
import type { UsageSessionInput } from "./usageAggregations";
import { buildFlameGraph, type FlameMode, type FlameRow } from "./flameGraph";
import styles from "./FlameGraphPanel.module.css";

/**
 * F3「工具火焰」：每个会话一条横向时间带，带子被工具耗时切成一段一段。
 *
 * 纯 DOM 而不是 SVG：行标签与数值要按真实字号渲染，不能被 viewBox 集体
 * 缩小。条长口径来自 `buildFlameGraph`——只累计配对了工具结果的耗时；未配对
 * 的调用在右列标 `?N`，不画成零耗时段。全局都没有耗时读数时降级为按次数。
 */

const ROW_LIMIT = 12;
const ROW_LIMIT_LARGE_FONT = 8;
const AXIS_TICKS = [0, 0.25, 0.5, 0.75, 1];
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

function axisLabel(value: number, mode: FlameMode): string {
  if (mode === "calls") return `${Math.round(value)} 次`;
  return value <= 0 ? "0" : formatDuration(value);
}

function leadingTool(row: FlameRow, mode: FlameMode): string | null {
  let best: { label: string; weight: number } | null = null;
  for (const segment of row.segments) {
    const weight = mode === "duration" ? segment.durationMs : segment.calls;
    if (weight <= 0) continue;
    if (!best || weight > best.weight) best = { label: segment.label, weight };
  }
  return best?.label ?? null;
}

function rowAria(row: FlameRow, mode: FlameMode): string {
  const leading = leadingTool(row, mode);
  if (mode === "calls") {
    return `${row.label}：${row.calls} 次工具调用${leading ? `，${leading} 最多` : ""}`;
  }
  const head = `${row.label}：工具耗时 ${formatDuration(row.totalDurationMs)}${leading ? `，${leading} 最多` : ""}`;
  return row.unknownCalls > 0 ? `${head}；${row.unknownCalls} 次耗时未知` : head;
}

export function FlameGraphPanel({
  inputs,
  days,
  now,
  onOpenSession
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const fontScale = useFontScale();
  const data = useMemo(() => buildFlameGraph(inputs, days, now), [inputs, days, now]);
  const rowLimit = fontScale > 1.2 ? ROW_LIMIT_LARGE_FONT : ROW_LIMIT;
  const rows = data.rows.slice(0, rowLimit);
  const hiddenRows = data.rows.length - rows.length;

  if (data.totalCalls === 0) {
    return (
      <Panel
        title="工具火焰"
        ariaLabel="工具火焰"
        titleAs="h3"
        actions={<span className={styles.scope}>0 个会话</span>}
      >
        <div data-probe="lab-flame">
          <EmptyState size="inline" title="所选范围内没有工具调用" />
          <p className={styles.emptyReason}>本窗口的会话日志里没有出现任何 tool_use。</p>
        </div>
      </Panel>
    );
  }

  const top = rows[0];
  const unknownNote =
    data.unknownCalls > 0 ? `；另有 ${data.unknownCalls} 次调用耗时未知` : "";
  const summary =
    data.mode === "duration" && top
      ? `工具火焰：${data.rows.length} 个会话的工具耗时；最长的是 ${top.label}（${leadingTool(top, data.mode) ?? "某个工具"} ${formatDuration(top.totalDurationMs)}）${unknownNote}。`
      : `工具火焰：${data.rows.length} 个会话共 ${data.totalCalls} 次工具调用，条长按次数计。`;

  return (
    <Panel
      title="工具火焰"
      ariaLabel="工具火焰"
      titleAs="h3"
      actions={
        <span className={styles.actions}>
          {data.mode === "calls" ? (
            <span className={styles.modeChip}>按次数（耗时缺失）</span>
          ) : null}
          <span className={styles.scope}>{`${data.rows.length} 个会话`}</span>
        </span>
      }
    >
      <div className={styles.chart} data-probe="lab-flame">
        <p className={styles.srOnly} role="img" aria-label={summary} />

        <p className={styles.axisTitle}>
          {data.mode === "duration" ? "已测耗时" : "调用次数"}
        </p>
        <div className={styles.axis} aria-hidden="true">
          {AXIS_TICKS.map((fraction) => (
            <span
              key={fraction}
              className={styles.axisLabel}
              style={{ left: `${fraction * 100}%` }}
            >
              {axisLabel(data.maxValue * fraction, data.mode)}
            </span>
          ))}
        </div>

        <div className={styles.body}>
          {rows.map((row) => {
            const meta = inputs[row.sessionIndex]?.session;
            let cursor = 0;
            const segments = row.segments.map((segment) => {
              const weight =
                data.mode === "duration" ? segment.durationMs : segment.calls;
              const width = data.maxValue > 0 ? (weight / data.maxValue) * 100 : 0;
              const left = cursor;
              cursor += width;
              return { segment, left, width };
            });

            return (
              <button
                type="button"
                key={row.sessionKey}
                className={styles.row}
                data-probe="lab-flame-row"
                data-session={row.sessionKey}
                aria-label={rowAria(row, data.mode)}
                onClick={meta && onOpenSession ? () => onOpenSession(meta) : undefined}
              >
                <span className={styles.label} title={row.label}>
                  {row.label}
                </span>
                <span className={styles.track}>
                  {segments.map(({ segment, left, width }) => (
                    <span
                      key={segment.toolId}
                      className={`${styles.segment} ${seriesClass(segment.colorIndex)}`}
                      data-flame-segment={segment.toolId}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={
                        data.mode === "duration"
                          ? `${segment.label} · ${formatDuration(segment.durationMs)} · ${segment.calls} 次`
                          : `${segment.label} · ${segment.calls} 次`
                      }
                    />
                  ))}
                </span>
                <span className={styles.unknown}>
                  {data.mode === "duration" && row.unknownCalls > 0
                    ? `?${row.unknownCalls}`
                    : ""}
                </span>
              </button>
            );
          })}
        </div>

        <ul className={styles.legend} aria-label="工具图例">
          {data.tools.map((tool) => (
            <li key={tool.id} className={styles.legendItem}>
              <span
                className={`${styles.swatch} ${seriesClass(tool.colorIndex)}`}
                aria-hidden="true"
              />
              {tool.label}
            </li>
          ))}
          {data.hasOther ? (
            <li className={styles.legendItem}>
              <span
                className={`${styles.swatch} ${styles.other}`}
                aria-hidden="true"
              />
              其他
            </li>
          ) : null}
        </ul>

        <p className={styles.footnote}>
          {data.mode === "calls"
            ? "本窗口的工具调用都没有配对结果，条长改为调用次数；未知耗时不会被当成 0。"
            : "只累计配对了工具结果的调用耗时；未配对的调用在右列标 ? 计数，不进条长。含子 agent 的调用——那是真实耗时，但与成本卡的主链口径不同。"}
          {hiddenRows > 0 ? `另有 ${hiddenRows} 个会话未画出，按条长排在后面。` : ""}
        </p>
      </div>
    </Panel>
  );
}
