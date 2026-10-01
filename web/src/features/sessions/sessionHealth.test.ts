import { describe, expect, it } from "vitest";
import type { SessionRecord } from "./types";
import { sessionHealth, sessionHealthText } from "./sessionHealth";

/** 2026-10-02 10:00 local — the "now" every fixture timestamp is built against. */
const NOW = new Date(2026, 9, 2, 10, 0, 0).getTime();
const TODAY_9AM = new Date(2026, 9, 2, 9, 0, 0).getTime();
const YESTERDAY = new Date(2026, 9, 1, 9, 0, 0).getTime();

function record(at: number, isError = false): SessionRecord {
  return {
    id: `r-${at}-${isError}`,
    kind: "assistant",
    timestamp: at,
    isError
  } as unknown as SessionRecord;
}

describe("sessionHealth", () => {
  it("今天的记录 → active-today", () => {
    expect(sessionHealth([record(YESTERDAY), record(TODAY_9AM)], NOW)).toBe("active-today");
  });

  it("全部在昨天及更早 → idle", () => {
    expect(sessionHealth([record(YESTERDAY)], NOW)).toBe("idle");
  });

  it("空记录 → idle（没有信息就没有状态）", () => {
    expect(sessionHealth([], NOW)).toBe("idle");
  });

  it("含失败记录 → has-errors", () => {
    expect(sessionHealth([record(TODAY_9AM, true)], NOW)).toBe("has-errors");
  });

  it("今天的失败与今天的正常并存时仍然是 has-errors（可行动的优先于氛围性的）", () => {
    const health = sessionHealth([record(TODAY_9AM), record(TODAY_9AM + 1000, true)], NOW);
    expect(health).toBe("has-errors");
  });

  it("午夜边界：昨天 23:59 不是今天", () => {
    const beforeMidnight = new Date(2026, 9, 1, 23, 59, 0).getTime();
    expect(sessionHealth([record(beforeMidnight)], NOW)).toBe("idle");
  });

  it("每个状态都有可读文案（不只靠颜色）", () => {
    expect(sessionHealthText("has-errors")).toBe("含失败记录");
    expect(sessionHealthText("active-today")).toBe("今日活跃");
    expect(sessionHealthText("idle")).toBe("历史会话");
  });
});
