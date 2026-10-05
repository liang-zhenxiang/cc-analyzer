import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../tests/fixtures/session-metadata.jsonl?raw";
import type { Bridges } from "../../api/types";
import { toSessionMeta, type MetadataCacheEntry, type SessionMeta } from "./metadataCache";
import { extractSessionMetadata, METADATA_HEAD_BYTES } from "./metadataScanner";
import { SessionRepository } from "./sessionRepository";

type FsBridgeStub = Partial<Bridges["fs"]>;

function createBridges(fs: FsBridgeStub): Bridges {
  return {
    proc: {},
    system: {},
    clipboard: {},
    dialog: {},
    events: {},
    monitor: {},
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async (path: string) =>
        path.endsWith("projects")
          ? [{ name: "repo-demo", is_dir: true, is_file: false }]
          : [{ name: "session.jsonl", is_dir: false, is_file: true }]
      ),
      stat: vi.fn(async () => ({ is_file: true, size: 10, mtime_ms: 42 })),
      readHead: vi.fn(async () => JSON.stringify({ sessionId: "session-1", cwd: "/repo" })),
      readText: vi.fn(async (_path: string) =>
        JSON.stringify({ version: 2, generatedAt: 1, entries: {} })
      ),
      writeText: vi.fn(async () => undefined),
      ...fs
    } as Bridges["fs"]
  } as unknown as Bridges;
}

