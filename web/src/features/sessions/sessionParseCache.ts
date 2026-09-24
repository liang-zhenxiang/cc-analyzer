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
