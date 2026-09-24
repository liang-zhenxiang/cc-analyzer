import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SessionRepository, type MetadataScanProgress } from "./sessionRepository";
import type { SessionMeta } from "./metadataCache";
import { useBridges } from "../../api/bridges";

function replaceSessions(current: SessionMeta[], updates: SessionMeta[]): SessionMeta[] {
  const byPath = new Map(updates.map((session) => [session.path, session]));
  return current.map((session) => byPath.get(session.path) ?? session);
}

function mergeScannedSessions(
  current: SessionMeta[],
  scanned: SessionMeta[],
  importedPaths: ReadonlySet<string>
): SessionMeta[] {
  const scannedPaths = new Set(scanned.map((session) => session.path));
  const imported = current.filter(
    (session) => importedPaths.has(session.path) && !scannedPaths.has(session.path)
  );
  return [...imported, ...scanned];
}

export function useSessions() {
  const bridges = useBridges();
  const repository = useMemo(() => new SessionRepository(bridges), [bridges]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<MetadataScanProgress | null>(null);
  const refreshIdRef = useRef(0);
  const importedPathsRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const requestId = ++refreshIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const scannedSessions = await repository.listSessions();
      if (refreshIdRef.current !== requestId) return;
      setSessions((current) =>
        mergeScannedSessions(current, scannedSessions, importedPathsRef.current)
      );

      const completed = await repository.completeMetadata(scannedSessions, (update) => {
        if (refreshIdRef.current !== requestId) return;
        setSessions((current) => replaceSessions(current, update.batch));
        setProgress(update);
      });
      if (refreshIdRef.current !== requestId) return;
      setSessions((current) => replaceSessions(current, completed));
    } catch (cause) {
      if (refreshIdRef.current === requestId) {
        setError(`扫描会话列表失败: ${String(cause)}`);
      }
    } finally {
      if (refreshIdRef.current === requestId) {
        setLoading(false);
        setProgress(null);
      }
    }
  }, [repository]);

  const importPath = useCallback(async (path: string) => {
    try {
      const imported = await repository.importSession(path);
      importedPathsRef.current.add(imported.path);
      setSessions((current) => [
        imported,
        ...current.filter((session) => session.path !== imported.path)
      ]);
    } catch (cause) {
      setError(`导入会话失败: ${String(cause)}`);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    const unlisten = bridges.events.onSessionImport((path) => void importPath(path));
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [bridges.events, refresh, importPath]);

  return { sessions, loading, error, progress, refresh, importPath };
}
