import { useEffect, useState } from "react";
import { useBridges } from "../../api/bridges";
import { useSessions } from "../sessions/useSessions";
import { parseJsonlTextAsync } from "../sessions/parseJsonl";
import { sharedSessionParseCache } from "../sessions/sessionParseCache";
import { sharedSearchIndex } from "./searchIndex";

/** Publish batches like the usage scan does — per-session setState is O(n²). */
const PUBLISH_EVERY = 8;

/**
 * Progressively fills the shared search index behind the palette. Reuses the
 * shared parse cache, so a session the usage dashboard already parsed is not
 * parsed again — the two features split one parse bill.
 *
 * Fire-and-forget by design: the palette answers with whatever is indexed and
 * shows how much is still pending.
 */
export function useSearchIndex(): { indexed: number; total: number } {
  const bridges = useBridges();
  const { sessions, loading } = useSessions();
  const [indexed, setIndexed] = useState(sharedSearchIndex.sessionCount);
  const scanTarget = loading ? null : sessions;

  useEffect(() => {
    if (!scanTarget) return;
    let cancelled = false;
    const scan = async () => {
      const paths = new Set(scanTarget.map((session) => session.path));
      sharedSearchIndex.retain(paths);
      setIndexed(sharedSearchIndex.sessionCount);
      for (const session of scanTarget) {
        if (cancelled) return;
        if (sharedSearchIndex.has(session.path)) continue;
        try {
          const cached = sharedSessionParseCache.get(session.path);
          const parsed =
            cached && cached.mtimeMs === session.mtimeMs && cached.sizeBytes === session.sizeBytes
              ? cached.session
              : await parseJsonlTextAsync(await bridges.fs.readText(session.path), session.path);
          if (cancelled) return;
          sharedSearchIndex.add(session, parsed);
        } catch {
          // An unreadable session drops out of the index, not out of the app.
        }
        if (sharedSearchIndex.sessionCount % PUBLISH_EVERY === 0) {
          setIndexed(sharedSearchIndex.sessionCount);
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      }
      setIndexed(sharedSearchIndex.sessionCount);
    };
    void scan();
    return () => {
      cancelled = true;
    };
    // bridges is a stable context value; sessions identity changes only on
    // refresh/import, which legitimately restarts the scan (warm cache).
  }, [scanTarget, bridges]);

  return { indexed, total: loading ? 0 : sessions.length };
}
