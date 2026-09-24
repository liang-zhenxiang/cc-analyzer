import type { Bridges } from "../../api/types";

/** `exec_text` / `run_lines` prefix their error with this when the process cannot be spawned. */
const SPAWN_FAILURE = "启动命令失败";

export type ClaudeCliProbe =
  | { status: "ready"; hasStreamJson: boolean }
  | { status: "missing"; message: string };

function isWindowsHome(home: string): boolean {
  return home.includes("\\") || /^[A-Za-z]:/.test(home);
}

/**
 * Claude Code ships as a Node CLI, so it normally lives under a per-user or
 * Homebrew bin directory. Apps started from Finder/Dock get a narrow PATH that
 * rarely contains those directories, which is why they are listed explicitly.
 */
export function candidateClaudePaths(home: string): string[] {
  const trimmed = home.replace(/[/\\]+$/, "");
  if (isWindowsHome(trimmed)) {
    return [
      `${trimmed}\\AppData\\Roaming\\npm\\claude.cmd`,
      `${trimmed}\\.claude\\local\\claude.exe`,
      `${trimmed}\\.local\\bin\\claude.exe`
    ];
  }
  return [
    `${trimmed}/.claude/local/claude`,
    `${trimmed}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${trimmed}/.bun/bin/claude`,
    `${trimmed}/.npm-global/bin/claude`
  ];
}

async function installedCandidates(bridges: Bridges): Promise<string[]> {
  let home: string;
  try {
    home = await bridges.fs.homeDir();
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const path of candidateClaudePaths(home)) {
    try {
      const info = await bridges.fs.stat(path);
      if (info.is_file) found.push(path);
    } catch {
      // Not installed at this location.
    }
  }
  return found;
}

export async function missingClaudeMessage(bridges: Bridges): Promise<string> {
  const found = await installedCandidates(bridges);
  if (found.length > 0) {
    return (
      `未找到 claude CLI：应用无法启动 \`claude\`（从 Finder/Dock 打开时 PATH 会收窄）。` +
      `已在磁盘上发现 ${found.join("、")}，但它不在 PATH 中；` +
      "请从终端启动本应用（例如 cargo run）以继承完整 PATH，或把该目录加入 PATH。"
    );
  }
  return (
    "未找到 claude CLI：应用无法启动 `claude`（从 Finder/Dock 打开时 PATH 会收窄）。" +
    "常见安装位置也没有找到它，请先安装 Claude Code CLI（npm i -g @anthropic-ai/claude-code），再从终端启动本应用。"
  );
}

/**
 * Hard probe for the Claude CLI before a report run.
 *
 * `claude --help` is cheap and proves two things at once: whether the process
 * can be spawned at all, and whether it supports `stream-json` output. A
 * non-zero `--help` still means the CLI exists, so only a spawn failure is
 * treated as "missing".
 */
export async function probeClaudeCli(bridges: Bridges): Promise<ClaudeCliProbe> {
  let result;
  try {
    result = await bridges.proc.execText("claude", ["--help"]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      status: "missing",
      message: `无法执行 claude CLI（${detail}）。请确认它已安装并在应用的 PATH 中。`
    };
  }

  const spawnFailed = result.error?.includes(SPAWN_FAILURE) ?? false;
  if (spawnFailed) {
    return { status: "missing", message: await missingClaudeMessage(bridges) };
  }

  return {
    status: "ready",
    hasStreamJson: result.ok && result.out.includes("stream-json")
  };
}
