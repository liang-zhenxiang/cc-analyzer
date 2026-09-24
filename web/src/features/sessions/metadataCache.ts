export type SessionMetadata = {
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  projectLabel: string;
  customTitle?: string;
  agentName?: string;
  aiTitle?: string;
  userPrompt?: string;
  hasRecords: boolean;
};

export type MetadataCacheEntry = {
  mtimeMs: number;
  sizeBytes: number;
  meta: SessionMetadata;
};

export type MetadataCache = {
  version: 2;
  generatedAt: number;
  entries: Record<string, MetadataCacheEntry>;
};

export type SessionMeta = SessionMetadata & {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
  metadataStatus?: "complete" | "pending" | "failed";
};

export type SessionSummary = SessionMeta;

/** Title priority shared by the list and the analyzer header. */
export function sessionTitle(session: SessionMeta): string {
  return (
    session.customTitle ??
    session.agentName ??
    session.aiTitle ??
    session.userPrompt ??
    session.projectLabel
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeSessionMetadata(value: unknown, projectLabel: string): SessionMetadata {
  if (!isRecord(value)) return { projectLabel, hasRecords: false };

  return {
    sessionId: optionalString(value.sessionId),
    cwd: optionalString(value.cwd),
    gitBranch: optionalString(value.gitBranch),
    projectLabel:
      typeof value.projectLabel === "string" && value.projectLabel ? value.projectLabel : projectLabel,
    customTitle: optionalString(value.customTitle),
    agentName: optionalString(value.agentName),
    aiTitle: optionalString(value.aiTitle),
    userPrompt: optionalString(value.userPrompt),
    hasRecords: value.hasRecords === true
  };
}

export function normalizeMetadataCache(value: unknown, generatedAt = Date.now()): MetadataCache {
  if (!isRecord(value) || value.version !== 2 || !isRecord(value.entries)) {
    return { version: 2, generatedAt, entries: {} };
  }

  const entries: Record<string, MetadataCacheEntry> = {};
  for (const [path, rawEntry] of Object.entries(value.entries)) {
    if (!isRecord(rawEntry)) continue;
    const mtimeMs = nonNegativeNumber(rawEntry.mtimeMs);
    const sizeBytes = nonNegativeNumber(rawEntry.sizeBytes);
    if (mtimeMs === undefined || sizeBytes === undefined || !isRecord(rawEntry.meta)) continue;

    const fallbackProjectLabel = pathSegments(path).at(-2) ?? "导入会话";
    entries[path] = {
      mtimeMs,
      sizeBytes,
      meta: normalizeSessionMetadata(rawEntry.meta, fallbackProjectLabel)
    };
  }

  return { version: 2, generatedAt, entries };
}

export function toSessionMeta(path: string, entry: MetadataCacheEntry): SessionMeta {
  return {
    ...entry.meta,
    path,
    mtimeMs: entry.mtimeMs,
    sizeBytes: entry.sizeBytes,
    metadataStatus: "complete"
  };
}

function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}
