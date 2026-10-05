import type { Bridges } from "../../api/types";
import type { SessionMeta } from "../sessions/metadataCache";
import {
  archiveIndexPathOf,
  archiveRootOf,
  emptyArchiveIndex,
  entryFor,
  normalizeArchiveIndex,
  planArchive,
  withArchivedEntry,
  type ArchiveIndex
} from "./archiveIndex";

/**
 * The file side of the archive: read/write the index, copy transcripts.
 *
 * Everything goes through `Bridges`, so the whole feature is exercisable with
 * the fake filesystem the tests already use — and the real one is the same code
 * path with the Tauri commands behind it.
 */

export type ArchiveRun = {
  /** Sessions copied in this run. */
  copied: number;
  /** Sessions already up to date — the second click of the button. */
  skipped: number;
  /** Sessions that could not be copied, with the reason. */
  failures: Array<{ path: string; reason: string }>;
};

/**
 * A missing index is the normal first-run state; a corrupt one is reported to
 * the caller rather than silently replaced, because silently starting over
 * would re-copy everything and — worse — hide that something is wrong on disk.
 */
export async function readArchiveIndex(
  bridges: Bridges
): Promise<{ index: ArchiveIndex; corrupt: boolean }> {
  const path = archiveIndexPathOf(await bridges.fs.appDataDir());
  try {
    const raw: unknown = JSON.parse(await bridges.fs.readText(path));
    return { index: normalizeArchiveIndex(raw), corrupt: false };
  } catch (cause) {
    // Missing file: expected on first run. Anything else (unparsable JSON) is
    // still handled by starting empty, but the caller is told.
    const message = String(cause);
    const missing = /no such file|not found|os error 2|cannot find/i.test(message);
    return { index: emptyArchiveIndex(), corrupt: !missing };
  }
}

export async function writeArchiveIndex(bridges: Bridges, index: ArchiveIndex): Promise<void> {
  const path = archiveIndexPathOf(await bridges.fs.appDataDir());
  await bridges.fs.writeText(path, JSON.stringify(index, null, 2));
}

/**
 * Copy every session that is new or changed since its last copy.
 *
 * Order matters: the copy is written first, the entry is added to the in-memory
 * index, and the index is flushed once at the end. A crash in the middle costs a
 * redundant copy on the next run — never an index entry pointing at a file that
 * was never written.
 */
export async function runArchive(
  bridges: Bridges,
  sessions: readonly SessionMeta[],
  index: ArchiveIndex,
  onProgress?: (done: number, total: number) => void
): Promise<{ index: ArchiveIndex; run: ArchiveRun }> {
  const appDataDir = await bridges.fs.appDataDir();
  const { pending, upToDate } = planArchive(sessions, index);
  const run: ArchiveRun = { copied: 0, skipped: upToDate, failures: [] };
  let next = index;

  for (let position = 0; position < pending.length; position += 1) {
    const session = pending[position];
    try {
      const contents = await bridges.fs.readText(session.path);
      const entry = entryFor(appDataDir, session, Date.now());
      await bridges.fs.writeText(entry.archivePath, contents);
      next = withArchivedEntry(next, entry);
      run.copied += 1;
    } catch (cause) {
      run.failures.push({ path: session.path, reason: String(cause) });
    }
    onProgress?.(position + 1, pending.length);
  }

  if (run.copied > 0) await writeArchiveIndex(bridges, next);
  return { index: next, run };
}

/** The archive directory, for display and for "open the folder" affordances. */
export async function archiveDirectory(bridges: Bridges): Promise<string> {
  return archiveRootOf(await bridges.fs.appDataDir());
}
