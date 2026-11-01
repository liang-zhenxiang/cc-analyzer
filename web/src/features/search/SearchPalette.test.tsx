import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    monitor: {} as Bridges["monitor"],
    updater: {} as Bridges["updater"]
  };
}

const FILES = {
  [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: messageJsonl("u1", "修复 parser 里的空指针"),
  [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: messageJsonl("u2", "parser 的测试也要补"),
  // 带 SGR 序列的消息体：命中摘要必须把它剥成纯文本（`\u001b[33m` 是字节不是文字）。
  [`${PROJECTS_ROOT}/-repo-ansi/ccc.jsonl`]: messageJsonl(
    "u3",
    "\u001b[33m构建失败\u001b[0m：先修 src/app.ts:12。"
  )
};

/**
 * 一个会话里凑齐五类来源，且五条正文/路径都含同一个查询词——这样一次搜索就能
 * 同时验证「五种标签各渲染一次」与「按来源过滤只剩路径」。
 */
function sourceJsonl(): string {
  const minutesAgo = (minutes: number) =>
    new Date(Date.now() - minutes * 60_000).toISOString();
  const lines = [
    {
      type: "user",
      uuid: "src-u1",
      timestamp: minutesAgo(8),
      message: { role: "user", content: "关键词 我提的问题" }
    },
    {
      type: "assistant",
      uuid: "src-a1",
      timestamp: minutesAgo(7),
      message: { role: "assistant", content: [{ type: "text", text: "关键词 助手的回答" }] }
    },
    // 一次成功的 Bash：没有路径、不是错误 → 工具输出。
    {
      type: "assistant",
      uuid: "src-a2",
      timestamp: minutesAgo(6),
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t-bash", name: "Bash", input: { command: "npm run build" } }
        ]
      }
    },
    {
      type: "user",
      uuid: "src-r2",
      timestamp: minutesAgo(5),
      toolUseResult: { type: "tool_use_result", stdout: "关键词 命令的标准输出", stderr: "" },
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "t-bash", content: "关键词 命令的标准输出" }
        ]
      }
    },
    // 一次 Edit：结构化结果给了文件路径 → 文件路径（路径里带查询词）。
    {
      type: "assistant",
      uuid: "src-a3",
      timestamp: minutesAgo(4),
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t-edit",
            name: "Edit",
            input: { file_path: "/repo/关键词/entry.ts", old_string: "a", new_string: "b" }
          }
        ]
      }
    },
    {
      type: "user",
      uuid: "src-r3",
      timestamp: minutesAgo(3),
      toolUseResult: { type: "tool_use_result", filePath: "/repo/关键词/entry.ts" },
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t-edit", content: "已更新" }]
      }
    },
    // 一次失败的 Bash：is_error → 错误（与工具输出互斥）。
    {
      type: "assistant",
      uuid: "src-a4",
      timestamp: minutesAgo(2),
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", id: "t-fail", name: "Bash", input: { command: "npm test" } }
        ]
      }
    },
    {
      type: "user",
      uuid: "src-r4",
      timestamp: minutesAgo(1),
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "t-fail",
            is_error: true,
            content: "关键词 构建失败"
          }
        ]
      }
    }
  ];
  return `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
}

const SOURCE_FILES = {
  [`${PROJECTS_ROOT}/-repo-sources/sources.jsonl`]: sourceJsonl()
};

function renderPalette(
  files: Record<string, string> = FILES,
  overrides: { onReveal?: (path: string, recordId: string) => void } = {}
) {
  const onReveal = overrides.onReveal ?? vi.fn();
  const onClose = vi.fn();
  const bridges = createBridges(files);
  const view = render(
    <BridgesProvider bridges={bridges}>
      <SearchPalette open onClose={onClose} onReveal={onReveal} />
    </BridgesProvider>
  );
  return { onReveal, onClose, ...view };
}

const inputOf = () => screen.getByLabelText("搜索会话记录");
const chipOf = (name: string) => screen.getByRole("button", { name });
/**
 * 结果行的可访问名以「来源文案：」开头，chip 只有来源文案本身——用冒号区分。
 * 用 queryAll 而不是 getAll：过滤到「一个来源都不选」时结果是空集，而这一档
 * 恰恰是要断言的合法状态，不该在断言前先抛错。
 */
const rows = () =>
  screen.queryAllByRole("button", { name: /^(我|助手|工具输出|文件路径|错误)：/ });

describe("SearchPalette", () => {
  beforeEach(() => {
    sharedSearchIndex.clear();
  });

  it("打开即有焦点与空态提示；索引完成后可搜出跨项目分组", async () => {
    renderPalette();
    const input = inputOf();
    expect(input).toHaveFocus();
    expect(screen.getByText("搜索会话消息、工具输出与文件路径（⌘K 关闭）")).toBeInTheDocument();

    await userEvent.type(input, "parser");
    await waitForGroups();
    expect(screen.getByTitle("-repo-alpha")).toBeInTheDocument();
    expect(screen.getByText(/条命中/)).toBeInTheDocument();
  });

  it("↑↓ 移动焦点行，Enter 触发 onReveal（path + recordId）并关闭", async () => {
    const onReveal = vi.fn();
    const { onClose } = renderPalette(FILES, { onReveal });
    const input = inputOf();
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

  it("无命中且索引完成 → 明确说没有匹配，并给出已索引条目数", async () => {
    renderPalette();
    await userEvent.type(inputOf(), "不存在的词");
    await waitFor(() =>
      expect(screen.getByText(/^没有匹配的记录 · 已索引 [\d,]+ 条$/)).toBeInTheDocument()
    );
  });

  it("命中摘要里没有转义字节，按屏幕上看到的字能读到正文", async () => {
    renderPalette();
    await userEvent.type(inputOf(), "构建失败");
    const item = await screen.findByRole("button", { name: /构建失败/ });
    const snippet = item.textContent ?? "";
    expect(snippet).toContain("构建失败");
    expect(snippet).toContain("先修 src/app.ts:12。");
    // 用户读到的是 `[33m` 还是红字，区别就在这两个断言上。
    expect(snippet).not.toContain("\u001b");
    expect(snippet).not.toContain("[33m");
  });
});

describe("来源标签", () => {
  beforeEach(() => {
    sharedSearchIndex.clear();
  });

  it("五类来源各一枚标签，文案与 data-source 一一对应", async () => {
    renderPalette(SOURCE_FILES);
    await userEvent.type(inputOf(), "关键词");
    const found = await waitForRows(5);

    const pairs = found.map((row) => {
      const label = row.querySelector("[data-probe='search-source']");
      expect(label, "结果行必须带来源标签锚点").not.toBeNull();
      return [label!.getAttribute("data-source"), label!.textContent];
    });
    expect(pairs).toEqual(
      expect.arrayContaining([
        ["user", "我"],
        ["assistant", "助手"],
        ["tool-output", "工具输出"],
        ["file-path", "文件路径"],
        ["error", "错误"]
      ])
    );

    // 只有文件路径着强调色：其余四类共用中性 chip 的类名。
    const labelClass = (source: string) =>
      found
        .find((row) => row.querySelector(`[data-probe='search-source'][data-source='${source}']`))!
        .querySelector("[data-probe='search-source']")!.className;
    expect(labelClass("file-path")).toContain("sourceFilePath");
    expect(labelClass("error")).not.toContain("sourceFilePath");
    expect(labelClass("user")).not.toContain("sourceFilePath");
  });

  it("结果行的可访问名是「来源文案：片段」", async () => {
    renderPalette(SOURCE_FILES);
    await userEvent.type(inputOf(), "关键词");
    await waitForRows(5);

    const pathRow = screen.getByRole("button", { name: "文件路径：/repo/关键词/entry.ts" });
    expect(pathRow).toHaveAttribute("title", "/repo/关键词/entry.ts");
    expect(screen.getByRole("button", { name: /^错误：关键词 构建失败$/ })).toBeInTheDocument();
  });
});

describe("来源过滤器", () => {
  beforeEach(() => {
    sharedSearchIndex.clear();
  });

  it("默认五个来源全选，六枚 chip 的档位与锚点齐全", async () => {
    renderPalette(SOURCE_FILES);
    const group = screen.getByRole("group", { name: "按来源过滤搜索结果" });
    expect(group).toHaveAttribute("data-probe", "search-filters");
    const chips = group.querySelectorAll("[data-probe='search-filter-chip']");
    expect([...chips].map((chip) => chip.getAttribute("data-source"))).toEqual([
      "all",
      "user",
      "assistant",
      "tool-output",
      "file-path",
      "error"
    ]);
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      "全部",
      "我",
      "助手",
      "工具输出",
      "文件路径",
      "错误"
    ]);
    for (const chip of chips) expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("只看文件路径：消息类命中消失，只剩路径那一行", async () => {
    renderPalette(SOURCE_FILES);
    await userEvent.type(inputOf(), "关键词");
    await waitForRows(5);

    // 全部 → 清空 → 只留文件路径（集合运算就是契约里的过滤语义）。
    await userEvent.click(chipOf("全部"));
    await waitFor(() => expect(rows()).toHaveLength(0));
    await userEvent.click(chipOf("文件路径"));

    const remaining = await waitForRows(1);
    expect(remaining[0].querySelector("[data-probe='search-source']")!.getAttribute("data-source")).toBe(
      "file-path"
    );
    expect(chipOf("文件路径")).toHaveAttribute("aria-pressed", "true");
    expect(chipOf("我")).toHaveAttribute("aria-pressed", "false");
    expect(chipOf("全部")).toHaveAttribute("aria-pressed", "false");
  });

  it("「全部」是快捷开关：点一次清空、再点恢复全选", async () => {
    renderPalette(SOURCE_FILES);
    await userEvent.type(inputOf(), "关键词");
    await waitForRows(5);

    await userEvent.click(chipOf("全部"));
    expect(chipOf("全部")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(rows()).toHaveLength(0));
    await waitFor(() => expect(screen.getByText(/^没有匹配的记录 · 已索引 /)).toBeInTheDocument());

    await userEvent.click(chipOf("全部"));
    expect(chipOf("全部")).toHaveAttribute("aria-pressed", "true");
    await waitForRows(5);
  });

  it("输入糖：`路径:` 前缀只清到文件路径这一类，且不参与子串匹配", async () => {
    renderPalette(SOURCE_FILES);
    const input = inputOf();
    await userEvent.type(input, "路径:关键词");

    // 前缀被剥掉，留在输入框里的是真正的查询串。
    expect(input).toHaveValue("关键词");
    const remaining = await waitForRows(1);
    expect(remaining[0].querySelector("[data-probe='search-source']")!.getAttribute("data-source")).toBe(
      "file-path"
    );
    expect(chipOf("文件路径")).toHaveAttribute("aria-pressed", "true");
    expect(chipOf("助手")).toHaveAttribute("aria-pressed", "false");
  });

  it("焦点在 chip 上时 Enter 只切档，不跳到会话", async () => {
    const onReveal = vi.fn();
    renderPalette(SOURCE_FILES, { onReveal });
    await userEvent.type(inputOf(), "关键词");
    await waitForRows(5);

    const assistantChip = chipOf("助手");
    assistantChip.focus();
    await userEvent.keyboard("{Enter}");

    expect(onReveal).not.toHaveBeenCalled();
    expect(assistantChip).toHaveAttribute("aria-pressed", "false");
    // 助手那一档关掉后：我 / 工具输出 / 文件路径 / 错误 四条仍在。
    await waitForRows(4);
  });
});

describe("进度读数", () => {
  beforeEach(() => {
    sharedSearchIndex.clear();
  });

  it("命中数后面跟着条目数（会话口径的进度分数不改成条目数）", async () => {
    renderPalette(SOURCE_FILES);
    await userEvent.type(inputOf(), "关键词");
    await waitForRows(5);

    const status = screen.getByRole("status");
    // 五条记录各出一个条目：会话口径说 1/1，条目口径说 5 条。
    expect(status.textContent).toBe("5 条命中 · 已索引 5 条");
  });
});

/**
 * 样式判据：路径片段必须等宽 + 单行省略，且**不许**出现 `direction: rtl`
 * ——左对齐省略是刻意的取舍（RTL 会把开头的 `/` 重排到尾部，产出语义错误的路径）。
 */
describe("样式（CSS 不变量）", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/features/search/SearchPalette.module.css"),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("路径片段：等宽字体、单行省略，且没有 direction: rtl", () => {
    expect(css).toMatch(/\.snippetPath\s*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(css).toMatch(/\.snippetPath\s*\{[^}]*white-space:\s*nowrap/s);
    expect(css).toMatch(/\.snippetPath\s*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(css).toMatch(/\.snippetPath\s*\{[^}]*min-width:\s*0/s);
    expect(css).not.toMatch(/direction:\s*rtl/);
  });

  it("标签与过滤条只用令牌，来源标签不带危险色", () => {
    expect(css).toMatch(/\.source\s*\{[^}]*background:\s*var\(--bg-inset\)/s);
    expect(css).toMatch(/\.source\s*\{[^}]*color:\s*var\(--text-secondary\)/s);
    expect(css).toMatch(/\.sourceFilePath\s*\{[^}]*background:\s*var\(--accent-soft\)/s);
    expect(css).toMatch(/\.sourceFilePath\s*\{[^}]*color:\s*var\(--accent\)/s);
    expect(css).toMatch(/\.chip\s*\{[^}]*height:\s*var\(--control-h-sm\)/s);
    expect(css).toMatch(/\.chipActive\s*\{[^}]*border-color:\s*var\(--accent\)/s);
    expect(css).not.toMatch(/--danger/);
  });

  it("结果行的三件（标签 / 片段 / 时间）同高对齐，片段可伸缩", () => {
    expect(css).toMatch(/\.item\s*\{[^}]*align-items:\s*center/s);
    expect(css).toMatch(/\.snippet\s*\{[^}]*flex:\s*1 1 auto/s);
    expect(css).toMatch(/\.source\s*\{[^}]*flex:\s*none/s);
    expect(css).toMatch(/\.time\s*\{[^}]*flex:\s*none/s);
  });
});

/** 索引是渐进构建的：等分组标题出现即代表两条夹具都已进索引。 */
async function waitForGroups() {
  await waitFor(() => {
    const groups = screen.getAllByRole("heading").map((node) => node.textContent);
    // 分组标题与侧栏、用量页共用 formatProjectPath：不把编码目录名
    // （前导 `-`）直接铺给用户；编码名完整留在 title 上。
    expect(groups).toContain("repo-alpha");
    expect(groups).toContain("repo-beta");
  });
}

async function waitForRows(count: number): Promise<HTMLElement[]> {
  await waitFor(() => expect(rows()).toHaveLength(count));
  return rows();
}

describe("I7 保存的搜索", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const saveButton = () => screen.getByRole("button", { name: "保存" });
  const savedCards = () => document.querySelectorAll('[data-probe="saved-search"]');

  it("没有保存也不在空态时显示保存区块", () => {
    renderPalette();
    expect(document.querySelector('[data-probe="saved-searches"]')).toBeNull();
    expect(window.localStorage.getItem("cca-saved-searches")).toBeNull();
  });

  it("保存当前查询后，空态出现卡片，点卡片把查询填回输入框", async () => {
    const user = userEvent.setup();
    renderPalette(SOURCE_FILES);

    await user.type(inputOf(), "关键词");
    await user.click(saveButton());
    await user.clear(screen.getByLabelText("保存的搜索名称"));
    await user.type(screen.getByLabelText("保存的搜索名称"), "构建排查");
    await user.click(screen.getByRole("button", { name: "存" }));

    const stored = JSON.parse(window.localStorage.getItem("cca-saved-searches") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ name: "构建排查", query: "关键词" });

    await user.clear(inputOf());
    expect(savedCards()).toHaveLength(1);

    await user.click(savedCards()[0] as HTMLElement);
    expect(inputOf()).toHaveValue("关键词");
  });

  it("重名不覆盖，只提示换名并保留原有一条", async () => {
    const user = userEvent.setup();
    renderPalette(SOURCE_FILES);

    await user.type(inputOf(), "关键词");
    await user.click(saveButton());
    await user.clear(screen.getByLabelText("保存的搜索名称"));
    await user.type(screen.getByLabelText("保存的搜索名称"), "构建排查");
    await user.click(screen.getByRole("button", { name: "存" }));

    await user.clear(inputOf());
    await user.type(inputOf(), "构建");
    await user.click(saveButton());
    await user.clear(screen.getByLabelText("保存的搜索名称"));
    await user.type(screen.getByLabelText("保存的搜索名称"), " 构建排查 ");
    await user.click(screen.getByRole("button", { name: "存" }));

    expect(screen.getByRole("alert")).toHaveTextContent("已有同名搜索，换个名字保存");
    const stored = JSON.parse(window.localStorage.getItem("cca-saved-searches") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].query).toBe("关键词");
  });

  it("删除一条后卡片与存储同时消失", async () => {
    const user = userEvent.setup();
    renderPalette(SOURCE_FILES);

    await user.type(inputOf(), "关键词");
    await user.click(saveButton());
    await user.clear(screen.getByLabelText("保存的搜索名称"));
    await user.type(screen.getByLabelText("保存的搜索名称"), "构建排查");
    await user.click(screen.getByRole("button", { name: "存" }));
    await user.clear(inputOf());

    await user.click(screen.getByRole("button", { name: "删除保存的搜索 构建排查" }));
    expect(savedCards()).toHaveLength(0);
    expect(JSON.parse(window.localStorage.getItem("cca-saved-searches") ?? "[]")).toEqual([]);
  });
});
