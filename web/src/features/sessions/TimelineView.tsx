import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { formatClock, formatTokenCount } from "../../lib/format";
import { contextSeriesOf } from "./contextSeries";
import { buildLogRows, type LogRow } from "./logRows";
import {
  buildScrubber,
  type ScrubberEvent,
  type ScrubberModel
} from "./sessionScrubber";
import type { ParsedSession } from "./types";
import styles from "./TimelineView.module.css";

/**
 * 会话内时间轴（E3，设计规格 §3）。
 *
 * 与「重放」的分工写在规格 §3.1，这里再抄一遍是为了让下一个改这个文件的人
 * 不必先去翻规格：
 *
 *   重放 = 「这次会话怎么发生的」——看一遍，有播放、有节奏。
 *   时间轴 = 「某一刻上下文里有什么」——跳到那儿看，没有播放按钮。
 *
 * 因此四个通道**同时**不同（R4）：位置（视图底部 168px，不是全屏胶片）、
 * 形状（14×6 矩形手柄骑在 3px 竖线上，不是 4px 圆点）、颜色（只有
 * --chart-1 水位与 --text-tertiary 刻度，不用类别色）、文案（底部读数是
 * 「14:32:07 · 第 37 条记录 · 上下文 78,412 / 100,000」，与重放的
 * 「片长 60 秒 · 约 63×」不共用任何 class）。
 */

/** 键盘步进：1% 跨度（规格 §3.4）。10 秒级的移动，比逐事件细、比像素粗。 */
const KEYBOARD_STEP = 0.01;

/** 轴上方的「当时的记录」条数（规格 §2.4：最近 5 条 ≤ 手柄时刻）。 */
const RECENT_ROW_LIMIT = 5;

/** 水位折线的高度（规格 §3.2 的 96px）。 */
const WATER_HEIGHT = 96;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 手柄时刻之前（含）的日志行——「当时的记录」就是这一刀切出来的。 */
function rowsUpTo(rows: readonly LogRow[], realMs: number): LogRow[] {
  return rows.filter((row) => row.timestamp <= realMs);
}

