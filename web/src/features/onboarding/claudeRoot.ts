import type { Bridges } from "../../api/types";
import { isDemoMode } from "../../demo/demoMode";
import { joinPath } from "../../lib/path";

/**
 * Claude Code 的会话根目录。默认是 `<home>/.claude/projects`，用户可以在开箱
 * 引导里改选一份已经存在的副本（备份盘、迁移后的目录等）。
 *
 * 这里只做**路径解析与自检**，不做扫描：`sessionRepository` 负责真正的读取。
 * 两边共用同一份「根目录从哪来」的知识，否则改了目录却只有一半的页面认账。
 */
export const DEFAULT_CLAUDE_ROOT_SUFFIX = [".claude", "projects"] as const;

/** 自定义目录的持久化键。只存路径字符串，不存任何会话内容。 */
export const CLAUDE_ROOT_STORAGE_KEY = "cca-claude-root";

/**
 * 根目录变化时在 `window` 上广播的事件。设置面板 / 引导层改了值之后，已经挂载
 * 的消费者（引导自检、会话列表）能重新读一次，而不是等下次重启。
 */
export const CLAUDE_ROOT_CHANGED_EVENT = "cca-claude-root-changed";

export type ClaudeRootState = "ok" | "missing" | "unreadable" | "empty";

export type RootCheck = {
  state: ClaudeRootState;
  /** 这次实际检查的目录（自定义值或默认值）。 */
  path: string;
  /** 给用户看的中文说明——不写内部错误原文，路径已在 `path` 里。 */
  message: string;
  /** 读到的 `.jsonl` 会话文件数（一层或两层都算）。 */
  sessionCount: number;
};

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 路径是否可用作根目录：必须像绝对路径。
 *
 * 相对路径与 `~` 都是**读不出来**的值（前端没有展开 `~` 的能力），把它们当
 * 自定义目录会让每次启动都失败；回退默认目录至少还有一次机会。空串 / 空白
 * 同理视为「没配置」。
 */
export function isUsableClaudeRoot(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return (
    trimmed.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("\\\\")
  );
}

/** 读取已保存的自定义目录；没有、非法或存储不可用时都返回 null。 */
export function readStoredClaudeRoot(): string | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(CLAUDE_ROOT_STORAGE_KEY);
    return isUsableClaudeRoot(raw) ? raw.trim() : null;
  } catch {
    return null;
  }
}

/** 写入自定义目录；传 null / 非法值时删除并回到默认目录。 */
export function setClaudeRoot(path: string | null): void {
  const store = storage();
  try {
    if (store) {
      if (isUsableClaudeRoot(path)) store.setItem(CLAUDE_ROOT_STORAGE_KEY, path.trim());
      else store.removeItem(CLAUDE_ROOT_STORAGE_KEY);
    }
  } finally {
    // 即使 localStorage 不可用（隐私模式 / 测试），也要通知挂着的消费者重查。
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CLAUDE_ROOT_CHANGED_EVENT));
    }
  }
}

/**
 * 解析当前生效的根目录：自定义优先，否则 `<home>/.claude/projects`。
 *
 * **演示模式不认自定义目录**：演示桥只挂载 `/demo-home/.claude/projects`，
 * 沿用用户之前选过的真实路径会让引导层把演示拦在「目录不存在」。演示模式
 * 的作用是展示产品，不是读用户的目录；退出演示后自定义值原样生效。
 */
export async function resolveClaudeRoot(bridges: Bridges): Promise<string> {
  const stored = isDemoMode() ? null : readStoredClaudeRoot();
  if (stored) return stored;
  return joinPath(await bridges.fs.homeDir(), ...DEFAULT_CLAUDE_ROOT_SUFFIX);
}

/**
 * 判断一个错误是不是「路径不存在」。
 *
 * 跨平台 / 跨宿主差别很大：Tauri 的 Rust 错误带 `os error 2` 或 `ENOENT`，
 * Windows 可能只说 `NotFound`。分不清「没装 / 没数据」和「权限坏了」的话，
 * 引导就会把权限问题说成「先运行一次 Claude Code」。
 */
export function isMissingPathError(cause: unknown): boolean {
  const code =
    typeof cause === "object" && cause !== null
      ? (cause as { code?: unknown }).code
      : undefined;
  if (code === "ENOENT" || code === "NotFound") return true;
  const message = cause instanceof Error ? cause.message : String(cause);
  return /ENOENT|no such file|not found|os error 2|不存在/i.test(message);
}

function messageFor(state: ClaudeRootState, sessionCount: number): string {
  switch (state) {
    case "ok":
      return `已在这个目录里找到 ${sessionCount} 个会话文件。`;
    case "empty":
      return "目录可以读取，但里面还没有 .jsonl 会话文件。请确认选的是 Claude Code 的 projects 目录。";
    case "missing":
      return "目录不存在。先运行一次 Claude Code 生成会话，或选择其他目录。";
    case "unreadable":
      return "目录存在但无法读取，可能是权限不足。请在系统设置里允许本应用访问该目录后重试。";
  }
}

/**
 * 自检根目录。
 *
 * `projects` 下是**项目目录**，再下一层才是 `.jsonl`；但用户也可能把某个项目
 * 目录本身选成根（第一层就是 jsonl），两种都算 `ok`。一个 `.jsonl` 都读不到时
 * 才区分 `empty`（可读但空）与 `unreadable`（连子目录都读不动）。
 */
export async function checkClaudeRoot(
  bridges: Bridges,
  path?: string
): Promise<RootCheck> {
  const root = path ?? (await resolveClaudeRoot(bridges));

  let entries;
  try {
    entries = await bridges.fs.readDir(root);
  } catch (cause) {
    const state: ClaudeRootState = isMissingPathError(cause) ? "missing" : "unreadable";
    return { state, path: root, message: messageFor(state, 0), sessionCount: 0 };
  }

  let sessionCount = 0;
  let unreadableChild = false;

  for (const entry of entries) {
    if (entry.is_file && entry.name.endsWith(".jsonl")) {
      sessionCount += 1;
      continue;
    }
    if (!entry.is_dir) continue;

    try {
      const files = await bridges.fs.readDir(joinPath(root, entry.name));
      sessionCount += files.filter(
        (file) => file.is_file && file.name.endsWith(".jsonl")
      ).length;
    } catch {
      // 单个项目目录读不动不立刻下结论：其它目录里可能还有会话。
      unreadableChild = true;
    }
  }

  if (sessionCount > 0) {
    return { state: "ok", path: root, message: messageFor("ok", sessionCount), sessionCount };
  }

  const state: ClaudeRootState = unreadableChild ? "unreadable" : "empty";
  return { state, path: root, message: messageFor(state, 0), sessionCount: 0 };
}

/**
 * 根目录读不出来时的可识别错误。
 *
 * 上层要能区分「只是没装 / 没有数据」与「真的读取失败」：前者该引导用户，
 * 后者该提示权限或重试。把状态挂在错误对象上，比让调用方解析错误文案稳。
 */
export class ClaudeRootError extends Error {
  constructor(
    readonly state: "missing" | "unreadable",
    readonly path: string,
    readonly cause?: unknown
  ) {
    super(
      state === "missing"
        ? `会话目录不存在：${path}`
        : `会话目录无法读取：${path}`
    );
    this.name = "ClaudeRootError";
  }
}
