import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { ProvenanceBadge } from "../usage/ProvenanceBadge";
import { useFontScale } from "../settings/fontScale";
import { useThresholds } from "../settings/thresholds";
import { formatShortStamp } from "../../lib/format";
import { extractFileActivities, type FileActivity } from "./changedFiles";
import { focusRowIn, useRowNavigation } from "./useRowNavigation";
import { useMeasuredRowHeights } from "./measuredRows";
import { buildRowOffsets, computeSizedWindow } from "./virtualWindow";
import type { ParsedSession, SessionRecord } from "./types";
import styles from "./ChangedFilesView.module.css";

/** 100% 字号下的行高基准（--row-h 的值）；回退估计随字号档位缩放。 */
const ROW_HEIGHT = 30;
/** 展开区从未实测时的高度回退：小结行 + 记录行的经验值，测到真值即被覆盖。 */
const EXPANDED_PANEL_HEIGHT = 160;

/** 口径脚注（design §2）：藏起来的口径等于没有口径，空态也常显。 */
const SCOPE_FOOTNOTE =
  "改动 = 成功的 Edit / Write / NotebookEdit；查看 = 成功的 Read；失败调用可见于下钻清单但不计数；" +
  "不含 Bash 等间接写文件的调用；含子 agent 调用。会话内的 file-history 快照记录已登记解析，本视图暂不消费。";

/**
 * 会话详情「改动」标签页（Round N / N2）：按文件归档的现场清单——回答
 * 「这次会话动了哪些文件、动了多少次、哪一下动的」，每条线索一跳回日志原文。
 *
 * 数据走 A 方案（tool_use 聚合，`changedFiles.ts` 持有口径）；形态是 LogView
 * 舞台模式的单面板（裁决 #1）：面板体内部滚动 + 虚拟化（DroppedList 同一套）。
 * 视觉零新词：行选中/徽标/脚注语言逐字继承 N1 与日志表，本视图零 danger
 * 零 chart-*（它是清单不是图表，是事实不是判定）。
 */
