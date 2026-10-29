import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { ToolBucketKey, ToolCallFact } from "./toolCensus";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildToolEcosystem,
  nodeLabelMap,
  toolId,
  toolLabel,
  topCoOccurrences
} from "./toolEcosystem";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();

let seq = 0;

function fact(key: ToolBucketKey, timestamp = NOW - 3_600_000, sidechain = false): ToolCallFact {
  seq += 1;
  return { key, timestamp, sidechain };
}

const bash = (count: number, timestamp?: number): ToolCallFact[] =>
  Array.from({ length: count }, () => fact({ kind: "builtin", toolName: "Bash" }, timestamp));
const read = (count: number, timestamp?: number): ToolCallFact[] =>
  Array.from({ length: count }, () => fact({ kind: "builtin", toolName: "Read" }, timestamp));
const grep = (count: number): ToolCallFact[] =>
  Array.from({ length: count }, () => fact({ kind: "builtin", toolName: "Grep" }));

function metaOf(path: string): SessionMeta {
  return {
    path,
    projectLabel: "-repo-demo",
    mtimeMs: 1,
    sizeBytes: 1,
    hasRecords: true,
    userPrompt: "演示"
  };
}

function inputOf(session: SessionMeta, facts: ToolCallFact[]): UsageSessionInput {
  return { records: [], projectLabel: session.projectLabel, session, toolCalls: facts };
}

describe("toolLabel / toolId", () => {
  it("类型写进标签；MCP 按 server 收口", () => {
    expect(toolLabel({ kind: "builtin", toolName: "Bash" })).toBe("Bash");
    expect(toolLabel({ kind: "skill", skillName: "lint" })).toBe("Skill: lint");
    expect(toolLabel({ kind: "subagent", subagentType: "trellis-implement" })).toBe(
      "Agent: trellis-implement"
    );
    expect(toolLabel({ kind: "mcp", server: "fs", toolName: "read" })).toBe("mcp:fs");

    const first = toolId({ kind: "mcp", server: "fs", toolName: "read" });
    const second = toolId({ kind: "mcp", server: "fs", toolName: "write" });
    expect(first).toBe(second);
  });
});

