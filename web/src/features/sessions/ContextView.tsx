import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../../components/Panel";
import { EmptyState } from "../../components/EmptyState";
import { ProvenanceBadge } from "../usage/ProvenanceBadge";
import {
  axisTicks,
  formatAxisValue,
  GridLine,
  niceAxisMax,
  niceStep
} from "../usage/charts/chartPrimitives";
import primitiveStyles from "../usage/charts/chartPrimitives.module.css";
import { compactionAnchors, contextSeriesOf } from "./contextSeries";
import {
  curveGeometry,
  diamondPath,
  downsampleCurve,
  eventMarkerGeometries,
  nearestPositionIndex,
  peakLabelPlacement,
  peakSampleIndex
} from "./contextCurve";
import { droppedByEvent } from "./droppedMessages";
import { CompactionPanel } from "./CompactionPanel";
import { triggerLabel } from "./logRows";
import { formatClock, formatDuration } from "../../lib/format";
import type { ParsedSession, SessionRecord } from "./types";
import styles from "./ContextView.module.css";

const VIEWBOX_WIDTH = 720;
const VIEWBOX_HEIGHT = 220;
const PAD_LEFT = 56;
const PAD_RIGHT = 12;
const PAD_TOP = 22;
const PAD_BOTTOM = 22;
/** 菱形外接圆半径：常态 5（直径 10px）；hover/聚焦由 CSS 放大到 12px，选中环再外扩 2px。 */
const DIAMOND_RADIUS = 5;

/** The peak label rides at --fs-xs; its viewBox height, for clamping. */
const TICK_FONT_SIZE = 11;

type Hover = { kind: "event"; eventId: string } | { kind: "point"; index: number } | null;

/**
 * 外部「在上下文视图定位」请求（日志表压缩带行 / 详情面板发出）。nonce 让同
 * 一事件可以被重复定位——只有请求对象变化才生效，不随渲染重触发。
 */
export type ContextRevealRequest = { eventId: string; nonce: number };

/**
 * 会话详情「上下文」标签页（design §2）：上面板画逐消息的上下文压力面积图，
 * 下面板是压缩事件条 + 取证卡。数据层全部来自 J1 的 `contextSeriesOf` /
 * `compactionAnchors` 与本任务的 `droppedByEvent`；只陈述日志里读得到的。
 */
