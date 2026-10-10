import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { parseJsonlText } from "../sessions/parseJsonl";
import type { UsageSessionInput } from "./usageAggregations";
import {
  classifyToolUse,
  extractToolCalls,
  toolCensus,
  type ToolCallFact
} from "./toolCensus";

/**
 * 聚合纯函数的期望值全部从夹具/合成数据计算——实测语料的数字（36,660 次
 * tool_use）是活数据，写死进测试只会让它过期就假红。
 *
 * 夹具 tool-census-session.jsonl 的形状（两个自然日 2026-10-02 / 10-03，
 * UTC 正午——任意 |时区| ≤ 11 下本地日与 UTC 日一致）：
 * - 主链 13 次：Read/Bash×2/Edit/Write/WebSearch/Grep/Glob 各若干、
 *   Skill×2（git-commit 裸名 + trellis:finish-work 命名空间形态）、
 *   mcp__demo__query（3 段）+ mcp__broken（2 段防御）、Agent×1
 *   （input.subagent_type=trellis-research，toolUseResult.totalToolUseCount=2）；
 * - sidechain 2 次：Bash×1 + Skill maintain-loop×1（isSidechain 行）；
 * - 四桶：内置 7 类（Bash 3=2主+1子）、skill 3 个、MCP 2 个 server、
 *   子 agent 1 类。合计主链 13 / 含子 agent 15（子 agent 占 2/15）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const censusFixture = readFileSync(
  path.join(here, "../../../tests/fixtures/tool-census-session.jsonl"),
  "utf8"
);
const FIXTURE_PATH = "/home/tester/.claude/projects/-repo-census-demo/tool-census-session.jsonl";
const FIXTURE_NOW = Date.parse("2026-10-03T12:30:00.000Z");

const meta: SessionMeta = {
  path: FIXTURE_PATH,
  projectLabel: "-repo-census-demo",
  mtimeMs: 1,
  sizeBytes: 1,
  hasRecords: true,
  userPrompt: "盘点最常用工具"
};

function parsedFixture() {
  return parseJsonlText(censusFixture, FIXTURE_PATH);
}

function fixtureFacts(): ToolCallFact[] {
  return extractToolCalls(parsedFixture());
}

function fixtureInput(): UsageSessionInput {
  return {
    records: [],
    projectLabel: meta.projectLabel,
    toolCalls: fixtureFacts(),
    session: meta
  };
}

/** 手造事实（不经解析层），key 用最小形态直接拼。 */
function fact(key: ToolCallFact["key"], timestamp: number, sidechain = false): ToolCallFact {
  return { key, timestamp, sidechain };
}

const TS = Date.parse("2026-10-02T12:00:00.000Z");

describe("classifyToolUse", () => {
  it("内置工具按名归桶；未知形态也不丢数据", () => {
    expect(classifyToolUse("Bash", { command: "ls" })).toEqual({ kind: "builtin", toolName: "Bash" });
    expect(classifyToolUse("未来新工具", undefined)).toEqual({ kind: "builtin", toolName: "未来新工具" });
  });

  it("MCP 前缀优先于一切：server 可含单下划线，工具名恒取第 3 段起", () => {
    expect(classifyToolUse("mcp__plugin_context7_context7__query-docs", {})).toEqual({
      kind: "mcp",
      server: "plugin_context7_context7",
      toolName: "query-docs"
    });
  });

  it("MCP 名段数不足 3 时整个名字当工具名（防御），server 取仅有的一段", () => {
    expect(classifyToolUse("mcp__broken", {})).toEqual({
      kind: "mcp",
      server: "broken",
      toolName: "mcp__broken"
    });
    // 只有前缀：server 兜底，工具名仍是整串。
    expect(classifyToolUse("mcp__", {})).toEqual({
      kind: "mcp",
      server: "(unknown)",
      toolName: "mcp__"
    });
  });

  it("MCP 工具名里再出现双下划线时并入工具名（split 后段重组）", () => {
    expect(classifyToolUse("mcp__srv__a__b", {})).toEqual({
      kind: "mcp",
      server: "srv",
      toolName: "a__b"
    });
  });

  it("Agent 与 Task（旧名兼容）按 input.subagent_type 归桶，缺字段兜底", () => {
    expect(classifyToolUse("Agent", { subagent_type: "trellis-research" })).toEqual({
      kind: "subagent",
      subagentType: "trellis-research"
    });
    expect(classifyToolUse("Task", { subagent_type: "Explore" })).toEqual({
      kind: "subagent",
      subagentType: "Explore"
    });
    expect(classifyToolUse("Agent", { prompt: "没写类型" })).toEqual({
      kind: "subagent",
      subagentType: "(unknown)"
    });
  });

  it("Skill 以 input.skill 整串为名（ns:name 不拆），非字符串不认", () => {
    expect(classifyToolUse("Skill", { skill: "trellis:finish-work", args: "收尾" })).toEqual({
      kind: "skill",
      skillName: "trellis:finish-work"
    });
    expect(classifyToolUse("Skill", { args: "缺 skill 字段" })).toEqual({
      kind: "skill",
      skillName: "(unknown)"
    });
    expect(classifyToolUse("Skill", { skill: 42 })).toEqual({ kind: "skill", skillName: "(unknown)" });
    expect(classifyToolUse("Skill", null)).toEqual({ kind: "skill", skillName: "(unknown)" });
  });
});

