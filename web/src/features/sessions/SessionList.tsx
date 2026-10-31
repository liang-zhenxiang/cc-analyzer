import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { Button, IconButton } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Icon } from "../../components/Icon";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { Skeleton } from "../../components/Skeleton";
import { TextInput } from "../../components/TextInput";
import { sessionTitle, type SessionMeta } from "./metadataCache";
import { SessionQueryBar } from "./SessionQueryBar";
import { matchesSessionFacts, type SessionQuery } from "../usage/sessionQuery";
import { PinButton } from "./PinButton";
import {
  PINNED_STORAGE_KEY,
  parsePinnedPaths,
  partitionPinned,
  prunePinnedPaths
} from "./pinSessions";
import {
  dateBucketLabel,
  formatBytes,
  formatProjectPath,
  formatRelativeTime
} from "../../lib/format";
import { buildRowOffsets, computeSizedWindow } from "./virtualWindow";
import { useThresholds } from "../settings/thresholds";
import { useFontScale } from "../settings/fontScale";
import styles from "./SessionList.module.css";

type ViewMode = "timeline" | "project";

const VIEW_ITEMS: SegmentedItem<ViewMode>[] = [
  { value: "timeline", label: "时间线" },
  { value: "project", label: "项目" }
];

/** Row heights for the virtualised list at 100%; the CSS scales them by --font-scale. */
const GROUP_ROW_HEIGHT = 32;
const SESSION_ROW_HEIGHT = 54;
const SESSION_ROW_HEIGHT_WITH_STATUS = 72;

/** 生效条件数（与 SessionQueryBar 的徽标同口径：一个条件算一项）。 */
function activeConditions(query: SessionQuery): number {
  let count = 0;
  if (query.projects && query.projects.length > 0) count += 1;
  if (query.models && query.models.length > 0) count += 1;
  if (query.toolKey !== undefined) count += 1;
  if (query.hasError !== undefined) count += 1;
  if (query.minContextPeak !== undefined) count += 1;
  if (query.minDurationMin !== undefined) count += 1;
  return count;
}

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
/** 置顶会话合成分组的键与标题；与真实分组名/`日期:` 键区分开。 */
const PINNED_GROUP_KEY = "置顶";

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

function readStoredPinned(): Set<string> {
  try {
    return new Set(parsePinnedPaths(localStorage.getItem(PINNED_STORAGE_KEY)));
  } catch {
    // localStorage 不可用（隐私模式/配额）时置顶退回「本次会话为空」。
    return new Set();
  }
}

