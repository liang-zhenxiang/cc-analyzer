import { describe, expect, it } from "vitest";
import type { RecordKind, SessionRecord, SessionUsage } from "./types";
import { PRICING_AS_OF, classRate } from "../usage/pricingSnapshot";
import {
  LEDGER_CLASS_ORDER,
  MISSING_MODEL_LABEL,
  TOP_CALLS_LIMIT,
  buildCostLedger,
  classUnitPrice,
  formatLedgerRate,
  formatLedgerUsd,
  formatSharePercent,
  type LedgerClassKey
} from "./costLedger";

/** 固定墙钟：没有任何断言依赖「现在」。 */
const T0 = 1_700_000_000_000;
const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20251001";
const OPUS = "claude-opus-4-1-20250805";
/** 未收录厂商：定价未知，永远不能按 0 计价。 */
const UNKNOWN = "gemini-3-pro";

const CLASS_ORDER: LedgerClassKey[] = ["input", "output", "cacheWrite", "cacheRead"];

function recordOf(spec: {
  id: string;
  at: number;
  model?: string;
  usage?: SessionUsage;
  kind?: RecordKind;
}): SessionRecord {
  const record: SessionRecord = {
    id: spec.id,
    fullId: spec.id,
    kind: spec.kind ?? "assistant",
    timestamp: spec.at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {}
  };
  // 缺 model / 缺 usage 是两种不同的「未定价」，必须真的缺席而不是 undefined
  // 显式挂上去（`usage: undefined` 与没有这个键在语义上相同，但夹具要表达清楚）。
  if (spec.model !== undefined) record.model = spec.model;
  if (spec.usage !== undefined) record.usage = spec.usage;
  return record;
}

/** 一次普通模型调用；`at` 默认按序号错开，避免所有夹具挤在同一时刻。 */
function call(
  id: string,
  usage: SessionUsage,
  model: string = SONNET,
  at: number = T0 + Number(id.replace(/\D/g, "") || 0)
): SessionRecord {
  return recordOf({ id, at, model, usage });
}

function classTokens(ledger: ReturnType<typeof buildCostLedger>): Record<LedgerClassKey, number> {
  const totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  for (const line of ledger.classes) totals[line.key] += line.tokens;
  return totals;
}

/** 四类小计的合计——口径 4 的另一条加法路径。 */
function sumClassUsd(ledger: ReturnType<typeof buildCostLedger>): number {
  return ledger.classes.reduce((sum, line) => sum + line.usd, 0);
}

