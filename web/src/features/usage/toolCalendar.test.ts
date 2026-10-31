import { describe, expect, it } from "vitest";
import { toolCalendar, TOOL_CALENDAR_MAX_TOOLS } from "./toolCalendar";
import type { UsageSessionInput } from "./usageAggregations";
import type { ToolBucketKey, ToolCallFact } from "./toolCensus";

/** 本地时刻夹具（同 monthlyReport.test.ts 惯例）。 */
function at(year: number, month: number, day: number, hour = 10): number {
  return new Date(year, month - 1, day, hour).getTime();
}

/** 手造 ToolCallFact（同 toolCensus.test.ts 惯例）。 */
function fact(key: ToolBucketKey, timestamp: number, sidechain = false): ToolCallFact {
  return { key, timestamp, sidechain };
}

/** 极简 record：只有时间戳（窗口事件源之一）。 */
function bareRecord(timestamp: number): { timestamp: number } {
  return { timestamp };
}

/** 造一个带工具事实的输入；records 只用来撑窗口。 */
function inputOf(
  timestamps: number[],
  facts: ToolCallFact[],
  projectLabel = "p"
): UsageSessionInput {
  return {
    records: timestamps.map(bareRecord),
    projectLabel,
    toolCalls: facts
  } as unknown as UsageSessionInput;
}

/** 内置工具 key。 */
function builtin(name: string): ToolBucketKey {
  return { kind: "builtin", toolName: name };
}

