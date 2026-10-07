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
    // 「点进去不要马上打开」的机器化表达：挂载本身不产生任何**探测**。
    // monitorPort 会被读（它是用来把「连的是哪个地址」写在按钮上方的常量），
    // 探测是 pingMonitor——它必须一次都没跑。
    expect(pingMonitor).not.toHaveBeenCalled();
  });

  test("names the address it will connect to before the user opens it", async () => {
    renderMonitor(createBridges({ port: 8090 }));

    // 端口号是「下一步做什么」里唯一可执行的那半句，必须在点之前就看得见。
    await waitFor(() =>
      expect(screen.getByText(/本机 localhost:8090/)).toBeInTheDocument()
    );
    // 写给维护者的话不许再进 UI（红线）：仓库、夹具、内部服务名都不出现。
    const box = screen.getByText("实时监控未打开").closest("div")!;
    expect(box.textContent).not.toContain("不在本仓库内");
    expect(box.textContent).not.toContain("夹具");
  });

  test("embeds the dashboard once the user opens it", async () => {
    const pingMonitor = vi.fn(async () => true);

    renderMonitor(createBridges({ pingMonitor }));
    openMonitor();

    const frame = await screen.findByTitle(FRAME_TITLE);
    expect(frame).toHaveAttribute("src", "http://localhost:8090/?theme=light");
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
    const pingMonitor = vi.fn(async () => true);

    renderMonitor(createBridges({ pingMonitor }));
    openMonitor();
    await screen.findByTitle(FRAME_TITLE);

    await user.click(screen.getByRole("button", { name: "关闭监控" }));

    expect(screen.queryByTitle(FRAME_TITLE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开监控" })).toBeInTheDocument();
    // 关闭只是回到未打开，不是悄悄再探测一轮。
    expect(pingMonitor).toHaveBeenCalledTimes(1);
  });

  test("states the facts without naming a third-party service", async () => {
    vi.useFakeTimers();
    try {
      const monitorPort = vi.fn(async () => 8090);
      const pingMonitor = vi.fn(async () => false);
      renderMonitor(createBridges({ monitorPort, pingMonitor }));
      openMonitor();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });

      // 失败态整块文案：只说探测了哪个地址、失败了几次、下一步做什么，
      // 不出现外部仪表盘的产品名，不猜「被谁占用」，也不说「不在本仓库内」。
      const box = screen.getByRole("alert");
      expect(box).toHaveTextContent("未在 localhost:8090 上检测到监控仪表盘（已尝试 3 次）");
      expect(box).toHaveTextContent("确认该服务已在你自己的终端里启动，然后重试。");
      expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
      expect(box.textContent).not.toContain("cc-monitor");
      expect(box.textContent).not.toContain("不在本仓库内");
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps the raw failure string out of the visible copy", async () => {
    vi.useFakeTimers();
    try {
      // 真实失败串可能带绝对路径（用户路径是敏感数据），
      // 所以它只能待在折叠的「详情」里——默认连 DOM 都不进。
      renderMonitor(
        createBridges({
          monitorPort: async () => {
            throw new Error("connect /Users/tester/.config/monitor.sock 失败");
          }
        })
      );
      openMonitor();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);
      });

      const box = screen.getByRole("alert");
      expect(box.textContent).not.toContain("/Users/");
      expect(box.innerHTML).not.toContain("/Users/");

      // 反向：展开「详情」后确实能看到原文——否则上面两条会因为
      // 「什么都没渲染」而永远为真。
      fireEvent.click(screen.getByText("详情"));
      expect(box.textContent).toContain("/Users/tester/.config/monitor.sock");
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
