import type { SessionMeta } from "../sessions/metadataCache";
import type {
  CompactEvent,
  SessionRecord,
  SessionUsage
} from "../sessions/types";
import {
  dayStartOf,
  totalsSum,
  type UsageSessionInput
} from "../usage/usageAggregations";
import { sessionKeyOf } from "../usage/usageCalendar";
import {
  fallbackSessionTitle,
  recentRate,
  type SessionRow
} from "./pulseModel";

/**
 * 监控台的纯逻辑层（Issue #225 / design.md §3）。
 *
 * 这里不读时钟、不碰文件系统：调用方传进来的 `now` 就是唯一的时间事实。
 * 监控台只回答「今天」，所以 token 与压缩都裁在本地自然日的 `[todayStart, now]`
 * 内；项目速率则直接复用脉搏的 `recentRate`，与其它视图保持同一单位与窗口口径。
 */

export type ConsoleProject = {
  projectLabel: string;
  projectPath?: string;
  /** 近 15 分钟实测 token/小时（与 recentRate 同单位）。 */
  ratePerHour: number;
  /** 本地自然日的四类 token 之和。 */
  todayTokens: number;
  /** 这 5 小时窗口内有新记录的会话数。 */
  activeSessions: number;
};

export type ConsoleHour = {
  hourStart: number;
  tokens: number;
  /**
   * `true` 只给**当前这一小时**：它还没走完，柱高是实测值、不是整小时的量。
   *
   * `phase` 再分三档，是为了不让**还没发生的小时**被画成 0——那会把
   * 「尚未发生」说成「没有发生」，是这一页最容易撒的一次谎。
   */
  partial: boolean;
  phase: "past" | "current" | "future";
};

export type ConsoleEventKind = "compaction" | "error" | "session";

export type ConsoleEvent = {
  id: string;
  kind: ConsoleEventKind;
  at: number;
  projectLabel: string;
  projectPath?: string;
  sessionPath: string;
  sessionTitle: string;
  /** 压缩：auto / manual；错误：工具名；会话：空串。 */
  detail: string;
  /** 压缩 preTokens；错误为 null；会话为 null。 */
  preTokens: number | null;
  /** 错误预览（≤80 字符，脱敏）；其它为空串。 */
  preview: string;
};

export type ConsoleReport = {
  now: number;
  todayTokens: number;
  todayCompactions: number;
  projects: ConsoleProject[];
  hourly: ConsoleHour[];
  events: ConsoleEvent[];
};

export const CONSOLE_RATE_WINDOW_MS = 15 * 60_000;
export const CONSOLE_EVENT_LIMIT = 12;
export const CONSOLE_PREVIEW_LIMIT = 80;

type MergedInput = {
  key: string;
  projectLabel: string;
  projectPath?: string;
  session?: SessionMeta;
  records: SessionRecord[];
  compactEvents: CompactEvent[];
};

type ProjectTally = {
  projectLabel: string;
  projectPath?: string;
  todayTokens: number;
  rateRecords: SessionRecord[];
};

type ConsoleFacts = {
  todayTokens: number;
  todayCompactions: number;
  projects: ConsoleProject[];
  hourly: ConsoleHour[];
  events: ConsoleEvent[];
};

/** 本地自然日的 24 个整点桶；当前这一小时标 partial，未来小时标 phase=future。 */
export function hourBucketsOf(
  records: readonly SessionRecord[],
  now: number
): ConsoleHour[] {
  const buckets = emptyHourBuckets(now);
  if (buckets.length === 0) return buckets;

  const todayStart = dayStartOf(now);
  for (const record of listOf(records)) {
    if (!record.usage) continue;
    const timestamp = record.timestamp;
    if (!Number.isFinite(timestamp) || timestamp < todayStart || timestamp > now) continue;
    const tokens = tokensOfUsage(record.usage);
    if (tokens === null) continue;
    const hour = new Date(timestamp).getHours();
    const bucket = buckets[hour];
    if (bucket) bucket.tokens += tokens;
  }

  return buckets;
}

