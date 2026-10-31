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

  /**
   * 懒补筛选事实（G2）：用户第一次展开筛选条件栏时调用。
   *
   * 不放在 `refresh` 里一起跑——事实要读全量文本，而元数据只用前 256KB；
   * 混进首屏会让「一个文件读不动」拖住整块列表（既有扫描测试用永不 resolve
   * 的 `readText` 盯着这条不变量）。索引进度与扫描进度共用同一行状态。
   */
  const indexingRef = useRef(false);
  const indexFacts = useCallback(async () => {
    if (indexingRef.current) return;
    const targets = sessions.filter(
      (session) => session.metadataStatus === "complete" && session.facts === undefined
    );
    if (targets.length === 0) return;
    indexingRef.current = true;
    try {
      const enriched = await repository.enrichFacts(targets, (update) => {
        setSessions((current) => replaceSessions(current, update.batch));
        setProgress(update);
      });
      setSessions((current) => replaceSessions(current, enriched));
    } catch {
      // 单会话失败已在 enrichFacts 里降级；这里只兜住整体异常。
    } finally {
      indexingRef.current = false;
      setProgress(null);
    }
  }, [repository, sessions]);

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

  return { sessions, loading, error, progress, refresh, importPath, indexFacts };
}
