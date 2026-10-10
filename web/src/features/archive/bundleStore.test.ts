import { describe, expect, it, vi } from "vitest";
import type { Bridges, BundleEntry, BundleManifest } from "../../api/types";
import { ARCHIVE_DIR_NAME } from "./archiveIndex";
import { exportArchiveBundle, importArchiveBundle } from "./bundleStore";

const APP_DATA = "/app-data";
const INDEX_PATH = `${APP_DATA}/${ARCHIVE_DIR_NAME}/archive-index.json`;

function entry(sourcePath: string, overrides: Partial<BundleEntry> = {}): BundleEntry {
  return {
    sourcePath,
    archivePath: `/other-machine/archive/-repo-demo/${sourcePath.split("/").pop()}`,
    projectLabel: "-repo-demo",
    sessionId: (sourcePath.split("/").pop() ?? "").replace(/\.jsonl$/, ""),
    sizeBytes: 12,
    mtimeMs: 1_700_000_000_000,
    ...overrides
  };
}

function manifest(entries: BundleEntry[]): BundleManifest {
  return {
    formatVersion: 1,
    exportedAt: 0,
    appVersion: "1.2.3",
    entries: entries.map((item) => ({ ...item, sha256: "a".repeat(64) }))
  };
}

type Options = {
  /** 已经在盘上的文件（索引、归档副本、临时目录里的明文）。 */
  files?: Record<string, string>;
  /** `import_archive_bundle` 的返回；不给就让命令抛错。 */
  importResult?: { manifest: BundleManifest; files: Array<{ entry: BundleEntry; stagedPath: string }> };
  importError?: Error;
  savePath?: string | null;
  openPath?: string | null;
  exportResult?: { entries: number; bytes: number };
};

function createBridges(options: Options = {}) {
  const files: Record<string, string> = { ...options.files };
  const exportBundle = vi.fn(
    async (_outPath: string, _password: string, _entries: BundleEntry[]) =>
      options.exportResult ?? { entries: 0, bytes: 0 }
  );
  const importBundle = vi.fn(async (_inPath: string, _password: string, _stagingDir: string) => {
    if (options.importError) throw options.importError;
    if (!options.importResult) throw new Error("测试没有配置 importResult");
    return options.importResult;
  });
  const removeStaging = vi.fn(async (_stagingDir: string) => undefined);
  const savePath = vi.fn(async () => options.savePath ?? null);
  const openFile = vi.fn(async () => options.openPath ?? null);
  const writeText = vi.fn(async (path: string, contents: string) => {
    files[path] = contents;
  });

  const bridges = {
    fs: {
      appDataDir: vi.fn(async () => APP_DATA),
      homeDir: vi.fn(async () => "/home/tester"),
      // 活会话清单为空：本组用例关心的都是「本机没有这个 sourcePath」这条路径。
      readDir: vi.fn(async () => []),
      readHead: vi.fn(async () => ""),
      stat: vi.fn(async () => ({ is_file: true, size: 1, mtime_ms: 1 })),
      readText: vi.fn(async (path: string) => {
        if (path in files) return files[path];
        throw new Error(`no such file or directory: ${path}`);
      }),
      writeText
    },
    dialog: {
      savePath,
      openFile,
      saveText: vi.fn(async () => null),
      saveMarkdown: vi.fn(async () => null)
    },
    archiveBundle: { exportBundle, importBundle, removeStaging }
  } as unknown as Bridges;

  return { bridges, files, exportBundle, importBundle, removeStaging, savePath, openFile, writeText };
}

describe("exportArchiveBundle", () => {
  it("把索引里的条目交给 Rust 打包，并交回条目数与字节数", async () => {
    const bundleEntry = entry("/other/.claude/projects/-repo-demo/s1.jsonl");
    const { bridges, exportBundle } = createBridges({
      files: {
        [INDEX_PATH]: JSON.stringify({
          version: 1,
          entries: {
            [bundleEntry.sourcePath]: { ...bundleEntry, archivedAt: 1 }
          }
        })
      },
      savePath: "/Users/me/out.ccabundle",
      exportResult: { entries: 1, bytes: 4096 }
    });

    const outcome = await exportArchiveBundle(bridges, "hunter2");

    expect(outcome).toEqual({ entries: 1, bytes: 4096 });
    expect(exportBundle).toHaveBeenCalledWith("/Users/me/out.ccabundle", "hunter2", [bundleEntry]);
  });

  it("用户取消系统对话框不是失败：返回 null，也不调打包命令", async () => {
    const bundleEntry = entry("/other/.claude/projects/-repo-demo/s1.jsonl");
    const { bridges, exportBundle } = createBridges({
      files: {
        [INDEX_PATH]: JSON.stringify({
          version: 1,
          entries: { [bundleEntry.sourcePath]: { ...bundleEntry, archivedAt: 1 } }
        })
      },
      savePath: null
    });

    expect(await exportArchiveBundle(bridges, "hunter2")).toBeNull();
    expect(exportBundle).not.toHaveBeenCalled();
  });

  it("本地归档为空时明确拒绝，不乱导一个空包", async () => {
    const { bridges, exportBundle } = createBridges();

    await expect(exportArchiveBundle(bridges, "hunter2")).rejects.toThrow("本地归档为空");
    expect(exportBundle).not.toHaveBeenCalled();
  });
});

