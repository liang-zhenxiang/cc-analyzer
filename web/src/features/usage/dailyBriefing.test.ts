import { describe, expect, it } from "vitest";
import {
  ANOMALY_Z_ALERT,
  BUDGET_ALERT_PCT,
  briefingOf,
  ERROR_ALERT_TOTAL,
  MAX_BRIEFING_ITEMS,
  QUIET_ALERT_DAYS,
  type BriefingInput
} from "./dailyBriefing";
import type { AnomalyDay } from "./anomalyDays";
import type { LimitForecast } from "./limitForecast";
import type { WeeklyDigest } from "./weeklyDigest";

const NOW = Date.UTC(2026, 10, 1, 0, 0, 0); // 2026-11-01T00:00:00Z

function emptyWeekly(): WeeklyDigest {
  return {
    thisWeek: { tokens: 0, usd: null, sessions: 0, messages: 0 },
    lastWeek: { tokens: 0, usd: null, sessions: 0, messages: 0 },
    deltas: { tokens: null, usd: null, sessions: null, messages: null }
  };
}

function baseInput(overrides: Partial<BriefingInput> = {}): BriefingInput {
  return {
    weekly: emptyWeekly(),
    anomalies: [],
    forecast: null,
    errorStats: null,
    yesterdayTokens: 0,
    prevTokens: 0,
    ...overrides
  };
}

function anomaly(date: string, z: number, tokens = 50_000): AnomalyDay {
  return { date, tokens, z, kind: z >= 0 ? "spike" : "dip" };
}

function forecast(projectedPct: number, hitTime: number | null = NOW + 3_600_000): LimitForecast {
  return { projectedPct, hitTime, burnPerHour: 12_000 };
}

function everything(): BriefingInput {
  return baseInput({
    forecast: forecast(92),
    anomalies: [anomaly("2026-10-31", 2.4)],
    errorStats: { total: 12 },
    yesterdayTokens: 1500,
    prevTokens: 1000,
    quietDays: 5
  });
}

describe("briefingOf 优先级", () => {
  it("orders budget > anomaly > errors and keeps only three", () => {
    const briefing = briefingOf(everything(), NOW);
    expect(briefing.items.map((item) => item.kind)).toEqual(["budget", "anomaly", "errors"]);
    expect(briefing.items.map((item) => item.rank)).toEqual([1, 2, 3]);
    expect(MAX_BRIEFING_ITEMS).toBe(3);
  });

  it("promotes errors over the day-over-day swing", () => {
    const briefing = briefingOf(
      baseInput({ errorStats: { total: 12 }, yesterdayTokens: 1500, prevTokens: 1000 }),
      NOW
    );
    expect(briefing.items.map((item) => item.kind)).toEqual(["errors", "spike"]);
    expect(briefing.items[1].rank).toBe(2);
  });

  it("promotes the anomaly over errors", () => {
    const briefing = briefingOf(
      baseInput({ anomalies: [anomaly("2026-10-30", 2.2)], errorStats: { total: 30 } }),
      NOW
    );
    expect(briefing.items.map((item) => item.kind)).toEqual(["anomaly", "errors"]);
  });

  it("keeps a single-item briefing without padding", () => {
    const briefing = briefingOf(baseInput({ forecast: forecast(95) }), NOW);
    expect(briefing.items).toHaveLength(1);
    expect(briefing.items[0]).toMatchObject({ kind: "budget", rank: 1, id: "budget" });
  });

  it("returns no items for an empty day", () => {
    expect(briefingOf(baseInput(), NOW).items).toEqual([]);
  });

  it("uses the injected clock for generatedAt", () => {
    expect(briefingOf(everything(), NOW).generatedAt).toBe(NOW);
  });
});

describe("briefingOf 预算", () => {
  it("fires at exactly the 85% line and not below it", () => {
    expect(BUDGET_ALERT_PCT).toBe(85);
    expect(briefingOf(baseInput({ forecast: forecast(85) }), NOW).items.map((i) => i.kind)).toEqual([
      "budget"
    ]);
    expect(briefingOf(baseInput({ forecast: forecast(84.9) }), NOW).items).toEqual([]);
  });

  it("explains hit time when the forecast reaches the limit", () => {
    const hit = NOW + 2 * 3_600_000;
    const item = briefingOf(baseInput({ forecast: forecast(120, hit) }), NOW).items[0];
    expect(item.headline).toBe("限额预计用到 120%");
    expect(item.detail).toContain("触顶");
  });
});

