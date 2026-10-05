import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bridges } from "../../api/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { ARCHIVE_DIR_NAME } from "./archiveIndex";
import {
  disable,
  enable,
  getArchiveTask,
  loadArchiveEnabled,
  refreshStatus,
  resetArchiveTask,
  runNow
} from "./archiveTask";

const APP_DATA = "/app-data";
const INDEX_PATH = `${APP_DATA}/${ARCHIVE_DIR_NAME}/archive-index.json`;

/**
 * 只实现归档用得到的那几个 fs 方法（照 archiveStore.test.ts 的写法）：
 * 写过的文件读得到、没写过的按「不存在」抛错。会话直接传进 runNow，
 * 因此不需要模拟整个 ~/.claude 扫描。
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

function session(path: string): SessionMeta {
  return {
    path,
    projectLabel: "-repo-demo",
    mtimeMs: 1_700_000_000_000,
    sizeBytes: 128,
    hasRecords: true
  };
}

const A = "/home/me/.claude/projects/-repo-demo/a.jsonl";
const B = "/home/me/.claude/projects/-repo-demo/b.jsonl";

beforeEach(() => {
  localStorage.clear();
  resetArchiveTask();
  localStorage.clear();
});

describe("the persisted switch", () => {
  it("is off by default and tolerates unreadable / unexpected storage", () => {
    expect(loadArchiveEnabled({ getItem: () => null })).toBe(false);
    expect(loadArchiveEnabled({ getItem: () => "banana" })).toBe(false);
    expect(loadArchiveEnabled({ getItem: () => "on" })).toBe(true);
    expect(
      loadArchiveEnabled({
        getItem: () => {
          throw new Error("blocked");
        }
      })
    ).toBe(false);
  });

  it("writes on / off when the toggle flips", () => {
    expect(getArchiveTask().enabled).toBe(false);

    enable();
    expect(getArchiveTask().enabled).toBe(true);
    expect(localStorage.getItem("cca-archive-enabled")).toBe("on");

    disable();
    expect(getArchiveTask().enabled).toBe(false);
    expect(localStorage.getItem("cca-archive-enabled")).toBe("off");
  });
});

describe("runNow", () => {
  it("does not touch the bridges while the switch is off", async () => {
    const { bridges, writeText } = createBridges({ [A]: "A" });

    await runNow(bridges, [session(A)]);

    expect(writeText).not.toHaveBeenCalled();
    expect(getArchiveTask().status).toBe("idle");
  });

  it("copies on an enabled run, moving running -> done and updating the footprint", async () => {
    const { bridges, written } = createBridges({ [A]: "A", [B]: "B" });
    enable();

    const promise = runNow(bridges, [session(A), session(B)]);
    expect(getArchiveTask().status).toBe("running");

    await promise;

    const state = getArchiveTask();
    expect(state.status).toBe("done");
    expect(state.lastRun).toEqual({ copied: 2, skipped: 0, failures: [] });
    expect(state.footprint.count).toBe(2);
    expect(state.footprint.bytes).toBe(256);
    expect(state.footprint.lastArchivedAt).toBeGreaterThan(0);
    expect(written[`${APP_DATA}/${ARCHIVE_DIR_NAME}/-repo-demo/a.jsonl`]).toBe("A");
  });

  it("records a failed copy as an error with the bridge's reason", async () => {
    const { bridges } = createBridges({ [A]: "A" });
    vi.mocked(bridges.fs.writeText).mockRejectedValue(new Error("no space left on device"));
    enable();

    await runNow(bridges, [session(A)]);

    const state = getArchiveTask();
    expect(state.status).toBe("error");
    expect(state.error).toContain("no space left on device");
    expect(state.lastRun?.failures).toHaveLength(1);
    // 一个都没复制成功：不写索引，占用仍为空。
    expect(state.footprint.count).toBe(0);
  });

  it("is a no-op while a run is already in flight", async () => {
    const { bridges, writeText } = createBridges({ [A]: "A" });
    enable();

    const first = runNow(bridges, [session(A)]);
    const second = runNow(bridges, [session(A)]);
    await Promise.all([first, second]);

    // writeText: 一次副本 + 一次索引，第二次点击没有叠加。
    expect(writeText).toHaveBeenCalledTimes(2);
  });
});

describe("refreshStatus", () => {
  it("flags a corrupt index instead of pretending it was empty", async () => {
    const { bridges } = createBridges({ [INDEX_PATH]: "{ not json" });

    await refreshStatus(bridges);

    const state = getArchiveTask();
    expect(state.indexCorrupt).toBe(true);
    expect(state.footprint.count).toBe(0);
  });

  it("reports the footprint of an index that is already on disk", async () => {
    const { bridges } = createBridges({ [A]: "A" });
    enable();
    await runNow(bridges, [session(A)]);
    resetArchiveTask();
    localStorage.clear();

    await refreshStatus(bridges);

    const state = getArchiveTask();
    expect(state.indexCorrupt).toBe(false);
    expect(state.footprint.count).toBe(1);
    expect(state.footprint.bytes).toBe(128);
  });
});
