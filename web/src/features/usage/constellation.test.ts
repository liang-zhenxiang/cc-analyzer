import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { buildConstellation, CONSTELLATION_MAX_LINKS, labWindow } from "./constellation";
import type { UsageSessionInput } from "./usageAggregations";

/** 本地周四中午：7 天窗口 = 10/23 00:00 → 10/30 00:00。 */
const T0 = new Date(2026, 9, 29, 12, 0, 0).getTime();
const HOUR = 3_600_000;

function record(partial: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: "r",
    fullId: "r",
    kind: "assistant",
    timestamp: T0,
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...partial
  };
}

function meta(path: string, customTitle?: string): SessionMeta {
  return {
    path,
    mtimeMs: T0,
    sizeBytes: 1,
    projectLabel: "-repo-alpha",
    hasRecords: true,
    ...(customTitle ? { customTitle } : {})
  };
}

function session(
  records: SessionRecord[],
  overrides: Partial<UsageSessionInput> = {}
): UsageSessionInput {
  return { projectLabel: "-repo-alpha", records, ...overrides };
}

describe("labWindow", () => {
  it("starts at the first local midnight and ends at tomorrow's", () => {
    const window = labWindow(7, T0);
    expect(new Date(window.startTs).getDate()).toBe(23);
    expect(new Date(window.startTs).getHours()).toBe(0);
    expect(new Date(window.endTs).getDate()).toBe(30);
    expect(window.windowDays).toBe(7);
    expect(labWindow(0, T0).windowDays).toBe(1);
    expect(labWindow(Number.NaN, T0).windowDays).toBe(1);
  });
});

