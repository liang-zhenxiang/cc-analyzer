import { formatDuration, formatProjectPath } from "../../lib/format";
import { basename } from "../../lib/path";
import type { MessagePreview } from "../sessions/firstMessagePreview";
import { firstMessagePreview } from "../sessions/firstMessagePreview";
import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { ECHO_THRESHOLD, jaccard, topicSignature } from "./echoTopics";
import { normalizeCommand, toolFilePath } from "./projectMemory";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

export type { MessagePreview };

/**
 * 项目接续（Issue #397）：一个项目、一条时间序列、一串会话节点。
 *
 * 这一层只回答事实，不回答判断：
 * - 每次会话**结束时**停在哪一步（`lastAction`）；
 * - 相邻两次会话隔了多久（`gapMs` / `gapPx` / `gapLabel`）；
 * - 这次开头有没有把上次结尾重新交代一遍（`echo`）。
 *
 * 纯函数：零 I/O、零 `Date.now()`（`now` 由调用方传入），同一输入永远得到
 * 同一份输出。窗口左界与页面 KPI 相同（最近 `days` 个本地日，含今天），
 * 右界取 `now`（含）——不把未来时间戳算进来，也不与 `labWindow` 的「明天
 * 零点」混口径。
 *
 * 隐私取舍（与项目记忆同源）：
 * 1. 项目名只走 `formatProjectPath`，显示名可以是 basename，**编码目录名
 *    （`projectLabel`）只作为分组键 `key`，不进任何可见文案**；
 * 2. 文件名只取 basename，Bash 命令复用 `normalizeCommand`（最多 3 个
 *    token、命中凭据样式只留命令名）；
 * 3. 开头 / 结尾只保留 `firstMessagePreview` 的脱敏预览，不保留原文。
 *
 * 截断：模型返回**全部**会话，组件按 `HANDOFF_VISIBLE_SESSIONS` 截断。这样
 * 隐藏节点仍参与回声评分——否则第一条可见节点的「上一次」会算错。
 */

/** 默认画出的会话数（组件截断用；模型层不截断）。 */
export const HANDOFF_VISIBLE_SESSIONS = 12;

/**
 * 「进行中」阈值，与 `pulseModel.LIVE_MS` 同值（120 秒）。跨 feature 引用
 * 会让这张卡依赖 Pulse 的模块，故在此定义同值常量；改一处必须改两处。
 */
export const HANDOFF_LIVE_MS = 120_000;

/** 间距映射的上下限与步长（设计规格 §1.4 / §2.2）。 */
export const GAP_MIN = 44;
export const GAP_STEP = 8;
export const GAP_MAX = 140;

/** 全卡唯一的语义色（`--warning`）只染这四个字；UI 用它与 `formatEchoLine` 对齐。 */
export const ECHO_WARNING_TEXT = "样本不足";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** 预览上限（码位）：「一行放得下」的展示口径。 */
const PREVIEW_LIMIT = 60;
/** 评分上限（码位）：与回声的 `PROMPT_LIMIT` 同量级。 */
const SCORE_LIMIT = 200;
/** 两侧签名各至少 4 个 token 才做判断（Jaccard 对极小集合过敏）。 */
const ECHO_MIN_TOKENS = 4;
/** 日差为 1 但接近两天：文案不再写「次日 · N 小时后」。 */
const NEXT_DAY_LONG_MS = 36 * HOUR_MS;

const UNNAMED_PROJECT = "未命名项目";
const UNNAMED_SESSION = "未命名会话";
const UNKNOWN_TOOL = "未知工具";

/** 改文件类工具：动词统一是「改」。 */
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const READ_TOOL = "Read";
const BASH_TOOL = "Bash";

export type HandoffWindow = {
  /** 窗口左界（含）：`dayStartOf(now)` 往前 `days - 1` 个本地日。 */
  startTs: number;
  /** 窗口右界（含）：调用方传入的 `now`。 */
  rightTs: number;
  /** 归一后的窗口天数（至少 1）。 */
  days: number;
};

export type HandoffProject = {
  /** `projectLabel`（编码目录名）——权威分组键，不直接展示。 */
  key: string;
  /** 显示名；同名项目按切换条顺序追加「（2）」「（3）」。 */
  name: string;
  /** 窗口内可定位时间的会话数。 */
  sessions: number;
  /** 最近一次会话的 `startTs`（进入 `projects` 即有值）。 */
  lastStartTs: number;
  /** 窗口内时间未知的会话数（见 `buildProjectHandoff` 的判定）。 */
  unknownSessions: number;
};

