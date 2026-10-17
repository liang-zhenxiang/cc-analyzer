import { describe, expect, it } from "vitest";
import type { ParsedSession, SessionRecord } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { parseJsonlText } from "../sessions/parseJsonl";
import {
  GlobalSearchIndex,
  entryOf,
  entriesOfSession,
  searchEntries,
  snippetOf
} from "./searchIndex";
import type { SearchGroup } from "./searchIndex";
import { INDEX_TEXT_LIMIT, sourcesOfRecord } from "./searchSources";
import type { SearchEntry } from "./searchIndex";

import ansiFixture from "../../../tests/fixtures/session-ansi.jsonl?raw";
import changedFilesFixture from "../../../tests/fixtures/changed-files-session.jsonl?raw";

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

/** 一条工具记录：测试里只声明关心的字段，其余按解析器的默认值补。 */
function toolRecord(overrides: Partial<SessionRecord> & { fullId: string }): SessionRecord {
  return {
    id: overrides.fullId.slice(0, 8),
    kind: "tool",
    timestamp: T(1),
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...overrides
  } as SessionRecord;
}

const T = (h: number) => new Date(2026, 9, 2, h, 0, 0).getTime();

function hitsOf(groups: SearchGroup[]) {
  return groups.flatMap((group) => group.sessions.flatMap((session) => session.hits));
}

describe("entryOf", () => {
  it("user/assistant 的非空文本进索引，并带上来源标签", () => {
    const session = meta("/a.jsonl", "-repo-a");
    expect(entryOf(session, { fullId: "r1", timestamp: T(1), text: "解释这段代码", kind: "user" })?.source).toBe("user");
    expect(entryOf(session, { fullId: "r2", timestamp: T(2), text: "好的", kind: "assistant" })?.source).toBe("assistant");
  });

  it("工具记录与空文本不进索引", () => {
    const session = meta("/a.jsonl", "-repo-a");
    expect(entryOf(session, { fullId: "r3", timestamp: T(3), text: "Bash", kind: "tool" })).toBeNull();
    expect(entryOf(session, { fullId: "r4", timestamp: T(4), text: "   ", kind: "user" })).toBeNull();
  });
});

describe("searchEntries", () => {
  const entries = [
    { sessionPath: "/a.jsonl", projectLabel: "-repo-a", recordId: "r1", timestamp: T(1), source: "user" as const, haystack: "fix the parser bug", text: "fix the parser bug" },
    { sessionPath: "/b.jsonl", projectLabel: "-repo-b", recordId: "r2", timestamp: T(3), source: "assistant" as const, haystack: "the bug was here", text: "the bug was here" },
    { sessionPath: "/a.jsonl", projectLabel: "-repo-a", recordId: "r3", timestamp: T(5), source: "tool-output" as const, haystack: "bug again", text: "bug again" }
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
      { sessionPath: "/c.jsonl", projectLabel: "-repo-c", recordId: "r9", timestamp: T(1), source: "assistant" as const, haystack: "parser error", text: "Parser ERROR" }
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
      sessionPath: "/a", projectLabel: "-a", recordId: "r", timestamp: 0, source: "assistant" as const,
      haystack: "", text: "前缀".padEnd(50, "垫") + "关键字" + "后缀".padStart(50, "垫"),
      matchAt: 52, matchLength: 3
    };
    const snippet = snippetOf(hit);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("关键字");
  });

  it("短文本不加省略号", () => {
    const hit = { sessionPath: "/a", projectLabel: "-a", recordId: "r", timestamp: 0, source: "assistant" as const, haystack: "", text: "有关键字的短句", matchAt: 1, matchLength: 3 };
    expect(snippetOf(hit)).toBe("有关键字的短句");
  });

  it("剥掉终端转义序列——用户不该读到 [33m 乱码", () => {
    const ESC = "\u001b";
    // 与 `session-ansi.jsonl` 里那条 assistant 记录同形：转义字节就夹在正文里。
    const text = `${ESC}[33m构建失败${ESC}[0m：先修 src/app.ts:12。`;
    const hit = {
      sessionPath: "/a", projectLabel: "-a", recordId: "r", timestamp: 0, source: "assistant" as const,
      haystack: "", text, matchAt: 5, matchLength: 4
    };
    const snippet = snippetOf(hit);
    expect(snippet).toBe("构建失败：先修 src/app.ts:12。");
    expect(snippet).not.toContain(ESC);
    expect(snippet).not.toContain("[33m");
    // 命中词本身留在摘要里——剥的是转义，不是正文。
    expect(snippet).toContain("构建失败");
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

  it("search 把来源过滤器透到查询管线", () => {
    const index = new GlobalSearchIndex();
    index.add(
      meta("/a.jsonl", "-repo-a"),
      parsed([
        record("r1", T(1), "needle 在消息里"),
        toolRecord({ fullId: "t1", toolName: "Edit", structuredResult: { toolName: "Edit", filePath: "/repo/needle.ts", oldString: "", newString: "", replaceAll: false, structuredPatch: null } })
      ])
    );
    expect(hitsOf(index.search("needle")).map((h) => h.source)).toEqual(["assistant", "file-path"]);
    expect(hitsOf(index.search("needle", 50, { sources: new Set(["file-path"]) })).map((h) => h.source)).toEqual([
      "file-path"
    ]);
  });
});

