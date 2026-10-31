import { useEffect, useMemo, useRef, useState } from "react";
import { useBridges } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { sessionTitle, type SessionMeta } from "../sessions/metadataCache";
import { extractSessionMetadata, METADATA_HEAD_BYTES } from "../sessions/metadataScanner";
import { parseJsonlTextAsync } from "../sessions/parseJsonl";
import { sharedSessionParseCache } from "../sessions/sessionParseCache";
import { SessionRepository } from "../sessions/sessionRepository";
import type { CompactEvent, ParsedSession, SessionRecord } from "../sessions/types";
import { recentSessionsFor } from "../usage/quotaReadout";
import type { UsageSessionInput } from "../usage/usageAggregations";
import {
  RECENT_ACTIVITY_WINDOW_MS,
  fallbackSessionTitle,
  sessionRows,
  type SessionRow,
  type SessionRowInput
} from "./pulseModel";

/**
 * 脉搏的调度层（design.md §2 §3 §4）：列会话 → 只对变过的文件重解析 →
 * 交给 `pulseModel` 的纯函数算快照。
 *
 * 成本约定（改动前先读这条）：**发现拍才列目录**（每 `DISCOVERY_MS` 一次，
 * 每拍都列要对全部会话文件各 stat 一次）；**快拍只 stat 活跃会话**（5 小时内有
 * mtime 的那些），且只有 mtime/size 变过的才 `readText` + 解析（解析缓存按这两项
 * 校验，命中即零成本）。与托盘 `useTrayReadout` 共用同一份 `sharedSessionParseCache`，
 * 输入集合也走同一个 `recentSessionsFor` 收窄——这是「脉搏的 5 小时消耗 === 用量页
 * 表盘」的前提。
 */

/** 快拍节奏：起点值，慢机器上会被自适应间隔自动拉长（§3）。 */
export const FAST_TICK_MS = 5000;
/** 发现节奏：列一次会话目录的间隔（§2）。 */
export const DISCOVERY_MS = 30000;

export type PulseLatestSession = {
  session: SessionMeta;
  records: SessionRecord[];
  compactEvents: CompactEvent[];
};

export type PulseSnapshot = {
  /** 本拍开始时刻；依赖时间的便宜计算（新近度标签等）都以它为准。 */
  now: number;
  /** 与托盘同口径的会话输入：`recentSessionsFor(listSessions(), now)` 里解析成功的那些。 */
  inputs: UsageSessionInput[];
  /** 活跃会话行（`pulseModel.sessionRows`），标题来自文件头（§4）。 */
  rows: SessionRow[];
  /** 上下文曲线要看的那一个会话：最活跃、且有记录的那个。 */
  latest: PulseLatestSession | null;
  /** 本拍是否观察到文件变化；没变化时页面只刷新依赖 `now` 的便宜部分。 */
  changed: boolean;
  /** 本拍耗时（ms），供自适应间隔与验收取证。 */
  durationMs: number;
};

export type PulseStaleInfo = {
  at: number;
  reason: string;
};

export type PulseFeedResult = {
  snapshot: PulseSnapshot | null;
  loading: boolean;
  /** 首拍即失败才有值：页面据此走 ErrorState。 */
  error: string | null;
  /** 保留了旧读数时的标注：页面显示「上次更新时间 · 本次读取失败」。 */
  stale: PulseStaleInfo | null;
};

/** 一个会话的解析结果 + 它对应的 stat 事实（变更检测就看这两项）。 */
type FeedEntry = {
  mtimeMs: number;
  sizeBytes: number;
  records: SessionRecord[];
  compactEvents: CompactEvent[];
};

type SnapshotCore = Omit<PulseSnapshot, "durationMs">;

/**
 * 与托盘逐字相同的解析路径：命中 `sharedSessionParseCache`（按 mtime+size 校验）
 * 就不再读文件；没命中才 `readText` + 分片解析并回写缓存。
 */
async function parseSession(bridges: Bridges, session: SessionMeta): Promise<ParsedSession> {
  const cached = sharedSessionParseCache.get(session.path);
  if (
    cached &&
    cached.mtimeMs === session.mtimeMs &&
    cached.sizeBytes === session.sizeBytes
  ) {
    return cached.session;
  }
  const text = await bridges.fs.readText(session.path);
  const parsed = await parseJsonlTextAsync(text, session.path);
  sharedSessionParseCache.set(session.path, {
    mtimeMs: session.mtimeMs,
    sizeBytes: session.sizeBytes,
    session: parsed
  });
  return parsed;
}

async function readEntry(bridges: Bridges, session: SessionMeta): Promise<FeedEntry> {
  const parsed = await parseSession(bridges, session);
  return {
    mtimeMs: session.mtimeMs,
    sizeBytes: session.sizeBytes,
    records: parsed.records,
    compactEvents: parsed.compactEvents ?? []
  };
}

