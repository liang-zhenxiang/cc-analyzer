import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../../components/Panel";
import { axisTicks, formatAxisValue, GridLine, niceAxisMax } from "./charts/chartPrimitives";
import primitiveStyles from "./charts/chartPrimitives.module.css";
import { formatDayLabel } from "./usageAggregations";
import { ANOMALY_RULE_TEXT, type ErrorDayPoint } from "./errorStats";
import { ProvenanceBadge } from "./ProvenanceBadge";
import styles from "./ErrorTrendChart.module.css";

const WIDTH = 720;
const HEIGHT = 200;
const PAD_LEFT = 56;
const PAD_RIGHT = 10;
const PAD_TOP = 14;
const PAD_BOTTOM = 24;
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;
const PLOT_HEIGHT = HEIGHT - PAD_TOP - PAD_BOTTOM;
/** 值为 0 的天画 1.5px 短桩（BarChart 惯例：没有错误是事实，不是缺口）。 */
const MIN_BAR_HEIGHT = 1.5;
const WEEKDAY_OF_DAY = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 归一数（每千条模型消息）——无分母的天是 undefined，不是 0（0/0 画成 0 是撒谎）。 */
function per1k(count: number, denominator: number): number | undefined {
  return denominator > 0 ? (count / denominator) * 1000 : undefined;
}

function formatPer1k(value: number | undefined): string {
  return value === undefined ? "—" : value.toFixed(1);
}

/**
 * 「每日错误率」趋势图（design §3.2）：工具错误 = chart-1 柱，API 错误 =
 * chart-4 线，同轴同单位（每千条模型消息）。归一数是主读数——原始数住在
 * tooltip、异常日直标与切面读数里；异常日 ▲ 与异常线是页面上仅有的
 * `--danger` 数据墨水。
 *
 * 交互骨架（rAF 合帧的悬停、crosshair、键盘逐日）与 ContextView 同款。
 */
