import { describe, expect, it } from "vitest";
import { peakMinute } from "./peakMinute";
import type { UsageSessionInput } from "./usageAggregations";
import type { SessionRecord, SessionUsage } from "../sessions/types";

let seq = 0;
function record(at: Date, usage?: SessionUsage): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at.getTime(),
    durationMs: 0,
    text: "",
    isError: false,
    usage,
    raw: {}
  };
}

function usage(input: number, output: number, cacheCreation: number, cacheRead: number): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

function session(records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "p" };
}

const NOON = new Date(2026, 9, 1, 12, 0, 0, 0).getTime();

describe("peakMinute", () => {
  it("returns an empty report for no input", () => {
    expect(peakMinute([])).toEqual({
      minuteStart: null,
      tokens: 0,
      runnerUp: null,
      distinctMinutes: 0
    });
  });

  it("sums one minute across records", () => {
    const report = peakMinute([
      session([
        record(new Date(2026, 9, 1, 12, 0, 10), usage(10, 0, 0, 0)),
        record(new Date(2026, 9, 1, 12, 0, 40), usage(0, 5, 0, 0))
      ])
    ]);
    expect(report.minuteStart).toBe(NOON);
    expect(report.tokens).toBe(15);
    expect(report.runnerUp).toBeNull();
    expect(report.distinctMinutes).toBe(1);
  });

  it("breaks a tie by the earlier minute", () => {
    const report = peakMinute([
      session([
        record(new Date(2026, 9, 1, 12, 1, 0), usage(10, 0, 0, 0)),
        record(new Date(2026, 9, 1, 12, 0, 0), usage(10, 0, 0, 0))
      ])
    ]);
    expect(report.minuteStart).toBe(NOON);
    expect(report.runnerUp?.minuteStart).toBe(NOON + 60_000);
    expect(report.distinctMinutes).toBe(2);
  });

  it("treats 12:00:59 and 12:01:00 as different minutes", () => {
    const report = peakMinute([
      session([
        record(new Date(2026, 9, 1, 12, 0, 59), usage(3, 0, 0, 0)),
        record(new Date(2026, 9, 1, 12, 1, 0), usage(3, 0, 0, 0))
      ])
    ]);
    expect(report.distinctMinutes).toBe(2);
    expect(report.minuteStart).toBe(NOON);
    expect(report.runnerUp?.minuteStart).toBe(NOON + 60_000);
  });

  it("picks the second highest minute as runner-up", () => {
    const report = peakMinute([
      session([
        record(new Date(2026, 9, 1, 12, 0, 0), usage(10, 0, 0, 0)),
        record(new Date(2026, 9, 1, 12, 2, 0), usage(8, 0, 0, 0)),
        record(new Date(2026, 9, 1, 12, 4, 0), usage(5, 0, 0, 0))
      ])
    ]);
    expect(report.tokens).toBe(10);
    expect(report.runnerUp?.tokens).toBe(8);
    expect(report.runnerUp?.minuteStart).toBe(NOON + 2 * 60_000);
    expect(report.distinctMinutes).toBe(3);
  });

  it("ignores zero-token and usage-less records", () => {
    const report = peakMinute([
      session([
        record(new Date(2026, 9, 1, 12, 0, 0), usage(0, 0, 0, 0)),
        record(new Date(2026, 9, 1, 12, 0, 1)),
        record(new Date(2026, 9, 1, 12, 5, 0), usage(0, 4, 0, 0))
      ])
    ]);
    expect(report.distinctMinutes).toBe(1);
    expect(report.minuteStart).toBe(NOON + 5 * 60_000);
    expect(report.tokens).toBe(4);
    expect(report.runnerUp).toBeNull();
  });

  it("counts all four counters", () => {
    const report = peakMinute([
      session([record(new Date(2026, 9, 1, 12, 0, 0), usage(1, 2, 3, 4))])
    ]);
    expect(report.tokens).toBe(10);
  });
});
