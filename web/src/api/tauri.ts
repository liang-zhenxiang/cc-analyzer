import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Bridges, DirEntry, ExecTextResult, RunLinesResult, StatInfo } from "./types";

function randomId() {
  return crypto.randomUUID();
}

export function installTauriBridges(): Bridges {
  return {
    fs: {
      readDir: (path) => invoke<DirEntry[]>("read_dir", { path }),
      readText: (path) => invoke<string>("read_text", { path }),
      readHead: (path, maxBytes) => invoke<string>("read_head", { path, maxBytes }),
      writeText: async (path, contents) => {
        await invoke<void>("write_text", { path, contents });
      },
      stat: (path) => invoke<StatInfo>("stat", { path }),
      homeDir: () => invoke<string>("home_dir"),
      appDataDir: () => invoke<string>("app_data_dir")
    },
    proc: {
      runLines: async (cmd, args, stdinText, timeoutMs, label, onLine, onStreamId) => {
        const streamId = randomId();
        onStreamId?.(streamId);
        const unlisten = await listen<string>(`proc:line:${streamId}`, (event) => onLine(event.payload));
        try {
          const result = await invoke<RunLinesResult>("run_lines", {
            streamId,
            cmd,
            args,
            stdinText: stdinText ?? null,
            timeoutMs: timeoutMs ?? null,
            label: label ?? null
          });
          return { ...result, error: result.error ?? undefined };
        } finally {
          unlisten();
        }
      },
      cancelLines: (streamId) => invoke<boolean>("cancel_lines", { streamId }),
      execText: async (cmd, args) => {
        const result = await invoke<ExecTextResult>("exec_text", { cmd, args });
        return { ...result, error: result.error ?? undefined };
      },
      spawnDetached: (exe, args, cwd) =>
        invoke<void>("spawn_detached", { exe, args, cwd: cwd ?? null })
    },
    system: {
      openFolder: async (path) => {
        const platform = navigator.platform.toLowerCase();
        if (platform.includes("win")) {
          await invoke<void>("spawn_detached", { exe: "explorer", args: [path], cwd: null });
        } else if (platform.includes("linux")) {
          await invoke<void>("spawn_detached", { exe: "xdg-open", args: [path], cwd: null });
        } else {
          await invoke<void>("spawn_detached", { exe: "open", args: [path], cwd: null });
        }
      },
      openClaudeTerminal: async (sessionId) => {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId)) {
          throw new Error("sessionId 非法，拒绝打开终端");
        }
        const platform = navigator.platform.toLowerCase();
        if (platform.includes("win")) {
          await invoke<void>("spawn_detached", {
            exe: "cmd.exe",
            args: ["/c", "start", "cmd", "/k", "claude", "--resume", sessionId],
            cwd: null
          });
        } else if (platform.includes("linux")) {
          await invoke<void>("spawn_detached", {
            exe: "x-terminal-emulator",
            args: ["-e", `claude --resume ${sessionId}`],
            cwd: null
          });
        } else {
          await invoke<void>("spawn_detached", {
            exe: "osascript",
            args: ["-e", `tell application "Terminal" to do script "claude --resume ${sessionId}"`],
            cwd: null
          });
        }
      }
    },
    clipboard: {
      writeText: (text) => navigator.clipboard.writeText(text)
    },
    dialog: {
      saveMarkdown: async (defaultName, contents) => {
        const path = await invoke<string | null>("plugin:dialog|save", {
          options: {
            title: "导出会话分析报告",
            defaultPath: defaultName,
            filters: [{ name: "Markdown", extensions: ["md"] }]
          }
        });
        if (path) await invoke<void>("write_text", { path, contents });
        return path;
      }
    },
    events: {
      onSessionImport: (handler) =>
        listen<string>("session:import", (event) => handler(event.payload))
    },
    monitor: {
      monitorPort: () => invoke<number>("monitor_port"),
      pingMonitor: () => invoke<boolean>("monitor_ping")
    },
    custom: {
      enterFloatMode: async () => {
        await invoke<void>("plugin:float|enter");
      },
      exitFloatMode: async () => {
        await invoke<void>("plugin:float|exit");
      }
    }
  };
}
