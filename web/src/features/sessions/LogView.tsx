import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type UIEvent
} from "react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { AnsiText } from "../../components/AnsiText";
import type { SessionRecord } from "./types";
import type { LogRow } from "./logRows";
import { formatInputValue, structuredResultLines } from "./structuredResultLines";
import { focusRowIn, useRowNavigation } from "./useRowNavigation";
import { useMeasuredRowHeights } from "./measuredRows";
import { buildRowOffsets, computeSizedWindow } from "./virtualWindow";
import type { TimeRange } from "./filters";
import { formatDateTime, formatDuration } from "../../lib/format";
import { safeStringify } from "../../lib/json";
import { useThresholds } from "../settings/thresholds";
import { useFontScale } from "../settings/fontScale";
import { ScrollArea } from "../../components/ScrollArea";
import styles from "./LogView.module.css";

type Panel = { label: string; meta?: string; body: string };
type Axis = { lo: number; total: number };

const ROW_HEIGHT = 30;
const EXPANDED_PANEL_HEIGHT = 320;
const MIN_MARKER_WIDTH = 6;

/** Where a row sits on the session timeline. */
function rowInterval(row: LogRow): { start: number; end: number } {
  return row.kind === "llm"
    ? { start: row.timestamp - row.durationMs, end: row.timestamp }
    : { start: row.timestamp, end: row.timestamp + row.durationMs };
}

function computeAxis(rows: LogRow[], selection: TimeRange | null): Axis {
  if (selection && selection.end > selection.start) {
    return { lo: selection.start, total: selection.end - selection.start };
  }
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const interval = rowInterval(row);
    lo = Math.min(lo, interval.start);
    hi = Math.max(hi, interval.end);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return { lo: 0, total: 1 };
  return { lo, total: hi - lo };
}

function shareRatio(ms: number, axis: Axis): number {
  if (axis.total <= 0 || ms <= 0) return 0;
  return Math.min(1, ms / axis.total);
}

function shareLabel(ms: number, axis: Axis): string {
  if (axis.total <= 0) return "0.0%";
  return `${((ms / axis.total) * 100).toFixed(1)}%`;
}

/**
 * Hover text for the token column, spelling out which counters the single
 * "提示词" figure is made of. Without it the column is a number nobody can
 * attribute — the exact complaint the four-counter panel exists to answer.
 */
function promptBreakdown(row: LogRow): string | undefined {
  if (!row.tokens) return undefined;
  const record = [...row.records].reverse().find((item) => item.usage);
  const usage = record?.usage;
  if (!usage) return undefined;
  return [
    `输入 ${usage.inputTokens ?? 0}`,
    `+ 缓存写入 ${usage.cacheCreationTokens ?? 0}`,
    `+ 缓存读取 ${usage.cacheReadTokens ?? 0}`,
    `= 提示词 ${row.tokens.prompt}`,
    `· 输出 ${row.tokens.output}`
  ].join(" ");
}

function durationClass(ms: number): "durationMs" | "durationS" | "durationM" {
  if (ms < 1000) return "durationMs";
  if (ms < 60_000) return "durationS";
  return "durationM";
}

function Waterfall({ row, axis }: { row: LogRow; axis: Axis }) {
  const interval = rowInterval(row);
  const left = Math.min(1, Math.max(0, (interval.start - axis.lo) / axis.total));
  const width = Math.max(0, (interval.end - interval.start) / axis.total);
  const title = `${formatDateTime(interval.start)} → ${formatDateTime(interval.end)} · ${row.label} · ${formatDuration(row.durationMs)}`;
  return (
    <span className={styles.waterfall} title={title}>
      <span
        className={styles.waterfallBar}
        style={
          width > 0
            ? { left: `${left * 100}%`, width: `${Math.max(width, 0.006) * 100}%` }
            : { left: `calc(${left * 100}% - ${MIN_MARKER_WIDTH / 2}px)`, width: `${MIN_MARKER_WIDTH}px` }
        }
      />
    </span>
  );
}

