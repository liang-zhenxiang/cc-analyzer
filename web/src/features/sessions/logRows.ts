import type { SessionRecord, Turn } from "./types";
import type { RecordFilter } from "./filters";

export type LogRowKind = "user" | "llm" | "tool" | "subagent" | "workflow" | "wait";
export type LogRowStatus = "ok" | "error" | "na";
/**
 * Row-level token counts. `prompt` is **every** token the model received as
 * input — `input_tokens` plus cache writes plus cache reads — which is what the
 * row's cost-bearing size is. It is not `input_tokens`, and calling it "输入"
 * was wrong: on a cached session the reads dominate it several-fold, so the
 * field and every label it reaches must say what it holds.
 *
 * The four counters are kept apart in `tokenTotals.ts`; this two-number shape
 * only survives because the log table has one narrow column.
 */
export type LogTokens = { prompt: number; output: number };

export type LogRow = {
  id: string;
  kind: LogRowKind;
  label: string;
  action: string;
  summary: string;
  timestamp: number;
  durationMs: number;
  status: LogRowStatus;
  tokens: LogTokens | null;
  mergedWith: "user" | "tool" | null;
  /** Turn index the row belongs to. */
  turn: number | null;
  /** Set on model rows: ids of the tool calls this response started. */
  invokedTools: string[];
  /** Present on synthesised inter-turn wait rows, which carry no record. */
  gap?: { start: number; end: number };
  records: SessionRecord[];
};

const KIND_LABELS: Record<LogRowKind, string> = {
  user: "用户",
  llm: "LLM",
  tool: "工具",
  subagent: "子 agent",
  workflow: "workflow",
  wait: "等用户"
};

