import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bridges } from "../../api/types";
import { DEMO_STORAGE_KEY } from "../../demo/demoMode";
import {
  CLAUDE_ROOT_STORAGE_KEY,
  checkClaudeRoot,
  resolveClaudeRoot,
  setClaudeRoot,
  type RootCheck
} from "./claudeRoot";

const HOME = "/home/tester";
const DEFAULT_ROOT = `${HOME}/.claude/projects`;

type ReadDir = Bridges["fs"]["readDir"];

function createBridges({
  homeDir = HOME,
  readDir
}: {
  homeDir?: string;
  readDir: ReadDir;
}): Bridges {
  return {
    fs: {
      homeDir: vi.fn(async () => homeDir),
      readDir,
      appDataDir: vi.fn(async () => "/app-data"),
      readText: vi.fn(async () => ""),
      readHead: vi.fn(async () => ""),
      writeText: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ is_file: true, size: 0, mtime_ms: 0 }))
    }
  } as unknown as Bridges;
}

/** 默认目录 → 一个项目目录 → 一个会话文件。 */
function projectsWithOneSession(): ReadDir {
  return vi.fn(async (path: string) =>
    path === DEFAULT_ROOT
      ? [{ name: "-repo-demo", is_dir: true, is_file: false }]
      : [{ name: "session.jsonl", is_dir: false, is_file: true }]
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("resolveClaudeRoot", () => {
  it("没有自定义目录时拼出 <home>/.claude/projects", async () => {
    const bridges = createBridges({ readDir: vi.fn(async () => []) });
    await expect(resolveClaudeRoot(bridges)).resolves.toBe(DEFAULT_ROOT);
  });

  it("有自定义目录时优先用它，且不再读 homeDir", async () => {
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "  /Volumes/backup/projects  ");
    const homeDir = vi.fn(async () => HOME);
    const bridges = createBridges({ readDir: vi.fn(async () => []) });
    bridges.fs.homeDir = homeDir;

    await expect(resolveClaudeRoot(bridges)).resolves.toBe("/Volumes/backup/projects");
    expect(homeDir).not.toHaveBeenCalled();
  });

  it("空白值回退默认目录", async () => {
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "   ");
    const bridges = createBridges({ readDir: vi.fn(async () => []) });
    await expect(resolveClaudeRoot(bridges)).resolves.toBe(DEFAULT_ROOT);
  });

  it("非法值（相对路径 / ~）回退默认目录", async () => {
    const bridges = createBridges({ readDir: vi.fn(async () => []) });

    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "relative/path");
    await expect(resolveClaudeRoot(bridges)).resolves.toBe(DEFAULT_ROOT);

    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "~/.claude/projects");
    await expect(resolveClaudeRoot(bridges)).resolves.toBe(DEFAULT_ROOT);
  });

  it("演示模式下忽略已保存的自定义目录（否则演示会被引导层拦住）", async () => {
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "/Volumes/backup/projects");
    window.localStorage.setItem(DEMO_STORAGE_KEY, "on");
    const bridges = createBridges({ readDir: vi.fn(async () => []) });

    await expect(resolveClaudeRoot(bridges)).resolves.toBe(DEFAULT_ROOT);
  });
});

describe("setClaudeRoot", () => {
  it("写入合法路径，传 null 时删除", () => {
    setClaudeRoot("/custom/root");
    expect(window.localStorage.getItem(CLAUDE_ROOT_STORAGE_KEY)).toBe("/custom/root");

    setClaudeRoot(null);
    expect(window.localStorage.getItem(CLAUDE_ROOT_STORAGE_KEY)).toBeNull();
  });

  it("非法路径等同清空", () => {
    window.localStorage.setItem(CLAUDE_ROOT_STORAGE_KEY, "/custom/root");
    setClaudeRoot("relative");
    expect(window.localStorage.getItem(CLAUDE_ROOT_STORAGE_KEY)).toBeNull();
  });
});

describe("checkClaudeRoot", () => {
  it("ok：默认目录 → 项目目录 → jsonl", async () => {
    const bridges = createBridges({ readDir: projectsWithOneSession() });
    const check: RootCheck = await checkClaudeRoot(bridges);

    expect(check.state).toBe("ok");
    expect(check.path).toBe(DEFAULT_ROOT);
    expect(check.sessionCount).toBe(1);
    expect(check.message).toContain("1 个会话文件");
  });

  it("ok：根目录本身直接放 jsonl 也算", async () => {
    const bridges = createBridges({
      readDir: vi.fn(async () => [
        { name: "one.jsonl", is_dir: false, is_file: true },
        { name: "two.jsonl", is_dir: false, is_file: true },
        { name: "notes.txt", is_dir: false, is_file: true }
      ])
    });

    const check = await checkClaudeRoot(bridges);
    expect(check.state).toBe("ok");
    expect(check.sessionCount).toBe(2);
  });

  it("missing：ENOENT / os error 2 识别为不存在", async () => {
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("No such file or directory (os error 2)");
      })
    });

    const check = await checkClaudeRoot(bridges);
    expect(check.state).toBe("missing");
    expect(check.sessionCount).toBe(0);
    expect(check.message).toContain("先运行一次 Claude Code");
  });

  it("unreadable：权限错误不再说成「没装」", async () => {
    const bridges = createBridges({
      readDir: vi.fn(async () => {
        throw new Error("Permission denied (os error 13)");
      })
    });

    const check = await checkClaudeRoot(bridges);
    expect(check.state).toBe("unreadable");
    expect(check.message).toContain("权限");
  });

  it("empty：目录可读但没有任何 jsonl", async () => {
    const bridges = createBridges({
      readDir: vi.fn(async (path: string) =>
        path === DEFAULT_ROOT
          ? [{ name: "-repo-demo", is_dir: true, is_file: false }]
          : [{ name: "readme.md", is_dir: false, is_file: true }]
      )
    });

    const check = await checkClaudeRoot(bridges);
    expect(check.state).toBe("empty");
    expect(check.sessionCount).toBe(0);
    expect(check.message).toContain("还没有 .jsonl 会话文件");
  });

  it("显式传入 path 时检查那个目录（选择目录后的即时自检）", async () => {
    const readDir = vi.fn(async (path: string) =>
      path === "/picked/projects"
        ? [{ name: "-repo", is_dir: true, is_file: false }]
        : [{ name: "session.jsonl", is_dir: false, is_file: true }]
    );
    const bridges = createBridges({ readDir });

    const check = await checkClaudeRoot(bridges, "/picked/projects");
    expect(check.state).toBe("ok");
    expect(check.path).toBe("/picked/projects");
    expect(readDir).toHaveBeenCalledWith("/picked/projects");
  });
});
