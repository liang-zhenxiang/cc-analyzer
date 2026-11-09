import type { SessionRecord } from "../sessions/types";
import { formatProjectPath } from "../../lib/format";
import { basename } from "../../lib/path";
import { tokenTotalsOf } from "../sessions/tokenTotals";
import { errorSignature } from "./errorArchive";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 项目记忆（Project Memory）：把窗口内的日志压成「这个项目怎么干活」的
 * 四条事实——常用命令、常碰文件、反复踩的坑、以及体量。
 *
 * 这一层是纯函数：零 I/O、零 `Date.now()`（时钟由参数传入），同一份输入
 * 永远得到同一份输出。时间窗与 `aggregateRange` / `toolCensus` 同口径：
 * 最近 `days` 个**本地日**（含今天），记录按时间戳裁剪。
 *
 * 隐私取舍（为什么这么写）：
 *
 * 1. 项目名只走 `formatProjectPath`（有 cwd 时取 basename），**绝不输出绝对
 *    路径**——这份数据会被界面直接展示，路径里通常带用户名和目录结构。
 * 2. Bash 命令只保留归一后的前 3 个 token：完整命令行里最常见的是 token、
 *    密码、URL 查询串和提交信息，它们对「这个项目常用什么命令」没有增量
 *    信息，却会原样出现在屏幕上。命中密钥样式时连参数都不留。
 * 3. 文件只留 basename：目录结构能反推出用户在主机的哪些位置干活。
 *
 * 失败口径：工具错误的签名复用 `errorSignature`（errorArchive 的档案口径），
 * 不在本文件另起一套归一规则，否则两个面板会对同一条错误给出两种说法。
 */

export type MemoryCommand = { command: string; count: number; failures: number; lastUsed: number };
export type MemoryFile = { name: string; touches: number; edits: number; lastTouched: number };
export type MemoryPitfall = {
  signature: string;
  tool: string;
  failures: number;
  firstSeen: number;
  lastSeen: number;
  /** 该错误最后一次出现之后，同一工具是否又有过成功记录（窗口内）。 */
  recovered: boolean;
};

export type ProjectMemory = {
  project: string;
  sessions: number;
  tokens: number;
  lastActive: number;
  commands: MemoryCommand[];
  files: MemoryFile[];
  pitfalls: MemoryPitfall[];
};

export type ProjectMemoryOptions = {
  maxProjects?: number;
  maxCommands?: number;
  maxFiles?: number;
  maxPitfalls?: number;
};

const DEFAULT_MAX_PROJECTS = 8;
const DEFAULT_MAX_COMMANDS = 6;
const DEFAULT_MAX_FILES = 6;
const DEFAULT_MAX_PITFALLS = 5;

/** 未命名项目的兜底名（与 chronicle 的展示口径一致）。 */
const UNNAMED_PROJECT = "未命名项目";

/** 命令保留的 token 数：`npm run build` 恰好是「在跑什么」的最短完整表达。 */
const COMMAND_MAX_TOKENS = 3;
/** 命令文本上限（码点）。再长就不是「常用命令」而是半条命令行。 */
const COMMAND_MAX_CHARS = 80;

/**
 * 命中即视为命令里带着凭据/参数的标记。`=` 一项刻意放宽：`--foo=bar`、
 * `?a=b` 与 `API_KEY=x` 都会触发保守截断——宁可少显示一个参数，也不把
 * 一个可能带值的片段留在界面上。
 */
const SECRET_MARKER = /=|--token|--key|--secret|--password|api_key|sk-|ghp_|AKIA/i;

/** 前导的环境变量赋值（`API_KEY=xxx`）：值必须整段丢弃，不能进结果。 */
const LEADING_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** 文件工具的判定集合。 */
const READ_TOOL = "Read";
const EDIT_TOOLS = new Set(["Edit", "Write"]);

/**
 * 把一条 Bash 命令折成可展示的短命令。
 *
 * 顺序固定：首行 → 去引号内容 → 折叠空白 → 丢掉前导 `VAR=value` →
 * 命中凭据样式只留命令名，否则留前 3 个 token → 截断。
 *
 * 引号内容先删是安全的：命令的自然语言参数（提交信息、grep 模式、URL）
 * 几乎都在引号里，而引号外的 token 足以说明「在跑什么」。
 */