describe("buildCostLedger · 收据（口径 4/5）", () => {
  it("prices each class at its own family rate and turns every class into a share", () => {
    // sonnet：1.0M input × $3 = $3；0.2M output × $15 = $3；
    //          0.4M cacheWrite × $3.75 = $1.5；2.0M cacheRead × $0.3 = $0.6 → $8.1
    // haiku ：1.0M input × $1 = $1；1.0M output × $5 = $5 → $6
    const ledger = buildCostLedger([
      call("r1", {
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        cacheCreationTokens: 400_000,
        cacheReadTokens: 2_000_000
      }, SONNET, T0),
      call("r2", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, HAIKU, T0 + 1)
    ]);

    // 固定四行、固定顺序，含 0 行也照样出现。
    expect(ledger.classes.map((line) => line.key)).toEqual(CLASS_ORDER);

    const [input, output, cacheWrite, cacheRead] = ledger.classes;
    expect(input.tokens).toBe(2_000_000);
    expect(input.usd).toBeCloseTo(4, 12); // 3 × $3 + 1 × $1
    expect(output.tokens).toBe(1_200_000);
    expect(output.usd).toBeCloseTo(8, 12); // 0.2M × $15 + 1M × $5
    expect(cacheWrite.tokens).toBe(400_000);
    expect(cacheWrite.usd).toBeCloseTo(1.5, 12);
    expect(cacheRead.tokens).toBe(2_000_000);
    expect(cacheRead.usd).toBeCloseTo(0.6, 12);

    expect(ledger.totalUsd).toBeCloseTo(14.1, 12);
    expect(ledger.pricedCalls).toBe(2);

    // 占比以合计为分母，四行相加为 1（合计为正时）。
    const shares = ledger.classes.map((line) => line.share);
    expect(shares[0]).toBeCloseTo(4 / 14.1, 12);
    expect(shares[1]).toBeCloseTo(8 / 14.1, 12);
    expect(shares[2]).toBeCloseTo(1.5 / 14.1, 12);
    expect(shares[3]).toBeCloseTo(0.6 / 14.1, 12);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 12);
  });

  it("keeps totalUsd closed against the four class subtotals", () => {
    // 300 条伪随机调用：金额来自三条不同的加法路径，只有真闭合才相等。
    let state = 20_261_023;
    const next = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const models = [SONNET, HAIKU, OPUS, UNKNOWN];
    const records: SessionRecord[] = [];
    for (let index = 0; index < 300; index += 1) {
      records.push(
        call(
          `r${index}`,
          {
            inputTokens: Math.floor(next() * 200_000),
            outputTokens: Math.floor(next() * 40_000),
            cacheCreationTokens: Math.floor(next() * 90_000),
            cacheReadTokens: Math.floor(next() * 3_000_000)
          },
          models[index % models.length],
          T0 + index * 1_000
        )
      );
    }

    const ledger = buildCostLedger(records);
    // 口径 4：误差 < 1e-9。
    expect(Math.abs((ledger.totalUsd ?? 0) - sumClassUsd(ledger))).toBeLessThan(1e-9);

    // 口径 4 后半句：四类 token 求和 == 所有可定价调用的四类 token 求和。
    const expected = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    for (const record of records) {
      if (record.model === UNKNOWN) continue; // 未定价的量不进收据
      expected.input += record.usage?.inputTokens ?? 0;
      expected.output += record.usage?.outputTokens ?? 0;
      expected.cacheWrite += record.usage?.cacheCreationTokens ?? 0;
      expected.cacheRead += record.usage?.cacheReadTokens ?? 0;
    }
    expect(classTokens(ledger)).toEqual(expected);

    // 每一条可定价调用都落到合计里，且定价/未定价的调用数守恒。
    expect(ledger.pricedCalls).toBe(225);
    expect(ledger.unpricedCalls).toBe(75);
    expect(ledger.pricedCalls + ledger.unpricedCalls).toBe(records.length);
  });

  it("returns four zero rows and null shares when nothing can be priced", () => {
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 5_000_000, outputTokens: 1_000 }, UNKNOWN, T0)
    ]);

    expect(ledger.classes.map((line) => line.key)).toEqual(CLASS_ORDER);
    for (const line of ledger.classes) {
      expect(line.tokens).toBe(0);
      expect(line.usd).toBe(0);
      // 口径 5：totalUsd 为 null 时四行占比全 0。
      expect(line.share).toBe(0);
    }
    expect(ledger.totalUsd).toBeNull();
    expect(ledger.pricedCalls).toBe(0);
  });
});

