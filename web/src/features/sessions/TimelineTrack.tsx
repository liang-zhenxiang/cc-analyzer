import { useMemo, useRef, useState } from "react";
import type { ParsedSession, SessionRecord } from "./types";
import type { TimeRange } from "./filters";
import { formatClock, formatDuration } from "../../lib/format";
import styles from "./TimelineTrack.module.css";

type BlockCategory = "user" | "delegated" | "workflow" | "wait" | "direct" | "compute";

function category(record: SessionRecord): BlockCategory {
  if (record.kind === "user") return "user";
  if (record.toolCategory === "delegated") return "delegated";
  if (record.toolCategory === "workflow") return "workflow";
  if (record.toolCategory === "wait") return "wait";
  if (record.kind === "tool") return "direct";
  return "compute";
}

/** A block's width as a share of the track — the record's duration, capped. */
const BLOCK_WIDTH_CAP = 0.15;

/**
 * Maps one record's duration to a track-width share. A 30s record and a 30ms
 * record must not render the same width — the track is a time overview, and
 * fixed 8px blocks broke that reading. Very long records cap at 15% so a
 * single hang cannot swallow the whole track.
 */
export function blockWidthShare(durationMs: number, spanMs: number): number {
  if (spanMs <= 0 || durationMs <= 0) return 0;
  return Math.min(durationMs / spanMs, BLOCK_WIDTH_CAP);
}

/** Keyboard nudge for the selection, as a fraction of the visible span. */
const KEYBOARD_NUDGE = 0.02;

/**
 * 轴刻度精度：四个刻度把跨度三等分，刻度间距不足 1 分钟时补秒。
 * 8 秒的会话若只写 HH:mm，四个刻度会全是同一个「18:00」——轴没有区分度，
 * 也帮不上框选（评审 P1-5）。长会话仍用 HH:mm，避免刻度噪音。
 *
 * 只约束**轴刻度**；悬停准线与选区预览始终到秒——它们回答的是「这一刻
 * 是几点几秒」，长会话里那一秒仍然有用，不该为了和轴对齐而丢掉。
 */
export function axisClockFor(spanMs: number): (ms: number) => string {
  const withSeconds = spanMs / 3 < 60_000;
  return (ms: number) => formatClock(ms, withSeconds);
}

