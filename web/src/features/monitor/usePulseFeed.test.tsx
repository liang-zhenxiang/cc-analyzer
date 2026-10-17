import { act } from "react";
import type { ReactNode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { sharedSessionParseCache } from "../sessions/sessionParseCache";
import { DISCOVERY_MS, FAST_TICK_MS, usePulseFeed } from "./usePulseFeed";

const PROJECTS_ROOT = "/home/tester/.claude/projects";
const PROJECT_DIR = `${PROJECTS_ROOT}/-repo-demo`;
const SESSION_PATH = `${PROJECT_DIR}/s-active.jsonl`;
const OLD_PATH = `${PROJECT_DIR}/s-old.jsonl`;

/** 固定时钟：假定时器下 Date.now() 就是它，两拍之间的时间才可断言。 */
const NOW = new Date(2026, 9, 15, 12, 0, 0, 0).getTime();

/** 一条 usage（110 tokens），与托盘测试同一份最小夹具的形状。 */
function sessionJsonl(at: number, extra = ""): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  const lines = [
    JSON.stringify({
      type: "user",
      sessionId: "s-active",
      cwd: "/repo/demo",
      timestamp: iso(at - 10_000),
      uuid: "u1",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "解释这段代码" }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "s-active",
      cwd: "/repo/demo",
      timestamp: iso(at),
      uuid: "a1",
      parentUuid: "u1",
      isSidechain: false,
      message: {
        id: "m1",
        role: "assistant",
        model: "claude-sonnet-4",
        content: [{ type: "text", text: "这是示例。" }],
        usage: { input_tokens: 100, output_tokens: 10 }
      }
    })
  ];
  return `${lines.join("\n")}\n${extra}`;
}

/** 增长后的一拍：多一条带 usage 的 assistant 记录。 */
function grownJsonl(at: number): string {
  const extra = JSON.stringify({
    type: "assistant",
    sessionId: "s-active",
    cwd: "/repo/demo",
    timestamp: new Date(at).toISOString(),
    uuid: "a2",
    parentUuid: "a1",
    isSidechain: false,
    message: {
      id: "m2",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [{ type: "text", text: "再来一条。" }],
      usage: { input_tokens: 40, output_tokens: 0 }
    }
  });
  return sessionJsonl(at - 1_000, `${extra}\n`);
}

/** 文件头里带着真标题：活跃会话的标题必须来自这里，而不是元数据缓存。 */
const TITLE_HEAD = `${JSON.stringify({
  type: "custom-title",
  customTitle: "修登录的 bug",
  sessionId: "s-active",
  cwd: "/repo/demo"
})}\n`;

type FakeFile = { content: string; mtimeMs: number };

function createBridges(options: {
  files: Record<string, FakeFile>;
  heads?: Record<string, string>;
  failList?: boolean;
}) {
  const { files } = options;
  const heads = options.heads ?? {};
  const calls = {
    stat: [] as string[],
    readText: [] as string[],
    readHead: [] as string[],
    writeText: [] as string[]
  };
  const control = {
    /** 让「列会话」失败（homeDir 是 `listSessions` 的第一步）。 */
    failList: options.failList === true,
    gate: null as null | { path: string; promise: Promise<void> },
    /** 让下一次针对 `path` 的 stat 挂住，直到放行——用来模拟慢拍。 */
    gateNextStat(path: string): () => void {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      control.gate = { path, promise };
      return release;
    }
  };

  const bridges = {
    fs: {
      homeDir: vi.fn(async () => {
        if (control.failList) throw new Error("目录不可读");
        return "/home/tester";
      }),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async (path: string) => {
        if (path === PROJECTS_ROOT) return [{ name: "-repo-demo", is_dir: true, is_file: false }];
        if (path === PROJECT_DIR) {
          return Object.keys(files).map((full) => ({
            name: full.split("/").pop() ?? full,
            is_dir: false,
            is_file: true
          }));
        }
        return [];
      }),
      stat: vi.fn(async (path: string) => {
        calls.stat.push(path);
        const gate = control.gate;
        if (gate && gate.path === path) {
          control.gate = null;
          await gate.promise;
        }
        const file = files[path];
        if (!file) throw new Error(`文件不存在 ${path}`);
        return { is_file: true, size: file.content.length, mtime_ms: file.mtimeMs };
      }),
      readText: vi.fn(async (path: string) => {
        calls.readText.push(path);
        const file = files[path];
        if (!file) throw new Error(`文件不存在 ${path}`);
        return file.content;
      }),
      readHead: vi.fn(async (path: string) => {
        calls.readHead.push(path);
        return heads[path] ?? "";
      }),
      writeText: vi.fn(async (path: string) => {
        calls.writeText.push(path);
      })
    },
    events: { onSessionImport: vi.fn(async () => () => undefined) }
  } as unknown as Bridges;

  return { bridges, calls, control };
}

function wrapperFor(bridges: Bridges) {
  return ({ children }: { children: ReactNode }) => (
    <BridgesProvider bridges={bridges}>{children}</BridgesProvider>
  );
}

