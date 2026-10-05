import {
  ARCHIVE_DIR_NAME,
  archiveFootprint,
  archiveIndexPathOf,
  archivePathFor,
  archiveRootOf,
  archivedSessions,
  emptyArchiveIndex,
  entryFor,
  needsArchive,
  normalizeArchiveIndex,
  planArchive,
  withArchivedEntry,
  type ArchiveEntry
} from "./archiveIndex";
import type { SessionMeta } from "../sessions/metadataCache";

const APP_DATA = "/home/me/Library/Application Support/app";
const LIVE = "/home/me/.claude/projects/-repo-demo/3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11.jsonl";

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    path: LIVE,
    projectLabel: "-repo-demo",
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 2048,
    hasRecords: true,
    ...overrides
  };
}

function entry(overrides: Partial<ArchiveEntry> = {}): ArchiveEntry {
  return {
    sourcePath: LIVE,
    archivePath: `${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/session.jsonl`,
    projectLabel: "-repo-demo",
    sessionId: "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11",
    sizeBytes: 2048,
    mtimeMs: 1_700_000_000_000,
    archivedAt: 1_800_000_000_000,
    ...overrides
  };
}

test("lays the archive out under the app data directory, grouped by project", () => {
  expect(archiveRootOf(APP_DATA)).toBe(`${APP_DATA}/${ARCHIVE_DIR_NAME}`);
  expect(archiveIndexPathOf(APP_DATA)).toBe(`${APP_DATA}/${ARCHIVE_DIR_NAME}/archive-index.json`);
  expect(archivePathFor(APP_DATA, meta())).toBe(
    `${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11.jsonl`
  );
});

test("copies only what is new or changed", () => {
  const session = meta();
  expect(needsArchive(undefined, session)).toBe(true);
  expect(needsArchive(entry(), session)).toBe(false);
  // 只改 mtime（大小不变）或只改大小（mtime 不变）都要重新归档：
  // `cp -p` 这类操作会让时间戳与内容不一致，两个信号缺一不可。
  expect(needsArchive(entry(), { ...session, mtimeMs: session.mtimeMs + 1 })).toBe(true);
  expect(needsArchive(entry(), { ...session, sizeBytes: session.sizeBytes + 1 })).toBe(true);
});

test("plans a first full run and then an incremental no-op", () => {
  const first = planArchive([meta()], emptyArchiveIndex());
  expect(first.pending).toHaveLength(1);
  expect(first.upToDate).toBe(0);

  const index = withArchivedEntry(emptyArchiveIndex(), entry());
  const second = planArchive([meta()], index);
  expect(second.pending).toHaveLength(0);
  expect(second.upToDate).toBe(1);
});

test("drops malformed index entries instead of trusting the file", () => {
  const good = entry();
  const index = normalizeArchiveIndex({
    version: 1,
    entries: {
      [good.sourcePath]: good,
      // 键与 sourcePath 不一致（手改或串了）
      "/other/path.jsonl": { ...good, sourcePath: "/different.jsonl" },
      // 缺字段
      "/broken.jsonl": { sourcePath: "/broken.jsonl" },
      // 数字字段是字符串
      "/typed.jsonl": { ...good, sourcePath: "/typed.jsonl", sizeBytes: "2048" }
    }
  });
  expect(Object.keys(index.entries)).toEqual([good.sourcePath]);
});

test("tolerates a missing or non-object index", () => {
  expect(normalizeArchiveIndex(null).entries).toEqual({});
  expect(normalizeArchiveIndex("nope").entries).toEqual({});
  expect(normalizeArchiveIndex({ entries: 42 }).entries).toEqual({});
});

test("serves archived sessions only when the original is gone", () => {
  const index = withArchivedEntry(emptyArchiveIndex(), entry());

  // 源文件还在：以源为准，不产生重复条目。
  expect(archivedSessions(index, new Set([LIVE]))).toHaveLength(0);

  // 源文件被 Claude Code 清理：副本顶上，且带着**原始**mtime。
  const [survivor] = archivedSessions(index, new Set());
  expect(survivor.path).toBe(entry().archivePath);
  expect(survivor.mtimeMs).toBe(entry().mtimeMs);
  expect(survivor.archived).toBe(true);
  expect(survivor.projectLabel).toBe("-repo-demo");
  expect(survivor.hasRecords).toBe(true);
});

test("keeps the newest archive timestamp for the status line", () => {
  const index = withArchivedEntry(
    withArchivedEntry(emptyArchiveIndex(), entry({ archivedAt: 1_800_000_000_000 })),
    entry({ sourcePath: "/second.jsonl", archivedAt: 1_900_000_000_000 })
  );
  expect(archiveFootprint(index)).toEqual({
    count: 2,
    bytes: 4096,
    lastArchivedAt: 1_900_000_000_000
  });
  expect(archiveFootprint(emptyArchiveIndex())).toEqual({
    count: 0,
    bytes: 0,
    lastArchivedAt: null
  });
});

test("stamps an entry from the session it copies", () => {
  const stamped = entryFor(APP_DATA, meta(), 1_900_000_000_000);
  expect(stamped).toEqual({
    sourcePath: LIVE,
    archivePath: archivePathFor(APP_DATA, meta()),
    projectLabel: "-repo-demo",
    sessionId: "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11",
    sizeBytes: 2048,
    mtimeMs: 1_700_000_000_000,
    archivedAt: 1_900_000_000_000
  });
});
