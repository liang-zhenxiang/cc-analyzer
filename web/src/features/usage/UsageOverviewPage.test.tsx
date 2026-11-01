import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { SessionMeta } from "../sessions/metadataCache";
import { UsageOverviewPage } from "./UsageOverviewPage";

/**
 * The page is tested through the whole hook + aggregation stack on a fake
 * `~/.claude/projects` tree, with session timestamps placed a few hours before
 * `Date.now()` so they always land inside the 7-day window regardless of when
 * the test runs (the window follows the local calendar day by design).
 */

const PROJECTS_ROOT = "/home/tester/.claude/projects";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/features/usage/UsageOverviewPage.tsx"),
  "utf8"
);

const pageCss = readFileSync(
  resolve(process.cwd(), "src/features/usage/UsageOverviewPage.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

function cssRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^{}]*)\\}`).exec(pageCss);
  expect(match, `样式表里找不到 ${selector}`).not.toBeNull();
  return match![1];
}

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

  // 快照导出走的正是生产里那条路：`dialog.savePath` 拿路径 → `fs.writeText` 写内容。
  // 默认一路成功；取消 / 写入失败由各用例按需覆写。
  const savePath = vi.fn(async () => "/tmp/cc-analyzer-usage.html");
  const writeText = vi.fn(async (path: string, contents: string) => {
    files[path] = contents;
  });

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
      writeText,
      stat: vi.fn(async (path: string) => ({
        is_file: true,
        size: (files[path] ?? "").length,
        mtime_ms: 1_700_000_000_000
      }))
    },
    dialog: {
      saveText: vi.fn(async () => null),
      saveMarkdown: vi.fn(async () => null),
      savePath,
      openFile: vi.fn(async () => null)
    },
    updater: { appVersion: vi.fn(async () => "0.18.0") },
    events: { onSessionImport: vi.fn(async () => () => undefined) }
  } as unknown as Bridges;
}

function renderPage(
  bridges: Bridges,
  props: { onOpenSession?: (session: SessionMeta) => void } = {}
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <BridgesProvider bridges={bridges}>{children}</BridgesProvider>
    </NotificationProvider>
  );
  return render(<UsageOverviewPage {...props} />, { wrapper });
}

function chartByName(name: string): HTMLElement {
  return screen.getByRole("img", { name });
}

/** The KPI tile that owns this label — numeric readouts are scoped to it.
 *  Round CC 起「周战报」的行头也叫「会话数 / 消息数」，限定 span（KPI 标签
 *  是瓦片里的 span，战报行头是 th），两块面板不会互抢。 */
function kpiTile(label: string): HTMLElement {
  return screen.getByText(label, { selector: "span" }).parentElement!;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("UsageOverviewPage", () => {
  it("页头扫描进度使用 --text-secondary，不在浅底上掉到 4.5 以下", () => {
    expect(cssRuleBody(".progress")).toContain("color: var(--text-secondary)");
  });

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
    // 「按定价快照估算」的徽章至少一枚（KPI 的估算成本）；消耗日历的色深
    // 口径也是估算（Round V），面板 actions 上会再多一枚——这里只锁「在场」。
    expect((await within(dashboard).findAllByText("按定价快照估算")).length).toBeGreaterThanOrEqual(1);
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
    // text; the raw id stays in the tooltip so nothing is lost. `span` scopes
    // this to the legend: the F1 flow diagram prints the same model names as
    // SVG text nodes (tspan), which are not part of this panel.
    expect(screen.getByText("Sonnet 4.5", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Haiku 4.5", { selector: "span" })).toBeInTheDocument();
    // select 的 option 也带同名 title（Round HH 后页面里多了模型下拉），
    // getByTitle 不认 selector——用 querySelector 直接锚图例 span。
    expect(
      document.querySelector('span[title="claude-sonnet-4-5-20250929"]')
    ).not.toBeNull();
  });

  it("renders the F1 flow diagram with the project → model → counter layers", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000),
      [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: sessionJsonl("b2", "claude-haiku-4-5-20251001", 5 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    expect(screen.getByRole("heading", { name: "Token 流向" })).toBeInTheDocument();
    const flow = await screen.findByRole("img", { name: /^Token 从 2 个项目流向 2 个模型/ });
    await waitFor(() => expect(flow.querySelectorAll("[data-flow-link]").length).toBeGreaterThan(0));
  });

  it("switches the activity panel between the heatmap and the clock", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000),
      [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: sessionJsonl("b2", "claude-haiku-4-5-20251001", 5 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    await waitFor(() => expect(chartByName("活跃时段热力图")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: "时钟" }));
    expect(screen.queryByRole("img", { name: "活跃时段热力图" })).toBeNull();
    expect(screen.getByRole("img", { name: /活跃时段时钟/ })).toBeInTheDocument();
    // Switching views keeps the same hourly source: the peak keeps its hour.
    expect(screen.getByText("峰值")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "热力图" }));
    await waitFor(() => expect(chartByName("活跃时段热力图")).toBeInTheDocument());
    expect(screen.queryByRole("img", { name: /活跃时段时钟/ })).toBeNull();
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

  it("导出快照按钮只在用量档出现，锚点与进度行同处页头", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    const button = await screen.findByRole("button", { name: "导出用量快照（单文件 HTML）" });
    expect(button).toHaveTextContent("导出快照");
    // 真机门禁靠这两个锚点判「按钮在进度文本右侧且不重叠」。
    expect(button).toHaveAttribute("data-probe", "usage-snapshot-export");
    const progress = document.querySelector('[data-probe="usage-progress"]');
    expect(progress).not.toBeNull();
    await waitFor(() => expect(button).not.toBeDisabled());

    // 错误档描述的不是同一个视图，快照入口不该在那里出现。
    await userEvent.click(screen.getByRole("tab", { name: "错误" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "导出用量快照（单文件 HTML）" })).toBeNull()
    );
    expect(document.querySelector('[data-probe="usage-progress"]')).not.toBeNull();
  });

  it("扫描中途禁用导出，并用 title 说明原因", async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 8; index += 1) {
      files[`${PROJECTS_ROOT}/-repo-alpha/session-${index}.jsonl`] = sessionJsonl(
        `s${index}`,
        "claude-sonnet-4-5-20250929",
        (index + 1) * 3_600_000
      );
    }
    // 第 9 个会话永远读不完：扫描停在「已发布 8 条、还剩 1 条」。页面已经能渲染
    // 仪表盘，但扫描态仍在——那正是按钮必须禁用、且必须说明原因的那一刻。
    files[`${PROJECTS_ROOT}/-repo-alpha/hangs.jsonl`] = sessionJsonl(
      "hang",
      "claude-sonnet-4-5-20250929",
      3_600_000
    );
    const bridges = createUsageBridges(files);
    const readText = bridges.fs.readText;
    bridges.fs.readText = vi.fn(async (path: string) => {
      if (path.endsWith("hangs.jsonl")) return new Promise<string>(() => undefined);
      return readText(path);
    }) as typeof bridges.fs.readText;

    renderPage(bridges);

    const button = await screen.findByRole("button", { name: "导出用量快照（单文件 HTML）" });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button).toHaveAttribute("title", "正在扫描会话，扫描完成后可导出");
    expect(screen.getByText(/已分析 \d+ \/ 9 个会话/)).toBeInTheDocument();
  });

  it("导出快照：文件名与扩展名交给保存对话框，产物写入那个路径", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    const button = await screen.findByRole("button", { name: "导出用量快照（单文件 HTML）" });
    await waitFor(() => expect(button).not.toBeDisabled());

    await userEvent.click(button);

    const savePath = vi.mocked(bridges.dialog.savePath);
    await waitFor(() => expect(savePath).toHaveBeenCalledTimes(1));
    const [defaultName, options] = savePath.mock.calls[0];
    expect(defaultName).toMatch(/^cc-analyzer-usage-\d{4}-\d{2}-\d{2}\.html$/);
    expect(options.extensions).toEqual(["html"]);
    expect(options.title).toContain("用量快照");

    const writeText = vi.mocked(bridges.fs.writeText);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const written = writeText.mock.calls.filter(([path]) => path.endsWith(".html"));
    expect(written).toHaveLength(1);
    const [path, contents] = written[0];
    expect(path).toBe("/tmp/cc-analyzer-usage.html");
    // 自包含的单文件文档：KPI 正文在场，且没有完整路径漏出来（隐私红线）。
    expect(contents).toContain("<!doctype html>");
    expect(contents).toContain("Tokens 总量");
    expect(contents).not.toContain("/home/tester");
    expect(contents).not.toContain(".jsonl");
    // 成功给一条与按钮同名的 toast。
    expect(await screen.findByText("已导出用量快照")).toBeInTheDocument();
  });

  it("用户取消保存时不写文件、不报错、不提示", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });
    vi.mocked(bridges.dialog.savePath).mockResolvedValue(null);

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    const button = await screen.findByRole("button", { name: "导出用量快照（单文件 HTML）" });
    await waitFor(() => expect(button).not.toBeDisabled());

    await userEvent.click(button);

    const savePath = vi.mocked(bridges.dialog.savePath);
    await waitFor(() => expect(savePath).toHaveBeenCalledTimes(1));
    // 元数据缓存那条 writeText 不算数：只数写进 .html 的那一次。
    const writeText = vi.mocked(bridges.fs.writeText);
    expect(writeText.mock.calls.filter(([path]) => path.endsWith(".html"))).toHaveLength(0);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/导出失败/)).toBeNull();
    expect(screen.queryByText("已导出用量快照")).toBeNull();
    expect(button).not.toBeDisabled();
  });

  it("写入失败时就地给出可见错误，并放出错误 toast", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });
    bridges.fs.writeText = vi.fn(async (path: string) => {
      if (path.endsWith(".html")) throw new Error("磁盘只读");
    }) as typeof bridges.fs.writeText;

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    const button = await screen.findByRole("button", { name: "导出用量快照（单文件 HTML）" });
    await waitFor(() => expect(button).not.toBeDisabled());

    await userEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("导出失败：Error: 磁盘只读");
    // 失败不是卡死：按钮要复原，用户可以换一个路径再试。
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("区间内 0 会话不禁用：导出的是「这个区间没有记录」这份正确产物", async () => {
    // 默认档位是近 30 天；这条会话在 40 天前——本机有数据，所选区间没有。
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/old.jsonl`]: sessionJsonl(
        "old",
        "claude-sonnet-4-5-20250929",
        40 * 24 * 3_600_000
      )
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    const button = await screen.findByRole("button", { name: "导出用量快照（单文件 HTML）" });
    // 扫描结束、区间为空，都不是禁用的理由：空态文档是一份正确产物。
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByText("近 30 天内 0 个会话纳入统计")).toBeInTheDocument();

    await userEvent.click(button);

    const writeText = vi.mocked(bridges.fs.writeText);
    await waitFor(() =>
      expect(writeText.mock.calls.filter(([path]) => path.endsWith(".html"))).toHaveLength(1)
    );
    const [, contents] = writeText.mock.calls.find(([path]) => path.endsWith(".html"))!;
    expect(contents).toContain("所选区间内没有会话记录");
    // 没有记录时成本是「未知」，不是 $0.00。
    expect(contents).not.toContain("$0.0000");
  });

  it("快照的「本窗口消耗」与屏幕上表盘读数逐字一致（同源证明）", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl(
        "a2",
        "claude-sonnet-4-5-20250929",
        6 * 3_600_000
      )
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    const button = await screen.findByRole("button", { name: "导出用量快照（单文件 HTML）" });
    await waitFor(() => expect(button).not.toBeDisabled());

    // 屏幕上表盘中心那个数（1000 + 200 + 3000 + 40000 = 44,200）。
    const gauge = document.querySelector('[data-probe="gauge"]');
    expect(gauge).not.toBeNull();
    const centerValue = gauge!.querySelector("text")!.textContent;
    expect(centerValue).toBe("44,200");

    await userEvent.click(button);

    const writeText = vi.mocked(bridges.fs.writeText);
    await waitFor(() =>
      expect(writeText.mock.calls.filter(([path]) => path.endsWith(".html"))).toHaveLength(1)
    );
    const [, contents] = writeText.mock.calls.find(([path]) => path.endsWith(".html"))!;
    // 同一条 readouts 既喂表盘也喂快照：文件里的读数必须与屏幕上逐字相同。
    expect(contents).toContain(`<dt>本窗口消耗</dt><dd>${centerValue} tok</dd>`);
  });

  it("页面只装一处计费读数：useBillingReadouts 只调用一次（结构性守卫）", () => {
    // 同一份 readouts 同时喂计费卡与「导出快照」——再冒出一处就是第二套窗口数学。
    expect(pageSource.match(/useBillingReadouts\(/g) ?? []).toHaveLength(1);
    // 卡是展示型组件：页面把 readouts 传下去，不再自己切窗口。
    expect(pageSource).toContain("<BillingWindowCard inputs={inputs} readouts={readouts}");
  });

  it("页面不自己算归因：源码里没有 attributeQuota 调用（结构性守卫）", () => {
    // 归因与窗口数学一样只有一份，住在 `billingReadoutsOf`；页面只能经 readouts 拿。
    expect(pageSource).not.toMatch(/\battributeQuota\s*\(/);
  });

  it("分段项是「用量 | 里程碑 | 错误 | 年报 | 实验室」；里程碑档吃同一份扫描、且不渲染时间范围控件", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000),
      [`${PROJECTS_ROOT}/-repo-alpha/bbb.jsonl`]: sessionJsonl("b2", "claude-sonnet-4-5-20250929", 5 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    // 顺序即契约（R1）：视图身份在前，四档并列；实验室是「读法的集合」，排最后。
    const viewTabs = within(screen.getByRole("tablist", { name: "总览视图" })).getAllByRole("tab");
    expect(viewTabs.map((tab) => tab.textContent)).toEqual([
      "用量",
      "里程碑",
      "错误",
      "年报",
      "实验室"
    ]);
    // 区间控件与扫描进度行两档共用；里程碑档把它撤掉（摆一个不起作用的控件更坏）。
    expect(screen.getByRole("tablist", { name: "时间范围" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "里程碑" }));

    expect(await screen.findByText(/全部已扫描的会话纳入统计/)).toBeInTheDocument();
    // 里程碑吃的是同一份全历史 inputs：两条会话，一个不少、也不重算。
    expect(screen.getByText(/共 2 个/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-probe="milestones-group"]')).toHaveLength(3);
    expect(screen.queryByRole("tablist", { name: "时间范围" })).toBeNull();
    // 进度行按档分叉（右簇位置不动）。
    expect(screen.getByText("全部 2 个已扫描会话纳入统计")).toBeInTheDocument();
  });

  it("年报档（E4）：第 4 档渲染整年卡片、隐藏时间范围控件、不新增 I/O", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    const readDir = vi.mocked(bridges.fs.readDir);
    await waitFor(() => expect(readDir).toHaveBeenCalled());
    const before = readDir.mock.calls.length;

    await userEvent.click(screen.getByRole("tab", { name: "年报" }));

    // 年度探针 = 整档的落点；六张卡在场（数据来自同一份全历史 inputs）。
    const report = await waitFor(() => {
      const node = document.querySelector('[data-probe="year-report"]');
      if (node === null) throw new Error("年报还没渲染");
      return node as HTMLElement;
    });
    expect(within(report).getAllByRole("region")).toHaveLength(6);
    // 「近 N 天」对年报不生效——控件撤掉，而不是摆着不管用。
    expect(screen.queryByRole("tablist", { name: "时间范围" })).toBeNull();
    // 进度行按档分叉，说清是全历史口径。
    expect(screen.getByText("全部 1 个已扫描会话纳入年度统计")).toBeInTheDocument();
    // 年报不导出（规格 §10.3）：快照按钮只在用量档。
    expect(screen.queryByRole("button", { name: /导出用量快照/ })).toBeNull();
    // 切档不触发重扫（R1）。
    expect(readDir.mock.calls.length).toBe(before);
  });

  it("实验室档（Round FF）：十一张卡都在、区间控件保留、进度行写明 11 个视角", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    await userEvent.click(screen.getByRole("tab", { name: "实验室" }));

    // 第 5 档、排最后；实验室自己承担页头（h2 + 口径），十一张卡各带截图定位属性。
    expect(await screen.findByRole("region", { name: "数据实验室" })).toBeInTheDocument();
    expect(document.querySelectorAll("[data-lab-card]")).toHaveLength(11);
    // Round HH 的收工推演独占一行，挂在沙盘之后。
    const cutoff = document.querySelector('[data-lab-card="cutoff"]');
    expect(cutoff).not.toBeNull();
    expect(within(cutoff as HTMLElement).getByRole("region", { name: "收工推演" })).toBeInTheDocument();
    // 9 张卡吃「近 N 天」，所以区间控件必须留着（不是里程碑那种全历史档）。
    expect(screen.getByRole("tablist", { name: "时间范围" })).toBeInTheDocument();
    expect(screen.getByText(/纳入统计 · 11 个视角/)).toBeInTheDocument();
    // Round HH H1：这份夹具里模型没有值得说的事，整条带子不出现（0 条不打扰）。
    // 非空的排序/前缀/跳转由 BriefingStrip.test.tsx 逐条钉住。
    expect(document.querySelector('[data-probe="briefing"]')).toBeNull();
    // 快照只描述「用量」那一档，实验室不导出。
    expect(screen.queryByRole("button", { name: /导出用量快照/ })).toBeNull();
    expect(localStorage.getItem("cca-usage-view")).toBe("lab");
  });

  it("readStoredView 认得 lab：刷新后仍停在实验室档", async () => {
    window.localStorage.setItem("cca-usage-view", "lab");
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });

    renderPage(bridges);

    expect(await screen.findByRole("region", { name: "数据实验室" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "实验室" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("里程碑档不新增 I/O：切档前后扫描次数不变（R1）", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    const readDir = vi.mocked(bridges.fs.readDir);
    await waitFor(() => expect(readDir).toHaveBeenCalled());
    const before = readDir.mock.calls.length;

    await userEvent.click(screen.getByRole("tab", { name: "里程碑" }));
    await screen.findByText(/全部已扫描的会话纳入统计/);

    expect(readDir.mock.calls.length).toBe(before);
  });

  it("readStoredView 认得 milestones：刷新后仍停在里程碑档", async () => {
    window.localStorage.setItem("cca-usage-view", "milestones");
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });

    renderPage(bridges);

    expect(await screen.findByText(/全部已扫描的会话纳入统计/)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "里程碑" })).toHaveAttribute("aria-selected", "true");
    // 未知值仍回落「用量」——这一条由既有用例与这里的正例一起锁住。
    expect(localStorage.getItem("cca-usage-view")).toBe("milestones");
  });

  it("里程碑档自己承担空态：扫到 0 个会话时是一条事实行，不是用量档那句", async () => {
    window.localStorage.setItem("cca-usage-view", "milestones");
    const bridges = createUsageBridges({});
    bridges.fs.readDir = vi.fn(async () => []) as typeof bridges.fs.readDir;

    renderPage(bridges);

    expect(await screen.findByText("还没有可以回顾的里程碑")).toBeInTheDocument();
    expect(document.querySelector('[data-probe="milestones-empty"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-probe="milestone-card"]')).toHaveLength(0);
    // 用量档那条空态文案一字未动，只是不再拦在里程碑档前面。
    expect(screen.queryByText("还没有可统计的会话")).toBeNull();
  });

  it("里程碑的会话入口把完整 SessionMeta 交回页面（与压缩 top3 同一条握手）", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    const filePath = `${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`;
    const bridges = createUsageBridges({
      [filePath]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 3_600_000)
    });

    renderPage(bridges, { onOpenSession });
    await screen.findByRole("region", { name: "用量总览" });
    await userEvent.click(screen.getByRole("tab", { name: "里程碑" }));

    const card = (await screen.findByText("第一次会话")).closest("[data-milestone]");
    expect(card).not.toBeNull();
    const entry = card!.querySelector('[data-probe="milestone-entry"]') as HTMLButtonElement;
    expect(entry).not.toBeNull();
    await user.click(entry);

    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession.mock.calls[0][0]).toMatchObject({ path: filePath });
  });

  it("里程碑的日期入口：切回用量档并展开到那一天（受控下钻，R5）", async () => {
    const user = userEvent.setup();
    const filePath = `${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`;
    const bridges = createUsageBridges({
      [filePath]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000)
    });

    // 不传 onOpenSession：里程碑的证据行退成「那一天」入口——这是它在页面上的
    // 一条真实形态（有会话元数据时证据行优先打开会话，日期则走记录类的日期入口）。
    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });
    await userEvent.click(screen.getByRole("tab", { name: "里程碑" }));

    const card = (await screen.findByText("第一次会话")).closest("[data-milestone]");
    expect(card).not.toBeNull();
    const entry = card!.querySelector('[data-probe="milestone-entry"]') as HTMLButtonElement;
    expect(entry).not.toBeNull();
    expect(entry.getAttribute("aria-label")).toMatch(/^打开 .+ 的一日回望$/);
    await user.click(entry);

    // ① 切回用量档（日历就住在这一档）。
    expect(screen.getByRole("tab", { name: "用量" })).toHaveAttribute("aria-selected", "true");

    // ② 日历真的展开到**那一天**：展开区在场，且头部写的就是那一天的会话数。
    const day = new Date(Date.now() - 6 * 3_600_000);
    day.setHours(0, 0, 0, 0);
    const dayLabel = `${day.getMonth() + 1}月${day.getDate()}日`;
    const detail = document.querySelector("[data-calendar-sessions]") as HTMLElement;
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain(`${dayLabel} · 1 个会话`);
    // 对应格子的展开态也跟着亮起来（受控下钻走的是格子点击那条内部逻辑）。
    expect(
      document.querySelector('[data-probe="calendar-day"][aria-expanded="true"]')
    ).not.toBeNull();
  });
  it("Round DD：十块新内容都挂在用量档 / 里程碑档的正确位置上", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000),
      [`${PROJECTS_ROOT}/-repo-beta/bbb.jsonl`]: sessionJsonl("b2", "claude-opus-4-1-20250805", 5 * 3_600_000)
    });
    const user = userEvent.setup();
    renderPage(bridges);

    const dashboard = await screen.findByRole("region", { name: "用量总览" });
    // D1 会话对比 / D4 指纹雷达 / D8 工作习惯 / D7 会话甘特 / F6 项目卡片。
    expect(await within(dashboard).findByRole("region", { name: "会话对比" })).toBeInTheDocument();
    expect(within(dashboard).getByRole("region", { name: "指纹雷达" })).toBeInTheDocument();
    expect(within(dashboard).getByRole("region", { name: "工作习惯" })).toBeInTheDocument();
    expect(within(dashboard).getByRole("region", { name: "会话甘特" })).toBeInTheDocument();
    expect(within(dashboard).getByRole("region", { name: "项目卡片" })).toBeInTheDocument();
    // D9 峰值时刻在周战报里、D10 换算按钮在 KPI 脚注里。峰值行随扫描完成出现，
    // 在扫描态下断言会变成「谁先跑完」的竞态——等它到场再断言。
    await waitFor(() =>
      expect(document.querySelector('[data-probe="peak-minute"]')).not.toBeNull()
    );
    expect(screen.getByRole("button", { name: /换算成日常事物/ })).toBeEnabled();
    // D6 微表只挂在 forecast 行里；该行要有限额才有，单测夹具没有配限额，
    // 所以这里只保证没有把它误挂到别处（由 BurnGaugeDial.test 覆盖画法）。

    // D3 换模是「按模型分布」的第二个视图，切换后表头换成实际/三族。
    await user.click(screen.getByRole("tab", { name: "换模" }));
    expect(await screen.findByText("实际（按各会话模型）")).toBeInTheDocument();
    expect(screen.getByText("全部换成 Haiku")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "占比" }));

    // D5 海报挂在里程碑档尾。
    await user.click(screen.getByRole("tab", { name: "里程碑" }));
    expect(await screen.findByRole("region", { name: "开发者海报" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 SVG" })).toBeEnabled();
  });

  it("Round EE：趋势叠层、异常角标、新鲜度、迁移 tab 与 KPI sparkline 都在位", async () => {
    // 8 天各有一次会话，第 6 天再加三次 → 那一天是明确的突增（z 远大于 2）。
    // 两个模型交替出现，迁移图因此有两行。
    const DAY = 24 * 3_600_000;
    const files: Record<string, string> = {};
    for (let index = 1; index <= 8; index += 1) {
      const model =
        index % 2 === 0 ? "claude-sonnet-4-5-20250929" : "claude-opus-4-1-20250805";
      files[`${PROJECTS_ROOT}/-repo-alpha/day-${index}.jsonl`] = sessionJsonl(
        `e${index}`,
        model,
        index * DAY
      );
    }
    for (let extra = 0; extra < 3; extra += 1) {
      files[`${PROJECTS_ROOT}/-repo-alpha/spike-${extra}.jsonl`] = sessionJsonl(
        `spike-${extra}`,
        "claude-sonnet-4-5-20250929",
        6 * DAY + 6_000 + extra * 1_000
      );
    }

    const user = userEvent.setup();
    renderPage(createUsageBridges(files));

    const dashboard = await screen.findByRole("region", { name: "用量总览" });
    expect(await within(dashboard).findByText("每日 Token 消耗")).toBeInTheDocument();

    // E9 新鲜度：页头右侧，说的是「最近一条记录有多旧」，不编造扫描时刻。
    const freshness = document.querySelector('[data-probe="data-freshness"]');
    expect(freshness).not.toBeNull();
    // 扫描期间徽章写「刷新中…（上次 HH:MM）」；扫描结束才报「数据截至」。
    // waitFor 内部重试到扫描落定，两种文案都合法终态。
    // 全量并行跑单测时，11 个会话的渐进扫描可能超过 waitFor 的默认 1 秒；
    // 这里明确等到扫描落定，避免把 CPU 争用误报成「文案不对」。
    await waitFor(
      () =>
        expect(freshness?.textContent).toMatch(
          /^(数据截至 \d{2}:\d{2}（\d+ 分钟前）|刷新中…（上次 \d{2}:\d{2}）|暂无数据)$/
        ),
      { timeout: 5_000 }
    );

    // E1 叠层：默认 30 天窗口 → 均线与外推都够数据（判定按窗口天数，
    // 与 aggregateRange 补零后的序列一致）。
    await waitFor(() =>
      expect(document.querySelector('[data-probe="trend-ma"]')).not.toBeNull()
    );
    expect(document.querySelector('[data-probe="trend-forecast"]')).not.toBeNull();
    expect(screen.getByText(/实线＝7 天移动平均/)).toBeInTheDocument();
    expect(screen.getByText(/虚线＝按最近 14 天外推/)).toBeInTheDocument();

    // E2 异常：图上的 ▲ 与日历角标是同一个判定。
    const marks = document.querySelectorAll('[data-probe="anomaly-marks"] > span');
    expect(marks.length).toBeGreaterThanOrEqual(1);
    const dotted = document.querySelectorAll('[data-probe="calendar-day"][aria-label$="，异常"]');
    expect(dotted.length).toBeGreaterThanOrEqual(1);

    // E10：只有 token 与消息两张卡有按天序列，所以恰好两条 sparkline。
    expect(document.querySelectorAll('[data-probe="kpi-sparkline"]')).toHaveLength(2);
    // 数值行用 flex 把线贴到右端；14px 的线不改变 28px 数值行/76px 卡高。
    expect(cssRuleBody(".kpiValue")).toContain("display: flex");
    expect(cssRuleBody(".kpiSpark")).toContain("margin-left: auto");

    // E6 迁移：两个模型 → 两行起止条。
    await user.click(screen.getByRole("tab", { name: "迁移" }));
    // 迁移档行文的 span 与模型下拉 option 同名——锚定迁移条容器内 span。
    expect(
      await screen.findByText("Sonnet 4.5", { selector: 'div[data-probe="model-migration"] span' })
    ).toBeInTheDocument();
    expect(
      screen.getByText("Opus 4.1", { selector: 'div[data-probe="model-migration"] span' })
    ).toBeInTheDocument();
    expect(document.querySelectorAll('[data-probe="migration-bar"]')).toHaveLength(2);
    expect(document.querySelector('[data-probe="model-migration"]')).not.toBeNull();
  });

  it("用量档渲染 story-log 容器（G1 挂载点：KPI 之后、周战报之前）", async () => {
    const bridges = createUsageBridges({
      [`${PROJECTS_ROOT}/-repo-alpha/aaa.jsonl`]: sessionJsonl("a2", "claude-sonnet-4-5-20250929", 6 * 3_600_000)
    });

    renderPage(bridges);
    await screen.findByRole("region", { name: "用量总览" });

    // 探针在场 = G1 真挂进了用量档（组件自己另有 5 条行为测试，这里只钉挂载）。
    const storyLog = await waitFor(() => {
      const node = document.querySelector('[data-probe="story-log"]');
      if (node === null) throw new Error("story-log 还没渲染");
      return node as HTMLElement;
    });
    expect(storyLog).toBeInTheDocument();
    // 挂载次序：story-log 必须出现在周战报之前（「先量级、再日子、再方向」）。
    const digest = document.querySelector("section[aria-label='周战报'], [data-probe='weekly-digest']");
    if (digest !== null) {
      expect(storyLog.compareDocumentPosition(digest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });
});
