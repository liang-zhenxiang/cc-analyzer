import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { UsageOverviewPage } from "./UsageOverviewPage";

/**
 * The page is tested through the whole hook + aggregation stack on a fake
 * `~/.claude/projects` tree, with session timestamps placed a few hours before
 * `Date.now()` so they always land inside the 7-day window regardless of when
 * the test runs (the window follows the local calendar day by design).
 */

const PROJECTS_ROOT = "/home/tester/.claude/projects";

function iso(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function sessionJsonl(assistantId: string, model: string, msAgo: number): string {
  return (
    JSON.stringify({
      type: "user",
      timestamp: iso(msAgo),
      uuid: `${assistantId}-u`,
      message: { role: "user", content: "hi" }
    }) +
    "\n" +
    JSON.stringify({
      type: "assistant",
      timestamp: iso(msAgo - 5_000),
      uuid: assistantId,
      message: {
        id: `msg-${assistantId}`,
        role: "assistant",
        model,
        content: [{ type: "text", text: "ok" }],
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_creation_input_tokens: 3000,
          cache_read_input_tokens: 40000
        }
      }
    })
  );
}

function createUsageBridges(files: Record<string, string>): Bridges {
  const byDir = new Map<string, string[]>();
  for (const path of Object.keys(files)) {
    const segments = path.split("/");
    const dir = segments.slice(0, -1).join("/");
    byDir.set(dir, [...(byDir.get(dir) ?? []), segments[segments.length - 1]]);
  }
  const projectDirs = [...byDir.keys()].filter((dir) => dir.startsWith(`${PROJECTS_ROOT}/`));

  return {
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async (path: string) =>
        path === PROJECTS_ROOT
          ? projectDirs.map((dir) => ({
              name: dir.slice(PROJECTS_ROOT.length + 1),
              is_dir: true,
              is_file: false
            }))
          : (byDir.get(path) ?? []).map((name) => ({ name, is_dir: false, is_file: true }))
      ),
      readText: vi.fn(async (path: string) => {
        const content = files[path];
        if (content === undefined) throw new Error(`文件不存在 ${path}`);
        return content;
      }),
      readHead: vi.fn(async (path: string) => files[path] ?? ""),
      writeText: vi.fn(async (path: string, contents: string) => {
        files[path] = contents;
      }),
      stat: vi.fn(async (path: string) => ({
        is_file: true,
        size: (files[path] ?? "").length,
        mtime_ms: 1_700_000_000_000
      }))
    },
    events: { onSessionImport: vi.fn(async () => () => undefined) }
  } as unknown as Bridges;
}

function renderPage(bridges: Bridges) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <BridgesProvider bridges={bridges}>{children}</BridgesProvider>
  );
  return render(<UsageOverviewPage />, { wrapper });
}

function chartByName(name: string): HTMLElement {
  return screen.getByRole("img", { name });
}

