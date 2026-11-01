import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { resetKioskForTest } from "./KioskMode";
import { resetFontScaleForTest } from "../features/settings/fontScale";
import type { Bridges } from "../api/types";

beforeEach(() => {
  window.localStorage.clear();
  resetKioskForTest(false);
  resetFontScaleForTest(1);
  delete document.documentElement.dataset.kiosk;
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
 * 切到监控标签、进入「外部仪表盘」子视图并打开面板。Issue #203 起默认档是
 * 原生「脉搏」，而且面板不再在挂载时自动探测，所以「仪表盘已经内嵌」这件事
 * 之前必须先把子视图切过去、再点一次「打开监控」。
 */
async function openMonitor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  await user.click(screen.getByRole("tab", { name: "外部仪表盘" }));
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

test("⌘K 唤起命令面板，Esc 关闭；顶栏按钮仍可直接打开全局搜索", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  // 快捷键打开：对话框出现且焦点在输入框。
  // jsdom 里 userEvent 的修饰键链路到不了 window 级监听，直接派发。
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const dialog = screen.getByRole("dialog", { name: "命令面板" });
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText("搜索命令")).toHaveFocus();

  // Esc 关闭
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "命令面板" })).not.toBeInTheDocument();

  // 全局搜索自己的入口没有被拿走：顶栏按钮照旧直接开面板。
  await user.click(screen.getByRole("button", { name: "全局搜索" }));
  expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeInTheDocument();
});

test("命令面板过滤后用 Enter 执行：直接切到用量总览", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const input = screen.getByLabelText("搜索命令");
  await user.type(input, "用量");
  // 结果必须收在面板自己的作用域里：页面背后的会话列表（H3 排序控件）
  // 也是 listbox，全页 `getAllByRole("option")` 会先撞上它。
  const palette = screen.getByRole("dialog", { name: "命令面板" });
  // 「用量总览」是前缀命中，排在「导出用量快照」之前。
  expect(within(palette).getAllByRole("option")[0]).toHaveTextContent("用量总览");
  await user.keyboard("{Enter}");
  // 执行完就关：面板不该盖住它刚切过去的页面。
  expect(screen.queryByRole("dialog", { name: "命令面板" })).not.toBeInTheDocument();
  expect(localStorage.getItem("cca-workspace-tab")).toBe("usage");
  expect(await screen.findByText("还没有可统计的会话")).toBeInTheDocument();
});

test("设置里开大屏模式：根容器带上 data-kiosk，Esc 退出", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  await user.click(screen.getByRole("button", { name: "设置" }));
  await user.click(screen.getByRole("checkbox", { name: "启用大屏模式" }));

  const root = document.querySelector('[data-probe="kiosk-root"]');
  expect(root).toHaveAttribute("data-kiosk", "on");
  expect(document.documentElement.dataset.kiosk).toBe("on");
  expect(localStorage.getItem("cca-kiosk")).toBe("on");

  // 设置浮层随大屏一起收起：顶栏（连同唯一的「设置」按钮）已经藏了。
  expect(screen.queryByLabelText("阈值设置")).not.toBeInTheDocument();

  // 现在一次 Esc 就能退出，并把字号还回去。
  fireEvent.keyDown(window, { key: "Escape" });
  expect(root).not.toHaveAttribute("data-kiosk");
  expect(document.documentElement.dataset.kiosk).toBeUndefined();
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

test("监控默认停在脉搏档，并持久化子视图选择", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  // 挂载即渲染原生脉搏（不探测外部服务）。
  expect(document.querySelector('[data-probe="pulse-page"]')).not.toBeNull();
  expect(localStorage.getItem("cca-monitor-view")).toBe("pulse");

  await user.click(screen.getByRole("tab", { name: "监控台" }));
  expect(localStorage.getItem("cca-monitor-view")).toBe("console");

  await user.click(screen.getByRole("tab", { name: "外部仪表盘" }));
  expect(localStorage.getItem("cca-monitor-view")).toBe("dashboard");
});

test("未知的监控子视图存值回落到脉搏", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("cca-monitor-view", "bogus");
  render(<AppShell bridges={bridges} />);

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  expect(screen.getByRole("tab", { name: "脉搏", selected: true })).toBeInTheDocument();
});

test("已保存的监控台子视图会被恢复", async () => {
  const user = userEvent.setup();
  window.localStorage.setItem("cca-monitor-view", "console");
  render(<AppShell bridges={bridges} />);

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  expect(screen.getByRole("tab", { name: "监控台", selected: true })).toBeInTheDocument();
});

