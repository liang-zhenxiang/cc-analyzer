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

/**
 * 每个会话的筛选事实（G2）。
 *
 * 只在**建立索引**那一趟算一次，之后随缓存命中复用：六条件要实时过滤数百个
 * 会话，逐次重读 jsonl 会让输入即卡顿（design §2.4 方案 C）。口径与
 * `usage/sessionQuery.ts` 逐条对齐，改这里必须同步改那边：
 *
 * - `models`：带 usage 记录的模型（缺省归「未知模型」）；
 * - `tools`：`censusKeyId` 的桶身份（`builtin:Bash`、`mcp:<server>`…），
 *   含 sidechain 调用——只算主链会低估近一半（与工具普查同源）；
 * - `ctxPeak`：`input + cacheCreation + cacheRead` 的最大值；
 * - `errors`：`extractErrorEvents` 的事件数（工具错误 + API 错误）；
 * - `durationMs`：首末记录差（墙钟跨度，不扣等待）；
 * - `messages`：主链记录数（不是 assistant 消息数——那是错误趋势的分母）。
 */
export type SessionFacts = {
  models: string[];
  tools: string[];
  ctxPeak: number;
  errors: number;
  durationMs: number;
  messages: number;
};

export type MetadataCacheEntry = {
  mtimeMs: number;
  sizeBytes: number;
  meta: SessionMetadata;
  /**
   * 缺 `facts` = 还没建立索引（v2 时代留下的条目、或扫描中途失败）。
   * 这类会话**不参与筛选**，列表旁常显「已索引 N/M」——不把「还没索引」
   * 伪装成「不匹配」。
   */
  facts?: SessionFacts;
};

export type MetadataCache = {
  version: 3;
  generatedAt: number;
  entries: Record<string, MetadataCacheEntry>;
};

export type SessionMeta = SessionMetadata & {
  path: string;
  mtimeMs: number;
  sizeBytes: number;
  metadataStatus?: "complete" | "pending" | "failed";
  /** 筛选事实；缺省 = 未建立索引（不参与 G2 条件过滤）。 */
  facts?: SessionFacts;
  /**
   * True when this session is served from the local archive because Claude Code
   * has already cleaned the original up. `mtimeMs` then carries the **original**
   * timestamp, so grouping and trends still describe when it happened.
   */
  archived?: boolean;
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

/**
 * v2 → v3：v3 给每个条目加 `facts`（G2 的筛选事实）。
 *
 * 版本不匹配时**清空并重建**，不是报错：缓存是可再生数据，旧版本条目的
 * `facts` 无法凭空补出来，保留它们只会让筛选长期少一半会话。重建的成本是
 * 一次全量扫描（用户已经在扫描流程里），换来的是「筛得出」而不是「筛不出」。
 */
export function normalizeMetadataCache(value: unknown, generatedAt = Date.now()): MetadataCache {
  if (!isRecord(value) || value.version !== 3 || !isRecord(value.entries)) {
    return { version: 3, generatedAt, entries: {} };
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
      meta: normalizeSessionMetadata(rawEntry.meta, fallbackProjectLabel),
      facts: normalizeSessionFacts(rawEntry.facts)
    };
  }

  return { version: 3, generatedAt, entries };
}

export function toSessionMeta(path: string, entry: MetadataCacheEntry): SessionMeta {
  return {
    ...entry.meta,
    path,
    mtimeMs: entry.mtimeMs,
    sizeBytes: entry.sizeBytes,
    metadataStatus: "complete",
    ...(entry.facts ? { facts: entry.facts } : {})
  };
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return items.length === value.length ? items : undefined;
}

function normalizeSessionFacts(value: unknown): SessionFacts | undefined {
  if (!isRecord(value)) return undefined;
  const models = stringList(value.models);
  const tools = stringList(value.tools);
  const ctxPeak = nonNegativeNumber(value.ctxPeak);
  const errors = nonNegativeNumber(value.errors);
  const durationMs = nonNegativeNumber(value.durationMs);
  const messages = nonNegativeNumber(value.messages);
  if (!models || !tools || ctxPeak === undefined || errors === undefined || durationMs === undefined || messages === undefined) {
    return undefined;
  }
  return { models, tools, ctxPeak, errors, durationMs, messages };
}

function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}
