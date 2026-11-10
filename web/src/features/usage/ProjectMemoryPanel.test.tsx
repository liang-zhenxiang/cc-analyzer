import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectMemory } from "./projectMemory";
import { ProjectMemoryPanel } from "./ProjectMemoryPanel";

/**
 * 项目记忆的组件用例：钉「排版有没有把模型给的字段放到位」。
 * 归一化、排序、窗口口径都由 `projectMemory.test.ts` 负责，这里不重算。
 */

const NOW = Date.now();

function memory(patch: Partial<ProjectMemory> & Pick<ProjectMemory, "project">): ProjectMemory {
  return {
    sessions: 3,
    tokens: 1_234_567,
    lastActive: NOW - 2 * 3_600_000,
    commands: [],
    files: [],
    pitfalls: [],
    ...patch
  };
}

const ALPHA = memory({
  project: "alpha",
  sessions: 12,
  commands: [
    { command: "npm test", count: 12, failures: 0, lastUsed: NOW },
    { command: "npm run lint", count: 4, failures: 1, lastUsed: NOW }
  ],
  files: [
    { name: "src/app.ts", touches: 9, edits: 2, lastTouched: NOW },
    { name: "src/db.ts", touches: 3, edits: 1, lastTouched: NOW }
  ],
  pitfalls: [
    {
      signature: "ENOENT: no such file or directory, open 'package.json'",
      tool: "Bash",
      failures: 3,
      firstSeen: NOW - 86_400_000,
      lastSeen: NOW,
      recovered: true
    },
    {
      signature: "TypeError: Cannot read properties of undefined (reading 'id')",
      tool: "Edit",
      failures: 2,
      firstSeen: NOW - 3_600_000,
      lastSeen: NOW,
      recovered: false
    }
  ]
});

const BETA = memory({
  project: "beta",
  sessions: 2,
  tokens: 400,
  commands: [{ command: "cargo check", count: 6, failures: 0, lastUsed: NOW }],
  files: [{ name: "src-tauri/src/lib.rs", touches: 5, edits: 3, lastTouched: NOW }]
});

/** 头部读数与命令次数可能同值（都是 12），断言时必须限定在 header 里。 */
function header(): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2 });
  const found = heading.closest("header");
  if (!found) throw new Error("项目名不在 header 里");
  return found;
}

afterEach(cleanup);

describe("ProjectMemoryPanel · 项目切换", () => {
  it("默认选中第一个项目，点击另一个项目后内容与 aria-pressed 一起换", async () => {
    const user = userEvent.setup();
    render(<ProjectMemoryPanel memories={[ALPHA, BETA]} />);

    // 外层 section 是有名字的 region（e2e 靠它定位）。
    expect(screen.getByRole("region", { name: "项目记忆" })).toBeInTheDocument();

    const alphaButton = screen.getByRole("button", { name: /alpha/ });
    const betaButton = screen.getByRole("button", { name: /beta/ });
    expect(alphaButton).toHaveAttribute("aria-pressed", "true");
    expect(betaButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { level: 2, name: "alpha" })).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();

    await user.click(betaButton);

    expect(betaButton).toHaveAttribute("aria-pressed", "true");
    expect(alphaButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("heading", { level: 2, name: "beta" })).toBeInTheDocument();
    expect(screen.getByText("cargo check")).toBeInTheDocument();
    // 上一个项目的命令不残留在 DOM 里。
    expect(screen.queryByText("npm test")).toBeNull();
  });

  it("切换项目时清空搜索，不让新项目一进来就是「没有匹配」", async () => {
    const user = userEvent.setup();
    render(<ProjectMemoryPanel memories={[ALPHA, BETA]} />);

    const search = screen.getByLabelText("搜索命令或文件");
    await user.type(search, "npm");
    expect(search).toHaveValue("npm");

    await user.click(screen.getByRole("button", { name: /beta/ }));
    expect(search).toHaveValue("");
    expect(screen.getByText("cargo check")).toBeInTheDocument();
  });
});