export function normalizeCommand(raw: string): string {
  const firstLine = (raw.split("\n")[0] ?? "").trim();
  if (firstLine === "") return "";

  const unquoted = firstLine.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, " ");
  const tokens = unquoted.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);

  // 环境变量前缀不是命令名（`API_KEY=xxx curl ...` 的命令是 curl）；整段
  // 丢弃比保留更安全，因为值恰好就是最该藏起来的部分。
  let start = 0;
  while (start < tokens.length && LEADING_ASSIGNMENT.test(tokens[start])) start += 1;
  const commandTokens = tokens.slice(start);
  if (commandTokens.length === 0) return "";

  const risky = commandTokens.some((token) => SECRET_MARKER.test(token));
  const kept = risky
    ? commandTokens.slice(0, 1)
    : commandTokens.slice(0, COMMAND_MAX_TOKENS);

  const text = kept.join(" ");
  const chars = Array.from(text);
  return chars.length > COMMAND_MAX_CHARS
    ? `${chars.slice(0, COMMAND_MAX_CHARS).join("")}…`
    : text;
}

function stringField(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Bash 记录的命令文本：parser 把 tool_use 的 input 原样挂在 toolInput 上。 */
function commandOf(record: SessionRecord): string | null {
  if (record.kind !== "tool" || record.toolName !== "Bash") return null;
  const command = stringField(record.toolInput, "command");
  // 结构化 Bash 结果不带命令原文（只有 stdout/stderr），没有输入就只能跳过。
  return command;
}

/**
 * 文件路径双源取径：优先 `structuredResult.filePath`（喂给视图的结构化结果），
 * 缺失时兜底 `toolInput.file_path`（未配对 / 被中断的调用没有结构化结果）。
 */
function filePathOf(record: SessionRecord): string | null {
  if (record.kind !== "tool" || !record.toolName) return null;
  if (record.toolName !== READ_TOOL && !EDIT_TOOLS.has(record.toolName)) return null;

  const structured = record.structuredResult;
  if (
    structured !== undefined &&
    "filePath" in structured &&
    typeof structured.filePath === "string" &&
    structured.filePath.length > 0
  ) {
    return structured.filePath;
  }
  return stringField(record.toolInput, "file_path");
}

/**
 * 「等用户输入」不算坑（与 errorStats 的 Issue #146 口径一致）：用户拒绝
 * 授权是交互结果，不是这个项目反复踩的技术问题，混进坑列表只会淹掉真错误。
 */
const WAIT_TOOL_NAME = "AskUserQuestion";
const WAIT_REJECTION_TEXT = "user doesn't want to proceed";

function isWaitRejection(record: SessionRecord): boolean {
  return (
    record.toolName === WAIT_TOOL_NAME &&
    (record.toolResult ?? "").includes(WAIT_REJECTION_TEXT)
  );
}

function projectNameOf(input: UsageSessionInput): string {
  // `projectLabel` 是聚合桶的权威键（会话级）；`session.projectLabel` 只在
  // 手造输入缺顶层字段时兜底。cwd 同理。
  const label = input.projectLabel || input.session?.projectLabel || "";
  const cwd = input.projectPath ?? input.session?.cwd;
  const name = formatProjectPath(label, cwd);
  return name.length > 0 ? name : UNNAMED_PROJECT;
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

type CommandAcc = MemoryCommand;
type FileAcc = MemoryFile;
type PitfallAcc = Omit<MemoryPitfall, "recovered">;

type ProjectAcc = {
  project: string;
  sessions: number;
  /** 窗口内该项目的全部记录——token 合计交给 `tokenTotalsOf` 算，不另起口径。 */
  records: SessionRecord[];
  lastActive: number;
  commands: Map<string, CommandAcc>;
  files: Map<string, FileAcc>;
  pitfalls: Map<string, PitfallAcc>;
  /** 每个工具窗口内最后一次**成功**的时间；坑的 recovered 判定只看它。 */
  lastSuccessByTool: Map<string, number>;
};

function acquire(projects: Map<string, ProjectAcc>, project: string): ProjectAcc {
  let acc = projects.get(project);
  if (!acc) {
    acc = {
      project,
      sessions: 0,
      records: [],
      lastActive: Number.NEGATIVE_INFINITY,
      commands: new Map(),
      files: new Map(),
      pitfalls: new Map(),
      lastSuccessByTool: new Map()
    };
    projects.set(project, acc);
  }
  return acc;
}

function byRecent<T>(a: T, b: T, key: (value: T) => number): number {
  return key(b) - key(a);
}

/**
 * 构造每个项目的记忆卡片。
 *
 * @param inputs 会话输入；`records` 之外的事实（sidechain、错误提取）不参与
 *   ——项目记忆只回答「主链上这个项目怎么干活」，与工具普查的含子链口径
 *   不是同一个问题，混进来会让命令/文件数对不上用户看到的会话。
 * @param days 窗口天数（本地日，含今天）。
 * @param now 窗口右端点；记录时间大于它的（时钟漂移 / 未来行）不计。
 */
export function buildProjectMemories(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  options?: ProjectMemoryOptions
): ProjectMemory[] {
  const windowDays = Math.max(1, Math.floor(days));
  const startTs = addLocalDays(dayStartOf(now), -(windowDays - 1));

  const maxProjects = positiveLimit(options?.maxProjects, DEFAULT_MAX_PROJECTS);
  const maxCommands = positiveLimit(options?.maxCommands, DEFAULT_MAX_COMMANDS);
  const maxFiles = positiveLimit(options?.maxFiles, DEFAULT_MAX_FILES);
  const maxPitfalls = positiveLimit(options?.maxPitfalls, DEFAULT_MAX_PITFALLS);

  const projects = new Map<string, ProjectAcc>();

  for (const input of inputs) {
    const inWindow = input.records.filter(
      (record) => record.timestamp >= startTs && record.timestamp <= now
    );
    if (inWindow.length === 0) continue;

    const acc = acquire(projects, projectNameOf(input));
    acc.sessions += 1;

    for (const record of inWindow) {
      acc.records.push(record);
      if (record.timestamp > acc.lastActive) acc.lastActive = record.timestamp;

      const command = commandOf(record);
      if (command !== null) {
        const normalized = normalizeCommand(command);
        if (normalized !== "") {
          const bucket = acc.commands.get(normalized);
          if (bucket) {
            bucket.count += 1;
            if (record.isError) bucket.failures += 1;
            if (record.timestamp > bucket.lastUsed) bucket.lastUsed = record.timestamp;
          } else {
            acc.commands.set(normalized, {
              command: normalized,
              count: 1,
              failures: record.isError ? 1 : 0,
              lastUsed: record.timestamp
            });
          }
        }
      }

      const filePath = filePathOf(record);
      if (filePath !== null) {
        const name = basename(filePath);
        if (name !== "") {
          const isEdit = EDIT_TOOLS.has(record.toolName ?? "");
          const bucket = acc.files.get(name);
          if (bucket) {
            bucket.touches += 1;
            if (isEdit) bucket.edits += 1;
            if (record.timestamp > bucket.lastTouched) bucket.lastTouched = record.timestamp;
          } else {
            acc.files.set(name, {
              name,
              touches: 1,
              edits: isEdit ? 1 : 0,
              lastTouched: record.timestamp
            });
          }
        }
      }

      if (record.isError && record.toolName && !isWaitRejection(record)) {
        const tool = record.toolName;
        const signature = errorSignature(record.toolResult ?? record.text);
        const key = `${tool}\u0000${signature}`;
        const bucket = acc.pitfalls.get(key);
        if (bucket) {
          bucket.failures += 1;
          if (record.timestamp < bucket.firstSeen) bucket.firstSeen = record.timestamp;
          if (record.timestamp > bucket.lastSeen) bucket.lastSeen = record.timestamp;
        } else {
          acc.pitfalls.set(key, {
            signature,
            tool,
            failures: 1,
            firstSeen: record.timestamp,
            lastSeen: record.timestamp
          });
        }
      }

      // 恢复判定需要「之后又成功过」；只留每个工具的最后一次成功时间，
      // 足以回答「该坑 lastSeen 之后有没有成功」。
      if (!record.isError && record.toolName) {
        const previous = acc.lastSuccessByTool.get(record.toolName);
        if (previous === undefined || record.timestamp > previous) {
          acc.lastSuccessByTool.set(record.toolName, record.timestamp);
        }
      }
    }
  }

  return [...projects.values()]
    .map((acc): ProjectMemory => {
      const commands = [...acc.commands.values()]
        .sort(
          (a, b) =>
            b.count - a.count ||
            byRecent(a, b, (value) => value.lastUsed) ||
            a.command.localeCompare(b.command)
        )
        .slice(0, maxCommands);

      const files = [...acc.files.values()]
        .sort(
          (a, b) =>
            b.touches - a.touches ||
            byRecent(a, b, (value) => value.lastTouched) ||
            a.name.localeCompare(b.name)
        )
        .slice(0, maxFiles);

      const pitfalls = [...acc.pitfalls.values()]
        .map((pitfall): MemoryPitfall => ({
          ...pitfall,
          recovered: (acc.lastSuccessByTool.get(pitfall.tool) ?? Number.NEGATIVE_INFINITY) > pitfall.lastSeen
        }))
        .sort(
          (a, b) =>
            b.failures - a.failures ||
            byRecent(a, b, (value) => value.lastSeen) ||
            a.signature.localeCompare(b.signature) ||
            a.tool.localeCompare(b.tool)
        )
        .slice(0, maxPitfalls);

      return {
        project: acc.project,
        sessions: acc.sessions,
        tokens: tokenTotalsOf(acc.records).total,
        lastActive: acc.lastActive,
        commands,
        files,
        pitfalls
      };
    })
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        b.lastActive - a.lastActive ||
        a.project.localeCompare(b.project)
    )
    .slice(0, maxProjects);
}
