import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { installTauriBridges } from "./tauri";
import { BridgesProvider, useBridges } from "./bridges";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string) => command) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => async () => undefined) }));

const originalPlatform = Object.getOwnPropertyDescriptor(window.navigator, "platform");

afterEach(() => {
  vi.mocked(invoke).mockClear();
  if (originalPlatform) {
    Object.defineProperty(window.navigator, "platform", originalPlatform);
  }
});

describe("Tauri bridges", () => {
  it("sends exact command names and keeps events behind the bridge", async () => {
    const bridges = installTauriBridges();
    await expect(bridges.fs.readDir("/tmp")).resolves.toBe("read_dir");
    await expect(bridges.fs.homeDir()).resolves.toBe("home_dir");
    await expect(bridges.monitor.monitorPort()).resolves.toBe("monitor_port");
    await expect(bridges.events.onSessionImport(() => undefined)).resolves.toBeTypeOf("function");
  });
});

describe("open Claude terminal", () => {
  const sessionId = "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11";

  function setPlatform(platform: string) {
    Object.defineProperty(window.navigator, "platform", {
      value: platform,
      configurable: true
    });
  }

  it("launches macOS Terminal through osascript do script", async () => {
    setPlatform("MacIntel");
    const bridges = installTauriBridges();

    await bridges.system.openClaudeTerminal(sessionId);

    expect(invoke).toHaveBeenCalledWith("spawn_detached", {
      exe: "osascript",
      args: ["-e", `tell application "Terminal" to do script "claude --resume ${sessionId}"`],
      cwd: null
    });
  });

  it("preserves Windows terminal behavior", async () => {
    setPlatform("Win32");
    const bridges = installTauriBridges();

    await bridges.system.openClaudeTerminal(sessionId);

    expect(invoke).toHaveBeenCalledWith("spawn_detached", {
      exe: "cmd.exe",
      args: ["/c", "start", "cmd", "/k", "claude", "--resume", sessionId],
      cwd: null
    });
  });

  it("preserves Linux terminal behavior", async () => {
    setPlatform("Linux x86_64");
    const bridges = installTauriBridges();

    await bridges.system.openClaudeTerminal(sessionId);

    expect(invoke).toHaveBeenCalledWith("spawn_detached", {
      exe: "x-terminal-emulator",
      args: ["-e", `claude --resume ${sessionId}`],
      cwd: null
    });
  });
});

describe("BridgesProvider", () => {
  it("exposes installed bridges to descendants", async () => {
    const bridges = installTauriBridges();

    function BridgeProbe() {
      const provided = useBridges();
      return createElement(
        "button",
        { type: "button", onClick: () => provided.monitor.monitorPort() },
        provided === bridges ? "same" : "different"
      );
    }

    render(
      createElement(
        BridgesProvider,
        { bridges, children: createElement(BridgeProbe) }
      )
    )

    expect(screen.getByRole("button")).toHaveTextContent("same");
  });
});
