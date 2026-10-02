import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { sharedSearchIndex } from "./searchIndex";
import { SearchPalette } from "./SearchPalette";

/**
 * The palette is tested through the real hook + index stack on a fake
 * `~/.claude/projects` tree. Timestamps land minutes ago so relative-time
 * labels stay stable, and the shared singleton is wiped between cases so
 * tests do not inherit each other's sessions.
 */

const PROJECTS_ROOT = "/home/tester/.claude/projects";

function messageJsonl(id: string, text: string): string {
  return JSON.stringify({
    type: "user",
    timestamp: new Date(Date.now() - 60_000).toISOString(),
    uuid: id,
    message: { role: "user", content: text }
  });
}

function createBridges(files: Record<string, string>): Bridges {
  const byDir = new Map<string, string[]>();
  for (const path of Object.keys(files)) {
    const segments = path.split("/");
    const dir = segments.slice(0, -1).join("/");
    byDir.set(dir, [...(byDir.get(dir) ?? []), segments[segments.length - 1]]);
  }
  const projectDirs = [...byDir.keys()].filter((dir) => dir.startsWith(`${PROJECTS_ROOT}/`));
  const stat = (path: string) => ({
    is_file: path.endsWith(".jsonl"),
    size: files[path]?.length ?? 0,
    mtime_ms: Date.now()
  });
  return {
    fs: {
      readDir: vi.fn(async (path: string) =>
        path === PROJECTS_ROOT
          ? projectDirs.map((dir) => ({
              name: dir.slice(PROJECTS_ROOT.length + 1),
              is_dir: true,
              is_file: false
            }))
          : (byDir.get(path) ?? []).map((name) => ({
              name,
              is_dir: false,
              is_file: name.endsWith(".jsonl")
            }))
      ),
      readText: vi.fn(async (path: string) => {
        const content = files[path];
        if (content === undefined) throw new Error("no such file");
        return content;
      }),
      readHead: vi.fn(async (path: string) => files[path] ?? ""),
      writeText: vi.fn(async () => undefined),
      stat: vi.fn(async (path: string) => stat(path)),
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/home/tester/Library/Application Support/cc-analyzer")
    },
    proc: {} as Bridges["proc"],
    system: {} as Bridges["system"],
    clipboard: {} as Bridges["clipboard"],
    dialog: {} as Bridges["dialog"],
    events: { onSessionImport: vi.fn(async () => () => undefined) },
    monitor: {} as Bridges["monitor"]
  };
}

const FILES = {
  [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: messageJsonl("u1", "修复 parser 里的空指针"),
  [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: messageJsonl("u2", "parser 的测试也要补")
};

function renderPalette(overrides: { onReveal?: (path: string, recordId: string) => void } = {}) {
  const onReveal = overrides.onReveal ?? vi.fn();
  const onClose = vi.fn();
  const bridges = createBridges(FILES);
  const view = render(
    <BridgesProvider bridges={bridges}>
      <SearchPalette open onClose={onClose} onReveal={onReveal} />
    </BridgesProvider>
  );
  return { onReveal, onClose, ...view };
}

describe("SearchPalette", () => {
  beforeEach(() => {
    sharedSearchIndex.clear();
  });

  it("打开即有焦点与空态提示；索引完成后可搜出跨项目分组", async () => {
    renderPalette();
    const input = screen.getByLabelText("搜索消息");
    expect(input).toHaveFocus();
    expect(screen.getByText("输入关键词搜索全部会话的消息")).toBeInTheDocument();

    await userEvent.type(input, "parser");
    await waitFor(() => {
      const groups = screen.getAllByRole("heading").map((node) => node.textContent);
      expect(groups).toContain("-repo-alpha");
      expect(groups).toContain("-repo-beta");
    });
    expect(screen.getByText(/条命中/)).toBeInTheDocument();
  });

  it("↑↓ 移动焦点行，Enter 触发 onReveal（path + recordId）并关闭", async () => {
    const onReveal = vi.fn();
    const onClose = vi.fn();
    render(
      <BridgesProvider bridges={createBridges(FILES)}>
        <SearchPalette open onClose={onClose} onReveal={onReveal} />
      </BridgesProvider>
    );
    const input = screen.getByLabelText("搜索消息");
    await userEvent.type(input, "parser");
    const items = await screen.findAllByRole("button", { name: /修复|测试/ });
    expect(items.length).toBeGreaterThanOrEqual(2);

    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Enter}");
    // 同时刻的两个会话组间次序由插入序决定，断言接受任一夹具路径。
    expect(onReveal).toHaveBeenCalledTimes(1);
    const [revealedPath] = onReveal.mock.calls[0];
    expect([
      `${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`,
      `${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`
    ]).toContain(revealedPath);
    expect(onReveal.mock.calls[0][1]).toEqual(expect.any(String));
    expect(onClose).toHaveBeenCalled();
  });

  it("无命中且索引完成 → 明确说没有匹配", async () => {
    renderPalette();
    await userEvent.type(screen.getByLabelText("搜索消息"), "不存在的词");
    await waitFor(() => expect(screen.getByText("没有匹配的消息")).toBeInTheDocument());
  });
});
