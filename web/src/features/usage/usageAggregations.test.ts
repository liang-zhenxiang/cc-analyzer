import { describe, expect, it } from "vitest";
import {
  addLocalDays,
  aggregateRange,
  aggregateSession,
  aggregateSessionInput,
  dayStartOf,
  emptyAggregate,
  formatDayLabel,
  mergeAggregate,
  UNKNOWN_MODEL_LABEL,
  type UsageSessionInput
} from "./usageAggregations";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { parseJsonlText } from "../sessions/parseJsonl";

import daysFixture from "../../../tests/fixtures/usage-dashboard-days.jsonl?raw";
import modelsFixture from "../../../tests/fixtures/usage-dashboard-models.jsonl?raw";

/**
 * Every timestamp below is built with the local-calendar `Date` constructor
 * and asserted through the same local-calendar bucketing, so the expectations
 * hold in any timezone the suite runs in — no reliance on the runner's zone.
 */

let seq = 0;
function record(at: Date, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at.getTime(),
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
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

function inputOf(records: SessionRecord[], projectLabel = "p"): UsageSessionInput {
  return { records, projectLabel };
}

describe("usageAggregations", () => {
  it("aggregates an empty session into an all-zero aggregate", () => {
    const aggregate = aggregateSession([]);

    expect(aggregate.sessionCount).toBe(1);
    expect(aggregate.messages).toBe(0);
    expect(aggregate.totals).toEqual({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
    expect(aggregate.daily.size).toBe(0);
    expect(aggregate.models.size).toBe(0);
    expect(aggregate.projects.size).toBe(0);
    expect(aggregate.hourly.every((row) => row.every((count) => count === 0))).toBe(true);
    expect(mergeAggregate(emptyAggregate(), emptyAggregate())).toEqual(emptyAggregate());
  });

  it("sums the four token counters and counts user plus assistant records as messages", () => {
    const day = new Date(2026, 8, 28, 10, 0);
    const aggregate = aggregateSession([
      record(day, { kind: "user" }),
      record(new Date(2026, 8, 28, 10, 5), { usage: usage(100, 20, 300, 4000) }),
      record(new Date(2026, 8, 28, 10, 6), { kind: "tool", toolName: "Bash" }),
      record(new Date(2026, 8, 28, 10, 10))
    ]);

    expect(aggregate.messages).toBe(3);
    expect(aggregate.totals).toEqual({ input: 100, output: 20, cacheCreation: 300, cacheRead: 4000 });
  });

  it("buckets each record by its own local calendar day, not the session start", () => {
    const aggregate = aggregateSession([
      record(new Date(2026, 8, 28, 12, 0), { usage: usage(100, 0, 0, 0) }),
      record(new Date(2026, 8, 29, 12, 0), { usage: usage(50, 0, 0, 0) }),
      record(new Date(2026, 8, 30, 12, 0), { usage: usage(25, 0, 0, 0) })
    ]);

    expect(aggregate.daily.size).toBe(3);
    const firstDay = aggregate.daily.get(dayStartOf(new Date(2026, 8, 28, 12, 0).getTime()))!;
    expect(firstDay.input).toBe(100);
    expect(firstDay.messages).toBe(1);
    expect(aggregate.daily.get(dayStartOf(new Date(2026, 8, 30, 12, 0).getTime()))!.input).toBe(25);
  });

  it("splits records two minutes apart across midnight into different day buckets", () => {
    const before = new Date(2026, 8, 28, 23, 59);
    const after = new Date(2026, 8, 29, 0, 1);
    const aggregate = aggregateSession([
      record(before, { usage: usage(11, 0, 0, 0) }),
      record(after, { usage: usage(7, 0, 0, 0) })
    ]);

    expect(aggregate.daily.size).toBe(2);
    expect(aggregate.daily.get(dayStartOf(before.getTime()))!.input).toBe(11);
    expect(aggregate.daily.get(dayStartOf(after.getTime()))!.input).toBe(7);
  });

  it("separates buckets across a month boundary", () => {
    const aggregate = aggregateSession([
      record(new Date(2026, 8, 30, 23, 0)),
      record(new Date(2026, 9, 1, 1, 0))
    ]);

    expect(aggregate.daily.size).toBe(2);
    expect(formatDayLabel(dayStartOf(new Date(2026, 8, 30, 23, 0).getTime()))).toBe("9/30");
    expect(formatDayLabel(dayStartOf(new Date(2026, 9, 1, 1, 0).getTime()))).toBe("10/1");
  });

  it("merges associatively", () => {
    const a = aggregateSession([record(new Date(2026, 8, 24, 9, 0), { usage: usage(10, 1, 2, 3), model: "claude-sonnet-4-5" })]);
    const b = aggregateSession([
      record(new Date(2026, 8, 24, 21, 0), { kind: "user" }),
      record(new Date(2026, 8, 25, 8, 0), { usage: usage(20, 2, 4, 6), model: "claude-opus-4-1" })
    ]);
    const c = aggregateSession([record(new Date(2026, 8, 26, 15, 0), { usage: usage(30, 3, 6, 9) })]);

    expect(mergeAggregate(mergeAggregate(a, b), c)).toEqual(mergeAggregate(a, mergeAggregate(b, c)));
  });

  it("merge adds session counts, model buckets and hourly cells", () => {
    const tuesday = new Date(2026, 8, 29, 10, 0); // local 2026-09-29
    const a = aggregateSession([record(tuesday, { usage: usage(10, 0, 0, 0), model: "claude-sonnet-4-5" })]);
    const b = aggregateSessionInput({
      records: [
        record(tuesday, { usage: usage(5, 0, 0, 0), model: "claude-sonnet-4-5" }),
        record(new Date(2026, 8, 30, 11, 0), { usage: usage(1, 0, 0, 0), model: "claude-opus-4-1" })
      ],
      projectLabel: "project-b"
    });

    const merged = mergeAggregate(a, b);
    expect(merged.sessionCount).toBe(2);
    expect(merged.messages).toBe(3);
    expect(merged.models.get("claude-sonnet-4-5")).toMatchObject({ input: 15, messages: 2 });
    expect(merged.models.get("claude-opus-4-1")!.messages).toBe(1);
    expect(merged.projects.get("project-b")).toMatchObject({ input: 6, sessions: 1 });

    const weekday = tuesday.getDay();
    expect(merged.hourly[weekday][10]).toBe(2);
    expect(merged.hourly[new Date(2026, 8, 30, 11, 0).getDay()][11]).toBe(1);
  });

  it("attributes tokens per model and keeps records without a model visible", () => {
    const day = new Date(2026, 8, 28, 10, 0);
    const aggregate = aggregateSession([
      record(day, { usage: usage(100, 10, 1, 1000), model: "claude-sonnet-4-5-20250929" }),
      record(day, { usage: usage(50, 5, 0, 500) })
    ]);

    expect(aggregate.models.size).toBe(2);
    expect(aggregate.models.get("claude-sonnet-4-5-20250929")).toMatchObject({ input: 100, messages: 1 });
    expect(aggregate.models.get(UNKNOWN_MODEL_LABEL)).toMatchObject({ input: 50, messages: 1 });
  });

  it("zero-fills the daily series and orders it chronologically", () => {
    const now = new Date(2026, 8, 30, 15, 0);
    const range = aggregateRange(
      [inputOf([record(new Date(2026, 8, 28, 12, 0), { usage: usage(10, 1, 0, 0) })], "p1")],
      7,
      now.getTime()
    );

    expect(range.dailySeries).toHaveLength(7);
    expect(range.dailySeries.map((point) => point.dayStart)).toEqual(
      range.dailySeries.map((point) => point.dayStart).sort((a, b) => a - b)
    );
    expect(range.dailySeries[0].dayStart).toBe(addLocalDays(dayStartOf(now.getTime()), -6));
    // The empty day between the record and today is zero, not missing.
    expect(range.dailySeries[2].input).toBe(0);
    expect(range.dailySeries[2].messages).toBe(0);
    const filled = range.dailySeries.find(
      (point) => point.dayStart === dayStartOf(new Date(2026, 8, 28, 12, 0).getTime())
    )!;
    expect(filled.input).toBe(10);
    expect(filled.messages).toBe(1);
  });

  it("excludes sessions with no in-window records and clips those straddling the edge", () => {
    const now = new Date(2026, 8, 30, 12, 0); // window = local 2026-09-30 only
    const outside = [record(new Date(2026, 8, 29, 23, 0), { usage: usage(999, 0, 0, 0) })];
    const straddling = [
      record(new Date(2026, 8, 29, 23, 0), { usage: usage(999, 0, 0, 0) }),
      record(new Date(2026, 8, 30, 8, 0), { usage: usage(12, 0, 0, 0) })
    ];

    const range = aggregateRange(
      [inputOf(outside, "a"), inputOf(straddling, "b")],
      1,
      now.getTime()
    );

    expect(range.kpi.sessions).toBe(1);
    expect(range.kpi.messages).toBe(1);
    expect(range.totals.input).toBe(12);
    expect(range.dailySeries).toHaveLength(1);
  });

  it("truncates the top-N slices and folds the tail into 其他", () => {
    const now = new Date(2026, 8, 30, 12, 0);
    const sessions: UsageSessionInput[] = Array.from({ length: 8 }, (_, index) =>
      inputOf(
        [record(new Date(2026, 8, 30, 9, 0), { usage: usage((index + 1) * 100, 0, 0, 0) })],
        `project-${index + 1}`
      )
    );

    const range = aggregateRange(sessions, 7, now.getTime());

    expect(range.topProjects).toHaveLength(7);
    expect(range.topProjects.slice(0, 6).map((slice) => slice.value)).toEqual([800, 700, 600, 500, 400, 300]);
    expect(range.topProjects[6]).toEqual({ label: "其他", value: 300 });
  });

  it("fills the 7x24 heatmap at each message's weekday x hour coordinate", () => {
    const thursdayMorning = new Date(2026, 9, 1, 14, 30);
    const saturday = new Date(2026, 9, 3, 9, 0);
    const aggregate = aggregateSession([
      record(thursdayMorning, { kind: "user" }),
      record(new Date(2026, 9, 1, 14, 45)),
      record(saturday, { kind: "user" })
    ]);

    expect(aggregate.hourly[thursdayMorning.getDay()][14]).toBe(2);
    expect(aggregate.hourly[saturday.getDay()][9]).toBe(1);
    expect(aggregate.messages).toBe(3);
  });

  it("summarises sessions, messages and the four-counter token sum in the KPI", () => {
    const now = new Date(2026, 8, 30, 12, 0);
    const range = aggregateRange(
      [
        inputOf([record(new Date(2026, 8, 30, 9, 0), { usage: usage(1000, 100, 10, 10000), model: "claude-sonnet-4-5" })], "p1"),
        inputOf(
          [
            record(new Date(2026, 8, 30, 10, 0), { kind: "user" }),
            record(new Date(2026, 8, 30, 10, 5), { usage: usage(500, 50, 5, 5000), model: "claude-haiku-4-5" })
          ],
          "p2"
        )
      ],
      7,
      now.getTime()
    );

    expect(range.kpi).toEqual({ sessions: 2, messages: 3, tokens: 16665 });
  });

  it("aggregates the cross-day fixture into three local day buckets with intact totals", () => {
    // Fixture timestamps sit at 10:00Z so every record lands on the same local
    // calendar day for any UTC offset between -10 and +13.
    const session = parseJsonlText(daysFixture, "/tmp/usage-dashboard-days.jsonl");
    const aggregate = aggregateSession(session.records);

    expect(aggregate.daily.size).toBe(3);
    expect(aggregate.messages).toBe(10);
    expect(aggregate.totals).toEqual({ input: 4300, output: 1130, cacheCreation: 12500, cacheRead: 160000 });
    expect(aggregate.models.get("claude-sonnet-4-5-20250929")!.messages).toBe(4);
    expect(aggregate.models.get("claude-opus-4-1-20250805")!.messages).toBe(1);
  });

  it("aggregates the mixed-model fixture into per-model buckets", () => {
    const session = parseJsonlText(modelsFixture, "/tmp/usage-dashboard-models.jsonl");
    const aggregate = aggregateSession(session.records);

    expect(aggregate.models.size).toBe(3);
    expect(aggregate.totals).toEqual({ input: 3500, output: 700, cacheCreation: 4000, cacheRead: 60000 });
    expect(aggregate.models.get("claude-sonnet-4-5-20250929")).toMatchObject({ input: 1000, output: 200 });
    expect(aggregate.models.get("claude-opus-4-1-20250805")).toMatchObject({ input: 500, output: 100 });
    expect(aggregate.models.get("claude-haiku-4-5-20251001")).toMatchObject({ input: 2000, output: 400, cacheCreation: 0 });
  });
});
