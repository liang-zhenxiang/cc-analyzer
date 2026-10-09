import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Panel } from "../../components/Panel";
import { focusRowIn, useRowNavigation } from "../sessions/useRowNavigation";
import { useMeasuredRowHeights } from "../sessions/measuredRows";
import { buildRowOffsets, computeSizedWindow } from "../sessions/virtualWindow";
import { useThresholds } from "../settings/thresholds";
import { useFontScale } from "../settings/fontScale";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { ErrorEvent } from "./errorStats";
import type { ErrorFilter } from "./ErrorOverviewSection";
import styles from "./ErrorEventList.module.css";

const ROW_HEIGHT = 30;

/**
 * 「错误事件」下钻列表（design §3.5）：窗口内全量事件、时间倒序、行点击跳回
 * 会话分析定位（sidechain 行 recordId=null 落到会话本身）。虚拟化与键盘导航
 * 和日志表同一套（measuredRows + virtualWindow + useRowNavigation），90 天
 * 全量与 30 行同一体验。
 */
export function ErrorEventList({
  events,
  filter,
  everFiltered,
  onClearFilter,
  onRevealRecord
}: {
  /** 已经过滤、已按时间倒序的事件。 */
  events: readonly ErrorEvent[];
  /** 当前过滤态（null = 全部）；描述行与清除按钮由它驱动。 */
  filter: ErrorFilter | null;
  /** 从未过滤过时描述行带引导文案（--text-faint 的合法用途：装饰性引导）。 */
  everFiltered: boolean;
  onClearFilter: () => void;
  /** 缺省（单测直挂组件）时行仍列出，只是不可跳。 */
  onRevealRecord?: (path: string, recordId: string | null) => void;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const { logWindowRows } = useThresholds();
  const fontScale = useFontScale();
  const { heights, estimate, measureRow, version } = useMeasuredRowHeights(
    Math.round(ROW_HEIGHT * fontScale),
    fontScale
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const virtualize = events.length > logWindowRows;
  const sizes = useMemo(
    () => events.map((event, index) => heights.get(rowKey(event, index)) ?? Math.round(estimate)),
    // `version` changes whenever a measurement lands; `heights` is a mutable cache.
    [events, estimate, version, heights]
  );
  const offsets = useMemo(() => buildRowOffsets(sizes), [sizes]);
  const listWindow = useMemo(
    () =>
      virtualize
        ? computeSizedWindow({ offsets, scrollTop, viewportHeight })
        : { start: 0, end: events.length, padTop: 0, padBottom: 0 },
    [offsets, scrollTop, viewportHeight, virtualize, events.length]
  );
  const visibleEvents = events.slice(listWindow.start, listWindow.end);

  const focusRow = useCallback((index: number) => focusRowIn(listRef.current, "button", index), []);
  const { activeIndex, setActiveIndex, onKeyDown: onRowKeyDown } = useRowNavigation({
    count: visibleEvents.length,
    onActivate: (index) => {
      const event = visibleEvents[index];
      if (event && onRevealRecord) onRevealRecord(event.path, event.recordId);
    },
    focusRow
  });

  // 过滤切换立即滚回顶部：过滤后的第 0 行是新阅读的起点，保留旧滚动位置
  // 只会得到「空白视口」（design §8）。scrollTop 直接赋值：jsdom 没实现
  // scrollTo()（LogView / DroppedList 同法）。
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [filter]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 320);
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) setViewportHeight(element.clientHeight || 320);
  }, [events.length]);

  return (
    <Panel
      title="错误事件"
      ariaLabel="错误事件"
      actions={
        <>
          {filter ? (
            <button type="button" className={styles.clear} onClick={onClearFilter}>
              × 清除过滤
            </button>
          ) : null}
          <ProvenanceBadge provenance="logged" />
        </>
      }
    >
      <p className={styles.description} data-error-filter={filter ? filter.label : undefined}>
        {filter ? (
          <>
            <span className={styles.descriptionScope}>{filter.label}</span>
            {` · ${events.length} 条 · 时间倒序`}
          </>
        ) : (
          <>
            {`全部 ${events.length} 条 · 时间倒序`}
            {!everFiltered ? (
              <span className={styles.hint}>（点击上方任一切面可过滤本列表）</span>
            ) : null}
          </>
        )}
      </p>
      {events.length > 0 ? (
        <div
          ref={scrollRef}
          className={styles.scroller}
          onScroll={onScroll}
          onKeyDown={onRowKeyDown}
          tabIndex={0}
          aria-label="错误事件列表"
          /* data-error-events：真机门禁取列表滚动几何的稳定锚点（同 dropped-list 先例）。 */
          data-error-events
        >
          <ul ref={listRef} className={styles.list}>
            {listWindow.start > 0 ? (
              <li aria-hidden="true" style={{ height: listWindow.padTop }} />
            ) : null}
            {visibleEvents.map((event, index) => {
              const key = rowKey(event, listWindow.start + index);
              return (
                <li key={key}>
                  <button
                    type="button"
                    className={styles.row}
                    data-row-index={index}
                    tabIndex={activeIndex === index ? 0 : -1}
                    ref={(element) => measureRow(key, element)}
                    title={event.preview}
                    onClick={() => onRevealRecord?.(event.path, event.recordId)}
                    onFocus={() => setActiveIndex(index)}
                  >
                    <span className={styles.time}>{formatEventTime(event.timestamp)}</span>
                    <span
                      className={event.kind === "api" ? styles.markApi : styles.markTool}
                      aria-hidden="true"
                    />
                    <span className={styles.identity}>{identityOf(event)}</span>
                    <span className={styles.preview}>{event.preview}</span>
                    {event.recordId === null ? (
                      <span className={styles.sidechain} title="子 agent 记录暂不能定位到日志行——点击落到所在会话">
                        子 agent
                      </span>
                    ) : null}
                    <span className={styles.arrow} aria-hidden="true">
                      →
                    </span>
                  </button>
                </li>
              );
            })}
            {listWindow.end < events.length ? (
              <li aria-hidden="true" style={{ height: listWindow.padBottom }} />
            ) : null}
          </ul>
        </div>
      ) : (
        <p className={styles.noMatch}>{`${filter ? filter.label : "本区间"} 没有错误事件`}</p>
      )}
    </Panel>
  );
}

/** 事件没有稳定 id：用 时间戳 + 身份 组合做行键（同一毫秒同工具的重复也算不同行）。 */
function rowKey(event: ErrorEvent, index: number): string {
  return `${event.timestamp}-${event.kind}-${event.toolName ?? event.apiStatus ?? ""}-${index}`;
}

/**
 * `M/DD HH:mm`，本地时区（design §3.5 的时间段格式；日期补零成两位——设计
 * 示例就是 `10-08 14:02`，且等长串在 mono 列里宽度恒定，行间时间对齐）。
 */
function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 身份段：工具名，或 `API·402` / `API·网络`（无 status = 传输层失败）。 */
function identityOf(event: ErrorEvent): string {
  if (event.kind === "tool") return event.toolName ?? "未知工具";
  return event.apiStatus != null ? `API·${event.apiStatus}` : "API·网络";
}
