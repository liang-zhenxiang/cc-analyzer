import type { ParsedSession } from "./types";

export type SessionParseCacheEntry = {
  mtimeMs: number;
  sizeBytes: number;
  session: ParsedSession;
};

/**
 * Reuses parsed child sessions across graph resolutions. Entries are validated
 * against file mtime and size, so edited files are always re-read.
 */
export type SessionParseCache = Map<string, SessionParseCacheEntry>;

export function createSessionParseCache(): SessionParseCache {
  return new Map();
}

/**
 * Process-wide parse cache. Tab pages unmount when the user leaves them, so a
 * ref inside a hook would drop the work on every tab switch; a module-level
 * cache survives. Entries are mtime+size validated, so it can be stale within
 * a mount but never wrong. The usage dashboard and global search share this
 * one instance — one parse per file, however many consumers.
 */
export const sharedSessionParseCache: SessionParseCache = createSessionParseCache();
