import type { ParsedSession } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { stripAnsi } from "../../lib/ansi";

/**
 * In-memory, case-insensitive substring search over every parsed session's
 * conversation text. v1 is deliberately plain: no fuzzy matching, no ranking
 * tricks — the problem it solves is "I cannot find that conversation at all",
 * and a substring that finds it beats a ranker that almost does. The index
 * never touches disk: search history is nobody's business but the user's.
 */
export type SearchEntry = {
  sessionPath: string;
  projectLabel: string;
  recordId: string;
  timestamp: number;
  /** Lowercased message text — the match target. */
  haystack: string;
  /** Original casing, for snippets. */
  text: string;
};

export type SearchHit = SearchEntry & {
  /** Character offset of the match in `text`. */
  matchAt: number;
  matchLength: number;
};

export function entryOf(
  session: SessionMeta,
  record: { fullId: string; timestamp: number; text: string; kind: string }
): SearchEntry | null {
  if (record.kind !== "user" && record.kind !== "assistant") return null;
  const text = record.text.trim();
  if (!text) return null;
  return {
    sessionPath: session.path,
    projectLabel: session.projectLabel,
    recordId: record.fullId,
    timestamp: record.timestamp,
    haystack: text.toLowerCase(),
    text
  };
}

/** All entries of one parsed session, in record order. */
export function entriesOfSession(session: SessionMeta, parsed: ParsedSession): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const record of parsed.records) {
    const entry = entryOf(session, {
      fullId: record.fullId,
      timestamp: record.timestamp,
      text: record.text,
      kind: record.kind
    });
    if (entry) entries.push(entry);
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
 */
export function searchEntries(
  entries: readonly SearchEntry[],
  rawQuery: string,
  limit = 50
): SearchGroup[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];
  const groups = new Map<
    string,
    Map<string, { sessionPath: string; latestAt: number; hits: SearchHit[] }>
  >();
  let emitted = 0;
  // Entries arrive in build order (per session, chronological); a stable scan
  // keeps record order deterministic without a sort.
  for (const entry of entries) {
    const at = entry.haystack.indexOf(query);
    if (at === -1) continue;
    if (emitted >= limit) break;
    emitted += 1;
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

  search(query: string, limit?: number): SearchGroup[] {
    return searchEntries(this.entries, query, limit);
  }
}

/** Process-wide singleton, same lifetime rationale as the parse cache. */
export const sharedSearchIndex = new GlobalSearchIndex();
