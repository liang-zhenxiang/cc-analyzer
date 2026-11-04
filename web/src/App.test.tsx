import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { DEMO_STORAGE_KEY } from "./demo/demoMode";

vi.mock("./api/tauri", () => ({
  installTauriBridges: vi.fn(() => ({
    events: { onSessionImport: vi.fn(async () => () => undefined) },
    fs: {
      homeDir: vi.fn(async () => "/home/tester"),
      appDataDir: vi.fn(async () => "/app-data"),
      readDir: vi.fn(async () => []),
      readText: vi.fn(async () => "{}"),
      readHead: vi.fn(async () => "{}"),
      writeText: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ is_file: true, size: 1, mtime_ms: 1 }))
    }
  }))
}));

beforeEach(() => {
  window.localStorage.clear();
});

test("renders the application title", () => {
  render(<App />);
  expect(screen.getByText("CC Analyzer")).toBeInTheDocument();
});

test("localStorage 为 on 时进入演示模式并常驻显示演示徽章", async () => {
  window.localStorage.setItem(DEMO_STORAGE_KEY, "on");
  render(<App />);

  expect(screen.getByText("演示数据 · 不会读取你的会话")).toBeInTheDocument();
  expect(document.querySelector('[data-probe="demo-badge"]')).not.toBeNull();
  // 演示桥的版本号带 `-demo`，顶栏徽章因此不会冒充某一版真实安装。
  expect(
    await screen.findByRole("button", { name: /当前版本 v0\.0\.0-demo/ })
  ).toBeInTheDocument();
  // 内存文件系统 → 扫描 → 会话列表这条链真的通了：不是只换了一份假 bridges。
  expect(
    (await screen.findAllByText(/缓存命中率/, {}, { timeout: 5000 })).length
  ).toBeGreaterThan(0);
});

test("演示徽章的退出按钮会关闭演示并移除持久化标记", async () => {
  window.localStorage.setItem(DEMO_STORAGE_KEY, "on");
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "退出演示" }));

  await waitFor(() => {
    expect(document.querySelector('[data-probe="demo-badge"]')).toBeNull();
  });
  expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
});
