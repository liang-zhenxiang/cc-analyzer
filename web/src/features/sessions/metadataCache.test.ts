import { describe, expect, it } from "vitest";
import { normalizeMetadataCache, toSessionMeta, type MetadataCacheEntry } from "./metadataCache";

describe("metadata cache v2", () => {
  it("normalizes valid entries and rejects malformed entries", () => {
    const generatedAt = 123;
    const entry: MetadataCacheEntry = {
      mtimeMs: 42,
      sizeBytes: 10,
      meta: {
        sessionId: "session-1",
        cwd: "/repo",
        projectLabel: "repo-demo",
        customTitle: "Custom",
        aiTitle: "AI",
        userPrompt: "Fix the bug",
        hasRecords: true
      }
    };

    expect(
      normalizeMetadataCache({ version: 2, entries: { "/a.jsonl": entry } }, generatedAt)
    ).toEqual({
      version: 2,
      generatedAt,
      entries: { "/a.jsonl": entry }
    });
    expect(
      normalizeMetadataCache({
        version: 2,
        entries: { "/bad.jsonl": { mtimeMs: "x", sizeBytes: -1, meta: { projectLabel: "" } } }
      }).entries["/bad.jsonl"]
    ).toBeUndefined();
  });

  it("returns an empty v2 cache for old or invalid caches", () => {
    expect(normalizeMetadataCache(null, 123)).toEqual({
      version: 2,
      generatedAt: 123,
      entries: {}
    });
    expect(normalizeMetadataCache({ version: 1, entries: {} }, 123)).toEqual({
      version: 2,
      generatedAt: 123,
      entries: {}
    });
  });

  it("converts a cache entry into a flat runtime session", () => {
    const entry: MetadataCacheEntry = {
      mtimeMs: 42,
      sizeBytes: 10,
      meta: { projectLabel: "repo-demo", cwd: "/repo", sessionId: "session-1", hasRecords: true }
    };

    expect(toSessionMeta("/repo/session.jsonl", entry)).toEqual({
      path: "/repo/session.jsonl",
      mtimeMs: 42,
      sizeBytes: 10,
      projectLabel: "repo-demo",
      cwd: "/repo",
      sessionId: "session-1",
      hasRecords: true,
      metadataStatus: "complete"
    });
  });
});