describe("extractToolCalls", () => {
  it("夹具可被解析且无未配对 tool_use（冒烟：单测与 e2e 共用同一批数据）", () => {
    const parsed = parsedFixture();
    expect(parsed.warnings).toEqual([]);
    expect(parsed.unmatchedToolUses).toHaveLength(0);
  });

  it("主链与 sidechain 都进事实，sidechain 标志位如实", () => {
    const facts = fixtureFacts();
    expect(facts).toHaveLength(15);
    expect(facts.filter((f) => f.sidechain)).toHaveLength(2);
    const sidechainNames = facts
      .filter((f) => f.sidechain)
      .map((f) =>
        f.key.kind === "skill"
          ? f.key.skillName
          : f.key.kind === "builtin"
            ? f.key.toolName
            : f.key.kind === "mcp"
              ? f.key.toolName
              : f.key.subagentType
      )
      .sort();
    expect(sidechainNames).toEqual(["Bash", "maintain-loop"]);
  });

  it("Agent 结构化回报的 totalToolUseCount 随事实下传", () => {
    const reported = fixtureFacts().filter((f) => f.agentToolUseCount != null);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.key).toEqual({ kind: "subagent", subagentType: "trellis-research" });
    expect(reported[0]?.agentToolUseCount).toBe(2);
  });
});