describe("toolCalendar", () => {
  it("空 sessions → 空数组", () => {
    expect(toolCalendar([], at(2026, 3, 1))).toEqual([]);
  });

  it("只有 records 没有 toolCalls → 空数组（没有工具可画）", () => {
    const input = inputOf([at(2026, 3, 1)], []);
    expect(toolCalendar([input], at(2026, 3, 1))).toEqual([]);
  });

  it("单月窗口：一行一格，months 序列长度跟窗口走", () => {
    const rows = toolCalendar(
      [inputOf([at(2026, 3, 1)], [fact(builtin("Bash"), at(2026, 3, 5)), fact(builtin("Bash"), at(2026, 3, 20))])],
      at(2026, 3, 25)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("builtin:Bash");
    expect(rows[0].label).toBe("Bash");
    expect(rows[0].totalCalls).toBe(2);
    expect(rows[0].months).toEqual([{ year: 2026, month: 3, calls: 2 }]);
  });

  it("空月保留：中间月无调用 → calls: 0 占位", () => {
    const rows = toolCalendar(
      [inputOf([at(2026, 1, 10)], [fact(builtin("Grep"), at(2026, 1, 10)), fact(builtin("Grep"), at(2026, 3, 10))])],
      at(2026, 3, 15)
    );
    expect(rows[0].months).toEqual([
      { year: 2026, month: 1, calls: 1 },
      { year: 2026, month: 2, calls: 0 },
      { year: 2026, month: 3, calls: 1 }
    ]);
  });

  it("跨年窗口：(year, month) 升序", () => {
    const rows = toolCalendar(
      [inputOf([at(2025, 12, 1)], [fact(builtin("Read"), at(2025, 12, 1)), fact(builtin("Read"), at(2026, 2, 1))])],
      at(2026, 2, 10)
    );
    expect(rows[0].months.map((m) => [m.year, m.month])).toEqual([
      [2025, 12],
      [2026, 1],
      [2026, 2]
    ]);
  });

  it("窗口事件源含 toolCalls 时间戳：晚于最后 record 的事实撑起尾巴月", () => {
    // records 止于 1 月；toolCalls 落在 3 月——只看 records 会把 3 月裁掉。
    const rows = toolCalendar(
      [inputOf([at(2026, 1, 10)], [fact(builtin("Bash"), at(2026, 3, 20))])],
      at(2026, 1, 15)
    );
    expect(rows[0].months).toHaveLength(3);
    expect(rows[0].months[2]).toEqual({ year: 2026, month: 3, calls: 1 });
  });

  it("now 晚于最后事实 → 窗口扩到 now 所在月（与 G4 同规则）", () => {
    const rows = toolCalendar(
      [inputOf([at(2026, 1, 10)], [fact(builtin("Bash"), at(2026, 1, 10))])],
      at(2026, 4, 20)
    );
    expect(rows[0].months.map((m) => m.month)).toEqual([1, 2, 3, 4]);
  });

  it("sidechain 事实照常入列（普查口径）", () => {
    const rows = toolCalendar(
      [inputOf([at(2026, 3, 1)], [
        fact(builtin("Agent"), at(2026, 3, 5), false),
        fact(builtin("Agent"), at(2026, 3, 6), true)
      ])],
      at(2026, 3, 25)
    );
    expect(rows[0].totalCalls).toBe(2);
  });

  it("四类桶身份：builtin / skill / mcp(按 server) / subagent", () => {
    const rows = toolCalendar(
      [inputOf([at(2026, 3, 1)], [
        fact(builtin("Bash"), at(2026, 3, 1)),
        fact({ kind: "skill", skillName: "git-commit" }, at(2026, 3, 2)),
        fact({ kind: "mcp", server: "github", toolName: "create_issue" }, at(2026, 3, 3)),
        fact({ kind: "mcp", server: "github", toolName: "list_issues" }, at(2026, 3, 4)),
        fact({ kind: "subagent", subagentType: "repo-analyzer" }, at(2026, 3, 5))
      ])],
      at(2026, 3, 25)
    );
    // mcp 两条不同 toolName 按 server 聚成同一桶（censusKeyId 口径）。
    expect(rows.map((r) => r.key)).toEqual([
      "mcp:github",
      "builtin:Bash",
      "skill:git-commit",
      "subagent:repo-analyzer"
    ]);
    expect(rows[0].label).toBe("github");
    expect(rows[0].totalCalls).toBe(2);
  });

  it("排序：totalCalls 降序，并列按 label 字典序", () => {
    const rows = toolCalendar(
      [inputOf([at(2026, 3, 1)], [
        fact(builtin("Zed"), at(2026, 3, 1)),
        fact(builtin("Alpha"), at(2026, 3, 1)),
        fact(builtin("Beta"), at(2026, 3, 2)),
        fact(builtin("Beta"), at(2026, 3, 3))
      ])],
      at(2026, 3, 25)
    );
    // Beta 2 次居首；Alpha/Zed 各 1 次并列 → 字典序。
    expect(rows.map((r) => r.label)).toEqual(["Beta", "Alpha", "Zed"]);
  });

  it("超过 12 个工具 → 取前 12（TOOL_CALENDAR_MAX_TOOLS）", () => {
    const names = Array.from({ length: 15 }, (_, i) => `tool-${String(i).padStart(2, "0")}`);
    const facts = names.map((n, i) => fact(builtin(n), at(2026, 3, 1 + i % 28)));
    // 调用次数递减：tool-00 15 次 … 每次 i 名工具 (15-i) 次。
    const many: ToolCallFact[] = [];
    for (const n of names) {
      const times = 15 - names.indexOf(n);
      for (let k = 0; k < times; k++) many.push(fact(builtin(n), at(2026, 3, 1 + (k % 20))));
    }
    const rows = toolCalendar([inputOf([at(2026, 3, 1)], many)], at(2026, 3, 31));
    expect(rows).toHaveLength(TOOL_CALENDAR_MAX_TOOLS);
    // 恰好砍掉次数最少的 3 个（tool-12/13/14 各 3/2/1 次）。
    expect(rows.map((r) => r.label)).not.toContain("tool-12");
    expect(rows.map((r) => r.label)).toContain("tool-11");
    void facts;
  });

  it("多个 session 的同名工具跨 session 合并", () => {
    const rows = toolCalendar(
      [
        inputOf([at(2026, 1, 5)], [fact(builtin("Read"), at(2026, 1, 5))]),
        inputOf([at(2026, 2, 5)], [fact(builtin("Read"), at(2026, 2, 5)), fact(builtin("Read"), at(2026, 2, 6))])
      ],
      at(2026, 2, 25)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].totalCalls).toBe(3);
    expect(rows[0].months.map((m) => [m.month, m.calls])).toEqual([[1, 1], [2, 2]]);
  });
});
