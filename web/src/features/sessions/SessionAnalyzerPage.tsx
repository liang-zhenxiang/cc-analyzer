import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBridges } from "../../api/bridges";
import { useNotifications } from "../../app/NotificationProvider";
import { useSessions } from "./useSessions";
import { SessionList } from "./SessionList";
import { SessionHeader } from "./SessionHeader";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { Skeleton } from "../../components/Skeleton";
import { FilterBar } from "./FilterBar";
import { TimelineTrack } from "./TimelineTrack";
import { TokenPanel } from "./TokenPanel";
import { RecordDetailPanel } from "./RecordDetailPanel";
import { ReportPanel } from "./ReportPanel";
import { ExportDialog } from "./ExportDialog";
import { formatLabel, projectNameOf, type ExportBase, type ExportFormat } from "./exportTypes";
import { useArchiveTask } from "../archive/archiveTask";
import { formatProjectPath } from "../../lib/format";
import { TreeView } from "./TreeView";
import { LogView } from "./LogView";
import { decisionPointsOf } from "./decisionPoints";
import { ContextView, type ContextRevealRequest } from "./ContextView";
import { ChangedFilesView } from "./ChangedFilesView";
import { BleedView } from "./BleedView";
import { ReplayView } from "./ReplayView";
import { RhythmPanel } from "./RhythmPanel";
import { TimelineView } from "./TimelineView";
import { CostLedgerView } from "./CostLedgerView";
import { ParseCoverageChip } from "./ParseCoverageChip";
import { emptyFilter, type RecordFilter, type TimeRange } from "./filters";
import { parseJsonlTextAsync } from "./parseJsonl";
import { resolveSessionGraph } from "./sessionGraph";
import { createSessionParseCache, sharedSessionParseCache } from "./sessionParseCache";
import type { DurationNode } from "./durationTree";
import { buildLogRows, filterLogRows, recordsOfRows } from "./logRows";
import { useThresholds } from "../settings/thresholds";
import { countRestarts } from "./restartCount";
import { parentDirectory } from "../../lib/path";

/**
 * H5（§4.5）：重启链的时间窗——同目录上一个会话起点 24 小时内又起了新的，
 * 算「重新发起」。24h 来自规格原文（模型层 countRestarts 的 15 分钟缺省是
 * 「进程重启」粒度，UI 这层看的是「工作还在继续」的粒度，两者不共用）。
 */
const RESTART_WINDOW_MS = 24 * 60 * 60_000;
import {
  generateReport,
  reportSignature,
  ReportCancelledError,
  type ReportMode
} from "./report";
import { sessionTitle, type SessionMeta } from "./metadataCache";
import { buildBleedReport } from "./bleedModel";
import type { ParsedSession, ParsedSessionGraph, SessionRecord } from "./types";
import styles from "./SessionAnalyzerPage.module.css";

type AnalyzerView =
  | "log"
  | "tree"
  | "context"
  | "changes"
  | "bleed"
  | "replay"
  | "timeline"
  | "cost";

const ANALYZER_VIEW_ITEMS: SegmentedItem<AnalyzerView>[] = [
  { value: "log", label: "日志视图" },
  { value: "tree", label: "树视图" },
  { value: "context", label: "上下文" },
  { value: "changes", label: "改动" },
  { value: "bleed", label: "出血点" },
  { value: "replay", label: "重放" },
  // 时间轴排在重放之后：两根时间轴相邻，正好让人看到它们是两个问题
  // （「看一遍」与「跳到那儿看」），而不是同一件事的两个入口。
  { value: "timeline", label: "时间轴" },
  { value: "cost", label: "账单" }
];

const VIEW_STORAGE_KEY = "cca-analyzer-view";

function readStoredView(): AnalyzerView {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "tree" ||
      stored === "context" ||
      stored === "changes" ||
      stored === "bleed" ||
      stored === "replay" ||
      stored === "timeline" ||
      stored === "cost"
      ? stored
      : "log";
  } catch {
    return "log";
  }
}

