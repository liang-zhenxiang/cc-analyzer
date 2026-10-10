import { describe, expect, it } from "vitest";
import type { BundleEntry, BundleManifest } from "../../api/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { emptyArchiveIndex, type ArchiveEntry, type ArchiveIndex } from "./archiveIndex";
import {
  archivePathForImport,
  bundleEntriesFromIndex,
  describeImportResult,
  planImport
} from "./bundle";

const APP_DATA = "/app-data";

/** 导出机器上的一份会话。 */
function entry(overrides: Partial<BundleEntry> & { sourcePath: string }): BundleEntry {
  return {
    archivePath: "/other-machine/archive/-repo-demo/s1.jsonl",
    projectLabel: "-repo-demo",
    sessionId: "s1",
    sizeBytes: 100,
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

function indexEntry(overrides: Partial<ArchiveEntry> & { sourcePath: string }): ArchiveEntry {
  return {
    archivePath: `${APP_DATA}/archive/-repo-demo/s1.jsonl`,
    projectLabel: "-repo-demo",
    sessionId: "s1",
    sizeBytes: 100,
    mtimeMs: 1_700_000_000_000,
    archivedAt: 1_700_000_100_000,
    ...overrides
  };
}

function indexOf(entries: ArchiveEntry[]): ArchiveIndex {
  const index = emptyArchiveIndex();
  for (const value of entries) index.entries[value.sourcePath] = value;
  return index;
}

function liveSession(path: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    path,
    projectLabel: "-repo-demo",
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 100,
    hasRecords: true,
    ...overrides
  };
}

describe("bundleEntriesFromIndex", () => {
  it("取出索引里的条目并按 sourcePath 定序，字段一一对应", () => {
    const index = indexOf([
      indexEntry({ sourcePath: "/b/b.jsonl", archivePath: `${APP_DATA}/archive/-repo-b/b.jsonl` }),
      indexEntry({ sourcePath: "/a/a.jsonl", archivePath: `${APP_DATA}/archive/-repo-a/a.jsonl` })
    ]);

    expect(bundleEntriesFromIndex(index)).toEqual([
      {
        sourcePath: "/a/a.jsonl",
        archivePath: `${APP_DATA}/archive/-repo-a/a.jsonl`,
        projectLabel: "-repo-demo",
        sessionId: "s1",
        sizeBytes: 100,
        mtimeMs: 1_700_000_000_000
      },
      {
        sourcePath: "/b/b.jsonl",
        archivePath: `${APP_DATA}/archive/-repo-b/b.jsonl`,
        projectLabel: "-repo-demo",
        sessionId: "s1",
        sizeBytes: 100,
        mtimeMs: 1_700_000_000_000
      }
    ]);
  });

  it("空索引给出空列表", () => {
    expect(bundleEntriesFromIndex(emptyArchiveIndex())).toEqual([]);
  });
});

describe("planImport", () => {
  const incoming = entry({ sourcePath: "/other-machine/.claude/projects/-repo-demo/s1.jsonl" });

  it("本机完全没有这个会话 → 新增", () => {
    const plan = planImport(manifest([incoming]), emptyArchiveIndex(), []);

    expect(plan.add).toEqual(manifest([incoming]).entries);
    expect(plan.alreadyHave).toEqual([]);
    expect(plan.keepBoth).toEqual([]);
  });

  it("同一份包导入两次：第二次全部命中索引 → 已存在（幂等）", () => {
    // 第一次导入：归档落点照 bundleStore 的算法写进索引。
    const bundle = manifest([incoming]);
    const first = planImport(bundle, emptyArchiveIndex(), []);
    expect(first.add).toHaveLength(1);
    expect(first.alreadyHave).toHaveLength(0);

    const index = indexOf([
      indexEntry({
        sourcePath: incoming.sourcePath,
        archivePath: archivePathForImport(APP_DATA, incoming, new Set())
      })
    ]);

    const second = planImport(bundle, index, []);
    expect(second.alreadyHave).toEqual(bundle.entries);
    expect(second.add).toEqual([]);
    expect(second.keepBoth).toEqual([]);
  });

  it("同 sessionId 但大小/时间不同 → 并列保留，两份都留下", () => {
    const locals = indexOf([
      indexEntry({ sourcePath: "/local/.claude/projects/-repo-demo/s1.jsonl", sizeBytes: 100 })
    ]);
    const grown = entry({
      sourcePath: "/other-machine/.claude/projects/-repo-demo/s1.jsonl",
      sizeBytes: 250
    });

    const plan = planImport(manifest([grown]), locals, []);

    expect(plan.keepBoth).toEqual(manifest([grown]).entries);
    expect(plan.add).toEqual([]);
    expect(plan.alreadyHave).toEqual([]);
  });

  it("判定用本机的活会话清单，不只看索引", () => {
    const live = [
      liveSession("/home/me/.claude/projects/-repo-demo/s1.jsonl", { sizeBytes: 100 })
    ];
    const grown = entry({
      sourcePath: "/other-machine/.claude/projects/-repo-demo/s1.jsonl",
      sizeBytes: 250
    });

    const plan = planImport(manifest([grown]), emptyArchiveIndex(), live);

    expect(plan.keepBoth).toEqual(manifest([grown]).entries);
  });

  it("同 sessionId 且大小/时间完全相同 → 已存在（内容相同就是同一份，不新增第二行）", () => {
    // 只有机器的 `$HOME` 不同：本机那份还在 ~/.claude 里，但从没进过归档。
    const live = [liveSession("/home/me/.claude/projects/-repo-demo/s1.jsonl")];

    const plan = planImport(manifest([incoming]), emptyArchiveIndex(), live);

    expect(plan.alreadyHave).toEqual(manifest([incoming]).entries);
    expect(plan.add).toEqual([]);
    expect(plan.keepBoth).toEqual([]);
  });

  it("同 sessionId、大小时间完全相同但本机只在索引里有 → 也是已存在", () => {
    // 索引里的那份来自更早一次导入（`sourcePath` 与包里的不同）；内容一致即同一份。
    const locals = indexOf([
      indexEntry({ sourcePath: "/earlier-machine/.claude/projects/-repo-demo/s1.jsonl" })
    ]);

    const plan = planImport(manifest([incoming]), locals, []);

    expect(plan.alreadyHave).toEqual(manifest([incoming]).entries);
    expect(plan.keepBoth).toEqual([]);
  });
});

describe("describeImportResult", () => {
  it("四类计数永远都印出来", () => {
    const readout = describeImportResult(
      { add: [entry({ sourcePath: "/a" })], alreadyHave: [entry({ sourcePath: "/b" })], keepBoth: [] },
      [{ sourcePath: "/c", reason: "sha256 不匹配" }]
    );

    expect(readout).toEqual({
      added: 1,
      alreadyHave: 1,
      keepBoth: 0,
      failed: 1,
      text: "新增 1 · 已存在 1 · 并列 0 · 失败 1"
    });
  });
});

describe("archivePathForImport", () => {
  it("常规沿用 <archive>/<项目>/<会话>.jsonl", () => {
    expect(archivePathForImport(APP_DATA, entry({ sourcePath: "/x/s1.jsonl" }), new Set())).toBe(
      `${APP_DATA}/archive/-repo-demo/s1.jsonl`
    );
  });

  it("落点已被别的来源占用时补一段短哈希，绝不覆盖", () => {
    const taken = new Set([`${APP_DATA}/archive/-repo-demo/s1.jsonl`]);
    const path = archivePathForImport(APP_DATA, entry({ sourcePath: "/x/s1.jsonl" }), taken);

    expect(path).not.toBe(`${APP_DATA}/archive/-repo-demo/s1.jsonl`);
    expect(path).toMatch(new RegExp(`^${APP_DATA}/archive/-repo-demo/s1-[0-9a-f]{8}\\.jsonl$`));
    // 同一个 sourcePath 每次都算出同一个落点（重导不会到处留副本）。
    expect(path).toBe(
      archivePathForImport(APP_DATA, entry({ sourcePath: "/x/s1.jsonl" }), taken)
    );
  });
});
