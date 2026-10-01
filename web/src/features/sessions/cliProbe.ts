import type { Bridges, DirEntry, ExecTextResult } from "../../api/types";

/** `exec_text` / `run_lines` prefix their error with this when the process cannot be spawned. */
const SPAWN_FAILURE = "启动命令失败";

/** What a healthy PATH resolves; only used when the PATH lookup actually worked. */
const PATH_COMMAND = "claude";

export type ClaudeCliProbe =
  | {
      status: "ready";
      hasStreamJson: boolean;
      /**
       * The resolved command to hand to `runLines`. Either the literal
       * `claude` (the PATH lookup succeeded) or an absolute path (PATH failed
       * and this is the install that answered). Callers must run *this*, not
       * the bare name — resolving a path and then running `claude` anyway
       * would put the original failure right back.
       */
      command: string;
    }
  | { status: "missing"; message: string };

function isWindowsHome(home: string): boolean {
  return home.includes("\\") || /^[A-Za-z]:/.test(home);
}

/**
 * Claude Code ships as a Node CLI, so it normally ends up in a per-user bin
 * directory, and apps started from Finder/Dock get a narrow PATH that rarely
 * contains those directories — which is why they are listed explicitly.
 *
 * The version-manager *shims* are here because their location never changes.
 * Their per-version install directories do change, so those are discovered by
 * `versionManagerCandidates` instead of being guessed.
 */
export function candidateClaudePaths(home: string): string[] {
  const trimmed = home.replace(/[/\\]+$/, "");
  if (isWindowsHome(trimmed)) {
    return [
      `${trimmed}\\AppData\\Roaming\\npm\\claude.cmd`,
      `${trimmed}\\.claude\\local\\claude.exe`,
      `${trimmed}\\.local\\bin\\claude.exe`,
      `${trimmed}\\.bun\\bin\\claude.exe`,
      `${trimmed}\\scoop\\shims\\claude.cmd`,
      `${trimmed}\\AppData\\Local\\Volta\\bin\\claude.cmd`,
      `${trimmed}\\AppData\\Local\\pnpm\\claude.cmd`,
      `${trimmed}\\AppData\\Local\\Yarn\\bin\\claude.cmd`
    ];
  }
  return [
    `${trimmed}/.claude/local/claude`,
    `${trimmed}/.local/bin/claude`,
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    `${trimmed}/.bun/bin/claude`,
    `${trimmed}/.npm-global/bin/claude`,
    `${trimmed}/.volta/bin/claude`,
    `${trimmed}/.asdf/shims/claude`,
    `${trimmed}/.local/share/mise/shims/claude`,
    `${trimmed}/.nodenv/shims/claude`,
    `${trimmed}/Library/pnpm/claude`,
    `${trimmed}/.local/share/pnpm/claude`,
    `${trimmed}/.yarn/bin/claude`,
    `${trimmed}/.config/yarn/global/node_modules/.bin/claude`
  ];
}

type VersionManagerRoot = {
  /** Directory holding one subdirectory per installed version (or alias). */
  root: (home: string) => string;
  /** Path of the CLI inside one version directory, as path segments. */
  segments: string[];
};

/**
 * Version managers keep each toolchain under a directory named after its
 * version, so the full path cannot be spelled out — it has to be enumerated.
 *
 * Every root is attempted rather than first detecting which manager is
 * installed: an unreadable directory costs one failed `read_dir` and simply
 * means that manager is not in use, which keeps this table a plain list of
 * places to look rather than a branching detection routine.
 *
 * Managers whose entry point has a fixed path (volta, asdf, mise, nodenv, pnpm,
 * yarn) are covered by `candidateClaudePaths` through their shim; only the ones
 * that genuinely hide the CLI behind a version directory appear here.
 */
const UNIX_VERSION_ROOTS: readonly VersionManagerRoot[] = [
  { root: (home) => `${home}/.nvm/versions/node`, segments: ["bin", "claude"] },
  { root: (home) => `${home}/.asdf/installs/nodejs`, segments: ["bin", "claude"] },
  { root: (home) => `${home}/.nodenv/versions`, segments: ["bin", "claude"] },
  { root: (home) => `${home}/.local/share/mise/installs/node`, segments: ["bin", "claude"] },
  { root: (home) => `${home}/.local/share/fnm/aliases`, segments: ["bin", "claude"] },
  {
    root: (home) => `${home}/.local/share/fnm/node-versions`,
    segments: ["installation", "bin", "claude"]
  },
  // Homebrew installs fnm under Application Support rather than ~/.local/share.
  { root: (home) => `${home}/Library/Application Support/fnm/aliases`, segments: ["bin", "claude"] },
  {
    root: (home) => `${home}/Library/Application Support/fnm/node-versions`,
    segments: ["installation", "bin", "claude"]
  }
];

/**
 * On Windows a global npm package's launcher lands in the Node install
 * directory itself, not in a `bin` subdirectory, which is why these segments
 * differ from the unix ones.
 */
const WINDOWS_VERSION_ROOTS: readonly VersionManagerRoot[] = [
  { root: (home) => `${home}\\AppData\\Roaming\\nvm`, segments: ["claude.cmd"] },
  { root: (home) => `${home}\\AppData\\Roaming\\fnm\\aliases`, segments: ["claude.cmd"] },
  {
    root: (home) => `${home}\\AppData\\Roaming\\fnm\\node-versions`,
    segments: ["installation", "claude.cmd"]
  },
  { root: (home) => `${home}\\AppData\\Local\\fnm\\aliases`, segments: ["claude.cmd"] }
];

