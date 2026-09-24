import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ThemeProvider, useTheme } from "../../app/ThemeProvider";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { MonitorPage } from "./MonitorPage";

const RETRY_DELAY_MS = 800;

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

describe("MonitorPage", () => {
  test("renders the dashboard when the monitor responds", async () => {
    renderMonitor(createBridges({}));

    const frame = await screen.findByTitle("实时监控 dashboard");
    expect(frame).toHaveAttribute("src", "http://localhost:8090/?theme=light");
  });

  test("shows the attempt count while probing", async () => {
    vi.useFakeTimers();
    try {
      renderMonitor(createBridges({ ping: false }));

      expect(screen.getByText(/第 1\/3 次尝试/)).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
      });
      expect(screen.getByText(/第 2\/3 次尝试/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  test("retries three times before reporting the monitor as unavailable", async () => {
    vi.useFakeTimers();
    try {
      const monitorPort = vi.fn(async () => 8090);
      const pingMonitor = vi.fn(async () => false);
      renderMonitor(createBridges({ monitorPort, pingMonitor }));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });

      expect(screen.getByText("监控代理未启动")).toBeInTheDocument();
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

  test("shows an unknown port when the monitor port lookup fails", async () => {
    vi.useFakeTimers();
    try {
      renderMonitor(
        createBridges({
          monitorPort: async () => {
            throw new Error("down");
          }
        })
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });
      expect(screen.getByText(/端口 \? 无响应/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MonitorPage theme and float bridging", () => {
  test("posts the theme on load and whenever it changes", async () => {
    const user = userEvent.setup();
    renderMonitor(createBridges({}));

    const frame = await screen.findByTitle("实时监控 dashboard");
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

    await screen.findByTitle("实时监控 dashboard");
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

    await screen.findByTitle("实时监控 dashboard");
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

    await screen.findByTitle("实时监控 dashboard");
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

    await screen.findByTitle("实时监控 dashboard");
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

    await screen.findByTitle("实时监控 dashboard");
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
