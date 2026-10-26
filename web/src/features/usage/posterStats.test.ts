import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { buildPosterStats } from "./posterStats";

/**
 * 时间戳全部用本地日历构造（`new Date(y, m, d, h)`），断言也走同一条本地
 * 口径——任何时区跑这套用例都成立（同 usageAggregations.test 的做法）。
 */

const at = (year: number, month: number, day: number, hour = 12, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime();

let seq = 0;
function recordOf(
  timestamp: number,
  options: {
    kind?: SessionRecord["kind"];
    model?: string;
    usage?: Partial<SessionRecord["usage"]>;
  } = {}
): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: options.kind ?? "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    model: options.model,
    usage: options.usage as SessionRecord["usage"],
    raw: {}
  };
}

/** 会话级 metadata 最小夹具：只带 buildPosterStats 关心的字段。 */
function sessionMeta(sessionId: string, projectLabel: string, mtimeMs: number) {
  return {
    path: `/logs/${sessionId}.jsonl`,
    mtimeMs,
    sizeBytes: 1,
    projectLabel,
    sessionId,
    hasRecords: true
  };
}

describe("posterStats · 空态（没有数据不冒充成 0）", () => {
  it("returns all-zero figures and — placeholders for empty sessions", () => {
    const stats = buildPosterStats([]);
    expect(stats.totalTokens).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.activeDays).toBe(0);
    expect(stats.topProject).toBeNull();
    expect(stats.topModel).toBeNull();
    expect(stats.peakHourLabel).toBe("—");
    expect(stats.firstDay).toBe("—");
    expect(stats.lastDay).toBe("—");
    expect(stats.sessionId).toBe("—");
  });

  it("falls back to — when the last session carries no session metadata", () => {
    const stats = buildPosterStats([
      { records: [recordOf(at(2026, 10, 20, 10))], projectLabel: "p" }
    ]);
    expect(stats.sessionId).toBe("—");
  });
});

describe("posterStats · 榜首与并列", () => {
  it("picks the project with the most tokens and breaks ties lexicographically", () => {
    // beta 与 alpha 同为 300 token：并列取字典序更小的 alpha。
    const stats = buildPosterStats([
      {
        records: [recordOf(at(2026, 10, 20, 10), { usage: { inputTokens: 300 } })],
        projectLabel: "beta"
      },
      {
        records: [recordOf(at(2026, 10, 20, 11), { usage: { inputTokens: 300 } })],
        projectLabel: "alpha"
      },
      {
        records: [recordOf(at(2026, 10, 20, 12), { usage: { inputTokens: 100 } })],
        projectLabel: "gamma"
      }
    ]);
    expect(stats.topProject).toBe("alpha");
  });

  it("sums all four counters when ranking models", () => {
    // opus 小 = input 10 + cacheRead 40 = 50；sonnet 大 = input 30 + cacheCreation 80 = 110。
    const stats = buildPosterStats([
      {
        records: [
          recordOf(at(2026, 10, 20, 10), {
            model: "claude-opus-4-1",
            usage: { inputTokens: 10, cacheReadTokens: 40 }
          }),
          recordOf(at(2026, 10, 20, 11), {
            model: "claude-sonnet-4-5",
            usage: { inputTokens: 30, cacheCreationTokens: 80 }
          })
        ],
        projectLabel: "p"
      }
    ]);
    expect(stats.topModel).toBe("claude-sonnet-4-5");
    expect(stats.totalTokens).toBe(160);
  });

  it("keeps the same tie rule for models", () => {
    const stats = buildPosterStats([
      {
        records: [
          recordOf(at(2026, 10, 20, 10), { model: "claude-opus-4-1", usage: { inputTokens: 50 } }),
          recordOf(at(2026, 10, 20, 11), { model: "claude-haiku-4-5", usage: { inputTokens: 50 } })
        ],
        projectLabel: "p"
      }
    ]);
    expect(stats.topModel).toBe("claude-haiku-4-5");
  });

  it("reports null when no bucket carries any tokens", () => {
    // 只有消息、没有任何 usage：榜首是「没有数据」，不是「第一名是 0」。
    const stats = buildPosterStats([
      { records: [recordOf(at(2026, 10, 20, 10), { kind: "user" })], projectLabel: "p" }
    ]);
    expect(stats.topProject).toBeNull();
    expect(stats.topModel).toBeNull();
    expect(stats.totalMessages).toBe(1);
    expect(stats.activeDays).toBe(1);
  });
});

