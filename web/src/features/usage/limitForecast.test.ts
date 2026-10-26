import { describe, expect, it } from "vitest";
import type { BillingBlock } from "./billingWindow";
import { buildLimitForecast, isHotBurn } from "./limitForecast";

const HOUR = 3_600_000;
/** 2026-10-02 09:00 本地——一个窗口从此刻开，14:00 关。 */
const T0 = new Date(2026, 9, 2, 9, 0, 0).getTime();
/** 自设的 5 小时限额：一段好算的整数（pro 预设 19k 的 4 倍）。 */
const LIMIT = 76_000;

function blockOf(tokens: number, start = T0): BillingBlock {
  return {
    start,
    end: start + 5 * HOUR,
    totals: { input: tokens, output: 0, cacheCreation: 0, cacheRead: 0 },
    messages: 1
  };
}

describe("limitForecast · 诚实性（没有分母就不预报）", () => {
  it("returns nothing when the user has not set a limit", () => {
    expect(buildLimitForecast(blockOf(38_000), null, T0 + 2 * HOUR)).toBeNull();
    // 0 / NaN / 负数同样不是分母——不能拿它除出一个 Infinity%。
    expect(buildLimitForecast(blockOf(38_000), 0, T0 + 2 * HOUR)).toBeNull();
    expect(buildLimitForecast(blockOf(38_000), Number.NaN, T0 + 2 * HOUR)).toBeNull();
  });

  it("refuses a degenerate window instead of dividing by its zero length", () => {
    const empty: BillingBlock = { start: T0, end: T0, totals: blockOf(1).totals, messages: 0 };
    expect(buildLimitForecast(empty, LIMIT, T0)).toBeNull();
  });
});

describe("limitForecast · 线性外推", () => {
  it("projects the whole window at the current rate and names the hit moment", () => {
    // 2 小时 38k → 19k/时；剩 3 小时再烧 57k → 95k，对 76k 是 125%。
    const forecast = buildLimitForecast(blockOf(38_000), LIMIT, T0 + 2 * HOUR)!;
    expect(forecast.burnPerHour).toBeCloseTo(19_000, 9);
    expect(forecast.projectedPct).toBeCloseTo(125, 9);
    // 还差 38k，按 19k/时正好 2 小时后 → 13:00，窗口 14:00 才关。
    expect(forecast.hitTime).toBe(T0 + 4 * HOUR);
  });

  it("withholds a hit time that lands after the window closes", () => {
    // 2 小时 10k → 5k/时；还差 66k 要 13.2 小时，窗口只剩 3 小时。
    const forecast = buildLimitForecast(blockOf(10_000), LIMIT, T0 + 2 * HOUR)!;
    expect(forecast.projectedPct).toBeCloseTo((25_000 / LIMIT) * 100, 9);
    expect(forecast.hitTime).toBeNull();
  });

  it("stops predicting growth when a mostly-over window still reads zero", () => {
    // 5 小时窗口过了 4 小时（80%）仍是 0：报 0%，不把「样本不足」编成一条斜线。
    const forecast = buildLimitForecast(blockOf(0), LIMIT, T0 + 4 * HOUR)!;
    expect(forecast.burnPerHour).toBe(0);
    expect(forecast.projectedPct).toBe(0);
    expect(forecast.hitTime).toBeNull();
  });

  it("reports the current reading instead of a made-up rate at window start", () => {
    // elapsed = 0：速率无定义，但百分比照报（此刻已用就这些）。
    const forecast = buildLimitForecast(blockOf(1_900), LIMIT, T0)!;
    expect(forecast.burnPerHour).toBe(0);
    expect(forecast.projectedPct).toBeCloseTo((1_900 / LIMIT) * 100, 9);
    expect(forecast.hitTime).toBeNull();
  });

  it("says the limit is hit now when the window is already over it", () => {
    const now = T0 + 2 * HOUR;
    const forecast = buildLimitForecast(blockOf(100_000), LIMIT, now)!;
    // 已经超了：触顶时刻是「现在」，不是未来某一刻；百分比继续报真实的 328.9%。
    expect(forecast.hitTime).toBe(now);
    expect(forecast.projectedPct).toBeCloseTo((100_000 + 50_000 * 3) / LIMIT * 100, 9);
  });
});

describe("limitForecast · 预警色阈值", () => {
  it("flags only a burn that would eat the whole limit within the hour", () => {
    // 2 小时 76k → 38k/时，不到满额 76k/时。
    expect(isHotBurn(buildLimitForecast(blockOf(76_000), LIMIT, T0 + 2 * HOUR)!, LIMIT)).toBe(false);
    // 2 小时 153k → 76.5k/时 ≥ 76k/时。
    expect(isHotBurn(buildLimitForecast(blockOf(153_000), LIMIT, T0 + 2 * HOUR)!, LIMIT)).toBe(true);
    // 没有限额就没有阈值。
    expect(isHotBurn({ projectedPct: 0, hitTime: null, burnPerHour: 999 }, 0)).toBe(false);
  });
});
