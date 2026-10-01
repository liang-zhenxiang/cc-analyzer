import { describe, expect, test, vi } from "vitest";
import type { Bridges, DirEntry, ExecTextResult, StatInfo } from "../../api/types";
import { candidateClaudePaths, probeClaudeCli } from "./cliProbe";

const SPAWN_FAILED: ExecTextResult = {
  ok: false,
  out: "",
  error: "启动命令失败: No such file or directory (os error 2)"
};

const HELP_WITH_STREAM: ExecTextResult = {
  ok: true,
  out: "--include-partial-messages --output-format stream-json"
};

/** How `read_dir` reports an entry: it does not follow symlinks. */
function dirEntry(name: string, kind: "dir" | "symlink" = "dir"): DirEntry {
  return { name, is_dir: kind === "dir", is_file: false };
}

function createBridges({
  execText,
  home = "/Users/tester",
  existing = [],
  dirs = {}
}: {
  execText: (cmd: string, args: string[]) => Promise<ExecTextResult>;
  home?: string;
  existing?: string[];
  dirs?: Record<string, DirEntry[]>;
}): Bridges {
  return {
    proc: { execText: vi.fn(execText) },
    fs: {
      homeDir: vi.fn(async () => home),
      stat: vi.fn(async (path: string): Promise<StatInfo> => {
        if (!existing.includes(path)) throw new Error("文件或目录不存在");
        return { is_file: true, size: 1, mtime_ms: 1 };
      }),
      readDir: vi.fn(async (path: string): Promise<DirEntry[]> => {
        const entries = dirs[path];
        if (!entries) throw new Error("读取目录失败: 文件或目录不存在");
        return entries;
      })
    }
  } as unknown as Bridges;
}

/**
 * Reproduces the launch that broke: the bare name is not on PATH, but the
 * listed absolute paths are installed and runnable.
 */
function resolveOnlyFromDisk(installed: string[]) {
  return async (cmd: string): Promise<ExecTextResult> => {
    if (cmd !== "claude" && installed.includes(cmd)) return HELP_WITH_STREAM;
    return SPAWN_FAILED;
  };
}

describe("candidateClaudePaths", () => {
  test("lists the fixed install locations on unix", () => {
    expect(candidateClaudePaths("/Users/tester/")).toEqual([
      "/Users/tester/.claude/local/claude",
      "/Users/tester/.local/bin/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
      "/Users/tester/.bun/bin/claude",
      "/Users/tester/.npm-global/bin/claude",
      "/Users/tester/.volta/bin/claude",
      "/Users/tester/.asdf/shims/claude",
      "/Users/tester/.local/share/mise/shims/claude",
      "/Users/tester/.nodenv/shims/claude",
      "/Users/tester/Library/pnpm/claude",
      "/Users/tester/.local/share/pnpm/claude",
      "/Users/tester/.yarn/bin/claude",
      "/Users/tester/.config/yarn/global/node_modules/.bin/claude"
    ]);
  });

  test("lists the fixed install locations on windows", () => {
    expect(candidateClaudePaths("C:\\Users\\tester")).toEqual([
      "C:\\Users\\tester\\AppData\\Roaming\\npm\\claude.cmd",
      "C:\\Users\\tester\\.claude\\local\\claude.exe",
      "C:\\Users\\tester\\.local\\bin\\claude.exe",
      "C:\\Users\\tester\\.bun\\bin\\claude.exe",
      "C:\\Users\\tester\\scoop\\shims\\claude.cmd",
      "C:\\Users\\tester\\AppData\\Local\\Volta\\bin\\claude.cmd",
      "C:\\Users\\tester\\AppData\\Local\\pnpm\\claude.cmd",
      "C:\\Users\\tester\\AppData\\Local\\Yarn\\bin\\claude.cmd"
    ]);
  });

  test.each([
    ["volta", "/Users/tester/.volta/bin/claude"],
    ["asdf", "/Users/tester/.asdf/shims/claude"],
    ["mise", "/Users/tester/.local/share/mise/shims/claude"],
    ["nodenv", "/Users/tester/.nodenv/shims/claude"],
    ["pnpm on macOS", "/Users/tester/Library/pnpm/claude"],
    ["pnpm on Linux", "/Users/tester/.local/share/pnpm/claude"],
    ["yarn", "/Users/tester/.yarn/bin/claude"]
  ])("covers the %s shim", (_manager, shim) => {
    expect(candidateClaudePaths("/Users/tester")).toContain(shim);
  });
});

