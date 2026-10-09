import type {
  AssistantContentBlock,
  CompactEvent,
  ParseCoverage,
  ParsedSession,
  ParseJsonlOptions,
  SessionRecord,
  SessionUsage,
  SystemTurnDuration,
  ToolCategory,
  Turn
} from "./types";
import { extractStructuredToolResult } from "./structuredToolResult";
import { safeStringify } from "../../lib/json";
import { getThresholds } from "../settings/thresholds";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

const SKIPPED_EVENT_TYPES = new Set([
  "system",
  "progress",
  "permission-mode",
  "queue-operation",
  "last-prompt",
  "attachment",
  "file-history-snapshot",
  "file-history-delta"
]);

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item) return String((item as { text?: unknown }).text ?? "");
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function usageOf(value: unknown): SessionUsage | undefined {
  if (!isRecord(value)) return undefined;
  const usage: SessionUsage = {};
  if (typeof value.input_tokens === "number") usage.inputTokens = value.input_tokens;
  if (typeof value.output_tokens === "number") usage.outputTokens = value.output_tokens;
  if (typeof value.cache_creation_input_tokens === "number") {
    usage.cacheCreationTokens = value.cache_creation_input_tokens;
  }
  if (typeof value.cache_read_input_tokens === "number") {
    usage.cacheReadTokens = value.cache_read_input_tokens;
  }
  // The 5m/1h split is reported raw; `tokenTotals.ts` owns the fallback for the
  // calls that wrote a cache but never got a TTL breakdown.
  const cacheCreation = isRecord(value.cache_creation) ? value.cache_creation : undefined;
  if (cacheCreation) {
    if (typeof cacheCreation.ephemeral_5m_input_tokens === "number") {
      usage.cacheCreationFiveMinuteTokens = cacheCreation.ephemeral_5m_input_tokens;
    }
    if (typeof cacheCreation.ephemeral_1h_input_tokens === "number") {
      usage.cacheCreationOneHourTokens = cacheCreation.ephemeral_1h_input_tokens;
    }
  }
  return Object.keys(usage).length > 0 ? usage : undefined;
}

function recordId(value: Record<string, unknown>, lineNumber: number): string {
  const uuid = typeof value.uuid === "string" ? value.uuid : typeof value.toolUseId === "string" ? value.toolUseId : `line-${lineNumber}`;
  return uuid.slice(0, 8);
}

function toolCategory(toolName: string | undefined): ToolCategory | undefined {
  if (toolName === "Agent" || toolName === "Task") return "delegated";
  if (toolName === "Workflow") return "workflow";
  if (toolName === "AskUserQuestion") return "wait";
  return toolName ? "direct" : undefined;
}

const TOOL_RESULT_LIMIT = 5 * 1024;
/** Compact summaries can run long; only the head is kept in memory. */
const COMPACT_SUMMARY_TEXT_LIMIT = 2000;
/** Bucket key for coverage counts when a line carries no `type` field. */
const MISSING_TYPE_KEY = "(missing)";
const SLASH_COMMAND_PATTERN = /^\/([A-Za-z:_-]+)$/;
const COMMAND_NAME_PATTERN = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS_PATTERN = /<command-args>([\s\S]*?)<\/command-args>/;
const LOCAL_COMMAND_STDOUT = "<local-command-stdout>";
const INTERRUPT_MESSAGES = new Set([
  "[Request interrupted by user]",
  "[Request interrupted by user for tool use]"
]);