describe("importArchiveBundle", () => {
  const staged = entry("/other/.claude/projects/-repo-demo/s1.jsonl");

  it("把临时目录里的明文搬进归档并写回索引", async () => {
    const { bridges, files, removeStaging, importBundle } = createBridges({
      files: { "/app-data/import-staging-1/-repo-demo/s1.jsonl": "hello" },
      openPath: "/Users/me/in.ccabundle",
      importResult: {
        manifest: manifest([staged]),
        files: [{ entry: staged, stagedPath: "/app-data/import-staging-1/-repo-demo/s1.jsonl" }]
      }
    });

    const outcome = await importArchiveBundle(bridges, "hunter2");

    expect(importBundle).toHaveBeenCalledWith(
      "/Users/me/in.ccabundle",
      "hunter2",
      expect.stringMatching(/^\/app-data\/import-staging-\d+$/)
    );
    expect(outcome?.written).toBe(1);
    expect(outcome?.readout.text).toBe("新增 1 · 已存在 0 · 并列 0 · 失败 0");
    expect(files[`${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/s1.jsonl`]).toBe("hello");
    const index = JSON.parse(files[INDEX_PATH]) as { entries: Record<string, { sourcePath: string }> };
    expect(index.entries[staged.sourcePath].sourcePath).toBe(staged.sourcePath);
    // 临时目录里是明文：用完必须清掉，成功路径也一样。
    expect(removeStaging).toHaveBeenCalledTimes(1);
    expect(removeStaging).toHaveBeenCalledWith(importBundle.mock.calls[0][2]);
  });

  it("口令错（解包抛错）时仍然清掉临时目录，且不写索引", async () => {
    const { bridges, files, removeStaging, writeText } = createBridges({
      openPath: "/Users/me/in.ccabundle",
      importError: new Error("口令错误：无法解密归档包")
    });

    await expect(importArchiveBundle(bridges, "wrong")).rejects.toThrow("口令错误");

    expect(removeStaging).toHaveBeenCalledTimes(1);
    expect(removeStaging.mock.calls[0][0]).toMatch(/^\/app-data\/import-staging-\d+$/);
    // 一条都没有搬进来：索引一个字节都不该被改写。
    expect(writeText).not.toHaveBeenCalled();
    expect(files[INDEX_PATH]).toBeUndefined();
  });

  it("单条失败不阻断其余条目，并且点名是哪一条", async () => {
    const good = entry("/other/.claude/projects/-repo-demo/good.jsonl");
    const missing = entry("/other/.claude/projects/-repo-demo/missing.jsonl");
    const { bridges, files, removeStaging } = createBridges({
      files: { "/app-data/import-staging-1/-repo-demo/good.jsonl": "ok" },
      openPath: "/Users/me/in.ccabundle",
      importResult: {
        manifest: manifest([good, missing]),
        files: [
          { entry: good, stagedPath: "/app-data/import-staging-1/-repo-demo/good.jsonl" },
          { entry: missing, stagedPath: "/app-data/import-staging-1/-repo-demo/missing.jsonl" }
        ]
      }
    });

    const outcome = await importArchiveBundle(bridges, "hunter2");

    expect(outcome?.written).toBe(1);
    expect(outcome?.failures).toHaveLength(1);
    expect(outcome?.failures[0].sourcePath).toBe(missing.sourcePath);
    expect(outcome?.failures[0].reason).toContain("no such file");
    // 计数按结果走：失败的那条从「新增」里扣掉，四个数加起来正好是包里的条目数。
    expect(outcome?.readout.text).toBe("新增 1 · 已存在 0 · 并列 0 · 失败 1");
    expect(files[`${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/good.jsonl`]).toBe("ok");
    expect(files[`${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/missing.jsonl`]).toBeUndefined();
    expect(removeStaging).toHaveBeenCalledTimes(1);
  });

  it("本机已有同一份内容（同 sessionId + 同大小 + 同时间）时不产生新的归档落点", async () => {
    const localEntry = entry("/local/.claude/projects/-repo-demo/s1.jsonl");
    const incoming = entry("/other/.claude/projects/-repo-demo/s1.jsonl");
    const { bridges, files, writeText } = createBridges({
      files: {
        [INDEX_PATH]: JSON.stringify({
          version: 1,
          entries: { [localEntry.sourcePath]: { ...localEntry, archivedAt: 1 } }
        }),
        "/app-data/import-staging-1/-repo-demo/s1.jsonl": "hello"
      },
      openPath: "/Users/me/in.ccabundle",
      importResult: {
        manifest: manifest([incoming]),
        files: [{ entry: incoming, stagedPath: "/app-data/import-staging-1/-repo-demo/s1.jsonl" }]
      }
    });

    const outcome = await importArchiveBundle(bridges, "hunter2");

    expect(outcome?.written).toBe(0);
    expect(outcome?.readout.text).toBe("新增 0 · 已存在 1 · 并列 0 · 失败 0");
    // 既不写副本，也不重写索引：归档目录里不会多出第二个落点。
    expect(writeText).not.toHaveBeenCalled();
    const index = JSON.parse(files[INDEX_PATH]) as { entries: Record<string, unknown> };
    expect(Object.keys(index.entries)).toEqual([localEntry.sourcePath]);
  });

  it("用户取消选择文件时什么都不做，也不碰临时目录", async () => {
    const { bridges, importBundle, removeStaging } = createBridges({ openPath: null });

    expect(await importArchiveBundle(bridges, "hunter2")).toBeNull();
    expect(importBundle).not.toHaveBeenCalled();
    expect(removeStaging).not.toHaveBeenCalled();
  });
});