describe("probeClaudeCli", () => {
  test("runs the bare name when PATH resolves it", async () => {
    const bridges = createBridges({ execText: async () => HELP_WITH_STREAM });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: "claude"
    });
  });

  test("is ready without stream-json when the CLI ran but the flag is missing", async () => {
    const bridges = createBridges({
      execText: async () => ({ ok: false, out: "usage: claude", error: "未知参数" })
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: false,
      command: "claude"
    });
  });

  test("resolves an absolute command when PATH fails but the CLI is installed", async () => {
    const bridges = createBridges({
      // The install answers `--help` even though the bare name would not spawn.
      execText: resolveOnlyFromDisk(["/Users/tester/.claude/local/claude"]),
      existing: ["/Users/tester/.claude/local/claude"]
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: "/Users/tester/.claude/local/claude"
    });
  });

  test("skips the versions of a manager that do not carry the CLI", async () => {
    const nvm = "/Users/tester/.nvm/versions/node/v24.13.0/bin/claude";
    const bridges = createBridges({
      execText: resolveOnlyFromDisk([nvm]),
      dirs: {
        "/Users/tester/.nvm/versions/node": [
          dirEntry("v18.20.8"),
          dirEntry("v20.19.5"),
          dirEntry("v24.13.0")
        ]
      },
      existing: [nvm]
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: nvm
    });
  });

  test("reports an install that exists but refuses to run", async () => {
    const broken = "/Users/tester/.local/bin/claude";
    const bridges = createBridges({
      execText: async () => SPAWN_FAILED,
      existing: [broken]
    });

    const probe = await probeClaudeCli(bridges);

    expect(probe.status).toBe("missing");
    if (probe.status !== "missing") return;
    expect(probe.message).toContain(broken);
    expect(probe.message).toContain("无法执行");
    expect(probe.message).not.toContain("未找到");
  });

  test("asks the user to install the CLI when nothing is found on disk", async () => {
    const bridges = createBridges({ execText: async () => SPAWN_FAILED });

    const probe = await probeClaudeCli(bridges);

    expect(probe.status).toBe("missing");
    if (probe.status !== "missing") return;
    expect(probe.message).toContain("未找到 claude CLI");
    expect(probe.message).toContain("@anthropic-ai/claude-code");
    expect(probe.message).not.toContain("已在磁盘上发现");
  });

  test("does not fall back to disk when the bridge itself is broken", async () => {
    const bridges = createBridges({
      execText: async () => {
        throw new Error("通道断开");
      },
      existing: ["/Users/tester/.local/bin/claude"]
    });

    const probe = await probeClaudeCli(bridges);

    expect(probe.status).toBe("missing");
    if (probe.status !== "missing") return;
    expect(probe.message).toContain("通道断开");
    expect(bridges.fs.readDir).not.toHaveBeenCalled();
  });
});

