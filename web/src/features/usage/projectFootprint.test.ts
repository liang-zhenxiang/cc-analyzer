import { describe, expect, it } from "vitest";
import type { ParsedSession, SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildFileFootprint,
  extractFileFacts,
  topSharedFiles,
  type FileFact
} from "./projectFootprint";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const RECENT = NOW - 3_600_000;

function fact(path: string, relPath: string, timestamps: number[], sidechainCount = 0): FileFact {
  return { path, relPath, touchTimestamps: timestamps, sidechainCount };
}

function inputOf(
  projectLabel: string,
  fileFacts: FileFact[],
  projectPath?: string
): UsageSessionInput {
  return { records: [], projectLabel, projectPath, fileFacts };
}

describe("buildFileFootprint", () => {
  it("空输入：没有项目", () => {
    const footprint = buildFileFootprint([], 30, NOW);
    expect(footprint.emptyReason).toBe("no-projects");
    expect(footprint.projects).toEqual([]);
    expect(footprint.files).toEqual([]);
    expect(footprint.projectCount).toBe(0);
  });

  it("只有一个项目：足迹图需要至少两个项目", () => {
    const footprint = buildFileFootprint(
      [inputOf("-repo-a", [fact("/repo-a/src/index.ts", "src/index.ts", [RECENT])], "/repo/a")],
      30,
      NOW
    );
    expect(footprint.emptyReason).toBe("single-project");
    expect(footprint.projectCount).toBe(1);
    expect(footprint.fileCount).toBe(1);
    expect(footprint.sharedCount).toBe(0);
  });

  it("两个项目各动各的文件：没有共享文件", () => {
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", [fact("/repo/a/a.ts", "a.ts", [RECENT])], "/repo/a"),
        inputOf("-repo-b", [fact("/repo/b/b.ts", "b.ts", [RECENT])], "/repo/b")
      ],
      30,
      NOW
    );
    expect(footprint.emptyReason).toBe("no-shared");
    expect(footprint.projectCount).toBe(2);
    expect(footprint.fileCount).toBe(2);
    expect(footprint.sharedCount).toBe(0);
  });

  it("同一绝对路径被两个项目触碰：一条共享文件 + 两条边", () => {
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", [fact("/shared/lint.sh", "../../shared/lint.sh", [RECENT, RECENT + 1])], "/repo/a"),
        inputOf("-repo-b", [fact("/shared/lint.sh", "../../shared/lint.sh", [RECENT])], "/repo/b")
      ],
      30,
      NOW
    );
    expect(footprint.emptyReason).toBeNull();
    expect(footprint.projects).toHaveLength(2);
    expect(footprint.files).toHaveLength(1);
    expect(footprint.edges).toHaveLength(2);
    expect(footprint.edges.map((edge) => edge.touches).sort()).toEqual([1, 2]);
    expect(footprint.files[0]).toMatchObject({
      path: "/shared/lint.sh",
      display: "../../shared/lint.sh",
      touches: 3,
      projectCount: 2,
      x: 450
    });
    expect(footprint.projects.map((project) => project.x)).toEqual([150, 150]);
  });

  it("窗口外的触碰不计入；所有触碰都在窗外时项目不出现", () => {
    const old = new Date(2026, 6, 1, 12, 0).getTime();
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", [fact("/shared/x", "x", [old, RECENT])], "/repo/a"),
        inputOf("-repo-b", [fact("/shared/x", "x", [old])], "/repo/b"),
        inputOf("-repo-c", [fact("/shared/y", "y", [old])], "/repo/c")
      ],
      7,
      NOW
    );
    // b 的触碰全在窗外 → 只剩一个项目，按 single-project 处理。
    expect(footprint.projectCount).toBe(1);
    expect(footprint.emptyReason).toBe("single-project");
  });

  it("同一个项目的多个会话合并计数", () => {
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", [fact("/shared/x", "x", [RECENT])], "/repo/a"),
        inputOf("-repo-a", [fact("/shared/x", "x", [RECENT, RECENT + 1])], "/repo/a"),
        inputOf("-repo-b", [fact("/shared/x", "x", [RECENT])], "/repo/b")
      ],
      30,
      NOW
    );
    const edgeA = footprint.edges.find((edge) => edge.project === "-repo-a")!;
    expect(edgeA.touches).toBe(3);
    expect(footprint.projects.find((project) => project.label === "-repo-a")!.touches).toBe(3);
  });

  it("项目名撞车时补上编码名，两个节点才能区分", () => {
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", [fact("/shared/x", "x", [RECENT])], "/repo/a"),
        inputOf("-repo-a-copy", [fact("/shared/x", "x", [RECENT])], "/repo/a")
      ],
      30,
      NOW
    );
    const displays = footprint.projects.map((project) => project.display).sort();
    expect(displays).toEqual(["a · -repo-a", "a · -repo-a-copy"]);
  });

  it("文件在项目根之外：展示退回 basename，完整路径留给 title", () => {
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", [fact("/Users/x/.claude/settings.json", "/Users/x/.claude/settings.json", [RECENT])], "/repo/a"),
        inputOf("-repo-b", [fact("/Users/x/.claude/settings.json", "/Users/x/.claude/settings.json", [RECENT])], "/repo/b")
      ],
      30,
      NOW
    );
    expect(footprint.files[0].display).toBe("settings.json");
    expect(footprint.files[0].path).toBe("/Users/x/.claude/settings.json");
  });

  it("项目超过上限时截断并报数", () => {
    const inputs = Array.from({ length: 9 }, (_, index) =>
      inputOf(`-repo-${index}`, [fact("/shared/x", "x", [RECENT])], `/repo/${index}`)
    );
    const footprint = buildFileFootprint(inputs, 30, NOW, { maxProjects: 6 });
    expect(footprint.projects).toHaveLength(6);
    expect(footprint.projectCount).toBe(9);
    expect(footprint.hiddenProjects).toBe(3);
  });

  it("共享文件超过上限时截断并报数", () => {
    const filesA = Array.from({ length: 14 }, (_, index) =>
      fact(`/shared/${index}.ts`, `${index}.ts`, [RECENT])
    );
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", filesA, "/repo/a"),
        inputOf("-repo-b", filesA, "/repo/b")
      ],
      30,
      NOW,
      { maxFiles: 10 }
    );
    expect(footprint.files).toHaveLength(10);
    expect(footprint.sharedCount).toBe(14);
    expect(footprint.hiddenFiles).toBe(4);
  });

  it("边超过上限时按触碰次数截断", () => {
    // 12 个项目 × 2 个共享文件 = 24 条边；上限 10 时只留 10 条。
    const inputs = Array.from({ length: 12 }, (_, index) =>
      inputOf(
        `-repo-${index}`,
        [
          fact("/shared/a.ts", "a.ts", [RECENT]),
          fact("/shared/b.ts", "b.ts", [RECENT])
        ],
        `/repo/${index}`
      )
    );
    const footprint = buildFileFootprint(inputs, 30, NOW, {
      maxProjects: 12,
      maxFiles: 10,
      maxEdges: 10
    });
    expect(footprint.edges).toHaveLength(10);
    expect(footprint.hiddenEdges).toBe(14);
  });

  it("顶部共享列表按触碰次数排序", () => {
    const footprint = buildFileFootprint(
      [
        inputOf("-repo-a", [fact("/shared/k.ts", "k.ts", [RECENT]), fact("/shared/m.ts", "m.ts", [RECENT])], "/repo/a"),
        inputOf("-repo-b", [fact("/shared/m.ts", "m.ts", [RECENT, RECENT + 1])], "/repo/b")
      ],
      30,
      NOW
    );
    // m.ts 被 A 1 次 + B 2 次 = 3；k.ts 只有 A 的 1 次，但 k 不是共享文件（只有 A）。
    const top = topSharedFiles(footprint, 3);
    expect(top).toHaveLength(1);
    expect(top[0].display).toBe("m.ts");
    expect(top[0].touches).toBe(3);
  });
});