const SUMMARY_LIMIT = 72;

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT)}…` : flat;
}

function rowKind(record: SessionRecord): LogRowKind {
  if (record.kind === "user") return "user";
  if (record.kind === "assistant") return "llm";
  if (record.toolCategory === "delegated") return "subagent";
  if (record.toolCategory === "workflow") return "workflow";
  if (record.toolCategory === "wait") return "wait";
  return "tool";
}

export function tokensOf(record: SessionRecord): LogTokens | null {
  const usage = record.usage;
  if (!usage) return null;
  const prompt =
    (usage.inputTokens ?? 0) + (usage.cacheCreationTokens ?? 0) + (usage.cacheReadTokens ?? 0);
  const output = usage.outputTokens ?? 0;
  return prompt + output > 0 ? { prompt, output } : null;
}

function statusOf(record: SessionRecord, kind: LogRowKind): LogRowStatus {
  if (record.isError) return "error";
  if (kind === "user") return "na";
  if (record.isSynthetic) return "na";
  return "ok";
}

function firstLine(text: string | undefined): string {
  if (!text) return "";
  return truncate(text.split("\n").find((line) => line.trim().length > 0) ?? text);
}

function toolAction(record: SessionRecord): string {
  const name = record.toolName ?? "工具";
  const structured = record.structuredResult;
  if (structured?.toolName === "Agent" && structured.agentType) {
    return `${name} · ${structured.agentType}`;
  }
  if (record.workflowRun?.workflowName) return `${name} · ${record.workflowRun.workflowName}`;
  if (structured?.toolName === "Workflow" && structured.workflowName) {
    return `${name} · ${structured.workflowName}`;
  }
  return name;
}

function toolSummary(record: SessionRecord): string {
  const structured = record.structuredResult;
  if (structured) {
    switch (structured.toolName) {
      case "Read":
      case "Write":
      case "Edit":
        return truncate(structured.filePath);
      case "Bash":
        return firstLine(structured.stdout) || firstLine(structured.stderr);
      case "Grep":
      case "Glob":
        return `${structured.numFiles} 个文件`;
      case "Agent":
        return truncate(structured.description || structured.agentId);
      case "Workflow":
        return truncate(structured.workflowName || structured.runId);
      default:
        break;
    }
  }
  const input = record.toolInput;
  if (input && typeof input === "object") {
    const value = input as Record<string, unknown>;
    const hint = value.command ?? value.file_path ?? value.pattern;
    if (typeof hint === "string" && hint.length > 0) return truncate(hint);
  }
  return firstLine(record.toolResult) || (record.unmatched ? "未匹配到 tool_result" : "");
}

function llmSummary(record: SessionRecord): string {
  const text = record.text.trim() || firstLine(record.toolResult);
  if (record.isError && record.apiError) {
    const kind = record.apiError.kind ?? "错误";
    const status = record.apiError.status == null ? "" : ` ${record.apiError.status}`;
    return truncate(`模型错误 (${kind}${status})${text ? ` · ${text}` : ""}`);
  }
  return text ? truncate(text) : "（无文本输出）";
}

function toRow(record: SessionRecord): LogRow {
  const kind = rowKind(record);
  const action =
    kind === "user"
      ? record.commandName ?? (record.isInterrupt ? "用户打断" : "提问")
      : kind === "llm"
        ? record.model ?? "—"
        : toolAction(record);
  const summary =
    kind === "user"
      ? truncate(record.text)
      : kind === "llm"
        ? llmSummary(record)
        : toolSummary(record);

  return {
    id: record.fullId,
    kind,
    label: KIND_LABELS[kind],
    action,
    summary,
    timestamp: record.timestamp,
    durationMs: record.durationMs,
    status: statusOf(record, kind),
    tokens: tokensOf(record),
    mergedWith: null,
    turn: null,
    invokedTools:
      record.kind === "assistant"
        ? (record.contentBlocks ?? [])
            .filter((block) => block.type === "tool_use" && typeof block.id === "string")
            .map((block) => block.id as string)
        : [],
    records: [record]
  };
}

function mergeUserAndLlm(user: LogRow, llm: LogRow): LogRow {
  return {
    ...llm,
    id: `turn-${user.id}`,
    label: "用户+LLM",
    action: `${user.action} + ${llm.action}`,
    summary: [user.summary, llm.summary].filter(Boolean).join(" · "),
    // The row sits at the model response timestamp; its duration spans back to
    // the prompt, which is also what the waterfall bar draws.
    durationMs: Math.max(0, llm.timestamp - user.timestamp),
    mergedWith: "user",
    records: [...user.records, ...llm.records]
  };
}

/**
 * Model rows show the time since the previous activity ended (the response's
 * "thinking" attribution), which also fixes the span of a merged LLM+工具 row.
 */
function applyActivityDurations(rows: LogRow[], turns: Turn[], sessionStart: number): void {
  const userTsOfTurn = new Map<number, number>();
  for (const turn of turns) {
    const userRecord = turn.records.find((record) => record.kind === "user");
    if (userRecord) userTsOfTurn.set(turn.index, userRecord.timestamp);
  }

  let cursor = sessionStart;
  let seenModel = false;
  for (const row of rows) {
    if (row.kind === "llm") {
      if (!seenModel && row.turn !== null) {
        const userTs = userTsOfTurn.get(row.turn);
        if (userTs != null) cursor = Math.max(cursor, userTs);
      }
      seenModel = true;
      row.durationMs = Math.max(0, row.timestamp - cursor);
      cursor = Math.max(cursor, row.timestamp);
      continue;
    }
    if (row.kind === "wait" && row.durationMs > 0) {
      const end = row.timestamp + row.durationMs;
      const start = Math.max(row.timestamp, cursor);
      row.durationMs = Math.max(0, end - start);
      row.timestamp = start;
      cursor = Math.max(cursor, end);
      continue;
    }
    if (row.durationMs > 0) cursor = Math.max(cursor, row.timestamp + row.durationMs);
  }
}

function mergeLlmAndTool(llm: LogRow, tool: LogRow): LogRow {
  const start = Math.min(llm.timestamp - llm.durationMs, tool.timestamp);
  const end = Math.max(llm.timestamp, tool.timestamp + tool.durationMs);
  const merged: LogRow = {
    ...tool,
    timestamp: start,
    durationMs: Math.max(0, end - start),
    tokens: llm.tokens,
    turn: llm.turn,
    mergedWith: "tool"
  };
  merged.label =
    merged.kind === "subagent" || merged.kind === "workflow"
      ? KIND_LABELS[merged.kind]
      : "LLM+工具";
  merged.action = `tool_use + ${tool.action}`;
  merged.records = [...llm.records, ...tool.records];
  return merged;
}

/**
 * Folds a model row that started exactly one tool call into that tool row.
 */
function foldSingleToolTurns(rows: LogRow[]): LogRow[] {
  const toolRowAt = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind === "user" || row.kind === "llm" || row.kind === "wait") return;
    if (!toolRowAt.has(row.id)) toolRowAt.set(row.id, index);
  });

  const mergedAt = new Map<number, LogRow>();
  const consumed = new Set<number>();
  rows.forEach((row, index) => {
    if (row.kind !== "llm" || row.mergedWith !== null || row.invokedTools.length !== 1) return;
    const partner = toolRowAt.get(row.invokedTools[0]);
    if (partner === undefined) return;
    mergedAt.set(Math.min(index, partner), mergeLlmAndTool(row, rows[partner]));
    consumed.add(Math.max(index, partner));
  });

  return rows.flatMap((row, index) => (consumed.has(index) ? [] : [mergedAt.get(index) ?? row]));
}

function turnIndexOf(turns: Turn[]): Map<SessionRecord, number> {
  const map = new Map<SessionRecord, number>();
  for (const turn of turns) {
    for (const record of turn.records) map.set(record, turn.index);
  }
  return map;
}

/**
 * Last activity of a turn: only model and tool activity counts, so a turn that
 * never got a response produces no gap.
 */
function turnLastActivity(turn: Turn): number | null {
  let last: number | null = null;
  for (const record of turn.records) {
    if (record.kind !== "assistant" && record.kind !== "tool") continue;
    const end = record.timestamp + record.durationMs;
    if (last === null || end > last) last = end;
  }
  return last;
}

export function buildGapRows(turns: Turn[]): LogRow[] {
  const rows: LogRow[] = [];
  for (let index = 0; index + 1 < turns.length; index += 1) {
    const nextTurn = turns[index + 1];
    const nextUser = nextTurn.records.find((record) => record.kind === "user");
    if (!nextUser) continue;
    const last = turnLastActivity(turns[index]);
    if (last === null || nextUser.timestamp <= last) continue;
    rows.push({
      id: `gap#${rows.length + 1}`,
      kind: "wait",
      label: KIND_LABELS.wait,
      action: "—",
      summary: "等待用户输入（轮间间隙）",
      timestamp: last,
      durationMs: nextUser.timestamp - last,
    status: "na",
    tokens: null,
    mergedWith: null,
    turn: null,
    invokedTools: [],
    gap: { start: last, end: nextUser.timestamp },
    records: []
  });
  }
  return rows;
}