export function TimelineTrack({
  session,
  selection,
  onSelect,
  onReveal
}: {
  session: ParsedSession;
  selection: TimeRange | null;
  onSelect: (range: TimeRange | null) => void;
  onReveal: (recordId: string) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: number } | null>(null);
  const [preview, setPreview] = useState<TimeRange | null>(null);
  const [probeAt, setProbeAt] = useState<number | null>(null);
  const range = useMemo(
    () => ({ start: session.startedAt, end: Math.max(session.endedAt, session.startedAt + 1) }),
    [session]
  );
  const span = range.end - range.start;
  const clock = useMemo(() => axisClockFor(span), [span]);

  const blocks = useMemo(
    () =>
      session.records.map((record) => ({
        record,
        left: Math.max(0, Math.min(1, (record.timestamp - range.start) / span)),
        width: blockWidthShare(record.durationMs, span),
        category: category(record)
      })),
    [session.records, range, span]
  );
  const shownSelection = preview ?? selection;

  function timestampFrom(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return range.start;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return range.start + ratio * span;
  }

  function nudgeSelection(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (!selection || !event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = (event.key === "ArrowRight" ? 1 : -1) * KEYBOARD_NUDGE * span;
    const next = {
      start: selection.start,
      end: Math.min(range.end, Math.max(range.start + 1, selection.end + step))
    };
    onSelect(next.end > next.start ? next : null);
  }

  const probeBubble = (() => {
    if (preview) {
      const start = Math.min(preview.start, preview.end);
      const end = Math.max(preview.start, preview.end);
      const duration = end - start;
      return duration > 0
        ? `${formatClock(start, true)} – ${formatClock(end, true)} · ${formatDuration(duration)}`
        : formatClock(start, true);
    }
    if (probeAt !== null) return formatClock(probeAt, true);
    return null;
  })();

  return (
    <section className={styles.container} aria-label="会话时间概览">
      <div
        ref={trackRef}
        className={styles.track}
        role="application"
        aria-label="时间轨道"
        tabIndex={0}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const start = timestampFrom(event.clientX);
          dragRef.current = { start };
          setPreview({ start, end: start });
        }}
        onMouseMove={(event) => {
          const at = timestampFrom(event.clientX);
          // 准线在拖选与悬停时都要在：拖选中它是「选到了哪」的实时读数。
          setProbeAt(at);
          if (!dragRef.current) return;
          setPreview({ start: dragRef.current.start, end: at });
        }}
        onMouseUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          setPreview(null);
          if (!drag) return;
          const end = timestampFrom(event.clientX);
          const next = { start: Math.min(drag.start, end), end: Math.max(drag.start, end) };
          onSelect(next.end > next.start ? next : null);
        }}
        onMouseLeave={() => {
          setProbeAt(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onSelect(null);
            return;
          }
          nudgeSelection(event);
        }}
      >
        {blocks.map(({ record, left, width, category: recordCategory }) => (
          <button
            key={record.fullId}
            type="button"
            className={styles[recordCategory]}
            style={{ left: `${left * 100}%`, width: `${Math.max(width, 0.002) * 100}%` }}
            title={`${record.fullId} · ${formatDuration(record.durationMs)}`}
            onClick={() => onReveal(record.fullId)}
            onDoubleClick={(event) => {
              event.stopPropagation();
              const end = record.timestamp + Math.max(record.durationMs, 1);
              onSelect({ start: record.timestamp, end: Math.min(end, range.end) });
            }}
          />
        ))}
        {shownSelection && (
          <span
            className={styles.selection}
            style={selectionStyle(shownSelection, range)}
          />
        )}
        {/* 刻度读数放在轨道内部的底部：单独一行会把下方表格压到
            「内部滚动」布局不变量的地板上（e2e 视口用例守着 240px 线）。 */}
        {/* 轴刻度精度随跨度走（axisClockFor）：短会话补秒，长会话保持 HH:mm；
            悬停/选区读数不受影响，始终到秒。 */}
        <span className={styles.axisStart} data-probe="axis-tick" aria-hidden="true">{clock(range.start)}</span>
        <span className={styles.axisThird} data-probe="axis-tick" aria-hidden="true">{clock(range.start + span / 3)}</span>
        <span className={styles.axisTwoThirds} data-probe="axis-tick" aria-hidden="true">{clock(range.start + (span * 2) / 3)}</span>
        <span className={styles.axisEnd} data-probe="axis-tick" aria-hidden="true">{clock(range.end)}</span>
        {shownSelection && shownSelection.end > shownSelection.start ? (
          <span className={styles.axisSelection} aria-hidden="true">
            选区 {formatDuration(Math.min(shownSelection.end, range.end) - Math.max(shownSelection.start, range.start))}
          </span>
        ) : null}
        {probeAt !== null && (
          /* 准线与读数：把 crosshair 从「光标形状」升级成真探针（评审 #2）。
             aria-hidden——时刻对读屏用户由选区文案与记录 title 承载。 */
          <span className={styles.probe} style={{ left: `${((probeAt - range.start) / span) * 100}%` }} aria-hidden="true">
            <span className={styles.probeLine} />
            <span className={styles.probeBubble} data-probe="probe-bubble">{probeBubble}</span>
          </span>
        )}
      </div>
      <footer>在轨道上拉选一段时间可只看那一段；按 Esc 清除选区，Shift+←/→ 微调选区终点。</footer>
    </section>
  );
}

function selectionStyle(range: TimeRange, full: TimeRange) {
  const start = Math.min(range.start, range.end);
  const end = Math.max(range.start, range.end);
  const left = (start - full.start) / (full.end - full.start);
  const width = (end - start) / (full.end - full.start);
  return { left: `${Math.max(0, left) * 100}%`, width: `${Math.min(1, Math.max(0, width)) * 100}%` };
}
