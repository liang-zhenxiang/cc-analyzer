import { describe, expect, it, vi } from "vitest";
import type { Bridges } from "../../api/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { ARCHIVE_DIR_NAME } from "./archiveIndex";
import { readArchiveIndex, runArchive } from "./archiveStore";

const APP_DATA = "/app-data";
const INDEX_PATH = `${APP_DATA}/${ARCHIVE_DIR_NAME}/archive-index.json`;

/**
 * 只实现归档用得到的那几个 fs 方法：写过的文件读得到、没写过的按「不存在」抛错
 * ——与真实桥接的失败方式一致，才能测出「首次运行没有索引」这条路径。
 */
function createBridges(files: Record<string, string> = {}) {
  const written: Record<string, string> = {};
  const writeText = vi.fn(async (path: string, contents: string) => {
    written[path] = contents;
  });
  const bridges = {
    fs: {
      appDataDir: vi.fn(async () => APP_DATA),
      readText: vi.fn(async (path: string) => {
        if (path in written) return written[path];
        if (path in files) return files[path];
        throw new Error(`no such file or directory: ${path}`);
      }),
      writeText
    }
  } as unknown as Bridges;
  return { bridges, written, writeText };
}

function session(path: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    path,
    projectLabel: "-repo-demo",
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 128,
    hasRecords: true,
    ...overrides
  };
}

const A = "/home/me/.claude/projects/-repo-demo/a.jsonl";
const B = "/home/me/.claude/projects/-repo-demo/b.jsonl";

describe("runArchive", () => {
  it("copies everything on the first run and writes the index once", async () => {
    const { bridges, written } = createBridges({ [A]: "A", [B]: "B" });
    const progress: Array<[number, number]> = [];

    const { index, run } = await runArchive(
      bridges,
      [session(A), session(B)],
      { version: 1, entries: {} },
      (done, total) => progress.push([done, total])
    );

    expect(run).toEqual({ copied: 2, skipped: 0, failures: [] });
    expect(written[`${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/a.jsonl`]).toBe("A");
    expect(written[`${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/b.jsonl`]).toBe("B");
    expect(Object.keys(index.entries)).toEqual([A, B]);
    expect(progress).toEqual([
      [1, 2],
      [2, 2]
    ]);
  });

  it("is idempotent: the second run copies nothing and does not rewrite the index", async () => {
    const { bridges, written } = createBridges({ [A]: "A" });
    const first = await runArchive(bridges, [session(A)], { version: 1, entries: {} });
    const afterFirst = written[INDEX_PATH];

    const second = await runArchive(bridges, [session(A)], first.index);

    expect(second.run).toEqual({ copied: 0, skipped: 1, failures: [] });
    expect(second.index).toBe(first.index);
    expect(written[INDEX_PATH]).toBe(afterFirst);
  });

  it("re-copies a session whose size changed since the last run", async () => {
    const { bridges } = createBridges({ [A]: "A", [B]: "B" });
    const first = await runArchive(bridges, [session(A), session(B)], { version: 1, entries: {} });

    const grown = session(B, { sizeBytes: 999 });
    const second = await runArchive(bridges, [session(A), grown], first.index);

    expect(second.run.copied).toBe(1);
    expect(second.run.skipped).toBe(1);
    expect(second.index.entries[B].sizeBytes).toBe(999);
  });

  it("keeps going when one file cannot be read, and records why", async () => {
    const { bridges, written } = createBridges({ [A]: "A" });
    const { index, run } = await runArchive(bridges, [session(A), session(B)], {
      version: 1,
      entries: {}
    });

    expect(run.copied).toBe(1);
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0].path).toBe(B);
    expect(run.failures[0].reason).toContain("no such file");
    // 失败的那条不进索引：宁可在界面上报出来，也不留一个指向空文件的条目。
    expect(Object.keys(index.entries)).toEqual([A]);
    expect(written[`${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/b.jsonl`]).toBeUndefined();
  });
});

describe("readArchiveIndex", () => {
  it("treats a missing index as the normal first-run state", async () => {
    const { bridges } = createBridges();
    const { index, corrupt } = await readArchiveIndex(bridges);
    expect(index.entries).toEqual({});
    expect(corrupt).toBe(false);
  });

  it("flags an unparsable index instead of pretending it was empty", async () => {
    const { bridges } = createBridges({ [INDEX_PATH]: "{ not json" });
    const { index, corrupt } = await readArchiveIndex(bridges);
    expect(index.entries).toEqual({});
    expect(corrupt).toBe(true);
  });

  it("round-trips what runArchive wrote", async () => {
    const { bridges } = createBridges({ [A]: "A" });
    const { index } = await runArchive(bridges, [session(A)], { version: 1, entries: {} });
    const reread = await readArchiveIndex(bridges);
    expect(reread.corrupt).toBe(false);
    expect(reread.index).toEqual(index);
  });
});