/** 跑空一轮微任务（假定时器下 `advanceTimersByTimeAsync(0)` 就是「让一拍跑完」）。 */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

/** 默认夹具：一个活跃会话（mtime 就在刚刚）+ 一个 30 天前的旧会话。 */
function defaultFiles(): Record<string, FakeFile> {
  return {
    [SESSION_PATH]: { content: sessionJsonl(NOW - 30_000), mtimeMs: NOW - 30_000 },
    [OLD_PATH]: {
      content: sessionJsonl(NOW - 30 * 86_400_000),
      mtimeMs: NOW - 30 * 86_400_000
    }
  };
}

beforeEach(() => {
  sharedSessionParseCache.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  // 撤掉本用例在 document 上盖的 visibilityState，让原型上的 getter 回来。
  delete (document as unknown as { visibilityState?: string }).visibilityState;
});

describe("usePulseFeed", () => {
  it("首拍：输入与托盘同口径，标题来自文件头，不碰元数据缓存", async () => {
    const { bridges, calls } = createBridges({
      files: defaultFiles(),
      heads: { [SESSION_PATH]: TITLE_HEAD }
    });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();

    const snapshot = result.current.snapshot;
    expect(snapshot).not.toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.stale).toBeNull();
    expect(snapshot?.changed).toBe(true);
    expect(snapshot?.durationMs).toBeGreaterThanOrEqual(0);

    // 与托盘同一份收窄：30 天前的旧会话连读都没读过（`listSessions` 会 stat 它，
    // 但脉搏不会为它花一次解析）。
    expect(calls.readText).not.toContain(OLD_PATH);
    expect(snapshot?.inputs).toHaveLength(1);
    expect(snapshot?.inputs[0].projectLabel).toBe("-repo-demo");
    // 压缩事件必须跟记录一起交出去：监控台的「今天压缩」与事件流都从它读。
    // 漏传这一项不会报错，只会让那两个数恒为 0（e2e 抓到过一次）。
    expect(snapshot?.inputs[0].compactEvents).toEqual([]);
    expect(snapshot?.rows).toHaveLength(1);
    expect(snapshot?.rows[0].recency).toBe("live");
    expect(snapshot?.latest?.session.path).toBe(SESSION_PATH);
    expect(snapshot?.latest?.records).toHaveLength(2);

    // 标题走文件头（pending 会话的元数据缓存必然失配），而不是 sessionTitle(meta)。
    expect(calls.readHead).toContain(SESSION_PATH);
    expect(snapshot?.rows[0].title).toBe("修登录的 bug");

    // 绝不写 meta-cache-v2.json：多一个写者就是读-改-写竞态。
    expect(calls.writeText.filter((path) => path.includes("meta-cache"))).toEqual([]);

    unmount();
  });

  it("不重叠：上一拍没结束就不再开拍", async () => {
    const { bridges, calls, control } = createBridges({ files: defaultFiles() });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();
    expect(result.current.snapshot).not.toBeNull();
    const afterFirst = calls.stat.length;

    // 第二拍卡在 stat 上：它没结束之前，再久也不该冒出新的一拍。
    const release = control.gateNextStat(SESSION_PATH);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_TICK_MS);
    });
    const duringSlowTick = calls.stat.length;
    expect(duringSlowTick).toBeGreaterThan(afterFirst);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_TICK_MS * 6);
    });
    expect(calls.stat.length).toBe(duringSlowTick);

    release();
    await flush();
    expect(calls.stat.length).toBe(duringSlowTick);
    // 没变化的拍不该重读文件。
    expect(calls.readText.filter((path) => path === SESSION_PATH)).toHaveLength(1);

    unmount();
  });

  it("慢拍：下一拍的间隔拉到上一拍耗时的 3 倍", async () => {
    const { bridges, calls, control } = createBridges({ files: defaultFiles() });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();

    const release = control.gateNextStat(SESSION_PATH);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_TICK_MS);
    });
    // 这一拍吊在 10 秒上：时间照走，但它还没结束。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    release();
    await flush();

    const slowDuration = result.current.snapshot?.durationMs ?? 0;
    expect(slowDuration).toBeGreaterThanOrEqual(10_000);
    // 下一拍要等 max(FAST_TICK_MS, 3 × 10s) = 30s：29s 时还没动，再走 2s 才补上。
    const afterSlowTick = calls.stat.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * slowDuration - 1_000);
    });
    expect(calls.stat.length).toBe(afterSlowTick);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(calls.stat.length).toBeGreaterThan(afterSlowTick);

    unmount();
  });

  it("隐藏即停，回到可见立即补一拍", async () => {
    const { bridges, calls } = createBridges({ files: defaultFiles() });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();
    const afterFirst = calls.stat.length;

    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_TICK_MS * 4);
    });
    expect(calls.stat.length).toBe(afterFirst);
    expect(result.current.snapshot).not.toBeNull();

    act(() => setVisibility("visible"));
    await flush();
    expect(calls.stat.length).toBeGreaterThan(afterFirst);
    expect(result.current.error).toBeNull();

    unmount();
  });

  it("读取失败保留旧读数并标 stale；首拍即失败才给 error", async () => {
    const { bridges, calls, control } = createBridges({ files: defaultFiles() });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();
    const first = result.current.snapshot;
    expect(first).not.toBeNull();

    // listSessions 只在发现拍上跑：让 DISCOVERY_MS 后那一拍失败。
    control.failList = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DISCOVERY_MS);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.stale).not.toBeNull();
    expect(result.current.stale?.reason).toContain("读取失败");
    // 旧读数仍在：还是失败前那一拍的值（now 停在失败时刻之前），事实一条没丢。
    // 页面据此写「上次更新时间 · 本次读取失败」。
    expect(result.current.snapshot).not.toBeNull();
    expect(result.current.snapshot?.now).toBeLessThan(result.current.stale?.at ?? 0);
    expect(result.current.snapshot?.rows.map((row) => row.path)).toEqual(
      first?.rows.map((row) => row.path)
    );
    expect(result.current.snapshot?.inputs).toEqual(first?.inputs);

    // 下一拍成功就把 stale 摘掉。
    control.failList = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_TICK_MS);
    });
    expect(result.current.stale).toBeNull();
    expect(calls.stat.length).toBeGreaterThan(0);

    unmount();
  });

  it("首拍即失败：error 非空、没有 snapshot", async () => {
    const { bridges } = createBridges({ files: defaultFiles(), failList: true });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();

    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).not.toBeNull();
    expect(result.current.stale).toBeNull();
    expect(result.current.loading).toBe(false);

    unmount();
  });

  it("文件增长后一拍内更新，没变化的拍不重读", async () => {
    const files = defaultFiles();
    const { bridges, calls } = createBridges({ files, heads: { [SESSION_PATH]: TITLE_HEAD } });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();
    expect(calls.readText.filter((path) => path === SESSION_PATH)).toHaveLength(1);
    expect(result.current.snapshot?.inputs[0].records).toHaveLength(2);
    const firstRows = result.current.snapshot?.rows;
    const firstLatest = result.current.snapshot?.latest;

    // 没变的一拍：只 stat，不重读、不重解析。
    const afterFirst = calls.stat.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_TICK_MS);
    });
    expect(calls.stat.length).toBeGreaterThan(afterFirst);
    expect(calls.readText.filter((path) => path === SESSION_PATH)).toHaveLength(1);
    expect(result.current.snapshot?.changed).toBe(false);
    // 行每拍重算：年龄跟着 now 走，但没变的文件一个字节都没重读。
    expect(result.current.snapshot?.rows.map((row) => row.path)).toEqual([SESSION_PATH]);
    expect(result.current.snapshot?.rows[0].ageMs).toBeGreaterThan(firstRows?.[0].ageMs ?? 0);
    expect(result.current.snapshot?.latest).toEqual(firstLatest);
    expect(calls.readHead.filter((path) => path === SESSION_PATH)).toHaveLength(1);

    // 文件长了一截（mtime + size 都变）→ 下一拍就反映出来。
    files[SESSION_PATH] = { content: grownJsonl(NOW + 10_000), mtimeMs: NOW + 10_000 };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_TICK_MS);
    });
    expect(result.current.snapshot?.changed).toBe(true);
    expect(result.current.snapshot?.inputs[0].records).toHaveLength(3);
    expect(calls.readText.filter((path) => path === SESSION_PATH)).toHaveLength(2);

    unmount();
  });

  it("静置超过 5 小时：那一行从 rows 里滑出去，文件一个字节都没动", async () => {
    const { bridges, calls } = createBridges({
      files: defaultFiles(),
      heads: { [SESSION_PATH]: TITLE_HEAD }
    });

    const { result, unmount } = renderHook(() => usePulseFeed(), {
      wrapper: wrapperFor(bridges)
    });
    await flush();
    expect(result.current.snapshot?.rows).toHaveLength(1);
    const readsAfterFirst = calls.readText.filter((path) => path === SESSION_PATH).length;

    // 只推系统时间，不碰文件：行的去留只该由 `now` 决定（R2 的窗口是「最近 5 小时」）。
    for (let hour = 0; hour < 4; hour += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_600_000);
      });
    }
    expect(result.current.snapshot?.rows).toHaveLength(1);
    expect(result.current.snapshot?.rows[0].recency).toBe("idle");

    // 第五个小时过去，最后一条记录已经出窗：列表里不该再挂着它。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_600_000);
    });
    expect(result.current.snapshot?.rows).toEqual([]);
    expect(result.current.snapshot?.latest).toBeNull();

    // 全程零 I/O 增长：没有一次重读、重解析，也没有观察到文件变化。
    expect(calls.readText.filter((path) => path === SESSION_PATH)).toHaveLength(readsAfterFirst);
    expect(result.current.snapshot?.changed).toBe(false);

    unmount();
  });
});
