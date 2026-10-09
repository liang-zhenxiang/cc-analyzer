export type RecordKind = "user" | "assistant" | "tool" | "wait";
export type ToolCategory = "direct" | "delegated" | "workflow" | "wait";

/**
 * `message.usage` as it appears in the transcript. The four counters are kept
 * apart on purpose — `input + cacheCreation + cacheRead` is the whole prompt,
 * but it is not `input_tokens`, and the two must not be shown under one label.
 *
 * A missing counter is a zero, not an unknown: Claude Code omits
 * `cache_creation_input_tokens` (and the whole `cache_creation` sub-object)
 * when the call wrote no cache at all.
 */
export type SessionUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  /** `cache_creation.ephemeral_5m_input_tokens` — the 5-minute cache tier. */
  cacheCreationFiveMinuteTokens?: number;
  /** `cache_creation.ephemeral_1h_input_tokens` — the 1-hour cache tier. */
  cacheCreationOneHourTokens?: number;
};

export type SystemTurnDuration = {
  timestamp: number;
  durationMs: number;
};

/**
 * One `type: "system", subtype: "compact_boundary"` record: the moment Claude
 * Code compacted the conversation. Numbers stay `null` when the log predates
 * `compactMetadata` — a zero would impersonate a measured value.
 */
export type CompactEvent = {
  /** The boundary record's own uuid. */
  id: string;
  /** The boundary record's timestamp (ms). */
  timestamp: number;
  /** `compactMetadata.trigger` verbatim ("manual" | "auto" observed so far). */
  trigger: string | null;
  /** Context size right before compaction. */
  preTokens: number | null;
  /** Context size right after compaction. */
  postTokens: number | null;
  /**
   * `compactMetadata.cumulativeDroppedTokens` as recorded — already cumulative
   * across the session, never re-summed here.
   */
  droppedTokens: number | null;
  durationMs: number | null;
  /** `preservedMessages.uuids` (falls back to `allUuids`); empty when neither exists. */
  survivedUuids: string[];
  /**
   * The `isCompactSummary` user message that follows the boundary, truncated
   * to `COMPACT_SUMMARY_TEXT_LIMIT`. Null when the log has no such message.
   */
  summaryText: string | null;
  summaryUuid: string | null;
  /**
   * The boundary's `logicalParentUuid` — the last message before compaction.
   * The boundary's own `parentUuid` is null in every observed log, so this is
   * the only usable attachment point onto the message chain.
   */
  logicalParentUuid: string | null;
};

/**
 * Line-level view of what the parser saw versus what it understood. Types the
 * parser neither handles nor explicitly skips land in `unknownTypeCounts`; a
 * line without a `type` field is keyed `"(missing)"`.
 */
export type ParseCoverage = {
  /** Non-blank lines seen. */
  totalLines: number;
  /** Lines whose JSON could not be parsed into an object. */
  unparsableLines: number;
  unknownTypeCounts: Record<string, number>;
};

/**
 * One point on the per-call context-size curve. `contextTokens` is the whole
 * prompt that call fed the model: input + cache creation + cache read (missing
 * counters are zeros per `SessionUsage`, not unknowns).
 */
export type ContextSample = {
  uuid: string;
  timestamp: number;
  contextTokens: number;
  outputTokens: number;
  model: string | null;
};

export type AssistantContentBlock = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
};

export type StructuredToolResult =
  | {
      toolName: "Bash";
      stdout: string;
      stderr: string;
      interrupted: boolean;
      timedOutAfterMs: number | null;
    }
  | {
      toolName: "Edit";
      filePath: string;
      oldString: string;
      newString: string;
      replaceAll: boolean;
      structuredPatch: unknown;
    }
  | { toolName: "Write"; filePath: string; created: boolean }
  | { toolName: "Read"; filePath: string }
  | {
      toolName: "Grep";
      mode: string;
      numFiles: number;
      numLines: number | null;
      totalLines: number | null;
    }
  | {
      toolName: "Glob";
      numFiles: number;
      totalMatches: number | null;
      durationMs: number | null;
    }
  | {
      toolName: "Agent";
      agentId: string;
      agentType: string;
      totalDurationMs: number | null;
      totalTokens: number | null;
      totalToolUseCount: number | null;
      isAsync: boolean;
      description: string;
      resolvedModel: string;
    }
  | {
      toolName: "Workflow";
      runId: string;
      taskId: string;
      workflowName: string;
      scriptPath: string;
      status: string;
    };

export type ParseJsonlOptions = {
  isSubagent?: boolean;
};

export type SessionRecord = {
  id: string;
  fullId: string;
  kind: RecordKind;
  timestamp: number;
  durationMs: number;
  model?: string;
  text: string;
  isError: boolean;
  toolName?: string;
  toolCategory?: ToolCategory;
  toolInput?: unknown;
  toolResult?: string;
  childSessionId?: string;
  childSessionPath?: string;
  usage?: SessionUsage;
  unmatched?: boolean;
  lineNumber?: number;
  sourceLineNumbers?: number[];
  assistantMessageId?: string;
  contentBlocks?: AssistantContentBlock[];
  structuredResult?: StructuredToolResult;
  resultTruncated?: boolean;
  commandName?: string | null;
  isInterrupt?: boolean;
  isSidechain?: boolean;
  isSynthetic?: boolean;
  /**
   * True for the `isCompactSummary` user message that follows a compact
   * boundary — a continuation artifact the model wrote, not user speech.
   * Derived statistics must exclude it from user-message counts.
   */
  compactSummary?: boolean;
  apiError?: { kind: string | null; status: number | null };
  missingTimestamp?: boolean;
  stopReason?: string;
  childSession?: ParsedSession;
  childSessions?: ParsedSession[];
  workflowRun?: WorkflowRun;
  raw: unknown;
};

export type Turn = {
  index: number;
  startedAt: number;
  endedAt: number;
  records: SessionRecord[];
};

export type ParsedSession = {
  sessionId: string;
  path: string;
  isSubagent?: boolean;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  startedAt: number;
  endedAt: number;
  records: SessionRecord[];
  turns: Turn[];
  unmatchedToolUses: SessionRecord[];
  warnings: string[];
  systemTurnDurations: SystemTurnDuration[];
  skippedCounts: Record<string, number>;
  /** Compact boundaries in file order (which is chronological for JSONL). */
  compactEvents?: CompactEvent[];
  /** Line-level parse coverage; always present in parser output. */
  parseCoverage?: ParseCoverage;
  sidechainMessages: SessionRecord[];
};

export type WorkflowRun = {
  runId: string;
  workflowName: string;
  summary: string;
  status: string;
  startTs: number | null;
  durationMs: number;
  agentCount: number;
  totalTokens: number | null;
  totalToolCalls: number | null;
  phases: string[];
  resultText: string;
  resultTruncated: boolean;
  logs: string[];
};

export type ParsedSessionGraph = {
  root: ParsedSession;
  sessions: ParsedSession[];
  agentPaths: Record<string, string>;
  agentSessions: Record<string, ParsedSession>;
  workflowRuns: Record<string, WorkflowRun>;
  unresolvedAgentToolIds: string[];
  unresolvedWorkflowToolIds: string[];
  depthTruncatedPaths: string[];
  cyclePaths: string[];
  warnings: string[];
};