describe("buildCostLedger · 未定价（口径 2/3）", () => {
  it("lists an unknown model separately and keeps it out of the totals", () => {
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 1_000_000 }, SONNET, T0),
      recordOf({
        id: "r2",
        at: T0 + 1,
        model: UNKNOWN,
        usage: {
          inputTokens: 500_000,
          outputTokens: 100_000,
          cacheCreationTokens: 200_000,
          cacheReadTokens: 300_000
        }
      })
    ]);

    // 合计只含 sonnet 的 $3。
    expect(ledger.totalUsd).toBeCloseTo(3, 12);
    expect(ledger.pricedCalls).toBe(1);
    expect(ledger.unpricedCalls).toBe(1);
    // 四类 token 之和 = 500k + 100k + 200k + 300k。
    expect(ledger.unpricedTokens).toBe(1_100_000);
    expect(ledger.unpricedModels).toEqual([UNKNOWN]);
    expect(ledger.topCalls.map((item) => item.recordId)).toEqual(["r1"]);

    // 未定价的量不进收据，只进 models[].tokens。
    expect(classTokens(ledger)).toEqual({
      input: 1_000_000,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0
    });

    const unknown = ledger.models.find((line) => line.model === UNKNOWN);
    expect(unknown).toBeDefined();
    expect(unknown?.family).toBeNull();
    expect(unknown?.calls).toBe(1);
    // 绝不按 0 计价：金额是「不知道」，不是 $0.00。
    expect(unknown?.usd).toBeNull();
    expect(unknown?.unpricedCalls).toBe(1);
    expect(unknown?.tokens).toEqual({
      input: 500_000,
      output: 100_000,
      cacheWrite: 200_000,
      cacheRead: 300_000
    });
  });

  it("labels a call with no model as 未记录模型 instead of dropping it", () => {
    const ledger = buildCostLedger([
      recordOf({ id: "r1", at: T0, usage: { inputTokens: 70_000 } })
    ]);

    expect(ledger.unpricedModels).toEqual([MISSING_MODEL_LABEL]);
    expect(ledger.unpricedCalls).toBe(1);
    expect(ledger.unpricedTokens).toBe(70_000);
    expect(ledger.totalUsd).toBeNull();
    expect(ledger.models).toHaveLength(1);
    expect(ledger.models[0].model).toBe(MISSING_MODEL_LABEL);
    expect(ledger.models[0].family).toBeNull();
    expect(ledger.models[0].usd).toBeNull();
  });

  it("counts model calls that carry no usage reading at all", () => {
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 1_000_000 }, SONNET, T0),
      // 有调用、无读数：不知道花了多少。
      recordOf({ id: "r2", at: T0 + 1, model: SONNET }),
      // 工具记录结构上就没有 usage——不是「缺失的读数」，不计入未定价。
      recordOf({
        id: "r3",
        at: T0 + 2,
        kind: "tool",
        usage: { inputTokens: 9_000_000 }
      })
    ]);

    expect(ledger.pricedCalls).toBe(1);
    expect(ledger.unpricedCalls).toBe(1);
    expect(ledger.totalUsd).toBeCloseTo(3, 12);
    // 缺 usage 的调用没有量可记，也不生成一条模型行。
    expect(ledger.models).toHaveLength(1);
    expect(ledger.models[0].model).toBe(SONNET);
    expect(ledger.models[0].calls).toBe(1);
  });
});

describe("buildCostLedger · 缓存经济学（口径 6）", () => {
  it("reports the hit rate and the money cache reads saved at each model's own input rate", () => {
    const ledger = buildCostLedger([
      // sonnet：3M 读 / 1M 输入 → 省 3M × ($3 − $0.3) / 1M = $8.1
      call("r1", { inputTokens: 1_000_000, cacheReadTokens: 3_000_000 }, SONNET, T0),
      // haiku：1M 读 / 1M 输入 → 省 1M × ($1 − $0.1) / 1M = $0.9
      call("r2", { inputTokens: 1_000_000, cacheReadTokens: 1_000_000 }, HAIKU, T0 + 1)
    ]);

    expect(ledger.cache.readTokens).toBe(4_000_000);
    expect(ledger.cache.inputTokens).toBe(2_000_000);
    expect(ledger.cache.hitRate).toBeCloseTo(4 / 6, 12);
    expect(ledger.cache.savedUsd).toBeCloseTo(9, 12);
  });

  it("never claims savings for an unpriced model and reports a null hit rate with no readings", () => {
    const unknownOnly = buildCostLedger([
      call("r1", { cacheReadTokens: 9_000_000 }, UNKNOWN, T0)
    ]);
    expect(unknownOnly.cache.readTokens).toBe(0);
    expect(unknownOnly.cache.savedUsd).toBe(0);
    // 分母为 0 → null（「无读数」），不是 0（「一次都没命中」）。
    expect(unknownOnly.cache.hitRate).toBeNull();

    const empty = buildCostLedger([]);
    expect(empty.cache.hitRate).toBeNull();
    expect(empty.cache.savedUsd).toBe(0);
  });

  it("keeps the cache block on the receipt's own denominator (priced calls only)", () => {
    // 混进一个读得最凶的未定价模型 + 一次没有读数的调用：如果 cache 块偷偷
    // 推广成「全部记录」，下面两个数会立刻暴涨，这条测试就是为了让那种改动
    // 红掉（lead 裁决：整页是一本计价账，不能同一张卡里混两个分母）。
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 2_000_000, outputTokens: 300_000, cacheCreationTokens: 400_000, cacheReadTokens: 4_000_000 }, SONNET, T0),
      call("r2", { inputTokens: 500_000, cacheReadTokens: 1_000_000 }, OPUS, T0 + 1),
      call("r3", { inputTokens: 7_000_000, outputTokens: 900_000, cacheReadTokens: 9_000_000 }, UNKNOWN, T0 + 2),
      recordOf({ id: "r4", at: T0 + 3 })
    ]);

    const receiptTokensOf = (key: LedgerClassKey) =>
      ledger.classes.find((line) => line.key === key)?.tokens;

    // 不变量：cache 块与收据是同一批可定价调用的两种切法，逐位相等。
    expect(ledger.cache.readTokens).toBe(receiptTokensOf("cacheRead"));
    expect(ledger.cache.inputTokens).toBe(receiptTokensOf("input"));
    // 绝对值钉死：只有 r1 + r2 计入（未定价模型的 9M / 7M 一个都不许进来）。
    expect(ledger.cache.readTokens).toBe(5_000_000);
    expect(ledger.cache.inputTokens).toBe(2_500_000);
    expect(ledger.cache.hitRate).toBeCloseTo(5_000_000 / 7_500_000, 12);
  });
});