describe("toolCensus", () => {
  it("夹具全景：四桶、双口径计数、MCP 按 server 聚合带工具明细", () => {
    const census = toolCensus([fixtureInput()], 30, FIXTURE_NOW);
    expect(census.totalCalls).toEqual({ main: 13, withSidechain: 15 });

    const byKind = (kind: ToolCallFact["key"]["kind"]) =>
      census.buckets.filter((b) => b.key.kind === kind);
    expect(byKind("builtin")).toHaveLength(7);
    expect(byKind("skill")).toHaveLength(3);
    expect(byKind("mcp")).toHaveLength(2);
    expect(byKind("subagent")).toHaveLength(1);

    // 内置桶双口径：Bash 3 = 主链 2 + 子链 1；同数按 label 稳定排序。
    const builtins = byKind("builtin");
    expect(builtins[0]).toMatchObject({ label: "Bash", callsMain: 2, callsWithSidechain: 3 });
    const oneCall = builtins.slice(1).map((b) => b.label);
    expect(oneCall).toEqual(["Edit", "Glob", "Grep", "Read", "WebSearch", "Write"]);

    // skill 名整串保留（命名空间形态不拆）；maintain-loop 只有子链口径。
    const skills = byKind("skill").map((b) => [b.label, b.callsMain, b.callsWithSidechain]);
    expect(skills).toEqual([
      ["git-commit", 1, 1],
      ["maintain-loop", 0, 1],
      ["trellis:finish-work", 1, 1]
    ]);

    // MCP 按 server 聚合，桶内附工具明细（2 段名的整串工具名如实呈现）。
    const mcp = byKind("mcp");
    expect(mcp.map((b) => [b.label, b.callsWithSidechain])).toEqual([
      ["broken", 1],
      ["demo", 1]
    ]);
    expect(mcp.find((b) => b.label === "demo")?.tools).toEqual([{ toolName: "query", calls: 1 }]);
    expect(mcp.find((b) => b.label === "broken")?.tools).toEqual([
      { toolName: "mcp__broken", calls: 1 }
    ]);

    // 子 agent 桶 + 下钻切片（唯一会话，title 来自首条用户消息）。
    const subagent = byKind("subagent")[0];
    expect(subagent).toMatchObject({ label: "trellis-research", callsMain: 1, callsWithSidechain: 1 });
    expect(subagent.topSessions).toEqual([
      { session: meta, label: "盘点最常用工具", calls: 1 }
    ]);
    expect(subagent.sessions).toBe(1);
  });

  it("对账用例：Agent 回报的 totalToolUseCount 合计与 sidechain 事实数相等", () => {
    const facts = fixtureFacts();
    const census = toolCensus(
      [{ records: [], projectLabel: meta.projectLabel, toolCalls: facts, session: meta }],
      30,
      FIXTURE_NOW
    );
    expect(census.agentReportedTotal).toBe(2);
    expect(facts.filter((f) => f.sidechain)).toHaveLength(2);
    expect(census.agentReportedTotal).toBe(facts.filter((f) => f.sidechain).length);
  });

  it("窗口裁剪按事实时间戳：只剩 10-03 的窗口里，Bash 只剩子链那 1 次（主链口径 0 不丢桶）", () => {
    const day1 = toolCensus([fixtureInput()], 1, FIXTURE_NOW);
    expect(day1.totalCalls).toEqual({ main: 0, withSidechain: 2 });
    const bash = day1.buckets.find((b) => b.label === "Bash");
    expect(bash).toMatchObject({ callsMain: 0, callsWithSidechain: 1 });
    const skill = day1.buckets.find((b) => b.label === "maintain-loop");
    expect(skill).toMatchObject({ callsMain: 0, callsWithSidechain: 1 });
  });

  it("空输入与没有 toolCalls 字段的输入都产出空普查（不 throw、不猜数）", () => {
    expect(toolCensus([], 30, FIXTURE_NOW)).toEqual({
      buckets: [],
      totalCalls: { main: 0, withSidechain: 0 },
      agentReportedTotal: 0
    });
    // 手造输入（无 toolCalls）对普查不可见——与 mergeErrorStats 对 errorExtract 同一约定。
    const legacy = toolCensus([{ records: [], projectLabel: "-repo-x" }], 30, FIXTURE_NOW);
    expect(legacy.totalCalls).toEqual({ main: 0, withSidechain: 0 });
  });

  it("会话数去重：同一会话多次调用算一个，跨会话按贡献排序取 Top-5", () => {
    const mk = (session: SessionMeta, calls: number): UsageSessionInput => ({
      records: [],
      projectLabel: session.projectLabel,
      session,
      toolCalls: Array.from({ length: calls }, (_, i) => fact({ kind: "builtin", toolName: "Bash" }, TS + i))
    });
    // 7 个会话各贡献 1..7 次：Bash 桶 28 次、7 个会话，Top-5 = 7..3 次的会话。
    const inputs = [1, 2, 3, 4, 5, 6, 7].map((calls, i) =>
      mk({ ...meta, path: `/p${i}`, userPrompt: `会话${i}` }, calls)
    );
    const census = toolCensus(inputs, 30, TS + 1000);
    const bash = census.buckets.find((b) => b.label === "Bash");
    expect(bash?.callsWithSidechain).toBe(28);
    expect(bash?.sessions).toBe(7);
    expect(bash?.topSessions.map((s) => s.calls)).toEqual([7, 6, 5, 4, 3]);
    expect(bash?.topSessions.map((s) => s.session?.path)).toEqual(["/p6", "/p5", "/p4", "/p3", "/p2"]);
    // 手造输入（无 meta）用项目标签当展示名，两个同项目输入不并成一条。
    const handBuilt = toolCensus(
      [
        { records: [], projectLabel: "-repo-a", toolCalls: [fact({ kind: "builtin", toolName: "Read" }, TS)] },
        { records: [], projectLabel: "-repo-a", toolCalls: [fact({ kind: "builtin", toolName: "Read" }, TS)] }
      ],
      30,
      TS + 1000
    );
    const read = handBuilt.buckets.find((b) => b.label === "Read");
    expect(read?.sessions).toBe(2);
    expect(read?.topSessions.every((s) => s.label === "-repo-a" && s.session === null)).toBe(true);
  });
});
