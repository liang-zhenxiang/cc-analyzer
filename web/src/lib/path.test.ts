import { describe, expect, it } from "vitest";
import {
  basename,
  isPathInside,
  isPathInsideAny,
  joinPath,
  parentDirectory,
  pathSegments,
  sessionDirectory
} from "./path";

describe("path utilities", () => {
  it("takes the last segment, ignoring trailing separators", () => {
    expect(basename("/repo/project/session.jsonl")).toBe("session.jsonl");
    expect(basename("/repo/project/")).toBe("project");
    expect(basename("C:\\repo\\project\\session.jsonl")).toBe("session.jsonl");
    expect(basename("/")).toBe("");
    expect(basename("")).toBe("");
  });

  it("handles POSIX parent directories and segments", () => {
    expect(parentDirectory("/repo/project/session.jsonl")).toBe("/repo/project");
    expect(pathSegments("/repo/project/session.jsonl")).toEqual([
      "repo",
      "project",
      "session.jsonl"
    ]);
  });

  it("handles Windows separators, drive roots, and segments", () => {
    expect(parentDirectory("C:\\repo\\project\\session.jsonl")).toBe("C:\\repo\\project");
    expect(parentDirectory("C:\\session.jsonl")).toBe("C:\\");
    expect(pathSegments("C:\\repo\\project\\session.jsonl")).toEqual([
      "C:",
      "repo",
      "project",
      "session.jsonl"
    ]);
    expect(joinPath("C:\\Users\\tester", ".claude", "projects")).toBe(
      "C:\\Users\\tester\\.claude\\projects"
    );
  });

  it("derives the session directory from the session file", () => {
    expect(sessionDirectory("/repo/project/abc.jsonl")).toBe("/repo/project/abc");
    expect(sessionDirectory("C:\\repo\\project\\abc.JSONL")).toBe("C:\\repo\\project\\abc");
    expect(sessionDirectory("/repo/project/abc")).toBe("/repo/project/abc");
  });

  it("scopes a path to its root", () => {
    expect(isPathInside("/repo/project/abc/subagents/a.jsonl", "/repo/project/abc")).toBe(true);
    expect(isPathInside("/repo/project/abc", "/repo/project/abc")).toBe(true);

    expect(isPathInside("/repo/project/abcd/a.jsonl", "/repo/project/abc")).toBe(false);
    expect(isPathInside("/etc/passwd", "/repo/project")).toBe(false);
    expect(isPathInside("~/secret.jsonl", "/repo/project")).toBe(false);
    expect(isPathInside("relative/child.jsonl", "/repo/project")).toBe(false);
    expect(isPathInside("/repo/project/abc/../../other.jsonl", "/repo/project/abc")).toBe(false);
  });

  it("resolves dot segments before comparing", () => {
    expect(isPathInside("/repo/project/abc/./subagents/../a.jsonl", "/repo/project/abc")).toBe(true);
    expect(isPathInside("C:\\repo\\project\\abc\\subagents\\a.jsonl", "C:\\repo\\project\\abc")).toBe(true);
    expect(isPathInside("C:\\repo\\project\\abc2\\a.jsonl", "C:\\repo\\project\\abc")).toBe(false);
  });

  it("accepts any of the candidate roots", () => {
    const roots = ["/repo/project/abc", "/repo/project"];

    expect(isPathInsideAny("/repo/project/other.jsonl", roots)).toBe(true);
    expect(isPathInsideAny("/repo/elsewhere.jsonl", roots)).toBe(false);
    expect(isPathInsideAny("/anything", [])).toBe(false);
  });
});