describe("version-manager install directories", () => {
  test.each([
    ["nvm", "/Users/tester", "/Users/tester/.nvm/versions/node", "v20.19.5", "bin/claude"],
    ["asdf", "/Users/tester", "/Users/tester/.asdf/installs/nodejs", "20.19.5", "bin/claude"],
    ["mise", "/Users/tester", "/Users/tester/.local/share/mise/installs/node", "20.19.5", "bin/claude"],
    ["nodenv", "/Users/tester", "/Users/tester/.nodenv/versions", "20.19.5", "bin/claude"],
    ["fnm (aliases)", "/Users/tester", "/Users/tester/.local/share/fnm/aliases", "default", "bin/claude"],
    [
      "fnm (versions)",
      "/Users/tester",
      "/Users/tester/.local/share/fnm/node-versions",
      "v20.19.5",
      "installation/bin/claude"
    ],
    [
      "fnm (homebrew)",
      "/Users/tester",
      "/Users/tester/Library/Application Support/fnm/aliases",
      "default",
      "bin/claude"
    ]
  ])("finds a %s install under its per-version directory", async (_name, home, root, version, rest) => {
    const expected = `${root}/${version}/${rest}`;
    const bridges = createBridges({
      execText: resolveOnlyFromDisk([expected]),
      home,
      dirs: { [root]: [dirEntry(version)] },
      existing: [expected]
    });

    const probe = await probeClaudeCli(bridges);

    expect(probe).toEqual({ status: "ready", hasStreamJson: true, command: expected });
  });

  test("keeps symlinked version directories, which read_dir cannot classify", async () => {
    const root = "/Users/tester/.local/share/fnm/aliases";
    const expected = `${root}/default/bin/claude`;
    const bridges = createBridges({
      execText: resolveOnlyFromDisk([expected]),
      dirs: { [root]: [dirEntry("default", "symlink")] },
      existing: [expected]
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: expected
    });
  });

  test.each([
    [
      "nvm-windows",
      "C:\\Users\\tester",
      "C:\\Users\\tester\\AppData\\Roaming\\nvm",
      "v20.19.5",
      "claude.cmd"
    ],
    [
      "fnm-windows",
      "C:\\Users\\tester",
      "C:\\Users\\tester\\AppData\\Roaming\\fnm\\aliases",
      "default",
      "claude.cmd"
    ]
  ])("finds a %s install under its per-version directory", async (_name, home, root, version, rest) => {
    const expected = `${root}\\${version}\\${rest}`;
    const bridges = createBridges({
      execText: resolveOnlyFromDisk([expected]),
      home,
      dirs: { [root]: [dirEntry(version)] },
      existing: [expected]
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: expected
    });
  });
});

const NVM_ROOT = "/Users/tester/.nvm/versions/node";
const FNM_ALIASES = "/Users/tester/.local/share/fnm/aliases";

function nvmClaude(version: string): string {
  return `${NVM_ROOT}/${version}/bin/claude`;
}

/**
 * 真机取证：`~/.nvm/…/v20.19.5/bin/claude` 是 Node 脚本，shebang 为
 * `#!/usr/bin/env node`。在 Finder/Dock 的窄 PATH 下进程**确实启动了**，
 * 但退出码 127、stderr 只有这一行——错误里没有「启动命令失败」标记。
 */
const NODE_NOT_FOUND: ExecTextResult = {
  ok: false,
  out: "",
  error: "env: node: No such file or directory"
};

