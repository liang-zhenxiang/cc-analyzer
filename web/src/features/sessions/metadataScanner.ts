import type { SessionMetadata } from "./metadataCache";

export const METADATA_HEAD_BYTES = 8 * 1024 * 1024;
export const MAX_METADATA_EVENTS = 500;

const NOISY_TYPES = new Set([
  "progress",
  "permission-mode",
  "queue-operation",
  "last-prompt",
  "attachment",
  "file-history-snapshot",
  "file-history-delta"
]);

const COMMAND_TAGS = [/<command-\w+>[\s\S]*?<\/command-\w+>/g];
const NOISE_TAGS = [
  /<local-command-\w+>[\s\S]*?<\/local-command-\w+>/g,
  /<system-reminder>[\s\S]*?<\/system-reminder>/g,
  /<task-notification>[\s\S]*?<\/task-notification>/g
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (isRecord(item) && item.type === "text") return String(item.text ?? "");
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function userPrompt(event: Record<string, unknown>): string | null {
  if (event.isMeta === true) return null;

  const message = isRecord(event.message) ? event.message : {};
  const rawText = textOf(message.content ?? event.content);
  const withoutCommands = rawText.replace(COMMAND_TAGS[0], "");
  const text = withoutCommands
    .replace(NOISE_TAGS[0], "")
    .replace(NOISE_TAGS[1], "")
    .replace(NOISE_TAGS[2], "")
    .trim();

  return text || null;
}

export function extractSessionMetadata(head: string, projectLabel: string): SessionMetadata {
  const metadata: SessionMetadata = {
    projectLabel,
    hasRecords: false
  };

  let validEvents = 0;
  for (const rawLine of head.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (!isRecord(event)) continue;
    const type = typeof event.type === "string" ? event.type : "";
    if (NOISY_TYPES.has(type)) continue;

    validEvents += 1;
    if (validEvents > MAX_METADATA_EVENTS) break;

    if (metadata.cwd === undefined && typeof event.cwd === "string" && event.cwd) {
      metadata.cwd = event.cwd;
    }
    if (metadata.sessionId === undefined && typeof event.sessionId === "string" && event.sessionId) {
      metadata.sessionId = event.sessionId;
    }
    if (metadata.gitBranch === undefined && typeof event.gitBranch === "string" && event.gitBranch) {
      metadata.gitBranch = event.gitBranch;
    }

    if (type === "custom-title" && metadata.customTitle === undefined) {
      const value = typeof event.customTitle === "string" ? event.customTitle.trim() : "";
      if (value) metadata.customTitle = value;
    }
    if (type === "agent-name" && metadata.agentName === undefined) {
      const value = typeof event.agentName === "string" ? event.agentName.trim() : "";
      if (value) metadata.agentName = value;
    }
    if (type === "ai-title" && metadata.aiTitle === undefined) {
      const value = typeof event.aiTitle === "string" ? event.aiTitle.trim() : "";
      if (value) metadata.aiTitle = value;
    }
    if (type === "user" && metadata.userPrompt === undefined) {
      metadata.userPrompt = userPrompt(event) ?? undefined;
    }
    if (type === "assistant") metadata.hasRecords = true;

    const finished =
      metadata.customTitle !== undefined &&
      metadata.agentName !== undefined &&
      metadata.aiTitle !== undefined &&
      metadata.userPrompt !== undefined &&
      metadata.cwd !== undefined &&
      metadata.sessionId !== undefined &&
      metadata.gitBranch !== undefined &&
      metadata.hasRecords;
    if (finished) break;
  }

  return metadata;
}
