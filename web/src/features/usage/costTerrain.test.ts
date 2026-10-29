import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { buildCostTerrain } from "./costTerrain";
import type { UsageSessionInput } from "./usageAggregations";

/** 本地周四中午：7 天窗口 = 10/23 00:00 → 10/30 00:00。 */
const T0 = new Date(2026, 9, 29, 12, 0, 0).getTime();

function at(month: number, day: number, hour: number, minute = 0): number {
  return new Date(2026, month, day, hour, minute, 0).getTime();
}

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

function session(records: SessionRecord[]): UsageSessionInput {
  return { projectLabel: "-repo-alpha", records };
}

/** 1M input token on sonnet = $3.00 — 便于断言精确金额。 */
function priced(partial: Partial<SessionRecord> = {}): SessionRecord {
  return record({
    model: "claude-sonnet-4-5-20250929",
    usage: { inputTokens: 1_000_000 },
    ...partial
  });
}

describe("buildCostTerrain", () => {
  it("returns an empty 7 × 24 grid when nothing is priced", () => {
    const terrain = buildCostTerrain([], 7, T0);
    expect(terrain.cells).toHaveLength(168);
    expect(terrain.rows).toHaveLength(7);
    expect(terrain.rows[0]).toHaveLength(24);
    expect(terrain.totalUsd).toBe(0);
    expect(terrain.peak).toBeNull();
    expect(terrain.pricedCells).toBe(0);
    expect(terrain.contours).toEqual([]);
    expect(terrain.hourTicks.map((tick) => tick.hour)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(terrain.summary).toContain("没有可估算的成本");
  });

  it("buckets a priced record by local weekday and hour", () => {
    // 10/26 是周一（Monday-first 行 0），14 时。
    const terrain = buildCostTerrain([session([priced({ timestamp: at(9, 26, 14) })])], 7, T0);
    const cell = terrain.rows[0][14];

    expect(cell.costUsd).toBeCloseTo(3, 8);
    expect(cell.level).toBe(1);
    expect(cell.share).toBeCloseTo(1, 8);
    expect(cell.hasUnknown).toBe(false);
    expect(terrain.totalUsd).toBeCloseTo(3, 8);
    expect(terrain.peak).toBe(cell);
    expect(terrain.summary).toContain("周一 14 时");
    expect(terrain.summary).toContain("$3.00");
    expect(terrain.summary).toContain("没有未定价模型的小时");
  });

  it("leaves unpriced hours out of the cost map and counts them", () => {
    const terrain = buildCostTerrain(
      [
        session([
          priced({ id: "priced", timestamp: at(9, 26, 9) }),
          record({
            id: "unknown",
            timestamp: at(9, 26, 10),
            model: "vendor-model",
            usage: { inputTokens: 10_000_000 }
          })
        ])
      ],
      7,
      T0
    );

    expect(terrain.rows[0][9].costUsd).toBeCloseTo(3, 8);
    expect(terrain.rows[0][10].costUsd).toBe(0);
    expect(terrain.rows[0][10].hasUnknown).toBe(true);
    expect(terrain.unknownCells).toBe(1);
    expect(terrain.pricedCells).toBe(1);
    expect(terrain.totalUsd).toBeCloseTo(3, 8);
    expect(terrain.summary).toContain("1 个小时因未定价模型未计入");
  });

  it("maps four positive costs onto the four calendar tones by quartile", () => {
    const terrain = buildCostTerrain(
      [
        session([
          priced({ id: "a", timestamp: at(9, 26, 9), usage: { inputTokens: 1_000_000 } }),
          priced({ id: "b", timestamp: at(9, 26, 10), usage: { inputTokens: 2_000_000 } }),
          priced({ id: "c", timestamp: at(9, 26, 11), usage: { inputTokens: 3_000_000 } }),
          priced({ id: "d", timestamp: at(9, 26, 12), usage: { inputTokens: 4_000_000 } })
        ])
      ],
      7,
      T0
    );

    expect([9, 10, 11, 12].map((hour) => terrain.rows[0][hour].level)).toEqual([1, 2, 3, 4]);
    expect(terrain.quartiles?.q2).toBeCloseTo(7.5, 8);
  });

  it("draws one boundary segment per threshold between two adjacent levels", () => {
    const terrain = buildCostTerrain(
      [
        session([
          priced({ id: "low", timestamp: at(9, 26, 14), usage: { inputTokens: 1_000_000 } }),
          priced({ id: "high", timestamp: at(9, 26, 15), usage: { inputTokens: 4_000_000 } })
        ])
      ],
      7,
      T0
    );

    expect(terrain.contours).toHaveLength(3);
    expect(terrain.contours.map((contour) => contour.key)).toEqual(["p50", "p80", "p95"]);
    for (const contour of terrain.contours) {
      // 低格与高格之间的共享边界，外加高格自身朝空格的三条岛岸。
      const shared = contour.segments.find(
        (segment) => segment.id === `${contour.key}:h:0-14`
      );
      expect(shared).toBeDefined();
      // 横邻格之间的边界是竖线，每段只有 8px——不跨格、不做插值。
      expect(shared?.x1).toBe(shared?.x2);
      for (const segment of contour.segments) {
        const length = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
        expect(length).toBeCloseTo(8, 8);
      }
      expect(contour.label).not.toBeNull();
    }
  });

  it("returns an unused contour value only once when every cell shares a cost", () => {
    const terrain = buildCostTerrain(
      [session([priced({ timestamp: at(9, 26, 14) })])],
      7,
      T0
    );
    expect(terrain.contours).toHaveLength(1);
    expect(terrain.contours[0].segments.length).toBeGreaterThan(0);
  });

  it("accepts a coarser hour tick step for large type", () => {
    const terrain = buildCostTerrain([], 7, T0, { hourTickStep: 6 });
    expect(terrain.hourTicks.map((tick) => tick.hour)).toEqual([0, 6, 12, 18]);
  });

  it("filters records at both window edges", () => {
    const terrain = buildCostTerrain(
      [
        session([
          priced({ id: "old", timestamp: new Date(2026, 8, 22, 12, 0, 0).getTime() }),
          priced({ id: "edge", timestamp: new Date(2026, 9, 23, 0, 0, 0).getTime() }),
          priced({ id: "future", timestamp: new Date(2026, 9, 30, 0, 0, 0).getTime() })
        ])
      ],
      7,
      T0
    );

    // 10/23 是周五（Monday-first 行 4），0 时。
    expect(terrain.rows[4][0].costUsd).toBeCloseTo(3, 8);
    expect(terrain.totalUsd).toBeCloseTo(3, 8);
  });

  it("accumulates several records that land in the same hour cell", () => {
    const terrain = buildCostTerrain(
      [
        session([
          priced({ id: "a", timestamp: at(9, 26, 14, 5) }),
          priced({ id: "b", timestamp: at(9, 26, 14, 45) })
        ])
      ],
      7,
      T0
    );
    expect(terrain.rows[0][14].costUsd).toBeCloseTo(6, 8);
    expect(terrain.pricedCells).toBe(1);
  });
});