/**
 * 侧栏每行的压缩次数，供出血点徽章使用。
 *
 * **数字必须与「出血点」标签页同源**：两边都调用 `buildBleedReport(parsed)`
 * 的 `compactionCount`。绝不在这里另数一遍 `compact_boundary`——那就是第二套
 * 口径，两边迟早漂移，而列表说 3 次、点进去显示 2 次是最坏的一种不一致。
 *
 * 之所以要「懒」：徽章要给**每个**会话算一次，而 `buildBleedReport` 需要完整
 * 解析结果。虚拟滚动只减少 DOM，不减少解析——真实会话常有数 MB，首屏为整张
 * 列表全量解析会直接冻住界面。所以先渲染无徽章，再逐个异步补齐。
 *
 * 缓存复用 `sharedSessionParseCache`（按 mtime+size 校验）：与用量页、全局搜索、
 * 脉搏共用一份解析结果，同一个文件在整站只付一次解析成本。
 */
function useBleedCounts(
  sessions: SessionMeta[],
  loading: boolean
): ReadonlyMap<string, number | undefined> {
  const bridges = useBridges();
  const [counts, setCounts] = useState<Map<string, number | undefined>>(new Map());
  const scanIdRef = useRef(0);

  const scanTarget = useMemo(() => (loading ? null : sessions), [loading, sessions]);

  useEffect(() => {
    if (!scanTarget) return;
    const scanId = ++scanIdRef.current;
    setCounts(new Map());

    const scan = async () => {
      for (const session of scanTarget) {
        if (scanIdRef.current !== scanId) return;
        // 标签页卸载后不再回写状态。
        let count: number | undefined;
        try {
          const cached = sharedSessionParseCache.get(session.path);
          const parsed =
            cached &&
            cached.mtimeMs === session.mtimeMs &&
            cached.sizeBytes === session.sizeBytes
              ? cached.session
              : await (async () => {
                  const text = await bridges.fs.readText(session.path);
                  const next = await parseJsonlTextAsync(text, session.path);
                  sharedSessionParseCache.set(session.path, {
                    mtimeMs: session.mtimeMs,
                    sizeBytes: session.sizeBytes,
                    session: next
                  });
                  return next;
                })();
          count = buildBleedReport(parsed).compactionCount;
        } catch {
          // 读不到 ≠ 没有压缩。计为 `undefined`（未知），不写 0——
          // 否则会给一个其实压缩过、只是这次没读成的会话贴上「很干净」的假标签。
          count = undefined;
        }
        if (scanIdRef.current !== scanId) return;
        setCounts((current) => {
          const next = new Map(current);
          next.set(session.path, count);
          return next;
        });
      }
    };

    void scan();
  }, [scanTarget, bridges]);

  return counts;
}

