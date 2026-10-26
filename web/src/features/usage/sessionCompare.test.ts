import { describe, expect, it } from "vitest";
import { compareSessions } from "./sessionCompare";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 时间戳全部用本地日历 `Date` 构造、断言也走同一本地口径，任何时区跑都成立。
 */

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

function inputOf(records: SessionRecord[], projectLabel = "p"): UsageSessionInput {
  return { records, projectLabel };
}

describe("sessionCompare", () => {
  it("一侧重用其 label，tokens/messages/records 汇总两侧", () => {
    const a = inputOf(
      [
        record(new Date(2026, 9, 10, 9, 0), { kind: "user" }),
        record(new Date(2026, 9, 10, 9, 5), { usage: usage(100, 20, 300, 4000), model: "claude-sonnet-4-5-20250929" })
      ],
      "alpha"
    );
    const b = inputOf(
      [
        record(new Date(2026, 9, 10, 9, 0), { kind: "user" }),
        record(new Date(2026, 9, 10, 9, 5), { usage: usage(50, 10, 150, 2000), model: "claude-sonnet-4-5-20250929" }),
        record(new Date(2026, 9, 10, 9, 6))
      ],
      "beta"
    );

    const result = compareSessions(a, b);
    expect(result.a.label).toBe("alpha");
    expect(result.b.label).toBe("beta");
    expect(result.a.tokens).toEqual({ input: 100, output: 20, cacheCreation: 300, cacheRead: 4000 });
    expect(result.b.tokens).toEqual({ input: 50, output: 10, cacheCreation: 150, cacheRead: 2000 });
    expect(result.a.messages).toBe(2);
    expect(result.b.messages).toBe(3);
    expect(result.a.records).toBe(2);
    expect(result.b.records).toBe(3);
  });

  it("ratio = 大/小 − 1，与输入顺序无关", () => {
    const a = inputOf([record(new Date(2026, 9, 10, 9, 0), { usage: usage(100, 0, 0, 0) })]);
    const b = inputOf([record(new Date(2026, 9, 10, 9, 0), { usage: usage(400, 0, 0, 0) })]);

    const diffOf = (result: ReturnType<typeof compareSessions>, field: string) =>
      result.diffs.find((diff) => diff.field === field)!;

    // tokens：400/100 − 1 = 3
    expect(diffOf(compareSessions(a, b), "tokens").ratio).toBeCloseTo(3, 12);
    expect(diffOf(compareSessions(b, a), "tokens").ratio).toBeCloseTo(3, 12);
    // messages：两侧同为 1 → ratio 0
    expect(diffOf(compareSessions(a, b), "messages").ratio).toBe(0);
    // records：同为 1 → 0
    expect(diffOf(compareSessions(a, b), "records").ratio).toBe(0);
  });

  it("空 records 的一侧：durationMinutes 为 0，全部 ratio 为 null", () => {
    const a = inputOf([]);
    const b = inputOf([
      record(new Date(2026, 9, 10, 9, 0), { usage: usage(10, 0, 0, 0) }),
      record(new Date(2026, 9, 10, 9, 30))
    ]);

    const result = compareSessions(a, b);
    expect(result.a.records).toBe(0);
    expect(result.a.durationMinutes).toBe(0);
    expect(result.a.messages).toBe(0);
    for (const diff of result.diffs) {
      expect(diff.ratio).toBeNull();
    }
  });

  it("模型 share 按 usage 记录数占比，求和 = 1（有 usage 时）", () => {
    const records = [
      record(new Date(2026, 9, 10, 9, 0), { usage: usage(100, 0, 0, 0), model: "claude-sonnet-4-5-20250929" }),
      record(new Date(2026, 9, 10, 9, 1), { usage: usage(100, 0, 0, 0), model: "claude-sonnet-4-5-20250929" }),
      record(new Date(2026, 9, 10, 9, 2), { usage: usage(100, 0, 0, 0), model: "claude-opus-4-1-20250805" }),
      // 无 usage 的 user 记录不进 models bucket（aggregateSession 口径）
      record(new Date(2026, 9, 10, 9, 3), { kind: "user" })
    ];
    const result = compareSessions(inputOf(records), inputOf([]));

    expect(result.a.models).toHaveLength(2);
    const sonnet = result.a.models.find((entry) => entry.model === "claude-sonnet-4-5-20250929")!;
    const opus = result.a.models.find((entry) => entry.model === "claude-opus-4-1-20250805")!;
    expect(sonnet.share).toBeCloseTo(2 / 3, 12);
    expect(opus.share).toBeCloseTo(1 / 3, 12);
    expect(sonnet.share + opus.share).toBeCloseTo(1, 12);
    // share 降序：2/3 在前
    expect(result.a.models[0].model).toBe("claude-sonnet-4-5-20250929");
    // 无 usage 记录的一侧不硬造模型列表
    expect(result.b.models).toEqual([]);
  });

  it("首末同刻 → durationMinutes 0；首末差已知 → 分钟数精确", () => {
    const same = inputOf([
      record(new Date(2026, 9, 10, 9, 0)),
      record(new Date(2026, 9, 10, 9, 0))
    ]);
    expect(compareSessions(same, same).a.durationMinutes).toBe(0);

    const span = inputOf([
      record(new Date(2026, 9, 10, 9, 0)),
      record(new Date(2026, 9, 10, 9, 30)),
      record(new Date(2026, 9, 10, 10, 0))
    ]);
    expect(compareSessions(span, same).a.durationMinutes).toBeCloseTo(60, 12);
  });

  it("单侧单模型：share = 1", () => {
    const solo = inputOf([
      record(new Date(2026, 9, 10, 9, 0), { usage: usage(10, 0, 0, 0), model: "claude-haiku-4-5-20251001" })
    ]);
    const result = compareSessions(solo, inputOf([]));
    expect(result.a.models).toEqual([{ model: "claude-haiku-4-5-20251001", share: 1 }]);
  });

  it("durationMinutes 的 ratio 也遵循大/小 − 1", () => {
    const short = inputOf([
      record(new Date(2026, 9, 10, 9, 0)),
      record(new Date(2026, 9, 10, 9, 30))
    ]);
    const long = inputOf([
      record(new Date(2026, 9, 10, 9, 0)),
      record(new Date(2026, 9, 10, 11, 0))
    ]);
    const diff = compareSessions(short, long).diffs.find((d) => d.field === "durationMinutes")!;
    expect(diff.ratio).toBeCloseTo(3, 12); // 120/30 − 1
  });
});