export function TimelineView({
  parsed,
  onLocateInLog
}: {
  parsed: ParsedSession;
  onLocateInLog: (recordId: string) => void;
}) {
  const rows = useMemo(
    () => buildLogRows(parsed.records, parsed.turns, parsed.compactEvents ?? []),
    [parsed]
  );
  const samples = useMemo(() => contextSeriesOf(parsed.records), [parsed.records]);
  // 压缩事件也进轴：它们的时刻是用户最想跳过去看的位置，若只按采样点定轴，
  // 落在采样区间外的压缩就没法用手柄指到。
  const events = useMemo<ScrubberEvent[]>(
    () => (parsed.compactEvents ?? []).map((event) => ({ timestamp: event.timestamp, label: "压缩" })),
    [parsed.compactEvents]
  );
  const scrubber = useMemo(() => buildScrubber(samples, events), [samples, events]);
  const peakContext = useMemo(
    () => samples.reduce((peak, sample) => Math.max(peak, sample.contextTokens), 0),
    [samples]
  );

  // 开在末尾：打开这一页的默认问题是「现在上下文里有什么」。
  const [position, setPosition] = useState(1);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const zeroSpan = !(scrubber.end > scrubber.start);
  const realMs = zeroSpan
    ? scrubber.start
    : scrubber.start + position * (scrubber.end - scrubber.start);

  const watermark = useMemo(
    () => (zeroSpan ? (samples[0]?.contextTokens ?? null) : scrubber.watermarkAt(realMs)),
    [zeroSpan, scrubber, realMs, samples]
  );
  const visibleRows = useMemo(() => rowsUpTo(rows, realMs), [rows, realMs]);
  const recentRows = visibleRows.slice(-RECENT_ROW_LIMIT).reverse();

  const positionFromClientX = useCallback(
    (clientX: number): number | null => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !(rect.width > 0)) return null;
      return clamp01((clientX - rect.left) / rect.width);
    },
    []
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // 手柄/轴是一体的：按哪儿就跳到哪儿，不需要先精确抓住那 14×6 的矩形。
      const next = positionFromClientX(event.clientX);
      if (next === null) return;
      setDragging(true);
      setPosition(next);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [positionFromClientX]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const next = positionFromClientX(event.clientX);
      if (next !== null) setPosition(next);
    },
    [dragging, positionFromClientX]
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    setDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Space 刻意**不绑定**（规格 §3.4）：重放用它播放/暂停，时间轴没有播放
    // 这个概念。两边都收 Space，用户会形成「按空格没用」的错误记忆。
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPosition((current) => clamp01(current - KEYBOARD_STEP));
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setPosition((current) => clamp01(current + KEYBOARD_STEP));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setPosition(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setPosition(1);
    }
  }, []);

  if (zeroSpan) {
    // 零跨度时轴整块退化为一行诚实文案：拖动一个没有长度的东西只会让人
    // 怀疑是不是坏了。文案按事实分两种——真的只有 1 条记录，与记录挤在
    // 同一毫秒，是两件事。
    const note =
      rows.length <= 1
        ? "这条会话只有 1 条记录，没有时间跨度可拖动"
        : "这条会话的记录都在同一时刻，没有时间跨度可拖动";
    return (
      <div className={styles.view}>
        <RecentRecords rows={recentRows} onLocateInLog={onLocateInLog} />
        <p className={styles.rulerNote}>{note}</p>
      </div>
    );
  }

  const percent = Math.round(position * 100);
  const stamp = formatClock(realMs, true);
  const recordCount = visibleRows.length;
  // aria-valuetext 是时刻字符串（规格 §9 的探针口径）：读屏用户拖动时
  // 听到的是「14:32:07」而不是「43」，百分比对他没有意义。
  const valueText = `${stamp} · 第 ${recordCount} 条记录`;

  return (
    <div className={styles.view}>
      <RecentRecords rows={recentRows} onLocateInLog={onLocateInLog} />

      <div className={styles.ruler}>
        <div
          ref={trackRef}
          className={styles.track}
          role="slider"
          tabIndex={0}
          aria-label="会话时间轴"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={valueText}
          data-probe="timeline-track"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
        >
          {samples.length === 0 ? (
            // 没有采样点就画不出水位：说事实，不画一条假的平线。
            <p className={styles.waterNote}>本段没有可核对的上下文读数</p>
          ) : (
            <WaterChart
              samples={samples}
              scrubber={scrubber}
              peak={peakContext}
              percent={percent}
            />
          )}
          <div className={styles.ticks} aria-hidden="true">
            <span>{formatClock(scrubber.start, true)}</span>
            <span>{formatClock(scrubber.start + (scrubber.end - scrubber.start) / 2, true)}</span>
            <span>{formatClock(scrubber.end, true)}</span>
          </div>
        </div>

        {/* 底部读数行（规格 §3.3 第 3 条）：只在时间轴存在，与重放的读数行
            不共用 class——两根轴同时在一页里，共用样式等于共用身份。 */}
        <p className={styles.snapshot}>
          <span>{stamp}</span>
          <span className={styles.dot} aria-hidden="true">·</span>
          <span>第 {recordCount.toLocaleString("en-US")} 条记录</span>
          <span className={styles.dot} aria-hidden="true">·</span>
          <span>
            上下文 {watermark === null ? "—" : formatTokenCount(watermark)} /{" "}
            {peakContext > 0 ? formatTokenCount(peakContext) : "—"}
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * 水位折线。用 SVG + `preserveAspectRatio="none"` 让它按容器宽度拉伸，
 * 只有 y 是有意义的（96px 高、峰值在顶）。
 */
function WaterChart({
  samples,
  scrubber,
  peak,
  percent
}: {
  samples: readonly { timestamp: number; contextTokens: number }[];
  scrubber: ScrubberModel;
  peak: number;
  percent: number;
}) {
  const points = samples
    .map((sample) => {
      const x = scrubber.positionAt(sample.timestamp) * 100;
      const ratio = peak > 0 ? Math.min(1, Math.max(0, sample.contextTokens / peak)) : 0;
      const y = WATER_HEIGHT - ratio * WATER_HEIGHT;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <div className={styles.waterline}>
      <svg
        className={styles.waterChart}
        viewBox={`0 0 100 ${WATER_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline className={styles.waterLine} points={points} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* 3px 竖线 + 14×6 矩形手柄（§3.3 第 2 条）。形状是这里唯一的
          「你正站在时刻 X」的编码，所以它不能只是屏幕中间的一条细线。 */}
      <span className={styles.stem} style={{ left: `${percent}%` }} aria-hidden="true" />
      <span
        className={styles.handle}
        style={{ left: `${percent}%` }}
        data-probe="timeline-handle"
        aria-hidden="true"
      />
    </div>
  );
}

/** 「当时的记录」：手柄时刻之前最近 5 条日志行，点一条跳到日志视图。 */
function RecentRecords({
  rows,
  onLocateInLog
}: {
  rows: readonly LogRow[];
  onLocateInLog: (recordId: string) => void;
}) {
  return (
    <div className={styles.records}>
      <h3 className={styles.recordsTitle}>此前的记录</h3>
      {rows.length === 0 ? (
        <p className={styles.recordsEmpty}>手柄之前没有记录</p>
      ) : (
        <ol className={styles.recordsList}>
          {rows.map((row) => {
            // 合成行（轮次 / 等待 / 压缩带）没有可定位的真实记录，
            // 渲染成按钮只会让点击落空。
            const recordId = row.records[0]?.fullId ?? null;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  className={styles.recordRow}
                  disabled={!recordId}
                  onClick={() => {
                    if (recordId) onLocateInLog(recordId);
                  }}
                >
                  <span className={styles.recordTime}>{formatClock(row.timestamp, true)}</span>
                  <span className={styles.recordLabel}>{row.label}</span>
                  <span className={styles.recordSummary}>{row.summary}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
