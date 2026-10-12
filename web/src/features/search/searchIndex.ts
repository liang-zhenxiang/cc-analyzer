import type { ParsedSession } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { stripAnsi } from "../../lib/ansi";
import { messageSourceOf, sourcesOfRecord } from "./searchSources";
import type { SearchSource } from "./searchSources";

/**
 * In-memory, case-insensitive substring search over every parsed session.
 *
 * Four sources feed it (see `searchSources.ts` for the extraction rules): the
 * user / assistant message text, tool output, the file paths a tool touched,
 * and the text of a failed tool call. v1 is deliberately plain: no fuzzy
 * matching, no ranking tricks — the problem it solves is "I cannot find that
 * conversation at all", and a substring that finds it beats a ranker that
 * almost does. The index never touches disk: search history is nobody's
 * business but the user's.
 */
export type { SearchSource };

export type SearchEntry = {
  sessionPath: string;
  projectLabel: string;
  recordId: string;
  timestamp: number;
  /** 这一条来自哪一类来源——结果里的标签与来源筛选器都用它。 */
  source: SearchSource;
  /** Lowercased match target, already stripped of ANSI escapes. */
  haystack: string;
  /** Original casing, for snippets. */
  text: string;
  /** 工具类条目被 `INDEX_TEXT_LIMIT` 截断过（消息类永不截断）。 */
  truncated?: boolean;
};

/** 来源筛选器：只给 `sources` 时，未列出的来源整条不参与匹配。 */
export type SearchFilter = { sources?: ReadonlySet<SearchSource> };

export type SearchHit = SearchEntry & {
  /** Character offset of the match in `text`. */
  matchAt: number;
  matchLength: number;
};

export function entryOf(
  session: SessionMeta,
  record: { fullId: string; timestamp: number; text: string; kind: string }
): SearchEntry | null {
  const message = messageSourceOf(record);
  if (message === null) return null;
  return {
    sessionPath: session.path,
    projectLabel: session.projectLabel,
    recordId: record.fullId,
    timestamp: record.timestamp,
    source: message.source,
    haystack: message.haystack,
    text: message.text
  };
}

/**
 * All entries of one parsed session, in record order. A record contributes at
 * most two entries — its message plus one tool-class entry (a failed call
 * indexes its error text, otherwise the file paths it touched, otherwise the
 * raw output) — message first.
 */
export function entriesOfSession(session: SessionMeta, parsed: ParsedSession): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const record of parsed.records) {
    for (const source of sourcesOfRecord(record)) {
      const entry: SearchEntry = {
        sessionPath: session.path,
        projectLabel: session.projectLabel,
        recordId: record.fullId,
        timestamp: record.timestamp,
        source: source.source,
        haystack: source.haystack,
        text: source.text
      };
      if (source.truncated === true) entry.truncated = true;
      entries.push(entry);
    }
  }
  return entries;
}

const SNIPPET_RADIUS = 32;

/**
 * A short window around the match, so the eye can verify why it hit.
 *
 * The window is **flattened before it is shown**: assistant text arrives with the
 * tool's SGR bytes still in it (`\u001b[33m构建失败\u001b[0m`), and printing them
 * verbatim made the user read `[33m构建失败[0m` — escape bytes are not text. It
 * goes through the same `stripAnsi` the log table uses (the module already owns
 * "one flat string" conversions), so a crafted transcript still has nowhere to
 * put anything but plain text.
 */
