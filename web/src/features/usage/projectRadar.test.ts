import { describe, expect, it } from "vitest";
import { projectRadar, RADAR_AXES } from "./projectRadar";
import type { ErrorSessionFacts } from "./errorStats";
import type { ToolCallFact } from "./toolCensus";
import type { SessionRecord, SessionUsage } from "../sessions/types";

let seq = 0;
function record(at: Date, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at.getTime(),
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(input: number, output: number, cacheCreation: number, cacheRead: number): SessionUsage {
  return { inputTokens: input, outputTokens: output, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead };
}

function errorFacts(count: number): ErrorSessionFacts {
  return {
    events: Array.from({ length: count }, (_, i) => ({
      kind: "api" as const,
      timestamp: 0,
      recordId: `e${i}`,
      path: "/x.jsonl",
      projectLabel: "p",
      preview: ""
    })),
    days: new Map()
  };
}

function toolFacts(names: string[]): ToolCallFact[] {
  return names.map((name, i) => ({
    key: { kind: "builtin" as const, toolName: name },
    timestamp: i,
    sidechain: false
  }));
}

/** 两天连续、每天 2 条消息、第二天 cacheRead 更深的基础会话。 */
function baseSession(): { records: SessionRecord[]; projectLabel: string } {
  return {
    projectLabel: "p",
    records: [
      record(new Date(2026, 9, 10, 10, 0), { usage: usage(1000, 0, 0, 0) }),
      record(new Date(2026, 9, 10, 11, 0), { usage: usage(0, 0, 0, 500) }),
      record(new Date(2026, 9, 11, 10, 0), { usage: usage(0, 0, 0, 9000) })
    ]
  };
}

describe("projectRadar", () => {
  it("轴顺序固定为六个 RadarAxis", () => {
    expect(RADAR_AXES).toEqual([
      "tokenIntensity",
      "messageDensity",
      "errorRate",
      "toolDiversity",
      "contextDepth",
      "persistence"
    ]);
  });

  it("单项目（不传 peers）六轴 normalized 全 0.5", () => {
    const points = projectRadar(baseSession());
    expect(points).toHaveLength(6);
    for (const point of points) {
      expect(point.normalized).toBe(0.5);
    }
    // label 全部无「无错误数据」注（errorRate 有 extract 时）——此处没传
    // errorExtract，errorRate 应带注。
    const errorPoint = points.find((p) => p.axis === "errorRate")!;
    expect(errorPoint.label).toContain("无错误数据");
  });

  it("两项目一轴归一 0 与 1（tokenIntensity 极值落两端）", () => {
    const tiny = { projectLabel: "tiny", records: [record(new Date(2026, 9, 10, 10, 0), { usage: usage(10, 0, 0, 0) })] };
    const huge = { projectLabel: "huge", records: [record(new Date(2026, 9, 10, 10, 0), { usage: usage(10_000_000, 0, 0, 0) })] };

    const tinyPoints = projectRadar(tiny, [tiny, huge]);
    const hugePoints = projectRadar(huge, [tiny, huge]);

    const tinyToken = tinyPoints.find((p) => p.axis === "tokenIntensity")!;
    const hugeToken = hugePoints.find((p) => p.axis === "tokenIntensity")!;
    expect(tinyToken.normalized).toBe(0);
    expect(hugeToken.normalized).toBe(1);
    // raw 就是各自的日均 token
    expect(tinyToken.raw).toBe(10);
    expect(hugeToken.raw).toBe(10_000_000);
  });

  it("errorExtract 缺省：normalized 0.5 且 label 注「无错误数据」，即使有 peers", () => {
    const a = baseSession();
    const b = baseSession();
    b.records = b.records.map((r, i) => ({ ...r, usage: usage(999, 0, 0, i * 1000) }));

    const points = projectRadar(a, [a, b]);
    const errorPoint = points.find((p) => p.axis === "errorRate")!;
    // peers 在场也不归一——缺数据就是缺数据，不参与排位
    expect(errorPoint.normalized).toBe(0.5);
    expect(errorPoint.label).toBe("错误率（无错误数据）");
    // raw 按无错误算 0（分母不可知时不编数字）
    expect(errorPoint.raw).toBe(0);
  });

  it("有 errorExtract 时 errorRate = errors/messages 且参与归一", () => {
    const clean = { ...baseSession(), errorExtract: errorFacts(0) };
    const dirty = { ...baseSession(), errorExtract: errorFacts(1) };

    const cleanPoints = projectRadar(clean, [clean, dirty]);
    const dirtyPoints = projectRadar(dirty, [clean, dirty]);

    expect(cleanPoints.find((p) => p.axis === "errorRate")!.normalized).toBe(0);
    expect(dirtyPoints.find((p) => p.axis === "errorRate")!.normalized).toBe(1);
    expect(dirtyPoints.find((p) => p.axis === "errorRate")!.raw).toBeCloseTo(1 / 3, 12);
    expect(dirtyPoints.find((p) => p.axis === "errorRate")!.label).toBe("错误率");
  });

  it("toolDiversity = distinct censusKeyId 数（MCP 按 server 聚合）", () => {
    const withTools = {
      ...baseSession(),
      toolCalls: toolFacts(["Bash", "Read", "Bash"]).concat([
        { key: { kind: "mcp" as const, server: "github", toolName: "a" }, timestamp: 0, sidechain: false },
        { key: { kind: "mcp" as const, server: "github", toolName: "b" }, timestamp: 0, sidechain: false }
      ])
    };
    const noTools = baseSession();

    const points = projectRadar(withTools, [withTools, noTools]);
    const diversity = points.find((p) => p.axis === "toolDiversity")!;
    // builtin:Bash、builtin:Read、mcp:github → 3 个桶身份
    expect(diversity.raw).toBe(3);
    expect(diversity.normalized).toBe(1);
    expect(projectRadar(noTools, [withTools, noTools]).find((p) => p.axis === "toolDiversity")!.normalized).toBe(0);
  });

  it("contextDepth = 单记录 cacheRead 最大值", () => {
    const points = projectRadar(baseSession());
    expect(points.find((p) => p.axis === "contextDepth")!.raw).toBe(9000);
  });

  it("persistence = 本地日连续活跃天数；并列极值（max === min）取 0.5", () => {
    const twoDays = baseSession(); // 10/10、10/11 连续两天
    const oneDay = { projectLabel: "q", records: [record(new Date(2026, 9, 20, 10, 0), { usage: usage(1, 0, 0, 0) })] };

    const points = projectRadar(twoDays, [twoDays, oneDay]);
    expect(points.find((p) => p.axis === "persistence")!.raw).toBe(2);
    expect(points.find((p) => p.axis === "persistence")!.normalized).toBe(1);
    expect(projectRadar(oneDay, [twoDays, oneDay]).find((p) => p.axis === "persistence")!.normalized).toBe(0);

    // 并列：两天 vs 两天（同为极值）→ 0.5
    const alsoTwoDays = { projectLabel: "r", records: [...twoDays.records] };
    const twin = projectRadar(twoDays, [twoDays, alsoTwoDays]);
    expect(twin.find((p) => p.axis === "persistence")!.normalized).toBe(0.5);
  });

  it("messageDensity 分母是覆盖的非零小时格（相同 (星期,小时) 只算一格）", () => {
    // 两天同一时刻（10/10 与 10/17 同为周日 10 点）→ 只覆盖 1 格
    const records = [
      record(new Date(2026, 9, 10, 10, 0)),
      record(new Date(2026, 9, 17, 10, 0))
    ];
    const points = projectRadar({ projectLabel: "p", records });
    const density = points.find((p) => p.axis === "messageDensity")!;
    expect(density.raw).toBeCloseTo(2 / 1, 12);
  });

  it("活跃日不连续时 persistence 取最长段，不是总天数", () => {
    const records = [
      record(new Date(2026, 9, 1, 10, 0)),
      record(new Date(2026, 9, 2, 10, 0)),
      record(new Date(2026, 9, 3, 10, 0)),
      record(new Date(2026, 9, 9, 10, 0)),
      record(new Date(2026, 9, 10, 10, 0))
    ];
    const points = projectRadar({ projectLabel: "p", records });
    expect(points.find((p) => p.axis === "persistence")!.raw).toBe(3);
  });

  it("空 records：六轴 raw 全 0 且不 NaN", () => {
    const points = projectRadar({ projectLabel: "p", records: [] });
    for (const point of points) {
      expect(Number.isFinite(point.raw)).toBe(true);
      expect(point.normalized).toBe(0.5);
    }
  });
});