export function LogView({
  rows,
  selectedId,
  highlightId,
  timeRange,
  onSelect,
  onLocateInTree
}: {
  rows: LogRow[];
  selectedId: string | null;
  highlightId: string | null;
  timeRange?: TimeRange | null;
  onSelect: (record: SessionRecord) => void;
  onLocateInTree: (recordId: string) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const { logWindowRows } = useThresholds();
  // ROW_HEIGHT 是 100% 下的基准，回退估计随档位缩放；resetKey 用当前档位，
  // 切档后清掉实测缓存，首屏无需滚动即按新行高重排。
  const fontScale = useFontScale();
  const { extras, heights, estimate, measureRow, measureExtra, version } = useMeasuredRowHeights(
    Math.round(ROW_HEIGHT * fontScale),
    fontScale
  );

  const virtualize = rows.length > logWindowRows;
  const axis = useMemo(() => computeAxis(rows, timeRange ?? null), [rows, timeRange]);
  const sizes = useMemo(
    () =>
      rows.map(
        (row) =>
          (heights.get(row.id) ?? Math.round(estimate)) +
          (expandedId === row.id ? extras.get(row.id) ?? EXPANDED_PANEL_HEIGHT : 0)
      ),
    // `version` changes whenever a measurement lands; `heights` is a mutable cache.
    [estimate, expandedId, rows, version]
  );
  const offsets = useMemo(() => buildRowOffsets(sizes), [sizes]);
  const virtualWindow = useMemo(
    () =>
      virtualize
        ? computeSizedWindow({ offsets, scrollTop, viewportHeight })
        : { start: 0, end: rows.length, padTop: 0, padBottom: 0 },
    [offsets, rows.length, scrollTop, viewportHeight, virtualize]
  );
  const start = virtualize ? virtualWindow.start : 0;
  const end = virtualize ? virtualWindow.end : rows.length;
  const visibleRows = virtualize ? rows.slice(start, end) : rows;

  // 行级键盘导航（评审 #3）：与 RecordTable/TreeView 共用 useRowNavigation。
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const focusRow = useCallback(
    (index: number) => focusRowIn(tbodyRef.current, "tr", index),
    []
  );
  const { activeIndex, setActiveIndex, onKeyDown: onRowKeyDown } = useRowNavigation({
    count: visibleRows.length,
    onActivate: (index) => {
      const primary = visibleRows[index]?.records[visibleRows[index].records.length - 1];
      if (primary) onSelect(primary);
    },
    focusRow
  });

  useEffect(() => {
    if (!highlightId || !highlightRef.current) return;
    highlightRef.current.scrollIntoView({ block: "center" });
  }, [highlightId]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 480);
  }, []);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (element) setViewportHeight(element.clientHeight || 480);
  }, [rows.length]);

  useEffect(() => {
    if (!highlightId) return;
    const index = rows.findIndex((row) =>
      row.records.some((record) => record.fullId === highlightId)
    );
    if (index < 0 || !containerRef.current || !virtualize) return;
    containerRef.current.scrollTop = Math.max(0, offsets[index] - 160);
  }, [highlightId, offsets, rows, virtualize]);

  return (
    <ScrollArea scrollerRef={containerRef} className={styles.container} onScroll={onScroll}>
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>类型</th>
            <th>操作 / 摘要</th>
            {/* 列头必须说清它装的是什么：这个数是提示词总量（含缓存），
                不是 input_tokens——缓存命中时两者能差一个数量级。
                标题留在 tooltip 里，表头文字收短——它原本撑宽了整个列。 */}
            <th title="提示词 = input_tokens + 缓存写入 + 缓存读取">提示词 / 输出</th>
            <th>耗时</th>
            <th>占比</th>
            <th>waterfall</th>
            <th>状态</th>
            <th aria-label="行操作" />
          </tr>
        </thead>
        <tbody ref={tbodyRef} onKeyDown={onRowKeyDown}>
          {start > 0 ? (
            <tr aria-hidden="true" style={{ height: virtualWindow.padTop }} />
          ) : null}
          {visibleRows.map((row, index) => {
            const primary = row.records[row.records.length - 1];
            const selected = row.records.some((record) => record.fullId === selectedId);
            const expanded = expandedId === row.id;
            const highlighted = highlightId
              ? row.records.some((record) => record.fullId === highlightId)
              : false;
            return (
              <Fragment
                key={row.id}
                row={row}
                primary={primary}
                navIndex={index}
                navActive={index === activeIndex}
                onNavFocus={setActiveIndex}
                selected={selected}
                expanded={expanded}
                highlighted={highlighted}
                rowRef={highlighted ? highlightRef : undefined}
                rowMeasure={(element) => measureRow(row.id, element)}
                panelMeasure={(element) => measureExtra(row.id, element)}
                axis={axis}
                onSelect={onSelect}
                onLocateInTree={onLocateInTree}
                onToggle={() => setExpandedId((current) => (current === row.id ? null : row.id))}
              />
            );
          })}
          {end < rows.length ? (
            <tr aria-hidden="true" style={{ height: virtualWindow.padBottom }} />
          ) : null}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <EmptyState size="inline" title="没有符合筛选条件的记录" />
      ) : null}
    </ScrollArea>
  );
}