export type LastAction =
  | { kind: "file"; verb: "改" | "读"; name: string; tool: string }
  | { kind: "command"; command: string; tool: "Bash" }
  | { kind: "tool"; tool: string }
  | { kind: "none" };

export type EchoReading =
  | { status: "scored"; score: number; percent: number | "lt1"; hit: boolean }
  | {
      status: "insufficient";
      reason: "missing-opening" | "missing-closing" | "short-text";
    }
  | { status: "no-previous" };

export type HandoffSession = {
  /** `path:<path>` 或 `anonymous:<index>`（手造输入没有元数据时）。 */
  id: string;
  /** 窗口内首条可用记录的时间。 */
  startTs: number;
  /** 窗口内末条可用记录的时间。 */
  endTs: number;
  /** 会话标题；没有元数据时为「未命名会话」。 */
  title: string;
  lastAction: LastAction;
  /** 首条可用用户消息（已脱敏、截断 60）。 */
  opening: MessagePreview | null;
  /** 末条可用用户消息（已脱敏、截断 60）。 */
  closing: MessagePreview | null;
  /**
   * **上一次**会话的末条用户消息预览（与 `closing` 同一脱敏/截断口径）。
   *
   * 回声评分的对象是「本次开头 vs 上一次结尾」，所以读数区必须能同时看到
   * 这两句话才可复算：只显示本次的结尾，读者看到两段不同的文字却写着
   * 「重合 100%」只会觉得这个数是编的。
   *
   * 只有存在可对比的上一次会话、且它有末条用户消息时才有值；窗口内第一条
   * 会话（`no-previous`）与上一次没有用户结尾时都是 `null`，组件据此整行
   * 不渲染。隐藏节点同样参与——它被 12 条截断时，可见节点的「上次结尾」
   * 仍然取那个隐藏会话的结尾。
   */
  previousClosing: MessagePreview | null;
  echo: EchoReading;
  /** 最后一条记录距 `now` 不超过 `HANDOFF_LIVE_MS`。 */
  inProgress: boolean;
  /** 与上一节点的 `startTs` 差；首节点为 `null`。 */
  gapMs: number | null;
  /** 由 `gapMs` 按对数映射算出的像素；首节点为 `null`。 */
  gapPx: number | null;
  /** 「同日 · 2 小时后」等；首节点为 `null`。 */
  gapLabel: string | null;
  /** 有则用于「打开会话」。 */
  meta?: SessionMeta;
};

export type HandoffTrack = {
  project: { key: string; name: string } | null;
  /** 全部窗口会话，按 `startTs` 升序；组件再按 12 截断。 */
  sessions: HandoffSession[];
  emptyReason:
    | "no-projects"
    | "no-sessions"
    | "single-session"
    | "all-unknown"
    | null;
  unknownSessions: number;
};

export type ProjectHandoff = {
  window: HandoffWindow;
  /** 只含窗口内有「可定位时间」会话的项目。 */
  projects: HandoffProject[];
  /** 传入的 key 不在列表里时回退到 `projects[0]`。 */
  activeKey: string | null;
  /** `activeKey` 为 `null` 时为 `null`。 */
  track: HandoffTrack | null;
};

type SessionDraft = {
  id: string;
  startTs: number;
  endTs: number;
  title: string;
  lastAction: LastAction;
  opening: MessagePreview | null;
  closing: MessagePreview | null;
  /** 评分用的 200 字预览（展示预览已截到 60，评分需要更长的上下文）。 */
  openingScoreText: string | null;
  closingScoreText: string | null;
  inProgress: boolean;
  meta?: SessionMeta;
};

type ProjectDraft = {
  key: string;
  projectPath: string | undefined;
  drafts: SessionDraft[];
  lastStartTs: number;
  unknownSessions: number;
};

function isUsableTimestamp(record: SessionRecord): boolean {
  return (
    record.missingTimestamp !== true &&
    Number.isFinite(record.timestamp) &&
    record.timestamp > 0
  );
}

function isInWindow(record: SessionRecord, startTs: number, rightTs: number): boolean {
  return isUsableTimestamp(record) && record.timestamp >= startTs && record.timestamp <= rightTs;
}

