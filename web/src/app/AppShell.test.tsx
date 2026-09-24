import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import type { Bridges } from "../api/types";

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

test("switches analyzer and monitor tabs", async () => {
  const user = userEvent.setup();
  render(<AppShell bridges={bridges} />);

  expect(screen.getByRole("tab", { name: "会话分析", selected: true })).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  expect(screen.getByRole("tab", { name: "实时监控", selected: true })).toBeInTheDocument();
  expect(localStorage.getItem("cca-workspace-tab")).toBe("monitor");
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

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  await screen.findByTitle("实时监控 dashboard");
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

  await user.click(screen.getByRole("tab", { name: "实时监控" }));
  await screen.findByTitle("实时监控 dashboard");
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
