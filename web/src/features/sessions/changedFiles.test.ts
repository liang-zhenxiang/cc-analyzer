import { beforeEach, describe, expect, it } from "vitest";
import { extractFileActivities, toRelativePath } from "./changedFiles";
import { parseJsonlText } from "./parseJsonl";
import type { ParsedSession, SessionRecord } from "./types";

import changedFilesFixture from "../../../tests/fixtures/changed-files-session.jsonl?raw";

/** 最小 ParsedSession：extractFileActivities 只读 records / sidechainMessages / cwd。 */
function sessionOf(
  records: SessionRecord[],
  options: { cwd?: string; sidechainMessages?: SessionRecord[] } = {}
): ParsedSession {
  return {
    sessionId: "test",
    path: "/tmp/test.jsonl",
    cwd: options.cwd,
    startedAt: 0,
    endedAt: 0,
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    sidechainMessages: options.sidechainMessages ?? []
  };
}

let nextTimestamp = 0;

/** 一条工具记录的裸骨架；每次调用时间自增，测试里按声明顺序即时间顺序。 */
function toolRecord(overrides: Partial<SessionRecord> & { fullId: string }): SessionRecord {
  nextTimestamp += 1;
  return {
    id: overrides.fullId.slice(0, 8),
    kind: "tool",
    timestamp: nextTimestamp,
    durationMs: 0,
    text: "",
    isError: false,
    lineNumber: nextTimestamp,
    raw: null,
    ...overrides
  };
}

beforeEach(() => {
  nextTimestamp = 0;
});

describe("toRelativePath", () => {
  it("strips the session cwd prefix and keeps outside paths verbatim", () => {
    expect(toRelativePath("/repo/demo/src/a.ts", "/repo/demo")).toBe("src/a.ts");
    // cwd 自带尾斜杠时不产生双斜杠残留。
    expect(toRelativePath("/repo/demo/src/a.ts", "/repo/demo/")).toBe("src/a.ts");
    // 前缀相同但不是目录边界（/repo/demo-x 不是 /repo/demo 里）不算项目内。
    expect(toRelativePath("/repo/demo-x/a.ts", "/repo/demo")).toBe("/repo/demo-x/a.ts");
    expect(toRelativePath("/etc/hosts", "/repo/demo")).toBe("/etc/hosts");
    // 没有 cwd 的老会话：原样，不猜。
    expect(toRelativePath("/repo/demo/a.ts", undefined)).toBe("/repo/demo/a.ts");
  });
});

