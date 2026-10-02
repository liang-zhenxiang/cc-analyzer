import { describe, expect, it } from "vitest";
import type { ParsedSession, SessionRecord } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import {
  GlobalSearchIndex,
  entryOf,
  searchEntries,
  snippetOf
} from "./searchIndex";

function meta(path: string, projectLabel: string): SessionMeta {
  return { path, projectLabel } as SessionMeta;
}

function record(
  fullId: string,
  timestamp: number,
  text: string,
  kind: "user" | "assistant" | "tool" = "assistant"
): SessionRecord {
  return { fullId, timestamp, text, kind } as unknown as SessionRecord;
}

function parsed(records: SessionRecord[]): ParsedSession {
  return { records } as unknown as ParsedSession;
}

const T = (h: number) => new Date(2026, 9, 2, h, 0, 0).getTime();

describe("entryOf", () => {
  it("user/assistant 的非空文本进索引", () => {
    const session = meta("/a.jsonl", "-repo-a");
    expect(entryOf(session, { fullId: "r1", timestamp: T(1), text: "解释这段代码", kind: "user" })).not.toBeNull();
    expect(entryOf(session, { fullId: "r2", timestamp: T(2), text: "好的", kind: "assistant" })).not.toBeNull();
  });

  it("工具记录与空文本不进索引", () => {
    const session = meta("/a.jsonl", "-repo-a");
    expect(entryOf(session, { fullId: "r3", timestamp: T(3), text: "Bash", kind: "tool" })).toBeNull();
    expect(entryOf(session, { fullId: "r4", timestamp: T(4), text: "   ", kind: "user" })).toBeNull();
  });
});

describe("searchEntries", () => {
  const entries = [
    { sessionPath: "/a.jsonl", projectLabel: "-repo-a", recordId: "r1", timestamp: T(1), haystack: "fix the parser bug", text: "fix the parser bug" },
    { sessionPath: "/b.jsonl", projectLabel: "-repo-b", recordId: "r2", timestamp: T(3), haystack: "the bug was here", text: "the bug was here" },
    { sessionPath: "/a.jsonl", projectLabel: "-repo-a", recordId: "r3", timestamp: T(5), haystack: "bug again", text: "bug again" }
  ];

  it("跨项目命中，按 项目 → 会话（新→旧）→ 记录（时间序）分组", () => {
    const groups = searchEntries(entries, "bug");
    expect(groups.map((g) => g.projectLabel)).toEqual(["-repo-a", "-repo-b"]);
    const groupA = groups[0].sessions;
    expect(groupA).toHaveLength(1); // 同一会话归一组
    expect(groupA[0].hits.map((h) => h.recordId)).toEqual(["r1", "r3"]);
  });

  it("大小写不敏感：大写查询命中、大写文本可被小写查询命中", () => {
    expect(searchEntries(entries, "BUG")).toHaveLength(2);
    const mixed = [
      { sessionPath: "/c.jsonl", projectLabel: "-repo-c", recordId: "r9", timestamp: T(1), haystack: "parser error", text: "Parser ERROR" }
    ];
    expect(searchEntries(mixed, "parser error")[0].sessions[0].hits[0].matchAt).toBe(0);
  });

  it("空查询、纯空白 → 无结果", () => {
    expect(searchEntries(entries, "")).toEqual([]);
    expect(searchEntries(entries, "   ")).toEqual([]);
  });

  it("无命中 → 空分组", () => {
    expect(searchEntries(entries, "不存在")).toEqual([]);
  });

  it("limit 截断总数", () => {
    const groups = searchEntries(entries, "bug", 2);
    const total = groups.reduce((sum, g) => sum + g.sessions.reduce((s, s2) => s + s2.hits.length, 0), 0);
    expect(total).toBe(2);
  });
});

describe("snippetOf", () => {
  it("命中处截窗，两侧加省略号，空白折叠", () => {
    const hit = {
      sessionPath: "/a", projectLabel: "-a", recordId: "r", timestamp: 0,
      haystack: "", text: "前缀".padEnd(50, "垫") + "关键字" + "后缀".padStart(50, "垫"),
      matchAt: 52, matchLength: 3
    };
    const snippet = snippetOf(hit);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("关键字");
  });

  it("短文本不加省略号", () => {
    const hit = { sessionPath: "/a", projectLabel: "-a", recordId: "r", timestamp: 0, haystack: "", text: "有关键字的短句", matchAt: 1, matchLength: 3 };
    expect(snippetOf(hit)).toBe("有关键字的短句");
  });
});

describe("GlobalSearchIndex（渐进构建）", () => {
  it("add 幂等（同路径只索引一次）；retain 清掉消失的会话", () => {
    const index = new GlobalSearchIndex();
    const session = meta("/a.jsonl", "-repo-a");
    const body = parsed([record("r1", T(1), "hello world")]);
    index.add(session, body);
    index.add(session, body);
    expect(index.size).toBe(1);

    index.retain(new Set());
    expect(index.size).toBe(0);
    expect(index.has("/a.jsonl")).toBe(false);
    expect(index.search("hello")).toEqual([]);
  });

  it("search 走同一查询管线", () => {
    const index = new GlobalSearchIndex();
    index.add(meta("/a.jsonl", "-repo-a"), parsed([record("r1", T(1), "needle in haystack")]));
    const groups = index.search("needle");
    expect(groups[0].sessions[0].hits[0].recordId).toBe("r1");
  });
});