export function SessionAnalyzerPage({
  revealRequest = null,
  onRevealHandled
}: {
  /**
   * 全局搜索的跳转请求：打开该会话并定位到该记录。`recordId` 为 null 时只
   * 落到会话本身（用量页「压缩统计」的 top3 行走这条路径——那里没有具体记录）。
   */
  revealRequest?: { path: string; recordId: string | null; nonce: number } | null;
  onRevealHandled?: () => void;
} = {}) {
  const bridges = useBridges();
  const { notify } = useNotifications();
  const { sessions, loading, error, progress, refresh, indexFacts } = useSessions();
  // 侧栏徽章的数字来自与「出血点」标签页同一个 `buildBleedReport`，只是分期补齐。
  const bleedCounts = useBleedCounts(sessions, loading);
  // H5 重启计数（§4.5）：整页聚合一次，sessions 变化才重算——SessionHeader
  // 每次渲染都拿现成的 Map，不在渲染路径里重跑 O(n log n)。
  // 口径：同 cwd（parentDirectory 归一）且相邻会话起点间隔 <24h 成链；
  // 起点**代用** mtimeMs——列表侧只有它是每会话必有且对应写入时刻的时间戳
  // （SessionMeta 无首记录时间戳，代用理由写死在注释）。lead 派工说放
  // AppShell「数据就绪处」，但 AppShell 不持 sessions（本页自己 useSessions），
  // 数据在本页就绪，聚合落这里语义等价且不动 AppShell。
  const restartChains = useMemo(
    () =>
      countRestarts(
        sessions.map((session) => ({
          path: session.path,
          projectLabel: parentDirectory(session.path) ?? null,
          startTimestamp: session.mtimeMs
        })),
        RESTART_WINDOW_MS
      ),
    [sessions]
  );
  const { detailRows: reportRowLimit } = useThresholds();
  const archiveStatus = useArchiveTask().status;
  const [selectedSession, setSelectedSession] = useState<SessionMeta | null>(null);
  const [parsed, setParsed] = useState<ParsedSession | null>(null);
  const sessionRequestRef = useRef(0);
  const sessionParseCacheRef = useRef(createSessionParseCache());
  const [filter, setFilter] = useState<RecordFilter>(emptyFilter);
  const [selectedRecord, setSelectedRecord] = useState<SessionRecord | null>(null);
  // I6 决策点回顾：只过滤不改数据；切走标签页即复位（过滤态跨页会让人以为日志丢了）。
  const [decisionsOnly, setDecisionsOnly] = useState(false);
  const [graph, setGraph] = useState<ParsedSessionGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [parseProgress, setParseProgress] = useState<number | null>(null);
  const [view, setView] = useState<AnalyzerView>(readStoredView);
  // 切走日志档时复位「只看决策点」：留着过滤态再回来，会像日志少了一半。
  useEffect(() => {
    if (view !== "log") setDecisionsOnly(false);
  }, [view]);
  // 折叠是默认：面板是会话级明细，不是主流程的一部分。
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // WebKit 点按钮不给焦点（Safari 的默认行为），所以触发元素要显式记下来，
  // 关浮层时才有地方把焦点还回去。
  const exportTriggerRef = useRef<HTMLElement | null>(null);
  // 报告落款要写版本号；取不到就留空（宁可少一行信息，也不写一个假版本）。
  const [appVersion, setAppVersion] = useState("");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [reportNode, setReportNode] = useState<DurationNode | null>(null);
  const [windowOnly, setWindowOnly] = useState(false);
  const reportAbortRef = useRef<AbortController | null>(null);
  // 跳转 effect 的「只随请求发生一次」需要读取最新列表/选择而不重触发：
  // 用 ref 镜像，让 effect 的 deps 保持最小。
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [mode, setMode] = useState<ReportMode>("whole");
  const [report, setReport] = useState<{
    text: string;
    loading: boolean;
    error: string | null;
    signature: string | null;
    meta: { claudeId?: string; costUsd?: number; durationMs?: number } | null;
  }>({ text: "", loading: false, error: null, signature: null, meta: null });

  const allLogRows = useMemo(
    () => (parsed ? buildLogRows(parsed.records, parsed.turns, parsed.compactEvents ?? []) : []),
    [parsed]
  );
  const logRows = useMemo(() => filterLogRows(allLogRows, filter), [allLogRows, filter]);
  // I6：判定只做一次，行列表与标记共用同一份结果（避免两处口径漂移）。
  // buildLogRows 会把每轮首条 user 行并进「用户+LLM」行（mergedWith:"user"、
  // kind:"llm"），而决策点判据只认用户消息——喂给模型前把合并行还原成
  // user 视图。summary 不用表格摘要（它被 truncate 到 72 码位，判据的
  // escalate 阈值是 80，喂摘要会把 81 字的长追问判丢）：改取合并行 records
  // 里第一条 user 记录的完整原文（records[0] 就是 user 记录，构建时按序
  // 拼接），时间戳回退 durationMs 到轮起点。不改 logRows 本身。
  const decisions = useMemo(
    () =>
      decisionPointsOf(
        logRows.map((row) => {
          if (row.mergedWith !== "user") {
            return { kind: row.kind, summary: row.summary, timestamp: row.timestamp };
          }
          const userRecord = row.records.find((record) => record.kind === "user");
          return {
            kind: "user" as const,
            summary: userRecord?.text || row.summary.split(" · ")[0] || row.summary,
            timestamp: row.timestamp - Math.max(0, row.durationMs),
          };
        })
      ),
    [logRows]
  );
  const decisionReasons = useMemo(() => {
    const map = new Map<string, "redirect" | "escalate" | "restart">();
    for (const point of decisions) {
      const row = logRows[point.index];
      if (row) map.set(row.id, point.reason);
    }
    return map;
  }, [decisions, logRows]);
  const visibleLogRows = useMemo(
    () => (decisionsOnly ? logRows.filter((row) => decisionReasons.has(row.id)) : logRows),
    [decisionsOnly, decisionReasons, logRows]
  );
  const records = useMemo(() => recordsOfRows(logRows), [logRows]);
  const signature = parsed ? reportSignature(parsed, mode, filter, graph) : null;
  const stale = report.signature !== null && report.signature !== signature;

  /**
   * Everything the export needs except the two choices the dialog owns. Built
   * from the page's own state, so the export can never disagree with the screen:
   * `records` is the filtered set the tables are showing.
   */
  const exportBase = useMemo<ExportBase | null>(() => {
    if (!selectedSession || !parsed) return null;
    return {
      title: sessionTitle(selectedSession),
      sessionId: selectedSession.sessionId ?? parsed.sessionId,
      projectName: projectNameOf(selectedSession.cwd, selectedSession.projectLabel),
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      records,
      allRecords: parsed.records,
      // 档案（Round GG G3）要 cwd / compactEvents / 主导模型，三个都不在扁平字段里。
      parsed,
      appVersion
    };
  }, [selectedSession, parsed, records, appVersion]);

  function handleExportSaved(format: ExportFormat) {
    setExportOpen(false);
    notify(`已导出 ${formatLabel(format)}`, "success");
  }

  // 归档跑完把会话发现重跑一次：这一轮新写进索引的会话（或刚变成「已归档」
  // 的那些）要立刻出现在列表里，否则用户点完「立即归档」看不到任何变化。
  // 状态只在 running → done 的跃迁上变，所以这里不会随每次渲染重复刷新。
  useEffect(() => {
    if (archiveStatus !== "done") return;
    void refresh();
  }, [archiveStatus, refresh]);

  useEffect(() => {
    let cancelled = false;
    const pending = bridges.updater?.appVersion();
    pending
      ?.then((value) => {
        if (!cancelled) setAppVersion(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridges]);

  useEffect(() => {
    function markStale() {
      setReport((current) => (current.text ? { ...current, signature: null } : current));
    }
    window.addEventListener("resize", markStale);
    return () => window.removeEventListener("resize", markStale);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // localStorage may be unavailable; the view still works for this session.
    }
  }, [view]);

  const activate = useCallback(async (requestId: number, parsedSession: ParsedSession) => {
    setParsed(parsedSession);
    setGraph(null);
    setGraphLoading(true);
    try {
      const nextGraph = await resolveSessionGraph(parsedSession, bridges, {
        childCache: sessionParseCacheRef.current
      });
      if (sessionRequestRef.current !== requestId) return;
      setGraph(nextGraph);
      setParsed(nextGraph.root);
      setSelectedRecord((current) =>
        current
          ? nextGraph.root.records.find((record) => record.fullId === current.fullId) ?? current
          : null
      );
    } catch (cause) {
      if (sessionRequestRef.current !== requestId) return;
      setParsed(null);
      setGraph(null);
      notify(`会话图解析失败: ${String(cause)}`, "error");
    } finally {
      if (sessionRequestRef.current === requestId) setGraphLoading(false);
    }
  }, [bridges, notify]);

  /**
   * 打开会话。`targetView` 用于「点徽章直接进出血点标签」这类跨视图入口：
   * 省略则保持用户当前所在的标签（点会话行的常规路径）。
   */
  const openSession = useCallback(async (session: SessionMeta, targetView?: AnalyzerView) => {
    const requestId = ++sessionRequestRef.current;
    setSelectedSession(session);
    setSelectedRecord(null);
    setGraph(null);
    setGraphLoading(true);
    // 视图先切：它不依赖读取结果，早切一步用户就能看到标签在响应。
    // 读取失败时停在出血点标签页上是可接受的——那时主区显示失败态，不会误导。
    if (targetView) setView(targetView);

    let text: string;
    try {
      text = await bridges.fs.readText(session.path);
    } catch (cause) {
      if (sessionRequestRef.current !== requestId) return;
      setParsed(null);
      setGraph(null);
      setGraphLoading(false);
      notify(`会话读取失败: ${String(cause)}`, "error");
      return;
    }
    if (sessionRequestRef.current !== requestId) return;
    setParseProgress(0);
    try {
      const parsedSession = await parseJsonlTextAsync(text, session.path, {}, (fraction) => {
        if (sessionRequestRef.current !== requestId) return;
        setParseProgress(fraction);
      });
      if (sessionRequestRef.current !== requestId) return;
      await activate(requestId, parsedSession);
    } finally {
      if (sessionRequestRef.current === requestId) setParseProgress(null);
    }
  }, [activate, bridges, notify]);

  const enterChildSession = useCallback(async (child: ParsedSession) => {
    const requestId = ++sessionRequestRef.current;
    setSelectedSession(null);
    setSelectedRecord(null);
    await activate(requestId, child);
  }, [activate]);

  const generate = useCallback(async (
    override?: {
      filter: RecordFilter;
      mode: ReportMode;
      node?: DurationNode | null;
      session?: ParsedSession;
    }
  ) => {
    const session = override?.session ?? parsed;
    if (!session) return;
    const foreignSession = override?.session != null && override.session !== parsed;
    const nextFilter = override?.filter ?? filter;
    const nextMode = override?.mode ?? mode;
    const nextNode = override?.node ?? (nextMode === "node" ? reportNode : null);
    const baseRows = override?.session
      ? buildLogRows(session.records, session.turns, session.compactEvents ?? [])
      : allLogRows;
    const nextRows = override ? filterLogRows(baseRows, nextFilter) : logRows;
    const nextRecords = override ? recordsOfRows(nextRows) : records;
    // A child-session report is not described by the page signature; report it
    // as non-stale rather than comparing unrelated values.
    const nextSignature = foreignSession
      ? null
      : reportSignature(session, nextMode, nextFilter, graph);
    reportAbortRef.current?.abort();
    const controller = new AbortController();
    reportAbortRef.current = controller;
    setReport({ text: "", loading: true, error: null, signature: nextSignature, meta: null });
    try {
      const result = await generateReport(
        {
          session,
          records: nextRecords,
          mode: nextMode,
          filter: nextFilter,
          timeRange: nextFilter.timeRange,
          graph: graph ?? undefined,
          node: nextNode,
          rows: nextRows
        },
        bridges,
        (line) => {
          setReport((current) => ({ ...current, text: `${current.text}${line}\n` }));
        },
        controller.signal
      );
      setReport({
        text: result.text,
        loading: false,
        error: null,
        signature: nextSignature,
        meta: {
          claudeId: result.claudeId,
          costUsd: result.costUsd,
          durationMs: result.durationMs
        }
      });
    } catch (cause) {
      if (cause instanceof ReportCancelledError) {
        setReport((current) => ({
          ...current,
          loading: false,
          error: null,
          signature: null
        }));
        return;
      }
      setReport((current) => ({
        ...current,
        loading: false,
        error: `分析失败: ${String(cause)}`
      }));
    } finally {
      if (reportAbortRef.current === controller) reportAbortRef.current = null;
    }
  }, [bridges, filter, graph, mode, parsed, records, reportNode]);

  const cancelReport = useCallback(() => {
    reportAbortRef.current?.abort();
  }, []);

  const analyzeNode = useCallback((node: DurationNode) => {
    const segments = node.segments ?? [];
    if (segments.length === 0) return;
    let start = Math.min(...segments.map((segment) => segment.start));
    let end = Math.max(...segments.map((segment) => segment.end));
    if (windowOnly && filter.timeRange) {
      start = Math.max(start, filter.timeRange.start);
      end = Math.min(end, filter.timeRange.end);
    }
    if (!(end > start)) return;
    const timeRange: TimeRange = { start, end };
    const nextFilter = { ...filter, timeRange };
    setFilter(nextFilter);
    setMode("node");
    setReportNode(node);
    const child = node.kind === "agent" ? node.childSession : undefined;
    void generate({
      filter: nextFilter,
      mode: "node",
      node,
      ...(child ? { session: child } : {})
    });
  }, [filter, generate, windowOnly]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = window.setTimeout(() => setHighlightId(null), 1600);
    return () => window.clearTimeout(timer);
  }, [highlightId]);

  const locateInTree = useCallback((recordId: string) => {
    setView("tree");
    setHighlightId(recordId);
  }, []);

  const locateInLog = useCallback((recordId: string) => {
    setView("log");
    setHighlightId(recordId);
  }, []);

  // 「在上下文视图定位」（压缩带行 / 详情面板）：切标签并选中该压缩事件。
  // nonce 让同一事件可被重复定位；选中态本身仍住在 ContextView 里。
  const [contextReveal, setContextReveal] = useState<ContextRevealRequest | null>(null);
  const locateInContext = useCallback((eventId: string) => {
    setView("context");
    setContextReveal({ eventId, nonce: Date.now() });
  }, []);

  // 全局搜索跳转，拆成两个职责单一的 effect——「打开会话」与「定位记录」。
  // 混在一个 effect 里让 openSession 依赖进 deps，会被回调身份抖动反复
  // 触发（实测在真实键盘事件下变成同步重入风暴）；拆开后各自天然幂等：
  // 打开只随请求发生一次，定位只在记录就绪时发生一次。
  useEffect(() => {
    if (!revealRequest) return;
    if (selectedSessionRef.current?.path === revealRequest.path) return;
    const target = sessionsRef.current.find((item) => item.path === revealRequest.path);
    if (target) {
      void openSession(target);
    } else if (!loading) {
      // 列表已就绪却没有该会话：请求无法兑现，清掉它，不留在悬挂态。
      onRevealHandled?.();
    }
    // `sessions`/`loading` 进 deps 是刻意的：从用量页/搜索浮层跨标签跳转时
    // 分析页刚重新挂载、列表还没回来——请求必须等列表就绪才能找得到会话。
  }, [revealRequest, openSession, onRevealHandled, sessions, loading]);

  useEffect(() => {
    if (!revealRequest) return;
    if (selectedSession?.path !== revealRequest.path) return;
    // 会话级跳转（recordId 为 null）：会话已开即完成，不再找记录。
    if (revealRequest.recordId === null) {
      onRevealHandled?.();
      return;
    }
    const record = parsed?.records.find((item) => item.fullId === revealRequest.recordId);
    if (record) {
      locateInLog(record.fullId);
      setSelectedRecord(record);
      onRevealHandled?.();
    }
  }, [revealRequest, selectedSession, parsed, locateInLog, onRevealHandled]);

  function revealRecord(recordId: string) {
    const record = parsed?.records.find((item) => item.fullId === recordId);
    if (record) setSelectedRecord(record);
  }

  const parsing = parseProgress !== null && parseProgress < 1;

  /**
   * 扫描失败、主区又没别的东西可显示。
   *
   * 这时错误由**主区**整页说明（它才是眼下这块屏幕的主体），侧栏不再重复一遍——
   * 一次失败只在一个地方说。反过来，已经有会话打开时主区在展示数据，
   * 错误就该落在侧栏那条告警上：那里才是它发生的地方。
   */
  const scanFailedHere = error !== null && !parsed;

  return (
    <div className={`${styles.page} ${selectedRecord ? styles.withDetail : ""}`}>
      {selectedSession ? (
        <SessionHeader
          session={selectedSession}
          parsed={parsed}
          tokenPanelOpen={tokenPanelOpen}
          onToggleTokenPanel={() => setTokenPanelOpen((open) => !open)}
          onOpenFolder={(path) => void bridges.system.openFolder(path)}
          onExport={(trigger) => {
            exportTriggerRef.current = trigger;
            setExportOpen(true);
          }}
          clipboard={bridges.clipboard}
          restartCount={restartChains.get(selectedSession.path)}
        />
      ) : null}
      <div className={styles.body}>
        <SessionList
          sessions={sessions}
          selected={selectedSession}
          loading={loading}
          error={error}
          errorShownElsewhere={scanFailedHere}
          progress={progress}
          bleedCounts={bleedCounts}
          onSelect={(session) => void openSession(session)}
          onOpenBleed={(session) => void openSession(session, "bleed")}
          onRefresh={() => void refresh()}
          onEnsureFacts={() => void indexFacts()}
        />
        <div className={styles.workspace}>
          {!parsed ? (
            parsing ? (
              // 解析期间工作区里还没有表格，用表格剪影占住它将要出现的形状；
              // 上方保留确定型进度——剪影说「有内容要来」，百分比说「还差多远」，
              // 两者不冲突，砍掉数字才是丢信息。
              <div className={styles.parsing}>
                <div className={styles.parseProgress} role="status">
                  正在解析会话 {Math.round((parseProgress ?? 0) * 100)}%
                </div>
                <Skeleton variant="table" rows={8} label="正在解析会话" />
              </div>
            ) : scanFailedHere ? (
              // 扫描失败时主区不说「从左侧列表挑一个会话」——列表根本没读到，
              // 那是一个做不到的建议，而且与侧栏的失败态同屏自相矛盾。
              <ErrorState
                size="page"
                title="会话列表读取失败"
                hint="本机 ~/.claude/projects 里的会话没能读出来。确认目录可读后重试。"
                detail={error ?? undefined}
                onRetry={() => void refresh()}
              />
            ) : (
              <EmptyState
                size="page"
                title="选择一个会话开始分析"
                description="从左侧列表挑一个会话，或先在搜索框里按会话 ID、目录筛选。"
              />
            )
          ) : (
            <>
              {/* 会话级的东西排在时间线之上：成本/计数是会话的属性，
                  时间线是会话内部的东西，层级由位置表达。 */}
              {tokenPanelOpen ? (
                <TokenPanel records={parsed.records} isSubagent={parsed.isSubagent} />
              ) : null}
              {/* 上下文 / 改动 / 出血点 / 重放 / 账单标签页不渲染时间线与筛选：五者的口径
                  都是会话级全量（压缩取证 =「压缩点之前全部消息 − 幸存清单」；改动清单 =
                  「通过文件工具动过的文件」；出血点 =「每条消息在压缩时的 token 归属」；
                  重放 =「整段会话按墙钟压成一条胶片」；账单 =「本次会话四类 token 的账」），
                  记录级筛选会让口径漂移（context design §2.1/§9-5，changes 裁决 #2、
                  bleed design §2 同款理由，replay design §1、cost design §2.1：账单只对
                  整场会话求和，筛选后的金额不是这张收据的钱）。 */}
              {view === "context" ||
              view === "changes" ||
              view === "bleed" ||
              view === "replay" ||
              view === "timeline" ||
              view === "cost" ? null : (
                <>
                  <TimelineTrack
                    session={parsed}
                    selection={filter.timeRange}
                    onSelect={(timeRange) => setFilter({ ...filter, timeRange })}
                    onReveal={revealRecord}
                  />
                  <FilterBar
                    filter={filter}
                    onChange={setFilter}
                    actions={
                      view === "log" && decisions.length > 0 ? (
                        <button
                          type="button"
                          className={styles.decisionToggle}
                          aria-pressed={decisionsOnly}
                          aria-label={`只看决策点，共 ${decisions.length} 个`}
                          data-probe="decisions-only"
                          onClick={() => setDecisionsOnly((value) => !value)}
                        >
                          只看决策点（{decisions.length}）
                        </button>
                      ) : undefined
                    }
                  />
                </>
              )}
              <div className={styles.viewBar}>
                <SegmentedControl
                  items={ANALYZER_VIEW_ITEMS}
                  value={view}
                  onChange={setView}
                  ariaLabel="视图切换"
                />
                <div className={styles.graphStatus} role="status" aria-label="会话图状态">
                  {graphLoading
                    ? "会话图加载中…"
                    : graph
                      ? `会话图已加载 · ${graph.sessions.length} 个会话${graph.warnings.length ? ` · ${graph.warnings.length} 个警告` : ""}`
                      : ""}
                </div>
                {/* 解析覆盖率（design §5）：与「会话图状态」同一层——都在回答
                    「这次解析可信吗」。M=0 时什么都不渲染（全部解析是默认期望）。 */}
                {parsed.parseCoverage ? (
                  <ParseCoverageChip
                    coverage={parsed.parseCoverage}
                    sessionLabel={
                      selectedSession
                        ? formatProjectPath(selectedSession.projectLabel, selectedSession.cwd)
                        : parsed.sessionId
                    }
                    clipboard={bridges.clipboard}
                  />
                ) : null}
              </div>
              <div className={styles.pane}>
                {view === "log" ? (
                  <>
                    {decisionsOnly ? (
                      <p
                        className={styles.decisionBanner}
                        role="status"
                        data-probe="decisions-banner"
                        title="只保留 user 消息里被判定为转折（重做）、加码（长追问）或换题（长间隔后的新指令）的帧。"
                      >
                        {`已滤出 ${decisions.length} 个决策点。`}
                      </p>
                    ) : null}
                    <LogView
                      rows={visibleLogRows}
                      decisionReasons={decisionReasons}
                      selectedId={selectedRecord?.fullId ?? null}
                      highlightId={highlightId}
                      timeRange={filter.timeRange}
                      onSelect={setSelectedRecord}
                      onLocateInTree={locateInTree}
                      onLocateInContext={locateInContext}
                    />
                  </>
                ) : view === "tree" ? (
                  <TreeView
                    session={parsed}
                    graph={graph}
                    selection={filter.timeRange}
                    selectedId={selectedRecord?.fullId ?? null}
                    highlightId={highlightId}
                    onSelect={setSelectedRecord}
                    onAnalyze={analyzeNode}
                    onEnterChildSession={(child) => void enterChildSession(child)}
                    onLocateInLog={locateInLog}
                    windowOnly={windowOnly}
                    onWindowOnlyChange={setWindowOnly}
                  />
                ) : view === "changes" ? (
                  <ChangedFilesView parsed={parsed} onLocateInLog={locateInLog} />
                ) : view === "bleed" ? (
                  <BleedView parsed={parsed} />
                ) : view === "replay" ? (
                  <>
                    <ReplayView parsed={parsed} />
                    {/* H4 节奏谱：重放讲「发生了什么」，这块讲「隔多久提问一次」。
                        同一时间轴两层聚合，跟在胶片带后面就是它的位置。 */}
                    <RhythmPanel parsed={parsed} />
                  </>
                ) : view === "timeline" ? (
                  <TimelineView parsed={parsed} onLocateInLog={locateInLog} />
                ) : view === "cost" ? (
                  <CostLedgerView parsed={parsed} onLocateInLog={locateInLog} />
                ) : (
                  <ContextView
                    parsed={parsed}
                    onLocateInLog={locateInLog}
                    revealEventRequest={contextReveal}
                  />
                )}
              </div>
              <div className={styles.reportPane}>
                <ReportPanel
                  text={report.text}
                  loading={report.loading}
                  error={report.error}
                  stale={stale}
                  mode={mode}
                  onModeChange={setMode}
                  onGenerate={() => void generate()}
                  onCancel={cancelReport}
                  onClear={() =>
                    setReport({ text: "", loading: false, error: null, signature: null, meta: null })
                  }
                  bridges={bridges}
                  defaultName={`${parsed.sessionId.slice(0, 8)}-${mode}.md`}
                  nodeLabel={reportNode?.label ?? null}
                  meta={report.meta}
                  truncated={{
                    shown: Math.min(records.length, reportRowLimit),
                    total: records.length,
                    limit: reportRowLimit
                  }}
                  onOpenTerminal={
                    parsed
                      ? () => void bridges.system.openClaudeTerminal(parsed.sessionId)
                      : undefined
                  }
                />
              </div>
            </>
          )}
        </div>
        {selectedRecord ? (
          <RecordDetailPanel
            record={selectedRecord}
            graphWarnings={graph?.warnings}
            clipboard={bridges.clipboard}
            system={bridges.system}
            onLocate={locateInTree}
            onLocateInContext={locateInContext}
            onClose={() => setSelectedRecord(null)}
            onSelectChild={setSelectedRecord}
            sessionId={parsed?.sessionId}
            sessionPath={parsed?.path}
          />
        ) : null}
      </div>
      {/* 浮层挂在页面根部：position: fixed 让它脱离文档流，而 .page → .body →
          .workspace 链路上没有 transform/filter，不会被拉进某个包含块。 */}
      {exportOpen && exportBase ? (
        <ExportDialog
          input={exportBase}
          clipboard={bridges.clipboard}
          dialog={bridges.dialog}
          opener={exportTriggerRef.current}
          onClose={() => setExportOpen(false)}
          onSaved={handleExportSaved}
        />
      ) : null}
    </div>
  );
}
