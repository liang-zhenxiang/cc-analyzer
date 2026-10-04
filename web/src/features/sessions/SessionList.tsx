import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { IconButton } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { Skeleton } from "../../components/Skeleton";
import { TextInput } from "../../components/TextInput";
import { sessionTitle, type SessionMeta } from "./metadataCache";
import { dateBucketLabel, formatBytes, formatRelativeTime } from "../../lib/format";
import { buildRowOffsets, computeSizedWindow } from "./virtualWindow";
import { useThresholds } from "../settings/thresholds";
import styles from "./SessionList.module.css";

type ViewMode = "timeline" | "project";

const VIEW_ITEMS: SegmentedItem<ViewMode>[] = [
  { value: "timeline", label: "时间线" },
  { value: "project", label: "项目" }
];

/** Row heights for the virtualised list; keep in sync with the CSS. */
const GROUP_ROW_HEIGHT = 32;
const SESSION_ROW_HEIGHT = 54;
const SESSION_ROW_HEIGHT_WITH_STATUS = 72;

type ListRow =
  | { kind: "group"; key: string; label: string; count: number }
  | { kind: "session"; key: string; session: SessionMeta };

/** Pending/failed metadata adds a status line under the title. */
function hasStatusLine(session: SessionMeta): boolean {
  return session.metadataStatus === "pending" || session.metadataStatus === "failed";
}

/** Newest first, with the path as a stable tie-breaker. */
function compareSessions(a: SessionMeta, b: SessionMeta): number {
  if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
  return a.path.localeCompare(b.path);
}

/**
 * Groups sessions by `keyOf`, sorts each group by recency and orders the groups
 * by their newest session, so the list never depends on scan/import order.
 */
function groupSessions(
  items: SessionMeta[],
  keyOf: (session: SessionMeta) => string
): Array<[string, SessionMeta[]]> {
  const groups = new Map<string, SessionMeta[]>();
  for (const session of items) {
    const key = keyOf(session);
    const bucket = groups.get(key);
    if (bucket) bucket.push(session);
    else groups.set(key, [session]);
  }
  return [...groups.entries()]
    .map(([key, list]) => [key, [...list].sort(compareSessions)] as [string, SessionMeta[]])
    .sort((a, b) => compareSessions(a[1][0], b[1][0]));
}

const VIEW_STORAGE_KEY = "cca-session-view";
const COLLAPSED_STORAGE_KEY = "cca-session-collapsed";

function readStoredView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "project" ? "project" : "timeline";
  } catch {
    return "timeline";
  }
}

function readStoredCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((item): item is string => typeof item === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

export function SessionList({
  sessions,
  selected,
  loading,
  error,
  progress,
  onSelect,
  onRefresh
}: {
  sessions: SessionMeta[];
  selected: SessionMeta | null;
  loading: boolean;
  error: string | null;
  progress?: { done: number; total: number } | null;
  onSelect: (session: SessionMeta) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewMode>(readStoredView);
  const [collapsed, setCollapsed] = useState<Set<string>>(readStoredCollapsed);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const containerRef = useRef<HTMLDivElement>(null);
  const { logWindowRows } = useThresholds();

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // localStorage may be unavailable; the view still works for this session.
    }
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed]));
    } catch {
      // ignore
    }
  }, [collapsed]);

  function toggleGroup(label: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return sessions
      .filter((session) => {
        return (
          !needle ||
          session.path.toLowerCase().includes(needle) ||
          (session.sessionId ?? "").toLowerCase().includes(needle) ||
          (session.cwd ?? "").toLowerCase().includes(needle)
        );
      })
      .sort(compareSessions);
  }, [sessions, search]);

  const grouped = useMemo(
    () => groupSessions(filtered, (session) => session.cwd ?? session.projectLabel),
    [filtered]
  );

  const timelineGroups = useMemo(
    () => groupSessions(filtered, (session) => dateBucketLabel(session.mtimeMs)),
    [filtered]
  );

  // Collapse keys of groups that no longer exist (deleted projects, older date
  // buckets) would otherwise pile up in localStorage forever. Keys from both
  // views are kept, so searching or switching views never drops a state.
  const knownGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const session of sessions) {
      keys.add(session.cwd ?? session.projectLabel);
      keys.add(`日期:${dateBucketLabel(session.mtimeMs)}`);
    }
    return keys;
  }, [sessions]);

  useEffect(() => {
    if (sessions.length === 0) return;
    setCollapsed((current) => {
      const next = new Set([...current].filter((key) => knownGroupKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [knownGroupKeys, sessions.length]);

  // Collapsed groups drop their sessions entirely, so one flat row list can be
  // windowed without splitting groups across the scroll container.
  const rows = useMemo<ListRow[]>(() => {
    const source = view === "timeline" ? timelineGroups : grouped;
    const list: ListRow[] = [];
    for (const [label, groupSessions] of source) {
      const key = view === "timeline" ? `日期:${label}` : label;
      list.push({ kind: "group", key, label, count: groupSessions.length });
      if (collapsed.has(key)) continue;
      for (const session of groupSessions) {
        list.push({ kind: "session", key: session.path, session });
      }
    }
    return list;
  }, [collapsed, grouped, timelineGroups, view]);

  const virtualize = rows.length > logWindowRows;
  const offsets = useMemo(
    () =>
      buildRowOffsets(
        rows.map((row) => {
          if (row.kind === "group") return GROUP_ROW_HEIGHT;
          return hasStatusLine(row.session) ? SESSION_ROW_HEIGHT_WITH_STATUS : SESSION_ROW_HEIGHT;
        })
      ),
    [rows]
  );
  const window = useMemo(
    () =>
      virtualize
        ? computeSizedWindow({ offsets, scrollTop, viewportHeight })
        : { start: 0, end: rows.length, padTop: 0, padBottom: 0 },
    [offsets, rows.length, scrollTop, viewportHeight, virtualize]
  );
  const visibleRows = virtualize ? rows.slice(window.start, window.end) : rows;

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || 480);
  }, []);

  // A new view or search means a new list; keep the scroll position honest.
  useEffect(() => {
    setScrollTop(0);
    if (containerRef.current) containerRef.current.scrollTop = 0;
  }, [search, view]);

  return (
    <aside className={styles.sidebar} aria-label="会话列表">
      <div className={styles.toolbar}>
        <span className={styles.search}>
          <Icon name="search" size={14} className={styles.searchIcon} />
          <TextInput
            value={search}
            aria-label="搜索会话"
            placeholder="搜会话 ID 或目录…"
            onChange={(event) => setSearch(event.target.value)}
          />
        </span>
        <IconButton label="刷新会话列表" onClick={onRefresh}>
          <Icon name="refresh" size={14} />
        </IconButton>
      </div>
      <SegmentedControl
        items={VIEW_ITEMS}
        value={view}
        onChange={setView}
        ariaLabel="列表视图"
        variant="equal"
        className={styles.viewTabs}
      />
      {error ? <div role="alert" className={styles.error}>{error}</div> : null}
      {/* 列表还没到 → 骨架（形状说明一切，不留可见文案）。
          这与下方「标题补全进度」是两件事：那个是列表已有、标题在补的**确定型**进度；
          两者可同时出现，互不冲突。 */}
      {loading ? <Skeleton variant="list" rows={6} label="正在加载会话列表" /> : null}
      {progress && progress.total > 0 ? (
        <div className={styles.progress} role="status" aria-label="标题补全进度">
          <span>
            正在补全标题 {progress.done}/{progress.total}
          </span>
          <progress value={progress.done} max={progress.total} />
        </div>
      ) : null}
      {!loading && filtered.length === 0 ? (
        <EmptyState title="没有匹配的会话" description="调整搜索词后重试。" />
      ) : null}

      <div className={styles.groups} ref={containerRef} onScroll={onScroll}>
        {virtualize ? <div style={{ height: window.padTop }} aria-hidden="true" /> : null}
        {visibleRows.map((row) =>
          row.kind === "group" ? (
            <div key={row.key} className={styles.groupRow}>
              <button
                type="button"
                className={styles.groupToggle}
                aria-expanded={!collapsed.has(row.key)}
                onClick={() => toggleGroup(row.key)}
              >
                <span aria-hidden="true">{collapsed.has(row.key) ? "▶" : "▼"}</span>
                <strong>{row.label}</strong>
                <span className={styles.groupCount}>{row.count}</span>
              </button>
            </div>
          ) : (
            <div
              key={row.key}
              className={hasStatusLine(row.session) ? styles.sessionRowWithStatus : styles.sessionRow}
            >
              <SessionButton
                session={row.session}
                selected={selected?.path === row.session.path}
                onSelect={onSelect}
              />
            </div>
          )
        )}
        {virtualize ? <div style={{ height: window.padBottom }} aria-hidden="true" /> : null}
      </div>
    </aside>
  );
}

function SessionButton({
  session,
  selected,
  onSelect
}: {
  session: SessionMeta;
  selected: boolean;
  onSelect: (session: SessionMeta) => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      title={session.cwd ?? session.path}
      onClick={() => onSelect(session)}
    >
      <strong>{sessionTitle(session)}</strong>
      {session.metadataStatus === "pending" ? <small>补全标题中</small> : null}
      {session.metadataStatus === "failed" ? <small>标题提取失败</small> : null}
      <span>
        {formatRelativeTime(session.mtimeMs)} · {formatBytes(session.sizeBytes)} ·{" "}
        {session.projectLabel}
      </span>
    </button>
  );
}
