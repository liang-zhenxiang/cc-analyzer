import { basename, joinPath } from "../../lib/path";
import type { SessionMeta } from "../sessions/metadataCache";

/**
 * The local archive: a copy of each session transcript, kept past Claude Code's
 * own cleanup.
 *
 * Claude Code prunes roughly everything older than 30 days, which makes any
 * "how much did I use last month / last year" question unanswerable from
 * `~/.claude` alone. The archive is a **copy**, written into the app's own data
 * directory: the originals are never moved, never rewritten, and nothing leaves
 * the machine.
 *
 * This module is the pure half — what to copy, what to skip, and how an archived
 * entry becomes a session the rest of the app already knows how to render. The
 * file I/O lives in `archiveStore.ts`.
 */

export const ARCHIVE_DIR_NAME = "archive";
export const ARCHIVE_INDEX_NAME = "archive-index.json";
export const ARCHIVE_INDEX_VERSION = 1;

export type ArchiveEntry = {
  /** The original `~/.claude/projects/.../<session>.jsonl` (the index key). */
  sourcePath: string;
  /** Where the copy lives. */
  archivePath: string;
  /** Original project directory name, e.g. `-repo-demo`. */
  projectLabel: string;
  /** File name without `.jsonl`. */
  sessionId: string;
  /** Original size, for the incremental check and the footprint readout. */
  sizeBytes: number;
  /**
   * **Original** mtime, not the copy time. Everything downstream — timeline
   * grouping, usage trends, relative labels — must keep describing when the
   * session actually happened, not when it was backed up.
   */
  mtimeMs: number;
  archivedAt: number;
};

export type ArchiveIndex = {
  version: number;
  /** Keyed by `sourcePath`, so a re-scan can look an entry up in O(1). */
  entries: Record<string, ArchiveEntry>;
};

export type ArchiveFootprint = {
  count: number;
  /** Sum of the archived originals' sizes (what the copies occupy, ±). */
  bytes: number;
  lastArchivedAt: number | null;
};

export function emptyArchiveIndex(): ArchiveIndex {
  return { version: ARCHIVE_INDEX_VERSION, entries: {} };
}

function isEntry(value: unknown): value is ArchiveEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.sourcePath === "string" &&
    entry.sourcePath.length > 0 &&
    typeof entry.archivePath === "string" &&
    entry.archivePath.length > 0 &&
    typeof entry.projectLabel === "string" &&
    typeof entry.sessionId === "string" &&
    typeof entry.sizeBytes === "number" &&
    Number.isFinite(entry.sizeBytes) &&
    typeof entry.mtimeMs === "number" &&
    Number.isFinite(entry.mtimeMs) &&
    typeof entry.archivedAt === "number" &&
    Number.isFinite(entry.archivedAt)
  );
}

/**
 * The index is a file on disk like any other: it can be missing, truncated, or
 * hand-edited. A malformed entry is dropped rather than allowed to poison the
 * session list — but nothing is silently invented either.
 */
export function normalizeArchiveIndex(raw: unknown): ArchiveIndex {
  if (typeof raw !== "object" || raw === null) return emptyArchiveIndex();
  const entries = (raw as { entries?: unknown }).entries;
  if (typeof entries !== "object" || entries === null) return emptyArchiveIndex();

  const result: ArchiveIndex = emptyArchiveIndex();
  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    if (!isEntry(value) || value.sourcePath !== key) continue;
    result.entries[key] = value;
  }
  return result;
}

export function archiveRootOf(appDataDir: string): string {
  return joinPath(appDataDir, ARCHIVE_DIR_NAME);
}

export function archiveIndexPathOf(appDataDir: string): string {
  return joinPath(archiveRootOf(appDataDir), ARCHIVE_INDEX_NAME);
}

/** `<archive>/<projectLabel>/<session>.jsonl` — the project grouping survives. */
export function archivePathFor(
  appDataDir: string,
  session: Pick<SessionMeta, "path" | "projectLabel">
): string {
  return joinPath(archiveRootOf(appDataDir), session.projectLabel, basename(session.path));
}

/**
 * Copy when there is no entry yet, or when the original changed since the copy.
 * The comparison is mtime **or** size: a rewrite that keeps the timestamp (some
 * editors and `cp -p` do) still changes the size, and vice versa.
 */
export function needsArchive(
  entry: ArchiveEntry | undefined,
  session: Pick<SessionMeta, "mtimeMs" | "sizeBytes">
): boolean {
  if (!entry) return true;
  return session.mtimeMs !== entry.mtimeMs || session.sizeBytes !== entry.sizeBytes;
}

export function planArchive(
  sessions: readonly SessionMeta[],
  index: ArchiveIndex
): { pending: SessionMeta[]; upToDate: number } {
  const pending: SessionMeta[] = [];
  let upToDate = 0;
  for (const session of sessions) {
    if (needsArchive(index.entries[session.path], session)) pending.push(session);
    else upToDate += 1;
  }
  return { pending, upToDate };
}

export function entryFor(
  appDataDir: string,
  session: Pick<SessionMeta, "path" | "projectLabel" | "mtimeMs" | "sizeBytes">,
  archivedAt: number
): ArchiveEntry {
  return {
    sourcePath: session.path,
    archivePath: archivePathFor(appDataDir, session),
    projectLabel: session.projectLabel,
    sessionId: basename(session.path).replace(/\.jsonl$/i, ""),
    sizeBytes: session.sizeBytes,
    mtimeMs: session.mtimeMs,
    archivedAt
  };
}

export function withArchivedEntry(index: ArchiveIndex, entry: ArchiveEntry): ArchiveIndex {
  return {
    version: ARCHIVE_INDEX_VERSION,
    entries: { ...index.entries, [entry.sourcePath]: entry }
  };
}

/**
 * Archived sessions that the live scan did **not** return — i.e. the ones Claude
 * Code has already cleaned up. A session still present in `~/.claude` is served
 * from there, so the freshest bytes always win.
 */
export function archivedSessions(
  index: ArchiveIndex,
  liveSourcePaths: ReadonlySet<string>
): SessionMeta[] {
  const result: SessionMeta[] = [];
  for (const entry of Object.values(index.entries)) {
    if (liveSourcePaths.has(entry.sourcePath)) continue;
    result.push({
      path: entry.archivePath,
      projectLabel: entry.projectLabel,
      // 原始时间，不是归档时间：分组、趋势、相对时间都要说「那次会话发生在什么时候」。
      mtimeMs: entry.mtimeMs,
      sizeBytes: entry.sizeBytes,
      hasRecords: true,
      metadataStatus: "pending",
      archived: true
    });
  }
  return result.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function archiveFootprint(index: ArchiveIndex): ArchiveFootprint {
  const entries = Object.values(index.entries);
  return {
    count: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    lastArchivedAt: entries.reduce<number | null>(
      (latest, entry) => (latest === null || entry.archivedAt > latest ? entry.archivedAt : latest),
      null
    )
  };
}