/**
 * 活跃会话的标题（§4 / 陷阱一）。**不走元数据缓存**：`listSessions` 对 mtime/size
 * 与缓存不一致的文件一律标 `pending`，而正在被写的会话每次写入都会让缓存失配——
 * `sessionTitle(meta)` 在那里永远是项目标签。文件头在追加写下不会变，所以按路径
 * 缓存即可；读不到头就退回 `fallbackSessionTitle`（项目标签 + 会话 id 前 8 位）。
 *
 * 这份缓存只存在内存里：托盘与分析页各有自己的 `SessionRepository` 与写队列，
 * 多一个写 `meta-cache-v3.json` 的人就是读-改-写竞态。
 */
async function readSessionTitle(bridges: Bridges, session: SessionMeta): Promise<string> {
  try {
    const head = await bridges.fs.readHead(session.path, METADATA_HEAD_BYTES);
    const meta = extractSessionMetadata(head, session.projectLabel);
    const fromHead = sessionTitle({ ...session, ...meta });
    return fromHead !== session.projectLabel ? fromHead : fallbackSessionTitle(session);
  } catch {
    return fallbackSessionTitle(session);
  }
}

/** 发现拍：会话集合本身变了（新增 / 消失）也算「本拍观察到文件变化」。 */
function discoveryChanged(
  previous: readonly SessionMeta[] | null,
  next: readonly SessionMeta[]
): boolean {
  if (previous === null) return true;
  if (previous.length !== next.length) return true;
  const seen = new Set(previous.map((session) => session.path));
  return next.some((session) => !seen.has(session.path));
}

/** 上下文曲线的那一个会话：行序即活跃度倒序，取第一个真有记录的。 */
function latestOf(
  rows: readonly SessionRow[],
  entries: ReadonlyMap<string, FeedEntry>,
  sessions: readonly SessionMeta[]
): PulseLatestSession | null {
  const byPath = new Map(sessions.map((session) => [session.path, session]));
  for (const row of rows) {
    const session = byPath.get(row.path);
    const entry = entries.get(row.path);
    if (!session || !entry || entry.records.length === 0) continue;
    return { session, records: entry.records, compactEvents: entry.compactEvents };
  }
  return null;
}

/**
 * 驱动脉搏快照：挂载即跑第一拍，之后由上一拍结束时排下一拍（`setTimeout` 链，
 * 不是 `setInterval`——上一拍没结束就压根没有下一拍，天然不重叠）。
 *
 * 窗口不可见时不排下一拍；`visibilitychange` 回到可见立即补一拍。每拍失败都
 * 保留上一份 snapshot 并附 `stale`，只有首拍即失败才给 `error`。一个会话读不出来
 * 只跳过它，不算整拍失败。
 */
