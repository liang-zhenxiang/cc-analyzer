import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import {
  BILLING_WINDOW_MS,
  burnRateOf,
  clusterBillingBlocks,
  currentBlock,
  predictLimitReach
} from "./billingWindow";

const T0 = new Date(2026, 9, 2, 9, 0, 0).getTime();
const HOUR = 3_600_000;

function record(at: number, tokens = 1_000): SessionRecord {
  return {
    id: `r-${at}`,
    kind: "assistant",
    timestamp: at,
    usage: {
      inputTokens: tokens,
      outputTokens: tokens / 10,
      cacheCreationTokens: 0,
      cacheReadTokens: tokens * 4
    }
  } as unknown as SessionRecord;
}

describe("clusterBillingBlocks", () => {
  it("全部活动落在 5h 内 → 单窗口", () => {
    const blocks = clusterBillingBlocks([record(T0), record(T0 + HOUR)]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toBe(T0);
    expect(blocks[0].end).toBe(T0 + BILLING_WINDOW_MS);
    expect(blocks[0].messages).toBe(2);
  });

  it("窗口关闭后的首条活动开启新窗口（ccusage blocks 口径）", () => {
    const blocks = clusterBillingBlocks([
      record(T0),
      record(T0 + BILLING_WINDOW_MS - 1),
      record(T0 + BILLING_WINDOW_MS + HOUR)
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].start).toBe(T0 + BILLING_WINDOW_MS + HOUR);
  });

  it("恰好落在边界上的记录归下一个窗口（end 为开区间）", () => {
    const blocks = clusterBillingBlocks([record(T0), record(T0 + BILLING_WINDOW_MS)]);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].messages).toBe(1);
  });

  it("静默不足 5h 不切窗：间隙再大也是同一窗口直到 end", () => {
    const blocks = clusterBillingBlocks([
      record(T0),
      record(T0 + 4 * HOUR),
      record(T0 + 4.9 * HOUR)
    ]);
    expect(blocks).toHaveLength(1);
  });

  it("四类 token 分桶累计，messages 计数与 usage 无关", () => {
    const blocks = clusterBillingBlocks([record(T0, 2_000)]);
    expect(blocks[0].totals).toEqual({
      input: 2_000,
      output: 200,
      cacheCreation: 0,
      cacheRead: 8_000
    });
  });

  it("空输入 → 空窗口列表", () => {
    expect(clusterBillingBlocks([])).toEqual([]);
  });
});

describe("currentBlock", () => {
  const blocks = clusterBillingBlocks([record(T0), record(T0 + 6 * HOUR)]);

  it("now 落在第二个窗口内", () => {
    expect(currentBlock(blocks, T0 + 6 * HOUR + HOUR)?.start).toBe(T0 + 6 * HOUR);
  });

  it("窗口已关闭但无更新活动：仍读最后一个窗口（读数不消失）", () => {
    expect(currentBlock(blocks, T0 + 20 * HOUR)?.start).toBe(T0 + 6 * HOUR);
  });

  it("now 早于一切活动（时钟回拨场景）→ null", () => {
    expect(currentBlock(blocks, T0 - HOUR)).toBeNull();
  });
});

describe("burnRateOf / predictLimitReach", () => {
  // 一个消耗 60k tokens、已运行 2h 的窗口 → 30k/h。
  const block = {
    start: T0,
    end: T0 + BILLING_WINDOW_MS,
    totals: { input: 10_000, output: 10_000, cacheCreation: 10_000, cacheRead: 30_000 },
    messages: 5
  };
  const NOW = T0 + 2 * HOUR;

  it("速率 = 消耗 / 已运行时长", () => {
    const rate = burnRateOf(block, NOW);
    expect("tokensPerHour" in rate && rate.tokensPerHour).toBeCloseTo(30_000);
  });

  it("未满 30 分钟样本 → insufficientSample，不外推", () => {
    expect(burnRateOf(block, T0 + 10 * 60_000)).toEqual({ insufficientSample: true });
  });

  it("限额 60k、已耗 60k → 预计到达时刻就是现在", () => {
    const prediction = predictLimitReach(block, 60_000, NOW);
    expect("reachAt" in prediction && prediction.reachAt).toBe(NOW);
  });

  it("限额 90k → 一小时后的具体时刻", () => {
    const prediction = predictLimitReach(block, 90_000, NOW);
    expect("reachAt" in prediction && prediction.reachAt).toBe(NOW + HOUR);
  });

  it("无限额 → noLimit（没有分母就没有比率）", () => {
    expect(predictLimitReach(block, null, NOW)).toEqual({ noLimit: true });
  });

  it("样本不足 → insufficientSample 而非编造时刻", () => {
    expect(predictLimitReach(block, 90_000, T0 + 60_000)).toEqual({
      insufficientSample: true
    });
  });
});
