import { describe, expect, it } from "vitest";
import { queryOptions, querySessions, type SessionQuery } from "./sessionQuery";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { ToolCallFact } from "./toolCensus";
import type { UsageSessionInput } from "./usageAggregations";
import type { ErrorSessionFacts } from "./errorStats";

const BASE = new Date(2026, 9, 10, 9, 0).getTime();
const MIN = 60_000;

let seq = 0;
function record(at: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(input: number): SessionUsage {
  return { inputTokens: input };
}

function toolFact(toolName: string, at: number): ToolCallFact {
  return {
    key: { kind: "builtin", toolName },
    timestamp: at,
    sidechain: false
  };
}

function errorFacts(): ErrorSessionFacts {
  return {
    events: [
      {
        kind: "tool",
        timestamp: BASE,
        recordId: "r1",
        path: "/fake/path.jsonl",
        projectLabel: "p",
        preview: "boom"
      }
    ],
    days: new Map()
  };
}

const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-1-20250805";

/** 造一个各维度可控的会话。 */
function makeSession(patch: {
  projectLabel?: string;
  model?: string;
  inputTokens?: number;
  spanMinutes?: number;
  tools?: string[];
  isError?: boolean;
  errorExtract?: boolean;
}): UsageSessionInput {
  const span = patch.spanMinutes ?? 10;
  const records = [
    record(BASE, { usage: usage(patch.inputTokens ?? 1000), model: patch.model ?? SONNET }),
    record(BASE + span * MIN, { model: patch.model ?? SONNET, isError: patch.isError === true })
  ];
  const session: UsageSessionInput = {
    projectLabel: patch.projectLabel ?? "p",
    records
  };
  if (patch.tools) {
    session.toolCalls = patch.tools.map((tool) => toolFact(tool, BASE));
  }
  if (patch.errorExtract) {
    session.errorExtract = errorFacts();
  }
  return session;
}

/** 全部六条件各一个单测 + 一个组合例。 */
describe("querySessions · 单条件", () => {
  it("空 query（全 undefined）→ 全过", () => {
    const a = makeSession({});
    const b = makeSession({ projectLabel: "other" });
    expect(querySessions([a, b], {})).toEqual([a, b]);
  });

  it("projects：任一命中即过；空数组 = 不筛", () => {
    const alpha = makeSession({ projectLabel: "alpha" });
    const beta = makeSession({ projectLabel: "beta" });
    expect(querySessions([alpha, beta], { projects: ["alpha"] })).toEqual([alpha]);
    expect(querySessions([alpha, beta], { projects: ["alpha", "beta"] })).toEqual([alpha, beta]);
    expect(querySessions([alpha, beta], { projects: [] })).toEqual([alpha, beta]);
  });

  it("models：按 usage 记录的 model 命中；无 usage 的记录不算", () => {
    const sonnet = makeSession({ model: SONNET });
    const opus = makeSession({ model: OPUS });
    expect(querySessions([sonnet, opus], { models: [SONNET] })).toEqual([sonnet]);
  });

  it("toolKey：censusKeyId 形状匹配（builtin:Bash）", () => {
    const bash = makeSession({ tools: ["Bash", "Read"] });
    const grep = makeSession({ tools: ["Grep"] });
    expect(querySessions([bash, grep], { toolKey: "builtin:Bash" })).toEqual([bash]);
    // mcp 桶按 server 聚合的 id 形状
    const mcpSession: UsageSessionInput = {
      projectLabel: "mcp",
      records: [record(BASE)],
      toolCalls: [
        { key: { kind: "mcp", server: "github", toolName: "get_issue" }, timestamp: BASE, sidechain: false }
      ]
    };
    expect(querySessions([mcpSession], { toolKey: "mcp:github" })).toEqual([mcpSession]);
    expect(querySessions([bash], { toolKey: "mcp:github" })).toEqual([]);
  });

  it("hasError：true 只留有错的；false 只留无错的；两者都不动 undefined", () => {
    const clean = makeSession({});
    const errored = makeSession({ isError: true });
    expect(querySessions([clean, errored], { hasError: true })).toEqual([errored]);
    expect(querySessions([clean, errored], { hasError: false })).toEqual([clean]);
    expect(querySessions([clean, errored], {})).toEqual([clean, errored]);
  });

  it("hasError 也认 errorExtract 的事件（sidechain 错误在 records 之外）", () => {
    const withExtract = makeSession({ errorExtract: true });
    expect(querySessions([withExtract], { hasError: true })).toEqual([withExtract]);
  });

  it("minContextPeak：上下文峰值 = max(input+cacheCreation+cacheRead)", () => {
    const bigPeak: UsageSessionInput = {
      projectLabel: "big",
      records: [
        record(BASE, { usage: { inputTokens: 10_000, cacheReadTokens: 150_000 } }),
        record(BASE + MIN, { usage: usage(5_000) })
      ]
    };
    const small = makeSession({ inputTokens: 1_000 });
    // big 峰值 = 10_000 + 150_000 = 160_000
    expect(querySessions([bigPeak, small], { minContextPeak: 100_000 })).toEqual([bigPeak]);
    expect(querySessions([bigPeak, small], { minContextPeak: 200_000 })).toEqual([]);
  });

  it("minDurationMin：首末记录间隔（分钟）", () => {
    const quick = makeSession({ spanMinutes: 5 });
    const slow = makeSession({ spanMinutes: 90 });
    expect(querySessions([quick, slow], { minDurationMin: 60 })).toEqual([slow]);
    expect(querySessions([quick, slow], { minDurationMin: 5 })).toEqual([quick, slow]);
  });
});

describe("querySessions · 组合", () => {
  it("六条件 AND 组合一例", () => {
    const target = makeSession({
      projectLabel: "alpha",
      model: SONNET,
      inputTokens: 200_000,
      spanMinutes: 90,
      tools: ["Bash"]
    });
    const wrongProject = makeSession({ projectLabel: "beta", tools: ["Bash"], spanMinutes: 90 });
    const wrongModel = makeSession({ model: OPUS, tools: ["Bash"], spanMinutes: 90 });
    const wrongTool = makeSession({ spanMinutes: 90 });
    const tooShort = makeSession({ tools: ["Bash"], spanMinutes: 5 });
    const tooSmallContext = makeSession({ tools: ["Bash"], spanMinutes: 90, inputTokens: 10_000 });

    const query: SessionQuery = {
      projects: ["alpha"],
      models: [SONNET],
      toolKey: "builtin:Bash",
      hasError: false,
      minContextPeak: 100_000,
      minDurationMin: 60
    };
    expect(querySessions([target, wrongProject, wrongModel, wrongTool, tooShort, tooSmallContext], query)).toEqual([
      target
    ]);
  });

  it("过滤保留输入顺序", () => {
    const a = makeSession({ projectLabel: "alpha" });
    const b = makeSession({ projectLabel: "beta" });
    const c = makeSession({ projectLabel: "alpha" });
    const out = querySessions([c, b, a], { projects: ["alpha"] });
    expect(out).toEqual([c, a]);
  });
});

describe("queryOptions", () => {
  it("项目/模型/工具按会话数降序，并列字典序", () => {
    const solo = makeSession({ projectLabel: "zzz", model: OPUS, tools: ["Read"] });
    const busy1 = makeSession({ projectLabel: "alpha", tools: ["Bash"] });
    const busy2 = makeSession({ projectLabel: "alpha", tools: ["Bash", "Read"] });

    const options = queryOptions([busy2, solo, busy1]);
    expect(options.projects).toEqual([
      { label: "alpha", count: 2 },
      { label: "zzz", count: 1 }
    ]);
    expect(options.models).toEqual([
      { label: SONNET, count: 2 },
      { label: OPUS, count: 1 }
    ]);
    expect(options.tools.map((tool) => tool.label)).toEqual(["builtin:Bash", "builtin:Read"]);
    // Bash 2 会话、Read 2 会话 → 并列，字典序 Bash 在前
    expect(options.tools).toEqual([
      { label: "builtin:Bash", count: 2 },
      { label: "builtin:Read", count: 2 }
    ]);
  });

  it("count = 用到该值的会话数（同会话多次出现只记一次）", () => {
    const session = makeSession({ tools: ["Bash", "Bash"] });
    const options = queryOptions([session]);
    expect(options.tools).toEqual([{ label: "builtin:Bash", count: 1 }]);
  });

  it("无 usage 记录的会话不进 models 选项", () => {
    const bare: UsageSessionInput = {
      projectLabel: "bare",
      records: [record(BASE), record(BASE + MIN)]
    };
    expect(queryOptions([bare]).models).toEqual([]);
  });
});
