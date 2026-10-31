import { describe, expect, it } from "vitest";
import { normalizeMetadataCache, toSessionMeta, type MetadataCacheEntry } from "./metadataCache";

describe("metadata cache v3", () => {
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
      normalizeMetadataCache({ version: 3, entries: { "/a.jsonl": entry } }, generatedAt)
    ).toEqual({
      version: 3,
      generatedAt,
      entries: { "/a.jsonl": entry }
    });
    expect(
      normalizeMetadataCache({
        version: 3,
        entries: { "/bad.jsonl": { mtimeMs: "x", sizeBytes: -1, meta: { projectLabel: "" } } }
      }).entries["/bad.jsonl"]
    ).toBeUndefined();
  });

  it("returns an empty v3 cache for old or invalid caches", () => {
    expect(normalizeMetadataCache(null, 123)).toEqual({
      version: 3,
      generatedAt: 123,
      entries: {}
    });
    expect(normalizeMetadataCache({ version: 1, entries: {} }, 123)).toEqual({
      version: 3,
      generatedAt: 123,
      entries: {}
    });
  });

  it("keeps valid facts, drops malformed facts without dropping the entry", () => {
    const base = {
      mtimeMs: 42,
      sizeBytes: 10,
      meta: { projectLabel: "repo-demo", hasRecords: true }
    };
    const cache = normalizeMetadataCache(
      {
        version: 3,
        entries: {
          "/good.jsonl": {
            ...base,
            facts: {
              models: ["claude-sonnet-4-5"],
              tools: ["builtin:Bash"],
              ctxPeak: 120_000,
              errors: 2,
              durationMs: 60_000,
              messages: 8
            }
          },
          "/bad.jsonl": {
            ...base,
            facts: { models: ["m"], tools: ["t"], ctxPeak: -1, errors: 0, durationMs: 0, messages: 1 }
          }
        }
      },
      123
    );

    const good = cache.entries["/good.jsonl"];
    expect(good.facts).toEqual({
      models: ["claude-sonnet-4-5"],
      tools: ["builtin:Bash"],
      ctxPeak: 120_000,
      errors: 2,
      durationMs: 60_000,
      messages: 8
    });
    const bad = cache.entries["/bad.jsonl"];
    expect(bad).toBeDefined();
    expect(bad.facts).toBeUndefined();
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