describe("briefingOf 异常日", () => {
  it("uses the newest qualifying day within the last seven days", () => {
    const briefing = briefingOf(
      baseInput({
        anomalies: [anomaly("2026-10-26", 2.1), anomaly("2026-10-31", 2.4, 80_000)]
      }),
      NOW
    );
    const [item] = briefing.items;
    expect(item.kind).toBe("anomaly");
    expect(item.headline).toBe("10-31 用量异常（+2.4σ）");
    expect(item.detail).toBe("当日 80,000 tok");
    expect(ANOMALY_Z_ALERT).toBe(2);
  });

  it("ignores old anomalies and spikes below the z threshold", () => {
    const briefing = briefingOf(
      baseInput({ anomalies: [anomaly("2026-10-20", 3.1), anomaly("2026-10-31", 1.9)] }),
      NOW
    );
    expect(briefing.items).toEqual([]);
  });

  it("lands on the usage target", () => {
    const item = briefingOf(baseInput({ anomalies: [anomaly("2026-10-31", 2.4)] }), NOW).items[0];
    expect(item.target).toBe("usage");
  });
});

describe("briefingOf 错误", () => {
  it("fires at ten errors and not at nine", () => {
    expect(ERROR_ALERT_TOTAL).toBe(10);
    expect(briefingOf(baseInput({ errorStats: { total: 10 } }), NOW).items[0].headline).toBe(
      "错误聚集：共 10 条"
    );
    expect(briefingOf(baseInput({ errorStats: { total: 9 } }), NOW).items).toEqual([]);
  });

  it("points at the errors panel", () => {
    expect(
      briefingOf(baseInput({ errorStats: { total: 12 } }), NOW).items[0].target
    ).toBe("errors");
  });
});

describe("briefingOf 环比", () => {
  it("flags a +50% jump and leaves 49.9% alone", () => {
    const spike = briefingOf(baseInput({ yesterdayTokens: 1500, prevTokens: 1000 }), NOW).items[0];
    expect(spike).toMatchObject({ kind: "spike", id: "spike", headline: "用量陡增：环比 +50%" });
    expect(briefingOf(baseInput({ yesterdayTokens: 1499, prevTokens: 1000 }), NOW).items).toEqual([]);
  });

  it("flags a −50% drop with the minus sign", () => {
    const drop = briefingOf(baseInput({ yesterdayTokens: 500, prevTokens: 1000 }), NOW).items[0];
    expect(drop).toMatchObject({ kind: "drop", id: "drop", headline: "用量陡降：环比 −50%" });
    expect(briefingOf(baseInput({ yesterdayTokens: 501, prevTokens: 1000 }), NOW).items).toEqual([]);
  });

  it("refuses to compute a swing without a baseline", () => {
    expect(briefingOf(baseInput({ yesterdayTokens: 900, prevTokens: 0 }), NOW).items).toEqual([]);
  });
});

describe("briefingOf 安静", () => {
  it("needs three quiet days and does not invent them", () => {
    expect(QUIET_ALERT_DAYS).toBe(3);
    expect(briefingOf(baseInput({ quietDays: 2 }), NOW).items).toEqual([]);
    expect(briefingOf(baseInput(), NOW).items).toEqual([]);
    const item = briefingOf(baseInput({ quietDays: 4 }), NOW).items[0];
    expect(item).toMatchObject({ kind: "quiet", headline: "已连续 4 天零消息", target: "milestones" });
  });
});

describe("briefingOf 文案", () => {
  it("keeps every headline within twenty characters and without exclamation marks", () => {
    const briefing = briefingOf(everything(), NOW);
    for (const item of briefing.items) {
      expect(item.headline.length).toBeLessThanOrEqual(20);
      expect(item.headline).not.toContain("!");
      expect(item.headline).not.toContain("！");
    }
  });

  it("gives each kind a stable, unique id", () => {
    const briefing = briefingOf(everything(), NOW);
    expect(new Set(briefing.items.map((item) => item.id)).size).toBe(briefing.items.length);
  });
});
