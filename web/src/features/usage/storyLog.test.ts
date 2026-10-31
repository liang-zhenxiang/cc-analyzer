import { describe, expect, it } from "vitest";
import { storyLog } from "./storyLog";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/** 固定时间基：2026-10-10 09:00 本地。 */
const BASE = new Date(2026, 9, 10, 9, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

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

function usage(input: number, output = 0, cacheCreation = 0, cacheRead = 0): SessionUsage {
  return { inputTokens: input, outputTokens: output, cacheCreationTokens: cacheCreation, cacheReadTokens: cacheRead };
}

function session(times: number[], projectLabel: string, patch: Partial<UsageSessionInput> = {}): UsageSessionInput {
  return { projectLabel, records: times.map((at) => record(at)), ...patch };
}

describe("storyLog · 基础", () => {
  it("空输入 → []", () => {
    expect(storyLog([])).toEqual([]);
  });

  it("空 records 的会话被跳过（没有归属日）", () => {
    expect(storyLog([session([], "p")])).toEqual([]);
  });

  it("单会话单日：date/sessions/projects/tokens/messages 各就各位", () => {
    const days = storyLog([
      {
        projectLabel: "alpha",
        records: [
          record(BASE, { usage: usage(100) }),
          record(BASE + 5 * MIN, { usage: usage(200) })
        ]
      }
    ]);
    expect(days).toHaveLength(1);
    expect(days[0]).toEqual({
      date: "2026-10-10",
      sessions: 1,
      projects: ["alpha"],
      tokens: 300,
      messages: 2,
      busiestHour: 9,
      busiestHourShare: 1
    });
  });

  it("tokens = 四计数器之和（input+output+cacheCreation+cacheRead）", () => {
    const days = storyLog([
      {
        projectLabel: "p",
        records: [record(BASE, { usage: usage(100, 10, 1000, 500) })]
      }
    ]);
    expect(days[0].tokens).toBe(1610);
  });
});

describe("storyLog · 归属日与跨午夜", () => {
  it("会话归属首条记录的本地日（跨午夜算开工那天）", () => {
    // 10-10 23:00 开工，10-11 01:00 收尾 → 归 10-10。
    const start = new Date(2026, 9, 10, 23, 0).getTime();
    const days = storyLog([session([start, start + 2 * HOUR], "p")]);
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-10-10");
    // 两条消息分属 23 点与次日 1 点，但都记到归属日 10-10。
    expect(days[0].messages).toBe(2);
    expect(days[0].busiestHour).toBe(1); // 23 点 1 条、1 点 1 条 → 并列取早
    expect(days[0].busiestHourShare).toBeCloseTo(0.5, 12);
  });

  it("records 乱序时归属 min timestamp 的日子", () => {
    const later = new Date(2026, 9, 12, 10, 0).getTime();
    const days = storyLog([session([later, BASE], "p")]); // 乱序传入
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-10-10");
  });

  it("同日多会话合并：sessions/projects 去重聚合", () => {
    const noon = BASE + 3 * HOUR;
    const days = storyLog([
      session([BASE], "alpha"),
      session([noon], "beta"),
      session([BASE + MIN], "alpha")
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].sessions).toBe(3);
    expect(days[0].projects).toEqual(["alpha", "beta"]);
  });
});

describe("storyLog · 最忙整点", () => {
  it("消息最多的整点胜出；并列取更早", () => {
    const t9 = BASE; // 09:xx
    const t11 = BASE + 2 * HOUR; // 11:xx
    const t11b = BASE + 2 * HOUR + 5 * MIN;
    const days = storyLog([
      session([t9, t11, t11b], "p")
    ]);
    expect(days[0].busiestHour).toBe(11);
    expect(days[0].busiestHourShare).toBeCloseTo(2 / 3, 12);
  });

  it("整天无消息（只有 tool 行）→ busiestHour null、share 0", () => {
    const days = storyLog([
      { projectLabel: "p", records: [record(BASE, { kind: "tool", toolName: "Bash" })] }
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].busiestHour).toBeNull();
    expect(days[0].busiestHourShare).toBe(0);
  });

  it("compactSummary 不算消息", () => {
    const days = storyLog([
      {
        projectLabel: "p",
        records: [
          record(BASE),
          record(BASE + MIN, { kind: "user", compactSummary: true })
        ]
      }
    ]);
    expect(days[0].messages).toBe(1);
  });
});

describe("storyLog · 排序", () => {
  it("按日期倒序（最新在前）", () => {
    const day2 = new Date(2026, 9, 11, 10, 0).getTime();
    const day3 = new Date(2026, 9, 12, 10, 0).getTime();
    const days = storyLog([session([BASE], "p"), session([day3], "p"), session([day2], "p")]);
    expect(days.map((day) => day.date)).toEqual(["2026-10-12", "2026-10-11", "2026-10-10"]);
  });
});
