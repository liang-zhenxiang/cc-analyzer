import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import type { Bridges } from "../api/types";

beforeEach(() => {
  window.localStorage.clear();
});

const bridges = {
  fs: {
    homeDir: vi.fn(async () => "/home/tester"),
    appDataDir: vi.fn(async () => "/app-data"),
    readDir: vi.fn(async () => []),
    readText: vi.fn(async () => "{}"),
    readHead: vi.fn(async () => "{}"),
    writeText: vi.fn(async () => undefined),
    stat: vi.fn(async () => ({ is_file: true, size: 1, mtime_ms: 1 }))
  },
  events: { onSessionImport: vi.fn(async () => () => undefined) },
  monitor: { monitorPort: vi.fn(async () => 8090), pingMonitor: vi.fn(async () => true) },
  clipboard: { writeText: vi.fn(async () => undefined) },
  updater: {
    appVersion: vi.fn(async () => "0.0.0-test"),
    checkUpdates: vi.fn(async () => ({ available: false, currentVersion: "0.0.0-test" })),
    relaunch: vi.fn(async () => undefined)
  }
} as unknown as Bridges;

/**
 * 切到监控标签并打开面板。面板不再在挂载时自动探测，
 * 所以「仪表盘已经内嵌」这件事之前必须先有这一次点击。
 */
async function openMonitor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  await user.click(screen.getByRole("button", { name: "打开监控" }));
  await screen.findByTitle("实时监控仪表盘");
}

test("顶栏版本徽章显示真实版本并可点击复制", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  // 版本取自 Rust 的 package_info（mock 桩为非零值），是升级生效的第一眼证据
  const badge = await screen.findByRole("button", { name: /当前版本 v0\.0\.0-test/ });
  expect(badge).toBeInTheDocument();
  // 版本号里带 `-` 即为先行版：徽章显式标 Beta，一眼区分装的是哪种渠道
  expect(within(badge).getByText("Beta")).toBeInTheDocument();

  await user.click(badge);
  await waitFor(() =>
    expect(bridges.clipboard.writeText).toHaveBeenCalledWith("CC Analyzer v0.0.0-test")
  );
});

test("⌘K 唤起全局搜索面板，Esc 关闭；顶栏按钮亦可唤起", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  // 快捷键打开：对话框出现且焦点在输入框。
  // jsdom 里 userEvent 的修饰键链路到不了 window 级监听，直接派发。
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const dialog = screen.getByRole("dialog", { name: "全局搜索" });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText("搜索消息")).toHaveFocus();

  // Esc 关闭
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument();

  // 顶栏按钮同样可唤起
  await user.click(screen.getByRole("button", { name: "全局搜索" }));
  expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeInTheDocument();
});

test("switches analyzer and monitor tabs", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  expect(screen.getByRole("tab", { name: "会话分析", selected: true })).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  expect(screen.getByRole("tab", { name: "实时监控", selected: true })).toBeInTheDocument();
  expect(localStorage.getItem("cca-workspace-tab")).toBe("monitor");
});

test("switches to the usage overview tab and persists the choice", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  await user.click(screen.getByRole("tab", { name: "用量总览" }));
  expect(screen.getByRole("tab", { name: "用量总览", selected: true })).toBeInTheDocument();
  expect(localStorage.getItem("cca-workspace-tab")).toBe("usage");
  // 没有会话可统计时给引导，而不是空白仪表盘。
  expect(await screen.findByText("还没有可统计的会话")).toBeInTheDocument();
});

test("falls back to the analyzer when the stored tab is unknown", () => {
  window.localStorage.setItem("cca-workspace-tab", "bogus");
  render(<AppShell bridges={bridges} />);

  expect(screen.getByRole("tab", { name: "会话分析", selected: true })).toBeInTheDocument();
});

test("shows the float exit button only after the dashboard enters float mode", async () => {
  const user = userEvent.setup();
  const exitFloatMode = vi.fn(async () => undefined);
  render(
    <AppShell
      bridges={
        {
          ...bridges,
          custom: { enterFloatMode: vi.fn(async () => undefined), exitFloatMode }
        } as unknown as Bridges
      }
    />
  );

  expect(screen.queryByRole("button", { name: "退出浮窗" })).not.toBeInTheDocument();

  await openMonitor(user);
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "enter-float" },
        origin: "http://localhost:8090"
      })
    );
  });

  const exit = await screen.findByRole("button", { name: "退出浮窗" });
  await user.click(exit);

  expect(exitFloatMode).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "退出浮窗" })).not.toBeInTheDocument()
  );
});

