import { useMemo, useRef, useState } from "react";
import type { ParsedSession, SessionRecord } from "./types";
import type { TimeRange } from "./filters";
import { formatDuration } from "../../lib/format";
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
  const range = useMemo(
    () => ({ start: session.startedAt, end: Math.max(session.endedAt, session.startedAt + 1) }),
    [session]
  );

  const blocks = useMemo(
    () =>
      session.records.map((record) => ({
        record,
        left: Math.max(0, Math.min(1, (record.timestamp - range.start) / (range.end - range.start))),
        category: category(record)
      })),
    [session.records, range]
  );
  const shownSelection = preview ?? selection;

  function timestampFrom(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return range.start;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return range.start + ratio * (range.end - range.start);
  }

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
          if (!dragRef.current) return;
          setPreview({ start: dragRef.current.start, end: timestampFrom(event.clientX) });
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
        onKeyDown={(event) => {
          if (event.key === "Escape") onSelect(null);
        }}
      >
        {blocks.map(({ record, left, category: recordCategory }) => (
          <button
            key={record.fullId}
            type="button"
            className={styles[recordCategory]}
            style={{ left: `${left * 100}%` }}
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
      </div>
      <footer>在轨道上拉选一段时间可只看那一段；按 Esc 清除时间选区。</footer>
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