export function ContextView({
  parsed,
  onLocateInLog,
  revealEventRequest = null
}: {
  parsed: ParsedSession;
  onLocateInLog: (recordId: string) => void;
  /** 「在上下文视图定位」：切进来并选中该压缩事件（nonce 驱动，可重复定位）。 */
  revealEventRequest?: ContextRevealRequest | null;
}) {
  const events = useMemo(() => parsed.compactEvents ?? [], [parsed]);
  const samples = useMemo(() => contextSeriesOf(parsed.records), [parsed]);
  const anchors = useMemo(() => compactionAnchors(samples, events), [samples, events]);
  const buckets = useMemo(
    () => droppedByEvent(parsed.records, parsed.sidechainMessages, events, samples, anchors),
    [parsed, events, samples, anchors]
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  // 选中是「这个会话里的事件」的状态：切会话时清空，不跨会话携带。
  useEffect(() => {
    setSelectedEventId(null);
  }, [parsed]);

  // 外部定位请求只在 nonce 变化时生效；事件不在本会话里时不动（宁可不选中，
  // 也不选一个不存在的 id）。
  useEffect(() => {
    if (!revealEventRequest) return;
    if (events.some((event) => event.id === revealEventRequest.eventId)) {
      setSelectedEventId(revealEventRequest.eventId);
    }
  }, [revealEventRequest, events]);

  const recordByFullId = useMemo(() => {
    const map = new Map<string, SessionRecord>();
    for (const record of parsed.records) map.set(record.fullId, record);
    return map;
  }, [parsed]);

  const chart = useMemo(() => {
    if (samples.length === 0) return null;
    const peakIndex = peakSampleIndex(samples);
    const peakValue = samples[peakIndex].contextTokens;
    const maxValue = niceAxisMax(peakValue);
    const geometry = curveGeometry({
      width: VIEWBOX_WIDTH,
      height: VIEWBOX_HEIGHT,
      padLeft: PAD_LEFT,
      padRight: PAD_RIGHT,
      padTop: PAD_TOP,
      padBottom: PAD_BOTTOM,
      count: samples.length,
      maxValue
    });
    // 强制保留：断崖两侧（朴素分桶会把断崖磨圆）与全局峰值（唯一被直标的点）。
    const forced = anchors.flatMap((anchor) =>
      [anchor.beforeIndex, anchor.afterIndex].filter(
        (index) => index >= 0 && index < samples.length
      )
    );
    const kept = downsampleCurve(samples, [...forced, peakIndex]);
    const markers = eventMarkerGeometries(anchors, events, samples, geometry);
    const peakLabel = peakLabelPlacement(peakIndex, peakValue, geometry, markers, TICK_FONT_SIZE);
    const xs = kept.map((index) => geometry.xAt(index));
    const linePath = kept
      .map((index, position) =>
        `${position === 0 ? "M" : "L"}${xs[position].toFixed(1)},${geometry
          .yAt(samples[index].contextTokens)
          .toFixed(1)}`
      )
      .join(" ");
    const baseline = geometry.yAt(0);
    const areaPath =
      kept.length > 0
        ? `${linePath}L${xs[xs.length - 1].toFixed(1)},${baseline.toFixed(1)}L${xs[0].toFixed(1)},${baseline.toFixed(1)}Z`
        : "";
    const yTicks = axisTicks(maxValue, 3);
    // X 轴刻度是消息序号：步长同样走 1/2/5×10ⁿ 取整（design §2.2）。
    const step = Math.max(1, niceStep(samples.length / 8));
    const xTicks: number[] = [];
    for (let value = step; value <= samples.length; value += step) xTicks.push(value);
    return {
      peakIndex,
      peakValue,
      geometry,
      kept,
      xs,
      markers,
      peakLabel,
      linePath,
      areaPath,
      baseline,
      yTicks,
      xTicks
    };
  }, [samples, anchors, events]);

  const chartAriaLabel = chart
    ? `上下文压力：${samples.length} 条模型消息，峰值 ${chart.peakValue.toLocaleString("en-US")} tok，${
        events.length > 0 ? `${events.length} 次压缩` : "未发生压缩"
      }`
    : "上下文压力";

  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const pendingClientXRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    []
  );

  /** 把鼠标/命中的 svg x 解析成 hover 状态：事件命中区优先于曲线吸附。 */
  const hoverFromClientX = useCallback(
    (clientX: number): Hover => {
      const wrap = wrapRef.current;
      if (!wrap || !chart) return null;
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0) return null;
      const svgX = ((clientX - rect.left) / rect.width) * VIEWBOX_WIDTH;
      const marker = chart.markers.find(
        (candidate) => svgX >= candidate.hitX && svgX <= candidate.hitX + candidate.hitWidth
      );
      if (marker) return { kind: "event", eventId: marker.eventId };
      if (svgX < PAD_LEFT - 4 || svgX > VIEWBOX_WIDTH - PAD_RIGHT + 4) return null;
      return { kind: "point", index: nearestPositionIndex(chart.xs, svgX) };
    },
    [chart]
  );

  // 指针移动经 rAF 合帧（design §7）：不逐 mousemove setState。
  const scheduleHover = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX;
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pending = pendingClientXRef.current;
        if (pending !== null) setHover(hoverFromClientX(pending));
      });
    },
    [hoverFromClientX]
  );

  const selectEventAt = useCallback(
    (clientX: number) => {
      const hoverAt = hoverFromClientX(clientX);
      setSelectedEventId(hoverAt?.kind === "event" ? hoverAt.eventId : null);
    },
    [hoverFromClientX]
  );

  const onChartKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!chart || events.length === 0) return;
      if (event.key === "Escape") {
        setSelectedEventId(null);
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        if (event.key === "Enter" || event.key === " ") {
          if (hover?.kind === "event") {
            event.preventDefault();
            setSelectedEventId(hover.eventId);
          }
        }
        return;
      }
      event.preventDefault();
      const currentId = hover?.kind === "event" ? hover.eventId : null;
      const currentIndex = currentId === null ? -1 : events.findIndex((item) => item.id === currentId);
      const nextIndex =
        event.key === "ArrowRight"
          ? Math.min(currentIndex + 1, events.length - 1)
          : Math.max(currentIndex - 1, 0);
      setHover({ kind: "event", eventId: events[nextIndex].id });
    },
    [chart, events, hover]
  );

  // 键盘聚焦的事件与鼠标悬停共用同一份 tooltip 文案（focus 显示 = hover 显示）。
  const tooltip = (() => {
    if (!chart || !hover) return null;
    if (hover.kind === "event") {
      const event = events.find((item) => item.id === hover.eventId);
      const marker = chart.markers.find((item) => item.eventId === hover.eventId);
      if (!event || !marker) return null;
      const ordinal = events.indexOf(event) + 1;
      const bucket = buckets.get(event.id);
      return { x: marker.x, event, ordinal, bucket };
    }
    const sampleIndex = chart.kept[hover.index];
    if (sampleIndex === undefined) return null;
    const sample = samples[sampleIndex];
    const usage = recordByFullId.get(sample.uuid)?.usage;
    return { x: chart.xs[hover.index], sample, sampleIndex, usage };
  })();

  const autoCount = events.filter((event) => event.trigger === "auto").length;
  const manualCount = events.length - autoCount;

  // 空态三分支（design §2.6）：没有 usage 时曲线画不出来，事件面板也不渲染。
  if (!chart) {
    return (
      <Panel title="上下文压力" ariaLabel="上下文压力">
        <EmptyState
          size="panel"
          title="没有可绘制的上下文数据"
          description="本会话没有带用量的模型消息。"
        />
      </Panel>
    );
  }

  const { geometry } = chart;

  return (
    <div className={styles.stack}>
      <Panel
        title="上下文压力"
        ariaLabel="上下文压力"
        actions={
          <span className={styles.peakReading}>
            峰值 {formatAxisValue(chart.peakValue)}
            <ProvenanceBadge provenance="logged" />
          </span>
        }
      >
        <div
          ref={wrapRef}
          className={styles.chartWrap}
          tabIndex={0}
          role="img"
          aria-label={chartAriaLabel}
          onMouseMove={(event) => scheduleHover(event.clientX)}
          onMouseLeave={() => setHover(null)}
          onClick={(event) => selectEventAt(event.clientX)}
          onKeyDown={onChartKeyDown}
        >
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            className={primitiveStyles.chart}
            aria-hidden="true"
          >
            {chart.yTicks.map((tick) => (
              <GridLine
                key={tick}
                x1={PAD_LEFT}
                x2={VIEWBOX_WIDTH - PAD_RIGHT}
                y={geometry.yAt(tick)}
                label={formatAxisValue(tick)}
                strong={tick === 0}
              />
            ))}
            {chart.xTicks.map((tick) => (
              <text
                key={tick}
                x={geometry.xAt(tick - 1)}
                y={VIEWBOX_HEIGHT - 6}
                textAnchor="middle"
                className={`${primitiveStyles.tickText} ${primitiveStyles.numeric}`}
              >
                {tick}
              </text>
            ))}
            <path d={chart.areaPath} className={styles.area} />
            <path d={chart.linePath} className={styles.line} />
            {chart.peakLabel ? (
              <text
                x={chart.peakLabel.x}
                y={chart.peakLabel.y}
                textAnchor={chart.peakLabel.anchor}
                className={styles.peakLabel}
              >
                峰值 {formatAxisValue(chart.peakValue)}
              </text>
            ) : null}
            {hover?.kind === "point" ? (
              <>
                <line
                  x1={chart.xs[hover.index]}
                  x2={chart.xs[hover.index]}
                  y1={geometry.padTop}
                  y2={geometry.padTop + geometry.plotHeight}
                  className={styles.crosshair}
                />
                <circle
                  cx={chart.xs[hover.index]}
                  cy={geometry.yAt(samples[chart.kept[hover.index]].contextTokens)}
                  r={3}
                  className={styles.crosshairDot}
                />
              </>
            ) : null}
            {chart.markers.map((marker) => {
              const active =
                (hover?.kind === "event" && hover.eventId === marker.eventId) ||
                selectedEventId === marker.eventId;
              return (
                <g key={marker.eventId}>
                  <line
                    x1={marker.x}
                    x2={marker.x}
                    y1={marker.hitY}
                    y2={marker.hitY + marker.hitHeight}
                    className={active ? styles.markerLineActive : styles.markerLine}
                  />
                  {selectedEventId === marker.eventId ? (
                    <path
                      d={diamondPath(marker.x, marker.y, DIAMOND_RADIUS + 2)}
                      className={styles.markerSelectedRing}
                    />
                  ) : null}
                  <path
                    d={diamondPath(marker.x, marker.y, DIAMOND_RADIUS)}
                    className={active ? styles.markerDiamondActive : styles.markerDiamond}
                  />
                  {/* 命中区是纯几何：指针与点击都由外层的坐标换算统一处理，
                      这里渲染出来是为了可定位（e2e / 调试），不接指针事件。 */}
                  <rect
                    data-event-id={marker.eventId}
                    x={marker.hitX}
                    y={marker.hitY}
                    width={marker.hitWidth}
                    height={marker.hitHeight}
                    className={styles.hitRect}
                  />
                </g>
              );
            })}
          </svg>
          {tooltip ? (
            <div
              className={styles.tooltip}
              style={{ left: `${Math.min(86, Math.max(14, (tooltip.x / VIEWBOX_WIDTH) * 100))}%` }}
            >
              {tooltip.event ? (
                <>
                  <div className={styles.tooltipLine}>
                    <strong>
                      ◆ 压缩 #{tooltip.ordinal} · {formatClock(tooltip.event.timestamp, true)} ·{" "}
                      {triggerLabel(tooltip.event.trigger)}
                    </strong>
                  </div>
                  {tooltip.event.preTokens !== null && tooltip.event.postTokens !== null ? (
                    <div className={styles.tooltipLine}>
                      {tooltip.event.preTokens.toLocaleString("en-US")} →{" "}
                      {tooltip.event.postTokens.toLocaleString("en-US")}（丢弃{" "}
                      {(tooltip.event.preTokens - tooltip.event.postTokens).toLocaleString("en-US")}）
                    </div>
                  ) : null}
                  {tooltip.event.durationMs !== null ? (
                    <div className={styles.tooltipLine}>
                      耗时 {formatDuration(tooltip.event.durationMs)} · 幸存{" "}
                      {tooltip.event.survivedUuids.length}/{tooltip.bucket?.contextCount ?? "—"} 条
                    </div>
                  ) : null}
                  <div className={styles.tooltipHint}>点击查看取证</div>
                </>
              ) : (
                <>
                  <div className={styles.tooltipLine}>
                    <strong>{tooltip.sample.contextTokens.toLocaleString("en-US")} tok</strong>
                    <span className={styles.tooltipTertiary}> 第 {tooltip.sampleIndex + 1} 条</span>
                  </div>
                  <div className={styles.tooltipLine}>{formatClock(tooltip.sample.timestamp, true)}</div>
                  {tooltip.usage ? (
                    <div className={styles.tooltipLine}>
                      输入 {formatAxisValue(tooltip.usage.inputTokens ?? 0)} + 缓存写入{" "}
                      {formatAxisValue(tooltip.usage.cacheCreationTokens ?? 0)} + 缓存读取{" "}
                      {formatAxisValue(tooltip.usage.cacheReadTokens ?? 0)}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {/* 键盘 roving 的朗读通道：事件摘要在焦点移动时被读出（design §7）。 */}
          <span role="status" className={styles.srOnly}>
            {tooltip?.event
              ? `压缩 #${tooltip.ordinal}，${triggerLabel(tooltip.event.trigger)}，丢弃 ${
                  tooltip.event.preTokens !== null && tooltip.event.postTokens !== null
                    ? (tooltip.event.preTokens - tooltip.event.postTokens).toLocaleString("en-US")
                    : "未知"
                } tok`
              : ""}
          </span>
        </div>
        {/* 同一个数字的两个名字（提示词 / 上下文规模）在这里被一句话缝合（design §2.2）。 */}
        <p className={styles.caption}>
          横轴 = 模型消息序号（非墙钟时间）· 纵轴 = 该次调用喂给模型的 token
          总量（输入 + 缓存写入 + 缓存读取，与日志表「提示词」同口径）
        </p>
      </Panel>
      <div className={styles.eventsHost}>
        <Panel
          title="压缩事件"
          ariaLabel="压缩事件"
          actions={
            events.length > 0 ? (
              <span className={styles.peakReading}>
                {events.length} 次 · 自动 {autoCount} / 手动 {manualCount}
                <ProvenanceBadge provenance="logged" />
              </span>
            ) : undefined
          }
        >
          {events.length === 0 ? (
            // 「有数据的零」：曲线照画（上面板），这里只说事实，不摆空盒。
            <EmptyState size="inline" title="本会话未发生压缩——上下文从未重置" />
          ) : (
            <CompactionPanel
              events={events}
              anchors={anchors}
              samples={samples}
              buckets={buckets}
              selectedEventId={selectedEventId}
              onSelect={setSelectedEventId}
              onLocateInLog={onLocateInLog}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