/**
 * 按项目聚合今天 token、近 15 分钟速率与活跃会话数。
 *
 * 同一条 `SessionMeta.path` 出现在多份输入里时按 `sessionKeyOf` 合并；
 * 这与里程碑、计费归因的会话身份键一致，也避免项目轮播出现两条同一会话。
 */
export function projectStatsOf(
  inputs: readonly UsageSessionInput[],
  activeRows: readonly SessionRow[],
  now: number
): ConsoleProject[] {
  return consoleFactsOf(inputs, activeRows, now).projects;
}

/**
 * 最近事件：压缩、错误、会话开始三类，跨会话按时间倒序。
 *
 * `rows` 与展示层的行序保持同一调用形状；事件标题与路径始终从对应的
 * `UsageSessionInput` 取，不从活跃行反推。
 */
export function eventsOf(
  inputs: readonly UsageSessionInput[],
  _activeRows: readonly SessionRow[],
  now: number,
  limit: number = CONSOLE_EVENT_LIMIT
): ConsoleEvent[] {
  const events = consoleFactsOf(inputs, [], now).events;
  return events.slice(0, normalizeLimit(limit));
}

/** 一次会话扫描组装监控台的全部事实。 */
export function consoleModelOf(
  inputs: readonly UsageSessionInput[],
  activeRows: readonly SessionRow[],
  now: number
): ConsoleReport {
  const facts = consoleFactsOf(inputs, activeRows, now);
  return {
    now,
    todayTokens: facts.todayTokens,
    todayCompactions: facts.todayCompactions,
    projects: facts.projects,
    hourly: facts.hourly,
    events: facts.events.slice(0, CONSOLE_EVENT_LIMIT)
  };
}