describe("extractFileActivities（合成会话）", () => {
  it("counts reads/edits/writes, sorts by lastAt desc, and breaks ties by path", () => {
    const activities = extractFileActivities(
      sessionOf(
        [
          toolRecord({ fullId: "r-old", toolName: "Read", toolInput: { file_path: "/repo/b.md" } }),
          toolRecord({ fullId: "r-new", toolName: "Read", toolInput: { file_path: "/repo/a.md" } }),
          toolRecord({ fullId: "e-new", toolName: "Edit", toolInput: { file_path: "/repo/a.md" } }),
          toolRecord({ fullId: "w-new", toolName: "Write", toolInput: { file_path: "/repo/c.md" } })
        ],
        { cwd: "/repo" }
      )
    );

    // a.md 与 c.md 末次同刻（时间自增下 c 更晚）——这里按构造顺序 c 最后动。
    expect(activities.map((file) => file.relPath)).toEqual(["c.md", "a.md", "b.md"]);
    expect(activities[1]).toMatchObject({ reads: 1, edits: 1, writes: 0, createdNew: false });
  });

  it("breaks same-timestamp ties by path for a stable order", () => {
    const sameTime = 1_000;
    const activities = extractFileActivities(
      sessionOf(
        [
          toolRecord({
            fullId: "b",
            timestamp: sameTime,
            toolName: "Edit",
            toolInput: { file_path: "/repo/z.md" }
          }),
          toolRecord({
            fullId: "a",
            timestamp: sameTime,
            toolName: "Edit",
            toolInput: { file_path: "/repo/a.md" }
          })
        ],
        { cwd: "/repo" }
      )
    );

    expect(activities.map((file) => file.path)).toEqual(["/repo/a.md", "/repo/z.md"]);
  });

  it("prefers structuredResult.filePath and falls back to toolInput", () => {
    const activities = extractFileActivities(
      sessionOf([
        // 结果结构里有路径：以它为准（输入里的 /from/wrong.ts 从不出现）。
        toolRecord({
          fullId: "t-structured",
          toolName: "Edit",
          toolInput: { file_path: "/from/wrong.ts" },
          structuredResult: {
            toolName: "Edit",
            filePath: "/from/shared.ts",
            oldString: "a",
            newString: "b",
            replaceAll: false,
            structuredPatch: null
          }
        }),
        // 被中断的调用没有结果结构：兜底输入里的路径，且与上面聚成同一个文件。
        toolRecord({ fullId: "t-input", toolName: "Edit", toolInput: { file_path: "/from/shared.ts" } }),
        // NotebookEdit 只有输入源（notebook_path）。
        toolRecord({
          fullId: "t-notebook",
          toolName: "NotebookEdit",
          toolInput: { notebook_path: "/repo/demo/nb.ipynb" }
        })
      ])
    );

    // lastAt 降序：notebook（最后声明）→ shared（双源聚到同一文件）。
    expect(activities.map((file) => file.path)).toEqual([
      "/repo/demo/nb.ipynb",
      "/from/shared.ts"
    ]);
    expect(activities.find((file) => file.path === "/from/wrong.ts")).toBeUndefined();
    // shared.ts 聚合了两条：一条来自结果结构，一条兜底输入。
    expect(activities[1].edits).toBe(2);
    expect(activities[0].edits).toBe(1);
  });

  it("keeps failed calls out of the counts but in recordIds and firstAt/lastAt", () => {
    const activities = extractFileActivities(
      sessionOf(
        [
          toolRecord({ fullId: "ok-1", timestamp: 100, toolName: "Edit", toolInput: { file_path: "/repo/a.ts" } }),
          toolRecord({
            fullId: "fail-1",
            timestamp: 200,
            toolName: "Edit",
            isError: true,
            toolInput: { file_path: "/repo/a.ts" }
          })
        ],
        { cwd: "/repo" }
      )
    );

    expect(activities).toHaveLength(1);
    // 失败不冒充改动，但「试了没改成」的现场要能下钻。
    expect(activities[0].edits).toBe(1);
    expect(activities[0].recordIds).toEqual(["ok-1", "fail-1"]);
    // 裁决（2026-10-10）：失败也是接触该文件的事实，时间落位含失败调用。
    expect(activities[0].firstAt).toBe(100);
    expect(activities[0].lastAt).toBe(200);
  });

  it("marks createdNew only from a successful Write with the create marker", () => {
    const activities = extractFileActivities(
      sessionOf([
        // 失败的创建 Write：不点亮「新建」。
        toolRecord({
          fullId: "w-fail",
          timestamp: 1,
          toolName: "Write",
          isError: true,
          toolInput: { file_path: "/repo/new.ts" },
          structuredResult: { toolName: "Write", filePath: "/repo/new.ts", created: true }
        }),
        // 成功的覆盖 Write（type 不是 create）：不是新建。
        toolRecord({
          fullId: "w-over",
          timestamp: 2,
          toolName: "Write",
          toolInput: { file_path: "/repo/old.ts" },
          structuredResult: { toolName: "Write", filePath: "/repo/old.ts", created: false }
        }),
        // 成功的创建 Write：新建。
        toolRecord({
          fullId: "w-create",
          timestamp: 3,
          toolName: "Write",
          toolInput: { file_path: "/repo/real-new.ts" },
          structuredResult: { toolName: "Write", filePath: "/repo/real-new.ts", created: true }
        })
      ])
    );

    const byPath = new Map(activities.map((file) => [file.path, file]));
    expect(byPath.get("/repo/new.ts")?.createdNew).toBe(false);
    expect(byPath.get("/repo/old.ts")?.createdNew).toBe(false);
    expect(byPath.get("/repo/real-new.ts")?.createdNew).toBe(true);
  });

  it("merges sidechain calls into the same file and counts them in the badge", () => {
    const activities = extractFileActivities(
      sessionOf(
        [
          toolRecord({
            fullId: "main-e",
            timestamp: 100,
            toolName: "Edit",
            toolInput: { file_path: "/repo/shared.ts" }
          })
        ],
        {
          cwd: "/repo",
          sidechainMessages: [
            toolRecord({
              fullId: "side-e",
              timestamp: 200,
              toolName: "Edit",
              isSidechain: true,
              toolInput: { file_path: "/repo/shared.ts" }
            })
          ]
        }
      )
    );

    expect(activities).toHaveLength(1);
    // 子 agent 的编辑是真实改动：计入 edits，也计入徽标计数。
    expect(activities[0].edits).toBe(2);
    expect(activities[0].sidechainCount).toBe(1);
    expect(activities[0].lastAt).toBe(200);
    // recordIds 按时间正序——主链与子链的记录交错回真实时间线。
    expect(activities[0].recordIds).toEqual(["main-e", "side-e"]);
  });

  it("ignores tools that are not file tools (Bash etc.) and returns [] for chat-only sessions", () => {
    const bashOnly = extractFileActivities(
      sessionOf([
        toolRecord({
          fullId: "bash-1",
          toolName: "Bash",
          toolInput: { command: "sed -i s/a/b/ /repo/a.ts" }
        }),
        toolRecord({ fullId: "grep-1", toolName: "Grep", toolInput: { path: "/repo" } })
      ])
    );
    expect(bashOnly).toEqual([]);

    const chat = extractFileActivities(
      sessionOf([
        {
          id: "u1",
          fullId: "u1",
          kind: "user",
          timestamp: 1,
          durationMs: 0,
          text: "纯问答",
          isError: false,
          raw: null
        }
      ])
    );
    expect(chat).toEqual([]);
  });
});