function extractCommandName(text: string, previousCommandName: string | null): string | null {
  if (text.trim().startsWith(LOCAL_COMMAND_STDOUT)) return previousCommandName;
  const args = COMMAND_ARGS_PATTERN.exec(text);
  if (args && args[1].trim().length > 0) return null;
  const slash = SLASH_COMMAND_PATTERN.exec(text.trim());
  if (slash) return slash[1];
  const command = COMMAND_NAME_PATTERN.exec(text);
  if (!command) return null;
  const commandName = command[1].trim().replace(/^\//, "");
  return commandName.length > 0 ? commandName : null;
}

function toolResultText(value: unknown): { text: string; truncated: boolean } {
  let text: string;
  if (typeof value === "string") text = value;
  else if (Array.isArray(value)) text = textOf(value);
  else if (value === null || value === undefined) text = "";
  else text = safeStringify(value);

  if (text.length <= TOOL_RESULT_LIMIT) return { text, truncated: false };

  const lengthHint = (retainedLength: number) =>
    `[Truncated: showing first ${retainedLength} of ${text.length} characters]`;
  const retainedLength = TOOL_RESULT_LIMIT - lengthHint(TOOL_RESULT_LIMIT).length;
  return {
    text: `${text.slice(0, retainedLength)}${lengthHint(retainedLength)}`,
    truncated: true
  };
}

function childSessionLinks(value: Record<string, unknown>): Pick<SessionRecord, "childSessionId" | "childSessionPath"> {
  const nested = isRecord(value.childSession) ? value.childSession : {};
  const toolUseResult = isRecord(value.toolUseResult) ? value.toolUseResult : {};
  return {
    childSessionId:
      optionalString(value.childSessionId) ??
      optionalString(nested.id) ??
      optionalString(toolUseResult.agentId),
    childSessionPath:
      optionalString(value.childSessionPath) ??
      optionalString(nested.path) ??
      optionalString(toolUseResult.agentFilePath)
  };
}

/** A finite number from `compactMetadata`, or null — never an invented zero. */
function compactNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayOf(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

/** `preservedMessages.uuids`, falling back to `allUuids`, then to an empty list. */
function survivedUuidsOf(metadata: Record<string, unknown> | undefined): string[] {
  const preserved = isRecord(metadata?.preservedMessages) ? metadata.preservedMessages : undefined;
  return stringArrayOf(preserved?.uuids) ?? stringArrayOf(preserved?.allUuids) ?? [];
}

/**
 * Collects one `compact_boundary` record into a `CompactEvent`. The boundary's
 * own `parentUuid` is null in observed logs; the chain attachment point is
 * `logicalParentUuid`, kept verbatim so consumers can anchor against it.
 */
function consumeCompactBoundary(state: ParserState, value: Record<string, unknown>, eventTimestamp: number | null): void {
  const id = optionalString(value.uuid);
  if (id === undefined || eventTimestamp === null) {
    state.skippedCounts.system = (state.skippedCounts.system ?? 0) + 1;
    return;
  }
  const metadata = isRecord(value.compactMetadata) ? value.compactMetadata : undefined;
  state.compactEvents.push({
    id,
    timestamp: eventTimestamp,
    trigger: optionalString(metadata?.trigger) ?? null,
    preTokens: compactNumber(metadata?.preTokens),
    postTokens: compactNumber(metadata?.postTokens),
    droppedTokens: compactNumber(metadata?.cumulativeDroppedTokens),
    durationMs: compactNumber(metadata?.durationMs),
    survivedUuids: survivedUuidsOf(metadata),
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: optionalString(value.logicalParentUuid) ?? null,
    // The raw line stays with the event: the log table's band row (J3) shows
    // it under 原始事件 just like every message row shows its own record.
    raw: value
  });
}

/**
 * Fills `summaryText`/`summaryUuid` on the compact event this message belongs
 * to. The summary message's `parentUuid` points at the boundary uuid; when
 * that link is missing, the most recent event still awaiting a summary takes
 * it (the boundary is written immediately before its summary).
 */
function attachCompactSummary(events: CompactEvent[], value: Record<string, unknown>, text: string): void {
  const parent = optionalString(value.parentUuid);
  const target =
    events.find((event) => event.id === parent && event.summaryUuid === null) ??
    [...events].reverse().find((event) => event.summaryUuid === null);
  if (!target) return;
  target.summaryUuid = optionalString(value.uuid) ?? null;
  target.summaryText = text.length > 0 ? text.slice(0, COMPACT_SUMMARY_TEXT_LIMIT) : null;
}

type ContentBlock = {
  type?: unknown;
  id?: unknown;
  tool_use_id?: unknown;
  name?: unknown;
  input?: unknown;
  content?: unknown;
  is_error?: unknown;
  text?: unknown;
  thinking?: unknown;
};

function contentBlocks(value: unknown): ContentBlock[] {
  return Array.isArray(value)
    ? value.filter((item): item is ContentBlock => isRecord(item as unknown))
    : [];
}

type AssistantAggregate = {
  record: SessionRecord;
  blocks: AssistantContentBlock[];
  lineNumbers: number[];
  toolUseIds: string[];
};

function assistantMessageKey(value: Record<string, unknown>, message: Record<string, unknown>, lineNumber: number): string {
  if (typeof message.id === "string" && message.id.length > 0) return message.id;
  if (typeof value.uuid === "string" && value.uuid.length > 0) return value.uuid;
  return `line-${lineNumber}`;
}

function assistantText(blocks: AssistantContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "text" || block.type === "thinking")
    .map((block) => textOf(block.text ?? block.thinking))
    .filter(Boolean)
    .join("\n");
}

function buildTurns(records: SessionRecord[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  for (const record of records) {
    if (!current || record.kind === "user") {
      current = {
        index: turns.length,
        startedAt: record.timestamp,
        endedAt: record.timestamp + record.durationMs,
        records: [record]
      };
      turns.push(current);
      continue;
    }

    current.records.push(record);
    current.startedAt = Math.min(current.startedAt, record.timestamp);
    current.endedAt = Math.max(current.endedAt, record.timestamp + record.durationMs);
  }

  return turns;
}

function recordEnd(record: SessionRecord): number {
  return record.timestamp + record.durationMs;
}

function sourceLineOf(record: SessionRecord): number {
  return record.sourceLineNumbers?.[0] ?? record.lineNumber ?? Number.MAX_SAFE_INTEGER;
}

function compareByTimestampAndSourceLine(a: SessionRecord, b: SessionRecord): number {
  return a.timestamp - b.timestamp || sourceLineOf(a) - sourceLineOf(b);
}

type ParserState = {
  warnings: string[];
  records: SessionRecord[];
  pendingTools: Map<string, SessionRecord>;
  lastCommandName: string | null;
  assistantAggregates: Map<string, AssistantAggregate>;
  systemTurnDurations: SystemTurnDuration[];
  skippedCounts: Record<string, number>;
  compactEvents: CompactEvent[];
  coverage: ParseCoverage;
  sidechainMessages: SessionRecord[];
  timestampedLines: Array<{
    value: Record<string, unknown>;
    lineNumber: number;
    timestamp: number;
  }>;
  sessionId: string | undefined;
  cwd: string | undefined;
  gitBranch: string | undefined;
  version: string | undefined;
  startedAt: number;
  endedAt: number;
};

function createParserState(): ParserState {
  return {
    warnings: [],
    records: [],
    pendingTools: new Map(),
    lastCommandName: null,
    assistantAggregates: new Map(),
    systemTurnDurations: [],
    skippedCounts: {},
    compactEvents: [],
    coverage: { totalLines: 0, unparsableLines: 0, unknownTypeCounts: {} },
    sidechainMessages: [],
    timestampedLines: [],
    sessionId: undefined,
    cwd: undefined,
    gitBranch: undefined,
    version: undefined,
    startedAt: Number.POSITIVE_INFINITY,
    endedAt: Number.NEGATIVE_INFINITY
  };
}

/** Parses the first pass over one line, accumulating into `state`. */
function consumeLine(state: ParserState, line: string, index: number): void {
  const { warnings, systemTurnDurations, skippedCounts, timestampedLines, coverage } = state;
    const lineNumber = index + 1;
    if (!line.trim()) return;
    coverage.totalLines += 1;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) {
        warnings.push(`第 ${lineNumber} 行解析失败: 非对象事件`);
        coverage.unparsableLines += 1;
        return;
      }
      const value = parsed;
      state.sessionId ??= optionalString(value.sessionId) ?? optionalString(value.session_id);
      state.cwd ??= optionalString(value.cwd);
      state.gitBranch ??= optionalString(value.gitBranch);
      state.version ??= optionalString(value.version);

      const eventTimestamp = timestamp(value.timestamp);
      if (eventTimestamp !== null) {
        state.startedAt = Math.min(state.startedAt, eventTimestamp);
        state.endedAt = Math.max(state.endedAt, eventTimestamp);
      }

      if (value.type === "system" && value.subtype === "turn_duration") {
        const durationMs =
          typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
            ? value.durationMs
            : null;
        if (eventTimestamp !== null && durationMs !== null) {
          systemTurnDurations.push({ timestamp: eventTimestamp, durationMs });
        } else {
          skippedCounts.system = (skippedCounts.system ?? 0) + 1;
        }
        return;
      }

      // Must run before the skipped-type filter: "system" as a whole is a
      // skipped type, but compact boundaries are session-level data now.
      if (value.type === "system" && value.subtype === "compact_boundary") {
        consumeCompactBoundary(state, value, eventTimestamp);
        return;
      }

      if (value.type === "user" && value.isMeta === true) {
        skippedCounts["user-meta"] = (skippedCounts["user-meta"] ?? 0) + 1;
        return;
      }

      if (value.type === "user") {
        const message = isRecord(value.message) ? value.message : {};
        if (typeof message.content === "string" && message.content.startsWith("<task-notification>")) {
          skippedCounts["user-task-notification"] =
            (skippedCounts["user-task-notification"] ?? 0) + 1;
          return;
        }
      }

      const isKnownSkippedType = typeof value.type === "string" && SKIPPED_EVENT_TYPES.has(value.type);
      if (isKnownSkippedType || (value.type !== "user" && value.type !== "assistant")) {
        const key = typeof value.type === "string" && value.type.length > 0 ? value.type : "unknown";
        skippedCounts[key] = (skippedCounts[key] ?? 0) + 1;
        if (!isKnownSkippedType) {
          // Neither handled nor explicitly skipped — count it as unknown.
          const bucket = typeof value.type === "string" && value.type.length > 0 ? value.type : MISSING_TYPE_KEY;
          coverage.unknownTypeCounts[bucket] = (coverage.unknownTypeCounts[bucket] ?? 0) + 1;
        }
        return;
      }

      if (eventTimestamp === null) {
        warnings.push(`第 ${lineNumber} 行 ${String(value.type)} 缺少有效时间戳`);
        return;
      }

      timestampedLines.push({ value, lineNumber, timestamp: eventTimestamp });
    } catch (error) {
      warnings.push(`第 ${lineNumber} 行解析失败: ${String(error)}`);
      coverage.unparsableLines += 1;
    }
}

