import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  monitor: { monitorPort: vi.fn(async () => 8090), pingMonitor: vi.fn(async () => true) }
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