export function snippetOf(hit: SearchHit): string {
  const start = Math.max(0, hit.matchAt - SNIPPET_RADIUS);
  const end = Math.min(hit.text.length, hit.matchAt + hit.matchLength + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < hit.text.length ? "…" : "";
  const body = stripAnsi(hit.text.slice(start, end)).replace(/\s+/g, " ").trim();
  return prefix + body + suffix;
}

export type SearchGroup = {
  projectLabel: string;
  sessions: Array<{
    sessionPath: string;
    /** Newest hit timestamp — the session's sort key within the group. */
    latestAt: number;
    hits: SearchHit[];
  }>;
};

/**
 * Queries the index and groups the hits: 项目 → 会话（组内新→旧）→ 记录（时间序）。
 * The grouping is the navigation contract — the palette renders it as-is and
 * the reveal path depends on session granularity.
 *
 * 同一记录同一查询只出现一次：条目按来源优先级排列（消息在工具类之前），先
 * 命中的先胜。带 `filter` 时**先按来源裁剪再判重**——「只看文件路径」的结果
 * 里留下的标签才一定是「文件路径」，而不是被消息命中顶掉之后连这条记录都不见。
 */
export function searchEntries(
  entries: readonly SearchEntry[],
  rawQuery: string,
  limit = 50,
  filter?: SearchFilter
): SearchGroup[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const allowed = filter?.sources;
  const groups = new Map<
    string,
    Map<string, { sessionPath: string; latestAt: number; hits: SearchHit[] }>
  >();
  const seenRecords = new Set<string>();
  let emitted = 0;
  // Entries arrive in build order (per session, chronological); a stable scan
  // keeps record order deterministic without a sort.
  for (const entry of entries) {
    if (allowed !== undefined && !allowed.has(entry.source)) continue;
    const at = entry.haystack.indexOf(query);
    if (at === -1) continue;
    const recordKey = `${entry.sessionPath}\u0000${entry.recordId}`;
    if (seenRecords.has(recordKey)) continue;
    if (emitted >= limit) break;
    emitted += 1;
    seenRecords.add(recordKey);
    const hit: SearchHit = { ...entry, matchAt: at, matchLength: query.length };
    let sessions = groups.get(entry.projectLabel);
    if (!sessions) {
      sessions = new Map();
      groups.set(entry.projectLabel, sessions);
    }
    let bucket = sessions.get(entry.sessionPath);
    if (!bucket) {
      bucket = { sessionPath: entry.sessionPath, latestAt: hit.timestamp, hits: [] };
      sessions.set(entry.sessionPath, bucket);
    }
    bucket.hits.push(hit);
    bucket.latestAt = Math.max(bucket.latestAt, hit.timestamp);
  }
  return [...groups.entries()]
    .map(([projectLabel, sessions]) => ({
      projectLabel,
      sessions: [...sessions.values()].sort((a, b) => b.latestAt - a.latestAt)
    }))
    .sort((a, b) => b.sessions[0].latestAt - a.sessions[0].latestAt);
}

/**
 * The progressive index: sessions land one parse at a time (the scan reuses
 * the shared parse cache), so the palette can answer with a partial index and
 * a count of what is still pending.
 */
export class GlobalSearchIndex {
  private entries: SearchEntry[] = [];
  private knownPaths = new Set<string>();

  get size(): number {
    return this.entries.length;
  }

  /**
   * `size` 的公开别名：浮层的读数说的是「条目」（一条记录可能产出两个），
   * 而进度分数说的是「会话」，两个数各有各的用途，名字必须分得开。
   */
  get entryCount(): number {
    return this.entries.length;
  }

  /** Test isolation: wipes the process-wide singleton between cases. */
  clear(): void {
    this.entries = [];
    this.knownPaths = new Set();
  }

  /** Distinct sessions indexed — the progress numerator. */
  get sessionCount(): number {
    return this.knownPaths.size;
  }

  has(path: string): boolean {
    return this.knownPaths.has(path);
  }

  add(session: SessionMeta, parsed: ParsedSession): void {
    if (this.knownPaths.has(session.path)) return;
    this.knownPaths.add(session.path);
    this.entries.push(...entriesOfSession(session, parsed));
  }

  /** Removes sessions no longer present (refresh/import changed the list). */
  retain(paths: ReadonlySet<string>): void {
    this.entries = this.entries.filter((entry) => paths.has(entry.sessionPath));
    this.knownPaths = new Set([...this.knownPaths].filter((path) => paths.has(path)));
  }

  search(query: string, limit?: number, filter?: SearchFilter): SearchGroup[] {
    return searchEntries(this.entries, query, limit, filter);
  }
}

/** Process-wide singleton, same lifetime rationale as the parse cache. */
export const sharedSearchIndex = new GlobalSearchIndex();
