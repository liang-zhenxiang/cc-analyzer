import { describe, expect, it } from "vitest";
import { GAP_DAYS, modelTimeline } from "./modelTimeline";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

function at(year: number, month: number, day: number, hour = 10): number {
  return new Date(year, month - 1, day, hour).getTime();
}

let seq = 0;
function record(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(input: number): SessionUsage {
  return { inputTokens: input };
}

function inputOf(records: SessionRecord[], projectLabel = "p"): UsageSessionInput {
  return { records, projectLabel };
}

const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-1-20250805";

describe("modelTimeline · 基础", () => {
  it("空输入 → 两个输出都空", () => {
    expect(modelTimeline([])).toEqual({ entries: [], gapFlags: [] });
  });

  it("单模型：first/last/sessions/tokens 各就各位", () => {
    const { entries, gapFlags } = modelTimeline([
      inputOf([
        record(at(2026, 3, 1), { usage: usage(100), model: SONNET }),
        record(at(2026, 3, 5), { usage: usage(200), model: SONNET })
      ])
    ]);
    expect(entries).toEqual([
      {
        model: SONNET,
        first: at(2026, 3, 1),
        last: at(2026, 3, 5),
        sessions: 1,
        tokens: { input: 300, output: 0, cacheCreation: 0, cacheRead: 0 }
      }
    ]);
    expect(gapFlags).toEqual([]);
  });

  it("无 usage 的记录不进时间线（有 model 也不算使用）", () => {
    const { entries } = modelTimeline([inputOf([record(at(2026, 3, 1), { model: SONNET })])]);
    expect(entries).toEqual([]);
  });

  it("record.model 缺省 → 「未知模型」桶", () => {
    const { entries } = modelTimeline([inputOf([record(at(2026, 3, 1), { usage: usage(10) })])]);
    expect(entries).toEqual([
      expect.objectContaining({ model: "未知模型", sessions: 1 })
    ]);
  });
});

describe("modelTimeline · 多模型排序与 min/max", () => {
  it("entries 升序按 first；乱序输入收敛到同一顺序", () => {
    const sessions = [
      inputOf([record(at(2026, 5, 1), { usage: usage(1), model: OPUS })]),
      inputOf([record(at(2026, 2, 1), { usage: usage(2), model: SONNET })])
    ];
    const { entries } = modelTimeline(sessions);
    expect(entries.map((entry) => entry.model)).toEqual([SONNET, OPUS]);

    const reversed = modelTimeline([...sessions].reverse());
    expect(reversed.entries.map((entry) => entry.model)).toEqual([SONNET, OPUS]);
  });

  it("同名模型跨多次使用取 min/max；会话数按会话去重", () => {
    const a = inputOf([
      record(at(2026, 4, 10), { usage: usage(1), model: SONNET }),
      record(at(2026, 4, 20), { usage: usage(2), model: SONNET })
    ]);
    const b = inputOf([record(at(2026, 4, 15), { usage: usage(3), model: SONNET })]);
    const { entries } = modelTimeline([b, a]);
    const sonnet = entries.find((entry) => entry.model === SONNET)!;
    expect(sonnet.first).toBe(at(2026, 4, 10));
    expect(sonnet.last).toBe(at(2026, 4, 20));
    expect(sonnet.sessions).toBe(2);
    expect(sonnet.tokens.input).toBe(6);
  });
});

describe("modelTimeline · 回归段边界", () => {
  it("间隔 14 天整（第 0 → 第 14 天）不算回归", () => {
    const { gapFlags } = modelTimeline([
      inputOf([
        record(at(2026, 6, 1), { usage: usage(1), model: SONNET }),
        record(at(2026, 6, 15), { usage: usage(1), model: SONNET })
      ])
    ]);
    expect(gapFlags).toEqual([]);
  });

  it("间隔 15 天（第 0 → 第 15 天）算回归", () => {
    const { gapFlags } = modelTimeline([
      inputOf([
        record(at(2026, 6, 1), { usage: usage(1), model: SONNET }),
        record(at(2026, 6, 16), { usage: usage(1), model: SONNET })
      ])
    ]);
    expect(gapFlags).toEqual([
      { model: SONNET, from: at(2026, 6, 1), to: at(2026, 6, 16) }
    ]);
  });

  it("23:59 → 次日 00:01 只隔 1 个日历日（墙钟近但日历日远不了）", () => {
    const { gapFlags } = modelTimeline([
      inputOf([
        record(at(2026, 6, 1, 23), { usage: usage(1), model: SONNET }),
        record(new Date(2026, 5, 2, 0, 1).getTime(), { usage: usage(1), model: SONNET })
      ])
    ]);
    expect(gapFlags).toEqual([]);
  });

  it("多段回归全部给出；gapFlags 按 (model, from) 升序", () => {
    const { gapFlags } = modelTimeline([
      inputOf([
        record(at(2026, 1, 1), { usage: usage(1), model: SONNET }),
        record(at(2026, 1, 20), { usage: usage(1), model: SONNET }), // 回归 1（19 天）
        record(at(2026, 2, 10), { usage: usage(1), model: SONNET }), // 回归 2（21 天）
        record(at(2026, 2, 11), { usage: usage(1), model: OPUS })
      ])
    ]);
    expect(gapFlags).toEqual([
      { model: SONNET, from: at(2026, 1, 1), to: at(2026, 1, 20) },
      { model: SONNET, from: at(2026, 1, 20), to: at(2026, 2, 10) }
    ]);
  });
});

describe("modelTimeline · GAP_DAYS 常量", () => {
  it("阈值为 14（> 14 天即回归）", () => {
    expect(GAP_DAYS).toBe(14);
  });
});