function isCandidateUser(record: SessionRecord): boolean {
  return (
    record.kind === "user" &&
    record.text.trim() !== "" &&
    record.compactSummary !== true &&
    record.isInterrupt !== true &&
    !record.commandName
  );
}

function toolInputString(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * 绝对路径的 token 边界：行首或空白 / `=` 之后。要求边界是为了不把
 * `https://…` 里的 `s:` 当成 Windows 盘符。
 */
const ABSOLUTE_PATH_TOKEN = /(^|[\s=])((?:[A-Za-z]:[\\/]|\/)[^\s]*)/g;

/**
 * 命令里的绝对路径只留 basename。`normalizeCommand` 负责截断与凭据归一，
 * 但它不拆路径；而卡片的红线是「绝不出现绝对路径」，所以这里按文件名口径
 * 再做一次收口（`cat /Users/x/.env` → `cat .env`），不新增第二套命令规则。
 */
function scrubCommandPaths(command: string): string {
  return command.replace(
    ABSOLUTE_PATH_TOKEN,
    (_match: string, lead: string, path: string) => {
      const name = basename(path);
      return `${lead}${name.length > 0 ? name : "…"}`;
    }
  );
}

function actionOfTool(record: SessionRecord): LastAction {
  const toolName = record.toolName;
  if (!toolName) return { kind: "tool", tool: UNKNOWN_TOOL };
  if (toolName === BASH_TOOL) {
    const raw = toolInputString(record.toolInput, "command");
    const command = raw === null ? "" : scrubCommandPaths(normalizeCommand(raw));
    return command === ""
      ? { kind: "tool", tool: BASH_TOOL }
      : { kind: "command", command, tool: "Bash" };
  }

  const filePath = toolFilePath(record);
  const name = filePath === null ? "" : basename(filePath);
  if (name !== "") {
    if (WRITE_TOOLS.has(toolName)) {
      return { kind: "file", verb: "改", name, tool: toolName };
    }
    if (toolName === READ_TOOL) {
      return { kind: "file", verb: "读", name, tool: toolName };
    }
    // 其他带 file_path 的工具：动作类型仍是「工具」，展示串带上 basename。
    return { kind: "tool", tool: `${toolName} · ${name}` };
  }
  return { kind: "tool", tool: toolName };
}

/**
 * 窗口内**最后一条** `kind === "tool"` 的记录（不是最后一条记录——后面
 * 可能还有助手文本）。没有任何工具记录 → `{ kind: "none" }`，不猜。
 */
function lastActionOf(records: readonly SessionRecord[]): LastAction {
  let lastTool: SessionRecord | null = null;
  for (const record of records) {
    if (record.kind === "tool") lastTool = record;
  }
  return lastTool === null ? { kind: "none" } : actionOfTool(lastTool);
}

function scoreTextOf(text: string): string | null {
  return firstMessagePreview(text, SCORE_LIMIT)?.preview ?? null;
}

function projectNameOf(label: string, cwd: string | undefined): string {
  const name = formatProjectPath(label, cwd);
  return name.length > 0 ? name : UNNAMED_PROJECT;
}

function sessionTitleOf(meta: SessionMeta | undefined, projectKey: string): string {
  if (!meta) return UNNAMED_SESSION;
  const title = sessionTitle(meta).trim();
  // `sessionTitle` 的最后一级兜底是 `projectLabel`（编码目录名）——那是分组键，
  // 不是标题；宁可写「未命名会话」，也不把用户路径换个写法印在卡上。
  if (
    title.length === 0 ||
    title === meta.projectLabel ||
    title === projectKey
  ) {
    return UNNAMED_SESSION;
  }
  return title;
}

/**
 * 时间未知的会话（设计规格 §0.3）：
 * - 有记录，但**没有任何一条**可用时间戳（有限、> 0、`missingTimestamp !== true`）；
 * - 且 `SessionMeta.mtimeMs` 落在窗口内——mtime 是我们唯一能用来说「它属于
 *   这个窗口」的事实；
 * - 没有 `mtimeMs` 的手造输入不计，不能凭猜把它塞进某一天。
 */
function unknownInWindow(
  input: UsageSessionInput,
  startTs: number,
  rightTs: number
): boolean {
  if (input.records.length === 0) return false;
  if (input.records.some(isUsableTimestamp)) return false;
  const mtime = input.session?.mtimeMs;
  return (
    typeof mtime === "number" &&
    Number.isFinite(mtime) &&
    mtime >= startTs &&
    mtime <= rightTs
  );
}

/**
 * 间距像素：`44 + 8 * log2(hours)`，钳在 `[GAP_MIN, GAP_MAX]`。
 *
 * 对数不是「画得像」，是「排序不撒谎、倍数可读」：相隔时长每翻一倍多 8px。
 * 像素只由 `gapMs` 算，日数只影响文案——像素不是尺子，精确值由间隔标签
 * 与节点时刻承担。
 */
export function handoffGapPx(gapMs: number): number {
  const hours = Math.max(1, Number.isFinite(gapMs) ? gapMs / HOUR_MS : 1);
  const raw = GAP_MIN + GAP_STEP * Math.log2(hours);
  return Math.min(GAP_MAX, Math.max(GAP_MIN, raw));
}

/**
 * 间隔文案（设计规格 §2.4）：按**本地自然日**表述，日差用 `Math.round` 的
 * 日键差——不用 `+86_400_000` 推日键，否则夏令时那天会错一天。
 */
export function handoffGapLabel(
  gapMs: number,
  previousStartTs: number,
  currentStartTs: number
): string {
  if (gapMs === 0) return "同时";

  const days = Math.round(
    (dayStartOf(currentStartTs) - dayStartOf(previousStartTs)) / DAY_MS
  );
  if (days === 0) return `同日 · ${formatDuration(gapMs)}后`;
  if (days === 1) {
    return gapMs < NEXT_DAY_LONG_MS
      ? `次日 · ${formatDuration(gapMs)}后`
      : "1 天后";
  }
  return `${days} 天后`;
}

function formatPercent(percent: number | "lt1"): string {
  return percent === "lt1" ? "<1%" : `${percent}%`;
}

/** 末动作的展示串（节点第 3 行、`title`、`aria-label` 共用）。 */
export function formatLastAction(action: LastAction): string {
  switch (action.kind) {
    case "file":
      return `${action.verb} ${action.name}`;
    case "command":
      return `Bash · ${action.command}`;
    case "tool":
      return action.tool;
    case "none":
      return "无工具调用";
  }
}

/** 接续读数的整句（§4.4 定稿）；组件不拼句、不改词。 */
export function formatEchoLine(reading: EchoReading): string {
  switch (reading.status) {
    case "no-previous":
      return "这是窗口内这个项目最早的一次会话。";
    case "insufficient":
      return reading.reason === "short-text"
        ? `${ECHO_WARNING_TEXT}：两条消息都太短（各需至少 4 个话题词）。`
        : `${ECHO_WARNING_TEXT}：首条或上次末条用户消息缺失。`;
    case "scored": {
      const percent = formatPercent(reading.percent);
      if (reading.percent === 0 || reading.percent === "lt1") {
        return `本次开头与上次结尾重合 ${percent}。`;
      }
      const threshold = `${Math.round(ECHO_THRESHOLD * 100)}%`;
      return reading.hit
        ? `本次开头与上次结尾重合 ${percent}，达到阈值 ${threshold}。`
        : `本次开头与上次结尾重合 ${percent}，低于阈值 ${threshold}。`;
    }
  }
}

/**
 * 轨道的 `aria-label` / `title` 里追加的那半句（§4.1）。`no-previous` 时
 * 没有可说的分数，返回 `null`（调用方不追加）。
 */
export function formatEchoAria(reading: EchoReading): string | null {
  if (reading.status === "scored") {
    return `开头与上次结尾重合 ${formatPercent(reading.percent)}`;
  }
  if (reading.status === "insufficient") return "重合度样本不足";
  return null;
}

function readEcho(current: SessionDraft, previous: SessionDraft | null): EchoReading {
  // 第一名没有上一名可比较。
  if (previous === null) return { status: "no-previous" };
  if (current.openingScoreText === null) {
    return { status: "insufficient", reason: "missing-opening" };
  }
  if (previous.closingScoreText === null) {
    return { status: "insufficient", reason: "missing-closing" };
  }

  const opening = topicSignature(current.openingScoreText);
  const closing = topicSignature(previous.closingScoreText);
  if (opening.size < ECHO_MIN_TOKENS || closing.size < ECHO_MIN_TOKENS) {
    return { status: "insufficient", reason: "short-text" };
  }

  const score = jaccard(opening, closing);
  const floored = Math.floor(score * 100);
  // 向下取整保证显示值永不越过判定线：命中一定 ≥55%，未命中一定 ≤54%。
  const percent = score === 0 ? 0 : floored === 0 ? "lt1" : floored;
  return { status: "scored", score, percent, hit: score >= ECHO_THRESHOLD };
}

function buildDraft(
  input: UsageSessionInput,
  id: string,
  windowRecords: readonly SessionRecord[],
  rightTs: number
): SessionDraft {
  let startTs = Number.POSITIVE_INFINITY;
  let endTs = Number.NEGATIVE_INFINITY;
  for (const record of windowRecords) {
    if (record.timestamp < startTs) startTs = record.timestamp;
    if (record.timestamp > endTs) endTs = record.timestamp;
  }

  // 开头 / 结尾按日志顺序取（JSONL 是按时间追加的）；时间范围用首末记录。
  let firstUser: SessionRecord | null = null;
  let lastUser: SessionRecord | null = null;
  for (const record of windowRecords) {
    if (!isCandidateUser(record)) continue;
    if (firstUser === null) firstUser = record;
    lastUser = record;
  }

  const meta = input.session;
  const projectKey = input.projectLabel || meta?.projectLabel || "";

  return {
    id,
    startTs,
    endTs,
    title: sessionTitleOf(meta, projectKey),
    lastAction: lastActionOf(windowRecords),
    opening: firstUser === null ? null : firstMessagePreview(firstUser.text, PREVIEW_LIMIT),
    closing: lastUser === null ? null : firstMessagePreview(lastUser.text, PREVIEW_LIMIT),
    openingScoreText: firstUser === null ? null : scoreTextOf(firstUser.text),
    closingScoreText: lastUser === null ? null : scoreTextOf(lastUser.text),
    // 负年龄（日志时间戳领先本机时钟）按 0 处理；窗口右界已含 now，正常不会出现。
    inProgress: Math.max(0, rightTs - endTs) <= HANDOFF_LIVE_MS,
    ...(meta ? { meta } : {})
  };
}

function toSession(draft: SessionDraft, previous: SessionDraft | null): HandoffSession {
  const gapMs = previous === null ? null : draft.startTs - previous.startTs;
  return {
    id: draft.id,
    startTs: draft.startTs,
    endTs: draft.endTs,
    title: draft.title,
    lastAction: draft.lastAction,
    opening: draft.opening,
    closing: draft.closing,
    // 读数区要显示「打分时真正参与比较的那句话」；没有上一次就没有这一行。
    previousClosing: previous === null ? null : previous.closing,
    echo: readEcho(draft, previous),
    inProgress: draft.inProgress,
    gapMs,
    gapPx: gapMs === null ? null : handoffGapPx(gapMs),
    gapLabel:
      gapMs === null || previous === null
        ? null
        : handoffGapLabel(gapMs, previous.startTs, draft.startTs),
    ...(draft.meta ? { meta: draft.meta } : {})
  };
}

function buildSessions(drafts: readonly SessionDraft[]): HandoffSession[] {
  const ordered = [...drafts].sort(
    (a, b) => a.startTs - b.startTs || a.id.localeCompare(b.id)
  );
  return ordered.map((draft, index) =>
    toSession(draft, index > 0 ? ordered[index - 1] : null)
  );
}

/**
 * 构造接续卡的全部数据。
 *
 * @param inputs 窗口内的会话输入（`aggregateSessionInput` 的形状）。
 * @param days 窗口天数（本地日，含今天）。
 * @param now 窗口右界（含）；「进行中」也相对它判定。调用方用 30 秒 tick
 *   的读数传入，不要用挂载时刻——否则「进行中」不会自己消失。
 * @param activeKey 当前项目；不在 `projects` 里时回退到最近有会话的项目。
 */
export function buildProjectHandoff(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  activeKey?: string | null
): ProjectHandoff {
  const windowDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
  const rightTs = Number.isFinite(now) ? now : 0;
  const startTs = addLocalDays(dayStartOf(rightTs), -(windowDays - 1));

  const byKey = new Map<string, ProjectDraft>();

  const acquire = (key: string, projectPath: string | undefined): ProjectDraft => {
    let draft = byKey.get(key);
    if (!draft) {
      draft = {
        key,
        projectPath,
        drafts: [],
        lastStartTs: Number.NEGATIVE_INFINITY,
        unknownSessions: 0
      };
      byKey.set(key, draft);
    } else if (draft.projectPath === undefined && projectPath !== undefined) {
      draft.projectPath = projectPath;
    }
    return draft;
  };

  inputs.forEach((input, index) => {
    const key = input.projectLabel || input.session?.projectLabel || "";
    const projectPath = input.projectPath ?? input.session?.cwd;
    const windowRecords = input.records.filter((record) =>
      isInWindow(record, startTs, rightTs)
    );

    if (windowRecords.length === 0) {
      if (unknownInWindow(input, startTs, rightTs)) {
        acquire(key, projectPath).unknownSessions += 1;
      }
      return;
    }

    const id = input.session ? `path:${input.session.path}` : `anonymous:${index}`;
    const draft = buildDraft(input, id, windowRecords, rightTs);
    const project = acquire(key, projectPath);
    project.drafts.push(draft);
    if (draft.startTs > project.lastStartTs) project.lastStartTs = draft.startTs;
  });

  // 只把「有可定位会话」的项目放进切换条；只有未知会话的项目无法证明自己
  // 落在这个窗口里，放进列表会显示一个永远是 0 的项目。
  const ordered = [...byKey.values()]
    .filter((project) => project.drafts.length > 0)
    .sort(
      (a, b) =>
        b.lastStartTs - a.lastStartTs ||
        b.drafts.length - a.drafts.length ||
        projectNameOf(a.key, a.projectPath).localeCompare(
          projectNameOf(b.key, b.projectPath)
        ) ||
        a.key.localeCompare(b.key)
    );

  // 同名项目按切换条顺序追加「（2）」「（3）」；不显示编码目录名。
  const nameByKey = new Map<string, string>();
  const seenNames = new Map<string, number>();
  for (const project of ordered) {
    const base = projectNameOf(project.key, project.projectPath);
    const count = (seenNames.get(base) ?? 0) + 1;
    seenNames.set(base, count);
    nameByKey.set(project.key, count === 1 ? base : `${base}（${count}）`);
  }
  for (const project of byKey.values()) {
    if (!nameByKey.has(project.key)) {
      nameByKey.set(project.key, projectNameOf(project.key, project.projectPath));
    }
  }

  const projects: HandoffProject[] = ordered.map((project) => ({
    key: project.key,
    name: nameByKey.get(project.key) ?? UNNAMED_PROJECT,
    sessions: project.drafts.length,
    lastStartTs: project.lastStartTs,
    unknownSessions: project.unknownSessions
  }));

  // 解析当前项目：传入的 key 在列表里就用它；不在时回退到最近有会话的项目。
  // 唯一的例外是「已知但窗口内全部时间未知」的项目——那是数据在选中后变化
  // 的安全态（§3.3），要能渲染出 `all-unknown`，而不是悄悄换成别的项目。
  const requested = activeKey ?? null;
  let chosen = requested === null ? undefined : ordered.find((p) => p.key === requested);
  let unknownOnly =
    chosen === undefined && requested !== null ? byKey.get(requested) : undefined;
  if (unknownOnly !== undefined && unknownOnly.drafts.length > 0) unknownOnly = undefined;

  if (chosen === undefined && unknownOnly === undefined) chosen = ordered[0];

  let resolvedKey: string | null = null;
  let track: HandoffTrack | null = null;

  if (chosen !== undefined) {
    resolvedKey = chosen.key;
    const sessions = buildSessions(chosen.drafts);
    track = {
      project: { key: chosen.key, name: nameByKey.get(chosen.key) ?? UNNAMED_PROJECT },
      sessions,
      emptyReason:
        sessions.length === 0
          ? "no-sessions"
          : sessions.length === 1
            ? "single-session"
            : null,
      unknownSessions: chosen.unknownSessions
    };
  } else if (unknownOnly !== undefined) {
    resolvedKey = unknownOnly.key;
    track = {
      project: {
        key: unknownOnly.key,
        name: nameByKey.get(unknownOnly.key) ?? UNNAMED_PROJECT
      },
      sessions: [],
      emptyReason: "all-unknown",
      unknownSessions: unknownOnly.unknownSessions
    };
  }

  return {
    window: { startTs, rightTs, days: windowDays },
    projects,
    activeKey: resolvedKey,
    track
  };
}
