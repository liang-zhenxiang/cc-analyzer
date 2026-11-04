import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges, DirEntry } from "../../api/types";
import { ClaudeRootGate } from "./ClaudeRootGate";
import { CLAUDE_ROOT_STORAGE_KEY } from "./claudeRoot";

const HOME = "/home/tester";
const DEFAULT_ROOT = `${HOME}/.claude/projects`;

function file(name: string): DirEntry {
  return { name, is_dir: false, is_file: true };
}

function dir(name: string): DirEntry {
  return { name, is_dir: true, is_file: false };
}

function createBridges({
  readDir,
  openDirectory
}: {
  readDir: Bridges["fs"]["readDir"];
  openDirectory?: (options: { title: string }) => Promise<string | null>;
}): Bridges {
  return {
    fs: {
      homeDir: vi.fn(async () => HOME),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir,
      readText: vi.fn(async () => ""),
      readHead: vi.fn(async () => ""),
      writeText: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ is_file: true, size: 0, mtime_ms: 0 }))
    },
    dialog: openDirectory ? { openDirectory } : {}
  } as unknown as Bridges;
}

function renderGate(bridges: Bridges) {
  return render(
    <BridgesProvider bridges={bridges}>
      <ClaudeRootGate>
        <p>主内容</p>
      </ClaudeRootGate>
    </BridgesProvider>
  );
}

