import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { buildHallOfFame } from "./hallOfFame";
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

function pricedRecord(id: string, timestamp: number, inputTokens: number): SessionRecord {
  return record({
    id,
    timestamp,
    model: "claude-sonnet-4-5-20250929",
    usage: { inputTokens }
  });
}

function session(
  records: SessionRecord[],
  overrides: Partial<UsageSessionInput> = {}
): UsageSessionInput {
  return { projectLabel: "-repo-alpha", records, ...overrides };
}

describe("buildHallOfFame", () => {
  it("returns nothing when no call carries a price", () => {
    const hall = buildHallOfFame([], 7, T0);
    expect(hall.entries).toEqual([]);
    expect(hall.podium).toEqual([]);
    expect(hall.runnersUp).toEqual([]);
    expect(hall.hasPodium).toBe(false);
    expect(hall.pricedCalls).toBe(0);
    expect(hall.unpricedCalls).toBe(0);
    expect(hall.hiddenCalls).toBe(0);
  });

  it("ranks the ten most expensive calls across sessions, highest first", () => {
    const inputs = Array.from({ length: 12 }, (_, index) =>
      session([pricedRecord(`r${index}`, T0 - index * HOUR, (12 - index) * 1_000_000)], {
        session: meta(`/tmp/s${index}.jsonl`, `会话 ${index}`)
      })
    );

    const hall = buildHallOfFame(inputs, 7, T0);
    expect(hall.entries).toHaveLength(10);
    expect(hall.entries.map((entry) => entry.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(hall.entries[0]).toMatchObject({
      rank: 1,
      title: "会话 0",
      modelLabel: "Sonnet 4.5",
      session: expect.objectContaining({ path: "/tmp/s0.jsonl" })
    });
    expect(hall.entries[0].usd).toBeGreaterThan(hall.entries[1].usd);
    expect(hall.entries[9].usd).toBeCloseTo(9, 8);
    expect(hall.podium).toHaveLength(3);
    expect(hall.runnersUp).toHaveLength(7);
    expect(hall.pricedCalls).toBe(12);
    expect(hall.hiddenCalls).toBe(2);
    expect(hall.hasPodium).toBe(true);
  });

  it("breaks equal costs by timestamp, earliest first", () => {
    const hall = buildHallOfFame(
      [
        session([pricedRecord("later", T0 - HOUR, 2_000_000)], {
          session: meta("/tmp/later.jsonl", "晚")
        }),
        session([pricedRecord("earlier", T0 - 3 * HOUR, 2_000_000)], {
          session: meta("/tmp/earlier.jsonl", "早")
        })
      ],
      7,
      T0
    );

    expect(hall.entries.map((entry) => entry.title)).toEqual(["早", "晚"]);
  });

  it("keeps unpriced calls out of the ranking and reports their count", () => {
    const hall = buildHallOfFame(
      [
        session([
          pricedRecord("priced", T0 - HOUR, 1_000_000),
          record({
            id: "unknown",
            timestamp: T0 - 2 * HOUR,
            model: "vendor-model",
            usage: { inputTokens: 99_000_000 }
          })
        ])
      ],
      7,
      T0
    );

    expect(hall.entries).toHaveLength(1);
    expect(hall.entries[0].id).toBe("0:0");
    expect(hall.unpricedCalls).toBe(1);
    expect(hall.pricedCalls).toBe(1);
  });

  it("does not build a podium with fewer than three calls", () => {
    const hall = buildHallOfFame(
      [
        session([
          pricedRecord("a", T0 - HOUR, 2_000_000),
          pricedRecord("b", T0 - 2 * HOUR, 1_000_000)
        ])
      ],
      7,
      T0
    );

    expect(hall.entries).toHaveLength(2);
    expect(hall.podium).toEqual([]);
    expect(hall.runnersUp).toHaveLength(2);
    expect(hall.hasPodium).toBe(false);
  });

  it("honours a shorter list limit without changing the ranking", () => {
    const inputs = Array.from({ length: 12 }, (_, index) =>
      session([pricedRecord(`r${index}`, T0 - index * HOUR, (12 - index) * 1_000_000)])
    );

    const hall = buildHallOfFame(inputs, 7, T0, { limit: 7 });
    expect(hall.entries).toHaveLength(7);
    expect(hall.runnersUp).toHaveLength(4);
    expect(hall.hiddenCalls).toBe(5);
    expect(hall.entries.at(-1)?.rank).toBe(7);
  });

  it("uses the project name as the title when no session metadata exists", () => {
    const hall = buildHallOfFame(
      [
        {
          projectLabel: "-repo-alpha",
          projectPath: "/Users/tester/work/alpha",
          records: [pricedRecord("a", T0 - HOUR, 1_000_000)]
        }
      ],
      7,
      T0
    );

    expect(hall.entries[0]).toMatchObject({
      title: "alpha",
      projectName: "alpha",
      session: undefined
    });
  });

  it("filters records at both window edges", () => {
    const hall = buildHallOfFame(
      [
        session([
          pricedRecord("old", new Date(2026, 8, 22, 12, 0, 0).getTime(), 9_000_000),
          pricedRecord("edge", new Date(2026, 9, 23, 0, 0, 0).getTime(), 1_000_000),
          pricedRecord("future", new Date(2026, 9, 30, 0, 0, 0).getTime(), 5_000_000)
        ])
      ],
      7,
      T0
    );

    expect(hall.entries).toHaveLength(1);
    expect(hall.entries[0].usd).toBeCloseTo(3, 8);
  });

  it("treats a priced call with zero tokens as $0.00, not as unpriced", () => {
    const hall = buildHallOfFame(
      [session([record({ model: "claude-sonnet-4-5-20250929", usage: {} })])],
      7,
      T0
    );

    expect(hall.entries).toHaveLength(1);
    expect(hall.entries[0].usd).toBe(0);
    expect(hall.unpricedCalls).toBe(0);
  });
});
