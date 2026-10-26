import { describe, expect, it } from "vitest";
import {
  CRUISING_BURN_SHARE_PER_HOUR,
  GAUGE_MAX_PCT,
  GAUGE_TICKS,
  HOT_BAND_SHARE_PER_HOUR,
  QUIET_BURN_SHARE_PER_HOUR,
  gaugeBand,
  gaugeNeedleAngle
} from "./burnGauge";

/**
 * 档位边界全部用「阈值常量 × 限额」构造，不写死 0.1×100=10 这类换算——
 * 常量改了边界用例跟着走，断言永远卡在定义上而不是数字巧合上。
 */

const PLAN_LIMIT = 1000;

describe("gaugeBand · 四档边界", () => {
  it("quiet: burn 低于 10% 限额/h（9.9% 边界内侧）", () => {
    expect(gaugeBand((PLAN_LIMIT * 9.9) / 100, PLAN_LIMIT)).toBe("quiet");
  });

  it("cruising: 恰好 10% 进 cruising，39.9% 仍在 cruising", () => {
    expect(gaugeBand((PLAN_LIMIT * 10) / 100, PLAN_LIMIT)).toBe("cruising");
    expect(gaugeBand((PLAN_LIMIT * 39.9) / 100, PLAN_LIMIT)).toBe("cruising");
  });

  it("warm: 恰好 40% 进 warm，99.9% 仍在 warm", () => {
    expect(gaugeBand((PLAN_LIMIT * 40) / 100, PLAN_LIMIT)).toBe("warm");
    expect(gaugeBand((PLAN_LIMIT * 99.9) / 100, PLAN_LIMIT)).toBe("warm");
  });

  it("hot: 恰好 100% 进 hot（与 isHotBurn 的 >= 同向）", () => {
    expect(gaugeBand((PLAN_LIMIT * 100) / 100, PLAN_LIMIT)).toBe("hot");
    expect(gaugeBand((PLAN_LIMIT * 250) / 100, PLAN_LIMIT)).toBe("hot");
  });

  it("零/负速率与 NaN 都落在 quiet——没有燃烧就没有档位", () => {
    expect(gaugeBand(0, PLAN_LIMIT)).toBe("quiet");
    expect(gaugeBand(-5, PLAN_LIMIT)).toBe("quiet");
    expect(gaugeBand(Number.NaN, PLAN_LIMIT)).toBe("quiet");
    expect(gaugeBand(Number.POSITIVE_INFINITY, PLAN_LIMIT)).toBe("hot");
  });
});

describe("gaugeBand · 无分母不判热度", () => {
  it("planLimitTokens ≤ 0 时任何速率（含 Infinity）都返回 quiet", () => {
    expect(gaugeBand(10_000, 0)).toBe("quiet");
    expect(gaugeBand(10_000, -1)).toBe("quiet");
    expect(gaugeBand(Number.POSITIVE_INFINITY, 0)).toBe("quiet");
  });

  it("planLimitTokens 为 NaN 也返回 quiet，不产生 NaN 比较", () => {
    expect(gaugeBand(500, Number.NaN)).toBe("quiet");
  });
});

describe("gaugeBand · 阈值常量与 isHotBurn 同源", () => {
  it("quiet/cruising/hot 三条阈值是 10% / 40% / 100%", () => {
    expect(QUIET_BURN_SHARE_PER_HOUR).toBe(0.1);
    expect(CRUISING_BURN_SHARE_PER_HOUR).toBe(0.4);
    expect(HOT_BAND_SHARE_PER_HOUR).toBe(1);
  });
});

describe("gaugeNeedleAngle · [0,100] 线性映射 + 端点封顶", () => {
  it("0% → -90°（左端），50% → 0°（正上），100% → +90°（右端）", () => {
    expect(gaugeNeedleAngle(0)).toBeCloseTo(-90, 10);
    expect(gaugeNeedleAngle(50)).toBeCloseTo(0, 10);
    expect(gaugeNeedleAngle(100)).toBeCloseTo(90, 10);
  });

  it("100% 以上封顶 +90°：200 / 250 / Infinity 都停在右端", () => {
    expect(gaugeNeedleAngle(200)).toBeCloseTo(90, 10);
    expect(gaugeNeedleAngle(250)).toBeCloseTo(90, 10);
    expect(gaugeNeedleAngle(Number.POSITIVE_INFINITY)).toBeCloseTo(90, 10);
  });

  it("负数按 0 处理：-5 → -90°；NaN 也停在左端", () => {
    expect(gaugeNeedleAngle(-5)).toBeCloseTo(-90, 10);
    expect(gaugeNeedleAngle(Number.NaN)).toBeCloseTo(-90, 10);
  });

  it("线性中点：25% → -45°，75% → +45°", () => {
    expect(gaugeNeedleAngle(25)).toBeCloseTo(-45, 10);
    expect(gaugeNeedleAngle(75)).toBeCloseTo(45, 10);
  });
});

describe("GAUGE_TICKS · 由 gaugeNeedleAngle 派生", () => {
  it("9 根刻度覆盖 0–200%，全部 major", () => {
    expect(GAUGE_TICKS).toHaveLength(GAUGE_MAX_PCT / 25 + 1);
    expect(GAUGE_TICKS.map((tick) => tick.pct)).toEqual([
      0, 25, 50, 75, 100, 125, 150, 175, 200
    ]);
    expect(GAUGE_TICKS.every((tick) => tick.major)).toBe(true);
  });

  it("每根刻度的角度就是 gaugeNeedleAngle(pct)，没有第二套角度表", () => {
    for (const tick of GAUGE_TICKS) {
      expect(tick.angle).toBeCloseTo(gaugeNeedleAngle(tick.pct), 10);
    }
  });

  it("角度在 0–100% 段严格单调递增，100% 以上保持 +90° 封顶", () => {
    for (let index = 1; index <= 4; index += 1) {
      expect(GAUGE_TICKS[index].angle).toBeGreaterThan(GAUGE_TICKS[index - 1].angle);
    }
    for (let index = 5; index < GAUGE_TICKS.length; index += 1) {
      expect(GAUGE_TICKS[index].angle).toBeCloseTo(90, 10);
    }
  });
});