export function ChangedFilesView({
  parsed,
  onLocateInLog
}: {
  parsed: ParsedSession;
  /** 点记录行跳回日志视图定位（sidechain 记录照调不拦——跳回现场仍是有效落点）。 */
  onLocateInLog: (recordId: string) => void;
}) {
  const activities = useMemo(() => extractFileActivities(parsed), [parsed]);

  // 展开区记录查回（design 异议 3 裁决）：fullId → 记录的并集 Map，契约不补字段。
  const recordByFullId = useMemo(() => {
    const map = new Map<string, SessionRecord>();
    for (const record of parsed.records) map.set(record.fullId, record);
    for (const record of parsed.sidechainMessages) map.set(record.fullId, record);
    return map;
  }, [parsed]);

  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  // 展开态属于「这个会话里的这个文件」：换会话清空。依赖是 sessionId 而不是
  // parsed 对象身份——真机上后台重解析会产出新对象（ContextView 选中态同教训），
  // 按身份清空会把刚点开的展开区抹掉。
  const sessionId = parsed.sessionId;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(320);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const recordsListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setExpandedPath(null);
    // 换会话回到清单顶部：新会话的第 0 行是新阅读的起点。scrollTop 直接赋值
    // 而不是 scrollTo()：jsdom 没实现后者（DroppedList 同法）。
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [sessionId]);

  const { logWindowRows } = useThresholds();
  const fontScale = useFontScale();
  const { extras, heights, estimate, measureRow, measureExtra, version } = useMeasuredRowHeights(
    Math.round(ROW_HEIGHT * fontScale),
    fontScale
  );

  // 展开行是变高行（裁决 #14）：文件行高 + 展开区高分开实测，逐行天然支持。
  const virtualize = activities.length > logWindowRows;
  const sizes = useMemo(
    () =>
      activities.map(
        (file) =>
          (heights.get(file.path) ?? Math.round(estimate)) +
          (expandedPath === file.path ? extras.get(file.path) ?? EXPANDED_PANEL_HEIGHT : 0)
      ),
    // `version` changes whenever a measurement lands; `heights`/`extras` are mutable caches.
    [activities, estimate, expandedPath, extras, heights, version]
  );
  const offsets = useMemo(() => buildRowOffsets(sizes), [sizes]);
  const listWindow = useMemo(
    () =>
      virtualize
        ? computeSizedWindow({ offsets, scrollTop, viewportHeight })
        : { start: 0, end: activities.length, padTop: 0, padBottom: 0 },
    [offsets, scrollTop, viewportHeight, virtualize, activities.length]
  );
  const visibleFiles = activities.slice(listWindow.start, listWindow.end);

  const toggle = useCallback((path: string) => {
    // 单开手风琴（裁决 #6）：展开 B 时 A 自动收起；再点同一行收起。
    setExpandedPath((current) => (current === path ? null : path));
  }, []);

  const focusRow = useCallback((index: number) => focusRowIn(listRef.current, "button", index), []);
  const { activeIndex, setActiveIndex, onKeyDown: onFilesKeyDownBase } = useRowNavigation({
    count: visibleFiles.length,
    onActivate: (index) => {
      const file = visibleFiles[index];
      if (file) toggle(file.path);
    },
    focusRow
  });

  // Esc 收起当前展开（design §5）；其余键交给行导航。
  // 焦点在行按钮上时 Enter/Space 交给按钮的原生激活（keydown → click）——
  // 行导航再激活一次会让 toggle 落两次（展开又收起），reveal 类动作没有这个
  // 问题，toggle 有（useRowNavigation 的 Enter 分支是为 tr/li 行写的）。
  const onFilesKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        if (expandedPath !== null) setExpandedPath(null);
        return;
      }
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target !== event.currentTarget
      ) {
        return;
      }
      onFilesKeyDownBase(event);
    },
    [expandedPath, onFilesKeyDownBase]
  );

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 320);
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) setViewportHeight(element.clientHeight || 320);
  }, [activities.length]);

  // 聚合读数（裁决 #12：一行文字，不做图表）。
  const totals = useMemo(
    () => ({
      files: activities.length,
      changes: activities.reduce((sum, file) => sum + file.edits + file.writes, 0),
      reads: activities.reduce((sum, file) => sum + file.reads, 0),
      created: activities.reduce((sum, file) => (file.createdNew ? sum + 1 : sum), 0)
    }),
    [activities]
  );

  return (
    <div className={styles.root} data-changes-view>
      <Panel
        title="改动文件"
        ariaLabel="改动文件"
        actions={
          activities.length > 0 ? (
            /* data-changes-aggregate：真机门禁读「N 个文件」声明行数的稳定锚点。
               不借 closest('section') 找面板头——那要假设本组件的结构方向，探针
               拿到的是这个 div 的**祖先**链，而 Panel 的 section 是它的子元素
               （dropped-list 先例里探针元素在 section 内部，方向相反；真机抓到过）。 */
            <span className={styles.aggregate} data-changes-aggregate>
              {`${totals.files} 个文件 · ${totals.changes} 次改动 · ${totals.reads} 次查看 · ${totals.created} 个新建`}
              <ProvenanceBadge provenance="logged" />
            </span>
          ) : undefined
        }
      >
        {activities.length === 0 ? (
          <div className={styles.empty} data-changes-empty>
            <EmptyState
              size="panel"
              title="本会话没有接触任何文件"
              description="没有成功的 Edit / Write / NotebookEdit，也没有 Read。"
            />
          </div>
        ) : (
          <div
            ref={scrollRef}
            className={styles.scroller}
            onScroll={onScroll}
            onKeyDown={onFilesKeyDown}
            tabIndex={0}
            aria-label="改动文件列表"
            /* data-changes-files：真机门禁取列表滚动几何的稳定锚点（同 dropped-list 先例）。 */
            data-changes-files
          >
            {/* data-col 是列对齐断言的稳定锚点（表头与行值同名同列）——
                CSS Module 类名带哈希，e2e 量中心差只能靠它定位。 */}
            <div className={styles.head} data-changes-head>
              <span className={styles.headMark} />
              <span className={styles.headPath}>文件</span>
              <span className={styles.headNum} data-col="changes">
                改动
              </span>
              <span className={styles.headNum} data-col="reads">
                查看
              </span>
              <span className={styles.headNum} data-col="last">
                末次活动
              </span>
            </div>
            <ul ref={listRef} className={styles.list}>
              {listWindow.start > 0 ? (
                <li aria-hidden="true" style={{ height: listWindow.padTop }} />
              ) : null}
              {visibleFiles.map((file, index) => (
                <FileEntry
                  key={file.path}
                  file={file}
                  expanded={expandedPath === file.path}
                  navIndex={index}
                  navActive={index === activeIndex}
                  onNavFocus={setActiveIndex}
                  onToggle={() => toggle(file.path)}
                  onCollapse={() => setExpandedPath(null)}
                  rowMeasure={(element) => measureRow(file.path, element)}
                  panelMeasure={(element) => measureExtra(file.path, element)}
                  recordByFullId={recordByFullId}
                  recordsListRef={recordsListRef}
                  onLocateInLog={onLocateInLog}
                />
              ))}
              {listWindow.end < activities.length ? (
                <li aria-hidden="true" style={{ height: listWindow.padBottom }} />
              ) : null}
            </ul>
          </div>
        )}
        <p className={styles.footnote}>{SCOPE_FOOTNOTE}</p>
      </Panel>
    </div>
  );
}