describe("entriesOfSession（四类来源）", () => {
  it("一条记录最多两个条目：消息 + 工具类，消息在前", () => {
    const records = [
      record("m1", T(1), "先看看 src/app.ts"),
      toolRecord({ fullId: "t1", timestamp: T(2), toolName: "Read", toolInput: { file_path: "/repo/src/app.ts" } })
    ];
    const entries = entriesOfSession(meta("/a.jsonl", "-repo-a"), parsed(records));
    expect(entries.map((e) => [e.recordId, e.source])).toEqual([
      ["m1", "assistant"],
      ["t1", "file-path"]
    ]);
  });

  it("工具输出进索引，来源是 tool-output", () => {
    const entries = entriesOfSession(
      meta("/a.jsonl", "-repo-a"),
      parsed([toolRecord({ fullId: "t1", toolName: "Bash", toolResult: "✓ 12 passed\nall good" })])
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].source).toBe("tool-output");
    expect(entries[0].haystack).toContain("12 passed");
  });

  it("错误与工具输出互斥：出错的记录只以 error 出现一次", () => {
    const entries = entriesOfSession(
      meta("/a.jsonl", "-repo-a"),
      parsed([
        toolRecord({
          fullId: "t1",
          toolName: "Bash",
          isError: true,
          toolResult: "fatal: 构建中断"
        })
      ])
    );
    expect(entries.map((e) => e.source)).toEqual(["error"]);
    expect(entries[0].haystack).toContain("构建中断");
  });

  it("非工具记录不产出工具类条目；工具记录的空输出也不产出", () => {
    const entries = entriesOfSession(
      meta("/a.jsonl", "-repo-a"),
      parsed([record("m1", T(1), "只有消息"), toolRecord({ fullId: "t1", toolName: "Bash" })])
    );
    expect(entries.map((e) => e.source)).toEqual(["assistant"]);
  });
});

describe("跨来源去重与来源过滤", () => {
  /**
   * 记录级去重是查询管线的保证：同一条记录哪怕挂着多条候选条目（消息 + 工具类），
   * 同一查询也只留先命中的那条。真实解析结果里一条记录只产出一种来源，所以这里
   * 直接构造同一 recordId 的两条条目，把「先到先胜」这条契约钉死——顺带说明它
   * 是兜底而不是机制（提取层那条用例在下面）。
   */
  const entries: SearchEntry[] = [
    { sessionPath: "/a.jsonl", projectLabel: "-repo-a", recordId: "rec-1", timestamp: T(1), source: "assistant", haystack: "改一下 src/app.ts", text: "改一下 src/app.ts" },
    { sessionPath: "/a.jsonl", projectLabel: "-repo-a", recordId: "rec-1", timestamp: T(1), source: "file-path", haystack: "/repo/src/app.ts", text: "/repo/src/app.ts" },
    { sessionPath: "/a.jsonl", projectLabel: "-repo-a", recordId: "rec-2", timestamp: T(2), source: "tool-output", haystack: "app.ts 编译通过", text: "app.ts 编译通过" }
  ];

  it("同一条记录同一查询只出现一次，消息压过文件路径", () => {
    expect(hitsOf(searchEntries(entries, "app.ts")).map((h) => [h.recordId, h.source])).toEqual([
      ["rec-1", "assistant"],
      ["rec-2", "tool-output"]
    ]);
  });

  it("只看文件路径：消息类的命中整条让位，留下的一定是 file-path", () => {
    expect(
      hitsOf(searchEntries(entries, "app.ts", 50, { sources: new Set(["file-path"]) })).map((h) => [
        h.recordId,
        h.source
      ])
    ).toEqual([["rec-1", "file-path"]]);
  });

  it("过滤掉全部来源 → 无结果（不是全量结果的降级）", () => {
    expect(searchEntries(entries, "app.ts", 50, { sources: new Set() })).toEqual([]);
  });

  it("提取层不会给同一条记录两条工具类条目（去重是兜底，不是机制）", () => {
    const busy = toolRecord({
      fullId: "t1",
      toolName: "Edit",
      isError: true,
      toolInput: { file_path: "/repo/src/app.ts" },
      toolResult: "String to replace not found in file.",
      structuredResult: { toolName: "Edit", filePath: "/repo/src/app.ts", oldString: "", newString: "", replaceAll: false, structuredPatch: null }
    });
    expect(sourcesOfRecord(busy)).toHaveLength(1);
  });

  it("四档优先级逐个验证：消息 > file-path > error > tool-output", () => {
    /**
     * 四档各留一条同 recordId 的候选，按优先级排列（构建顺序就是优先级顺序）。
     * 逐档把它前面的来源过滤掉，命中来源就应依次下沉——这是「先到先胜」的全链
     * 验证，也钉住过滤与判重的先后关系。
     */
    const all: SearchEntry[] = (["user", "file-path", "error", "tool-output"] as const).map((source) => ({
      sessionPath: "/a.jsonl",
      projectLabel: "-repo-a",
      recordId: "rec-1",
      timestamp: T(1),
      source,
      haystack: `needle 在 ${source} 里`,
      text: `needle 在 ${source} 里`
    }));
    const winner = (sources?: readonly SearchEntry["source"][]) =>
      hitsOf(searchEntries(all, "needle", 50, sources ? { sources: new Set(sources) } : undefined)).map(
        (h) => h.source
      );
    expect(winner()).toEqual(["user"]);
    expect(winner(["assistant", "file-path", "error", "tool-output"])).toEqual(["file-path"]);
    expect(winner(["error", "tool-output"])).toEqual(["error"]);
    expect(winner(["tool-output"])).toEqual(["tool-output"]);
  });
});

