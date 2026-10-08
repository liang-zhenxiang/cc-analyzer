import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import { totalsSum } from "./usageAggregations";
import {
  MIN_ACTIVE_DAYS,
  WEEKLY_WINDOW_MS,
  predictWeeklyLimitReach,
  weeklyWindow,
  type WeeklyWindow
} from "./weeklyWindow";

const NOW = new Date(2026, 9, 8, 12, 0, 0).getTime();
const DAY = 86_400_000;

function record(at: number, input = 1_000): SessionRecord {
  return {
    id: `r-${at}`,
    kind: "assistant",
    timestamp: at,
    usage: { inputTokens: input, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  } as unknown as SessionRecord;
}

describe("weeklyWindow（滚动 7 天求和）", () => {
  it("左开右闭：恰好 7 天前一刻属上一周期，7 天前 +1ms 才计入本窗口", () => {
    const edge = NOW - WEEKLY_WINDOW_MS;
    const window = weeklyWindow(
      [record(edge), record(edge + 1), record(NOW), record(NOW + 1)],
      null,
      NOW
    );
    // edge 落在上一周期的右闭端；NOW+1（未来的记录，时钟偏移防线）不属于任何窗口。
    expect(totalsSum(window.consumed)).toBe(2_000);
    expect(totalsSum(window.previousConsumed)).toBe(1_000);
  });

  it("只有带 usage 的记录计入——user 行、缺 usage 的行都不动求和", () => {
    const noUsage = { ...record(NOW), usage: undefined } as unknown as SessionRecord;
    const userRow = { ...record(NOW), kind: "user", usage: undefined } as unknown as SessionRecord;
    const window = weeklyWindow([noUsage, userRow, record(NOW - DAY)], null, NOW);
    expect(totalsSum(window.consumed)).toBe(1_000);
    expect(window.activeDays).toBe(1);
  });

  it("四类计数器分别累加，不折叠成一个数", () => {
    const rich = {
      ...record(NOW),
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheCreationTokens: 3,
        cacheReadTokens: 4
      }
    } as unknown as SessionRecord;
    const window = weeklyWindow([rich], null, NOW);
    expect(window.consumed).toEqual({ input: 1, output: 2, cacheCreation: 3, cacheRead: 4 });
  });

  it("空数据 → 全零与 0 个活动日", () => {
    const window = weeklyWindow([], null, NOW);
    expect(window.consumed).toEqual({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
    expect(window.previousConsumed).toEqual({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
    expect(window.activeDays).toBe(0);
  });

  it("上一周期落在 (now-14d, now-7d]，与本窗口互不重叠", () => {
    const window = weeklyWindow([record(NOW - 8 * DAY), record(NOW - 7 * DAY)], null, NOW);
    expect(totalsSum(window.consumed)).toBe(0);
    expect(totalsSum(window.previousConsumed)).toBe(2_000);
  });

  it("activeDays 按本地日去重，供样本是否足量的判断", () => {
    const window = weeklyWindow(
      [record(NOW), record(NOW - 3_600_000), record(NOW - 3 * DAY)],
      null,
      NOW
    );
    // NOW 是正午，前 1 小时同属一个本地日 → 3 条记录、2 个活动日。
    expect(window.activeDays).toBe(2);
  });

  it("跨夏令时不错位：窗口边界按绝对毫秒算，不按日历周", (ctx) => {
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 前提自检：2026-03-08 是美国春令时，当天只有 23 小时。TZ 没生效的环境
      // （无夏令时的系统时区且无法覆盖）就明说跳过，不让断言变成恒真。
      const dayLength = new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime();
      if (dayLength !== 23 * 3_600_000) {
        ctx.skip();
        return;
      }
      const now = new Date(2026, 2, 11, 12, 0, 0).getTime();
      // 这一周跨过春令时：7 个日历日只有 167 小时，「按日历日减 7」的边界会比
      // 绝对毫秒边界晚 1 小时。下面这条记录恰好落在两种算法的分歧带里。
      const justInside = now - WEEKLY_WINDOW_MS + 30 * 60_000;
      const window = weeklyWindow([record(justInside)], null, now);
      expect(totalsSum(window.consumed)).toBe(1_000);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("WeeklyWindow 类型不含 reset 字段——不知道的事实不给位置", () => {
    // 编译期（tsc -b，npm run build 的一部分强制）：一旦有人往 WeeklyWindow 加
    // resetAt 之类的字段，Extract 不再是 never，下面的赋值立即类型报错。
    type Unexpected = Extract<keyof WeeklyWindow, "resetAt" | "resetTime">;
    const noSuchField: Unexpected extends never ? true : false = true;
    expect(noSuchField).toBe(true);
    // 运行期同步锁住：构造出的对象形态确实没有任何 reset 字样。
    const window = weeklyWindow([], null, NOW);
    expect(Object.keys(window).some((key) => key.toLowerCase().includes("reset"))).toBe(false);
  });
});

describe("predictWeeklyLimitReach（周预算触达推算）", () => {
  it("未设预算 → noLimit（界面上就没有百分比）", () => {
    const window = weeklyWindow([record(NOW), record(NOW - DAY)], null, NOW);
    expect(predictWeeklyLimitReach(window, NOW)).toEqual({ noLimit: true });
  });

  it("活动日不足两天 → 样本不足，不硬外推", () => {
    const window = weeklyWindow([record(NOW, 50_000), record(NOW - 3_600_000, 50_000)], 100_000, NOW);
    expect(window.activeDays).toBe(1);
    expect(window.activeDays).toBeLessThan(MIN_ACTIVE_DAYS);
    expect(predictWeeklyLimitReach(window, NOW)).toEqual({ insufficientSample: true });
  });

  it("零消耗（全零 usage）→ 样本不足，不把「除以零」外推成结论", () => {
    const zero = { ...record(NOW), usage: { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 } } as unknown as SessionRecord;
    const window = weeklyWindow([zero, { ...zero, timestamp: NOW - DAY } as unknown as SessionRecord], 100_000, NOW);
    expect(predictWeeklyLimitReach(window, NOW)).toEqual({ insufficientSample: true });
  });

  it("按 7 天日均值外推：消耗 70k / 预算 100k → 再过 3 天触达", () => {
    const window = weeklyWindow([record(NOW, 35_000), record(NOW - 3 * DAY, 35_000)], 100_000, NOW);
    expect(predictWeeklyLimitReach(window, NOW)).toEqual({
      reachAt: NOW + 3 * DAY,
      tokensPerDay: 10_000
    });
  });

  it("已超预算 → 触达时刻就是现在，不给出过去的时刻", () => {
    const window = weeklyWindow([record(NOW, 80_000), record(NOW - 3 * DAY, 80_000)], 100_000, NOW);
    expect(predictWeeklyLimitReach(window, NOW)).toEqual({
      reachAt: NOW,
      tokensPerDay: 160_000 / 7
    });
  });
});