/** 一个文件行 +（展开时）它的记录清单。两段都是 li：行高由 li 承载（N1 教训）。 */
function FileEntry({
  file,
  expanded,
  navIndex,
  navActive,
  onNavFocus,
  onToggle,
  onCollapse,
  rowMeasure,
  panelMeasure,
  recordByFullId,
  recordsListRef,
  onLocateInLog
}: {
  file: FileActivity;
  expanded: boolean;
  navIndex: number;
  navActive: boolean;
  onNavFocus: (index: number) => void;
  onToggle: () => void;
  onCollapse: () => void;
  rowMeasure: (element: HTMLElement | null) => void;
  panelMeasure: (element: HTMLElement | null) => void;
  recordByFullId: Map<string, SessionRecord>;
  recordsListRef: React.RefObject<HTMLUListElement>;
  onLocateInLog: (recordId: string) => void;
}) {
  const changes = file.edits + file.writes;
  const rowTitle =
    `${file.path} · 改动 ${changes}（Edit ${file.edits} · Write ${file.writes}）` +
    ` · 查看 ${file.reads} · 首次 ${formatShortStamp(file.firstAt)} · 末次 ${formatShortStamp(file.lastAt)}` +
    (file.sidechainCount > 0 ? ` · 子 agent ${file.sidechainCount}` : "");

  const records = useMemo(
    () =>
      file.recordIds
        .map((id) => recordByFullId.get(id))
        .filter((record): record is SessionRecord => record !== undefined),
    [file.recordIds, recordByFullId]
  );

  return (
    <>
      <li
        className={styles.fileRow}
        data-changes-file={file.relPath}
        ref={rowMeasure}
      >
        <button
          type="button"
          className={expanded ? `${styles.row} ${styles.rowOpen}` : styles.row}
          aria-expanded={expanded}
          data-row-index={navIndex}
          tabIndex={navActive ? 0 : -1}
          onClick={onToggle}
          onFocus={() => onNavFocus(navIndex)}
          title={rowTitle}
        >
          <span className={styles.mark} aria-hidden="true">
            {expanded ? "▾" : "▸"}
          </span>
          {/* 新建 chip 住在路径单元格里（不占 grid 轨）：变宽内容进轨道会把
              后面三列逐行推来推去——对齐缺陷的根，两代同根。 */}
          <span className={styles.pathCell}>
            <span className={styles.path}>{file.relPath}</span>
            {file.createdNew ? (
              <span className={styles.chipNew} title="会话内首次出现即由 Write 创建">
                新建
              </span>
            ) : null}
          </span>
          <span className={changes > 0 ? styles.count : styles.countZero} data-col="changes">
            {changes > 0 ? changes : "—"}
          </span>
          <span
            className={file.reads > 0 ? styles.count : styles.countZero}
            data-col="reads"
          >
            {file.reads > 0 ? file.reads : "—"}
          </span>
          <span className={styles.lastAt} data-col="last">
            {formatShortStamp(file.lastAt)}
          </span>
          {file.sidechainCount > 0 ? (
            <span
              className={styles.chipAgent}
              title={`其中 ${file.sidechainCount} 次成功调用由子 agent 发起`}
            >
              {`子agent ${file.sidechainCount}`}
            </span>
          ) : null}
        </button>
      </li>
      {expanded ? (
        <li className={styles.expandedRow} ref={panelMeasure}>
          <ExpandedRecords
            file={file}
            records={records}
            recordsListRef={recordsListRef}
            onCollapse={onCollapse}
            onLocateInLog={onLocateInLog}
          />
        </li>
      ) : null}
    </>
  );
}

