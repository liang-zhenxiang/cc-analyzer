import { describe, expect, it } from "vitest";
import { compactionStats } from "./compactionStats";
import type { UsageSessionInput } from "./usageAggregations";
import type { CompactEvent, SessionRecord } from "../sessions/types";

/** Fixed "now" at local noon: day-crop edges stay deterministic in any TZ. */
const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const HOURS = 3_600_000;
const DAYS = 86_400_000;

function event(id: string, ts: number, over: Partial<CompactEvent> = {}): CompactEvent {
  return {
    id,
    timestamp: ts,
    trigger: "auto",
    preTokens: 400,
    postTokens: 100,
    droppedTokens: 300,
    durationMs: 1_000,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null,
    raw: {},
    ...over
  };
}

function sessionInput(over: Partial<UsageSessionInput> = {}): UsageSessionInput {
  const record: SessionRecord = {
    id: "r1",
    fullId: "r1",
    kind: "assistant",
    timestamp: NOW - HOURS,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {}
  };
  return { records: [record], projectLabel: "project", ...over };
}

describe("compactionStats", () => {
  it("returns an all-zero stats for a window with no compactions", () => {
    const stats = compactionStats([sessionInput()], 30, NOW);
    expect(stats).toMatchObject({ count: 0, autoCount: 0, manualCount: 0, sessions: 0, droppedTokens: 0 });
    expect(stats.topSessions).toEqual([]);
  });

  it("counts events, sessions and auto/manual within the window", () => {
    const stats = compactionStats(
      [
        sessionInput({
          projectLabel: "a",
          compactEvents: [
            event("a1", NOW - 2 * HOURS, { trigger: "auto" }),
            event("a2", NOW - 1 * HOURS, { trigger: "manual" })
          ]
        }),
        sessionInput({
          projectLabel: "b",
          compactEvents: [event("b1", NOW - 3 * HOURS, { trigger: "auto" })]
        }),
        // 窗外的事件不计入（周期裁剪与 aggregateRange 同口径）。
        sessionInput({
          projectLabel: "c",
          compactEvents: [event("c1", NOW - 40 * DAYS)]
        })
      ],
      30,
      NOW
    );

    expect(stats).toMatchObject({ count: 3, autoCount: 2, manualCount: 1, sessions: 2 });
  });

  it("sums per-event pre − post, never the cumulative counters (data constraint 4)", () => {
    // 单会话两次压缩：pre−post 分别 300 与 150 → 450。两次的
    // cumulativeDroppedTokens（300 / 450）直读相加会得到 750——那是把累计值
    // 再累计一遍。变异「改直读累计值」必须在这条上红。
    const stats = compactionStats(
      [
        sessionInput({
          projectLabel: "a",
          compactEvents: [
            event("a1", NOW - 2 * HOURS, { preTokens: 400, postTokens: 100, droppedTokens: 300 }),
            event("a2", NOW - 1 * HOURS, {
              trigger: "manual",
              preTokens: 200,
              postTokens: 50,
              droppedTokens: 450
            })
          ]
        }),
        sessionInput({
          projectLabel: "b",
          compactEvents: [
            event("b1", NOW - 3 * HOURS, { preTokens: 1_000, postTokens: 0, droppedTokens: 1_000 })
          ]
        })
      ],
      30,
      NOW
    );

    expect(stats.droppedTokens).toBe(450 + 1_000);
    expect(stats.droppedTokens).not.toBe(300 + 450 + 1_000);
  });

  it("treats events with missing pre/post as count-only, not as a guess", () => {
    const stats = compactionStats(
      [
        sessionInput({
          projectLabel: "old-log",
          compactEvents: [
            event("d1", NOW - HOURS, { preTokens: null, postTokens: null, droppedTokens: 123 })
          ]
        })
      ],
      30,
      NOW
    );

    expect(stats.count).toBe(1);
    expect(stats.droppedTokens).toBe(0);
  });

  it("ranks top sessions by dropped tokens and caps at three", () => {
    const inputs: UsageSessionInput[] = [
      sessionInput({
        projectLabel: "small",
        compactEvents: [event("s1", NOW - HOURS)]
      }),
      sessionInput({
        projectLabel: "big",
        compactEvents: [
          event("b1", NOW - 2 * HOURS, { preTokens: 5_000, postTokens: 0 }),
          event("b2", NOW - 1 * HOURS, { preTokens: 5_000, postTokens: 0 })
        ]
      }),
      sessionInput({
        projectLabel: "mid",
        compactEvents: [event("m1", NOW - 3 * HOURS, { preTokens: 1_000, postTokens: 0 })]
      }),
      sessionInput({ projectLabel: "none" }),
      sessionInput({
        projectLabel: "tail",
        compactEvents: [event("t1", NOW - 4 * HOURS, { preTokens: 10, postTokens: 0 })]
      })
    ];

    const stats = compactionStats(inputs, 30, NOW);

    expect(stats.topSessions).toHaveLength(3);
    expect(stats.topSessions.map((slice) => slice.label)).toEqual(["big", "mid", "small"]);
    expect(stats.topSessions[0]).toMatchObject({ count: 2, droppedTokens: 10_000 });
    // top 行携带 SessionMeta（回落到 projectLabel 的输入为 null）。
    expect(stats.topSessions.every((slice) => slice.session === null)).toBe(true);
  });

  it("resolves the display label through sessionTitle when the meta is present", () => {
    const meta = {
      projectLabel: "encoded-dir",
      customTitle: "排查解析层",
      hasRecords: true,
      path: "/home/u/.claude/projects/encoded-dir/s.jsonl",
      mtimeMs: 0,
      sizeBytes: 0
    };
    const stats = compactionStats(
      [sessionInput({ projectLabel: "encoded-dir", session: meta, compactEvents: [event("e", NOW - HOURS)] })],
      7,
      NOW
    );

    expect(stats.topSessions[0].label).toBe("排查解析层");
    expect(stats.topSessions[0].session).toBe(meta);
  });
});