function rootWithOneSession(): Bridges["fs"]["readDir"] {
  return vi.fn(async (path: string) =>
    path === DEFAULT_ROOT ? [dir("-repo-demo")] : [file("session.jsonl")]
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("ClaudeRootGate", () => {
  it("目录不存在：显示欢迎层、当前路径与四个动作，主内容被替换", async () => {
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("No such file or directory (os error 2)");
      }),
      openDirectory: vi.fn(async () => null)
    });

    renderGate(bridges);

    expect(await screen.findByText("还没有找到会话目录")).toBeInTheDocument();
    expect(screen.getByText(/会话数据只在本机读取，不上传、不内置遥测/)).toBeInTheDocument();
    expect(screen.getByText(DEFAULT_ROOT)).toBeInTheDocument();
    expect(screen.queryByText("主内容")).not.toBeInTheDocument();

    expect(screen.getByRole("button", { name: "重新扫描" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "选择其他目录" })).toBeInTheDocument();
    // 没设过自定义目录时「按默认目录继续」没有意义（它只是清回默认值）。
    expect(screen.queryByRole("button", { name: "按默认目录继续" })).toBeNull();
    // 连目录都没有的人最该先看看产品长什么样：演示是主按钮。
    expect(screen.getByRole("button", { name: "先看演示数据" })).toHaveClass(/primary/);
  });

  it("目录可读但没有 jsonl：放行主界面，空态交给用量页的三步引导", async () => {
    const bridges = createBridges({
      readDir: vi.fn(async (path: string) =>
        path === DEFAULT_ROOT ? [dir("-repo-demo")] : [file("readme.md")]
      )
    });

    renderGate(bridges);

    // 不重复拦一次：目录存在只是没有会话，主界面的 H10 引导才是这件事的
    // 正确位置（它还会告诉用户「检查目录」而不是「去装 Claude Code」）。
    await waitFor(() => expect(screen.getByText("主内容")).toBeInTheDocument());
    expect(screen.queryByText("这个目录里没有会话")).toBeNull();
  });

  it("权限错误：放行主界面，交给可重试的错误态而不是欢迎层", async () => {
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("Permission denied (os error 13)");
      })
    });

    renderGate(bridges);

    // 用户明明有目录，需要的是错误详情与「重试」，不是劝他去装 Claude Code。
    await waitFor(() => expect(screen.getByText("主内容")).toBeInTheDocument());
    expect(screen.queryByText("还没有找到会话目录")).toBeNull();
  });

  it("自检 ok：直接渲染 children，不出现引导层", async () => {
    const bridges = createBridges({ readDir: rootWithOneSession() });

    renderGate(bridges);

    await waitFor(() =>
      expect(document.querySelector('[data-probe="claude-root-gate"]')).toBeNull()
    );
    expect(screen.getByText("主内容")).toBeInTheDocument();
  });

  it("设过自定义目录时，欢迎层才出现「按默认目录继续」", async () => {
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "/Volumes/backup/projects");
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("No such file or directory (os error 2)");
      })
    });

    renderGate(bridges);

    expect(await screen.findByText("还没有找到会话目录")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "按默认目录继续" })).toBeInTheDocument();
  });

  it("自定义目录优先于默认目录", async () => {
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "/Volumes/backup/projects");
    const readDir = vi.fn(async (path: string) =>
      path === "/Volumes/backup/projects" ? [dir("-repo")] : [file("session.jsonl")]
    );
    const bridges = createBridges({ readDir });

    renderGate(bridges);

    await waitFor(() => expect(readDir).toHaveBeenCalledWith("/Volumes/backup/projects"));
    expect(screen.getByText("主内容")).toBeInTheDocument();
    expect(readDir).not.toHaveBeenCalledWith(DEFAULT_ROOT);
  });

  it("空白 localStorage 回退默认目录", async () => {
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "   ");
    const readDir = rootWithOneSession();
    const bridges = createBridges({ readDir });

    renderGate(bridges);

    await waitFor(() => expect(readDir).toHaveBeenCalledWith(DEFAULT_ROOT));
  });

  it("选择其他目录：写入 localStorage，并重新检查后放行", async () => {
    const user = userEvent.setup();
    const readDir = vi.fn(async (path: string) => {
      if (path === DEFAULT_ROOT) throw new Error("ENOENT: no such file or directory");
      if (path === "/picked/projects") return [dir("-repo")];
      return [file("session.jsonl")];
    });
    const openDirectory = vi.fn(async () => "/picked/projects");
    const bridges = createBridges({ readDir, openDirectory });

    renderGate(bridges);
    expect(await screen.findByText("还没有找到会话目录")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "选择其他目录" }));

    await waitFor(() =>
      expect(window.localStorage.getItem(CLAUDE_ROOT_STORAGE_KEY)).toBe("/picked/projects")
    );
    expect(await screen.findByText("主内容")).toBeInTheDocument();
    expect(screen.queryByText("还没有找到会话目录")).not.toBeInTheDocument();
  });

  it("选择目录对话框取消时不改动存储", async () => {
    const user = userEvent.setup();
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("ENOENT: no such file or directory");
      }),
      openDirectory: vi.fn(async () => null)
    });

    renderGate(bridges);
    await screen.findByText("还没有找到会话目录");
    await user.click(screen.getByRole("button", { name: "选择其他目录" }));

    expect(window.localStorage.getItem(CLAUDE_ROOT_STORAGE_KEY)).toBeNull();
    expect(screen.getByText("还没有找到会话目录")).toBeInTheDocument();
  });

  it("按默认目录继续：清掉自定义值；默认也没有时提示先运行 Claude Code", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "/custom/root");
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("ENOENT: no such file or directory");
      })
    });

    renderGate(bridges);
    expect(await screen.findByText("还没有找到会话目录")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "按默认目录继续" }));

    expect(window.localStorage.getItem(CLAUDE_ROOT_STORAGE_KEY)).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent(/先运行一次 Claude Code/);
  });

  it("重新扫描能从不存在的状态恢复到 ok", async () => {
    const user = userEvent.setup();
    let rootAttempts = 0;
    const readDir = vi.fn(async (path: string) => {
      if (path === DEFAULT_ROOT) {
        rootAttempts += 1;
        if (rootAttempts === 1) throw new Error("No such file or directory (os error 2)");
        return [dir("-repo")];
      }
      return [file("session.jsonl")];
    });
    const bridges = createBridges({ readDir });

    renderGate(bridges);
    expect(await screen.findByText("还没有找到会话目录")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重新扫描" }));

    expect(await screen.findByText("主内容")).toBeInTheDocument();
  });

  it("先看演示数据只派发 cca-demo-enter 事件", async () => {
    const user = userEvent.setup();
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("ENOENT: no such file or directory");
      })
    });
    const onDemo = vi.fn();
    window.addEventListener("cca-demo-enter", onDemo);

    renderGate(bridges);
    await screen.findByText("还没有找到会话目录");
    await user.click(screen.getByRole("button", { name: "先看演示数据" }));

    expect(onDemo).toHaveBeenCalledTimes(1);
    window.removeEventListener("cca-demo-enter", onDemo);
  });
});
