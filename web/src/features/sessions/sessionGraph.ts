import { parseJsonlText } from "./parseJsonl";
import type { Bridges, DirEntry } from "../../api/types";
import type { ParsedSession, ParsedSessionGraph, SessionRecord, WorkflowRun } from "./types";
import { safeStringify } from "../../lib/json";
import {
  isPathInsideAny,
  joinPath,
  parentDirectory,
  sessionDirectory
} from "../../lib/path";
import type { SessionParseCache } from "./sessionParseCache";
import type { TimeRange } from "./filters";
import type { DurationBreakdownOptions } from "./duration";

export const MAX_SESSION_GRAPH_DEPTH = 4;

const WORKFLOW_RESULT_LIMIT = 4000;
const AGENT_FILE_PATTERN = /^agent-(.+)\.jsonl$/;
const AGENT_ID_IN_RESULT = /agentId:\s*([\w-]+)/;
const WORKFLOW_RUN_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === "string" ? value[key] : "";
}

function optionalNumber(value: Record<string, unknown>, key: string): number | null {
  return typeof value[key] === "number" && Number.isFinite(value[key])
    ? value[key]
    : null;
}

// runId 直接参与文件路径拼接，只接受不含路径分隔符或 `..` 的裸标识符。
function isSafeRunId(runId: string): boolean {
  return (
    WORKFLOW_RUN_ID_PATTERN.test(runId) &&
    runId !== "." &&
    runId !== ".." &&
    !runId.includes("..")
  );
}

export function durationBreakdownOptionsFromGraph(
  graph: ParsedSessionGraph
): DurationBreakdownOptions {
  const childSessionIntervals: Record<string, TimeRange> = {};
  const workflowIntervals: Record<string, TimeRange> = {};

  for (const session of graph.sessions) {
    for (const record of session.records) {
      if (record.childSession) {
        const interval: TimeRange = {
          start: record.childSession.startedAt,
          end: record.childSession.endedAt
        };

        if (
          Number.isFinite(interval.start) &&
          Number.isFinite(interval.end) &&
          interval.end > interval.start
        ) {
          const keys = [
            record.childSessionPath,
            record.childSessionId,
            record.fullId
          ];
          for (const key of keys) {
            if (key) childSessionIntervals[key] = interval;
          }
        }
      }

      const workflow = record.workflowRun;
      if (workflow && typeof workflow.startTs === "number" && workflow.durationMs > 0) {
        const interval: TimeRange = {
          start: workflow.startTs,
          end: workflow.startTs + workflow.durationMs
        };

        if (
          Number.isFinite(interval.start) &&
          Number.isFinite(interval.end) &&
          interval.end > interval.start
        ) {
          const keys = [workflow.runId, record.fullId];
          for (const key of keys) {
            if (key) workflowIntervals[key] = interval;
          }
        }
      }
    }
  }

  return { childSessionIntervals, workflowIntervals };
}

function workflowResultText(value: unknown): { text: string; truncated: boolean } {
  let text: string;
  if (value === null || value === undefined) {
    text = "";
  } else if (typeof value === "string") {
    text = value;
  } else {
    text = safeStringify(value, 2);
  }

  if (text.length <= WORKFLOW_RESULT_LIMIT) {
    return { text, truncated: false };
  }

  return {
    text: `${text.slice(0, WORKFLOW_RESULT_LIMIT)}\n…（已截断，原始 ${text.length} 字符）`,
    truncated: true
  };
}

export function parseWorkflowRun(runId: string, text: string): WorkflowRun | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;

  const phases = Array.isArray(value.phases)
    ? value.phases
        .map((phase) => (isRecord(phase) ? optionalString(phase, "title") : ""))
        .filter(Boolean)
    : [];
  const logs = Array.isArray(value.logs)
    ? value.logs.filter((item): item is string => typeof item === "string")
    : [];
  const result = workflowResultText(value.result);

  return {
    runId,
    workflowName: optionalString(value, "workflowName"),
    summary: optionalString(value, "summary"),
    status: optionalString(value, "status"),
    startTs: optionalNumber(value, "startTime"),
    durationMs: optionalNumber(value, "durationMs") ?? 0,
    agentCount: optionalNumber(value, "agentCount") ?? 0,
    totalTokens: optionalNumber(value, "totalTokens"),
    totalToolCalls: optionalNumber(value, "totalToolCalls"),
    phases,
    resultText: result.text,
    resultTruncated: result.truncated,
    logs
  };
}