describe("buildToolEcosystem", () => {
  it("空输入：工具不足，给出可解释的空态原因", () => {
    const ecosystem = buildToolEcosystem([], 30, NOW);
    expect(ecosystem.emptyReason).toBe("too-few-tools");
    expect(ecosystem.toolCount).toBe(0);
    expect(ecosystem.nodes).toEqual([]);
    expect(ecosystem.edges).toEqual([]);
  });

  it("只有一种工具：不画网络", () => {
    const ecosystem = buildToolEcosystem(
      [inputOf(metaOf("/a"), bash(10))],
      30,
      NOW
    );
    expect(ecosystem.toolCount).toBe(1);
    expect(ecosystem.emptyReason).toBe("too-few-tools");
  });

  it("两种工具只在一个会话同现：不算共现", () => {
    const ecosystem = buildToolEcosystem(
      [inputOf(metaOf("/a"), [...bash(2), ...read(1)])],
      30,
      NOW
    );
    expect(ecosystem.sessionCount).toBe(1);
    expect(ecosystem.emptyReason).toBe("no-co-occurrence");
    expect(ecosystem.hiddenEdges).toBe(0);
  });

  it("两种工具在两个会话同现：一条边、两个节点（水平布局）", () => {
    const ecosystem = buildToolEcosystem(
      [
        inputOf(metaOf("/a"), [...bash(3), ...read(1)]),
        inputOf(metaOf("/b"), [...bash(1), ...read(2)])
      ],
      30,
      NOW
    );
    expect(ecosystem.emptyReason).toBeNull();
    expect(ecosystem.nodes).toHaveLength(2);
    expect(ecosystem.edges).toEqual([
      { a: "builtin:Bash", b: "builtin:Read", sessions: 2, width: 4 }
    ]);
    const bashNode = ecosystem.nodes.find((node) => node.id === "builtin:Bash")!;
    const readNode = ecosystem.nodes.find((node) => node.id === "builtin:Read")!;
    expect(bashNode.x).toBe(190);
    expect(readNode.x).toBe(410);
    expect(bashNode.y).toBe(160);
    expect(readNode.y).toBe(160);
    // 调用最多的 Bash 是枢纽，半径取上限 14。
    expect(bashNode.hub).toBe(true);
    expect(bashNode.r).toBe(14);
    expect(readNode.hub).toBe(false);
  });

  it("三种工具在两个会话里都出现：三对边都是 2 个会话", () => {
    const ecosystem = buildToolEcosystem(
      [
        inputOf(metaOf("/a"), [...bash(1), ...read(1), ...grep(1)]),
        inputOf(metaOf("/b"), [...bash(1), ...read(1), ...grep(1)])
      ],
      30,
      NOW
    );
    expect(ecosystem.edges).toHaveLength(3);
    expect(ecosystem.edges.every((edge) => edge.sessions === 2)).toBe(true);
    // 圆环从正上方开始：第一个节点 y 最小。
    const first = ecosystem.nodes.reduce((lowest, node) => (node.y < lowest.y ? node : lowest));
    expect(first.y).toBeCloseTo(50, 1);
  });

  it("窗口外的调用不参与", () => {
    const old = new Date(2026, 7, 1, 12, 0).getTime();
    const ecosystem = buildToolEcosystem(
      [
        inputOf(metaOf("/a"), [...bash(1, old), ...read(1, old)]),
        inputOf(metaOf("/b"), [...bash(1), ...read(1)])
      ],
      7,
      NOW
    );
    expect(ecosystem.emptyReason).toBe("no-co-occurrence");
    expect(ecosystem.sessionCount).toBe(1);
  });

  it("含 sidechain 的调用与主链同权", () => {
    const ecosystem = buildToolEcosystem(
      [
        inputOf(metaOf("/a"), [fact({ kind: "builtin", toolName: "Bash" }, undefined, true), ...read(1)]),
        inputOf(metaOf("/b"), [...bash(1), ...read(1)])
      ],
      30,
      NOW
    );
    expect(ecosystem.edges).toHaveLength(1);
    expect(ecosystem.edges[0].sessions).toBe(2);
  });

  it("同一 MCP server 的不同工具合并成一个节点", () => {
    const ecosystem = buildToolEcosystem(
      [
        inputOf(metaOf("/a"), [
          fact({ kind: "mcp", server: "fs", toolName: "read" }),
          ...read(1)
        ]),
        inputOf(metaOf("/b"), [
          fact({ kind: "mcp", server: "fs", toolName: "write" }),
          ...read(1)
        ])
      ],
      30,
      NOW
    );
    expect(ecosystem.nodes.map((node) => node.label).sort()).toEqual(["Read", "mcp:fs"]);
  });

  it("超过 8 种工具：只画前 8，未画的边报数", () => {
    const tools = Array.from({ length: 10 }, (_, index) => `Tool${index}`);
    const firstSession = tools.map((toolName) => fact({ kind: "builtin", toolName }));
    const secondSession = tools.map((toolName) => fact({ kind: "builtin", toolName }));
    const ecosystem = buildToolEcosystem(
      [inputOf(metaOf("/a"), firstSession), inputOf(metaOf("/b"), secondSession)],
      30,
      NOW
    );
    expect(ecosystem.toolCount).toBe(10);
    expect(ecosystem.nodes).toHaveLength(8);
    // 10 选 2 = 45 对全部合格；只画 28 条。
    expect(ecosystem.edges).toHaveLength(28);
    expect(ecosystem.hiddenEdges).toBe(45 - 28);
  });

  it("确定性：同一份数据两次构建位置一致", () => {
    const inputs = [
      inputOf(metaOf("/a"), [...bash(2), ...read(1), ...grep(1)]),
      inputOf(metaOf("/b"), [...bash(1), ...read(1), ...grep(2)])
    ];
    const first = buildToolEcosystem(inputs, 30, NOW);
    const second = buildToolEcosystem(inputs, 30, NOW);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });
});

describe("topCoOccurrences / nodeLabelMap", () => {
  const ecosystem = buildToolEcosystem(
    [
      inputOf(metaOf("/a"), [...bash(1), ...read(1), ...grep(1)]),
      inputOf(metaOf("/b"), [...bash(1), ...read(1), ...grep(1)]),
      inputOf(metaOf("/c"), [...bash(1), ...read(1)])
    ],
    30,
    NOW
  );

  it("默认取最强的前 N 对；选中工具后只留与它有关的一对", () => {
    expect(topCoOccurrences(ecosystem, null, 3)[0]).toMatchObject({
      a: "builtin:Bash",
      b: "builtin:Read",
      sessions: 3
    });
    const filtered = topCoOccurrences(ecosystem, "builtin:Grep", 3);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((edge) => edge.a === "builtin:Grep" || edge.b === "builtin:Grep")).toBe(
      true
    );
  });

  it("标签查找表覆盖所有节点", () => {
    const labels = nodeLabelMap(ecosystem);
    expect(labels.get("builtin:Bash")).toBe("Bash");
    expect(labels.size).toBe(ecosystem.nodes.length);
  });
});
