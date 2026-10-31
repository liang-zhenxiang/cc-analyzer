import { describe, expect, it } from "vitest";
import { buildMonthlyReport, monthSpanOf } from "./monthlyReport";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/** 本地日历构造；断言全部用本地时间，任何时区下成立。 */
function at(year: number, month: number, day: number, hour = 10, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

let seq = 0;
function record(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(input: number, output = 0, cacheCreation = 0, cacheRead = 0): SessionUsage {
  return { inputTokens: input, outputTokens: output, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead };
}

function inputOf(records: SessionRecord[], projectLabel = "p"): UsageSessionInput {
  return { records, projectLabel };
}

describe("monthlyReport · 空态", () => {
  it("无任何记录 → months 为空数组（没有窗口可谈，不冒充全 0 月）", () => {
    expect(buildMonthlyReport([], at(2026, 6, 15))).toEqual({ months: [] });
    expect(buildMonthlyReport([inputOf([])], at(2026, 6, 15))).toEqual({ months: [] });
  });
});

describe("monthlyReport · 窗口覆盖（含空月）", () => {
  it("首末月之间逐月出卡，中间无记录的月份照常出卡（全 0、topModel null）", () => {
    const report = buildMonthlyReport(
      [inputOf([record(at(2026, 1, 15), { usage: usage(100), model: "claude-x" })])],
      at(2026, 1, 20)
    );
    // 单月窗口只有一张卡。
    expect(report.months).toHaveLength(1);
    expect(report.months[0]).toMatchObject({ year: 2026, month: 1, tokens: 100, topModel: "claude-x" });
  });

  it("跨 3 个月窗口出 3 张卡，中间月全 0", () => {
    const report = buildMonthlyReport(
      [
        inputOf([record(at(2026, 8, 3), { usage: usage(100), model: "claude-a" })]),
        inputOf([record(at(2026, 10, 8), { usage: usage(200), model: "claude-a" })])
      ],
      at(2026, 10, 9)
    );
    expect(report.months.map((m) => m.month)).toEqual([8, 9, 10]);
    expect(report.months[1]).toEqual({ year: 2026, month: 9, tokens: 0, messages: 0, activeDays: 0, topModel: null, partial: false });
  });

  it("now 晚于最新记录时窗口末月以 now 为准（空尾月也是窗口的一部分）", () => {
    const report = buildMonthlyReport(
      [inputOf([record(at(2026, 2, 10), { usage: usage(50) })])],
      at(2026, 4, 10)
    );
    expect(report.months.map((m) => m.month)).toEqual([2, 3, 4]);
  });

  it("跨年窗口：2025-11 → 2026-02 的 (year, month) 升序正确", () => {
    const report = buildMonthlyReport(
      [
        inputOf([record(at(2025, 11, 5), { usage: usage(10) })]),
        inputOf([record(at(2026, 2, 5), { usage: usage(20) })])
      ],
      at(2026, 2, 6)
    );
    expect(report.months.map((m) => [m.year, m.month])).toEqual([
      [2025, 11], [2025, 12], [2026, 1], [2026, 2]
    ]);
  });
});

describe("monthlyReport · 月卡数字口径", () => {
  it("token 只计 usage 四计数之和；消息只数 user/assistant 非 compactSummary", () => {
    const records = [
      record(at(2026, 5, 2), { usage: usage(100, 10, 1, 1), model: "claude-a" }),
      record(at(2026, 5, 3), { kind: "user" }),
      record(at(2026, 5, 3), { kind: "assistant", compactSummary: true }),
      record(at(2026, 5, 4), { kind: "tool", toolName: "Bash" })
    ];
    const report = buildMonthlyReport([inputOf(records)], at(2026, 5, 5));
    expect(report.months[0].tokens).toBe(112);
    expect(report.months[0].messages).toBe(2);
  });

  it("activeDays 按有任何记录的本地日（tool-only 的日子也算活跃）", () => {
    const records = [
      record(at(2026, 5, 2), { usage: usage(10) }),
      record(at(2026, 5, 2), { usage: usage(10) }),
      record(at(2026, 5, 3), { kind: "tool", toolName: "Bash" })
    ];
    const report = buildMonthlyReport([inputOf(records)], at(2026, 5, 4));
    expect(report.months[0].activeDays).toBe(2);
  });

  it("跨月的记录各归各月（session 不整体归属一个月）", () => {
    const records = [
      record(at(2026, 7, 31, 23), { usage: usage(10) }),
      record(at(2026, 8, 1, 1), { usage: usage(20) })
    ];
    const report = buildMonthlyReport([inputOf(records)], at(2026, 8, 2));
    expect(report.months.map((m) => m.month)).toEqual([7, 8]);
    expect(report.months[0].tokens).toBe(10);
    expect(report.months[1].tokens).toBe(20);
  });
});

describe("monthlyReport · topModel", () => {
  it("按 usage 记录数取最大（不是 token 量）；并列取字典序更小；零 usage 月 null", () => {
    const records = [
      // claude-heavy：1 条 usage 但 token 巨大；claude-often：3 条小 usage。
      record(at(2026, 3, 2), { usage: usage(9000), model: "claude-heavy" }),
      record(at(2026, 3, 3), { usage: usage(1), model: "claude-often" }),
      record(at(2026, 3, 4), { usage: usage(1), model: "claude-often" }),
      record(at(2026, 3, 5), { usage: usage(1), model: "claude-often" })
    ];
    const report = buildMonthlyReport([inputOf(records)], at(2026, 3, 6));
    expect(report.months[0].topModel).toBe("claude-often");
  });

  it("并列（各 2 条）取字典序更小者", () => {
    const records = [
      record(at(2026, 3, 2), { usage: usage(10), model: "zzz-model" }),
      record(at(2026, 3, 3), { usage: usage(10), model: "zzz-model" }),
      record(at(2026, 3, 4), { usage: usage(10), model: "aaa-model" }),
      record(at(2026, 3, 5), { usage: usage(10), model: "aaa-model" })
    ];
    const report = buildMonthlyReport([inputOf(records)], at(2026, 3, 6));
    expect(report.months[0].topModel).toBe("aaa-model");
  });

  it("无 model 字段的 usage 记录落 UNKNOWN_MODEL_LABEL（桶身份稳定）", () => {
    const records = [record(at(2026, 3, 2), { usage: usage(10) })];
    const report = buildMonthlyReport([inputOf(records)], at(2026, 3, 6));
    expect(report.months[0].topModel).toBe("未知模型");
  });
});

describe("monthlyReport · partial 标记", () => {
  it("首月数据从月中开始 → 首卡 partial；1 号起且观察到月末 → 不标", () => {
    const midStart = buildMonthlyReport(
      [inputOf([record(at(2026, 6, 15))])],
      at(2026, 6, 20)
    );
    expect(midStart.months[0].partial).toBe(true);

    // 单月窗口要完全不 partial：数据 1 号起 + now 恰在月末（6/30）——
    // 否则「本月」永远是开放端，partial 是诚实的。
    const closedMonth = buildMonthlyReport(
      [inputOf([record(at(2026, 6, 1))])],
      at(2026, 6, 30)
    );
    expect(closedMonth.months).toHaveLength(1);
    expect(closedMonth.months[0].partial).toBe(false);
  });

  it("数据 1 号起 + now 已入次月 → 首卡不标（完整观察月），末卡标", () => {
    const closed = buildMonthlyReport(
      [inputOf([record(at(2026, 6, 1))])],
      at(2026, 7, 5)
    );
    // 6 月从 1 号观察到月末是完整月；7 月才是末月且未过完 → partial。
    expect(closed.months.map((m) => [m.month, m.partial])).toEqual([[6, false], [7, true]]);
  });

  it("now 在月中时，即使数据从 1 号起，当月卡也 partial（月末未到）", () => {
    const mid = buildMonthlyReport(
      [inputOf([record(at(2026, 6, 1))])],
      at(2026, 6, 20)
    );
    expect(mid.months[mid.months.length - 1].partial).toBe(true);
  });

  it("中间月即使是空月也不标 partial（空是没用，半月是没过完）", () => {
    const report = buildMonthlyReport(
      [
        inputOf([record(at(2026, 8, 3), { usage: usage(10) })]),
        inputOf([record(at(2026, 10, 8), { usage: usage(10) })])
      ],
      at(2026, 10, 9)
    );
    expect(report.months[1].partial).toBe(false);
  });

  it("单月窗口首末是同一张卡：两侧任一 partial 即 partial", () => {
    const report = buildMonthlyReport(
      [inputOf([record(at(2026, 6, 15))])],
      at(2026, 6, 20)
    );
    expect(report.months).toHaveLength(1);
    expect(report.months[0].partial).toBe(true);
  });
});

describe("monthSpanOf · 三视图共用的窗口规则", () => {
  it("窗口由 records 定义，与 usage 无关（无 usage 记录同样撑开窗口）", () => {
    const span = monthSpanOf([inputOf([record(at(2026, 1, 10)), record(at(2026, 3, 10))])], at(2026, 3, 15));
    expect(span).toEqual([
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 }
    ]);
  });

  it("空 sessions → 空数组", () => {
    expect(monthSpanOf([], at(2026, 6, 1))).toEqual([]);
  });
});