test("浮窗态（脉搏档）收起顶栏、换成可拖动的细头，退出后恢复", async () => {
  const user = userEvent.setup();
  const exitFloatMode = vi.fn(async () => undefined);
  const enterFloatMode = vi.fn(async () => undefined);
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  render(
    <AppShell
      bridges={
        {
          ...bridges,
          custom: { enterFloatMode, exitFloatMode }
        } as unknown as Bridges
      }
    />
  );

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  // 默认就是脉搏档：页头的「悬浮」按钮直接可点。
  await user.click(screen.getByRole("button", { name: "悬浮" }));

  // 进浮窗 = 窗口命令 + 版式切换，缺一不可（2026-10-15 真机门禁抓到过
  // 「只切版式、窗口没变」的那一版）。
  await waitFor(() =>
    expect(enterFloatMode).toHaveBeenCalledWith({
      ...viewport
    })
  );

  // 整条顶栏被细头替换：工作区分段标签消失。
  expect(screen.queryByRole("tab", { name: "实时监控" })).not.toBeInTheDocument();
  const head = document.querySelector('[data-probe="pulse-float-head"]')!;
  expect(head).not.toBeNull();
  expect(head.getAttribute("data-tauri-drag-region")).toBe("deep");
  expect(head.textContent).toContain("实时脉搏");

  await user.click(screen.getByRole("button", { name: "退出浮窗" }));
  expect(exitFloatMode).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(document.querySelector('[data-probe="pulse-float-head"]')).toBeNull()
  );
  // 顶栏回来。
  expect(screen.getByRole("tab", { name: "实时监控" })).toBeInTheDocument();
});

test("进入浮窗失败时保持常规窗口版式", async () => {
  const user = userEvent.setup();
  const enterFloatMode = vi.fn(async () => {
    throw new Error("float enter failed");
  });
  render(
    <AppShell
      bridges={
        {
          ...bridges,
          custom: { enterFloatMode, exitFloatMode: vi.fn(async () => undefined) }
        } as unknown as Bridges
      }
    />
  );

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  await user.click(screen.getByRole("button", { name: "悬浮" }));

  await waitFor(() => expect(enterFloatMode).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("tab", { name: "实时监控" })).toBeInTheDocument();
  expect(document.querySelector('[data-probe="pulse-float-head"]')).toBeNull();
});

test("退出浮窗失败时保持浮窗版式，便于重试", async () => {
  const user = userEvent.setup();
  const exitFloatMode = vi.fn(async () => {
    throw new Error("float exit failed");
  });
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

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  await user.click(screen.getByRole("button", { name: "悬浮" }));
  await screen.findByRole("button", { name: "退出浮窗" });
  await user.click(screen.getByRole("button", { name: "退出浮窗" }));

  await waitFor(() => expect(exitFloatMode).toHaveBeenCalledTimes(1));
  expect(document.querySelector('[data-probe="pulse-float-head"]')).not.toBeNull();
  expect(screen.queryByRole("tab", { name: "实时监控" })).not.toBeInTheDocument();
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
  // 限定在「错误事件」面板内：错误聚类（F7）那一栏的行同样含这段文案。
  const eventList = within(errorView).getByRole("region", { name: "错误事件" });
  await user.click(within(eventList).getByRole("button", { name: /String to replace not found/ }));
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

test("? 唤起键盘速查卡，Esc 关闭，且不抢输入框里的问号", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  fireEvent.keyDown(window, { key: "?" });
  const sheet = screen.getByRole("dialog", { name: "键盘速查卡" });
  expect(sheet.getAttribute("aria-modal")).toBe("true");
  // 打开即接住焦点：键盘用户不该还要自己找入口。
  expect(document.activeElement).toBe(sheet);

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "键盘速查卡" })).not.toBeInTheDocument();

  // 输入框里打字不触发：命令面板的搜索框里按 `?` 是在输入问号，不是开卡。
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const input = screen.getByLabelText("搜索命令");
  fireEvent.keyDown(input, { key: "?" });
  expect(screen.queryByRole("dialog", { name: "键盘速查卡" })).not.toBeInTheDocument();
});

test("命令面板里能搜到「快捷键速查」并执行它", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  fireEvent.keyDown(window, { key: "k", metaKey: true });
  await user.type(screen.getByLabelText("搜索命令"), "速查");
  const palette = screen.getByRole("dialog", { name: "命令面板" });
  const first = within(palette).getAllByRole("option")[0];
  expect(first).toHaveTextContent("快捷键速查");
  await user.keyboard("{Enter}");

  // 面板先关、卡再开：两层浮层不该同时立在那儿。
  expect(screen.queryByRole("dialog", { name: "命令面板" })).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "键盘速查卡" })).toBeInTheDocument();
});