function consoleFactsOf(
  inputs: readonly UsageSessionInput[],
  activeRows: readonly SessionRow[],
  now: number
): ConsoleFacts {
  const hourly = emptyHourBuckets(now);
  if (hourly.length === 0) {
    return {
      todayTokens: 0,
      todayCompactions: 0,
      projects: [],
      hourly,
      events: []
    };
  }

  const todayStart = dayStartOf(now);
  const windowStart = now - CONSOLE_RATE_WINDOW_MS;
  const sessions = mergeInputs(inputs);
  const projectTallies = new Map<string, ProjectTally>();
  const eventCandidates: ConsoleEvent[] = [];
  const seenEvents = new Set<string>();
  let todayTokens = 0;
  let todayCompactions = 0;

  for (const source of sessions) {
    const tally = projectTallyOf(projectTallies, source);
    let firstRecord: SessionRecord | null = null;

    for (const record of source.records) {
      const timestamp = record.timestamp;
      if (!Number.isFinite(timestamp) || timestamp > now) continue;

      if (firstRecord === null || timestamp < firstRecord.timestamp) {
        firstRecord = record;
      }

      if (record.isError) {
        const id = eventId("error", source.key, recordIdOf(record));
        if (!seenEvents.has(id)) {
          seenEvents.add(id);
          eventCandidates.push({
            id,
            kind: "error",
            at: timestamp,
            projectLabel: source.projectLabel,
            projectPath: source.projectPath,
            sessionPath: source.session?.path ?? "",
            sessionTitle: sessionTitleOf(source),
            detail: record.toolName ?? "未知工具",
            preTokens: null,
            preview: previewOf(previewTextOf(record))
          });
        }
      }

      const tokens = tokensOfUsage(record.usage);
      if (tokens === null || timestamp < todayStart) continue;

      todayTokens += tokens;
      tally.todayTokens += tokens;
      const hour = new Date(timestamp).getHours();
      const bucket = hourly[hour];
      if (bucket) bucket.tokens += tokens;
      if (timestamp >= windowStart) tally.rateRecords.push(record);
    }

    if (firstRecord) {
      const id = eventId("session", source.key, recordIdOf(firstRecord));
      if (!seenEvents.has(id)) {
        seenEvents.add(id);
        eventCandidates.push({
          id,
          kind: "session",
          at: firstRecord.timestamp,
          projectLabel: source.projectLabel,
          projectPath: source.projectPath,
          sessionPath: source.session?.path ?? "",
          sessionTitle: sessionTitleOf(source),
          detail: "",
          preTokens: null,
          preview: ""
        });
      }
    }

    for (const event of source.compactEvents) {
      const timestamp = event.timestamp;
      if (!Number.isFinite(timestamp) || timestamp > now) continue;
      const id = eventId("compaction", source.key, event.id);
      if (seenEvents.has(id)) continue;
      seenEvents.add(id);
      if (timestamp >= todayStart) todayCompactions += 1;
      eventCandidates.push({
        id,
        kind: "compaction",
        at: timestamp,
        projectLabel: source.projectLabel,
        projectPath: source.projectPath,
        sessionPath: source.session?.path ?? "",
        sessionTitle: sessionTitleOf(source),
        detail: event.trigger ?? "",
        preTokens:
          event.preTokens !== null && Number.isFinite(event.preTokens)
            ? event.preTokens
            : null,
        preview: ""
      });
    }
  }

  const activeCounts = activeSessionCounts(activeRows);
  const projects: ConsoleProject[] = [];
  for (const tally of projectTallies.values()) {
    const ratePerHour = recentRate(tally.rateRecords, now, CONSOLE_RATE_WINDOW_MS);
    if (tally.todayTokens === 0 && ratePerHour === 0) continue;
    projects.push({
      projectLabel: tally.projectLabel,
      projectPath: tally.projectPath,
      todayTokens: tally.todayTokens,
      ratePerHour,
      activeSessions: activeCounts.get(tally.projectLabel) ?? 0
    });
  }
  projects.sort(
    (a, b) =>
      b.ratePerHour - a.ratePerHour ||
      compareText(a.projectLabel, b.projectLabel)
  );

  eventCandidates.sort(
    (a, b) => b.at - a.at || compareText(a.id, b.id)
  );

  return {
    todayTokens,
    todayCompactions,
    projects,
    hourly,
    events: eventCandidates
  };
}

function mergeInputs(inputs: readonly UsageSessionInput[]): MergedInput[] {
  const merged = new Map<string, MergedInput>();

  listOf(inputs).forEach((source, index) => {
    const key = sessionKeyOf(source, index);
    let target = merged.get(key);
    if (!target) {
      target = {
        key,
        projectLabel: source.projectLabel,
        projectPath: source.projectPath ?? source.session?.cwd,
        session: source.session,
        records: [],
        compactEvents: []
      };
      merged.set(key, target);
    } else {
      if (!target.projectPath) {
        target.projectPath = source.projectPath ?? source.session?.cwd;
      }
      if (!target.session && source.session) target.session = source.session;
    }

    appendAll(target.records, source.records);
    appendAll(target.compactEvents, source.compactEvents ?? []);
  });

  return [...merged.values()];
}

function projectTallyOf(
  tallies: Map<string, ProjectTally>,
  source: MergedInput
): ProjectTally {
  let tally = tallies.get(source.projectLabel);
  if (!tally) {
    tally = {
      projectLabel: source.projectLabel,
      projectPath: source.projectPath,
      todayTokens: 0,
      rateRecords: []
    };
    tallies.set(source.projectLabel, tally);
  } else if (!tally.projectPath && source.projectPath) {
    tally.projectPath = source.projectPath;
  }
  return tally;
}

