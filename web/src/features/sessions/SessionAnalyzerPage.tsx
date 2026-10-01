import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBridges } from "../../api/bridges";
import { useNotifications } from "../../app/NotificationProvider";
import { useSessions } from "./useSessions";
import { SessionList } from "./SessionList";
import { SessionHeader } from "./SessionHeader";
import { EmptyState } from "../../components/EmptyState";
import { FilterBar } from "./FilterBar";
import { TimelineTrack } from "./TimelineTrack";
import { TokenPanel } from "./TokenPanel";
import { RecordDetailPanel } from "./RecordDetailPanel";
import { ReportPanel } from "./ReportPanel";
import { TreeView } from "./TreeView";
import { LogView } from "./LogView";
import { emptyFilter, type RecordFilter, type TimeRange } from "./filters";
import { parseJsonlTextAsync } from "./parseJsonl";
import { resolveSessionGraph } from "./sessionGraph";
import { createSessionParseCache } from "./sessionParseCache";
import type { DurationNode } from "./durationTree";
import { buildLogRows, filterLogRows, recordsOfRows } from "./logRows";
import { useThresholds } from "../settings/thresholds";
import {
  generateReport,
  reportSignature,
  ReportCancelledError,
  type ReportMode
} from "./report";
import type { SessionMeta } from "./metadataCache";
import type { ParsedSession, ParsedSessionGraph, SessionRecord } from "./types";
import styles from "./SessionAnalyzerPage.module.css";

type AnalyzerView = "log" | "tree";

const VIEW_STORAGE_KEY = "cca-analyzer-view";

function readStoredView(): AnalyzerView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "tree" ? "tree" : "log";
  } catch {
    return "log";
  }
}

export function SessionAnalyzerPage() {
  const bridges = useBridges();
  const { notify } = useNotifications();
  const { sessions, loading, error, progress, refresh } = useSessions();
  const { detailRows: reportRowLimit } = useThresholds();
  const [selectedSession, setSelectedSession] = useState<SessionMeta | null>(null);
  const [parsed, setParsed] = useState<ParsedSession | null>(null);
  const sessionRequestRef = useRef(0);
  const sessionParseCacheRef = useRef(createSessionParseCache());
  const [filter, setFilter] = useState<RecordFilter>(emptyFilter);
  const [selectedRecord, setSelectedRecord] = useState<SessionRecord | null>(null);
  const [graph, setGraph] = useState<ParsedSessionGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [parseProgress, setParseProgress] = useState<number | null>(null);
  const [view, setView] = useState<AnalyzerView>(readStoredView);
  // 折叠是默认：面板是会话级明细，不是主流程的一部分。
  const [tokenPanelOpen, setTokenPanelOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [reportNode, setReportNode] = useState<DurationNode | null>(null);
  const [windowOnly, setWindowOnly] = useState(false);
  const reportAbortRef = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<ReportMode>("whole");
  const [report, setReport] = useState<{
    text: string;
    loading: boolean;
    error: string | null;
    signature: string | null;
    meta: { claudeId?: string; costUsd?: number; durationMs?: number } | null;
  }>({ text: "", loading: false, error: null, signature: null, meta: null });

  const allLogRows = useMemo(
    () => (parsed ? buildLogRows(parsed.records, parsed.turns) : []),
    [parsed]
  );
  const logRows = useMemo(() => filterLogRows(allLogRows, filter), [allLogRows, filter]);
  const records = useMemo(() => recordsOfRows(logRows), [logRows]);
  const signature = parsed ? reportSignature(parsed, mode, filter, graph) : null;
  const stale = report.signature !== null && report.signature !== signature;

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

  const openSession = useCallback(async (session: SessionMeta) => {
    const requestId = ++sessionRequestRef.current;
    setSelectedSession(session);
    setSelectedRecord(null);
    setGraph(null);
    setGraphLoading(true);

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
    const baseRows = override?.session ? buildLogRows(session.records, session.turns) : allLogRows;
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

  function revealRecord(recordId: string) {
    const record = parsed?.records.find((item) => item.fullId === recordId);
    if (record) setSelectedRecord(record);
  }

  const parsing = parseProgress !== null && parseProgress < 1;

  return (
    <div className={`${styles.page} ${selectedRecord ? styles.withDetail : ""}`}>
      {selectedSession ? (
        <SessionHeader
          session={selectedSession}
          parsed={parsed}
          tokenPanelOpen={tokenPanelOpen}
          onToggleTokenPanel={() => setTokenPanelOpen((open) => !open)}
          onOpenFolder={(path) => void bridges.system.openFolder(path)}
        />
      ) : null}
      <div className={styles.body}>
        <SessionList
          sessions={sessions}
          selected={selectedSession}
          loading={loading}
          error={error}
          progress={progress}
          onSelect={(session) => void openSession(session)}
          onRefresh={() => void refresh()}
        />
        <div className={styles.workspace}>
          {!parsed ? (
            <EmptyState
              size="page"
              title={
                parsing
                  ? `正在解析会话… ${Math.round((parseProgress ?? 0) * 100)}%`
                  : "选择一个会话开始分析"
              }
              description={
                parsing ? undefined : "从左侧列表挑一个会话，或先在搜索框里按会话 ID、目录筛选。"
              }
            />
          ) : (
            <>
              {/* 会话级的东西排在时间线之上：成本/计数是会话的属性，
                  时间线是会话内部的东西，层级由位置表达。 */}
              {tokenPanelOpen ? (
                <TokenPanel records={parsed.records} isSubagent={parsed.isSubagent} />
              ) : null}
              <TimelineTrack
                session={parsed}
                selection={filter.timeRange}
                onSelect={(timeRange) => setFilter({ ...filter, timeRange })}
                onReveal={revealRecord}
              />
              <FilterBar filter={filter} onChange={setFilter} />
              <div className={styles.viewBar}>
                <div className={styles.viewTabs} role="tablist" aria-label="视图切换">
                  {(["log", "tree"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={view === value}
                      onClick={() => setView(value)}
                    >
                      {value === "log" ? "日志视图" : "树视图"}
                    </button>
                  ))}
                </div>
                <div className={styles.graphStatus} role="status" aria-label="会话图状态">
                  {graphLoading
                    ? "会话图加载中…"
                    : graph
                      ? `会话图已加载 · ${graph.sessions.length} 个会话${graph.warnings.length ? ` · ${graph.warnings.length} 个警告` : ""}`
                      : ""}
                </div>
              </div>
              <div className={styles.pane}>
                {view === "log" ? (
                  <LogView
                    rows={logRows}
                    selectedId={selectedRecord?.fullId ?? null}
                    highlightId={highlightId}
                    timeRange={filter.timeRange}
                    onSelect={setSelectedRecord}
                    onLocateInTree={locateInTree}
                  />
                ) : (
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
            onClose={() => setSelectedRecord(null)}
            onSelectChild={setSelectedRecord}
            sessionId={parsed?.sessionId}
            sessionPath={parsed?.path}
          />
        ) : null}
      </div>
    </div>
  );
}
