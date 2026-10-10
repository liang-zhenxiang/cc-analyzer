import { useSyncExternalStore } from "react";
import type { Bridges } from "../../api/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { SessionRepository } from "../sessions/sessionRepository";
import { archiveFootprint, planArchive, type ArchiveFootprint } from "./archiveIndex";
import { archiveDirectory, readArchiveIndex, runArchive, type ArchiveRun } from "./archiveStore";

/**
 * The archive task normally runs while the settings popover is open, but the
 * popover unmounts the moment it is closed (`settingsOpen ? <ThresholdsPanel/> : null`).
 * Progress therefore lives here, in module scope, so a run started before the
 * panel closed keeps reporting after it is reopened — and so a second click can
 * never start a parallel run against the same index file.
 */

export type ArchiveRunStatus = "idle" | "running" | "importing" | "done" | "error";

export type ArchiveTaskState = {
  enabled: boolean;
  status: ArchiveRunStatus;
  /** `{ done, total }` while running, otherwise null. */
  progress: { done: number; total: number } | null;
  /** The counters of the most recent finished run, for the completion summary. */
  lastRun: ArchiveRun | null;
  /** The index file failed to parse — surfaced instead of silently starting over. */
  indexCorrupt: boolean;
  footprint: ArchiveFootprint;
  /** Last catastrophic failure (a run that threw, or a file that could not be copied). */
  error: string | null;
  /** The archive root on disk, for the readout tooltip. */
  archiveDir: string | null;
};

const ENABLED_KEY = "cca-archive-enabled";

const EMPTY_FOOTPRINT: ArchiveFootprint = { count: 0, bytes: 0, lastArchivedAt: null };

/** Default OFF; any unreadable / unexpected persisted value stays OFF. */
export function loadArchiveEnabled(storage: Pick<Storage, "getItem"> = localStorage): boolean {
  try {
    return storage.getItem(ENABLED_KEY) === "on";
  } catch {
    return false;
  }
}

function storeArchiveEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "on" : "off");
  } catch {
    // Persistence is optional; the in-memory toggle still applies this session.
  }
}

function initialState(): ArchiveTaskState {
  return {
    enabled: loadArchiveEnabled(),
    status: "idle",
    progress: null,
    lastRun: null,
    indexCorrupt: false,
    footprint: EMPTY_FOOTPRINT,
    error: null,
    archiveDir: null
  };
}

let state: ArchiveTaskState = initialState();
const listeners = new Set<() => void>();

function setState(patch: Partial<ArchiveTaskState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeArchiveTask(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Stable snapshot: the same object reference until something actually changes. */
export function getArchiveTask(): ArchiveTaskState {
  return state;
}

export function useArchiveTask(): ArchiveTaskState {
  return useSyncExternalStore(subscribeArchiveTask, getArchiveTask, getArchiveTask);
}

/** Test / teardown helper: drops every in-memory result, re-reads the toggle. */
export function resetArchiveTask(): void {
  state = initialState();
  for (const listener of listeners) listener();
}

/**
 * Turning the switch on means "start keeping these records": the very first
 * enabled state kicks off a full run against the current (usually empty) index.
 */
export function enable(bridges?: Bridges): void {
  if (state.enabled) return;
  setState({ enabled: true, error: null });
  storeArchiveEnabled(true);
  if (bridges) void runNow(bridges);
}

/** Off stops future runs only — nothing on disk is deleted, ever. */
export function disable(): void {
  if (!state.enabled) return;
  setState({ enabled: false });
  storeArchiveEnabled(false);
}

/**
 * Read the index for the readout without copying anything. Called when the
 * panel mounts so the footprint and the corrupt flag reflect what is on disk.
 */
export async function refreshStatus(bridges: Bridges): Promise<void> {
  try {
    const [{ index, corrupt }, directory] = await Promise.all([
      readArchiveIndex(bridges),
      archiveDirectory(bridges)
    ]);
    setState({ indexCorrupt: corrupt, footprint: archiveFootprint(index), archiveDir: directory });
  } catch {
    // A missing archive is the normal first-run state; a thrown error means the
    // bridge itself failed. Report it without pretending any files were copied.
    setState({ indexCorrupt: true });
  }
}

/**
 * 导入归档包成功后调一次：索引被改写了，读数与「已归档多少」都得跟着更新。
 *
 * 中间那一档 `importing` 不是装饰。会话列表只在「归档状态落定到 done」的跃迁上
 * 重跑发现（见 SessionAnalyzerPage），所以导入也要走一次 `importing → done`，
 * 新搬进来的会话才会立刻出现在列表里；而 `importing` 又刻意不是 `running`，
 * 免得面板把归档按钮错标成「正在归档…」。
 */
export async function refreshAfterImport(bridges: Bridges): Promise<void> {
  setState({ status: "importing", progress: null, error: null });
  await refreshStatus(bridges);
  setState({ status: "done", lastRun: null, progress: null });
}

/**
 * Copy every session that is new or changed. When `sessions` is omitted the
 * live scan is read here (through the repository), so the panel only needs the
 * bridges to trigger a run. Archived sessions are dropped: the copy is a
 * backup, never a second source of truth.
 */
export async function runNow(
  bridges: Bridges,
  sessions?: readonly SessionMeta[]
): Promise<void> {
  if (!state.enabled) return;
  if (state.status === "running") return;

  setState({ status: "running", progress: { done: 0, total: 0 }, error: null });
  try {
    const [{ index, corrupt }, directory] = await Promise.all([
      readArchiveIndex(bridges),
      archiveDirectory(bridges)
    ]);
    const candidates = sessions ?? (await new SessionRepository(bridges).listSessions());
    const live = candidates.filter((session) => session.archived !== true);
    const { pending } = planArchive(live, index);
    setState({
      indexCorrupt: corrupt,
      archiveDir: directory,
      progress: { done: 0, total: pending.length }
    });

    const { index: next, run } = await runArchive(bridges, live, index, (done, total) =>
      setState({ progress: { done, total } })
    );

    if (run.failures.length > 0) {
      // Each file lands its own index entry, so the copies already made are
      // kept and the retry is incremental. The readout stays on the last
      // successful footprint; the reason goes to the alert line and the toast.
      setState({
        status: "error",
        error: run.failures[0].reason,
        lastRun: run,
        footprint: archiveFootprint(next),
        progress: null
      });
    } else {
      setState({
        status: "done",
        lastRun: run,
        footprint: archiveFootprint(next),
        progress: null
      });
    }
  } catch (cause) {
    setState({ status: "error", error: String(cause), progress: null });
  }
}
