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
    expect(await within(dashboard).findAllByText("读自日志")).toHaveLength(3);
    expect(within(dashboard).getByText("按定价快照估算")).toBeInTheDocument();
    expect(within(dashboard).getByText(/快照日期 \d{4}-\d{2}-\d{2}/)).toBeInTheDocument();
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
    expect(projects.textContent).toContain("-repo-alpha");
    expect(projects.textContent).toContain("-repo-beta");

    // The stacked bar's legend repeats the model names as readable text.
    expect(screen.getByText("claude-sonnet-4-5-20250929")).toBeInTheDocument();
    expect(screen.getByText("claude-haiku-4-5-20251001")).toBeInTheDocument();
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
});
