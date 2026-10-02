import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ScrollArea } from "../../components/ScrollArea";
import type { SessionRecord } from "./types";
import { useMeasuredRowHeights } from "./measuredRows";
import { buildRowOffsets, computeSizedWindow } from "./virtualWindow";
import { useThresholds } from "../settings/thresholds";
import { focusRowIn, useRowNavigation } from "./useRowNavigation";
import { formatDateTime, formatDuration } from "../../lib/format";
import { safeStringify } from "../../lib/json";
import styles from "./RecordTable.module.css";

type SortKey = "time" | "duration" | "kind" | "status";

const kindLabels: Record<SessionRecord["kind"], string> = {
  user: "用户",
  assistant: "模型",
  tool: "工具",
  wait: "等待"
};

/** Fallback height until a row is measured, plus the height an expanded row adds. */
const ESTIMATED_ROW_HEIGHT = 38;
const EXPANDED_ROW_EXTRA = 260;

export function RecordTable({
  records,
  selectedId,
  onSelect
}: {
  records: SessionRecord[];
  selectedId: string | null;
  onSelect: (record: SessionRecord) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "time",
    direction: "asc"
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(360);
  const containerRef = useRef<HTMLDivElement>(null);
  const { extras, heights, estimate, measureExtra, measureRow, version } =
    useMeasuredRowHeights(ESTIMATED_ROW_HEIGHT);
  const { logWindowRows } = useThresholds();

  const sorted = useMemo(
    () =>
      [...records].sort((a, b) => {
        const factor = sort.direction === "asc" ? 1 : -1;
        if (sort.key === "time") return (a.timestamp - b.timestamp) * factor;
        if (sort.key === "duration") return (a.durationMs - b.durationMs) * factor;
        if (sort.key === "kind") return a.kind.localeCompare(b.kind) * factor;
        return (Number(a.isError) - Number(b.isError)) * factor;
      }),
    [records, sort]
  );

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  const virtualize = sorted.length > logWindowRows;
  const sizes = useMemo(
    () =>
      sorted.map(
        (record) =>
          (heights.get(record.fullId) ?? Math.round(estimate)) +
          (expandedId === record.fullId ? extras.get(record.fullId) ?? EXPANDED_ROW_EXTRA : 0)
      ),
    // `version` changes whenever a measurement lands in the cache; `heights`
    // itself is a stable mutable Map that the memo must not track.
    [estimate, expandedId, sorted, version]
  );
  const offsets = useMemo(() => buildRowOffsets(sizes), [sizes]);
  const window = useMemo(
    () =>
      virtualize
        ? computeSizedWindow({ offsets, scrollTop, viewportHeight })
        : { start: 0, end: sorted.length, padTop: 0, padBottom: 0 },
    [offsets, scrollTop, sorted.length, viewportHeight, virtualize]
  );
  const visible = virtualize ? sorted.slice(window.start, window.end) : sorted;

  // 行级键盘导航（评审 #3）：↑↓/Home/End 移动焦点行，Enter/Space 选中——
  // 与鼠标点击走同一个 onSelect，不另设一条激活路径。
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const focusRow = useCallback(
    (index: number) => focusRowIn(tbodyRef.current, "tr", index),
    []
  );
  const { activeIndex, setActiveIndex, onKeyDown: onRowKeyDown } = useRowNavigation({
    count: visible.length,
    onActivate: (index) => onSelect(visible[index]),
    focusRow
  });

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 360);
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [records]);

  return (
    <ScrollArea scrollerRef={containerRef} className={styles.container} onScroll={onScroll}>
      <table>
        <thead>
          <tr>
            <th>记录ID</th>
            <th><Button type="button" variant="ghost" onClick={() => toggleSort("time")}>时间</Button></th>
            <th><Button type="button" variant="ghost" onClick={() => toggleSort("kind")}>类型</Button></th>
            <th>操作 / 摘要</th>
            <th><Button type="button" variant="ghost" onClick={() => toggleSort("duration")}>耗时</Button></th>
            <th><Button type="button" variant="ghost" onClick={() => toggleSort("status")}>状态</Button></th>
          </tr>
        </thead>
        <tbody ref={tbodyRef} onKeyDown={onRowKeyDown}>
          {window.padTop > 0 ? <tr aria-hidden="true" style={{ height: window.padTop }} /> : null}
          {visible.map((record, index) => (
            <FragmentRow
              key={record.fullId}
              record={record}
              navIndex={index}
              navActive={index === activeIndex}
              onNavFocus={setActiveIndex}
              selected={selectedId === record.fullId}
              expanded={expandedId === record.fullId}
              onSelect={onSelect}
              onToggle={() => setExpandedId((current) => current === record.fullId ? null : record.fullId)}
              rowMeasure={(element) => measureRow(record.fullId, element)}
              panelMeasure={(element) => measureExtra(record.fullId, element)}
            />
          ))}
          {window.padBottom > 0 ? (
            <tr aria-hidden="true" style={{ height: window.padBottom }} />
          ) : null}
        </tbody>
      </table>
      {records.length === 0 ? (
        <EmptyState size="inline" title="没有符合筛选条件的记录" />
      ) : null}
    </ScrollArea>
  );
}

function FragmentRow({
  record,
  navIndex,
  navActive,
  onNavFocus,
  selected,
  expanded,
  onSelect,
  onToggle,
  rowMeasure,
  panelMeasure
}: {
  record: SessionRecord;
  navIndex: number;
  navActive: boolean;
  onNavFocus: (index: number) => void;
  selected: boolean;
  expanded: boolean;
  onSelect: (record: SessionRecord) => void;
  onToggle: () => void;
  rowMeasure: (element: HTMLTableRowElement | null) => void;
  panelMeasure: (element: HTMLTableRowElement | null) => void;
}) {
  return (
    <>
      <tr
        ref={rowMeasure}
        className={selected ? styles.selected : undefined}
        data-row-index={navIndex}
        tabIndex={navActive ? 0 : -1}
        onFocus={() => onNavFocus(navIndex)}
        onClick={() => onSelect(record)}
      >
        <td><code>{record.id}</code></td>
        <td>{formatDateTime(record.timestamp)}</td>
        <td>{kindLabels[record.kind]}</td>
        <td>
          {record.toolName ? <strong>{record.toolName}</strong> : null}
          {record.toolName && record.text ? " · " : ""}
          {record.text || "-"}
        </td>
        <td>{formatDuration(record.durationMs)}</td>
        <td className={record.isError ? styles.error : undefined}>
          {record.isError ? "失败" : "正常"}
        </td>
        <td>
          <Button
            type="button"
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            {expanded ? "收起" : "展开"}
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr className={styles.expanded} ref={panelMeasure}>
          <td colSpan={7}>
            <pre>{safeStringify(record.raw, 2)}</pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}