describe("ProjectMemoryPanel · 三个区块", () => {
  it("头部读数与三个区块各就各位", () => {
    const { container } = render(<ProjectMemoryPanel memories={[ALPHA]} />);

    // 头部：会话 / token（formatTokenCount 的 M 档）/ 最近活跃。
    const head = within(header());
    expect(head.getByText("12")).toBeInTheDocument();
    expect(head.getByText("1.2M")).toBeInTheDocument();
    expect(head.getByText("2小时前")).toBeInTheDocument();

    for (const title of ["常用命令", "热文件", "坑与恢复"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }

    // 命令：等宽命令名 + 次数徽章；有失败的命令带一个可读的三角标记。
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("npm run lint")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "1 次失败" })).toBeInTheDocument();

    // 热文件：文件名 + 「N 触碰 · M 改」+ 归一化热度条（touches 含读与写）。
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("9 触碰 · 2 改")).toBeInTheDocument();
    expect(screen.getByText("3 触碰 · 1 改")).toBeInTheDocument();
    const heat = [...container.querySelectorAll<HTMLElement>('[data-probe="memory-heat"]')];
    expect(heat).toHaveLength(2);
    // 9 是最大 touches，所以第一条满宽；3/9 ≈ 33.33%。
    expect(heat[0]?.style.width).toBe("100%");
    expect(parseFloat(heat[1]?.style.width ?? "0")).toBeCloseTo((3 / 9) * 100);

    // 坑与恢复：两行签名、次数、两种恢复标记都在。
    expect(
      screen.getByText("ENOENT: no such file or directory, open 'package.json'")
    ).toBeInTheDocument();
    expect(screen.getByText("3 次")).toBeInTheDocument();
    expect(screen.getByText(/已恢复/)).toBeInTheDocument();
    expect(screen.getByText(/未恢复/)).toBeInTheDocument();
    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("项目里没有的区块整块省略，不印空表", () => {
    render(
      <ProjectMemoryPanel
        memories={[memory({ project: "only-commands", commands: ALPHA.commands })]}
      />
    );

    expect(screen.getByRole("heading", { level: 3, name: "常用命令" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "热文件" })).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "坑与恢复" })).toBeNull();
  });

  it("完全没有数据的项目给一行实话，而不是三张空表", () => {
    render(<ProjectMemoryPanel memories={[memory({ project: "empty-project" })]} />);

    expect(screen.getByText("这个项目还没有留下可归纳的记忆。")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });
});

describe("ProjectMemoryPanel · 搜索", () => {
  it("输入即过滤命令与文件名，互不误伤", async () => {
    const user = userEvent.setup();
    render(<ProjectMemoryPanel memories={[ALPHA]} />);

    const search = screen.getByLabelText("搜索命令或文件");
    expect(search).toHaveAttribute("data-probe", "memory-search");

    await user.type(search, "npm");
    expect(screen.getByText("npm test")).toBeInTheDocument();
    expect(screen.getByText("npm run lint")).toBeInTheDocument();
    // 文件名不匹配时整块热文件一起收起。
    expect(screen.queryByText("src/app.ts")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "热文件" })).toBeNull();

    await user.clear(search);
    await user.type(search, "src/db");
    expect(screen.getByText("src/db.ts")).toBeInTheDocument();
    expect(screen.queryByText("npm test")).toBeNull();
    expect(screen.queryByRole("heading", { level: 3, name: "常用命令" })).toBeNull();
  });

  it("命令和文件都没命中时只给一行提示", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProjectMemoryPanel memories={[ALPHA]} />);

    await user.type(screen.getByLabelText("搜索命令或文件"), "zzz");

    expect(screen.getByText("没有匹配的命令或文件")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-probe="memory-command"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-probe="memory-file"]')).toHaveLength(0);
  });

  it("搜索不隐藏坑与恢复——报错签名不是命令/文件检索的目标", async () => {
    const user = userEvent.setup();
    render(<ProjectMemoryPanel memories={[ALPHA]} />);

    await user.type(screen.getByLabelText("搜索命令或文件"), "zzz");

    expect(screen.getByRole("heading", { level: 3, name: "坑与恢复" })).toBeInTheDocument();
    expect(screen.getByText(/已恢复/)).toBeInTheDocument();
  });
});

describe("ProjectMemoryPanel · 空态", () => {
  it("窗口里没有项目时用整页空态，不渲染项目索引", () => {
    render(<ProjectMemoryPanel memories={[]} />);

    expect(screen.getByRole("region", { name: "项目记忆" })).toBeInTheDocument();
    expect(screen.getByText("这个窗口还没有项目记忆")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});