describe("extractFileFacts", () => {
  function toolRecord(
    id: string,
    timestamp: number,
    patch: Partial<SessionRecord>
  ): SessionRecord {
    return {
      id,
      fullId: id,
      kind: "tool",
      timestamp,
      durationMs: 0,
      text: "",
      isError: false,
      raw: {},
      ...patch
    };
  }

  const parsed = {
    cwd: "/repo/app",
    records: [
      toolRecord("t1", 1000, { toolName: "Read", toolInput: { file_path: "/repo/app/src/a.ts" } }),
      toolRecord("t2", 2000, {
        toolName: "Edit",
        toolInput: { file_path: "/repo/app/src/a.ts" },
        isError: true
      })
    ],
    sidechainMessages: [
      toolRecord("t3", 3000, {
        toolName: "Read",
        toolInput: { file_path: "/repo/app/src/a.ts" },
        isSidechain: true
      })
    ]
  } as unknown as ParsedSession;

  it("成功触碰才进时间戳；失败调用不进；子 agent 计入", () => {
    const facts = extractFileFacts(parsed);
    expect(facts).toHaveLength(1);
    expect(facts[0].path).toBe("/repo/app/src/a.ts");
    expect(facts[0].relPath).toBe("src/a.ts");
    expect(facts[0].touchTimestamps).toEqual([1000, 3000]);
    expect(facts[0].sidechainCount).toBe(1);
  });

  it("没有文件工具调用时返回空数组", () => {
    const empty = { cwd: "/repo/app", records: [], sidechainMessages: [] } as unknown as ParsedSession;
    expect(extractFileFacts(empty)).toEqual([]);
  });
});
