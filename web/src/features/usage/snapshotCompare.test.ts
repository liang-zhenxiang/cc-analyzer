import { describe, expect, it } from "vitest";
import {
  compareUsageSnapshots,
  parseUsageSnapshot,
  SNAPSHOT_METRICS,
  USAGE_SNAPSHOT_SCHEMA_VERSION,
  type UsageSnapshot
} from "./snapshotCompare";

function snapshot(extra: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    schema: "cca.usage.snapshot",
    schemaVersion: USAGE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: 1000,
    range: { days: 30, start: 100, end: 200 },
    totals: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheCreationTokens: 200,
      cacheReadTokens: 400,
      messages: 10,
      sessions: 2,
      estimatedCostUsd: 0.5
    },
    ...extra
  };
}

function validJson(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: "cca.usage.snapshot",
    version: 1,
    generatedAt: 123,
    range: { days: 7, start: 1, end: 2 },
    totals: { inputTokens: 10, outputTokens: 20, sessions: 3 },
    ...extra
  };
}

describe("parseUsageSnapshot", () => {
  it("读 schema/version/range/totals", () => {
    const parsed = parseUsageSnapshot(validJson());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.schema).toBe("cca.usage.snapshot");
    expect(parsed.snapshot.schemaVersion).toBe(1);
    expect(parsed.snapshot.generatedAt).toBe(123);
    expect(parsed.snapshot.range).toEqual({ days: 7, start: 1, end: 2 });
    expect(parsed.snapshot.totals.inputTokens).toBe(10);
    expect(parsed.snapshot.totals.sessions).toBe(3);
    expect(parsed.snapshot.totals.messages).toBeNull();
  });

  it("缺 schema 显式拒收并说明原因", () => {
    const parsed = parseUsageSnapshot(validJson({ schema: undefined }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("schema 字段缺失");
    expect(parsed.reason).toContain("cca.usage.snapshot");
  });

  it("错 schema 显式拒收（不是快照的文件不会被误读成空表）", () => {
    const parsed = parseUsageSnapshot(validJson({ schema: "claude.session.log" }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain("claude.session.log");
    expect(parsed.reason).toContain("cca.usage.snapshot");
  });

  it("version 缺失或不可解析时拒收", () => {
    for (const version of [undefined, "1", Number.NaN, null]) {
      const parsed = parseUsageSnapshot(validJson({ version }));
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toContain("version");
    }
  });

  it("非对象输入拒收", () => {
    for (const value of [null, "nope", 42, [1, 2]]) {
      const parsed = parseUsageSnapshot(value);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe("不是 JSON 对象");
    }
  });

  it("认了之后字段缺失/字符串数字/非有限值按 null，不抛异常", () => {
    const parsed = parseUsageSnapshot(
      validJson({
        totals: { inputTokens: "10", outputTokens: Number.POSITIVE_INFINITY, cacheReadTokens: null },
        range: { days: "7" }
      })
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.totals.inputTokens).toBeNull();
    expect(parsed.snapshot.totals.outputTokens).toBeNull();
    expect(parsed.snapshot.totals.cacheReadTokens).toBeNull();
    expect(parsed.snapshot.range).toEqual({ days: null, start: null, end: null });
  });

  it("v1 不导出成本，但旧文件里的 estimatedCostUsd 仍可读", () => {
    const parsed = parseUsageSnapshot(validJson({ totals: { estimatedCostUsd: 1.25 } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.snapshot.totals.estimatedCostUsd).toBe(1.25);
    expect(SNAPSHOT_METRICS.map((metric) => metric.key)).not.toContain("estimatedCostUsd");
  });
});

describe("compareUsageSnapshots", () => {
  it("行序固定、delta = b - a、deltaPct 以 a 为分母，且不含成本行", () => {
    const a = snapshot();
    const b = snapshot({
      totals: {
        inputTokens: 1500,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 400,
        messages: 5,
        sessions: 2,
        estimatedCostUsd: 0.75
      }
    });
    const { rows } = compareUsageSnapshots(a, b);
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.metric)).toEqual(SNAPSHOT_METRICS.map((metric) => metric.label));
    expect(rows[0]).toEqual({ metric: "输入 tokens", a: 1000, b: 1500, delta: 500, deltaPct: 0.5 });
    expect(rows[4]).toEqual({ metric: "消息数", a: 10, b: 5, delta: -5, deltaPct: -0.5 });
    expect(rows[2].deltaPct).toBe(-1);
    expect(rows.map((row) => row.metric)).not.toContain("估算成本");
  });

  it("a 为 0 或任一侧缺失时 pct 为 null（界面印「—」）", () => {
    const a = snapshot({
      totals: { ...snapshot().totals, messages: 0, sessions: null }
    });
    const b = snapshot({ totals: { ...snapshot().totals, messages: 9, sessions: 4 } });
    const { rows } = compareUsageSnapshots(a, b);
    expect(rows[4].delta).toBe(9);
    expect(rows[4].deltaPct).toBeNull();
    expect(rows[5].delta).toBeNull();
    expect(rows[5].deltaPct).toBeNull();
  });

  it("version 数值不同时 meta.versionMismatch 为真，且不阻止对比", () => {
    const { meta, rows } = compareUsageSnapshots(snapshot({ schemaVersion: 1 }), snapshot({ schemaVersion: 2 }));
    expect(meta.versionMismatch).toBe(true);
    expect(rows).toHaveLength(SNAPSHOT_METRICS.length);
    expect(meta.aGeneratedAt).toBe(1000);
    expect(meta.aRange.days).toBe(30);
    expect(meta.bRange.days).toBe(30);
  });

  it("version 相同不算版本不一致", () => {
    expect(compareUsageSnapshots(snapshot(), snapshot()).meta.versionMismatch).toBe(false);
  });
});
