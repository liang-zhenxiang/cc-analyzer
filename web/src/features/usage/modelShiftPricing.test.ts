import { describe, expect, it } from "vitest";
import { modelShiftBreakdown, SHIFT_TARGETS } from "./modelShiftPricing";
import { classRate, MODEL_PRICING } from "./pricingSnapshot";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

let seq = 0;
function record(at: Date, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at.getTime(),
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(input: number, output: number, cacheCreation: number, cacheRead: number): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-1-20250805";
const HAIKU = "claude-haiku-4-5-20251001";

/** 手算对照：四计数器 × classRate 取率自己乘（不经 estimateCost 的口径内自证）。 */
function handUsd(
  totals: { input: number; output: number; cacheCreation: number; cacheRead: number },
  family: "opus" | "sonnet" | "haiku"
): number {
  return (
    (totals.input / 1_000_000) * classRate(family, "input") +
    (totals.output / 1_000_000) * classRate(family, "output") +
    (totals.cacheCreation / 1_000_000) * classRate(family, "cacheWrite") +
    (totals.cacheRead / 1_000_000) * classRate(family, "cacheRead")
  );
}

describe("modelShiftPricing", () => {
  it("SHIFT_TARGETS 恰好覆盖 MODEL_PRICING 的三个 family", () => {
    expect(SHIFT_TARGETS.map((t) => t.family).sort()).toEqual(["haiku", "opus", "sonnet"]);
    for (const target of SHIFT_TARGETS) {
      expect(MODEL_PRICING[target.family]).toBeDefined();
    }
  });

  it("纯 sonnet 会话换 opus：数值与手算（classRate 取率自己乘）一致", () => {
    const totals = { input: 2_000_000, output: 1_000_000, cacheCreation: 4_000_000, cacheRead: 10_000_000 };
    const session: UsageSessionInput = {
      records: [record(new Date(2026, 9, 10, 9, 0), { usage: usage(totals.input, totals.output, totals.cacheCreation, totals.cacheRead), model: SONNET })],
      projectLabel: "p"
    };

    const rows = modelShiftBreakdown([session]);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.from).toBe(SONNET);
    expect(row.records).toBe(1);

    expect(row.actualUsd).toBeCloseTo(handUsd(totals, "sonnet"), 12);

    const shiftedOpus = row.shiftedUsd.find((entry) => entry.to === OPUS)!;
    expect(shiftedOpus.usd).toBeCloseTo(handUsd(totals, "opus"), 12);
    // 同一组 token：opus 五倍于 sonnet 输入价，总额必然更高
    expect(shiftedOpus.usd!).toBeGreaterThan(row.actualUsd!);

    const shiftedHaiku = row.shiftedUsd.find((entry) => entry.to === HAIKU)!;
    expect(shiftedHaiku.usd).toBeCloseTo(handUsd(totals, "haiku"), 12);

    // 换到自己的对账行：与 actualUsd 完全一致
    const shiftedSelf = row.shiftedUsd.find((entry) => entry.to === SONNET)!;
    expect(shiftedSelf.usd).toBe(row.actualUsd);

    expect(row.shiftedUsd).toHaveLength(3);
  });

  it("unknown 模型：actualUsd 与 shiftedUsd 全部为 null，绝不 0", () => {
    const session: UsageSessionInput = {
      records: [
        record(new Date(2026, 9, 10, 9, 0), { usage: usage(9_000_000, 9_000_000, 9_000_000, 9_000_000), model: "gemini-3-pro" })
      ],
      projectLabel: "p"
    };

    const rows = modelShiftBreakdown([session]);
    expect(rows).toHaveLength(1);
    expect(rows[0].from).toBe("gemini-3-pro");
    expect(rows[0].actualUsd).toBeNull();
    // 关键：目标 family 已知也不给数——from 的 token 能数出来，但 from 的
    // actual 不可计价时，对照行的锚点缺失，全部 null 让视图整体标「未知」。
    for (const shifted of rows[0].shiftedUsd) {
      expect(shifted.usd).toBeNull();
    }
  });

  it("多模型混合会话按 from 分组，records 与四计数器分别累计", () => {
    const session: UsageSessionInput = {
      records: [
        record(new Date(2026, 9, 10, 9, 0), { usage: usage(1_000_000, 0, 0, 0), model: SONNET }),
        record(new Date(2026, 9, 10, 9, 1), { usage: usage(0, 2_000_000, 0, 0), model: SONNET }),
        record(new Date(2026, 9, 10, 9, 2), { usage: usage(500_000, 0, 0, 0), model: OPUS })
      ],
      projectLabel: "p"
    };

    const rows = modelShiftBreakdown([session]);
    expect(rows.map((row) => row.from).sort()).toEqual([OPUS, SONNET].sort());

    const sonnetRow = rows.find((row) => row.from === SONNET)!;
    expect(sonnetRow.records).toBe(2);
    expect(sonnetRow.actualUsd).toBeCloseTo(handUsd({ input: 1_000_000, output: 2_000_000, cacheCreation: 0, cacheRead: 0 }, "sonnet"), 12);

    const opusRow = rows.find((row) => row.from === OPUS)!;
    expect(opusRow.records).toBe(1);
    expect(opusRow.actualUsd).toBeCloseTo(handUsd({ input: 500_000, output: 0, cacheCreation: 0, cacheRead: 0 }, "opus"), 12);
  });

  it("跨会话累计：同一模型出现在两个会话里并成一列", () => {
    const first: UsageSessionInput = {
      records: [record(new Date(2026, 9, 10, 9, 0), { usage: usage(1_000_000, 0, 0, 0), model: SONNET })],
      projectLabel: "p1"
    };
    const second: UsageSessionInput = {
      records: [record(new Date(2026, 9, 11, 9, 0), { usage: usage(0, 1_000_000, 0, 0), model: SONNET })],
      projectLabel: "p2"
    };

    const rows = modelShiftBreakdown([first, second]);
    expect(rows).toHaveLength(1);
    expect(rows[0].records).toBe(2);
    expect(rows[0].actualUsd).toBeCloseTo(handUsd({ input: 1_000_000, output: 1_000_000, cacheCreation: 0, cacheRead: 0 }, "sonnet"), 12);
  });

  it("无 usage 的记录不进任何 from 分组；空输入返回空数组", () => {
    const session: UsageSessionInput = {
      records: [
        record(new Date(2026, 9, 10, 9, 0), { kind: "user" }),
        record(new Date(2026, 9, 10, 9, 1), { model: SONNET }) // 有 model 无 usage
      ],
      projectLabel: "p"
    };
    expect(modelShiftBreakdown([session])).toEqual([]);
    expect(modelShiftBreakdown([])).toEqual([]);
  });
});