/**
 * 展开区（手风琴体）：小结行 + 时间正序的记录清单。小结行是 firstAt 与失败数
 * 的非悬停路径（design §3.3——tooltip 非唯一通道原则）。
 */
function ExpandedRecords({
  file,
  records,
  recordsListRef,
  onCollapse,
  onLocateInLog
}: {
  file: FileActivity;
  records: SessionRecord[];
  recordsListRef: React.RefObject<HTMLUListElement>;
  /** Esc 收起（与文件列表的 Esc 同一个动作语义）。 */
  onCollapse: () => void;
  onLocateInLog: (recordId: string) => void;
}) {
  const failed = records.filter((record) => record.isError).length;
  const stamps = `首次 ${formatShortStamp(file.firstAt)} · 末次 ${formatShortStamp(file.lastAt)}`;
  const summary =
    records.length === 1 && failed === 0
      ? `1 条记录 · 首次 ${formatShortStamp(file.firstAt)}`
      : failed === records.length
        ? `${records.length} 条记录 · 全部失败 · ${stamps}`
        : failed > 0
          ? `${records.length} 条记录 · 其中 ${failed} 次失败 · ${stamps}`
          : `${records.length} 条记录 · ${stamps}`;

  const focusRecord = useCallback((index: number) => {
    recordsListRef.current
      ?.querySelector<HTMLElement>(`button[data-record-index="${index}"]`)
      ?.focus();
  }, [recordsListRef]);
  const { activeIndex, setActiveIndex, onKeyDown: onRecordsKeyDownBase } = useRowNavigation({
    count: records.length,
    onActivate: (index) => {
      const record = records[index];
      if (record) onLocateInLog(record.fullId);
    },
    focusRow: focusRecord
  });

  // 展开区在文件滚动容器内部：按键要先截在这里，否则 ↑↓ 会冒泡去移动文件行。
  // Esc 在这一层同样收起（与文件列表的 Esc 同一个动作语义）。焦点在记录按钮上
  // 时 Enter/Space 交给原生激活，不再经行导航重复回调（同文件行的处理）。
  const onRecordsKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (event.key === "Escape") {
        onCollapse();
        return;
      }
      const onButton = event.target !== event.currentTarget;
      event.stopPropagation();
      if ((event.key === "Enter" || event.key === " ") && onButton) return;
      onRecordsKeyDownBase(event);
    },
    [onCollapse, onRecordsKeyDownBase]
  );

  return (
    <div className={styles.records} data-changes-records>
      <p className={styles.summary}>{summary}</p>
      <ul ref={recordsListRef} className={styles.recordList} onKeyDown={onRecordsKeyDown}>
        {records.map((record, index) => {
          const title =
            `${formatShortStamp(record.timestamp)} · ${record.toolName ?? "工具"}` +
            (record.isError ? " · 失败，不计入计数" : "") +
            (record.isSidechain ? " · 子 agent" : "") +
            " · 点击跳回日志视图定位";
          return (
            <li key={record.fullId} className={styles.recordRowLi}>
              <button
                type="button"
                className={styles.recordRow}
                data-changes-record
                data-record-index={index}
                tabIndex={activeIndex === index ? 0 : -1}
                onClick={() => onLocateInLog(record.fullId)}
                onFocus={() => setActiveIndex(index)}
                title={title}
              >
                <span className={styles.recordTime}>{formatShortStamp(record.timestamp)}</span>
                <span className={styles.toolName}>{record.toolName}</span>
                {record.isError ? (
                  <span className={styles.failNote} title="该调用失败，不计入上方计数">
                    失败
                  </span>
                ) : null}
                {record.isSidechain ? (
                  <span
                    className={styles.chipSide}
                    title="子 agent 记录暂不能定位到日志行——点击跳回日志视图的会话现场"
                  >
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
      </ul>
    </div>
  );
}