export function parseJsonlText(text: string, path: string, options: ParseJsonlOptions = {}): ParsedSession {
  const state = createParserState();
  text.split(/\r?\n/).forEach((line, index) => consumeLine(state, line, index));
  return finishParse(state, path, options);
}

/**
 * Same result as `parseJsonlText`, but yields to the event loop between line
 * chunks so a multi-megabyte session does not freeze the UI thread.
 */
export async function parseJsonlTextAsync(
  text: string,
  path: string,
  options: ParseJsonlOptions = {},
  onProgress?: (fraction: number) => void
): Promise<ParsedSession> {
  const state = createParserState();
  const lines = text.split(/\r?\n/);
  const chunkLines = getThresholds().parseChunkLines;

  for (let index = 0; index < lines.length; index += 1) {
    consumeLine(state, lines[index], index);
    if ((index + 1) % chunkLines !== 0 || index + 1 >= lines.length) continue;
    onProgress?.((index + 1) / lines.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  onProgress?.(1);
  return finishParse(state, path, options);
}

function finishParse(
  state: ParserState,
  path: string,
  options: ParseJsonlOptions
): ParsedSession {
  const {
    warnings,
    records,
    pendingTools,
    assistantAggregates,
    systemTurnDurations,
    skippedCounts,
    compactEvents,
    coverage,
    sidechainMessages,
    timestampedLines,
    sessionId,
    cwd,
    gitBranch,
    version
  } = state;
  let { startedAt, endedAt, lastCommandName } = state;

  // Compact summaries are attached during the pass below; sort the events
  // first so "most recent event without a summary" follows chronology even
  // when lines arrive out of order.
  compactEvents.sort((a, b) => a.timestamp - b.timestamp);
  timestampedLines.sort((a, b) => a.timestamp - b.timestamp || a.lineNumber - b.lineNumber);
  for (const { value, lineNumber, timestamp: ts } of timestampedLines) {
    const message = value.message as { role?: string; model?: string; content?: unknown } | undefined;

    if (value.type === "assistant") {
      const assistantMessage = isRecord(value.message) ? value.message : {};
      const assistantModel = optionalString(assistantMessage.model);
      const blocks = contentBlocks(assistantMessage.content).map((block) => ({
        type: typeof block.type === "string" ? block.type : "unknown",
        text: typeof block.text === "string" ? block.text : undefined,
        thinking: typeof block.thinking === "string" ? block.thinking : undefined,
        id: typeof block.id === "string" ? block.id : undefined,
        name: typeof block.name === "string" ? block.name : undefined,
        input: block.input
      }));
      const key = assistantMessageKey(value, assistantMessage, lineNumber);
      const existing = assistantAggregates.get(key);

      if (!existing) {
        const record: SessionRecord = {
          id: recordId(value, lineNumber - 1),
          fullId: typeof value.uuid === "string" ? value.uuid : `line-${lineNumber}`,
          kind: "assistant",
          timestamp: ts,
          durationMs: 0,
          model: assistantModel,
          text: assistantText(blocks),
          isError: Boolean(value.isApiErrorMessage),
          usage: usageOf(assistantMessage.usage),
          raw: value,
          lineNumber,
          sourceLineNumbers: [lineNumber],
          assistantMessageId: typeof assistantMessage.id === "string" ? assistantMessage.id : undefined,
          contentBlocks: blocks,
          isSidechain: value.isSidechain === true,
          isSynthetic: assistantMessage.model === "<synthetic>",
          stopReason: typeof assistantMessage.stop_reason === "string" ? assistantMessage.stop_reason : undefined
        };
        const aggregate: AssistantAggregate = {
          record,
          blocks,
          lineNumbers: [lineNumber],
          toolUseIds: []
        };
        assistantAggregates.set(key, aggregate);
        if (record.isSidechain && !options.isSubagent) {
          sidechainMessages.push(record);
        } else {
          records.push(record);
        }
      } else {
        existing.blocks.push(...blocks);
        existing.lineNumbers.push(lineNumber);
        existing.record.contentBlocks = existing.blocks;
        existing.record.sourceLineNumbers = existing.lineNumbers;
        existing.record.timestamp = ts;
        existing.record.text = assistantText(existing.blocks);
        if (!existing.record.stopReason && typeof assistantMessage.stop_reason === "string") {
          existing.record.stopReason = assistantMessage.stop_reason;
        }
      }

      if (value.isApiErrorMessage === true) {
        const aggregate = assistantAggregates.get(key);
        if (aggregate) {
          aggregate.record.isError = true;
          aggregate.record.apiError = {
            kind: typeof value.error === "string" ? value.error : null,
            status: typeof value.apiErrorStatus === "number" && Number.isFinite(value.apiErrorStatus)
              ? value.apiErrorStatus
              : null
          };
        }
      }

      const aggregate = assistantAggregates.get(key);
      const isMainSessionSidechain = Boolean(aggregate?.record.isSidechain) && options.isSubagent !== true;
      for (const block of blocks) {
        if (block.type !== "tool_use" || !block.id || !block.name) continue;
        const toolUseId = block.id;
        const toolRecord: SessionRecord = {
          id: toolUseId.slice(0, 8),
          fullId: toolUseId,
          kind: "tool",
          timestamp: ts,
          durationMs: 0,
          model: assistantModel,
          text: "",
          isError: false,
          toolName: block.name,
          toolCategory: toolCategory(block.name),
          toolInput: block.input,
          raw: value,
          lineNumber,
          assistantMessageId: aggregate?.record.assistantMessageId
        };
        if (isMainSessionSidechain) {
          toolRecord.isSidechain = true;
          sidechainMessages.push(toolRecord);
        } else {
          records.push(toolRecord);
        }
        pendingTools.set(toolUseId, toolRecord);
        aggregate?.toolUseIds.push(toolUseId);
      }
      continue;
    }

    const prompt = textOf(message?.content ?? value.content);
    const commandName = extractCommandName(prompt, lastCommandName);
    if (commandName !== null) lastCommandName = commandName;
    const isInterrupt = INTERRUPT_MESSAGES.has(prompt.trim());
    const blocks = contentBlocks(message?.content);
    const toolResults = blocks.filter((block) => block.type === "tool_result");

    if (toolResults.length === 0) {
      if (!prompt) continue;
      const isCompactSummary = value.isCompactSummary === true;
      if (isCompactSummary) {
        attachCompactSummary(compactEvents, value, prompt);
      }
      records.push({
        id: recordId(value, lineNumber),
        fullId: typeof value.uuid === "string" ? value.uuid : `line-${lineNumber}`,
        kind: "user",
        timestamp: ts,
        durationMs: 0,
        text: prompt,
        isError: false,
        commandName,
        isInterrupt,
        lineNumber,
        compactSummary: isCompactSummary || undefined,
        raw: value
      });
      continue;
    }

    for (const block of toolResults) {
      const toolUseId = optionalString(block.tool_use_id);
      const pending = toolUseId ? pendingTools.get(toolUseId) : undefined;
      if (!pending) {
        warnings.push(`第 ${lineNumber} 行 tool_result 没有匹配的 tool_use: ${toolUseId ?? "(缺少 id)"}`);
        continue;
      }

      pending.durationMs = Math.max(0, ts - pending.timestamp);
      pending.isError = block.is_error === true;
      const result = toolResultText(block.content);
      pending.toolResult = result.text;
      pending.resultTruncated = result.truncated;
      pending.structuredResult = extractStructuredToolResult(pending.toolName, value.toolUseResult) ?? undefined;
      Object.assign(pending, childSessionLinks(value));
      pending.unmatched = false;
      pendingTools.delete(toolUseId!);
    }
  }

  for (const tool of pendingTools.values()) {
    tool.unmatched = true;
    warnings.push(`tool_use 未匹配到 tool_result: ${tool.fullId}`);
  }

  const sorted = [...records].sort(compareByTimestampAndSourceLine);
  const sortedSidechainMessages = [...sidechainMessages].sort(compareByTimestampAndSourceLine);
  const finalStartedAt = Number.isFinite(startedAt) ? startedAt : 0;
  endedAt = sorted.reduce((latest, record) => Math.max(latest, recordEnd(record)), endedAt);
  const unmatchedToolUses = sorted.filter((record) => record.unmatched);

  return {
    sessionId: sessionId ?? path,
    path,
    isSubagent: options.isSubagent === true,
    cwd,
    gitBranch,
    version,
    startedAt: finalStartedAt,
    endedAt: Number.isFinite(endedAt) ? endedAt : 0,
    records: sorted,
    turns: buildTurns(sorted),
    unmatchedToolUses,
    warnings,
    systemTurnDurations,
    skippedCounts,
    compactEvents,
    parseCoverage: coverage,
    sidechainMessages: sortedSidechainMessages
  };
}