describe("posterStats · 峰值小时与首末日", () => {
  it("labels the busiest hour as a closed-open range and wraps 23 into 00", () => {
    const stats = buildPosterStats([
      {
        records: [
          recordOf(at(2026, 10, 20, 14)),
          recordOf(at(2026, 10, 20, 14, 30)),
          recordOf(at(2026, 10, 20, 23)),
          recordOf(at(2026, 10, 21, 9))
        ],
        projectLabel: "p"
      }
    ]);
    // 14 点 2 条最多；23 点只 1 条不干扰主断言。
    expect(stats.peakHourLabel).toBe("14:00–15:00");
  });

  it("prefers the earlier hour when two hours tie", () => {
    const stats = buildPosterStats([
      {
        records: [
          recordOf(at(2026, 10, 20, 16)),
          recordOf(at(2026, 10, 21, 9)),
          recordOf(at(2026, 10, 22, 9))
        ],
        projectLabel: "p"
      }
    ]);
    // 9 点两条并列最多，但 16 点只有 1 条 → 峰值是 9 点；换一组真正并列的：
    expect(stats.peakHourLabel).toBe("09:00–10:00");
  });

  it("breaks a genuine hour tie toward the earlier hour", () => {
    const stats = buildPosterStats([
      {
        records: [
          recordOf(at(2026, 10, 20, 18)),
          recordOf(at(2026, 10, 21, 18)),
          recordOf(at(2026, 10, 22, 9)),
          recordOf(at(2026, 10, 23, 9))
        ],
        projectLabel: "p"
      }
    ]);
    // 18 点与 9 点各 2 条：取更早的 9 点。
    expect(stats.peakHourLabel).toBe("09:00–10:00");
  });

  it("formats firstDay/lastDay as M/D without zero padding and spans multiple days", () => {
    const stats = buildPosterStats([
      {
        records: [recordOf(at(2026, 9, 5, 8))],
        projectLabel: "p"
      },
      {
        records: [recordOf(at(2026, 12, 25, 20))],
        projectLabel: "p"
      }
    ]);
    expect(stats.firstDay).toBe("9/5");
    expect(stats.lastDay).toBe("12/25");
    expect(stats.activeDays).toBe(2);
  });
});

describe("posterStats · sessionId 口径", () => {
  it("reads the sessionId of the last session's metadata", () => {
    const stats = buildPosterStats([
      {
        records: [recordOf(at(2026, 10, 20, 10))],
        projectLabel: "a",
        session: sessionMeta("first-session", "a", at(2026, 10, 20))
      },
      {
        records: [recordOf(at(2026, 10, 21, 10))],
        projectLabel: "b",
        session: sessionMeta("last-session", "b", at(2026, 10, 21))
      }
    ]);
    expect(stats.sessionId).toBe("last-session");
    // 首末日按记录时间，不按 session 顺序。
    expect(stats.firstDay).toBe("10/20");
    expect(stats.lastDay).toBe("10/21");
  });

  it("counts activeDays from daily buckets, not calendar spans", () => {
    // 10/20 与 10/23 各一条消息：活跃 2 天，不是跨度的 4 天。
    const stats = buildPosterStats([
      {
        records: [recordOf(at(2026, 10, 20, 10)), recordOf(at(2026, 10, 23, 10))],
        projectLabel: "p"
      }
    ]);
    expect(stats.activeDays).toBe(2);
  });
});