export function buildLogRows(records: SessionRecord[], turns: Turn[] = []): LogRow[] {
  const base = records.map(toRow);
  const turnOf = turnIndexOf(turns);
  const firstUserOfTurn = new Map<number, LogRow>();
  const firstLlmOfTurn = new Map<number, LogRow>();

  records.forEach((record, index) => {
    const turn = turnOf.get(record);
    base[index].turn = turn ?? null;
    if (turn === undefined) return;
    const row = base[index];
    if (row.kind === "user" && !firstUserOfTurn.has(turn)) firstUserOfTurn.set(turn, row);
    if (row.kind === "llm" && !firstLlmOfTurn.has(turn)) firstLlmOfTurn.set(turn, row);
  });

  // Row order: sort with gaps, attribute model durations, then merge.
  const ordered = [...base, ...buildGapRows(turns)]
    .map((row, order) => ({ row, order }))
    .sort((a, b) => a.row.timestamp - b.row.timestamp || a.order - b.order)
    .map((entry) => entry.row);

  const sessionStart = records.reduce(
    (earliest, record) => Math.min(earliest, record.timestamp),
    Number.POSITIVE_INFINITY
  );
  applyActivityDurations(ordered, turns, Number.isFinite(sessionStart) ? sessionStart : 0);

  const mergedByRow = new Map<LogRow, LogRow>();
  const dropped = new Set<LogRow>();
  for (const [turn, userRow] of firstUserOfTurn) {
    const llmRow = firstLlmOfTurn.get(turn);
    if (!llmRow) continue;
    mergedByRow.set(llmRow, mergeUserAndLlm(userRow, llmRow));
    dropped.add(userRow);
  }

  return foldSingleToolTurns(
    ordered.filter((row) => !dropped.has(row)).map((row) => mergedByRow.get(row) ?? row)
  );
}

function rowSearchText(row: LogRow): string {
  const parts = [row.id, row.action, row.summary];
  for (const record of row.records) {
    parts.push(record.fullId, record.text, record.toolName ?? "", record.toolResult ?? "");
    if (record.childSessionPath) parts.push(record.childSessionPath);
  }
  return parts.join(" ").toLowerCase();
}

/**
 * Filters the log by row kind, row status, row duration and free text over
 * command/path/summary.
 */
export function filterLogRows(rows: LogRow[], filter: RecordFilter): LogRow[] {
  const needle = filter.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.kinds.size > 0 && !filter.kinds.has(row.kind)) return false;

    if (filter.statuses.size > 0) {
      if (row.status !== "ok" && row.status !== "error") return false;
      if (!filter.statuses.has(row.status)) return false;
    }

    if (filter.durationMode === "gt" && filter.minDurationMs !== null) {
      if (row.durationMs <= filter.minDurationMs) return false;
    } else if (filter.durationMode === "lt" && filter.minDurationMs !== null) {
      if (row.durationMs >= filter.minDurationMs) return false;
    } else if (filter.durationMode === "between") {
      if (filter.minDurationMs !== null && row.durationMs < filter.minDurationMs) return false;
      if (filter.maxDurationMs !== null && row.durationMs > filter.maxDurationMs) return false;
    }

    if (filter.timeRange && (
      row.timestamp < filter.timeRange.start || row.timestamp > filter.timeRange.end
    )) {
      return false;
    }

    if (needle && !rowSearchText(row).includes(needle)) return false;
    return true;
  });
}

/** Records behind the visible rows, for reports scoped to the current filter. */
export function recordsOfRows(rows: LogRow[]): SessionRecord[] {
  const seen = new Set<SessionRecord>();
  const records: SessionRecord[] = [];
  for (const row of rows) {
    for (const record of row.records) {
      if (seen.has(record)) continue;
      seen.add(record);
      records.push(record);
    }
  }
  return records.sort((a, b) => a.timestamp - b.timestamp);
}
