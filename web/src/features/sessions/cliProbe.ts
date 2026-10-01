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

/**
 * Parses `v20.19.5` / `20.19.5` / `v20` into comparable numbers, and returns
 * `null` for anything that is not a version (`default`, `lts`, `system` — fnm
 * and nvm both put aliases next to real versions).
 */
function parseVersionName(name: string): number[] | null {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(name);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

/**
 * Orders enumerated version-directory names newest first.
 *
 * `read_dir` hands entries back in whatever order the filesystem happens to
 * use, which differs between machines. Without sorting, *which install wins* is
 * an accident of enumeration: the same set of candidates could resolve to the
 * newest Node on one machine and to a years-old one on another, and the
 * resulting `command` would differ between two users with identical setups.
 * Sorting turns "which version was chosen" into a predictable decision, and
 * newest-first matches what the user's own shell would pick.
 *
 * Names that are not versions carry no ordering information, so they sort
 * *after* every parseable version rather than ahead of it — an alias must never
 * shadow a real install merely because it was enumerated first.
 */
function compareVersionNamesNewestFirst(a: string, b: string): number {
  const left = parseVersionName(a);
  const right = parseVersionName(b);
  if (left && right) {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return right[index] - left[index];
    }
    return 0;
  }
  if (left) return -1;
  if (right) return 1;
  // Two non-version names: order them by name so the result stays stable
  // instead of falling back to the filesystem's enumeration order.
  return a.localeCompare(b);
}

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
    //
    // `sort` mutates, and this array comes straight from the bridge, so sort a
    // copy of the names rather than the entries themselves.
    const names = entries.map((entry) => entry.name).sort(compareVersionNamesNewestFirst);
    for (const name of names) {
      paths.push([dir, name, ...segments].join(separator));
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

/** One located-but-unusable install, paired with what it did when probed. */
type UnrunnableCandidate = { path: string; reason: string };

/**
 * Reported only when the CLI was located on disk but would not run.
 *
 * Each candidate carries its own reason. A bare list of paths would leave the
 * user to guess whether the install is missing a permission bit, built for the
 * wrong architecture, or — the case that motivated this — a Node script whose
 * shebang cannot find `node` at all, so that they can tell which fix applies.
 */
function unrunnableMessage(candidates: UnrunnableCandidate[]): string {
  const details = candidates.map(({ path, reason }) => `${path}（${reason}）`).join("、");
  return (
    `找到 claude CLI 但无法执行它：${details}。` +
    "文件存在却不能运行，通常是权限不足、安装不完整或与当前系统架构不匹配；" +
    "若失败原因是找不到 node，说明它是由版本管理器安装的 Node 脚本，" +
    "需要对应的 node 也在 PATH 中（也可改用官方原生二进制发行版）。" +
    "请修复该安装，或卸载后重装 Claude Code CLI（npm i -g @anthropic-ai/claude-code）。"
  );
}

/** Failure output may be multi-line; the first non-empty line names the cause. */
function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

type HelpOutcome =
  /** The process started *and* exited 0 — the command genuinely runs. */
  | { kind: "runnable"; hasStreamJson: boolean }
  /** The process started but exited non-zero, e.g. a shebang whose `node` is missing. */
  | { kind: "exited-non-zero"; detail: string }
  /** The process never started, so nothing exists at this path. */
  | { kind: "spawn-failed"; detail: string }
  /** The bridge call itself rejected; retrying through a broken bridge is pointless. */
  | { kind: "bridge-error"; detail: string };

type FailedHelp = Extract<HelpOutcome, { kind: "exited-non-zero" | "spawn-failed" }>;

/**
 * Runs `claude --help` and classifies the outcome.
 *
 * "It started" and "it worked" are different facts, and conflating them is what
 * made a perfectly dead install look healthy: a `claude` from a version-manager
 * Node is a script whose shebang is `#!/usr/bin/env node`. With `node` absent
 * from the (narrow) PATH the process *does* start, then exits 127 with
 * `env: node: No such file or directory` — no spawn error anywhere in sight.
 * Hence three distinct outcomes rather than a boolean.
 *
 * A rejected call is none of these: the bridge itself is broken, and retrying
 * through it is pointless.
 */
async function runHelp(bridges: Bridges, command: string): Promise<HelpOutcome> {
  let result: ExecTextResult;
  try {
    result = await bridges.proc.execText(command, ["--help"]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: "bridge-error", detail };
  }

  const error = result.error ?? "";
  if (error.includes(SPAWN_FAILURE)) {
    const detail = firstLine(error.replace(SPAWN_FAILURE, "").replace(/^[：:\s]+/, ""));
    return { kind: "spawn-failed", detail };
  }
  if (!result.ok) {
    return { kind: "exited-non-zero", detail: firstLine(error) };
  }
  return { kind: "runnable", hasStreamJson: result.out.includes("stream-json") };
}

/** Turns a probe failure into the parenthetical shown next to its path. */
function failureReason(outcome: FailedHelp): string {
  if (outcome.kind === "spawn-failed") {
    return outcome.detail ? `无法启动：${outcome.detail}` : "无法启动";
  }
  return outcome.detail ? `--help 退出码非 0：${outcome.detail}` : "--help 退出码非 0";
}

/**
 * Resolves the Claude CLI before a report run.
 *
 * `claude --help` is cheap and proves two things at once: whether the process
 * can be spawned at all, and whether it supports `stream-json` output.
 *
 * A PATH lookup is preferred because it honours whatever the user set up, and
 * it keeps its original lenient rule — for a name resolved through PATH, being
 * *spawnable* is what proves the CLI exists, and the exit code is not held
 * against it.
 *
 * When that fails — the Finder/Dock case, where the PATH is narrow and a Node
 * version manager is invisible — the installs found on disk are tried in order,
 * and the first one that actually runs becomes the resolved `command`. Order is
 * deterministic: the fixed locations first, then the enumerated version
 * directories sorted newest-first (see `compareVersionNamesNewestFirst`), so
 * which install wins does not depend on the filesystem's enumeration order.
 *
 * Absolute-path candidates are held to the *stricter* rule that `--help` must
 * exit 0, because a candidate that cannot run must not be handed to the report
 * run only to fail there. The trade-off is deliberate: a future version that
 * exits non-zero on `--help` while working fine for `-p` would be skipped. That
 * is preferred to reporting a dead install as ready, and each rejected
 * candidate's reason reaches the user's message either way.
 *
 * The resolution happens once per report so the probe and the run cannot
 * disagree.
 */
export async function probeClaudeCli(bridges: Bridges): Promise<ClaudeCliProbe> {
  const fromPath = await runHelp(bridges, PATH_COMMAND);
  if (fromPath.kind === "runnable") {
    return { status: "ready", command: PATH_COMMAND, hasStreamJson: fromPath.hasStreamJson };
  }
  if (fromPath.kind === "exited-non-zero") {
    // Lenient by design, and only here: the name was spawnable, so the CLI is
    // on PATH and the user can run it. A non-zero `--help` must not turn that
    // into "not installed".
    return { status: "ready", command: PATH_COMMAND, hasStreamJson: false };
  }
  if (fromPath.kind === "bridge-error") {
    return { status: "missing", message: bridgeErrorMessage(fromPath.detail) };
  }

  const found = await installedCandidates(bridges);
  if (found.length === 0) {
    return { status: "missing", message: installHintMessage() };
  }

  const unrunnable: UnrunnableCandidate[] = [];
  for (const path of found) {
    const outcome = await runHelp(bridges, path);
    if (outcome.kind === "runnable") {
      return { status: "ready", command: path, hasStreamJson: outcome.hasStreamJson };
    }
    if (outcome.kind === "bridge-error") {
      return { status: "missing", message: bridgeErrorMessage(outcome.detail) };
    }
    // Located but unusable: keep looking rather than stopping at the first hit.
    unrunnable.push({ path, reason: failureReason(outcome) });
  }

  return { status: "missing", message: unrunnableMessage(unrunnable) };
}