type ResolverState = {
  sessions: ParsedSession[];
  agentPaths: Record<string, string>;
  agentSessions: Record<string, ParsedSession>;
  workflowRuns: Record<string, WorkflowRun>;
  workflowRunDirs: Record<string, string>;
  unresolvedAgentToolIds: string[];
  unresolvedWorkflowToolIds: string[];
  depthTruncatedPaths: string[];
  cyclePaths: string[];
  warnings: string[];
  cache: Map<string, ParsedSession>;
  childCache: SessionParseCache | undefined;
  roots: string[];
  active: Set<string>;
};

function createResolverState(roots: string[], childCache?: SessionParseCache): ResolverState {
  return {
    sessions: [],
    agentPaths: {},
    agentSessions: {},
    workflowRuns: {},
    workflowRunDirs: {},
    unresolvedAgentToolIds: [],
    unresolvedWorkflowToolIds: [],
    depthTruncatedPaths: [],
    cyclePaths: [],
    warnings: [],
    cache: new Map(),
    childCache,
    roots,
    active: new Set()
  };
}

/**
 * Where a session's subagents may live. Claude Code uses the session directory
 * (`<project>/<sessionId>/subagents`), while some exports keep them next to the
 * session file, so both are scanned in that order.
 */
function sessionRoots(path: string): string[] {
  const roots: string[] = [];
  const own = sessionDirectory(path);
  const parent = parentDirectory(path);
  if (own) roots.push(own);
  if (parent && parent !== own) roots.push(parent);
  return roots;
}

async function indexAgentDirectory(
  directory: string,
  state: ResolverState,
  bridges: Bridges
): Promise<void> {
  let entries;
  try {
    entries = await bridges.fs.readDir(directory);
  } catch {
    return;
  }

  for (const item of entries) {
    if (!item.is_file) continue;
    const match = AGENT_FILE_PATTERN.exec(item.name);
    if (!match) continue;
    const agentId = match[1];
    const path = joinPath(directory, item.name);
    if (!state.agentPaths[agentId]) state.agentPaths[agentId] = path;
  }
}

async function indexSessionAgents(
  sessionDir: string,
  state: ResolverState,
  bridges: Bridges
): Promise<void> {
  // 只在根会话目录建立一次索引；递归发现的子会话按各自路径解析，
  // 不在此处展开，避免重复扫描和无界目录遍历。
  await indexAgentDirectory(joinPath(sessionDir, "subagents"), state, bridges);
  await indexAgentDirectory(joinPath(sessionDir, "subagents", "agents"), state, bridges);
  await indexAgentDirectory(joinPath(sessionDir, "agents"), state, bridges);

  const workflowsRoot = joinPath(sessionDir, "subagents", "workflows");
  let runDirectories;
  try {
    runDirectories = await bridges.fs.readDir(workflowsRoot);
  } catch {
    return;
  }

  for (const item of runDirectories) {
    if (item.is_dir) {
      await indexAgentDirectory(joinPath(workflowsRoot, item.name), state, bridges);
    }
  }
}

function agentIdForRecord(record: SessionRecord): string | null {
  const structured = record.structuredResult;
  if (structured?.toolName === "Agent" && structured.agentId) return structured.agentId;
  if (record.childSessionId) return record.childSessionId;
  const match = AGENT_ID_IN_RESULT.exec(record.toolResult ?? "");
  return match?.[1] ?? null;
}

async function readChildSession(
  path: string,
  bridges: Bridges,
  childCache?: SessionParseCache
): Promise<ParsedSession | null> {
  try {
    const stat = await bridges.fs.stat(path);
    const cached = childCache?.get(path);
    if (cached && cached.mtimeMs === stat.mtime_ms && cached.sizeBytes === stat.size) {
      return cached.session;
    }
    const text = await bridges.fs.readText(path);
    const parsed = parseJsonlText(text, path, { isSubagent: true });
    if (parsed.records.length === 0 && parsed.warnings.length > 0) return null;
    childCache?.set(path, {
      mtimeMs: stat.mtime_ms,
      sizeBytes: stat.size,
      session: parsed
    });
    return parsed;
  } catch {
    return null;
  }
}

