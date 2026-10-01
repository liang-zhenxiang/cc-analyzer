import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBridges } from "../../api/bridges";
import { useSessions } from "../sessions/useSessions";
import { parseJsonlTextAsync } from "../sessions/parseJsonl";
import { createSessionParseCache, type SessionParseCache } from "../sessions/sessionParseCache";
import type { SessionMeta } from "../sessions/metadataCache";
import type { ParsedSession } from "../sessions/types";
import {
  aggregateSessionInput,
  emptyAggregate,
  mergeAggregate,
  mergeInto,
  type UsageAggregate,
  type UsageSessionInput
} from "./usageAggregations";

/**
 * Module-level on purpose: `AppShell` unmounts a page when the user leaves the
 * tab, so a ref inside this hook would be dropped and the second visit would
 * re-parse everything. Entries are validated against mtime + size, so an edited
 * file is always re-read — the cache can only be stale within one mount, never
 * wrong.
 */
const parseCache: SessionParseCache = createSessionParseCache();

/**
 * Intermediate results reach the page in batches: every `setInputs` changes the
 * page's `aggregateRange` memo, which re-reads every record accumulated so far.
 * Per-session publication would turn the scan into O(sessions² × records) for
 * no visible benefit — eight sessions per paint is still "progressive" to a
 * human eye while the per-session progress counter keeps updating.
 */
const PUBLISH_EVERY = 8;

export type UsageScanProgress = { done: number; total: number };

/**
 * Progressive scan behind the usage dashboard: reuses `useSessions` for the
 * session list (metadata scan, cache, import events — all of it), then parses
 * each session once and merges it into a growing aggregate. The window filter
 * is the page's job: it re-crops `inputs` with `aggregateRange` per range, so
 * this hook only ever grows the full-history view.
 */
export function useUsageOverview() {
  const bridges = useBridges();
  const { sessions, loading, error } = useSessions();
  const [inputs, setInputs] = useState<UsageSessionInput[]>([]);
  const [aggregate, setAggregate] = useState<UsageAggregate>(emptyAggregate);
  const [progress, setProgress] = useState<UsageScanProgress>({ done: 0, total: 0 });
  const [scanning, setScanning] = useState(true);
  const [skipped, setSkipped] = useState(0);
  const scanIdRef = useRef(0);

  // `loading` gates the target to the final list: metadata batches replace the
  // `sessions` array while loading, and none of those identities should start a
  // scan. After loading, only a refresh or an import changes the array — both
  // legitimately restart the scan (with warm parse cache).
  const scanTarget = useMemo(() => (loading ? null : sessions), [loading, sessions]);

  const readSession = useCallback(
    async (session: SessionMeta): Promise<ParsedSession> => {
      const cached = parseCache.get(session.path);
      if (cached && cached.mtimeMs === session.mtimeMs && cached.sizeBytes === session.sizeBytes) {
        return cached.session;
      }
      const text = await bridges.fs.readText(session.path);
      const parsed = await parseJsonlTextAsync(text, session.path);
      parseCache.set(session.path, {
        mtimeMs: session.mtimeMs,
        sizeBytes: session.sizeBytes,
        session: parsed
      });
      return parsed;
    },
    [bridges]
  );

  useEffect(() => {
    if (!scanTarget) return;
    const scanId = ++scanIdRef.current;

    setScanning(true);
    setSkipped(0);
    setProgress({ done: 0, total: scanTarget.length });
    setInputs([]);
    setAggregate(emptyAggregate());

    const scan = async () => {
      const collected: UsageSessionInput[] = [];
      const accumulated = emptyAggregate();
      let done = 0;
      let failed = 0;
      let published = 0;

      const publish = () => {
        published = collected.length;
        setInputs([...collected]);
        // Snapshot, not the mutable accumulator: state must stay immutable or
        // a later merge would retroactively edit the "past" render.
        setAggregate(mergeAggregate(emptyAggregate(), accumulated));
      };

      try {
        for (const session of scanTarget) {
          if (scanIdRef.current !== scanId) return;
          try {
            const parsed = await readSession(session);
            if (scanIdRef.current !== scanId) return;
            if (parsed.records.length > 0) {
              const input: UsageSessionInput = {
                records: parsed.records,
                projectLabel: session.projectLabel
              };
              collected.push(input);
              mergeInto(accumulated, aggregateSessionInput(input));
            }
          } catch {
            // One unreadable session must not blank the whole dashboard.
            failed += 1;
          }
          done += 1;
          setProgress({ done, total: scanTarget.length });
          if (collected.length - published >= PUBLISH_EVERY) publish();
          // Yield between sessions: `parseJsonlTextAsync` already yields inside
          // a session, but a run of tiny sessions would otherwise hog the loop.
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
        publish();
        setSkipped(failed);
      } finally {
        if (scanIdRef.current === scanId) setScanning(false);
      }
    };

    void scan();
  }, [scanTarget, readSession]);

  return { inputs, aggregate, progress, scanning, error, skipped };
}
