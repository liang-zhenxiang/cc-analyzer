import type { Bridges } from "../../api/types";
import { joinPath, pathSegments } from "../../lib/path";
import {
  normalizeMetadataCache,
  toSessionMeta,
  type MetadataCache,
  type MetadataCacheEntry,
  type SessionMeta
} from "./metadataCache";
import { extractSessionMetadata, METADATA_HEAD_BYTES } from "./metadataScanner";
import { archivedSessions, type ArchiveIndex } from "../archive/archiveIndex";
import { readArchiveIndex } from "../archive/archiveStore";

const CACHE_NAME = "meta-cache-v2.json";
const METADATA_BATCH_SIZE = 16;

export type MetadataScanProgress = {
  done: number;
  total: number;
  batch: SessionMeta[];
};

export class SessionRepository {
  private cacheOperationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly bridges: Bridges) {}

  private async withCacheOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previousOperation = this.cacheOperationQueue;
    let releaseQueue!: () => void;
    this.cacheOperationQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousOperation;
    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  }

  private async cachePath(): Promise<string> {
    return joinPath(await this.bridges.fs.appDataDir(), CACHE_NAME);
  }

  private async readCache(): Promise<MetadataCache> {
    try {
      const parsed: unknown = JSON.parse(await this.bridges.fs.readText(await this.cachePath()));
      return normalizeMetadataCache(parsed);
    } catch {
      return normalizeMetadataCache(null);
    }
  }

  private async writeCache(cache: MetadataCache): Promise<void> {
    cache.generatedAt = Date.now();
    await this.bridges.fs.writeText(await this.cachePath(), JSON.stringify(cache, null, 2));
  }

  async listSessions(): Promise<SessionMeta[]> {
    return this.withCacheOperation(async () => {
      const home = await this.bridges.fs.homeDir();
      const projectsRoot = joinPath(home, ".claude", "projects");
      const cache = await this.readCache();
      const projectEntries = await this.bridges.fs.readDir(projectsRoot);
      const result: SessionMeta[] = [];

      for (const project of projectEntries.filter((entry) => entry.is_dir)) {
        const projectPath = joinPath(projectsRoot, project.name);
        const files = await this.bridges.fs.readDir(projectPath);

        for (const file of files.filter((entry) => entry.is_file && entry.name.endsWith(".jsonl"))) {
          const path = joinPath(projectPath, file.name);
          const stat = await this.bridges.fs.stat(path);
          const entry = cache.entries[path];

          if (entry && entry.mtimeMs === stat.mtime_ms && entry.sizeBytes === stat.size) {
            result.push(toSessionMeta(path, entry));
            continue;
          }

          result.push({
            path,
            projectLabel: project.name,
            mtimeMs: stat.mtime_ms,
            sizeBytes: stat.size,
            hasRecords: false,
            metadataStatus: "pending"
          });
        }
      }

      // 归档里的会话：Claude Code 已经清理掉的那些，从副本里补回来。
      // 仍存在于 ~/.claude 的会话以源文件为准（归档只是备份，不是第二份真相）。
      // 索引损坏时这里按空处理——它不会让扫描失败，而「归档在不在」由设置面板
      // 的就地状态行负责说清楚（readArchiveIndex 会把 corrupt 标志交回去）。
      let index: ArchiveIndex;
      try {
        index = (await readArchiveIndex(this.bridges)).index;
      } catch {
        index = { version: 1, entries: {} };
      }
      const livePaths = new Set(result.map((session) => session.path));
      const archived = archivedSessions(index, livePaths);

      return [...result, ...archived].sort((a, b) => b.mtimeMs - a.mtimeMs);
    });
  }

  async completeMetadata(
    sessions: SessionMeta[],
    onProgress?: (progress: MetadataScanProgress) => void
  ): Promise<SessionMeta[]> {
    return this.withCacheOperation(async () => {
      const cache = await this.readCache();
      const result = [...sessions];
      let batch: SessionMeta[] = [];
      let done = 0;
      const total = result.filter((session) => session.metadataStatus !== "complete").length;

      for (const [index, session] of result.entries()) {
        if (session.metadataStatus === "complete") continue;

        try {
          const stat = await this.bridges.fs.stat(session.path);
          const head = await this.bridges.fs.readHead(session.path, METADATA_HEAD_BYTES);
          const meta = extractSessionMetadata(head, session.projectLabel);
          const entry: MetadataCacheEntry = {
            mtimeMs: stat.mtime_ms,
            sizeBytes: stat.size,
            meta
          };
          cache.entries[session.path] = entry;
          // `archived` 是**出处**不是元数据（元数据缓存里不存它），但补全这一步
          // 会拿缓存里的字段重建对象，得把它带过去——否则会话在列表里丢掉
          // 「来自归档副本」的标记（端到端抓到的回归）。
          const completed = toSessionMeta(session.path, entry);
          result[index] = session.archived ? { ...completed, archived: true } : completed;
        } catch {
          result[index] = { ...session, metadataStatus: "failed" };
        }

        done += 1;
        batch.push(result[index]);
        if (batch.length < METADATA_BATCH_SIZE) continue;

        onProgress?.({ done, total, batch });
        batch = [];
        await this.writeCache(cache);
      }

      if (batch.length > 0) onProgress?.({ done, total, batch });
      await this.writeCache(cache);
      return result;
    });
  }

  async importSession(path: string): Promise<SessionMeta> {
    return this.withCacheOperation(async () => {
      const stat = await this.bridges.fs.stat(path);
      const projectLabel = pathSegments(path).at(-2) ?? "导入会话";
      const cache = await this.readCache();

      try {
        const head = await this.bridges.fs.readHead(path, METADATA_HEAD_BYTES);
        const meta = extractSessionMetadata(head, projectLabel);
        const entry: MetadataCacheEntry = {
          mtimeMs: stat.mtime_ms,
          sizeBytes: stat.size,
          meta
        };
        cache.entries[path] = entry;
        await this.writeCache(cache);
        return toSessionMeta(path, entry);
      } catch {
        return {
          path,
          projectLabel,
          mtimeMs: stat.mtime_ms,
          sizeBytes: stat.size,
          hasRecords: true,
          metadataStatus: "failed"
        };
      }
    });
  }
}

export function createSessionRepository(bridges: Bridges): SessionRepository {
  return new SessionRepository(bridges);
}
