import { useId } from "react";
import { formatClock, formatTokenCount } from "../../lib/format";
import type { CompactionAnchor } from "../sessions/contextSeries";
import type { ContextSample } from "../sessions/types";
import {
  axisTicks,
  formatAxisValue,
  GridLine,
  niceAxisMax
} from "../usage/charts/chartPrimitives";
import primitiveStyles from "../usage/charts/chartPrimitives.module.css";
import type { CompactionBand, RateBucket } from "./pulseModel";
import styles from "./pulseCharts.module.css";

/**
 * 脉搏的两张曲线（design-round-w §3 / §5）。两张图共用同一把横尺与同一组
 * 内边距常量——「一个横像素格 = 一个桶 / 一次调用」的读数方式在两张图里
 * 必须是同一个密度，否则面板宽度一变，横向语言就分裂。
 *
 * 组件只画：分桶、求和、区间、压缩判定全在 `pulseModel` 的纯函数里算好，
 * 这里接收结果、渲染几何（§12.1 的硬约束）。
 */

const WIDTH = 720;
const PAD_LEFT = 56;
const PAD_RIGHT = 10;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;
const PLOT_WIDTH = WIDTH - PAD_LEFT - PAD_RIGHT;

/** 空桶仍保留一条短痕：这一分钟没有记录是一个事实，不是渲染失败。 */
const MINIMUM_BAR_HEIGHT = 1.5;

/**
 * 最近 60 分钟、每分钟一根柱的 token 速率曲线。
 *
 * 最后一桶是**进行中的这一分钟**：它不做外推，高度就是此刻已记录的 token 数，
 * 用三个形状通道（45° 斜纹填充 + 虚线轮廓 + 「现在」参考线）声明「它还没走完」，
 * 而不是压淡——压淡会和「这一分钟真的很少」撞车（§3.3）。
 */
export function RateCurve({
  buckets,
  compact = false
}: {
  buckets: readonly RateBucket[];
  compact?: boolean;
}) {
  // <pattern> 的 id 必须按实例唯一：同屏挂两个图表实例时，复用同一个 id 会让
  // 后一个图案取到先定义的那一份（WebKit 尤其明显）。
  const patternId = `pulse-hatch-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const height = compact ? 230 : 140;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;

  if (buckets.length === 0) return null;

  const max = buckets.reduce((best, bucket) => Math.max(best, bucket.tokens), 0);
  const axisMax = niceAxisMax(max);
  const ticks = axisTicks(axisMax, 3);
  const slot = PLOT_WIDTH / buckets.length;
  const barWidth = Math.min(slot * 0.72, 44);
  // 60 桶取 10 个标签：每 6 桶（10 分钟）一个 HH:mm 刻度。
  const labelStride = Math.max(1, Math.round(buckets.length / 10));
  const baseline = PAD_TOP + plotHeight;

  const last = buckets[buckets.length - 1];
  const peak = buckets.reduce(
    (best, bucket) => (bucket.tokens > best.tokens ? bucket : best),
    buckets[0]
  );
  const ariaLabel =
    max <= 0
      ? "近 60 分钟没有新的 token 记录。"
      : `近 60 分钟每分钟的 token 量；峰值 ${formatTokenCount(peak.tokens)} 在 ${formatClock(peak.start)}；当前分钟进行中，已记录 ${formatTokenCount(last.tokens)}。`;

  return (
    <>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className={primitiveStyles.chart}
        data-probe="pulse-rate-curve"
        data-bucket-count={buckets.length}
      >
        <defs>
          <pattern
            id={patternId}
            patternUnits="userSpaceOnUse"
            width="4"
            height="4"
          >
            <line x1="0" y1="4" x2="4" y2="0" className={styles.hatchLine} />
          </pattern>
        </defs>
        {ticks.map((tick) => (
          <GridLine
            key={tick}
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y={PAD_TOP + (1 - tick / axisMax) * plotHeight}
            label={formatAxisValue(tick)}
            strong={tick === 0}
          />
        ))}
        {buckets.map((bucket, index) => {
          const barHeight = Math.max((bucket.tokens / axisMax) * plotHeight, MINIMUM_BAR_HEIGHT);
          const x = PAD_LEFT + index * slot + (slot - barWidth) / 2;
          const y = baseline - barHeight;
          return (
            <rect
              key={bucket.start}
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              className={bucket.partial ? styles.barPartial : styles.bar}
              fill={bucket.partial ? `url(#${patternId})` : undefined}
              data-probe="pulse-rate-bar"
              data-partial={bucket.partial ? "true" : "false"}
            >
              <title>
                {`${formatClock(bucket.start)}：${formatTokenCount(bucket.tokens)} token${
                  bucket.partial ? "（进行中）" : ""
                }`}
              </title>
            </rect>
          );
        })}
        {/* x 轴右端 = 现在：这条线同时是「最后一桶没走完」的第三个几何声明。 */}
        <line
          x1={PAD_LEFT + PLOT_WIDTH}
          x2={PAD_LEFT + PLOT_WIDTH}
          y1={PAD_TOP}
          y2={baseline}
          className={styles.nowLine}
          aria-hidden="true"
          data-probe="pulse-rate-now"
        />
        {buckets.map((bucket, index) =>
          index % labelStride === 0 ? (
            <text
              key={`tick-${bucket.start}`}
              x={index === 0 ? PAD_LEFT : PAD_LEFT + index * slot + slot / 2}
              y={height - 6}
              textAnchor={index === 0 ? "start" : "middle"}
              className={primitiveStyles.tickText}
            >
              {formatClock(bucket.start)}
            </text>
          ) : null
        )}
      </svg>
      <p className={styles.caption}>每分钟四类 token 之和；最后一根是进行中的这一分钟。</p>
    </>
  );
}