test("hides the float exit button when the bridge cannot leave float mode", async () => {
  const user = userEvent.setup();
  render(
    <AppShell
      bridges={
        {
          ...bridges,
          custom: { enterFloatMode: vi.fn(async () => undefined) }
        } as unknown as Bridges
      }
    />
  );

  await openMonitor(user);
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "enter-float" },
        origin: "http://localhost:8090"
      })
    );
  });

  expect(screen.queryByRole("button", { name: "退出浮窗" })).not.toBeInTheDocument();
});

test("opens and closes the threshold settings panel", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  await user.click(screen.getByRole("button", { name: "设置" }));
  expect(screen.getByRole("heading", { name: "阈值设置" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(screen.queryByRole("heading", { name: "阈值设置" })).not.toBeInTheDocument();
});

/**
 * 错误事件行的握手（N1）：用量总览 → 错误档 → 点一条主链事件 → 切回会话
 * 分析、打开该会话并定位记录（详情面板出现）——「只能看不能跳」在这里红。
 */
test("错误档事件行跳回会话分析并定位记录", async () => {
  const user = userEvent.setup();

  // 夹具整体平移到「最新事件在 2 小时前」：窗口相对 Date.now()，不平移会掉出窗外。
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixtureText = readFileSync(
    path.join(here, "../features/usage/../../../tests/fixtures/error-session.jsonl"),
    "utf8"
  );
  const timestamps = [...fixtureText.matchAll(/"timestamp":"([^"]+)"/g)].map((match) =>
    Date.parse(match[1] as string)
  );
  const delta = Date.now() - 2 * 3_600_000 - Math.max(...timestamps);
  const shifted = fixtureText.replace(
    /"timestamp":"([^"]+)"/g,
    (_match, iso: string) => `"timestamp":${JSON.stringify(new Date(Date.parse(iso) + delta).toISOString())}`
  );

  const PROJECTS_ROOT = "/home/tester/.claude/projects";
  const fixturePath = `${PROJECTS_ROOT}/-repo-error-demo/error-session.jsonl`;
  const errorBridges = {
    ...bridges,
    fs: {
      ...bridges.fs,
      readDir: vi.fn(async (target: string) =>
        target === PROJECTS_ROOT
          ? [{ name: "-repo-error-demo", is_dir: true, is_file: false }]
          : [{ name: "error-session.jsonl", is_dir: false, is_file: true }]
      ),
      readText: vi.fn(async (target: string) => {
        if (target === fixturePath) return shifted;
        throw new Error(`文件不存在 ${target}`);
      }),
      readHead: vi.fn(async (target: string) => (target === fixturePath ? shifted : "")),
      stat: vi.fn(async () => ({
        is_file: true,
        size: shifted.length,
        mtime_ms: 1_700_000_000_000
      }))
    }
  } as unknown as Bridges;

  render(<AppShell bridges={errorBridges} />);

  await user.click(screen.getByRole("tab", { name: "用量总览" }));
  await screen.findByText(/纳入统计/, {}, { timeout: 15_000 });
  await user.click(screen.getByRole("tab", { name: "错误" }));

  const errorView = await screen.findByRole("region", { name: "跨会话错误分析" });
  expect(within(errorView).getByText(/全部 7 条 · 时间倒序/)).toBeInTheDocument();

  // 点主链的 Edit 失败事件 → 跳会话分析、开图、定位到记录（详情面板出现）。
  await user.click(screen.getByRole("button", { name: /String to replace not found/ }));
  expect(screen.getByRole("tab", { name: /^会话分析$/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(await screen.findByRole("status", { name: "会话图状态" })).toHaveTextContent(
    "会话图已加载"
  );
  await waitFor(() =>
    expect(screen.getByRole("complementary", { name: "记录详情" })).toBeInTheDocument()
  );
});