describe("buildCostLedger · 最贵的调用（口径 7）", () => {
  it("orders by cost, breaks ties by time and keeps only the five costliest", () => {
    const ledger = buildCostLedger([
      // $6 @ 100
      call("r1", { inputTokens: 2_000_000 }, SONNET, T0 + 100),
      // $3 @ 300（与 r3 并列，时间更晚 → 排在后面）
      call("r2", { inputTokens: 1_000_000 }, SONNET, T0 + 300),
      // $3 @ 200
      call("r3", { inputTokens: 1_000_000 }, SONNET, T0 + 200),
      // 三条 $1 尾随；最便宜的一条（r6 @ 700）被截断
      call("r4", { inputTokens: 333_334 }, SONNET, T0 + 500),
      call("r5", { inputTokens: 333_334 }, SONNET, T0 + 600),
      call("r6", { inputTokens: 333_334 }, SONNET, T0 + 700),
      // 未定价调用金额未知，永远不上榜——哪怕它的 token 量最大。
      call("r7", { inputTokens: 900_000_000 }, UNKNOWN, T0 + 50)
    ]);

    expect(ledger.topCalls).toHaveLength(TOP_CALLS_LIMIT);
    expect(ledger.topCalls.map((item) => item.recordId)).toEqual(["r1", "r3", "r2", "r4", "r5"]);
    // 榜首金额是真金白银算出来的，不是 0。
    expect(ledger.topCalls[0].usd).toBeCloseTo(6, 12);
    expect(ledger.topCalls[0].kind).toBe("assistant");
    expect(ledger.topCalls[0].model).toBe(SONNET);
    expect(ledger.topCalls[0].timestamp).toBe(T0 + 100);
    // 并列两条：金额相同，时间升序。
    expect(ledger.topCalls[1].usd).toBeCloseTo(ledger.topCalls[2].usd, 12);
    expect(ledger.topCalls[1].timestamp).toBeLessThan(ledger.topCalls[2].timestamp);
    // 榜外的那条确实存在，只是没进前五。
    expect(ledger.topCalls.some((item) => item.recordId === "r6")).toBe(false);
    expect(ledger.topCalls.some((item) => item.recordId === "r7")).toBe(false);
  });

  it("keeps the earlier call when two calls tie on both cost and timestamp", () => {
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 1_000_000 }, SONNET, T0),
      call("r2", { inputTokens: 1_000_000 }, SONNET, T0),
      call("r3", { inputTokens: 1_000_000 }, SONNET, T0),
      call("r4", { inputTokens: 1_000_000 }, SONNET, T0),
      call("r5", { inputTokens: 1_000_000 }, SONNET, T0),
      call("r6", { inputTokens: 1_000_000 }, SONNET, T0)
    ]);

    // 六条完全同龄同额：顺序只能是日志顺序，第 6 条被挡在榜外。
    expect(ledger.topCalls.map((item) => item.recordId)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });
});