/** The KPI tile that owns this label — numeric readouts are scoped to it. */
function kpiTile(label: string): HTMLElement {
  return screen.getByText(label).parentElement!;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("UsageOverviewPage", () => {
  it("renders the KPI readouts with provenance badges and the snapshot date", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000),
      [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: sessionJsonl("b2", "claude-opus-4-1-20250805", 5 * 3_600_000)
    });

    renderPage(bridges);

    const dashboard = await screen.findByRole("region", { name: "用量总览" });
    // Two sessions × (1000 + 200 + 3000 + 40000) tokens, 2 sessions, 4 messages.
    await waitFor(() => expect(within(kpiTile("Tokens 总量")).getByText("88,400")).toBeInTheDocument());
    expect(within(kpiTile("会话数")).getByText("2")).toBeInTheDocument();
    expect(within(kpiTile("消息数")).getByText("4")).toBeInTheDocument();

    // Logged figures say so; the cost says how it was estimated and against
    // which snapshot — the acceptance criteria make these labels load-bearing.
    // 计费窗口卡的「窗口开启」也是读自日志，因此按 KPI 行的作用域数 3 枚。
    const kpiRow = dashboard.querySelector("div[class*='kpiRow']");
    expect(kpiRow).not.toBeNull();
    expect(await within(kpiRow as HTMLElement).findAllByText("读自日志")).toHaveLength(3);
    expect(within(dashboard).getByText("按定价快照估算")).toBeInTheDocument();
    // 免责说明收在 KPI 卡底部的跨列脚注里，日期仍是看得见的正文。
    expect(within(dashboard).getByText(/定价快照（\d{4}-\d{2}-\d{2}）/)).toBeInTheDocument();
    expect(within(dashboard).getByText(/不是账单/)).toBeInTheDocument();
  });

  it("switches the trend between 30 and 7 days", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    const trend = chartByName("每日 Token 消耗趋势");
    // The persisted default is 30 days; zero-filled days still draw their
    // flat bar, so the range is exactly N points.
    await waitFor(() => expect(trend.querySelectorAll("rect")).toHaveLength(30));

    await userEvent.click(screen.getByRole("tab", { name: "近 7 天" }));
    await waitFor(() => expect(trend.querySelectorAll("rect")).toHaveLength(7));
  });

  it("isolates one token class in the trend", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    const trend = chartByName("每日 Token 消耗趋势");
    await waitFor(() => expect(trend.querySelectorAll("rect").length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("tab", { name: "缓存读取" }));
    // Only the cache-read counter: one assistant record → the lone day's bar
    // tooltip reads 40,000 (the whole-session figure would be 44,200).
    await waitFor(() => expect(trend.textContent).toContain("40,000"));
    expect(trend.textContent).not.toContain("44,200");
    expect(screen.getByRole("tab", { name: "缓存读取" })).toHaveAttribute("aria-selected", "true");
  });

  it("shows distributions and the hourly heatmap", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000),
      [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: sessionJsonl("b2", "claude-haiku-4-5-20251001", 5 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    // Distributions and the heatmap render EmptyState until the progressive
    // scan publishes, so wait for their data ink rather than asserting at once.
    await waitFor(() =>
      expect(chartByName("按项目分布").querySelectorAll("rect").length).toBeGreaterThan(0)
    );
    expect(chartByName("按模型分布")).toBeInTheDocument();
    expect(chartByName("活跃时段热力图")).toBeInTheDocument();

    const projects = chartByName("按项目分布");
    // 标签是会话真实 cwd 的末段（夹具里没有 cwd，退回目录名本身）。
    expect(projects.textContent).toContain("-repo-alpha");
    expect(projects.textContent).toContain("-repo-beta");

    // The stacked bar's legend prints the model family and version as readable
    // text; the raw id stays in the tooltip so nothing is lost.
    expect(screen.getByText("Sonnet 4.5")).toBeInTheDocument();
    expect(screen.getByText("Haiku 4.5")).toBeInTheDocument();
    expect(screen.getByTitle("claude-sonnet-4-5-20250929")).toBeInTheDocument();
  });

  it("flags unknown models instead of pricing them at zero", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000),
      [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: sessionJsonl("b2", "gpt-unknown-9", 5 * 3_600_000)
    });

    renderPage(bridges);

    const dashboard = await screen.findByRole("region", { name: "用量总览" });
    // The note's text is interpolated around the token figure, so match a regex.
    await waitFor(() =>
      expect(within(dashboard).getByText(/部分会话未知价/)).toBeInTheDocument()
    );
    // The known model is still priced; the unknown one's tokens are named.
    expect(within(dashboard).getByText(/约 44,200 tok 未计入/)).toBeInTheDocument();
  });

  it("guides to the analyzer when there is nothing to scan", async () => {
    const bridges = createUsageBridges({});
    // No project directories at all: readDir of the projects root is empty.
    bridges.fs.readDir = vi.fn(async () => []) as typeof bridges.fs.readDir;

    renderPage(bridges);

    expect(await screen.findByText("还没有可统计的会话")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "用量总览" })).not.toBeInTheDocument();
  });

  it("报错时给出可重试的错误态，而不是把原始错误串当正文", async () => {
    const bridges = createUsageBridges({});
    const raw =
      "扫描会话列表失败: Error: E2E 虚拟文件系统: readDir 遇到未声明的路径 " +
      "/Users/e2e/.claude/projects。请在夹具里声明它——静默返回空数组会把夹具错误伪装成成功缺陷。";
    bridges.fs.readDir = vi.fn(async () => {
      throw new Error(raw);
    }) as typeof bridges.fs.readDir;

    renderPage(bridges);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("会话列表读取失败");
    // 正文里没有绝对路径，也没有写给维护者的话。
    expect(alert.textContent).not.toContain("/Users/");
    expect(alert.textContent).not.toContain("夹具");
    expect(alert.innerHTML).not.toContain("/Users/");
    // 无重试的错误提示等于让用户自己去找刷新按钮，而那个按钮在另一个标签里。
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("错误态的重试真的重新扫描一次", async () => {
    const user = userEvent.setup();
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });
    let fail = true;
    const readDir = bridges.fs.readDir;
    bridges.fs.readDir = vi.fn(async (path: string) => {
      if (fail && path === PROJECTS_ROOT) throw new Error("扫描失败");
      return readDir(path);
    }) as typeof bridges.fs.readDir;

    renderPage(bridges);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("会话列表读取失败");

    fail = false;
    await user.click(screen.getByRole("button", { name: "重试" }));

    // 重试成功后回到仪表盘本体——错误态与数据不该同屏。
    expect(await screen.findByRole("region", { name: "用量总览" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
