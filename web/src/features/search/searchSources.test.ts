import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import {
  INDEX_TEXT_LIMIT,
  filePathsOf,
  messageSourceOf,
  sourcesOfRecord
} from "./searchSources";

const T = (h: number) => new Date(2026, 9, 2, h, 0, 0).getTime();

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

function messageRecord(kind: "user" | "assistant", text: string): SessionRecord {
  return {
    id: `${kind}-1`,
    fullId: `${kind}-1`,
    kind,
    timestamp: T(1),
    durationMs: 0,
    text,
    isError: false,
    raw: null
  } as SessionRecord;
}

const EDIT_RESULT = {
  toolName: "Edit" as const,
  filePath: "/repo/src/app.ts",
  oldString: "",
  newString: "",
  replaceAll: false,
  structuredPatch: null
};

describe("messageSourceOf", () => {
  it("user / assistant 的非空正文各带自己的来源标签", () => {
    expect(messageSourceOf({ kind: "user", text: "解释这段代码" })).toEqual({
      source: "user",
      text: "解释这段代码",
      haystack: "解释这段代码"
    });
    const assistant = messageSourceOf({ kind: "assistant", text: "OK" });
    expect(assistant?.source).toBe("assistant");
    expect(assistant?.haystack).toBe("ok");
  });

  it("工具记录与空文本不给条目", () => {
    expect(messageSourceOf({ kind: "tool", text: "Bash" })).toBeNull();
    expect(messageSourceOf({ kind: "user", text: "   " })).toBeNull();
  });

  it("正文里的转义字节在进索引前就剥掉（haystack 与 text 都不含 ANSI）", () => {
    const ESC = "\u001b";
    const source = messageSourceOf({ kind: "assistant", text: `${ESC}[33m构建失败${ESC}[0m：先修 src/app.ts。` });
    expect(source?.text).toBe("构建失败：先修 src/app.ts。");
    expect(source?.haystack).toBe("构建失败：先修 src/app.ts。");
    expect(source?.haystack).not.toContain(ESC);
    expect(source?.haystack).not.toContain("[33m");
  });
});

describe("filePathsOf", () => {
  it("structuredResult.filePath 在前，toolInput 的 file_path / filePath / path 在后且去重", () => {
    const record = toolRecord({
      fullId: "t1",
      toolName: "Edit",
      toolInput: { file_path: "/repo/src/app.ts", path: "/repo/src", filePath: "/repo/src/app.ts" },
      structuredResult: EDIT_RESULT
    });
    expect(filePathsOf(record)).toEqual(["/repo/src/app.ts", "/repo/src"]);
  });

  it("非字符串、空串与数组输入都不取值（结构化提取，不猜正文）", () => {
    const record = toolRecord({
      fullId: "t1",
      toolInput: { file_path: 42, path: "   ", filePath: null }
    });
    expect(filePathsOf(record)).toEqual([]);
    expect(filePathsOf(toolRecord({ fullId: "t2", toolInput: ["/repo/a.ts"] }))).toEqual([]);
    expect(filePathsOf(toolRecord({ fullId: "t3", toolInput: "grep /repo/a.ts" }))).toEqual([]);
  });

  it("Read 的结构化结果也取 filePath", () => {
    const record = toolRecord({
      fullId: "t1",
      toolName: "Read",
      structuredResult: { toolName: "Read", filePath: "/repo/docs/readme.md" }
    });
    expect(filePathsOf(record)).toEqual(["/repo/docs/readme.md"]);
  });
});