describe("buildCostLedger · 空态与跨度（口径 8/9）", () => {
  it("returns an honest empty ledger for no records", () => {
    const ledger = buildCostLedger([]);

    expect(ledger.classes.map((line) => line.key)).toEqual(CLASS_ORDER);
    expect(ledger.classes.every((line) => line.tokens === 0 && line.usd === 0)).toBe(true);
    expect(ledger.totalUsd).toBeNull();
    expect(ledger.pricedCalls).toBe(0);
    expect(ledger.unpricedCalls).toBe(0);
    expect(ledger.unpricedTokens).toBe(0);
    expect(ledger.unpricedModels).toEqual([]);
    expect(ledger.models).toEqual([]);
    expect(ledger.topCalls).toEqual([]);
    expect(ledger.cache).toEqual({
      readTokens: 0,
      inputTokens: 0,
      hitRate: null,
      savedUsd: 0
    });
    expect(ledger.span).toEqual({ start: 0, end: 0 });
    // 定价快照日期永远透传，界面靠它说明「这是估算」。
    expect(ledger.pricingAsOf).toBe(PRICING_AS_OF);
  });

  it("spans the usage-bearing calls only", () => {
    const ledger = buildCostLedger([
      // 无 usage 的调用不参与跨度，也不该被当成账单的时间轴端点。
      recordOf({ id: "r0", at: T0 + 9_000, model: SONNET }),
      call("r1", { inputTokens: 1_000 }, SONNET, T0 + 900),
      call("r2", { inputTokens: 1_000 }, SONNET, T0 + 100),
      call("r3", { inputTokens: 1_000 }, SONNET, T0 + 500),
      // 非 assistant 记录更不该参与。
      recordOf({ id: "r4", at: T0 - 9_000, kind: "user" })
    ]);

    expect(ledger.span).toEqual({ start: T0 + 100, end: T0 + 900 });
  });

  it("has no span when usage exists nowhere", () => {
    const ledger = buildCostLedger([
      recordOf({ id: "r1", at: T0, kind: "user" }),
      recordOf({ id: "r2", at: T0 + 10, model: SONNET })
    ]);
    expect(ledger.span).toEqual({ start: 0, end: 0 });
  });
});

describe("buildCostLedger · 导出的界面契约", () => {
  it("exports the four-class row order and the missing-model label the UI must render", () => {
    // 收据的行序是账单语义的一部分，界面照这个常量渲染、不自己排；
    // 这里用字面量钉死它，改顺序就必须先改这条断言（即一次有意的决定）。
    expect(LEDGER_CLASS_ORDER).toEqual(CLASS_ORDER);
    expect(LEDGER_CLASS_ORDER).toEqual(["input", "output", "cacheWrite", "cacheRead"]);
    // 缺 model 的占位名是 PRD 原文，全角括号，界面直接显示这一串。
    expect(MISSING_MODEL_LABEL).toBe("（未记录模型）");
    // 榜单容量：界面不要写死 5。
    expect(TOP_CALLS_LIMIT).toBe(5);
  });
});

describe("buildCostLedger · 逐模型（口径 3 的排序）", () => {
  it("sorts priced models by cost descending and leaves unknown ones last", () => {
    const ledger = buildCostLedger([
      // haiku $1
      call("r1", { inputTokens: 1_000_000 }, HAIKU, T0),
      // sonnet $6
      call("r2", { inputTokens: 2_000_000 }, SONNET, T0 + 1),
      // opus $3
      call("r3", { inputTokens: 200_000 }, OPUS, T0 + 2),
      // 未知模型：金额未知，排最后
      call("r4", { inputTokens: 50_000_000 }, UNKNOWN, T0 + 3),
      // 缺 model：同样未知，排最后
      recordOf({ id: "r5", at: T0 + 4, usage: { inputTokens: 1_000 } })
    ]);

    expect(ledger.models.map((line) => line.model)).toEqual([
      SONNET,
      OPUS,
      HAIKU,
      UNKNOWN,
      MISSING_MODEL_LABEL
    ]);
    expect(ledger.models.map((line) => line.family)).toEqual([
      "sonnet",
      "opus",
      "haiku",
      null,
      null
    ]);
    // 可定价的金额递减，未知的金额一律 null（而不是 0 或垫底的小数）。
    expect(ledger.models[0].usd).toBeCloseTo(6, 12);
    expect(ledger.models[1].usd).toBeCloseTo(3, 12);
    expect(ledger.models[2].usd).toBeCloseTo(1, 12);
    expect(ledger.models[3].usd).toBeNull();
    expect(ledger.models[4].usd).toBeNull();
    // unpricedModels 是「按出现顺序」的去重名单，与 models 的排序无关。
    expect(ledger.unpricedModels).toEqual([UNKNOWN, MISSING_MODEL_LABEL]);
  });

  it("keeps a per-model token record for every class", () => {
    const ledger = buildCostLedger([
      call("r1", {
        inputTokens: 10,
        outputTokens: 20,
        cacheCreationTokens: 30,
        cacheReadTokens: 40
      }, SONNET, T0),
      call("r2", { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3 }, SONNET, T0 + 1)
    ]);

    expect(ledger.models[0].tokens).toEqual({
      input: 11,
      output: 22,
      cacheWrite: 30,
      cacheRead: 43
    });
    expect(ledger.models[0].calls).toBe(2);
    expect(ledger.models[0].unpricedCalls).toBe(0);
  });
});

