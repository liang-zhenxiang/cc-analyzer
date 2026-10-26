import { describe, expect, it } from "vitest";
import { CHRONO_THRESHOLD_PP, workHabits } from "./workHabits";
import type { UsageSessionInput } from "./usageAggregations";
import type { SessionRecord } from "../sessions/types";

let seq = 0;
function message(at: Date, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "user",
    timestamp: at.getTime(),
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function session(records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "p" };
}

/** 在某天若干整点各放 count 条消息（小时计数只关心 hour）。 */
function messagesAt(counts: ReadonlyArray<readonly [hour: number, count: number]>, day = 5): SessionRecord[] {
  const records: SessionRecord[] = [];
  for (const [hour, count] of counts) {
    for (let index = 0; index < count; index += 1) {
      records.push(message(new Date(2026, 9, day, hour, 0, index % 60)));
    }
  }
  return records;
}

/** 1000 条消息的三段构成：morning 条在 9 点，evening 条在 20 点，其余落在 3 点。 */
function chronoSession(morning: number, evening: number): UsageSessionInput {
  const neutral = 1000 - morning - evening;
  return session(
    messagesAt([
      [9, morning],
      [20, evening],
      [3, neutral]
    ])
  );
}

const NOW = new Date(2026, 9, 6, 12, 0).getTime();

describe("workHabits chronoType", () => {
  it("keeps 14.9pp inside 均衡", () => {
    expect(workHabits([chronoSession(510, 361)], NOW).chronoType).toBe("均衡");
  });

  it("flips to 早鸟 at 15.1pp", () => {
    expect(workHabits([chronoSession(511, 360)], NOW).chronoType).toBe("早鸟");
  });

  it("flips to 夜猫 at -15.1pp on the other side", () => {
    expect(workHabits([chronoSession(360, 511)], NOW).chronoType).toBe("夜猫");
  });

  it("keeps -14.9pp inside 均衡", () => {
    expect(workHabits([chronoSession(361, 510)], NOW).chronoType).toBe("均衡");
  });

  it("treats exactly 15pp as 早鸟 (>= threshold)", () => {
    expect(workHabits([chronoSession(510, 360)], NOW).chronoType).toBe("早鸟");
    expect(CHRONO_THRESHOLD_PP).toBe(15);
  });

  it("divides by all messages, not just the two windows", () => {
    // 1000 条里 morning 200 / evening 100 / 其余 700 → 10pp，不是 (200-100)/300=33pp。
    expect(workHabits([chronoSession(200, 100)], NOW).chronoType).toBe("均衡");
  });
});

describe("workHabits streak", () => {
  const now = new Date(2026, 9, 12, 12, 0).getTime();

  it("counts back from yesterday when today has no messages", () => {
    const habits = workHabits(
      [
        session([
          message(new Date(2026, 9, 11, 9, 0)),
          message(new Date(2026, 9, 10, 9, 0))
        ])
      ],
      now
    );
    expect(habits.currentStreak).toBe(2);
    expect(habits.longestStreak).toBe(2);
  });

  it("counts from today when today has messages", () => {
    const habits = workHabits(
      [
        session([
          message(new Date(2026, 9, 12, 9, 0)),
          message(new Date(2026, 9, 11, 9, 0)),
          message(new Date(2026, 9, 10, 9, 0))
        ])
      ],
      now
    );
    expect(habits.currentStreak).toBe(3);
    expect(habits.longestStreak).toBe(3);
  });

  it("is zero when both today and yesterday are empty", () => {
    const habits = workHabits([session([message(new Date(2026, 9, 10, 9, 0))])], now);
    expect(habits.currentStreak).toBe(0);
    expect(habits.longestStreak).toBe(1);
  });

  it("breaks the run over a gap and keeps the longest run", () => {
    const habits = workHabits(
      [
        session([
          message(new Date(2026, 9, 7, 9, 0)),
          message(new Date(2026, 9, 8, 9, 0)),
          message(new Date(2026, 9, 9, 9, 0)),
          message(new Date(2026, 9, 11, 9, 0)),
          message(new Date(2026, 9, 12, 9, 0))
        ])
      ],
      now
    );
    expect(habits.currentStreak).toBe(2);
    expect(habits.longestStreak).toBe(3);
  });

  it("counts one day even when the only message is a single record", () => {
    const habits = workHabits([session([message(new Date(2026, 9, 12, 0, 30))])], now);
    expect(habits.currentStreak).toBe(1);
  });
});

describe("workHabits longestSessionMinutes", () => {
  const now = new Date(2026, 9, 12, 12, 0).getTime();

  it("measures a session across midnight by its wall-clock span", () => {
    const habits = workHabits(
      [
        session([
          message(new Date(2026, 9, 1, 23, 30)),
          message(new Date(2026, 9, 2, 1, 0))
        ])
      ],
      now
    );
    expect(habits.longestSessionMinutes).toBe(90);
  });

  it("keeps the longest of several sessions and ignores single-record ones", () => {
    const habits = workHabits(
      [
        session([message(new Date(2026, 9, 1, 10, 0))]),
        session([
          message(new Date(2026, 9, 1, 10, 0)),
          message(new Date(2026, 9, 1, 10, 45))
        ]),
        session([
          message(new Date(2026, 9, 2, 10, 0)),
          message(new Date(2026, 9, 2, 11, 30))
        ])
      ],
      now
    );
    expect(habits.longestSessionMinutes).toBe(90);
  });

  it("uses all records, not only messages, for the span", () => {
    const habits = workHabits(
      [
        session([
          message(new Date(2026, 9, 1, 10, 0)),
          // 工具记录也是会话的一部分（没有消息也照样撑开墙钟跨度）。
          message(new Date(2026, 9, 1, 11, 0), { kind: "tool", toolName: "Bash" })
        ])
      ],
      now
    );
    expect(habits.longestSessionMinutes).toBe(60);
  });
});

describe("workHabits peakHour", () => {
  const now = new Date(2026, 9, 12, 12, 0).getTime();

  it("takes the earlier hour on a tie", () => {
    const habits = workHabits(
      [
        session(
          messagesAt([
            [9, 2],
            [21, 2],
            [12, 1]
          ])
        )
      ],
      now
    );
    expect(habits.peakHour).toBe(9);
    expect(habits.peakHourShare).toBeCloseTo(2 / 5, 12);
  });

  it("excludes compact summaries from messages", () => {
    const habits = workHabits(
      [
        session([
          message(new Date(2026, 9, 12, 9, 0)),
          message(new Date(2026, 9, 12, 9, 30)),
          message(new Date(2026, 9, 12, 3, 0), { compactSummary: true }),
          message(new Date(2026, 9, 12, 3, 1), { compactSummary: true })
        ])
      ],
      now
    );
    expect(habits.peakHour).toBe(9);
    expect(habits.peakHourShare).toBe(1);
  });

  it("returns an empty profile for no input", () => {
    expect(workHabits([], now)).toEqual({
      chronoType: "均衡",
      currentStreak: 0,
      longestStreak: 0,
      longestSessionMinutes: 0,
      peakHour: null,
      peakHourShare: 0
    });
  });
});
