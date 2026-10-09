import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { toRow } from "./logRows";
import { focusRowIn, useRowNavigation } from "./useRowNavigation";
import { useMeasuredRowHeights } from "./measuredRows";
import { buildRowOffsets, computeSizedWindow } from "./virtualWindow";
import { useThresholds } from "../settings/thresholds";
import { useFontScale } from "../settings/fontScale";
import { formatDateTime } from "../../lib/format";
import type { SessionRecord } from "./types";
import styles from "./DroppedList.module.css";

const ROW_HEIGHT = 30;

type DropFilter = "all" | "user";

const FILTER_ITEMS: SegmentedItem<DropFilter>[] = [
  { value: "all", label: "全部" },
  { value: "user", label: "仅用户" }
];

/**
 * 「被丢出上下文的内容」（design §2.4）。
 *
 * 口径由 `droppedByEvent` 给出：该边界之前出现过的全部消息 − 幸存清单，
 * 跨多次压缩按首次丢弃去重。这里的职责只有呈现——行语言逐字复用日志表
 * （时间 · 类型徽章 · 动作 · 摘要），行点击跳日志视图定位原文。
 * 虚拟化与键盘导航和 LogView 同一套（measuredRows + virtualWindow +
 * useRowNavigation），5k 行与 50 行同一体验。
 */
export function DroppedList({
  records,
  onLocateInLog
}: {
  records: SessionRecord[];
  onLocateInLog: (recordId: string) => void;
}) {
  const [mode, setMode] = useState<DropFilter>("all");
  const rows = useMemo(() => records.map((record) => toRow(record)), [records]);
  // 默认「全部」：完整事实在前，过滤是用户的选择（design §2.4）。
  const shown = useMemo(
    () => (mode === "user" ? rows.filter((row) => row.kind === "user") : rows),
    [rows, mode]
  );

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const { logWindowRows } = useThresholds();
  // ROW_HEIGHT 是 100% 下的基准，回退估计随字号档位缩放；切档清缓存（同 LogView）。
  const fontScale = useFontScale();
  const { heights, estimate, measureRow, version } = useMeasuredRowHeights(
    Math.round(ROW_HEIGHT * fontScale),
    fontScale
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const virtualize = shown.length > logWindowRows;
  const sizes = useMemo(
    () => shown.map((row) => heights.get(row.id) ?? Math.round(estimate)),
    // `version` changes whenever a measurement lands; `heights` is a mutable cache.
    [shown, estimate, version]
  );
  const offsets = useMemo(() => buildRowOffsets(sizes), [sizes]);
  const listWindow = useMemo(
    () =>
      virtualize
        ? computeSizedWindow({ offsets, scrollTop, viewportHeight })
        : { start: 0, end: shown.length, padTop: 0, padBottom: 0 },
    [offsets, scrollTop, viewportHeight, virtualize, shown.length]
  );
  const visibleRows = shown.slice(listWindow.start, listWindow.end);

  const focusRow = useCallback((index: number) => focusRowIn(listRef.current, "li", index), []);
  const { activeIndex, setActiveIndex, onKeyDown: onRowKeyDown } = useRowNavigation({
    count: visibleRows.length,
    onActivate: (index) => {
      const row = visibleRows[index];
      if (row) onLocateInLog(row.id);
    },
    focusRow
  });

  // 换过滤档或换事件时回到清单顶部：过滤后的第 0 行是新阅读的起点。
  // scrollTop 直接赋值而不是 scrollTo()：jsdom 没实现后者（LogView 同法）。
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [mode, records]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 320);
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) setViewportHeight(element.clientHeight || 320);
  }, [shown.length]);

  return (
    <section className={styles.root} aria-label="被丢出上下文的内容">
      <div className={styles.header}>
        <h3 className={styles.title}>被丢出上下文的内容 · {shown.length} 条</h3>
        <SegmentedControl
          items={FILTER_ITEMS}
          value={mode}
          onChange={setMode}
          ariaLabel="被丢内容过滤"
          role="radiogroup"
        />
      </div>
      <div ref={scrollRef} className={styles.scroller} onScroll={onScroll} onKeyDown={onRowKeyDown}>
        <ul ref={listRef} className={styles.list}>
          {listWindow.start > 0 ? (
            <li aria-hidden="true" style={{ height: listWindow.padTop }} />
          ) : null}
          {visibleRows.map((row, index) => (
            <li
              key={row.id}
              data-row-index={index}
              tabIndex={activeIndex === index ? 0 : -1}
              ref={(element) => measureRow(row.id, element)}
              className={`${styles.row} ${styles[row.kind] ?? ""}`}
              title={`${row.action}${row.summary ? ` · ${row.summary}` : ""}`}
              onClick={() => onLocateInLog(row.id)}
              onFocus={() => setActiveIndex(index)}
            >
              <span className={styles.rowTime}>{formatDateTime(row.timestamp)}</span>
              <span className={styles.kind}>{row.label}</span>
              <span className={styles.rowText}>
                <strong>{row.action}</strong>
                {row.summary ? ` · ${row.summary}` : ""}
              </span>
            </li>
          ))}
          {listWindow.end < shown.length ? (
            <li aria-hidden="true" style={{ height: listWindow.padBottom }} />
          ) : null}
        </ul>
        {shown.length === 0 ? (
          <EmptyState
            size="inline"
            title={mode === "user" ? "该边界前没有用户消息被丢出" : "该边界前没有被丢出的消息"}
          />
        ) : null}
      </div>
    </section>
  );
}
