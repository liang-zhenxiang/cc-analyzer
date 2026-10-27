import { describe, expect, it } from "vitest";
import { annualReportOf } from "./annualReport";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/** 2026-10-10 09:00 本地；断言全部用本地日历构造，任何时区下成立。 */
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

describe("annualReport · 空与默认年", () => {
  it("无任何记录 → null", () => {
    expect(annualReportOf([])).toBeNull();
    expect(annualReportOf([inputOf([])])).toBeNull();
  });

  it("year 缺省取最新记录的本地年", () => {
    const sessions = [
      inputOf([record(at(2025, 3, 1), { usage: usage(1000) })]),
      inputOf([record(at(2026, 6, 15), { usage: usage(2000) })])
    ];
    const report = annualReportOf(sessions)!;
    expect(report.year).toBe(2026);
    // 2026 过滤后只剩 6/15 那条：token 2000、活跃 1 天。
    expect(report.totalTokens).toBe(2000);
    expect(report.activeDays).toBe(1);
  });

  it("目标年过滤后为空 → null（「这一年没有数据」，不是全 0 年报）", () => {
    const sessions = [inputOf([record(at(2024, 5, 1), { usage: usage(1000) })])];
    expect(annualReportOf(sessions, 2026)).toBeNull();
  });
});

describe("annualReport · 基础数字", () => {
  it("token 只计 usage 四计数之和；消息只数 user/assistant 非 compactSummary；工具记录不数消息", () => {
    const records = [
      record(at(2026, 1, 5), { usage: usage(1000, 100, 10, 1), model: "m1" }),
      record(at(2026, 1, 5), { kind: "user" }),
      record(at(2026, 1, 6), { kind: "assistant", compactSummary: true }),
      record(at(2026, 1, 6), { kind: "tool", toolName: "Bash" })
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.totalTokens).toBe(1111);
    expect(report.totalMessages).toBe(2);
  });

  it("firstDay/lastDay 是 M/D 格式；activeDays 按有任何记录的本地日（含无 usage 的日子）", () => {
    const records = [
      record(at(2026, 2, 1), { usage: usage(10) }),
      record(at(2026, 11, 23)),
      record(at(2026, 11, 23), { usage: usage(20) })
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.firstDay).toBe("2/1");
    expect(report.lastDay).toBe("11/23");
    expect(report.activeDays).toBe(2);
  });

  it("dataStartsMidYear：起点晚于 1/1 → true；1/1 有记录 → false", () => {
    const mid = annualReportOf([inputOf([record(at(2026, 3, 1))])], 2026)!;
    expect(mid.dataStartsMidYear).toBe(true);
    const janFirst = annualReportOf([inputOf([record(at(2026, 1, 1))])], 2026)!;
    expect(janFirst.dataStartsMidYear).toBe(false);
  });
});

describe("annualReport · 之最与并列", () => {
  it("topMonth 是 1–12 的月号；并列取更早月", () => {
    const records = [
      record(at(2026, 3, 2), { usage: usage(500) }),
      record(at(2026, 7, 2), { usage: usage(500) }),
      record(at(2026, 5, 2), { usage: usage(400) })
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.topMonth).toEqual({ month: 3, tokens: 500 });
  });

  it("topModel 并列取模型名字典序", () => {
    const records = [
      record(at(2026, 4, 1), { usage: usage(100), model: "claude-sonnet-4" }),
      record(at(2026, 4, 2), { usage: usage(100), model: "claude-opus-4" })
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.topModel).toEqual({ model: "claude-opus-4", tokens: 100 });
  });

  it("costliestWeek 并列取更早周（周一起始的自然周）", () => {
    // 2026-03-02 与 2026-07-06 都是周一；两周 token 相同。
    const records = [
      record(at(2026, 3, 2), { usage: usage(300) }),
      record(at(2026, 3, 4), { usage: usage(100) }),
      record(at(2026, 7, 6), { usage: usage(400) })
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.costliestWeek).toEqual({ weekStartLabel: "3/2", tokens: 400 });
  });

  it("无 usage 输入（活跃但零消耗）→ 四个之最全 null，基础数字仍在", () => {
    const report = annualReportOf([inputOf([record(at(2026, 5, 1)), record(at(2026, 5, 2))])], 2026)!;
    expect(report.totalTokens).toBe(0);
    expect(report.activeDays).toBe(2);
    expect(report.topMonth).toBeNull();
    expect(report.topModel).toBeNull();
    expect(report.costliestWeek).toBeNull();
    expect(report.peakDay).toBeNull();
    // 无 usage → 无模型桶，topModel 不硬造「未知模型」条目。
  });

  it("peakDay 并列取更早日（升序扫描天然满足）", () => {
    const records = [
      record(at(2026, 6, 1), { usage: usage(100) }),
      record(at(2026, 6, 2), { usage: usage(100) })
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.peakDay).toEqual({ date: "6/1", tokens: 100 });
  });
});

describe("annualReport · 连击", () => {
  it("longestStreakDays 跨月连续；断档后取最长段", () => {
    const records = [
      record(at(2026, 1, 30), { usage: usage(1) }),
      record(at(2026, 1, 31), { usage: usage(1) }),
      record(at(2026, 2, 1), { usage: usage(1) }), // 跨月连续 3 天
      record(at(2026, 2, 10), { usage: usage(1) }),
      record(at(2026, 2, 11), { usage: usage(1) }) // 第二段 2 天
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.longestStreakDays).toBe(3);
  });

  it("单条记录 → streak 1", () => {
    const report = annualReportOf([inputOf([record(at(2026, 8, 8), { usage: usage(9) })])], 2026)!;
    expect(report.longestStreakDays).toBe(1);
  });

  it("同日多条记录只算一个活跃日（streak 不虚增）", () => {
    const records = [
      record(at(2026, 9, 1), { usage: usage(1) }),
      record(at(2026, 9, 1), { usage: usage(1) }),
      record(at(2026, 9, 2), { usage: usage(1) })
    ];
    const report = annualReportOf([inputOf(records)], 2026)!;
    expect(report.activeDays).toBe(2);
    expect(report.longestStreakDays).toBe(2);
  });
});

describe("annualReport · 年界", () => {
  it("跨年数据只取目标年（12/31 与次年 1/1 不互连）", () => {
    const sessions = [
      inputOf([
        record(at(2026, 12, 31), { usage: usage(10) }),
        record(at(2027, 1, 1), { usage: usage(20) })
      ])
    ];
    const report26 = annualReportOf(sessions, 2026)!;
    expect(report26.totalTokens).toBe(10);
    expect(report26.lastDay).toBe("12/31");
    expect(report26.longestStreakDays).toBe(1);

    const report27 = annualReportOf(sessions, 2027)!;
    expect(report27.totalTokens).toBe(20);
    expect(report27.firstDay).toBe("1/1");
  });
});
