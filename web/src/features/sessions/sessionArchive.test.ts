import { describe, expect, it } from "vitest";
import {
  ARCHIVE_TIMELINE_LIMIT,
  archiveFileName,
  buildSessionArchive,
  projectNameOfCwd,
  timelineLines,
  toolCounts
} from "./sessionArchive";
import { buildLogRows } from "./logRows";
import type { ParsedSession, SessionRecord } from "./types";

function base(extra: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "rec",
    fullId: "rec",
    kind: "assistant",
    timestamp: 0,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...extra
  };
}

function session(records: SessionRecord[], extra: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: "sess-1",
    path: "/Users/someone/.claude/projects/-repo-alpha/sess-1.jsonl",
    cwd: "/repo/alpha",
    startedAt: new Date(2026, 0, 2, 3, 4, 5).getTime(),
    endedAt: new Date(2026, 0, 2, 3, 5, 5).getTime(),
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    sidechainMessages: [],
    ...extra
  };
}

const usage = (input: number, output: number, cacheWrite: number, cacheRead: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: cacheWrite,
  cacheReadTokens: cacheRead
});

describe("buildSessionArchive", () => {
  const records: SessionRecord[] = [
    base({
      id: "u1",
      kind: "user",
      text: "秘密内容：这是不该出现在档案里的原文",
      timestamp: new Date(2026, 0, 2, 3, 4, 5).getTime()
    }),
    base({
      id: "a1",
      kind: "assistant",
      model: "claude-sonnet-4-5",
      usage: usage(1000, 500, 2000, 4000),
      timestamp: new Date(2026, 0, 2, 3, 4, 7).getTime()
    }),
    base({
      id: "t1",
      kind: "tool",
      toolName: "Read",
      toolCategory: "direct",
      timestamp: new Date(2026, 0, 2, 3, 4, 8).getTime()
    }),
    base({
      id: "r1",
      kind: "user",
      isError: true,
      text: "ENOENT: /repo/alpha/secret.ts",
      timestamp: new Date(2026, 0, 2, 3, 4, 9).getTime()
    })
  ];

  it("写出元信息、四类 token、上下文峰值、压缩与错误计数", () => {
    const md = buildSessionArchive(session(records, { compactEvents: [] }));
    expect(md).toContain("# 会话档案");
    expect(md).toContain("| 项目 | alpha |");
    expect(md).toContain("| 模型 | claude-sonnet-4-5 |");
    expect(md).toContain("| 时长 | 1m0s |");
    expect(md).toContain("| 记录数 | 4 |");
    expect(md).toContain("| 消息数 | 用户 2 · LLM 1 |");
    expect(md).toContain("| 输入 tokens | 1,000 |");
    expect(md).toContain("| 输出 tokens | 500 |");
    expect(md).toContain("| 缓存写入 tokens | 2,000 |");
    expect(md).toContain("| 缓存读取 tokens | 4,000 |");
    expect(md).toContain("| 上下文峰值 | 7,000 |");
    expect(md).toContain("| 压缩次数 | 0 |");
    expect(md).toContain("| 错误数 | 1 |");
    expect(md).toContain("| Read | 1 |");
  });

  it("隐私红线：消息原文、cwd 全路径、文件路径都不出现", () => {
    const md = buildSessionArchive(session(records));
    expect(md).not.toContain("秘密内容");
    expect(md).not.toContain("/repo/alpha");
    expect(md).not.toContain("/Users/someone");
    expect(md).not.toContain("ENOENT");
    expect(md).not.toContain("secret.ts");
  });

  it("多模型时写明主模型与种类数", () => {
    const md = buildSessionArchive(
      session([
        base({ id: "a1", usage: usage(1, 1, 0, 0), model: "claude-sonnet-4-5" }),
        base({ id: "a2", usage: usage(1, 1, 0, 0), model: "claude-opus-4-1" })
      ])
    );
    expect(md).toContain("| 模型 | claude-opus-4-1 等 2 种 |");
  });

  it("没有工具调用时写一句人话，而不是空表", () => {
    const md = buildSessionArchive(session([base({ id: "a1", usage: usage(1, 1, 0, 0) })]));
    expect(md).toContain("没有工具调用。");
  });

  it("时间线只写类型与动作，不带消息原文", () => {
    const md = buildSessionArchive(session(records));
    expect(md).toContain("## 时间线摘要");
    expect(md).toContain("- 03:04:05 · 用户 · 提问");
    expect(md).toContain("- 03:04:08 · 工具 · Read");
    expect(md).not.toContain("这是不该出现在档案里的原文");
  });
});

describe("timelineLines", () => {
  it("超过上限时首尾保留、中间用一行省略号交代", () => {
    const start = new Date(2026, 0, 2, 0, 0, 0).getTime();
    const records = Array.from({ length: 20 }, (_, index) =>
      base({
        id: `u${index}`,
        kind: "user",
        text: `message ${index}`,
        timestamp: start + index * 1000
      })
    );
    const rows = buildLogRows(records);
    const lines = timelineLines(rows);
    expect(lines).toHaveLength(ARCHIVE_TIMELINE_LIMIT);
    expect(lines[4]).toBe("- （中间省略 11 条）");
    expect(lines[0]).toContain("00:00:00");
    expect(lines[9]).toContain("00:00:19");
  });

  it("不超过上限时逐行输出", () => {
    const rows = buildLogRows([
      base({ id: "u1", kind: "user", timestamp: 0 }),
      base({ id: "u2", kind: "user", timestamp: 1000 })
    ]);
    expect(timelineLines(rows)).toHaveLength(2);
  });
});

describe("archiveFileName / projectNameOfCwd / toolCounts", () => {
  it("文件名折掉路径分隔符，未知 id 落到 unknown", () => {
    expect(archiveFileName("abc/def ghi")).toBe("cca-session-abc-def-ghi.md");
    expect(archiveFileName("///")).toBe("cca-session-unknown.md");
  });

  it("项目名只取最后一段，缺失时给占位词", () => {
    expect(projectNameOfCwd("/repo/alpha/")).toBe("alpha");
    expect(projectNameOfCwd(undefined)).toBe("（未知项目）");
    expect(projectNameOfCwd("/")).toBe("（未知项目）");
  });

  it("工具清单按次数降序，并列按字典序", () => {
    const counts = toolCounts([
      base({ id: "1", toolName: "Bash" }),
      base({ id: "2", toolName: "Read" }),
      base({ id: "3", toolName: "Bash" }),
      base({ id: "4", toolName: "Agent" })
    ]);
    expect(counts).toEqual([
      { tool: "Bash", count: 2 },
      { tool: "Agent", count: 1 },
      { tool: "Read", count: 1 }
    ]);
  });
});