export function SessionList({
  sessions,
  selected,
  loading,
  error,
  errorShownElsewhere = false,
  progress,
  onEnsureFacts,
  bleedCounts,
  onSelect,
  onOpenBleed,
  onRefresh
}: {
  sessions: SessionMeta[];
  selected: SessionMeta | null;
  loading: boolean;
  error: string | null;
  /**
   * 这次失败已经由调用方在别处（主区整页）说明过了。
   *
   * 只影响那一条告警条要不要画——`error` 仍然是事实，空态照样因此不出现。
   * 一次失败只在一个地方说：两处同时报同一条错，用户会先问「为什么说两遍」。
   */
  errorShownElsewhere?: boolean;
  progress?: { done: number; total: number } | null;
  /** 第一次展开筛选条件栏时补索引事实（G2，懒加载；可选）。 */
  onEnsureFacts?: () => void;
  /**
   * 每个会话的压缩次数，键是 `SessionMeta.path`。
   *
   * **三态，不要折叠**：`undefined` = 还没算出来（懒加载仍在跑）或读取失败，
   * `0` = 算出来确实是「没有压缩」，`> 0` = 压缩了多少次。
   *
   * `undefined` 与 `0` 在数据层是不同的值，即便两者眼下都不渲染徽章：
   * 合并它们等于把「不知道」说成「没有」，而这两件事对用户的含义相反——
   * 将来要显示「检查中」时，折叠过的类型就再也分不出来了。
   *
   * 数字必须来自 `buildBleedReport(parsed).compactionCount`，与详情页同源；
   * 列表侧**不许**自己数一遍压缩事件（那就是第二套口径）。
   */
  bleedCounts?: ReadonlyMap<string, number | undefined>;
  onSelect: (session: SessionMeta) => void;
  /** 打开该会话并切到「出血点」标签；缺省时徽章退化为普通选中。 */
  onOpenBleed?: (session: SessionMeta) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  // G2 条件只在本次会话内有效：它们描述「我现在想找什么」，不是长期偏好。
  const [query, setQuery] = useState<SessionQuery>({});
  const [view, setView] = useState<ViewMode>(readStoredView);
  const [collapsed, setCollapsed] = useState<Set<string>>(readStoredCollapsed);
  const [pinned, setPinned] = useState<Set<string>>(readStoredPinned);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const containerRef = useRef<HTMLDivElement>(null);
  const { logWindowRows } = useThresholds();
  // 行高按界面字号缩放；CSS 侧同乘 --font-scale，两边必须逐档一致。
  const fontScale = useFontScale();
  const groupRowHeight = Math.round(GROUP_ROW_HEIGHT * fontScale);
  const sessionRowHeight = Math.round(SESSION_ROW_HEIGHT * fontScale);
  const sessionRowHeightWithStatus = Math.round(SESSION_ROW_HEIGHT_WITH_STATUS * fontScale);

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

  useEffect(() => {
    try {
      localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...pinned]));
    } catch {
      // 置顶是便利功能：写不进存储也不影响本次会话的使用。
    }
  }, [pinned]);

  function toggleGroup(label: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function togglePin(path: string) {
    setPinned((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const queryActive = activeConditions(query);

  const filtered = useMemo(() => {
    const needle = search.toLowerCase().trim();
    return sessions
      .filter((session) => {
        if (
          needle &&
          !session.path.toLowerCase().includes(needle) &&
          !(session.sessionId ?? "").toLowerCase().includes(needle) &&
          !(session.cwd ?? "").toLowerCase().includes(needle)
        ) {
          return false;
        }
        // 没有条件时，未索引会话照常显示（它只是还不能被筛）；有条件时，
        // 没有事实就没有证据——不参与，也不假装它不匹配。
        if (queryActive === 0) return true;
        if (!session.facts) return false;
        return matchesSessionFacts({ projectLabel: session.projectLabel, facts: session.facts }, query);
      })
      .sort(compareSessions);
  }, [sessions, search, query, queryActive]);

  // 置顶只是把已排序的结果稳定地提到最前；两种视图（时间线/项目）都先
  // 在置顶组里出现，再从各自的剩余会话里分组。
  const ordered = useMemo(
    () => partitionPinned(filtered, (session) => pinned.has(session.path)),
    [filtered, pinned]
  );
  const pinnedSessions = useMemo(
    () => ordered.filter((session) => pinned.has(session.path)),
    [ordered, pinned]
  );
  const unpinnedSessions = useMemo(
    () => ordered.filter((session) => !pinned.has(session.path)),
    [ordered, pinned]
  );

  const grouped = useMemo(
    () => groupSessions(unpinnedSessions, (session) => session.cwd ?? session.projectLabel),
    [unpinnedSessions]
  );

  const timelineGroups = useMemo(
    () => groupSessions(unpinnedSessions, (session) => dateBucketLabel(session.mtimeMs)),
    [unpinnedSessions]
  );

  // 扫描结果里已经没有的会话（被删除/移动）不该永远占着置顶位。
  const knownPaths = useMemo(
    () => new Set(sessions.map((session) => session.path)),
    [sessions]
  );

  useEffect(() => {
    if (sessions.length === 0) return;
    setPinned((current) => {
      const next = prunePinnedPaths(current, knownPaths);
      return next.size === current.size ? current : next;
    });
  }, [knownPaths, sessions.length]);

  // Collapse keys of groups that no longer exist (deleted projects, older date
  // buckets) would otherwise pile up in localStorage forever. Keys from both
  // views are kept, so searching or switching views never drops a state.
  const knownGroupKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const session of sessions) {
      keys.add(session.cwd ?? session.projectLabel);
      keys.add(`日期:${dateBucketLabel(session.mtimeMs)}`);
    }
    // 置顶组只在有置顶会话时存在；空组消失后折叠键也一并回收。
    if (pinned.size > 0) keys.add(PINNED_GROUP_KEY);
    return keys;
  }, [sessions, pinned.size]);

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
    const list: ListRow[] = [];
    if (pinnedSessions.length > 0) {
      list.push({
        kind: "group",
        key: PINNED_GROUP_KEY,
        label: PINNED_GROUP_KEY,
        count: pinnedSessions.length
      });
      if (!collapsed.has(PINNED_GROUP_KEY)) {
        for (const session of pinnedSessions) {
          list.push({ kind: "session", key: session.path, session });
        }
      }
    }
    const source = view === "timeline" ? timelineGroups : grouped;
    for (const [label, groupSessions] of source) {
      const key = view === "timeline" ? `日期:${label}` : label;
      list.push({ kind: "group", key, label, count: groupSessions.length });
      if (collapsed.has(key)) continue;
      for (const session of groupSessions) {
        list.push({ kind: "session", key: session.path, session });
      }
    }
    return list;
  }, [collapsed, grouped, pinnedSessions, timelineGroups, view]);

  const virtualize = rows.length > logWindowRows;
  const offsets = useMemo(
    () =>
      buildRowOffsets(
        rows.map((row) => {
          if (row.kind === "group") return groupRowHeight;
          return hasStatusLine(row.session) ? sessionRowHeightWithStatus : sessionRowHeight;
        })
      ),
    [rows, groupRowHeight, sessionRowHeight, sessionRowHeightWithStatus]
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
      <SessionQueryBar
        sessions={sessions}
        query={query}
        onChange={setQuery}
        onExpand={onEnsureFacts}
      />
      {/* 出错时只说「什么失败了 + 下一步」，原始错误串收进「详情」。
          它过去被直接当成正文渲染，连同 `/Users/…` 与夹具说明一起端到用户面前。 */}
      {error && !errorShownElsewhere ? (
        <ErrorState
          size="inline"
          title="会话列表读取失败"
          hint="确认本机 ~/.claude/projects 可读后重试。"
          detail={error}
          onRetry={onRefresh}
        />
      ) : null}
      {/* 列表还没到 → 骨架（形状说明一切，不留可见文案）。
          这与下方「标题补全进度」是两件事：那个是列表已有、标题在补的**确定型**进度；
          两者可同时出现，互不冲突。 */}
      {loading ? <Skeleton variant="list" rows={6} label="正在加载会话列表" /> : null}
      {progress && progress.total > 0 ? (
        <div className={styles.progress} role="status" aria-label="建立索引进度">
          <span>
            正在建立索引 {progress.done}/{progress.total}
          </span>
          <progress value={progress.done} max={progress.total} />
        </div>
      ) : null}
      {/* 错误与「没有匹配」不能同屏：扫描失败时列表本来就是空的，
          再说「调整搜索词后重试」是在给一个错的建议。 */}
      {!loading && !error && filtered.length === 0 ? (
        queryActive > 0 ? (
          <EmptyState
            title="没有符合全部条件的会话"
            description="试试去掉一个条件，或清空全部筛选。"
            action={
              <Button type="button" variant="secondary" onClick={() => setQuery({})}>
                {`清空 ${queryActive} 个条件`}
              </Button>
            }
          />
        ) : (
          <EmptyState title="没有匹配的会话" description="调整搜索词后重试。" />
        )
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
                bleedCount={bleedCounts?.get(row.session.path)}
                pinned={pinned.has(row.session.path)}
                onTogglePin={togglePin}
                onSelect={onSelect}
                onOpenBleed={onOpenBleed}
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
  bleedCount,
  pinned,
  onTogglePin,
  onSelect,
  onOpenBleed
}: {
  session: SessionMeta;
  selected: boolean;
  /** 压缩次数；`undefined` 表示尚未算出或读取失败，两者都不渲染徽章。 */
  bleedCount: number | undefined;
  /** 是否已置顶；决定图钉实心与 `aria-pressed`。 */
  pinned: boolean;
  onTogglePin: (path: string) => void;
  onSelect: (session: SessionMeta) => void;
  onOpenBleed?: (session: SessionMeta) => void;
}) {
  // `0` 与 `undefined` 都不画徽章，但原因不同（「确认没有」vs「还不知道」）。
  // 只渲染 > 0：用「0」占满列表是一条噪音，不是信息。
  const showBleed = typeof bleedCount === "number" && Number.isFinite(bleedCount) && bleedCount > 0;
  return (
    /* 行的本体是 `role="button"` 的 <div>，不是 <button>——因为出血点徽章是一个**真的
       <button>**，而按钮不能嵌按钮（React 会报 validateDOMNesting，HTML 里也是非法结构）。
       把外层降级成 role=button 之后，徽章就可以是货真价实的按钮（自带焦点与激活语义），
       而不必用 role="button" 在一个 <button> 里伪造第二个按钮。
       代价：<div> 没有原生按钮的键盘行为，所以下面手工补齐 Enter / Space。 */
    <div
      role="button"
      tabIndex={0}
      aria-current={selected}
      title={session.cwd ?? session.path}
      className={styles.sessionButton}
      onClick={() => onSelect(session)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        // Space 在原生按钮上不滚页；这里要显式挡掉默认滚动。
        event.preventDefault();
        onSelect(session);
      }}
    >
      {/* 标题与归档徽标内联在一行，不新增 grid 行——行高 54px 由虚拟滚动镜像。 */}
      <span className={styles.titleLine}>
        <strong>{sessionTitle(session)}</strong>
        {session.archived ? (
          /* `data-archive-badge` 是给真机探针的稳定锚点：徽标文案会改，
             CSS Module 的类名带哈希，只有数据属性两头都不动。 */
          <span className={styles.archiveTag} data-archive-badge title="来自本地归档副本">
            归档<span className={styles.srOnly}>，来自本地归档副本</span>
          </span>
        ) : null}
        {showBleed ? (
          /* 点徽章进「出血点」标签，点行的其余部分照旧打开会话并留在当前标签。
             `data-bleed-badge` 与 `data-archive-badge` 同理，是给真机探针的稳定锚点；
             文案里的数字会变，数据属性不会。
             无 `onOpenBleed` 时**不渲染**它：徽章不再有独立动作，加它只会白添一个 tab 停靠点。 */
          <button
            type="button"
            className={styles.bleedTag}
            data-bleed-badge
            aria-label={`打开出血点标签，${bleedCount} 次压缩`}
            title={`本会话发生 ${bleedCount} 次压缩，打开出血点标签`}
            onClick={(event) => {
              event.stopPropagation();
              if (onOpenBleed) onOpenBleed(session);
              else onSelect(session);
            }}
          >
            {/* 视觉上只说数字，完整含义留给 aria-label——列表一行装不下整句。 */}
            {bleedCount} 次压缩
          </button>
        ) : null}
      </span>
      {session.metadataStatus === "pending" ? <small>补全标题中</small> : null}
      {session.metadataStatus === "failed" ? <small>标题提取失败</small> : null}
      <span className={styles.meta}>
        {formatRelativeTime(session.mtimeMs)} · {formatBytes(session.sizeBytes)} ·{" "}
        {/* 项目名取会话真实 cwd 的末段；没有 cwd 时退回目录名（去掉编码用的前导 `-`）。 */}
        {formatProjectPath(session.projectLabel, session.cwd)}
      </span>
      {/* 置顶开关绝对定位在行右上角，不参与 grid——多一个网格行会把 54px 的行高撑坏。
          它和出血点徽章一样是真按钮，因此行本体保持 role="button" 的 div。 */}
      <PinButton pinned={pinned} onToggle={() => onTogglePin(session.path)} />
    </div>
  );
}