describe("probeClaudeCli：绝对路径候选必须真的跑通", () => {
  test("skips a candidate whose --help exits non-zero and resolves the next one", async () => {
    const broken = "/Users/tester/.local/bin/claude";
    const working = nvmClaude("v24.13.0");
    const execText = vi.fn(async (cmd: string): Promise<ExecTextResult> => {
      if (cmd === broken) return NODE_NOT_FOUND;
      if (cmd === working) return HELP_WITH_STREAM;
      return SPAWN_FAILED;
    });
    const bridges = createBridges({
      execText,
      dirs: { [NVM_ROOT]: [dirEntry("v24.13.0")] },
      existing: [broken, working]
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: working
    });

    // 探测顺序：PATH 名 → 跑不起来的那个 → 能跑的那个。非 0 退出的候选只被
    // `--help` 探过，绝不会成为交给执行侧的命令。
    expect(execText.mock.calls.map(([cmd]) => cmd)).toEqual(["claude", broken, working]);
  });

  test("keeps going when a located candidate cannot be spawned at all", async () => {
    const ghost = "/opt/homebrew/bin/claude";
    const working = nvmClaude("v18.20.8");
    const execText = vi.fn(async (cmd: string): Promise<ExecTextResult> => {
      if (cmd === working) return HELP_WITH_STREAM;
      return SPAWN_FAILED;
    });
    const bridges = createBridges({
      execText,
      dirs: { [NVM_ROOT]: [dirEntry("v18.20.8")] },
      existing: [ghost, working]
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: working
    });
    expect(execText.mock.calls.map(([cmd]) => cmd)).toEqual(["claude", ghost, working]);
  });

  test("reports each candidate's own failure reason when none of them runs", async () => {
    const nodeScript = nvmClaude("v20.19.5");
    const notSpawnable = "/Users/tester/.local/bin/claude";
    const execText = vi.fn(async (cmd: string): Promise<ExecTextResult> => {
      if (cmd === nodeScript) return NODE_NOT_FOUND;
      return SPAWN_FAILED;
    });
    const bridges = createBridges({
      execText,
      dirs: { [NVM_ROOT]: [dirEntry("v20.19.5")] },
      existing: [notSpawnable, nodeScript]
    });

    const probe = await probeClaudeCli(bridges);

    expect(probe.status).toBe("missing");
    if (probe.status !== "missing") return;
    expect(probe.message).toContain("无法执行");
    expect(probe.message).not.toContain("未找到");
    // 每个候选的失败原因都要看得出来，而不是只报一串路径。
    expect(probe.message).toContain(
      `${notSpawnable}（无法启动：No such file or directory (os error 2)）`
    );
    expect(probe.message).toContain(
      `${nodeScript}（--help 退出码非 0：env: node: No such file or directory）`
    );
  });
});

describe("probeClaudeCli：版本目录的确定顺序", () => {
  test("prefers the newest version directory whatever order read_dir returns", async () => {
    // 枚举顺序故意写成「旧的在最前」，文件系统的偶然顺序不该决定选哪个版本。
    const execText = vi.fn(async (cmd: string): Promise<ExecTextResult> =>
      cmd.startsWith(NVM_ROOT) ? HELP_WITH_STREAM : SPAWN_FAILED
    );
    const bridges = createBridges({
      execText,
      dirs: {
        [NVM_ROOT]: [dirEntry("v18.20.8"), dirEntry("v24.13.0"), dirEntry("v20.19.5")]
      },
      existing: [nvmClaude("v18.20.8"), nvmClaude("v24.13.0"), nvmClaude("v20.19.5")]
    });

    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: nvmClaude("v24.13.0")
    });
    // v24 一次就跑通，v20 / v18 根本没有被探测。
    expect(execText.mock.calls.map(([cmd]) => cmd)).toEqual(["claude", nvmClaude("v24.13.0")]);
  });

  test("does not let a non-version alias outrank a real version", async () => {
    // fnm 的 aliases 目录里 `default` 是指向某个真实版本的符号链接。
    const alias = `${FNM_ALIASES}/default/bin/claude`;
    const versioned = `${FNM_ALIASES}/v20.19.5/bin/claude`;
    const execText = vi.fn(async (cmd: string): Promise<ExecTextResult> =>
      cmd === alias || cmd === versioned ? HELP_WITH_STREAM : SPAWN_FAILED
    );
    const bridges = createBridges({
      execText,
      dirs: { [FNM_ALIASES]: [dirEntry("default", "symlink"), dirEntry("v20.19.5")] },
      existing: [alias, versioned]
    });

    // 两个都跑得通，所以这里断言的是**排序**：解析不出数字的别名排在真实版本之后。
    await expect(probeClaudeCli(bridges)).resolves.toEqual({
      status: "ready",
      hasStreamJson: true,
      command: versioned
    });
    expect(execText.mock.calls.map(([cmd]) => cmd)).toEqual(["claude", versioned]);
  });
});
