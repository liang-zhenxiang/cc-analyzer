import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { clusterBillingBlocks, currentBlock, type BillingBlock } from "./billingWindow";
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

  it("returns nothing for a closed window: there is no future left to project", () => {
    // 窗口 T0..T0+5h；`end` 为开区间，恰好到 end 就已经关闭。
    expect(buildLimitForecast(blockOf(38_000), LIMIT, T0 + 5 * HOUR)).toBeNull();
    expect(buildLimitForecast(blockOf(38_000), LIMIT, T0 + 6 * HOUR)).toBeNull();
    // 关闭前一毫秒仍是开放窗口——守卫不能提前一格。
    expect(buildLimitForecast(blockOf(38_000), LIMIT, T0 + 5 * HOUR - 1)).not.toBeNull();
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

/**
 * Issue #345：round-cc e2e 的夹具把「本周」记录钉在周一 `00:30`，把「最近
 * 两小时」放在 `now - 2h`。周一 02:30–07:30 运行时，`now - 2h` 会并进
 * `[00:30, 05:30)` 那一块（不新开块），到 now 时窗口已经关闭——e2e 因此
 * 必须自适应「块开着 / 块关着」两条分支。这里用**固定的 UTC 时刻**复现同一段
 * 几何，把两条分支的核心结论钉死，run 在哪个时区、哪一天都一样。
 */
describe("limitForecast · 周一凌晨的块几何（Issue #345）", () => {
  // 2026-11-16 是周一：夹具的「本周」块从 00:30 UTC 开始，05:30 关闭。
  const MONDAY_0030 = Date.UTC(2026, 10, 16, 0, 30);
  /** max5 预设的窗口限额，与 e2e 里选中的计划一致。 */
  const PLAN_LIMIT = 88_000;
  const WEEKLY_TOKENS = 18_000;
  const RECENT_TOKENS = 40_000;

  function recordAt(timestamp: number, tokens: number): SessionRecord {
    return {
      id: `r-${timestamp}`,
      fullId: `r-${timestamp}`,
      kind: "assistant",
      timestamp,
      durationMs: 0,
      text: "",
      isError: false,
      usage: {
        inputTokens: tokens,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0
      },
      raw: {}
    };
  }

  it("now-2h 并进本周块且块还开着：按合并后的块外推百分比", () => {
    // now = 04:00 UTC → now-2h = 02:00，落在 [00:30, 05:30) 内：不新开块。
    const now = MONDAY_0030 + 3.5 * HOUR;
    const blocks = clusterBillingBlocks([
      recordAt(MONDAY_0030, WEEKLY_TOKENS),
      recordAt(now - 2 * HOUR, RECENT_TOKENS)
    ]);
    expect(blocks).toHaveLength(1);
    const active = currentBlock(blocks, now)!;
    expect(active.start).toBe(MONDAY_0030);
    expect(active.end).toBe(MONDAY_0030 + 5 * HOUR);

    // 合并后 58k、已过 3.5h → 16,571.43/h；剩 1.5h 再烧 24,857.14
    // → 82,857.14，对 88k 是 94.16%。
    const forecast = buildLimitForecast(active, PLAN_LIMIT, now)!;
    const expectedPct =
      (((WEEKLY_TOKENS + RECENT_TOKENS) * (1 + 1.5 / 3.5)) / PLAN_LIMIT) * 100;
    expect(forecast.projectedPct).toBeCloseTo(expectedPct, 9);
    expect(forecast.projectedPct).toBeCloseTo(94.1558, 3);
  });

  it("同一段几何在块关闭后：预报为 null（e2e 的 closed 分支）", () => {
    // now = 06:30 UTC → now-2h = 04:30，仍落在 [00:30, 05:30) 内；
    // 块在 05:30 已关闭，`currentBlock` 仍返回它（用量是事实），但不再外推。
    const now = MONDAY_0030 + 6 * HOUR;
    const blocks = clusterBillingBlocks([
      recordAt(MONDAY_0030, WEEKLY_TOKENS),
      recordAt(now - 2 * HOUR, RECENT_TOKENS)
    ]);
    expect(blocks).toHaveLength(1);
    const active = currentBlock(blocks, now)!;
    expect(now).toBeGreaterThanOrEqual(active.end);
    expect(buildLimitForecast(active, PLAN_LIMIT, now)).toBeNull();
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