describe("buildConstellation", () => {
  it("returns no lanes or stars for an empty window", () => {
    const constellation = buildConstellation([], 7, T0);
    expect(constellation.sessions).toEqual([]);
    expect(constellation.lanes).toEqual([]);
    expect(constellation.links).toEqual([]);
    expect(constellation.projectCount).toBe(0);
    expect(constellation.ticks).toHaveLength(7);
    expect(constellation.summary).toContain("0 个会话、0 个项目");
    expect(constellation.windowLabel).toBe("近 7 天");
  });

  it("starts a session at its first in-window record and sums the four counters", () => {
    const start = T0 - 2 * HOUR;
    const constellation = buildConstellation(
      [
        session(
          [
            record({ id: "a1", kind: "user", timestamp: start }),
            record({
              id: "a2",
              timestamp: start + 60_000,
              model: "claude-sonnet-4-5-20250929",
              usage: { inputTokens: 60, outputTokens: 20, cacheCreationTokens: 10, cacheReadTokens: 10 }
            })
          ],
          {
            projectPath: "/Users/tester/work/alpha",
            session: meta("/tmp/alpha.jsonl", "Alpha 会话")
          }
        )
      ],
      7,
      T0
    );

    expect(constellation.sessions).toHaveLength(1);
    expect(constellation.sessions[0]).toMatchObject({
      title: "Alpha 会话",
      projectName: "alpha",
      start,
      tokens: 100,
      model: "claude-sonnet-4-5-20250929",
      modelLabel: "Sonnet 4.5",
      tone: 1,
      lane: 0,
      hollow: false
    });
    expect(constellation.maxTokens).toBe(100);
    expect(constellation.sessions[0].r).toBeCloseTo(9.2, 5);
    expect(constellation.models).toEqual([
      { model: "claude-sonnet-4-5-20250929", label: "Sonnet 4.5", tone: 1 }
    ]);
    expect(constellation.summary).toContain("最大的一颗是 alpha 的 Alpha 会话（100 token）");
  });

  it("draws a zero-usage session as a hollow minimum-size ring", () => {
    const constellation = buildConstellation(
      [session([record({ id: "idle", kind: "user", timestamp: T0 - HOUR })])],
      7,
      T0
    );

    expect(constellation.sessions[0]).toMatchObject({
      tokens: 0,
      model: null,
      tone: null,
      hollow: true,
      r: 2.2
    });
    expect(constellation.noUsageCount).toBe(1);
    expect(constellation.summary).toContain("这些会话没有用量读数");
  });

  it("links adjacent stars in the same lane and hour, but never across lanes", () => {
    const constellation = buildConstellation(
      [
        session([record({ id: "a", kind: "user", timestamp: T0 - 2 * HOUR + 5 * 60_000 })], {
          session: meta("/tmp/a.jsonl")
        }),
        session([record({ id: "b", kind: "user", timestamp: T0 - 2 * HOUR + 45 * 60_000 })], {
          session: meta("/tmp/b.jsonl")
        }),
        session([record({ id: "c", kind: "user", timestamp: T0 - HOUR + 5 * 60_000 })], {
          session: meta("/tmp/c.jsonl")
        }),
        // 同一小时但属于另一个项目：不连。
        session([record({ id: "d", kind: "user", timestamp: T0 - 2 * HOUR })], {
          projectLabel: "-repo-beta",
          session: meta("/tmp/d.jsonl")
        })
      ],
      7,
      T0
    );

    expect(constellation.links).toHaveLength(1);
    expect(constellation.links[0].from).toBe("path:/tmp/a.jsonl");
    expect(constellation.links[0].to).toBe("path:/tmp/b.jsonl");
    expect(constellation.hiddenLinks).toBe(0);
  });

  it("caps same-hour links at the documented maximum and reports the rest", () => {
    // 30 秒一颗，70 颗星仍落在同一个本地小时里 → 69 段相邻连线。
    const records = Array.from({ length: CONSTELLATION_MAX_LINKS + 10 }, (_, index) =>
      session([record({ id: `s${index}`, kind: "user", timestamp: T0 - 2 * HOUR + index * 30_000 })], {
        session: meta(`/tmp/s${index}.jsonl`)
      })
    );

    const constellation = buildConstellation(records, 7, T0);
    expect(constellation.links).toHaveLength(CONSTELLATION_MAX_LINKS);
    expect(constellation.hiddenLinks).toBe(9);
  });

  it("folds projects beyond the lane limit into one 其他 lane", () => {
    const inputs = Array.from({ length: 9 }, (_, index) =>
      session([record({ id: `p${index}`, kind: "user", timestamp: T0 - 3 * HOUR + index })], {
        projectLabel: `-repo-${index}`,
        session: meta(`/tmp/p${index}.jsonl`)
      })
    );

    const constellation = buildConstellation(inputs, 7, T0, { maxLanes: 8 });
    expect(constellation.projectCount).toBe(9);
    expect(constellation.lanes).toHaveLength(8);
    expect(constellation.hiddenProjects).toBe(2);
    expect(constellation.lanes.at(-1)).toMatchObject({
      label: "其他 2 个项目",
      isOther: true,
      count: 2
    });
    expect(constellation.summary).toContain("另有 2 个项目并入「其他」泳道");

    const narrow = buildConstellation(inputs, 7, T0, { maxLanes: 5 });
    expect(narrow.lanes).toHaveLength(5);
    expect(narrow.hiddenProjects).toBe(5);
  });

  it("assigns the six chart tones to the top priced models and leaves the rest neutral", () => {
    const inputs = Array.from({ length: 7 }, (_, index) =>
      session([
        record({
          id: `m${index}`,
          timestamp: T0 - 4 * HOUR + index,
          model: `claude-sonnet-4-5-2025092${index}`,
          usage: { inputTokens: (7 - index) * 100 }
        })
      ])
    );

    const constellation = buildConstellation(inputs, 7, T0);
    expect(constellation.models).toHaveLength(6);
    expect(constellation.sessions.map((item) => item.tone)).toEqual([1, 2, 3, 4, 5, 6, null]);
    expect(constellation.otherModelCount).toBe(1);
  });

  it("colours a session by its dominant model and leaves unknown models without a tone", () => {
    const constellation = buildConstellation(
      [
        session([
          record({
            id: "sonnet",
            timestamp: T0 - 3 * HOUR,
            model: "claude-sonnet-4-5-20250929",
            usage: { inputTokens: 100 }
          }),
          record({
            id: "haiku",
            timestamp: T0 - 2 * HOUR,
            model: "claude-haiku-4-5-20251001",
            usage: { inputTokens: 300 }
          })
        ]),
        session([record({ id: "other", timestamp: T0 - HOUR, model: "vendor-model", usage: { inputTokens: 50 } })])
      ],
      7,
      T0
    );

    expect(constellation.sessions[0].model).toBe("claude-haiku-4-5-20251001");
    expect(constellation.sessions[0].tone).toBe(1);
    expect(constellation.sessions[1]).toMatchObject({ model: "vendor-model", tone: null });
    expect(constellation.otherModelCount).toBe(1);
    expect(constellation.models).toHaveLength(2);
  });

  it("filters records at both window edges", () => {
    const tooOld = new Date(2026, 9, 22, 12, 0, 0).getTime();
    const nextMidnight = new Date(2026, 9, 30, 0, 0, 0).getTime();
    const constellation = buildConstellation(
      [
        session([record({ id: "old", kind: "user", timestamp: tooOld })]),
        session([record({ id: "today", kind: "user", timestamp: T0 - HOUR })], {
          session: meta("/tmp/today.jsonl")
        }),
        session([record({ id: "future", kind: "user", timestamp: nextMidnight })], {
          session: meta("/tmp/future.jsonl")
        })
      ],
      7,
      T0
    );

    expect(constellation.sessions).toHaveLength(1);
    expect(constellation.sessions[0].id).toBe("path:/tmp/today.jsonl");
  });

  it("lists the five heaviest sessions in token order", () => {
    const inputs = Array.from({ length: 6 }, (_, index) =>
      session([
        record({
          id: `h${index}`,
          timestamp: T0 - 5 * HOUR + index,
          model: "claude-sonnet-4-5-20250929",
          usage: { inputTokens: (6 - index) * 10 }
        })
      ], { session: meta(`/tmp/h${index}.jsonl`) })
    );

    const constellation = buildConstellation(inputs, 7, T0);
    expect(constellation.heaviest).toHaveLength(5);
    expect(constellation.heaviest.map((item) => item.tokens)).toEqual([60, 50, 40, 30, 20]);
  });

  it("adapts ticks to the window: daily, weekly, then monthly", () => {
    expect(buildConstellation([], 7, T0).ticks[0].label).toBe("10/23");
    const monthly = buildConstellation([], 90, T0).ticks.map((tick) => tick.label);
    expect(monthly).toEqual(["8月", "9月", "10月"]);
    const weekly = buildConstellation([], 30, T0).ticks.map((tick) => tick.label);
    expect(weekly[0]).toBe("10/5");
    expect(weekly).toHaveLength(4);
  });

  it("is deterministic for the same input", () => {
    const inputs = [
      session([record({ id: "x", kind: "user", timestamp: T0 - HOUR })], {
        session: meta("/tmp/x.jsonl")
      })
    ];
    expect(buildConstellation(inputs, 7, T0)).toEqual(buildConstellation(inputs, 7, T0));
  });
});
