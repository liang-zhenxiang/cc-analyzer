import type { ParsedSession, ParsedSessionGraph, SessionRecord } from "./types";
import type { TimeRange } from "./filters";
import {
  computeDurationIntervals,
  recordInterval,
  unionIntervals,
  type DurationBreakdownOptions
} from "./duration";
import { durationBreakdownOptionsFromGraph, MAX_SESSION_GRAPH_DEPTH } from "./sessionGraph";

export type DurationNodeKind =
  | "root"
  | "waitUser"
  | "localTool"
  | "direct"
  | "delegated"
  | "agent"
  | "workflow"
  | "compute";

export type DurationNode = {
  id: string;
  kind: DurationNodeKind;
  label: string;
  durationMs: number;
  wallMs: number;
  span: TimeRange;
  count?: number;
  segments?: TimeRange[];
  record?: SessionRecord;
  childSession?: ParsedSession;
  children?: DurationNode[];
};

const LABEL_LIMIT = 56;

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT)}…` : flat;
}

function sessionLabel(session: ParsedSession): string {
  const shortId = session.sessionId.slice(0, 8);
  return session.isSubagent ? `子会话 ${shortId}` : `会话 ${shortId}`;
}

function recordLabel(record: SessionRecord): string {
  const text = truncate(record.text);
  if (!record.toolName) return text || record.fullId;
  return text ? `${record.toolName} · ${text}` : record.toolName;
}

function agentLabel(record: SessionRecord): string {
  const structured = record.structuredResult;
  const agentId =
    record.childSessionId ??
    (structured?.toolName === "Agent" ? structured.agentId : undefined) ??
    record.childSession?.sessionId;
  const text = truncate(record.text);
  if (agentId && text) return `Agent ${agentId} · ${text}`;
  if (agentId) return `Agent ${agentId}`;
  return recordLabel(record);
}

function workflowLabel(record: SessionRecord): string {
  const run = record.workflowRun;
  return run?.workflowName || run?.runId || recordLabel(record);
}

export function durationWindow(
  session: ParsedSession,
  selection: TimeRange | null
): TimeRange {
  const sessionEnd = Math.max(session.endedAt, session.startedAt);
  if (!selection) return { start: session.startedAt, end: sessionEnd };
  const start = Math.max(session.startedAt, Math.min(selection.start, selection.end));
  const end = Math.min(sessionEnd, Math.max(selection.start, selection.end));
  return { start, end: Math.max(end, start) };
}

export function buildDurationTree(
  session: ParsedSession,
  graph: ParsedSessionGraph | null,
  selection: TimeRange | null
): DurationNode {
  const graphOptions = graph ? durationBreakdownOptionsFromGraph(graph) : {};
  return buildNode(
    session,
    graphOptions,
    durationWindow(session, selection),
    new Set([session.path]),
    0
  );
}

function buildNode(
  session: ParsedSession,
  graphOptions: DurationBreakdownOptions,
  window: TimeRange,
  seen: Set<string>,
  depth: number
): DurationNode {
  const options: DurationBreakdownOptions = {
    isSubagent: session.isSubagent,
    turns: session.turns,
    ...graphOptions
  };
  const wallMs = Math.max(0, window.end - window.start);
  const intervals = computeDurationIntervals(session.records, window.start, window.end, options);
  const byCategory = (category: SessionRecord["toolCategory"]) =>
    session.records.filter((record) => record.toolCategory === category);

  const directRecords = byCategory("direct");
  const delegatedRecords = byCategory("delegated");
  const workflowRecords = byCategory("workflow");
  const waitRecords = byCategory("wait");

  const segmentsOf = (record: SessionRecord): TimeRange[] => {
    const interval = recordInterval(record, options, window);
    return interval ? [interval] : [];
  };
  const leaf = (
    kind: DurationNodeKind,
    id: string,
    label: string,
    record: SessionRecord
  ): DurationNode => {
    const segments = segmentsOf(record);
    return {
      id,
      kind,
      label,
      durationMs: unionIntervals(segments),
      wallMs,
      span: window,
      count: 1,
      segments,
      record
    };
  };
  const descend = (child: ParsedSession): DurationNode | null => {
    if (seen.has(child.path) || depth + 1 > MAX_SESSION_GRAPH_DEPTH) return null;
    return buildNode(
      child,
      graphOptions,
      durationWindow(child, null),
      new Set([...seen, child.path]),
      depth + 1
    );
  };

  const directChildren = directRecords.map((record) =>
    leaf("direct", `direct-${record.fullId}`, recordLabel(record), record)
  );
  const agentChildren = delegatedRecords.map((record) => {
    const child = record.childSession;
    const childTree = child ? descend(child) : null;
    return {
      ...leaf("agent", `agent-${record.fullId}`, agentLabel(record), record),
      childSession: child,
      children: childTree ? [childTree] : undefined
    };
  });
  const workflowChildren = workflowRecords.map((record) => {
    const run = record.workflowRun;
    const children = (record.childSessions ?? [])
      .map((child) => descend(child))
      .filter((node): node is DurationNode => node !== null);
    return {
      ...leaf("workflow", `workflow-${record.fullId}`, workflowLabel(record), record),
      count: run?.agentCount ?? children.length,
      children: children.length > 0 ? children : undefined
    };
  });

  const direct: DurationNode = {
    id: "direct",
    kind: "direct",
    label: "直接工具",
    durationMs: unionIntervals(intervals.direct),
    wallMs,
    span: window,
    count: directRecords.length,
    segments: intervals.direct,
    children: directChildren
  };
  const delegated: DurationNode = {
    id: "delegated",
    kind: "delegated",
    label: "委派 Agent",
    durationMs: unionIntervals(intervals.delegated),
    wallMs,
    span: window,
    count: delegatedRecords.length,
    segments: intervals.delegated,
    children: agentChildren
  };
  const workflow: DurationNode = {
    id: "workflow",
    kind: "workflow",
    label: "workflow",
    durationMs: unionIntervals(intervals.workflow),
    wallMs,
    span: window,
    count: workflowRecords.length,
    segments: intervals.workflow,
    children: workflowChildren
  };
  const waitUser: DurationNode = {
    id: "waitUser",
    kind: "waitUser",
    label: "等用户",
    durationMs: unionIntervals(intervals.waitUser),
    wallMs,
    span: window,
    count: waitRecords.length,
    segments: intervals.waitUser
  };
  const compute: DurationNode = {
    id: "compute",
    kind: "compute",
    label: "LLM 计算",
    durationMs: unionIntervals(intervals.compute),
    wallMs,
    span: window,
    segments: intervals.compute
  };
  const localTool: DurationNode = {
    id: "localTool",
    kind: "localTool",
    label: "本地工具",
    durationMs: unionIntervals(intervals.localTool),
    wallMs,
    span: window,
    segments: intervals.localTool,
    children: [direct, delegated, workflow]
  };

  return {
    id: `root-${session.path}`,
    kind: "root",
    label: sessionLabel(session),
    durationMs: wallMs,
    wallMs,
    span: window,
    segments: [{ start: window.start, end: window.end }],
    childSession: session,
    children: [waitUser, localTool, compute]
  };
}