async function resolveSession(
  session: ParsedSession,
  state: ResolverState,
  depth: number,
  bridges: Bridges
): Promise<ParsedSession> {
  const cached = state.cache.get(session.path);
  if (cached) return cached;
  state.active.add(session.path);

  const updates = new Map<SessionRecord, Partial<SessionRecord>>();
  for (const record of session.records) {
    if (record.toolCategory === "delegated") {
      await resolveAgentRecord(record, state, depth, bridges, updates);
      const assistantRecord = session.records.find(
        (item) =>
          item !== record &&
          item.fullId === record.fullId &&
          item.contentBlocks?.some((block) => block.id === record.fullId)
      );
      const update = updates.get(record);
      if (assistantRecord && update?.childSession) {
        updates.set(assistantRecord, update);
      }
      continue;
    }

    if (record.toolCategory === "workflow") {
      await resolveWorkflowRecord(record, state, depth, bridges, updates);
      const assistantRecord = session.records.find(
        (item) =>
          item !== record &&
          item.fullId === record.fullId &&
          item.contentBlocks?.some((block) => block.id === record.fullId)
      );
      const update = updates.get(record);
      if (assistantRecord && update?.workflowRun) {
        updates.set(assistantRecord, update);
      }
      continue;
    }
  }

  const enrichRecord = (record: SessionRecord) =>
    updates.has(record) ? { ...record, ...updates.get(record) } : record;
  const records = session.records.map(enrichRecord);
  const turns = session.turns.map((turn) => ({
    ...turn,
    records: turn.records.map(enrichRecord)
  }));
  const unmatchedToolUses = session.unmatchedToolUses.map(enrichRecord);
  const resolved = {
    ...session,
    records,
    turns,
    unmatchedToolUses
  };
  state.cache.set(session.path, resolved);
  state.active.delete(session.path);
  state.sessions.push(resolved);
  return resolved;
}

async function resolveAgentRecord(
  record: SessionRecord,
  state: ResolverState,
  depth: number,
  bridges: Bridges,
  updates: Map<SessionRecord, Partial<SessionRecord>>
): Promise<void> {
  const agentId = agentIdForRecord(record);
  // `childSessionPath` comes from the session file, so it is only trusted when
  // it points inside the session tree the resolver was started from.
  const candidates: string[] = [];
  for (const path of new Set(
    [record.childSessionPath, agentId ? state.agentPaths[agentId] : undefined].filter(
      (candidate): candidate is string => Boolean(candidate)
    )
  )) {
    if (isPathInsideAny(path, state.roots)) {
      candidates.push(path);
      continue;
    }
    state.warnings.push(`已忽略越界的子会话路径：${path}`);
  }
  if (candidates.length === 0) {
    state.unresolvedAgentToolIds.push(record.fullId);
    state.warnings.push(`未找到 Agent 子会话：${record.fullId}`);
    return;
  }

  for (const path of candidates) {
    if (depth + 1 > MAX_SESSION_GRAPH_DEPTH) {
      state.depthTruncatedPaths.push(path);
      state.warnings.push(`已达会话图最大深度 ${MAX_SESSION_GRAPH_DEPTH}：${path}`);
      continue;
    }

    const cachedChild = state.cache.get(path);
    if (cachedChild) {
      const key = agentId ?? path;
      state.agentSessions[key] = cachedChild;
      updates.set(record, { childSession: cachedChild });
      return;
    }

    if (state.active.has(path)) {
      state.cyclePaths.push(path);
      state.warnings.push(`检测到会话图循环引用：${path}`);
      continue;
    }

    const child = await readChildSession(path, bridges, state.childCache);
    if (!child) {
      state.unresolvedAgentToolIds.push(record.fullId);
      state.warnings.push(`Agent 子会话读取失败：${path}`);
      continue;
    }

    const resolvedChild = await resolveSession(child, state, depth + 1, bridges);
    const key = agentId ?? path;
    state.agentSessions[key] = resolvedChild;
    updates.set(record, { childSession: resolvedChild });
    return;
  }
}