describe("SessionRepository", () => {
  let bridges: Bridges;

  beforeEach(() => {
    bridges = createBridges({});
  });

  it("returns pending sessions and populates cache v2 in batches", async () => {
    const repository = new SessionRepository(bridges);
    expect(METADATA_HEAD_BYTES).toBe(8 * 1024 * 1024);
    const sessions = await repository.listSessions();

    expect(sessions[0]).toMatchObject({
      path: "/home/tester/.claude/projects/repo-demo/session.jsonl",
      metadataStatus: "pending"
    });
    expect(bridges.fs.readHead).not.toHaveBeenCalled();

    const onProgress = vi.fn();
    const completed = await repository.completeMetadata(sessions, onProgress);

    expect(completed[0]).toMatchObject({
      metadataStatus: "complete",
      projectLabel: "repo-demo",
      sessionId: "session-1"
    });
    expect(onProgress).toHaveBeenCalledWith({
      done: 1,
      total: 1,
      batch: [completed[0]]
    });
    expect(bridges.fs.writeText).toHaveBeenCalledWith(
      "/app-data/meta-cache-v2.json",
      expect.stringContaining('"version": 2')
    );
    expect(bridges.fs.readHead).toHaveBeenCalledWith(
      "/home/tester/.claude/projects/repo-demo/session.jsonl",
      METADATA_HEAD_BYTES
    );
  });

  it("reuses a valid v2 cache entry without reading the file", async () => {
    const entry: MetadataCacheEntry = {
      mtimeMs: 42,
      sizeBytes: 10,
      meta: {
        projectLabel: "repo-demo",
        sessionId: "cached-session",
        hasRecords: true
      }
    };
    bridges = createBridges({
      homeDir: vi.fn(async () => "/"),
      readDir: vi.fn(async (path: string) =>
        path.endsWith("projects")
          ? [{ name: "a", is_dir: true, is_file: false }]
          : [{ name: "session.jsonl", is_dir: false, is_file: true }]
      ),
      readText: vi.fn(async () =>
        JSON.stringify({
          version: 2,
          generatedAt: 1,
          entries: { "/.claude/projects/a/session.jsonl": entry }
        })
      )
    });
    const repository = new SessionRepository(bridges);

    const sessions = await repository.listSessions();

    expect(sessions[0]).toEqual(toSessionMeta("/.claude/projects/a/session.jsonl", entry));
    expect(bridges.fs.readHead).not.toHaveBeenCalled();
  });

  it("emits metadata in batches of 16 and persists each full batch", async () => {
    const repository = new SessionRepository(bridges);
    const head = JSON.stringify({ sessionId: "session-1", cwd: "/repo" });
    const sessions = Array.from({ length: 17 }, (_, index) => ({
      path: `/session-${index}.jsonl`,
      projectLabel: "repo-demo",
      mtimeMs: index,
      sizeBytes: 10,
      hasRecords: false,
      metadataStatus: "pending" as const
    }));
    const onProgress = vi.fn();

    await repository.completeMetadata(sessions, onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ done: 16, total: 17 })
    );
    expect(onProgress.mock.calls[0][0].batch).toEqual(
      expect.arrayContaining([expect.objectContaining(extractSessionMetadata(head, "repo-demo"))])
    );
    expect(onProgress.mock.calls[0][0].batch).toHaveLength(16);
    expect(onProgress.mock.calls[1][0]).toMatchObject({ done: 17, total: 17 });
    expect(onProgress.mock.calls[1][0].batch).toHaveLength(1);
    expect(bridges.fs.writeText).toHaveBeenCalledTimes(2);
  });

  it("keeps already complete sessions in completeMetadata batches", async () => {
    const repository = new SessionRepository(bridges);
    const complete: SessionMeta = {
      path: "/already-complete.jsonl",
      projectLabel: "already",
      mtimeMs: 1,
      sizeBytes: 1,
      hasRecords: false,
      metadataStatus: "complete"
    };

    const completed = await repository.completeMetadata([complete]);

    expect(completed).toEqual([complete]);
    expect(bridges.fs.readHead).not.toHaveBeenCalled();
  });

  it("marks sessions failed when metadata reading fails", async () => {
    bridges = createBridges({
      readHead: vi.fn(async () => {
        throw new Error("read failed");
      })
    });
    const repository = new SessionRepository(bridges);
    const pending: SessionMeta = {
      path: "/broken.jsonl",
      projectLabel: "broken",
      mtimeMs: 1,
      sizeBytes: 1,
      hasRecords: false,
      metadataStatus: "pending"
    };

    const completed = await repository.completeMetadata([pending]);

    expect(completed).toEqual([{ ...pending, metadataStatus: "failed" }]);
  });

  it("imports an externally selected session", async () => {
    const repository = new SessionRepository(bridges);

    const session = await repository.importSession(
      "/home/tester/.claude/projects/repo-demo/session.jsonl"
    );

    expect(session).toMatchObject({
      path: "/home/tester/.claude/projects/repo-demo/session.jsonl",
      projectLabel: "repo-demo",
      mtimeMs: 42,
      sizeBytes: 10,
      hasRecords: false,
      metadataStatus: "complete"
    });
    expect(bridges.fs.writeText).toHaveBeenCalledWith(
      "/app-data/meta-cache-v2.json",
      expect.stringContaining('"version": 2')
    );
    expect(bridges.fs.readHead).toHaveBeenLastCalledWith(
      "/home/tester/.claude/projects/repo-demo/session.jsonl",
      METADATA_HEAD_BYTES
    );
  });

  it("preserves an import that starts while metadata completion is reading", async () => {
    let resolveHead: ((head: string) => void) | undefined;
    let cacheText = JSON.stringify({ version: 2, generatedAt: 1, entries: {} });
    bridges = createBridges({
      readText: vi.fn(async () => cacheText),
      readHead: vi.fn(
        (path: string) =>
          new Promise<string>((resolve) => {
            if (path === "/metadata-session.jsonl") {
              resolveHead = resolve;
              return;
            }
            resolve(fixture);
          })
      ),
      writeText: vi.fn(async (_path: string, contents: string) => {
        cacheText = contents;
      })
    });
    const repository = new SessionRepository(bridges);
    const metadataSession: SessionMeta = {
      path: "/metadata-session.jsonl",
      projectLabel: "metadata-project",
      mtimeMs: 1,
      sizeBytes: 10,
      hasRecords: false,
      metadataStatus: "pending"
    };

    const completion = repository.completeMetadata([metadataSession]);
    await vi.waitFor(() => expect(resolveHead).toBeDefined());
    const importPromise = repository.importSession("/imported-session.jsonl");
    resolveHead?.(fixture);
    await Promise.all([completion, importPromise]);

    const writes = vi.mocked(bridges.fs.writeText).mock.calls;
    const finalCache = JSON.parse(writes[writes.length - 1][1]) as {
      entries: Record<string, unknown>;
    };
    expect(Object.keys(finalCache.entries).sort()).toEqual(
      ["/imported-session.jsonl", "/metadata-session.jsonl"].sort()
    );
  });

  it("uses only the v2 metadata cache", async () => {
    const readText = vi.fn(async (_path: string) =>
      JSON.stringify({ version: 2, generatedAt: 1, entries: {} })
    );
    const writeText = vi.fn(async () => undefined);
    bridges = createBridges({ readText, writeText });
    const repository = new SessionRepository(bridges);

    await repository.listSessions();
    await repository.completeMetadata([
      {
        path: "/session.jsonl",
        projectLabel: "repo-demo",
        mtimeMs: 1,
        sizeBytes: 1,
        hasRecords: false,
        metadataStatus: "pending"
      }
    ]);
    await repository.importSession("/imported.jsonl");

    // 只断言**读的是哪个文件**，不断言调用次数：会话发现现在还会读一次归档索引
    // （`/app-data/archive/archive-index.json`），次数会随功能增长而漂移，
    // 而这条用例真正要守住的是「不碰 v1 的老缓存」。
    const readPaths = readText.mock.calls.map((call) => call[0]);
    expect(readPaths.filter((path) => path === "/app-data/meta-cache-v2.json")).toHaveLength(3);
    expect(readPaths).not.toContain("/app-data/meta-cache.json");
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenNthCalledWith(1, "/app-data/meta-cache-v2.json", expect.any(String));
    expect(writeText).toHaveBeenNthCalledWith(2, "/app-data/meta-cache-v2.json", expect.any(String));
  });

  it("derives Windows import paths and project labels", async () => {
    bridges = createBridges({
      appDataDir: vi.fn(async () => "C:\\Users\\tester\\AppData\\Roaming\\cc-analyzer"),
      stat: vi.fn(async () => ({ is_file: true, size: 12, mtime_ms: 43 }))
    });
    const repository = new SessionRepository(bridges);

    const session = await repository.importSession(
      "C:\\Users\\tester\\.claude\\projects\\repo-demo\\session.jsonl"
    );

    expect(session.projectLabel).toBe("repo-demo");
    expect(bridges.fs.writeText).toHaveBeenCalledWith(
      "C:\\Users\\tester\\AppData\\Roaming\\cc-analyzer\\meta-cache-v2.json",
      expect.any(String)
    );
  });

  it("serves archived sessions whose original Claude Code already cleaned up", async () => {
    // 源文件（/home/tester/.claude/.../session.jsonl）已经不在磁盘上了——
    // 它在 ~/.claude 里被清理，但归档副本还在，列表必须仍然看得见它。
    const gone = "/home/tester/.claude/projects/-repo-old/gone.jsonl";
    const archivePath = "/app-data/archive/-repo-old/gone.jsonl";
    const index = {
      version: 1,
      entries: {
        [gone]: {
          sourcePath: gone,
          archivePath,
          projectLabel: "-repo-old",
          sessionId: "gone",
          sizeBytes: 4096,
          mtimeMs: 1_600_000_000_000,
          archivedAt: 1_800_000_000_000
        }
      }
    };
    bridges = createBridges({
      readText: vi.fn(async (path: string) =>
        path.endsWith("archive-index.json")
          ? JSON.stringify(index)
          : JSON.stringify({ version: 2, generatedAt: 1, entries: {} })
      )
    });

    const repository = new SessionRepository(bridges);
    const sessions = await repository.listSessions();
    const archived = sessions.find((session) => session.path === archivePath);

    expect(archived).toBeDefined();
    // 归档标记：列表据此显示「已归档」，而不是把它当成一份普通会话。
    expect(archived?.archived).toBe(true);
    // **原始** mtime：时间线分组、相对时间、用量趋势都要说那次会话发生在什么时候，
    // 而不是「我什么时候备份的」。
    expect(archived?.mtimeMs).toBe(1_600_000_000_000);
    expect(archived?.projectLabel).toBe("-repo-old");
    // 仍存在于 ~/.claude 的会话只有一份：归档不产生第二个条目。
    expect(sessions.filter((session) => !session.archived)).toHaveLength(1);

    // 补全元数据会拿缓存字段重建对象——这一步必须把 `archived` 带过去，
    // 否则列表里的「已归档」标记会在这里静默消失（端到端抓到的回归）。
    const completed = await repository.completeMetadata(sessions);
    const archivedAfterComplete = completed.find((session) => session.path === archivePath);
    expect(archivedAfterComplete?.archived).toBe(true);
    expect(archivedAfterComplete?.metadataStatus).toBe("complete");
  });
});