async function versionManagerCandidates(bridges: Bridges, home: string): Promise<string[]> {
  const roots = isWindowsHome(home) ? WINDOWS_VERSION_ROOTS : UNIX_VERSION_ROOTS;
  const separator = isWindowsHome(home) ? "\\" : "/";
  const paths: string[] = [];

  for (const { root, segments } of roots) {
    const dir = root(home);
    let entries: DirEntry[];
    try {
      entries = await bridges.fs.readDir(dir);
    } catch {
      // The manager is not installed, or the directory is unreadable.
      continue;
    }
    // Entries are not filtered by `is_dir`: `read_dir` does not follow
    // symlinks, so a symlinked version directory reports as neither a file nor
    // a directory — and fnm installs its aliases exactly that way. `stat` does
    // follow links, so it stays the authority on what exists.
    for (const entry of entries) {
      paths.push([dir, entry.name, ...segments].join(separator));
    }
  }

  return paths;
}

async function installedCandidates(bridges: Bridges): Promise<string[]> {
  let home: string;
  try {
    home = await bridges.fs.homeDir();
  } catch {
    return [];
  }

  const candidates = [
    ...new Set([
      ...candidateClaudePaths(home),
      ...(await versionManagerCandidates(bridges, home))
    ])
  ];

  const found: string[] = [];
  for (const path of candidates) {
    try {
      const info = await bridges.fs.stat(path);
      if (info.is_file) found.push(path);
    } catch {
      // Not installed at this location.
    }
  }
  return found;
}

function bridgeErrorMessage(detail: string): string {
  return `无法执行 claude CLI（${detail}）。请确认它已安装并在应用的 PATH 中。`;
}

function installHintMessage(): string {
  return (
    "未找到 claude CLI：应用无法启动 `claude`（从 Finder/Dock 打开时 PATH 会收窄）。" +
    "已在 PATH 与常见安装位置（含 nvm、volta、fnm、asdf、mise、pnpm、yarn 等版本管理器）中查找，均未找到。" +
    "请先安装 Claude Code CLI（npm i -g @anthropic-ai/claude-code）；" +
    "若确认已安装，请从终端启动本应用，以继承 Finder/Dock 下被收窄的完整 PATH。"
  );
}

/** Reported only when the CLI was located on disk but would not run. */
function unrunnableMessage(paths: string[]): string {
  return (
    `找到 claude CLI 但无法执行它：${paths.join("、")}。` +
    "文件存在却不能运行，通常是权限不足、安装不完整或与当前系统架构不匹配。" +
    "请修复该安装，或卸载后重装 Claude Code CLI（npm i -g @anthropic-ai/claude-code）。"
  );
}

type HelpOutcome =
  | { kind: "ran"; hasStreamJson: boolean }
  | { kind: "spawn-failed" }
  | { kind: "bridge-error"; detail: string };

/**
 * Runs `claude --help` and classifies the outcome.
 *
 * The two failure modes must not be conflated. A *spawn failure* means this
 * particular command was not found, which is worth retrying with another path;
 * a rejected call means the bridge itself is broken, and retrying through it
 * is pointless. A non-zero exit is neither — the CLI exists and ran, so it
 * still counts as usable.
 */
async function runHelp(bridges: Bridges, command: string): Promise<HelpOutcome> {
  let result: ExecTextResult;
  try {
    result = await bridges.proc.execText(command, ["--help"]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: "bridge-error", detail };
  }

  if (result.error?.includes(SPAWN_FAILURE)) return { kind: "spawn-failed" };
  return { kind: "ran", hasStreamJson: result.ok && result.out.includes("stream-json") };
}

/**
 * Resolves the Claude CLI before a report run.
 *
 * `claude --help` is cheap and proves two things at once: whether the process
 * can be spawned at all, and whether it supports `stream-json` output.
 *
 * A PATH lookup is preferred because it honours whatever the user set up. When
 * it fails — the Finder/Dock case, where the PATH is narrow and a Node version
 * manager is invisible — the installs found on disk are tried in order, and the
 * first one that actually runs becomes the resolved `command`. The order is the
 * fixed locations first, then the enumerated version directories, so which
 * install wins is deterministic rather than dependent on the filesystem; that
 * it runs at all is verified rather than assumed. The resolution happens once
 * per report so the probe and the run cannot disagree.
 */
export async function probeClaudeCli(bridges: Bridges): Promise<ClaudeCliProbe> {
  const fromPath = await runHelp(bridges, PATH_COMMAND);
  if (fromPath.kind === "ran") {
    return { status: "ready", command: PATH_COMMAND, hasStreamJson: fromPath.hasStreamJson };
  }
  if (fromPath.kind === "bridge-error") {
    return { status: "missing", message: bridgeErrorMessage(fromPath.detail) };
  }

  const found = await installedCandidates(bridges);
  if (found.length === 0) {
    return { status: "missing", message: installHintMessage() };
  }

  const unrunnable: string[] = [];
  for (const path of found) {
    const outcome = await runHelp(bridges, path);
    if (outcome.kind === "ran") {
      return { status: "ready", command: path, hasStreamJson: outcome.hasStreamJson };
    }
    if (outcome.kind === "bridge-error") {
      return { status: "missing", message: bridgeErrorMessage(outcome.detail) };
    }
    unrunnable.push(path);
  }

  return { status: "missing", message: unrunnableMessage(unrunnable) };
}