describe("extractFileActivities（changed-files 夹具）", () => {
  const parsed = parseJsonlText(changedFilesFixture, "/tmp/changed-files-session.jsonl");

  it("aggregates the fixture's three files with the expected shape", () => {
    const activities = extractFileActivities(parsed);
    expect(parsed.cwd).toBe("/repo/changed-demo");

    // 排序 lastAt 降序：A（13:40，含 sidechain 编辑）→ B（12:40）→ C（12:02）。
    expect(activities.map((file) => file.relPath)).toEqual([
      "src/web/foo.ts",
      "docs/bar.md",
      "/etc/hosts"
    ]);

    const [a, b, c] = activities;
    // A：Read ×2 + Edit ×2 + Write(create) + 失败 Edit + sidechain Edit。
    expect(a).toMatchObject({
      path: "/repo/changed-demo/src/web/foo.ts",
      reads: 2,
      edits: 3,
      writes: 1,
      createdNew: true,
      sidechainCount: 1,
      firstAt: Date.parse("2026-09-20T13:10:00.000Z"),
      lastAt: Date.parse("2026-09-20T13:40:00.000Z")
    });
    expect(a.recordIds).toHaveLength(7);
    expect(a.recordIds).toContain("cf-edit-a3");
    // B：仅 Read；C：cwd 外的成功 Edit，路径原样。
    expect(b).toMatchObject({ reads: 1, edits: 0, writes: 0, createdNew: false, sidechainCount: 0 });
    expect(c).toMatchObject({
      path: "/etc/hosts",
      relPath: "/etc/hosts",
      reads: 0,
      edits: 1,
      writes: 0
    });
  });
});
