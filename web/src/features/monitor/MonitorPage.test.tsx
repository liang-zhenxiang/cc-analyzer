import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ThemeProvider, useTheme } from "../../app/ThemeProvider";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { MonitorPage } from "./MonitorPage";

const RETRY_DELAY_MS = 800;
const FRAME_TITLE = "实时监控仪表盘";

function createBridges({
  port = 8090,
  ping = true,
  monitorPort = async () => port,
  pingMonitor = async () => ping,
  enterFloatMode = async () => undefined
}: {
  port?: number;
  ping?: boolean;
  monitorPort?: () => Promise<number>;
  pingMonitor?: () => Promise<boolean>;
  enterFloatMode?: () => Promise<void>;
} = {}): Bridges {
  return {
    monitor: { monitorPort, pingMonitor },
    custom: { enterFloatMode }
  } as unknown as Bridges;
}

function ThemeToggle() {
  const { toggleTheme } = useTheme();
  return (
    <button type="button" onClick={toggleTheme}>
      切换主题
    </button>
  );
}

function renderMonitor(bridges: Bridges, onEnterFloat?: () => void) {
  return render(
    <ThemeProvider>
      <ThemeToggle />
      <BridgesProvider bridges={bridges}>
        <MonitorPage onEnterFloat={onEnterFloat} />
      </BridgesProvider>
    </ThemeProvider>
  );
}

/**
 * 打开监控。这里的每一步都是刻意的：面板不再在挂载时探测，
 * 所以每个「探测之后」的断言前面都得先有这个点击。
 */
function openMonitor() {
  fireEvent.click(screen.getByRole("button", { name: "打开监控" }));
}