describe("buildCostLedger · 性能（口径 R5）", () => {
  it("builds ten thousand records well under the frame budget", () => {
    const records: SessionRecord[] = [];
    for (let index = 0; index < 10_000; index += 1) {
      const model = index % 5 === 4 ? UNKNOWN : SONNET;
      records.push(
        call(
          `r${index}`,
          {
            inputTokens: 1_200 + index,
            outputTokens: 300,
            cacheCreationTokens: index % 3 === 0 ? 4_000 : 0,
            cacheReadTokens: 80_000
          },
          model,
          T0 + index * 1_000
        )
      );
    }

    const startedAt = performance.now();
    const ledger = buildCostLedger(records);
    const elapsedMs = performance.now() - startedAt;

    // 宽松上界：真实耗时是个位数毫秒，50ms 只用来抓「退化成 O(n log n) 或
    // 每条记录都重建一张表」这类结构性回退，不抓 CI 抖动。
    expect(elapsedMs).toBeLessThan(50);
    expect(ledger.pricedCalls).toBe(8_000);
    expect(ledger.unpricedCalls).toBe(2_000);
    expect(ledger.models).toHaveLength(2);
    expect(ledger.topCalls).toHaveLength(TOP_CALLS_LIMIT);
    expect(Math.abs((ledger.totalUsd ?? 0) - sumClassUsd(ledger))).toBeLessThan(1e-9);
  });
});

/** 取某一科目的收据行；键是固定的四种，取不到就是测试自己写错了。 */
function classLineOf(
  ledger: ReturnType<typeof buildCostLedger>,
  key: LedgerClassKey
): ReturnType<typeof buildCostLedger>["classes"][number] {
  const line = ledger.classes.find((item) => item.key === key);
  if (!line) throw new Error(`缺少科目 ${key}`);
  return line;
}