export function usePulseFeed(): PulseFeedResult {
  const bridges = useBridges();
  const repository = useMemo(() => new SessionRepository(bridges), [bridges]);

  const [snapshot, setSnapshot] = useState<PulseSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<PulseStaleInfo | null>(null);

  const snapshotRef = useRef<PulseSnapshot | null>(null);
  const entriesRef = useRef<Map<string, FeedEntry> | null>(null);
  const sessionsRef = useRef<readonly SessionMeta[] | null>(null);
  const titlesRef = useRef(new Map<string, string>());
  const lastDiscoveryRef = useRef(0);
  const durationRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current === null) return;
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };

    const scheduleNext = () => {
      clearTimer();
      // 隐藏时不排下一拍：不可见的视图不该继续付扫描的账。
      if (document.visibilityState === "hidden") return;
      // 慢机器 / 大文件自动降频，不靠魔法阈值。
      const delay = Math.max(FAST_TICK_MS, 3 * durationRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        void runTick();
      }, delay);
    };

    const runTick = async (): Promise<void> => {
      // 不重叠：上一拍还在飞就直接作罢（`setTimeout` 链本来也排不出来，这里是双保险）。
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const requestId = ++requestIdRef.current;
      const startedAt = Date.now();
      let core: SnapshotCore | null = null;
      let failure: string | null = null;

      try {
        const now = startedAt;
        let sessions = sessionsRef.current;
        let changed = false;

        // 发现拍：每 DISCOVERY_MS 才列一次目录。
        if (sessions === null || now - lastDiscoveryRef.current >= DISCOVERY_MS) {
          const listed = await repository.listSessions();
          if (requestIdRef.current !== requestId) return;
          const discovered = recentSessionsFor(listed, now);
          changed = changed || discoveryChanged(sessions, discovered);
          sessions = discovered;
          sessionsRef.current = discovered;
          lastDiscoveryRef.current = now;
        }

        const previousEntries = entriesRef.current;
        const entries = new Map<string, FeedEntry>();
        const active = sessions.filter(
          (session) => session.mtimeMs >= now - RECENT_ACTIVITY_WINDOW_MS
        );
        const activePaths = new Set(active.map((session) => session.path));

        // 活跃会话：每拍逐个 stat，只有 mtime/size 真的变过才重读重解析。
        for (const session of active) {
          const prior = previousEntries?.get(session.path) ?? null;
          let stat: Awaited<ReturnType<Bridges["fs"]["stat"]>> | null = null;
          try {
            stat = await bridges.fs.stat(session.path);
          } catch {
            if (requestIdRef.current !== requestId) return;
            // 一个会话 stat 不到不算整拍失败：留着上一份数据，下一拍再试。
            if (prior) entries.set(session.path, prior);
            continue;
          }
          if (requestIdRef.current !== requestId) return;
          if (prior && prior.mtimeMs === stat.mtime_ms && prior.sizeBytes === stat.size) {
            entries.set(session.path, prior);
            continue;
          }
          try {
            const entry = await readEntry(bridges, {
              ...session,
              mtimeMs: stat.mtime_ms,
              sizeBytes: stat.size
            });
            if (requestIdRef.current !== requestId) return;
            entries.set(session.path, entry);
            changed = true;
          } catch {
            if (requestIdRef.current !== requestId) return;
            // 读不出来就跳过它：其余会话照常计入（与托盘同一态度）。
            if (prior) entries.set(session.path, prior);
          }
        }

        // 5 小时外（但仍在 14 天回看里）的会话：只在第一次见到时解析一遍，之后零成本。
        for (const session of sessions) {
          if (activePaths.has(session.path)) continue;
          const prior = previousEntries?.get(session.path) ?? null;
          if (prior && prior.mtimeMs === session.mtimeMs && prior.sizeBytes === session.sizeBytes) {
            entries.set(session.path, prior);
            continue;
          }
          try {
            const entry = await readEntry(bridges, session);
            if (requestIdRef.current !== requestId) return;
            entries.set(session.path, entry);
            changed = true;
          } catch {
            if (requestIdRef.current !== requestId) return;
            // 同上：跳过它。
          }
        }
        entriesRef.current = entries;

        // 行与最新会话**每一拍都重算**：`sessionRows` 纯内存，只吃缓存里的 mtime 与
        // 已解析记录，没有一点 I/O。静置不动时也必须让它重算——R2 的窗口是「最近 5
        // 小时内有新记录」，沿用上一份会让早该滑出窗口的会话一直挂在列表里，那是在
        // 撒谎。贵的部分（stat / readText / 解析）上面已经按「文件变没变」跳过了；
        // `changed` 的含义不变：本拍有没有**观察到文件变化**，不表示这批行是新的。
        const inputs: UsageSessionInput[] = [];
        const rowInputs: SessionRowInput[] = [];
        for (const session of sessions) {
          const entry = entries.get(session.path);
          if (!entry) continue;
          // 与托盘同口径：projectPath 取元数据里的 cwd（pending 会话没有就是 undefined），
          // 不改从文件头顺手读到的那个——两边的归因必须描述同一批字段。
          inputs.push({
            records: entry.records,
            projectLabel: session.projectLabel,
            projectPath: session.cwd,
            // 压缩事件**必须跟着记录一起交出去**：`ConsoleReport` 的「今天压缩」
            // 与事件流都从这里读。漏掉它不会报错，只会让监控台的两个数恒为 0
            // ——正是 e2e 抓到的那个缺陷。
            compactEvents: entry.compactEvents,
            session
          });

          // 标题只为活跃会话取（行只能来自 5 小时内，与 active 集合同界）。
          let title = titlesRef.current.get(session.path);
          if (activePaths.has(session.path) && title === undefined) {
            title = await readSessionTitle(bridges, session);
            if (requestIdRef.current !== requestId) return;
            titlesRef.current.set(session.path, title);
          }
          rowInputs.push({ session, records: entry.records, title });
        }

        const rows = sessionRows(rowInputs, now);
        core = { now, inputs, rows, latest: latestOf(rows, entries, sessions), changed };
      } catch (cause) {
        failure = `读取失败：${String(cause)}`;
      } finally {
        inFlightRef.current = false;
      }

      // 卸载或被取代：状态一概不动，链子也不排——新的挂载点自己会开拍。
      if (requestIdRef.current !== requestId) return;

      const durationMs = Date.now() - startedAt;
      durationRef.current = durationMs;
      if (core !== null) {
        // 快照每拍都是新对象：页面拿到新的 `now` 就能刷新依赖时间的部分，
        // `changed` 告诉它这一拍背后有没有文件真的变过。
        const next: PulseSnapshot = { ...core, durationMs };
        snapshotRef.current = next;
        setSnapshot(next);
        setError(null);
        setStale(null);
      } else {
        const reason = failure ?? "读取失败";
        if (snapshotRef.current === null) {
          setError(reason);
        } else {
          setStale({ at: Date.now(), reason });
        }
      }
      setLoading(false);
      scheduleNext();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // 已经排好的那一拍也一起撤掉：隐藏之后不该再有拍点进来。
        clearTimer();
        return;
      }
      // 回到可见立即补一拍（重叠由 runTick 的 in-flight 守卫挡掉）。
      clearTimer();
      void runTick();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void runTick();

    return () => {
      // 卸载即作废：在飞的拍回来时 requestId 已经对不上，不会再写状态。
      requestIdRef.current += 1;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [repository, bridges]);

  return useMemo(
    () => ({ snapshot, loading, error, stale }),
    [snapshot, loading, error, stale]
  );
}