export function ErrorTrendChart({
  daily,
  threshold,
  totalTool,
  totalApi,
  days,
  selectedDay,
  onToggleDay,
  onClearFilter
}: {
  daily: readonly ErrorDayPoint[];
  threshold: number | null;
  totalTool: number;
  totalApi: number;
  days: number;
  /** 当前选中的日过滤（null = 无）；本图只高亮 day 过滤。 */
  selectedDay: number | null;
  onToggleDay: (dayStart: number | null) => void;
  onClearFilter: () => void;
}) {
  const points = useMemo(
    () =>
      daily.map((point) => ({
        ...point,
        toolPer1k: per1k(point.tool, point.assistantMessages),
        apiPer1k: per1k(point.api, point.assistantMessages)
      })),
    [daily]
  );

  const anomalyDays = useMemo(() => daily.filter((point) => point.anomalous), [daily]);

  const chart = useMemo(() => {
    const dataMax = Math.max(
      ...points.map((point) => point.toolPer1k ?? 0),
      ...points.map((point) => point.apiPer1k ?? 0),
      threshold ?? 0
    );
    // 轴域必须容纳参考线（阈值），否则异常线画出界。
    const maxValue = niceAxisMax(dataMax > 0 ? dataMax : 1);
    const yAt = (value: number) => PAD_TOP + (1 - value / maxValue) * PLOT_HEIGHT;
    const slot = points.length > 0 ? PLOT_WIDTH / points.length : PLOT_WIDTH;
    const barWidth = Math.min(slot * 0.72, 44);
    const xAt = (index: number) => PAD_LEFT + index * slot + slot / 2;
    return { maxValue, ticks: axisTicks(maxValue, 3), yAt, slot, barWidth, xAt };
  }, [points, threshold]);

  const labelStride = Math.ceil(Math.max(1, points.length) / 12);
  // ≤31 天档常显数据点；90 天下点会粘连，只留线（design §3.2）。
  const showApiPoints = points.length <= 31;

  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingClientXRef = useRef<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    []
  );

  /** 鼠标 x → 日的下标；绘图区外返回 null（悬停即消隐，点击即无事）。 */
  const indexFromClientX = useCallback((clientX: number): number | null => {
    const wrap = wrapRef.current;
    if (!wrap || points.length === 0) return null;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    if (svgX < PAD_LEFT || svgX > WIDTH - PAD_RIGHT) return null;
    return Math.min(points.length - 1, Math.max(0, Math.floor((svgX - PAD_LEFT) / chart.slot)));
  }, [points.length, chart.slot]);

  // 指针移动经 rAF 合帧：不逐 mousemove setState（ContextView 同款）。
  const scheduleHover = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingClientXRef.current;
        if (pending !== null) setFocusIndex(indexFromClientX(pending));
      });
    },
    [indexFromClientX]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (points.length === 0) return;
      if (event.key === "Escape") {
        onClearFilter();
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        if (event.key === "Enter" || event.key === " ") {
          if (focusIndex !== null) {
            event.preventDefault();
            onToggleDay(points[focusIndex].dayStart);
          }
        }
        return;
      }
      event.preventDefault();
      setFocusIndex((current) => {
        const base = current ?? (event.key === "ArrowRight" ? -1 : points.length);
        return event.key === "ArrowRight"
          ? Math.min(base + 1, points.length - 1)
          : Math.max(base - 1, 0);
      });
    },
    [points, focusIndex, onToggleDay, onClearFilter]
  );

  const ariaLabel = `近 ${days} 天错误率：工具 ${totalTool.toLocaleString("en-US")} 次、API ${totalApi.toLocaleString("en-US")} 次，${anomalyDays.length} 个异常日`;

  const focused = focusIndex !== null ? points[focusIndex] : null;
  // 键盘聚焦的日子与鼠标悬停共用同一份朗读文案（focus 显示 = hover 显示）。
  const focusedReadout = focused
    ? `${formatDayLabel(focused.dayStart)}：工具错误 ${focused.tool} 条（${formatPer1k(focused.toolPer1k)}/千条），API 错误 ${focused.api} 条（${formatPer1k(focused.apiPer1k)}/千条）`
    : "";

  return (
    <Panel
      title="每日错误率"
      ariaLabel="每日错误率"
      actions={<ProvenanceBadge provenance="logged" />}
    >
      <div className={styles.legend} aria-hidden="true">
        <span className={styles.legendItem}>
          <span className={styles.legendTool} /> 工具错误
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendApi} /> API 错误
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendAnomaly} /> 异常日
        </span>
      </div>
      <div
        ref={wrapRef}
        className={styles.chartWrap}
        tabIndex={0}
        role="img"
        aria-label={ariaLabel}
        onMouseMove={(event) => scheduleHover(event.clientX)}
        onMouseLeave={() => setFocusIndex(null)}
        onClick={(event) => {
          const index = indexFromClientX(event.clientX);
          if (index !== null) onToggleDay(points[index].dayStart);
        }}
        onKeyDown={onKeyDown}
        /* data-error-trend：真机门禁取趋势 SVG 几何的稳定锚点。 */
        data-error-trend
      >
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={primitiveStyles.chart} aria-hidden="true">
          {chart.ticks.map((tick) => (
            <GridLine
              key={tick}
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y={chart.yAt(tick)}
              label={formatAxisValue(tick)}
              strong={tick === 0}
            />
          ))}
          {points.map((point, index) =>
            index % labelStride === 0 ? (
              <text
                key={`label-${point.dayStart}`}
                x={chart.xAt(index)}
                y={HEIGHT - 6}
                textAnchor="middle"
                className={primitiveStyles.tickText}
              >
                {formatDayLabel(point.dayStart)}
              </text>
            ) : null
          )}
          {/* API 线按「有分母的日子」分段：无分母天断开，不贴 0。 */}
          {apiSegments(points).map((segment, segmentIndex) => (
            <polyline
              key={`api-${segmentIndex}`}
              points={segment.map((index) => `${chart.xAt(index)},${chart.yAt(points[index].apiPer1k!)}`).join(" ")}
              className={styles.apiLine}
            />
          ))}
          {showApiPoints
            ? points.map((point, index) =>
                point.apiPer1k !== undefined ? (
                  <circle
                    key={`api-dot-${point.dayStart}`}
                    cx={chart.xAt(index)}
                    cy={chart.yAt(point.apiPer1k)}
                    r={3}
                    className={styles.apiDot}
                  />
                ) : null
              )
            : null}
          {points.map((point, index) => {
            // 无分母天照画短桩（柱位是事实），tooltip 注明「当日无模型消息」。
            const barHeight = Math.max(
              ((point.toolPer1k ?? 0) / chart.maxValue) * PLOT_HEIGHT,
              MIN_BAR_HEIGHT
            );
            const selected = selectedDay === point.dayStart;
            const focusedBar = focusIndex === index;
            return (
              <rect
                key={`bar-${point.dayStart}`}
                data-bar
                x={PAD_LEFT + index * chart.slot + (chart.slot - chart.barWidth) / 2}
                y={PAD_TOP + PLOT_HEIGHT - barHeight}
                width={chart.barWidth}
                height={barHeight}
                className={[
                  styles.bar,
                  selected ? styles.barSelected : "",
                  focusedBar ? styles.barFocused : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            );
          })}
          {threshold !== null ? (
            <>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={chart.yAt(threshold)}
                y2={chart.yAt(threshold)}
                className={styles.anomalyLine}
              />
              <text
                x={WIDTH - PAD_RIGHT}
                y={chart.yAt(threshold) - 3}
                textAnchor="end"
                className={styles.anomalyLineLabel}
              >
                {`异常线 ${Math.round(threshold)}`}
              </text>
            </>
          ) : null}
          {anomalyDays.map((day) => {
            const index = points.findIndex((point) => point.dayStart === day.dayStart);
            if (index < 0) return null;
            const point = points[index];
            const barTop = chart.yAt(point.toolPer1k ?? 0);
            const apiTop = point.apiPer1k !== undefined ? chart.yAt(point.apiPer1k) : null;
            const aboveApi = apiTop !== null && apiTop < barTop;
            const markerY = Math.min(barTop, apiTop ?? barTop) - (aboveApi ? 4 : 3);
            const cx = chart.xAt(index);
            return (
              <g key={`anomaly-${day.dayStart}`}>
                <path d={`M ${cx - 4} ${markerY} L ${cx + 4} ${markerY} L ${cx} ${markerY - 7} Z`} className={styles.anomalyMark} />
                {anomalyDays.length <= 2 ? (
                  <text x={cx + 10} y={markerY - 1} className={styles.anomalyDayLabel}>
                    {formatDayLabel(day.dayStart)}
                  </text>
                ) : null}
              </g>
            );
          })}
          {focusIndex !== null ? (
            <>
              <line
                x1={chart.xAt(focusIndex)}
                x2={chart.xAt(focusIndex)}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_HEIGHT}
                className={styles.crosshair}
              />
              {points[focusIndex].apiPer1k !== undefined ? (
                <circle
                  cx={chart.xAt(focusIndex)}
                  cy={chart.yAt(points[focusIndex].apiPer1k!)}
                  r={4}
                  className={styles.hoverApiDot}
                />
              ) : null}
            </>
          ) : null}
        </svg>
        {focused ? (
          <div
            className={styles.tooltip}
            style={{
              left: `${Math.min(86, Math.max(14, (chart.xAt(focusIndex!) / WIDTH) * 100))}%`
            }}
          >
            <div className={styles.tooltipLine}>
              <strong>{`${formatDayLabel(focused.dayStart)} 周${WEEKDAY_OF_DAY[new Date(focused.dayStart).getDay()]}`}</strong>
            </div>
            <div className={styles.tooltipLine}>
              {`工具错误 ${focused.tool.toLocaleString("en-US")} 条 · ${formatPer1k(focused.toolPer1k)}/千条`}
              {focused.anomalous ? <span className={styles.tooltipAnomaly}> ▲ 异常日</span> : null}
            </div>
            <div className={styles.tooltipLine}>
              {`API 错误 ${focused.api.toLocaleString("en-US")} 条 · ${formatPer1k(focused.apiPer1k)}/千条`}
            </div>
            <div className={styles.tooltipTertiary}>
              {focused.assistantMessages > 0
                ? `模型消息 ${focused.assistantMessages.toLocaleString("en-US")} 条`
                : "当日无模型消息"}
            </div>
          </div>
        ) : null}
        {/* 键盘逐日的朗读通道（design §5）。 */}
        <span role="status" className={styles.srOnly}>
          {focusedReadout}
        </span>
      </div>
      <p className={styles.caption}>{`纵轴为每千条模型消息的错误数（归一，消解「忙一天」与「错一天」的混淆）；悬停任一天可看原始条数与分母。${ANOMALY_RULE_TEXT}。`}</p>
    </Panel>
  );
}

/**
 * API 线的分段：把「有分母（可归一）」的日子切成连续段，无分母天两侧各断开
 * ——0/0 不是 0，线断开比贴 0 诚实（design §3.2）。
 */
function apiSegments(points: Array<{ apiPer1k: number | undefined }>): number[][] {
  const segments: number[][] = [];
  let current: number[] = [];
  points.forEach((point, index) => {
    if (point.apiPer1k !== undefined) {
      current.push(index);
    } else if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length > 0) segments.push(current);
  return segments;
}