describe("formatLedgerUsd · 账单专用金额（设计规格 §2.3）", () => {
  it("keeps unknown, true zero and sub-cent amounts in three different shapes", () => {
    // 1. 未知不是免费：null / 非有限一律 —（U+2014），绝不是 $0.00。
    expect(formatLedgerUsd(null)).toBe("—");
    expect(formatLedgerUsd(Number.NaN)).toBe("—");
    expect(formatLedgerUsd(Number.POSITIVE_INFINITY)).toBe("—");
    // 2. 真零允许出现（0 token 的科目）。
    expect(formatLedgerUsd(0)).toBe("$0.00");
    // 3. 三位小数会印成 $0.000 → 换成「小于一毫」。
    expect(formatLedgerUsd(0.00009)).toBe("<$0.001");
    expect(formatLedgerUsd(0.0004)).toBe("<$0.001");
    // 0.0009 的三位小数是 0.001（进位），所以它已经能写成金额了。
    expect(formatLedgerUsd(0.0009)).toBe("$0.001");
    // 4. 三位小数仍不足一分 → 给可相加的三位小数，而不是 <$0.01 区间。
    expect(formatLedgerUsd(0.001)).toBe("$0.001");
    expect(formatLedgerUsd(0.002)).toBe("$0.002");
    expect(formatLedgerUsd(0.004)).toBe("$0.004");
    // 夹具里那笔 $0.002 的缓存读取——假零断言靠的就是这条。
    expect(formatLedgerUsd(0.0015)).toBe("$0.002");
    // 5. 不足一千 → 两位小数，与全站金额同形。
    expect(formatLedgerUsd(0.01)).toBe("$0.01");
    expect(formatLedgerUsd(1.0833)).toBe("$1.08");
    expect(formatLedgerUsd(999.99)).toBe("$999.99");
    // 6. 一千及以上 → 千分位、四舍五入到整数。
    expect(formatLedgerUsd(1000)).toBe("$1,000");
    expect(formatLedgerUsd(1234)).toBe("$1,234");
    expect(formatLedgerUsd(1234.6)).toBe("$1,235");
    // 999.995 的两位小数是 1000.00：按四舍五入后的值走千分位分支，
    // 不让同一个数量级出现 $1000.00 与 $1,000 两种写法。
    expect(formatLedgerUsd(999.995)).toBe("$1,000");
    expect(formatLedgerUsd(999.994)).toBe("$999.99");
  });

  it("never prints a three-decimal form that rounds up to a whole cent", () => {
    // 0.00999 的四舍五入三位小数是 0.010：若按原始值 < 0.01 落进三位小数
    // 分支，就会印出 $0.010——与 0.0101 的 $0.01 是两种写法，也不单调。
    expect(formatLedgerUsd(0.00999)).toBe("$0.01");
    expect(formatLedgerUsd(0.0099)).toBe("$0.01");
    expect(formatLedgerUsd(0.0101)).toBe("$0.01");
    // 三位小数真的不足一分（0.009）时仍然给三位小数。
    expect(formatLedgerUsd(0.0095)).toBe("$0.009");
    expect(formatLedgerUsd(0.0094)).toBe("$0.009");
  });
});

describe("formatLedgerRate · 单价（§2.4）", () => {
  it("prints a table rate plainly, an average with ≈ and nothing as an em dash", () => {
    expect(formatLedgerRate(null, false)).toBe("—");
    expect(formatLedgerRate(null, true)).toBe("—");
    expect(formatLedgerRate(Number.NaN, false)).toBe("—");
    // 单档：价目本身，不带 ≈。
    expect(formatLedgerRate(3, false)).toBe("$3.00");
    expect(formatLedgerRate(0.3, false)).toBe("$0.30");
    expect(formatLedgerRate(75, false)).toBe("$75.00");
    // 跨档：≈ 是唯一的区分手段，两位小数。
    expect(formatLedgerRate(3.7912, true)).toBe("≈$3.79");
    expect(formatLedgerRate(1, true)).toBe("≈$1.00");
    // ≈ 是 U+2248，不是 ASCII 的 ~，也不是全角的 ～。
    expect(formatLedgerRate(3, true).charCodeAt(0)).toBe(0x2248);
  });
});

describe("formatSharePercent · 占比（§2.3）", () => {
  it("separates 'a sliver' from 'nothing'", () => {
    // 没有量：必须印 0.0%，不能印 <0.1%（那是把「没有」说成「很小」）。
    expect(formatSharePercent(0, 0)).toBe("0.0%");
    expect(formatSharePercent(0.0004, 0)).toBe("0.0%");
    // 有量但小到两位小数会读成 0.0% → 换成 <0.1%。
    expect(formatSharePercent(0.0004, 1_000_000)).toBe("<0.1%");
    // 恰好 0.05% 不落 <0.1%（边界是严格小于）。
    expect(formatSharePercent(0.0005, 10)).toBe("0.1%");
    expect(formatSharePercent(0.5334, 10)).toBe("53.3%");
    expect(formatSharePercent(1, 10)).toBe("100.0%");
    // 非有限的 share 按 0 处理，绝不把 NaN 印在屏幕上（`share` 由
    // buildCostLedger 算出、永远有限，这条只是最后一道防线）。
    expect(formatSharePercent(Number.NaN, 0)).toBe("0.0%");
    expect(formatSharePercent(Number.NaN, 10)).toBe("<0.1%");
  });
});

