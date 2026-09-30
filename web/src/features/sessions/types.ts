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