describe("sourcesOfRecord", () => {
  it("消息 + 工具类最多两条，消息在前（去重优先级靠这个顺序）", () => {
    const record = messageRecord("assistant", "改一下 src/app.ts");
    const sources = sourcesOfRecord(record);
    expect(sources.map((s) => s.source)).toEqual(["assistant"]);
    const tool = toolRecord({
      fullId: "t1",
      toolName: "Edit",
      toolInput: { file_path: "/repo/src/app.ts" },
      structuredResult: EDIT_RESULT
    });
    expect(sourcesOfRecord(tool).map((s) => s.source)).toEqual(["file-path"]);
  });

  it("有路径的工具记录给 file-path（多路径合成一条换行分隔的 haystack）", () => {
    const record = toolRecord({
      fullId: "t1",
      toolName: "Edit",
      toolInput: { file_path: "/repo/src/a.ts", path: "/repo/src/b.ts" },
      toolResult: "updated"
    });
    const [source] = sourcesOfRecord(record);
    expect(source.source).toBe("file-path");
    expect(source.text).toBe("/repo/src/a.ts\n/repo/src/b.ts");
    expect(source.haystack).toBe("/repo/src/a.ts\n/repo/src/b.ts");
  });

  it("没有路径、没有出错 → tool-output", () => {
    const record = toolRecord({ fullId: "t1", toolName: "Bash", toolResult: "✓ 12 passed" });
    const [source] = sourcesOfRecord(record);
    expect(source.source).toBe("tool-output");
    expect(source.haystack).toBe("✓ 12 passed");
  });

  it("出错优先：即使这条记录有文件路径，也以 error 出现一次", () => {
    const record = toolRecord({
      fullId: "t1",
      toolName: "Edit",
      isError: true,
      toolInput: { file_path: "/repo/src/app.ts" },
      toolResult: "String to replace not found in file.",
      structuredResult: EDIT_RESULT
    });
    const sources = sourcesOfRecord(record);
    expect(sources.map((s) => s.source)).toEqual(["error"]);
    expect(sources[0].haystack).toContain("string to replace not found");
  });

  it("出错的工具记录若连输出都没有，退回文件路径而不是造一条空的 error", () => {
    const record = toolRecord({
      fullId: "t1",
      toolName: "Read",
      isError: true,
      toolInput: { file_path: "/repo/src/missing.ts" }
    });
    expect(sourcesOfRecord(record).map((s) => s.source)).toEqual(["file-path"]);
  });

  it("工具输出剥 ANSI，并解决 \\r 进度回写", () => {
    const ESC = "\u001b";
    const record = toolRecord({
      fullId: "t1",
      toolName: "Bash",
      toolResult: `${ESC}[1;32m✓ 12 passed${ESC}[0m\nprogress 10%\rprogress 100%\n`
    });
    const [source] = sourcesOfRecord(record);
    expect(source.text).toBe("✓ 12 passed\nprogress 100%");
    expect(source.haystack).not.toContain(ESC);
  });

  it("toolResult 缺失时用 Bash 结构化结果的 stdout / stderr 兜底", () => {
    const record = toolRecord({
      fullId: "t1",
      toolName: "Bash",
      structuredResult: { toolName: "Bash", stdout: "out line", stderr: "err line", interrupted: false, timedOutAfterMs: null }
    });
    const [source] = sourcesOfRecord(record);
    expect(source.source).toBe("tool-output");
    expect(source.text).toBe("out line\nerr line");
  });

  it("工具类条目按 INDEX_TEXT_LIMIT 截断并置 truncated，消息类不截断", () => {
    const atLimit = "x".repeat(INDEX_TEXT_LIMIT);
    const overLimit = "y".repeat(INDEX_TEXT_LIMIT + 1);
    const [exact] = sourcesOfRecord(toolRecord({ fullId: "t1", toolName: "Bash", toolResult: atLimit }));
    expect(exact.truncated).toBeUndefined();
    expect(exact.text).toHaveLength(INDEX_TEXT_LIMIT);

    const [over] = sourcesOfRecord(toolRecord({ fullId: "t2", toolName: "Bash", toolResult: overLimit }));
    expect(over.truncated).toBe(true);
    expect(over.text).toHaveLength(INDEX_TEXT_LIMIT);
    expect(over.haystack).toHaveLength(INDEX_TEXT_LIMIT);

    const message = messageSourceOf({ kind: "user", text: overLimit });
    expect(message?.text).toHaveLength(INDEX_TEXT_LIMIT + 1);
  });

  it("非工具记录不产出工具类条目（消息记录带 toolResult 也不予理会）", () => {
    const record = messageRecord("assistant", "普通回复");
    const withStrayResult = { ...record, toolResult: "stray output" } as SessionRecord;
    expect(sourcesOfRecord(withStrayResult).map((s) => s.source)).toEqual(["assistant"]);
  });
});