describe("MonitorPage", () => {
  test("does not probe or embed a frame until the user opens the monitor", () => {
    const monitorPort = vi.fn(async () => 8090);
    const pingMonitor = vi.fn(async () => true);

    renderMonitor(createBridges({ monitorPort, pingMonitor }));

    expect(screen.getByRole("button", { name: "打开监控" })).toBeInTheDocument();
    expect(screen.queryByTitle(FRAME_TITLE)).not.toBeInTheDocument();
    // 「点进去不要马上打开」的机器化表达：挂载本身不产生任何探测。
    expect(monitorPort).not.toHaveBeenCalled();
    expect(pingMonitor).not.toHaveBeenCalled();
  });

  test("embeds the dashboard once the user opens it", async () => {
    const monitorPort = vi.fn(async () => 8090);
    const pingMonitor = vi.fn(async () => true);

    renderMonitor(createBridges({ monitorPort, pingMonitor }));
    openMonitor();

    const frame = await screen.findByTitle(FRAME_TITLE);
    expect(frame).toHaveAttribute("src", "http://localhost:8090/?theme=light");
    expect(monitorPort).toHaveBeenCalledTimes(1);
    expect(pingMonitor).toHaveBeenCalledTimes(1);
  });

  test("shows the attempt count while probing", async () => {
    vi.useFakeTimers();
    try {
      renderMonitor(createBridges({ ping: false }));
      openMonitor();

      expect(screen.getByText(/第 1\/3 次尝试/)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      });
      expect(screen.getByText(/第 2\/3 次尝试/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("retries three times before reporting the dashboard as unreachable", async () => {
    vi.useFakeTimers();
    try {
      const monitorPort = vi.fn(async () => 8090);
      const pingMonitor = vi.fn(async () => false);
      renderMonitor(createBridges({ monitorPort, pingMonitor }));
      openMonitor();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });

      expect(screen.getByText("监控仪表盘未连接")).toBeInTheDocument();
      expect(screen.getByText(/已尝试 3 次/)).toBeInTheDocument();
      expect(pingMonitor).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  test("retries again when the user asks", async () => {
    vi.useFakeTimers();
    try {
      const monitorPort = vi.fn(async () => 8090);
      const pingMonitor = vi.fn(async () => false);
      renderMonitor(createBridges({ monitorPort, pingMonitor }));
      openMonitor();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });
      expect(pingMonitor).toHaveBeenCalledTimes(3);

      fireEvent.click(screen.getByRole("button", { name: "重试" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });
      expect(pingMonitor).toHaveBeenCalledTimes(6);
    } finally {
      vi.useRealTimers();
    }
  });

  test("says nothing about the port when the lookup fails", async () => {
    vi.useFakeTimers();
    try {
      renderMonitor(
        createBridges({
          monitorPort: async () => {
            throw new Error("down");
          }
        })
      );
      openMonitor();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });
      expect(screen.getByText(/未在本机 localhost 上检测到监控仪表盘/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("closes the dashboard and returns to the unopened state", async () => {
    const user = userEvent.setup();
    const monitorPort = vi.fn(async () => 8090);

    renderMonitor(createBridges({ monitorPort }));
    openMonitor();
    await screen.findByTitle(FRAME_TITLE);

    await user.click(screen.getByRole("button", { name: "关闭监控" }));

    expect(screen.queryByTitle(FRAME_TITLE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开监控" })).toBeInTheDocument();
    // 关闭只是回到未打开，不是悄悄再探测一轮。
    expect(monitorPort).toHaveBeenCalledTimes(1);
  });

  test("states the facts without naming a third-party service", async () => {
    vi.useFakeTimers();
    try {
      renderMonitor(createBridges({ ping: false }));
      openMonitor();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });

      // 失败态整块文案：只说探测了哪个地址、这个服务在哪，
      // 不出现外部仪表盘的产品名，也不猜「被谁占用」。
      const box = screen.getByText("监控仪表盘未连接").closest("div")!;
      expect(box).toHaveTextContent("未在 localhost:8090 上检测到监控仪表盘（已尝试 3 次）");
      expect(box).toHaveTextContent("该服务不在本仓库内，需要另行启动。");
      expect(box.textContent).not.toContain("cc-monitor");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MonitorPage theme and float bridging", () => {
  test("posts the theme on load and whenever it changes", async () => {
    const user = userEvent.setup();
    renderMonitor(createBridges({}));
    openMonitor();

    const frame = await screen.findByTitle(FRAME_TITLE);
    const postMessage = vi.fn();
    // jsdom swaps contentWindow when the iframe reloads, so stub the element itself.
    Object.defineProperty(frame, "contentWindow", {
      value: { postMessage },
      writable: true,
      configurable: true
    });

    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith({ type: "theme", theme: "light" }, "*");

    await user.click(screen.getByRole("button", { name: "切换主题" }));
    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith({ type: "theme", theme: "dark" }, "*")
    );
  });

  test("enters float mode when the dashboard asks for it", async () => {
    const enterFloatMode = vi.fn(async () => undefined);
    renderMonitor(createBridges({ enterFloatMode }));

    openMonitor();
    await screen.findByTitle(FRAME_TITLE);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "enter-float" },
          origin: "http://localhost:8090"
        })
      );
    });

    expect(enterFloatMode).toHaveBeenCalledTimes(1);
  });

  test("notifies the shell after entering float mode", async () => {
    const onEnterFloat = vi.fn();
    renderMonitor(createBridges({}), onEnterFloat);

    openMonitor();
    await screen.findByTitle(FRAME_TITLE);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "enter-float" },
          origin: "http://localhost:8090"
        })
      );
    });

    expect(onEnterFloat).toHaveBeenCalledTimes(1);
  });

  test("ignores float requests from foreign origins", async () => {
    const enterFloatMode = vi.fn(async () => undefined);
    const onEnterFloat = vi.fn();
    renderMonitor(createBridges({ enterFloatMode }), onEnterFloat);

    openMonitor();
    await screen.findByTitle(FRAME_TITLE);
    for (const origin of ["http://evil.example:8090", "https://localhost:8090", ""]) {
      act(() => {
        window.dispatchEvent(
          new MessageEvent("message", { data: { type: "enter-float" }, origin })
        );
      });
    }

    expect(enterFloatMode).not.toHaveBeenCalled();
    expect(onEnterFloat).not.toHaveBeenCalled();
  });

  test("ignores float requests from another local port", async () => {
    const enterFloatMode = vi.fn(async () => undefined);
    renderMonitor(createBridges({ enterFloatMode }));

    openMonitor();
    await screen.findByTitle(FRAME_TITLE);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "enter-float" },
          origin: "http://localhost:9999"
        })
      );
    });

    expect(enterFloatMode).not.toHaveBeenCalled();
  });

  test("ignores unrelated window messages", async () => {
    const enterFloatMode = vi.fn(async () => undefined);
    renderMonitor(createBridges({ enterFloatMode }));

    openMonitor();
    await screen.findByTitle(FRAME_TITLE);
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "other" },
          origin: "http://localhost:8090"
        })
      );
    });

    expect(enterFloatMode).not.toHaveBeenCalled();
  });
});