async function resolveWorkflowRecord(
  record: SessionRecord,
  state: ResolverState,
  depth: number,
  bridges: Bridges,
  updates: Map<SessionRecord, Partial<SessionRecord>>
): Promise<void> {
  const structured = record.structuredResult?.toolName === "Workflow"
    ? record.structuredResult
    : null;
  const runId = structured?.runId;
  if (state.roots.length === 0 || !runId) {
    state.unresolvedWorkflowToolIds.push(record.fullId);
    state.warnings.push(`Workflow 缺少 runId：${record.fullId}`);
    return;
  }
  if (!isSafeRunId(runId)) {
    state.unresolvedWorkflowToolIds.push(record.fullId);
    state.warnings.push(`Workflow runId 非法，已跳过：${record.fullId}`);
    return;
  }

  let run: WorkflowRun | null = state.workflowRuns[runId] ?? null;
  let workflowPath = joinPath(state.roots[0], "subagents", "workflows", `${runId}.json`);
  if (!run) {
    for (const root of state.roots) {
      const candidate = joinPath(root, "subagents", "workflows", `${runId}.json`);
      try {
        run = parseWorkflowRun(runId, await bridges.fs.readText(candidate));
        workflowPath = candidate;
        break;
      } catch {
        run = null;
      }
    }
  }

  if (!run) {
    state.unresolvedWorkflowToolIds.push(record.fullId);
    state.warnings.push(`Workflow 运行记录读取失败：${workflowPath}`);
    return;
  }

  state.workflowRuns[runId] = run;
  // `<root>/subagents/workflows/<runId>.json` keeps its children in the
  // directory of the same name next to the JSON file.
  const localChildrenDirectory = workflowPath.replace(/\.json$/i, "");
  state.workflowRunDirs[runId] ??= localChildrenDirectory;
  const childrenDirectory = state.workflowRunDirs[runId];
  const childSessions: ParsedSession[] = [];
  let entries: DirEntry[];
  try {
    entries = await bridges.fs.readDir(childrenDirectory);
  } catch {
    entries = [];
  }

  for (const item of entries.filter((entry) => entry.is_file && AGENT_FILE_PATTERN.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = joinPath(childrenDirectory, item.name);
    if (depth + 1 > MAX_SESSION_GRAPH_DEPTH) {
      state.depthTruncatedPaths.push(path);
      state.warnings.push(`已达会话图最大深度 ${MAX_SESSION_GRAPH_DEPTH}：${path}`);
      continue;
    }

    if (state.active.has(path)) {
      state.cyclePaths.push(path);
      state.warnings.push(`检测到会话图循环引用：${path}`);
      continue;
    }

    const child = await readChildSession(path, bridges, state.childCache);
    if (!child) {
      state.warnings.push(`Workflow 子会话读取失败：${path}`);
      continue;
    }

    childSessions.push(await resolveSession(child, state, depth + 1, bridges));
  }

  updates.set(record, { workflowRun: run, childSessions });
}

export async function resolveSessionGraph(
  session: ParsedSession,
  bridges: Bridges,
  options: { childCache?: SessionParseCache } = {}
): Promise<ParsedSessionGraph> {
  const state = createResolverState(sessionRoots(session.path), options.childCache);
  for (const root of state.roots) {
    await indexSessionAgents(root, state, bridges);
  }
  state.active.add(session.path);
  const root = await resolveSession(session, state, 0, bridges);
  state.active.delete(session.path);

  return {
    root,
    sessions: state.sessions,
    agentPaths: state.agentPaths,
    agentSessions: state.agentSessions,
    workflowRuns: state.workflowRuns,
    unresolvedAgentToolIds: state.unresolvedAgentToolIds,
    unresolvedWorkflowToolIds: state.unresolvedWorkflowToolIds,
    depthTruncatedPaths: state.depthTruncatedPaths,
    cyclePaths: state.cyclePaths,
    warnings: state.warnings
  };
}
