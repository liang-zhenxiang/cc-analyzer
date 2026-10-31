import { describe, expect, it } from "vitest";
import { durationBucketOf, topKSimilar } from "./sessionSimilarity";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import type { UsageSessionInput } from "./usageAggregations";

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

function usage(): SessionUsage {
  return { inputTokens: 1_000, outputTokens: 100 };
}

function meta(path: string, patch: Partial<SessionMeta> = {}): SessionMeta {
  return {
    path,
    mtimeMs: 0,
    sizeBytes: 0,
    projectLabel: "p",
    hasRecords: true,
    ...patch
  };
}

function makeSession(patch: {
  path?: string;
  projectLabel?: string;
  models?: string[];
  tools?: string[];
  spanMinutes?: number;
}): UsageSessionInput {
  const span = patch.spanMinutes ?? 10;
  const models = patch.models ?? ["sonnet"];
  const records = models.map((model, index) =>
    record(BASE + index * MIN, { usage: usage(), model })
  );
  // 补一条末位记录把时长撑到 span。
  records.push(record(BASE + span * MIN));
  const session: UsageSessionInput = {
    projectLabel: patch.projectLabel ?? "p",
    records
  };
  if (patch.tools) {
    session.toolCalls = patch.tools.map((tool) => ({
      key: { kind: "builtin", toolName: tool },
      timestamp: BASE,
      sidechain: false
    }));
  }
  if (patch.path) {
    session.session = meta(patch.path);
  }
  return session;
}

describe("durationBucketOf", () => {
  it("边界：14.99→short；15→medium；59.99→medium；60→long；239.99→long；240→marathon", () => {
    expect(durationBucketOf(0)).toBe("short");
    expect(durationBucketOf(14.99)).toBe("short");
    expect(durationBucketOf(15)).toBe("medium");
    expect(durationBucketOf(59.99)).toBe("medium");
    expect(durationBucketOf(60)).toBe("long");
    expect(durationBucketOf(239.99)).toBe("long");
    expect(durationBucketOf(240)).toBe("marathon");
  });
});

describe("topKSimilar · 评分", () => {
  it("全维度相同 → score 1，理由齐备", () => {
    const target = makeSession({ path: "/t", projectLabel: "alpha", tools: ["Bash"], spanMinutes: 30 });
    const twin = makeSession({ path: "/c1", projectLabel: "alpha", tools: ["Bash"], spanMinutes: 40 });
    const [top] = topKSimilar(target, [twin], 3);
    expect(top.score).toBe(1);
    expect(top.session).toBe(twin);
    expect(top.reasons).toContain("同项目");
    expect(top.reasons).toContain("用了 1 个相同工具");
    expect(top.reasons).toContain("同模型（1 个）");
    expect(top.reasons).toContain("时长同量级");
  });

  it("权重手算对照：项目(1)+工具(2)+模型(1) 同、时长桶不同 → (1+2+1)/5", () => {
    const target = makeSession({ path: "/t", projectLabel: "alpha", tools: ["Bash"], spanMinutes: 30 });
    const candidate = makeSession({ path: "/c", projectLabel: "alpha", tools: ["Bash"], spanMinutes: 300 });
    const [top] = topKSimilar(target, [candidate], 3);
    expect(top.score).toBeCloseTo(4 / 5, 12);
  });

  it("工具集 Jaccard 而非交集计数：一半重叠 → 1/3", () => {
    // target {A,B} vs {B,C}：交 1 并 3 → 1/3；贡献 2×(1/3)/5。
    const target = makeSession({ path: "/t", tools: ["A", "B"], spanMinutes: 300, models: ["sonnet", "opus"] });
    const candidate = makeSession({
      path: "/c",
      projectLabel: "other",
      tools: ["B", "C"],
      spanMinutes: 300,
      models: ["opus", "haiku"]
    });
    // 项目 0；工具 1/3；模型 {sonnet,opus}∩{opus,haiku} = 1/3；时长同（marathon）1。
    const [top] = topKSimilar(target, [candidate], 3);
    const expected = (0 + 2 * (1 / 3) + 1 * (1 / 3) + 1) / 5;
    expect(top.score).toBeCloseTo(expected, 12);
    expect(top.reasons).toContain("用了 1 个相同工具");
  });

  it("无任何共同维度 → score 0 但仍返回，理由为「无共同维度」", () => {
    const target = makeSession({ path: "/t", projectLabel: "alpha", tools: ["A"], spanMinutes: 5, models: ["sonnet"] });
    const stranger = makeSession({ path: "/c", projectLabel: "beta", tools: ["B"], spanMinutes: 300, models: ["opus"] });
    const [top] = topKSimilar(target, [stranger], 3);
    expect(top.score).toBe(0);
    expect(top.reasons).toEqual(["无共同维度"]);
  });
});

describe("topKSimilar · 排序与裁剪", () => {
  it("按 score 降序，取前 K", () => {
    const target = makeSession({ path: "/t", projectLabel: "alpha", tools: ["A", "B"], spanMinutes: 30 });
    const high = makeSession({ path: "/h", projectLabel: "alpha", tools: ["A", "B"], spanMinutes: 30 });
    const mid = makeSession({ path: "/m", projectLabel: "alpha", spanMinutes: 30 });
    const low = makeSession({ path: "/l", spanMinutes: 300 });
    const out = topKSimilar(target, [low, high, mid], 2);
    expect(out.map((item) => item.session)).toEqual([high, mid]);
  });

  it("score 并列按会话身份字典序（meta.path）", () => {
    const target = makeSession({ path: "/t", projectLabel: "alpha", spanMinutes: 30 });
    const b = makeSession({ path: "/b", projectLabel: "alpha", spanMinutes: 30 });
    const a = makeSession({ path: "/a", projectLabel: "alpha", spanMinutes: 30 });
    const out = topKSimilar(target, [b, a], 3);
    expect(out.map((item) => (item.session.session as SessionMeta).path)).toEqual(["/a", "/b"]);
  });

  it("pool 里与 target 同 id（meta.path 相同）的排除", () => {
    const target = makeSession({ path: "/same", projectLabel: "alpha" });
    const self = makeSession({ path: "/same", projectLabel: "alpha" });
    const other = makeSession({ path: "/other", projectLabel: "alpha" });
    const out = topKSimilar(target, [self, other], 3);
    expect(out).toHaveLength(1);
    expect(out[0].session).toBe(other);
  });

  it("空 pool → []；k=0 → []", () => {
    const target = makeSession({ path: "/t" });
    expect(topKSimilar(target, [], 3)).toEqual([]);
    expect(topKSimilar(target, [makeSession({ path: "/c" })], 0)).toEqual([]);
  });

  it("默认 k=3", () => {
    const target = makeSession({ path: "/t", projectLabel: "alpha", spanMinutes: 30 });
    const pool = [1, 2, 3, 4].map((index) => makeSession({ path: `/c${index}`, projectLabel: "alpha", spanMinutes: 30 }));
    expect(topKSimilar(target, pool)).toHaveLength(3);
  });
});
