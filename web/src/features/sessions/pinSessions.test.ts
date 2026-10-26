import { describe, expect, it } from "vitest";
import {
  PINNED_STORAGE_KEY,
  parsePinnedPaths,
  partitionPinned,
  prunePinnedPaths
} from "./pinSessions";

describe("partitionPinned", () => {
  it("moves pinned items first without disturbing either side's order", () => {
    const items = ["a", "b", "c", "d", "e"];
    const pinned = new Set(["c", "a"]);

    expect(partitionPinned(items, (item) => pinned.has(item))).toEqual(["a", "c", "b", "d", "e"]);
  });

  it("returns an empty list for empty input", () => {
    expect(partitionPinned([], () => true)).toEqual([]);
  });

  it("keeps the input order when everything is pinned", () => {
    expect(partitionPinned(["first", "second", "third"], () => true)).toEqual([
      "first",
      "second",
      "third"
    ]);
  });

  it("keeps the input order when nothing is pinned", () => {
    expect(partitionPinned(["first", "second"], () => false)).toEqual(["first", "second"]);
  });

  it("is stable for records with a sort key, so callers can sort once", () => {
    const records = [
      { path: "old", mtimeMs: 1 },
      { path: "new", mtimeMs: 9 },
      { path: "mid", mtimeMs: 5 }
    ];
    const ordered = [...records].sort((a, b) => b.mtimeMs - a.mtimeMs);

    expect(partitionPinned(ordered, (record) => record.path === "mid").map((r) => r.path)).toEqual([
      "mid",
      "new",
      "old"
    ]);
  });
});

describe("parsePinnedPaths", () => {
  it("returns the stored paths and drops non-string members", () => {
    expect(parsePinnedPaths(JSON.stringify(["/a.jsonl", 7, null, "", "/b.jsonl"]))).toEqual([
      "/a.jsonl",
      "/b.jsonl"
    ]);
  });

  it("degrades to an empty list for missing, malformed or non-array values", () => {
    expect(parsePinnedPaths(null)).toEqual([]);
    expect(parsePinnedPaths("")).toEqual([]);
    expect(parsePinnedPaths("{not json")).toEqual([]);
    expect(parsePinnedPaths(JSON.stringify({ path: "/a.jsonl" }))).toEqual([]);
  });
});

describe("prunePinnedPaths", () => {
  it("drops remembered paths that the current scan no longer contains", () => {
    const known = new Set(["/repo/one.jsonl"]);
    expect(prunePinnedPaths(new Set(["/repo/one.jsonl", "/repo/gone.jsonl"]), known)).toEqual(
      new Set(["/repo/one.jsonl"])
    );
  });

  it("keeps an empty set empty and leaves the input untouched", () => {
    const pinned = new Set<string>();
    expect(prunePinnedPaths(pinned, new Set(["/a.jsonl"]))).toEqual(new Set());
    expect(prunePinnedPaths(new Set(["/gone.jsonl"]), new Set())).toEqual(new Set());
  });

  it("exports the storage key the sidebar writes to", () => {
    expect(PINNED_STORAGE_KEY).toBe("cca-pinned-sessions");
  });
});