function Fragment({
  row,
  primary,
  navIndex,
  navActive,
  onNavFocus,
  selected,
  expanded,
  highlighted,
  rowRef,
  rowMeasure,
  panelMeasure,
  axis,
  onSelect,
  onLocateInTree,
  onToggle
}: {
  row: LogRow;
  primary: SessionRecord | undefined;
  navIndex: number;
  navActive: boolean;
  onNavFocus: (index: number) => void;
  selected: boolean;
  expanded: boolean;
  highlighted: boolean;
  rowRef?: MutableRefObject<HTMLTableRowElement | null>;
  rowMeasure: (element: HTMLTableRowElement | null) => void;
  panelMeasure: (element: HTMLTableRowElement | null) => void;
  axis: Axis;
  onSelect: (record: SessionRecord) => void;
  onLocateInTree: (recordId: string) => void;
  onToggle: () => void;
}) {
  const panels = row.gap
    ? [
        {
          label: "等待区间",
          meta: `${formatDateTime(row.gap.start)} → ${formatDateTime(row.gap.end)}`,
          body: "轮间间隙：上一条活动结束 → 下一条用户输入"
        }
      ]
    : row.records.flatMap((record) => recordPanels(record));
  return (
    <>
      <tr
        ref={(element) => {
          rowMeasure(element);
          if (rowRef) rowRef.current = element;
        }}
        className={[
          styles[row.kind],
          selected ? styles.selected : "",
          highlighted ? styles.highlight : ""
        ].filter(Boolean).join(" ")}
        data-row-index={navIndex}
        tabIndex={navActive ? 0 : -1}
        onFocus={() => onNavFocus(navIndex)}
        onClick={() => {
          if (primary) onSelect(primary);
        }}
      >
        <td>{formatDateTime(row.timestamp)}</td>
        <td><span className={styles.kind}>{row.label}</span></td>
        <td className={styles.detail}>
          <span
            className={styles.detailLine}
            title={row.summary ? `${row.action} · ${row.summary}` : row.action}
          >
            <strong>{row.action}</strong>
            {row.summary ? ` · ${row.summary}` : ""}
          </span>
        </td>
        <td className={styles.tokens} title={promptBreakdown(row)}>
          {row.tokens ? `${row.tokens.prompt} / ${row.tokens.output}` : "—"}
        </td>
        <td className={styles[durationClass(row.durationMs)]}>
          {row.durationMs > 0 ? formatDuration(row.durationMs) : "—"}
        </td>
        <td className={styles.share}>
          <span className={styles.shareTrack}>
            <span
              className={styles.shareFill}
              style={{ width: `${shareRatio(row.durationMs, axis) * 100}%` }}
            />
          </span>
          <span className={styles.shareText}>{shareLabel(row.durationMs, axis)}</span>
        </td>
        <td>
          <Waterfall row={row} axis={axis} />
        </td>
        <td className={row.status === "error" ? styles.error : styles.statusMuted}>
          {statusLabel(row.status)}
        </td>
        <td className={styles.actions}>
          <button
            type="button"
            className={styles.toggle}
            aria-expanded={expanded}
            aria-label={expanded ? "收起" : "展开"}
            title={expanded ? "收起" : "展开"}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            <span aria-hidden="true">{expanded ? "▼" : "▶"}</span>
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className={styles.expanded} ref={panelMeasure}>
          <td colSpan={9}>
            {/* 低频动作移入展开区顶部、右对齐：与右栏详情里那颗完全同款。
                仅当该行有记录时渲染——「等用户」这类无记录行展开后不出现。 */}
            {primary ? (
              <div className={styles.expandActions}>
                <Button type="button" onClick={() => onLocateInTree(primary.fullId)}>
                  在树视图定位
                </Button>
              </div>
            ) : null}
            {panels.map((panel, index) => (
              <section key={`${panel.label}-${index}`} aria-label={panel.label}>
                <h4>
                  {panel.label}
                  {panel.meta ? <span className={styles.panelMeta}>{panel.meta}</span> : null}
                </h4>
                {/* 终端输出按原色渲染：`panel.body` 里可能就是 Claude Code 抓到的
                    带 SGR 序列的 stdout，原样打印只会得到 `[31m` 乱码。 */}
                <pre>
                  <AnsiText text={panel.body} />
                </pre>
              </section>
            ))}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function statusLabel(status: LogRow["status"]): string {
  if (status === "error") return "失败";
  if (status === "na") return "—";
  return "正常";
}

function recordPanels(record: SessionRecord): Panel[] {
  const panels: Panel[] = [];
  if (record.kind === "user" || record.kind === "wait") {
    panels.push({ label: "记录内容", body: record.text || "（空）" });
  }
  if (record.kind === "assistant") {
    const thinking = (record.contentBlocks ?? [])
      .map((block) => block.thinking ?? "")
      .filter(Boolean)
      .join("\n\n");
    const text = (record.contentBlocks ?? [])
      .map((block) => block.text ?? "")
      .filter(Boolean)
      .join("\n\n");
    const tools = (record.contentBlocks ?? [])
      .filter((block) => block.type === "tool_use")
      .map((block) => block.name ?? "(未命名工具)");
    if (thinking) panels.push({ label: "模型思考", body: thinking });
    panels.push({ label: "模型输出", body: text || "（无文本输出）" });
    if (tools.length > 0) {
      panels.push({ label: "本轮工具调用", body: tools.join("\n") });
    }
    if (record.usage) {
      panels.push({
        label: "Token",
        body: [
          `输入           ${record.usage.inputTokens ?? 0}`,
          `缓存写入       ${record.usage.cacheCreationTokens ?? 0}`,
          `缓存读取       ${record.usage.cacheReadTokens ?? 0}`,
          `输出           ${record.usage.outputTokens ?? 0}`
        ].join("\n")
      });
    }
    if (record.apiError) {
      panels.push({
        label: "API 错误",
        body: `${record.apiError.kind ?? "未知"}${record.apiError.status == null ? "" : ` (${record.apiError.status})`}`
      });
    }
  }
  if (record.toolName) {
    panels.push({
      label: "工具输入",
      meta: record.toolName,
      body: formatInputValue(record.toolInput)
    });
    panels.push({
      label: "工具输出",
      meta: record.resultTruncated ? "已截断" : undefined,
      body: record.toolResult ?? "（无输出）"
    });
    const structured = structuredResultLines(record);
    if (structured.length > 0) {
      panels.push({
        label: "结构化结果",
        meta: record.structuredResult?.toolName ?? "",
        body: structured.join("\n")
      });
    }
  }
  if (record.workflowRun) {
    panels.push({
      label: "Workflow",
      meta: record.workflowRun.workflowName || record.workflowRun.runId,
      body: [
        `状态         ${record.workflowRun.status || "未知"}`,
        `子 agent     ${record.workflowRun.agentCount} 个`,
        `运行时长     ${formatDuration(record.workflowRun.durationMs)}`,
        `token        ${record.workflowRun.totalTokens ?? "—"}`,
        `工具调用     ${record.workflowRun.totalToolCalls ?? "—"} 次`,
        `阶段         ${record.workflowRun.phases.join(" → ") || "—"}`,
        ...record.workflowRun.logs
      ].join("\n")
    });
  }
  panels.push({ label: "原始事件", body: safeStringify(record.raw, 2) });
  return panels;
}
