import { describe, expect, it } from "vitest";
import { P95_SAMPLE_WINDOW, toolHealth, type ToolHealthEntry } from "./toolHealth";
import type { ToolCallFact } from "./toolCensus";

const T0 = Date.parse("2026-10-01T10:00:00.000Z");
const BASH: ToolCallFact["key"] = { kind: "builtin", toolName: "Bash" };
const GREP: ToolCallFact["key"] = { kind: "builtin", toolName: "Grep" };

function fact(
  key: ToolCallFact["key"],
  timestamp: number,
  patch: Partial<ToolCallFact> = {}
): ToolCallFact {
  return { key, timestamp, sidechain: false, ...patch };
}

function entryOf(entries: readonly ToolHealthEntry[], key: string): ToolHealthEntry {
  const entry = entries.find((item) => item.key === key);
  if (!entry) throw new Error(`missing entry ${key}`);
  return entry;
}

describe("toolHealth", () => {
  it("returns empty tools for empty input", () => {
    expect(toolHealth([])).toEqual({ tools: [], worst: [] });
  });

  it("tracks a healthy tool: zero failures, average and last use", () => {
    const report = toolHealth([
      fact(BASH, T0, { durationMs: 10, isError: false }),
      fact(BASH, T0 + 1_000, { durationMs: 20, isError: false }),
      fact(BASH, T0 + 2_000, { durationMs: 30, isError: false })
    ]);

    const bash = entryOf(report.tools, "builtin:Bash");
    expect(bash.calls).toBe(3);
    expect(bash.failures).toBe(0);
    expect(bash.failureRate).toBe(0);
    expect(bash.avgMs).toBe(20);
    expect(bash.p95Ms).toBe(30);
    expect(bash.lastUsedAt).toBe(T0 + 2_000);
  });

  it("refuses to print a failure rate below the sample threshold", () => {
    const two = toolHealth([
      fact(GREP, T0, { isError: true }),
      fact(GREP, T0 + 1_000, { isError: false })
    ]);
    const below = entryOf(two.tools, "builtin:Grep");
    expect(below.calls).toBe(2);
    expect(below.failures).toBe(1);
    expect(below.failureRate).toBeNull();

    const three = toolHealth([
      fact(GREP, T0, { isError: true }),
      fact(GREP, T0 + 1_000, { isError: false }),
      fact(GREP, T0 + 2_000, { isError: false })
    ]);
    const atThreshold = entryOf(three.tools, "builtin:Grep");
    expect(atThreshold.failureRate).toBeCloseTo(1 / 3, 12);
  });

  it("computes p95 over the most recent 100 samples, not the whole history", () => {
    const facts: ToolCallFact[] = [];
    for (let index = 1; index <= 120; index += 1) {
      facts.push(fact(BASH, T0 + index * 1_000, { durationMs: index, isError: false }));
    }
    const report = toolHealth(facts);
    const bash = entryOf(report.tools, "builtin:Bash");

    // 最近 100 个样本 = 21..120；nearest-rank p95 = 第 ceil(0.95*100)=95 个 → 115。
    expect(bash.p95Ms).toBe(115);
    // 均值仍用全部 120 个样本：(1+120)/2。
    expect(bash.avgMs).toBeCloseTo(60.5, 12);
    expect(bash.calls).toBe(120);
  });

  it("handles p95 for one and two samples", () => {
    const single = entryOf(toolHealth([fact(BASH, T0, { durationMs: 42, isError: false })]).tools, "builtin:Bash");
    expect(single.p95Ms).toBe(42);
    expect(single.avgMs).toBe(42);

    const pair = entryOf(
      toolHealth([
        fact(BASH, T0, { durationMs: 5, isError: false }),
        fact(BASH, T0 + 1_000, { durationMs: 9, isError: false })
      ]).tools,
      "builtin:Bash"
    );
    // nearest-rank：ceil(0.95*2)=2 → 第 2 个 = 9。
    expect(pair.p95Ms).toBe(9);
  });

  it("keeps unknown durations and outcomes out of the metrics instead of counting zeros", () => {
    const report = toolHealth([
      // 未配对（手造）：没有 durationMs / isError，连 lastUsedAt 都要算。
      fact(BASH, T0),
      fact(BASH, T0 + 5_000),
      // 有耗时但没有结果判定：均值有样本，失败率仍无分母。
      fact(BASH, T0 + 6_000, { durationMs: 12 })
    ]);

    const bash = entryOf(report.tools, "builtin:Bash");
    expect(bash.calls).toBe(0);
    expect(bash.failures).toBe(0);
    expect(bash.failureRate).toBeNull();
    expect(bash.avgMs).toBe(12);
    expect(bash.p95Ms).toBe(12);
    expect(bash.lastUsedAt).toBe(T0 + 6_000);
  });

  it("sorts worst by failureRate, then calls, then key; unknown rates go last", () => {
    const report = toolHealth([
      // D：4 次 2 失败 = 0.5
      fact({ kind: "builtin", toolName: "D" }, T0, { isError: true }),
      fact({ kind: "builtin", toolName: "D" }, T0 + 1, { isError: true }),
      fact({ kind: "builtin", toolName: "D" }, T0 + 2, { isError: false }),
      fact({ kind: "builtin", toolName: "D" }, T0 + 3, { isError: false }),
      // A：4 次 2 失败 = 0.5
      fact({ kind: "builtin", toolName: "A" }, T0, { isError: true }),
      fact({ kind: "builtin", toolName: "A" }, T0 + 1, { isError: true }),
      fact({ kind: "builtin", toolName: "A" }, T0 + 2, { isError: false }),
      fact({ kind: "builtin", toolName: "A" }, T0 + 3, { isError: false }),
      // B：6 次 3 失败 = 0.5，调用数更多 → 排最前
      ...Array.from({ length: 3 }, (_, index) => fact({ kind: "builtin", toolName: "B" }, T0 + index, { isError: true })),
      ...Array.from({ length: 3 }, (_, index) => fact({ kind: "builtin", toolName: "B" }, T0 + 10 + index, { isError: false })),
      // C：9 次 0 失败 = 0，排最后
      ...Array.from({ length: 9 }, (_, index) => fact({ kind: "builtin", toolName: "C" }, T0 + index, { isError: false }))
    ]);

    expect(report.worst.map((entry) => entry.key)).toEqual([
      "builtin:B",
      "builtin:A",
      "builtin:D",
      "builtin:C"
    ]);
    // tools 本身按 key 字典序。
    expect(report.tools.map((entry) => entry.key)).toEqual([
      "builtin:A",
      "builtin:B",
      "builtin:C",
      "builtin:D"
    ]);
  });

  it("keeps different bucket kinds with the same name apart", () => {
    const report = toolHealth([
      fact({ kind: "builtin", toolName: "search" }, T0, { isError: false }),
      fact({ kind: "mcp", server: "docs", toolName: "search" }, T0 + 1_000, { isError: true })
    ]);

    expect(report.tools.map((entry) => entry.key)).toEqual(["builtin:search", "mcp:docs"]);
    expect(entryOf(report.tools, "mcp:docs").failures).toBe(1);
  });

  it("exposes the sample-window constant used by the p95 rule", () => {
    expect(P95_SAMPLE_WINDOW).toBe(100);
  });
});