describe("classUnitPrice · 单价三态（§2.4）", () => {
  it("gives the plain table rate when every priced call sits in one family", () => {
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 1_000_000 }, SONNET, T0),
      // 同档的另一个模型：family 相同，仍算一档，不该变成加权。
      call("r2", { inputTokens: 2_000_000 }, "claude-sonnet-4-20250514", T0 + 1)
    ]);

    const unit = classUnitPrice(ledger, "input");
    expect(unit.kind).toBe("rate");
    if (unit.kind !== "rate") throw new Error("unreachable");
    expect(unit.family).toBe("sonnet");
    // 单档时返回价目表原文，而不是「小计 ÷ 量」除出来的浮点数。
    expect(unit.value).toBe(classRate("sonnet", "input"));
    const line = classLineOf(ledger, "input");
    expect(unit.value).toBeCloseTo((line.usd / line.tokens) * 1_000_000, 9);
    expect(formatLedgerRate(unit.value, false)).toBe("$3.00");
  });

  it("switches to a weighted average once two price tiers share the class", () => {
    const ledger = buildCostLedger([
      // sonnet 3M × $3 = $9
      call("r1", { inputTokens: 3_000_000 }, SONNET, T0),
      // opus 0.5M × $15 = $7.5
      call("r2", { inputTokens: 500_000 }, OPUS, T0 + 1)
    ]);

    const line = classLineOf(ledger, "input");
    const unit = classUnitPrice(ledger, "input");
    expect(unit.kind).toBe("weighted");
    if (unit.kind !== "weighted") throw new Error("unreachable");
    // $16.5 / 3.5M 加权 → $4.714…
    expect(unit.value).toBeCloseTo(16.5 / 3.5, 12);
    expect(unit.value).toBeCloseTo((line.usd / line.tokens) * 1_000_000, 12);
    // 跨档必须带 ≈，这条是界面唯一的区分依据。
    expect(formatLedgerRate(unit.value, unit.kind === "weighted")).toBe("≈$4.71");
    expect(unit).not.toHaveProperty("family");
  });

  it("ignores unpriced models when deciding whether the class is single-tier", () => {
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 1_000_000 }, SONNET, T0),
      // 未定价模型的 token 不进 classes，也就不能把这一列拖成加权。
      call("r2", { inputTokens: 9_000_000 }, UNKNOWN, T0 + 1)
    ]);

    const unit = classUnitPrice(ledger, "input");
    expect(unit.kind).toBe("rate");
    expect(unit.kind === "rate" ? unit.family : null).toBe("sonnet");
    expect(formatLedgerRate(unit.kind === "rate" ? unit.value : null, false)).toBe("$3.00");
  });

  it("only counts families that actually used the class", () => {
    const ledger = buildCostLedger([
      call("r1", { inputTokens: 1_000_000, outputTokens: 1_000_000 }, SONNET, T0),
      // haiku 只用了 output：input 那一列它没有量，不该参与加权。
      call("r2", { outputTokens: 1_000_000 }, HAIKU, T0 + 1)
    ]);

    expect(classUnitPrice(ledger, "input").kind).toBe("rate");
    expect(classUnitPrice(ledger, "output").kind).toBe("weighted");
  });

  it("reports none for a class with no usage and for a ledger that could price nothing", () => {
    const singleTier = buildCostLedger([
      call("r1", { inputTokens: 1_000_000 }, SONNET, T0)
    ]);
    // 四个科目都固定存在，但没量的那一列没有单价可言。
    expect(classUnitPrice(singleTier, "cacheWrite")).toEqual({ kind: "none", value: null });

    const unpricedOnly = buildCostLedger([call("r1", { inputTokens: 9_000_000 }, UNKNOWN, T0)]);
    for (const key of LEDGER_CLASS_ORDER) {
      expect(classUnitPrice(unpricedOnly, key)).toEqual({ kind: "none", value: null });
    }

    const empty = buildCostLedger([]);
    for (const key of LEDGER_CLASS_ORDER) {
      expect(classUnitPrice(empty, key)).toEqual({ kind: "none", value: null });
      // 空态下单价格只能是 —，不能是 $0.00。
      expect(formatLedgerRate(null, false)).toBe("—");
    }
  });
});