function emptyHourBuckets(now: number): ConsoleHour[] {
  if (!Number.isFinite(now)) return [];
  const date = new Date(now);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  const currentHour = date.getHours();

  return Array.from({ length: 24 }, (_, hour) => ({
    hourStart: new Date(year, month, day, hour).getTime(),
    tokens: 0,
    // 还没到的小时不参与绘制：它们不是「0 token」，是「尚未发生」。
    partial: hour === currentHour,
    phase: hour < currentHour ? "past" : hour === currentHour ? "current" : "future"
  }));
}

/**
 * 四类 token 之和。缺字段是 0；任一字段出现非有限值则整条记录的 token
 * 贡献作废——这条记录不能以「部分 0」的身份伪装成一个可核对的数。
 */
function tokensOfUsage(usage: SessionUsage | undefined): number | null {
  if (!usage) return null;
  const values = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheCreationTokens,
    usage.cacheReadTokens
  ];
  for (const value of values) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
  }

  return totalsSum({
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  });
}

function activeSessionCounts(rows: readonly SessionRow[]): Map<string, number> {
  const pathsByProject = new Map<string, Set<string>>();
  listOf(rows).forEach((row, index) => {
    let paths = pathsByProject.get(row.projectLabel);
    if (!paths) {
      paths = new Set();
      pathsByProject.set(row.projectLabel, paths);
    }
    paths.add(row.path || `anonymous:${index}`);
  });

  const counts = new Map<string, number>();
  for (const [projectLabel, paths] of pathsByProject) {
    counts.set(projectLabel, paths.size);
  }
  return counts;
}

function sessionTitleOf(source: MergedInput): string {
  return source.session
    ? fallbackSessionTitle(source.session)
    : source.projectLabel;
}

function recordIdOf(record: SessionRecord): string {
  return record.fullId || record.id || String(record.lineNumber ?? record.timestamp);
}

function eventId(kind: ConsoleEventKind, sessionKey: string, id: string): string {
  return `${kind}:${sessionKey}:${id}`;
}

/**
 * 错误预览的隐私边界：先取首行、折叠空白，再抹掉绝对路径，最后截断到
 * 80 个字符。宁可少显示，也不让本机用户名或目录进入页面源码。
 */
/**
 * 错误的预览文本。
 *
 * **工具错误与 API 错误的正文不在同一个字段**：解析器把 `tool_result` 的正文放进
 * `toolResult`（`parseJsonl.ts` 的 `pending.toolResult`），只有 API 错误才落在
 * `text`。只看 `text` 会让「Bash 报错」这类最常见的工具错误预览恒为空——
 * 卡片上只剩一个工具名，读者无从判断是什么错。
 *
 * 顺序是先 `text` 后 `toolResult`：`text` 是错误本身的说明，`toolResult` 是原始输出，
 * 前者更贴近「错误是什么」。
 */
function previewTextOf(record: SessionRecord): string {
  const candidate = record.text?.trim() ? record.text : (record.toolResult ?? "");
  return candidate;
}

function previewOf(text: string): string {
  const firstLine = text.split(/\r?\n|\r/, 1)[0] ?? "";
  const compact = firstLine.replace(/\s+/g, " ").trim();
  // 按**码点**截断，不是按 UTF-16 码元：`slice(0, 80)` 会把一个 emoji 劈成两半，
  // 留下一个孤立代理项，渲染出来是替换字符。`Array.from` 按码点切分。
  return Array.from(redactAbsolutePaths(compact))
    .slice(0, CONSOLE_PREVIEW_LIMIT)
    .join("");
}

function redactAbsolutePaths(text: string): string {
  return text.replace(
    /[A-Za-z]:[\\/][^\s"'`<>|?]*|\\\\[^\s"'`<>|?]+|\/(?:[^/\s"'`<>|?]+\/)+[^\s"'`<>|?]*/g,
    "…"
  );
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return CONSOLE_EVENT_LIMIT;
  return Math.max(0, Math.floor(limit));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function appendAll<T>(target: T[], source: readonly T[]): void {
  for (const item of source) target.push(item);
}

function listOf<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}