/**
 * 上下文体量曲线：最近至多 40 次调用（左旧右新）+ 压缩断崖 + 参考带。
 *
 * 参考带是「最近至多 5 次自动压缩前的体量区间」，`n ≥ 3` 才画；数据线**不做
 * 面积填充**——参考带已经占了 `--chart-1-soft`，同一片颜色不能表示两件事（§5.3）。
 * 自动 / 手动压缩不做颜色区分：契约里没有 `trigger`，且 1px 虚线上读不出来（§5.4）。
 */
export function ContextCurve({
  samples,
  anchors,
  band,
  compact = false
}: {
  samples: readonly ContextSample[];
  anchors: readonly CompactionAnchor[];
  band: CompactionBand;
  compact?: boolean;
}) {
  const height = compact ? 200 : 120;
  const plotHeight = height - PAD_TOP - PAD_BOTTOM;
  const baseline = PAD_TOP + plotHeight;
  const count = samples.length;
  const bandText =
    "min" in band
      ? `自动压缩前体量 ${formatTokenCount(band.min)}–${formatTokenCount(band.max)}（最近 ${band.n} 次）`
      : `参考带样本不足（n=${band.n}，至少需要 3 次自动压缩）`;
  const sampleNote =
    count === 1 ? "样本不足（n=1）" : count === 2 ? "样本不足（n=2）" : null;

  if (count === 0) {
    return (
      <>
        <p className={styles.zeroState} data-probe="pulse-context-zero">
          这个会话还没有可画上下文体量的调用。
        </p>
        <p className={styles.caption} data-probe="pulse-context-note">
          {bandText}
        </p>
      </>
    );
  }

  const max = samples.reduce((best, sample) => Math.max(best, sample.contextTokens), 0);
  const axisMax = niceAxisMax(max);
  const ticks = axisTicks(axisMax, 3);
  const xAt = (index: number) => PAD_LEFT + (PLOT_WIDTH * index) / Math.max(1, count - 1);
  const yAt = (value: number) => PAD_TOP + plotHeight - (value / axisMax) * plotHeight;
  const last = samples[count - 1];
  const ariaLabel =
    "min" in band
      ? `最近 ${count} 次调用的上下文体量，当前 ${formatTokenCount(last.contextTokens)}，最高 ${formatTokenCount(max)}；期间 ${anchors.length} 次压缩；自动压缩前体量区间 ${formatTokenCount(band.min)}–${formatTokenCount(band.max)}（最近 ${band.n} 次）。`
      : `最近 ${count} 次调用的上下文体量，当前 ${formatTokenCount(last.contextTokens)}，最高 ${formatTokenCount(max)}；期间 ${anchors.length} 次压缩；参考带样本不足（自动压缩 ${band.n} 次）。`;

  return (
    <>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className={primitiveStyles.chart}
        data-probe="pulse-context-curve"
        data-sample-count={count}
      >
        {ticks.map((tick) => (
          <GridLine
            key={tick}
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y={PAD_TOP + (1 - tick / axisMax) * plotHeight}
            label={formatAxisValue(tick)}
            strong={tick === 0}
          />
        ))}
        {"min" in band ? (
          <>
            <rect
              x={PAD_LEFT}
              y={yAt(band.max)}
              width={PLOT_WIDTH}
              height={Math.max(yAt(band.min) - yAt(band.max), 0)}
              className={styles.band}
              data-probe="pulse-context-band"
            />
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yAt(band.max)}
              y2={yAt(band.max)}
              className={styles.bandEdge}
              aria-hidden="true"
            />
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yAt(band.min)}
              y2={yAt(band.min)}
              className={styles.bandEdge}
              aria-hidden="true"
            />
          </>
        ) : null}
        {count >= 2 ? (
          <polyline
            points={samples.map((sample, index) => `${xAt(index)},${yAt(sample.contextTokens)}`).join(" ")}
            className={styles.line}
          />
        ) : null}
        {/* 只有一个样本时连不成线，但那个点本身是事实：画它（§5.5）。 */}
        {count === 1 ? (
          <rect
            x={xAt(0) - 1.5}
            y={yAt(samples[0].contextTokens) - 1.5}
            width="3"
            height="3"
            className={styles.sampleDot}
            aria-hidden="true"
          />
        ) : null}
        {anchors.map((anchor) => {
          const cliffX = (xAt(anchor.beforeIndex) + xAt(anchor.afterIndex)) / 2;
          return (
            <g key={anchor.eventId}>
              <line
                x1={cliffX}
                x2={cliffX}
                y1={PAD_TOP}
                y2={baseline}
                className={styles.cliff}
                data-probe="pulse-context-cliff"
              >
                <title>{`第 ${anchor.beforeIndex + 1} 次调用后发生压缩`}</title>
              </line>
              {[anchor.beforeIndex, anchor.afterIndex].map((index) =>
                index >= 0 && index < count ? (
                  <rect
                    key={`${anchor.eventId}-${index}`}
                    x={xAt(index) - 1.5}
                    y={yAt(samples[index].contextTokens) - 1.5}
                    width="3"
                    height="3"
                    className={styles.sampleDot}
                    aria-hidden="true"
                  />
                ) : null
              )}
            </g>
          );
        })}
      </svg>
      <p className={styles.caption} data-probe="pulse-context-note">
        {bandText}
        {sampleNote ? `；${sampleNote}` : ""}
      </p>
    </>
  );
}