describe("截断与 ANSI 边界", () => {
  it("工具输出超过 INDEX_TEXT_LIMIT 只索引前一段，并标记 truncated", () => {
    const long = "x".repeat(INDEX_TEXT_LIMIT + 500);
    const entries = entriesOfSession(
      meta("/a.jsonl", "-repo-a"),
      parsed([toolRecord({ fullId: "t1", toolName: "Bash", toolResult: long })])
    );
    expect(entries[0].truncated).toBe(true);
    expect(entries[0].haystack).toHaveLength(INDEX_TEXT_LIMIT);
    expect(entries[0].text).toHaveLength(INDEX_TEXT_LIMIT);
  });

  it("未超限的工具条目不带 truncated；消息再长也不截断", () => {
    const longMessage = "y".repeat(INDEX_TEXT_LIMIT + 500);
    const entries = entriesOfSession(
      meta("/a.jsonl", "-repo-a"),
      parsed([toolRecord({ fullId: "t1", toolName: "Bash", toolResult: "short" }), record("m1", T(2), longMessage)])
    );
    expect(entries[0].truncated).toBeUndefined();
    expect(entries[1].source).toBe("assistant");
    expect(entries[1].truncated).toBeUndefined();
    expect(entries[1].haystack).toHaveLength(INDEX_TEXT_LIMIT + 500);
  });

  it("真实夹具：ANSI 字节不进任何 haystack，剥过的正文仍搜得到", () => {
    const session = meta("/ansi.jsonl", "-repo-ansi");
    const parsedAnsi = parseJsonlText(ansiFixture, session.path);
    const entries = entriesOfSession(session, parsedAnsi);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.haystack).not.toContain("\u001b");
      expect(entry.text).not.toContain("\u001b");
    }
    // 出错的那条 Bash：搜错误正文命中，来源是 error 而不是 tool-output。
    expect(hitsOf(searchEntries(entries, "build failed")).map((h) => h.source)).toEqual(["error"]);
    // `\r` 进度回写也在剥 ANSI 时一并解决：屏幕上最后显示的是 100%。
    expect(entries.some((e) => e.haystack.includes("progress 100%"))).toBe(true);
    expect(entries.some((e) => e.haystack.includes("progress 10%"))).toBe(false);
  });

  it("真实夹具：按文件路径搜得到工具记录，标签是 file-path", () => {
    const session = meta("/changed.jsonl", "-repo-changed");
    const entries = entriesOfSession(session, parseJsonlText(changedFilesFixture, session.path));
    const hits = hitsOf(searchEntries(entries, "/etc/hosts"));
    expect(hits.map((h) => h.source)).toEqual(["file-path"]);
    expect(hits[0].haystack).toContain("/etc/hosts");
  });
});
