import { describe, expect, test, vi } from "vitest";
import type { Bridges, ExecTextResult, StatInfo } from "../../api/types";
import { candidateClaudePaths, probeClaudeCli } from "./cliProbe";

function createBridges({
  execText,
  home = "/Users/tester",
  existing = []
}: {
  execText: () => Promise<ExecTextResult>;
  home?: string;
  existing?: string[];
}): Bridges {
  return {
    proc: { execText },
    fs: {
      homeDir: vi.fn(async () => home),
      stat: vi.fn(async (path: string): Promise<StatInfo> => {
        if (!existing.includes(path)) throw new Error("文件或目录不存在");
        return { is_file: true, size: 1, mtime_ms: 1 };
      })
    }
  } as unknown as Bridges;
}

describe("candidateClaudePaths", () => {
  test("lists per-user and system bin directories on unix", () => {
    expect(candidateClaudePaths("/Users/tester/")).toEqual([
      "/Users/tester/.claude/local/claude",
      "/Users/tester/.local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/Users/tester/.bun/bin/claude",
      "/Users/tester/.npm-global/bin/claude"
    ]);
  });

  test("lists npm and local bins on windows", () => {
    expect(candidateClaudePaths("C:\\Users\\tester")).toEqual([
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd",
      "C:\\Users\\tester\\.claude\\local\\claude.exe",
      "C:\\Users\\tester\\.local\\bin\\claude.exe"
    ]);
  });
});

describe("probeClaudeCli", () => {
  test("is ready when the help output advertises stream-json", async () => {
    const bridges = createBridges({
      execText: async () => ({ ok: true, out: "--output-format stream-json" })
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true
    });
  });

  test("is ready without stream-json when the CLI ran but the flag is missing", async () => {
    const bridges = createBridges({
      execText: async () => ({ ok: false, out: "usage: claude", error: "未知参数" })
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: false
    });
  });

  test("reports the install path when a spawn failure hides an installed CLI", async () => {
    const bridges = createBridges({
      execText: async () => ({
        ok: false,
        out: "",
        error: "启动命令失败: No such file or directory (os error 2)"
      }),
      existing: ["/Users/tester/.claude/local/claude"]
    });

    const probe = await probeClaudeCli(bridges);
    expect(probe.status).toBe("missing");
    if (probe.status !== "missing") return;
    expect(probe.message).toContain("/Users/tester/.claude/local/claude");
    expect(probe.message).toContain("PATH");
    expect(probe.message).toContain("cargo run");
  });

  test("asks the user to install the CLI when nothing is found on disk", async () => {
    const bridges = createBridges({
      execText: async () => ({ ok: false, out: "", error: "启动命令失败: 文件或目录不存在" })
    });

    const probe = await probeClaudeCli(bridges);
    expect(probe.status).toBe("missing");
    if (probe.status !== "missing") return;
    expect(probe.message).toContain("@anthropic-ai/claude-code");
    expect(probe.message).not.toContain("已在磁盘上发现");
  });

  test("treats a rejected execText call as a missing CLI", async () => {
    const bridges = createBridges({
      execText: async () => {
        throw new Error("通道断开");
      }
    });

    const probe = await probeClaudeCli(bridges);
    expect(probe.status).toBe("missing");
    if (probe.status !== "missing") return;
    expect(probe.message).toContain("通道断开");
  });
});
