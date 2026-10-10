import { act } from "react";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges, TrayReadout } from "../../api/types";
import { sharedSessionParseCache } from "../sessions/sessionParseCache";
import { setPlan } from "./planLimits";
import {
  setTrayEnabled,
  TRAY_ENABLED_KEY,
  TRAY_TICK_MS,
  useTrayReadout
} from "./useTrayReadout";

const PROJECTS_ROOT = "/home/tester/.claude/projects";
const PROJECT_DIR = `${PROJECTS_ROOT}/-repo-demo`;
const RECENT_PATH = `${PROJECT_DIR}/recent.jsonl`;
const OLD_PATH = `${PROJECT_DIR}/old.jsonl`;

const NOW = Date.now();

/** 一份最小会话：一条 assistant 记录带 usage（110 tokens）。 */
function sessionJsonl(at: number): string {
  const iso = (ms: number) => new Date(ms).toISOString();
  return (
    [
      JSON.stringify({
        type: "user",
        sessionId: "s-recent",
        cwd: "/repo/demo",
        timestamp: iso(at - 10_000),
        uuid: "u1",
        parentUuid: null,
        isSidechain: false,
        message: { role: "user", content: "解释这段代码" }
      }),
      JSON.stringify({
        type: "assistant",
        sessionId: "s-recent",
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
    ].join("\n") + "\n"
  );
}

type FakeFile = { content: string; mtimeMs: number };

function createBridges(files: Record<string, FakeFile> = {}) {
  const written: Record<string, string> = {};
  const updateReadout = vi.fn(
    async (_readout: TrayReadout | null): Promise<void> => undefined
  );
  const setVisible = vi.fn(async (_visible: boolean): Promise<void> => undefined);

  const bridges = {
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async (path: string) => {
        if (path === PROJECTS_ROOT) return [{ name: "-repo-demo", is_dir: true, is_file: false }];
        if (path === PROJECT_DIR) {
          return Object.keys(files).map((name) => ({
            name: name.split("/").pop() ?? name,
            is_dir: false,
            is_file: true
          }));
        }
        return [];
      }),
      readText: vi.fn(async (path: string) => {
        const file = files[path];
        if (file) return file.content;
        if (path in written) return written[path];
        throw new Error(`文件不存在 ${path}`);
      }),
      readHead: vi.fn(async () => ""),
      stat: vi.fn(async (path: string) => {
        const file = files[path];
        if (!file) throw new Error(`文件不存在 ${path}`);
        return { is_file: true, size: file.content.length, mtime_ms: file.mtimeMs };
      }),
      writeText: vi.fn(async (path: string, contents: string) => {
        written[path] = contents;
      })
    },
    events: { onSessionImport: vi.fn(async () => () => undefined) },
    tray: { updateReadout, setVisible }
  } as unknown as Bridges;

  return { bridges, updateReadout, setVisible };
}

function wrapperFor(bridges: Bridges) {
  return ({ children }: { children: ReactNode }) => (
    <BridgesProvider bridges={bridges}>{children}</BridgesProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  sharedSessionParseCache.clear();
  // 计划存储是模块级的：每个用例都从「没有预算」起步。
  setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTrayReadout", () => {
  it("按 mtime 收窄：近期会话解析出读数，过期会话连读都不读", async () => {
    const { bridges, updateReadout } = createBridges({
      [RECENT_PATH]: { content: sessionJsonl(NOW - 60_000), mtimeMs: NOW },
      [OLD_PATH]: { content: sessionJsonl(NOW - 30 * 86_400_000), mtimeMs: NOW - 30 * 86_400_000 }
    });

    renderHook(() => useTrayReadout(), { wrapper: wrapperFor(bridges) });

    await waitFor(() => expect(updateReadout).toHaveBeenCalledTimes(1));
    const readout = updateReadout.mock.calls[0][0] as TrayReadout;
    expect(readout.weekly.usedTokens).toBe(110);
    expect(readout.weekly.days).toBe(7);
    // 没设预算 → 不造 0 百分比。
    expect(readout.weekly.percent).toBeNull();
    expect(readout.block?.usedTokens).toBe(110);
    expect(readout.block?.percent).toBeNull();

    // 收窄生效：过期会话的文件内容一个字节都没读过。
    expect(bridges.fs.readText).not.toHaveBeenCalledWith(OLD_PATH);
    expect(bridges.fs.readText).toHaveBeenCalledWith(RECENT_PATH);
    // 挂载时把开关的当前值（默认开）推给 Rust。
    expect(bridges.tray?.setVisible).toHaveBeenCalledWith(true);
  });

  it("每 60 秒重推一次；卸载后定时器不再触发（不泄漏）", async () => {
    vi.useFakeTimers();
    const { bridges, updateReadout } = createBridges({
      [RECENT_PATH]: { content: sessionJsonl(NOW - 60_000), mtimeMs: NOW }
    });

    const { unmount } = renderHook(() => useTrayReadout(), { wrapper: wrapperFor(bridges) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(updateReadout).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAY_TICK_MS);
    });
    expect(updateReadout).toHaveBeenCalledTimes(2);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAY_TICK_MS * 3);
    });
    expect(updateReadout).toHaveBeenCalledTimes(2);
  });

  it("开关：挂载推当前值，关掉推 false 并停止计算，重新打开立刻重算", async () => {
    vi.useFakeTimers();
    const { bridges, updateReadout, setVisible } = createBridges({
      [RECENT_PATH]: { content: sessionJsonl(NOW - 60_000), mtimeMs: NOW }
    });

    const { unmount } = renderHook(() => useTrayReadout(), { wrapper: wrapperFor(bridges) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(setVisible).toHaveBeenCalledWith(true);
    expect(updateReadout).toHaveBeenCalledTimes(1);

    act(() => setTrayEnabled(false));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(setVisible).toHaveBeenLastCalledWith(false);
    expect(localStorage.getItem(TRAY_ENABLED_KEY)).toBe("false");

    // 关掉之后连扫描都不做——不显示就不继续付常驻读数的账。
    updateReadout.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAY_TICK_MS * 2);
    });
    expect(updateReadout).not.toHaveBeenCalled();

    act(() => setTrayEnabled(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(setVisible).toHaveBeenLastCalledWith(true);
    expect(updateReadout).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("推送失败被吞掉，并且只记一次日志", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { bridges, updateReadout } = createBridges({
      [RECENT_PATH]: { content: sessionJsonl(NOW - 60_000), mtimeMs: NOW }
    });
    updateReadout.mockRejectedValue(new Error("托盘不可用"));

    const { unmount } = renderHook(() => useTrayReadout(), { wrapper: wrapperFor(bridges) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAY_TICK_MS);
    });

    expect(updateReadout).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);

    unmount();
    warn.mockRestore();
  });
});
