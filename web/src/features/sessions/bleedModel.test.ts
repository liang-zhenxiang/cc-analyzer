import { describe, expect, it } from "vitest";
import {
  COUNT_ONLY_NOTE,
  TOOL_OUTPUT_TOP_N,
  UNNAMED_TOOL_LABEL,
  bleedHeadline,
  buildBleedReport,
  type BleedItem,
  type BleedReport
} from "./bleedModel";
import { parseJsonlText } from "./parseJsonl";
import { PRICING_AS_OF } from "../usage/pricingSnapshot";
import type { CompactEvent, ParsedSession, SessionRecord } from "./types";

import compactFixture from "../../../tests/fixtures/compact-session.jsonl?raw";
import toolCensusFixture from "../../../tests/fixtures/tool-census-session.jsonl?raw";
import pulseNoneFixture from "../../../tests/fixtures/pulse-compact-none.jsonl?raw";

/**
 * 单测口径（design §6）：① 无压缩 → 空态；② 有压缩 → 条数与 token 读数可核对；
 * ③ 未知模型 → `usd === null` 且 `unpricedCalls > 0`（本轮最重要的诚实性断言）；
 * ④ 输入缺字段不抛异常；⑤ 所有数值有限。
 *
 * 夹具全部取自既有共享夹具 `web/tests/fixtures/`，不新造。
 */

function parsedFixture(text: string, path: string): ParsedSession {
  return parseJsonlText(text, path);
}

const compactParsed = parsedFixture(compactFixture, "/tmp/compact-session.jsonl");

/** 极简记录构造器：只填被测逻辑真正读的字段。 */
function record(overrides: Partial<SessionRecord> & { fullId: string }): SessionRecord {
  return {
    id: overrides.fullId,
    kind: "assistant",
    timestamp: 0,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...overrides
  } as SessionRecord;
}

function sessionWith(records: SessionRecord[], events: CompactEvent[] = []): ParsedSession {
  return {
    sessionId: "synthetic",
    path: "/tmp/synthetic.jsonl",
    startedAt: 0,
    endedAt: 0,
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    sidechainMessages: [],
    compactEvents: events
  };
}

/** 遍历报告里的每个数值，断言全部有限——NaN/Infinity 会毁掉整页展示。 */
function everyNumberIsFinite(report: BleedReport): boolean {
  // `total` 只做分母、不展示，但它同样必须有限：它的 NaN 会顺着 shareOf 漏出去。
  const counters: Array<number | null> = [];
  for (const item of report.items) {
    counters.push(
      item.totals.input,
      item.totals.cacheCreation,
      item.totals.cacheCreationFiveMinute,
      item.totals.cacheCreationOneHour,
      item.totals.cacheRead,
      item.totals.output,
      item.totals.total,
      item.usd,
      item.unpricedCalls
    );
  }
  return counters.every((value) => value === null || Number.isFinite(value));
}

describe("buildBleedReport —— 空态与降级", () => {
  it("没有压缩事件 → compactionCount 为 0（页面走空态）", () => {
    const report = buildBleedReport(
      parsedFixture(pulseNoneFixture, "/tmp/pulse-compact-none.jsonl")
    );
    expect(report.compactionCount).toBe(0);
    expect(report.items.filter((item) => item.kind === "compaction")).toEqual([]);
    // 空态不等于「有数据的零」：结构必须完整，字段一个不少。
    expect(report.pricingAsOf).toBe(PRICING_AS_OF);
    expect(typeof report.hasEstimate).toBe("boolean");
    expect(Array.isArray(report.items)).toBe(true);
  });

  it("空会话不抛异常，返回结构完整的对象", () => {
    const report = buildBleedReport(sessionWith([]));
    expect(report).toEqual({
      items: [],
      compactionCount: 0,
      hasEstimate: false,
      pricingAsOf: PRICING_AS_OF
    });
  });

  it("缺 usage / 缺 model / 缺 sidechain 都不抛异常", () => {
    // 用 partial 断言模拟磁盘边界的残缺输入——真实解析器不会给这种形状，
    // 但调用方在数据未到位时会，降级路径必须扛住。
    const broken = {
      sessionId: "broken",
      path: "/tmp/broken.jsonl",
      records: [
        record({ fullId: "r1", usage: undefined, model: undefined }),
        record({ fullId: "r2", kind: "tool", toolName: undefined })
      ],
      turns: [],
      unmatchedToolUses: [],
      warnings: [],
      systemTurnDurations: [],
      skippedCounts: {},
      // sidechainMessages 缺失
      compactEvents: undefined
    } as unknown as ParsedSession;

    expect(() => buildBleedReport(broken)).not.toThrow();
    const report = buildBleedReport(broken);
    expect(report.compactionCount).toBe(0);
    expect(everyNumberIsFinite(report)).toBe(true);
  });

  it("compactEvents 存在但缺 usage 时仍给出结构完整的 compaction 条目", () => {
    // 边界记录指向的消息一条 usage 都没有：token 栏全 0，但「丢了 N 条」是真事实。
    const records = [
      record({ fullId: "u1", kind: "user", timestamp: 1 }),
      record({ fullId: "u2", kind: "user", timestamp: 2 })
    ];
    const event: CompactEvent = {
      id: "b1",
      timestamp: 3,
      trigger: "auto",
      preTokens: null,
      postTokens: null,
      droppedTokens: null,
      durationMs: null,
      survivedUuids: [],
      summaryText: null,
      summaryUuid: null,
      logicalParentUuid: null
    };
    const report = buildBleedReport(sessionWith(records, [event]));

    expect(report.compactionCount).toBe(1);
    const item = report.items.find((entry) => entry.kind === "compaction");
    expect(item).toBeDefined();
    expect(item?.totals.total).toBe(0);
    // 没有 usage 就没有可定价的量：未知，而不是 0 美元。
    expect(item?.usd).toBeNull();
    expect(item?.unpricedCalls).toBe(2);
    expect(everyNumberIsFinite(report)).toBe(true);
  });
});

describe("buildBleedReport —— A 类 compaction（与既有口径对齐）", () => {
  it("条数与丢出条数可核对：边界1 丢 94 条、边界2 丢 82 条", () => {
    const report = buildBleedReport(compactParsed);
    const compactions = report.items.filter((item) => item.kind === "compaction");

    expect(report.compactionCount).toBe(2);
    expect(compactions).toHaveLength(2);
    // 与 droppedMessages.test.ts:27,62-63 的既有断言同源：口径对不上说明有第二套。
    expect(compactions[0].label).toBe("压缩 #1 · 丢掉 94 条消息");
    expect(compactions[1].label).toBe("压缩 #2 · 丢掉 82 条消息");
    expect(compactions[0].recordIds).toHaveLength(94);
    expect(compactions[1].recordIds).toHaveLength(82);
    // recordIds 就是「点进去看」的证据面，必须与 bucket 的 fullId 一一对应。
    expect(compactions[0].recordIds).toContain("cs-user-000");
    expect(compactions[0].recordIds).not.toContain("cs-asst-049");
  });

  it("token 读数四类分开，且与 tokenTotalsOf(丢出的记录) 逐字一致", () => {
    const report = buildBleedReport(compactParsed);
    const first = report.items.find(
      (item) => item.kind === "compaction" && item.label.startsWith("压缩 #1")
    );

    // 夹具实测值：由 tokenTotalsOf 对同一批记录求和得出，此处锁死防口径漂移。
    expect(first?.totals).toEqual({
      input: 50948,
      cacheCreation: 117500,
      cacheCreationFiveMinute: 70500,
      cacheCreationOneHour: 47000,
      cacheRead: 3661300,
      output: 15360,
      total: 3845108
    });
    // total 只是分母，四类之和必须自洽。
    expect(first?.totals.total).toBe(
      (first?.totals.input ?? 0) +
        (first?.totals.cacheCreation ?? 0) +
        (first?.totals.cacheRead ?? 0) +
        (first?.totals.output ?? 0)
    );
  });

  it("label 里不含 droppedTokens —— 它与四类计数器单位不同，并排展示会误导", () => {
    // `droppedTokens` 是累计的**上下文窗口体积**（相邻差 = pre − post，夹具上
    // 156200 / 146600），而 totals 是**四类计费量之和**（被 cacheRead 主导，
    // 实测 3845108 / 3557870，恒差 20~24 倍）。两者不是同一个量，**不得参与
    // 任何判断或展示**——这条断言就是为了防止日后有人把它当成校验和请回来。
    const report = buildBleedReport(compactParsed);
    const droppedNumbers = ["156200", "302800", "146600"];
    for (const item of report.items) {
      for (const value of droppedNumbers) {
        expect(item.label).not.toContain(value);
      }
      expect(item.label).not.toContain("droppedTokens");
    }
  });

  it("缺 model 的 compaction 条目消费未知定价，不产生 NaN", () => {
    const records = [record({ fullId: "a1", model: undefined, usage: { inputTokens: 10 } })];
    const event: CompactEvent = {
      id: "b1",
      timestamp: 9,
      trigger: "auto",
      preTokens: 1,
      postTokens: 1,
      droppedTokens: 1,
      durationMs: 1,
      survivedUuids: [],
      summaryText: null,
      summaryUuid: null,
      logicalParentUuid: null
    };
    const report = buildBleedReport(sessionWith(records, [event]));
    const item = report.items.find((entry) => entry.kind === "compaction");

    expect(item?.usd).toBeNull();
    expect(item?.unpricedCalls).toBe(1);
    expect(everyNumberIsFinite(report)).toBe(true);
  });
});

describe("buildBleedReport —— B 类 toolOutput（裁决：只上次数，不上 token）", () => {
  it("toolOutput 的 usd 必须是 null，绝不是 0，且 evidence 为 countOnly", () => {
    // 本轮最重要的诚实性断言之一：解析器产出的 kind==="tool" 记录不带 usage
    // （parseJsonl.ts:566-581），所以「这些调用花了多少钱」在日志里不存在。
    // 计成 $0.00 就是把「不知道」冒充成「不花钱」。
    const report = buildBleedReport(parsedFixture(toolCensusFixture, "/tmp/census.jsonl"));
    const tools = report.items.filter((item) => item.kind === "toolOutput");

    expect(tools.length).toBeGreaterThan(0);
    for (const item of tools) {
      expect(item.usd).toBeNull();
      expect(item.usd).not.toBe(0);
      expect(item.evidence).toBe("countOnly");
      expect(item.totals.total).toBe(0);
      // unpricedCalls 是该组的调用数，不是 0——「全部未计入」才是事实。
      expect(item.unpricedCalls).toBe(item.recordIds.length);
      expect(item.recordIds.length).toBeGreaterThan(0);
    }
  });

  it("label 用调用次数，次数与 recordIds 长度一致", () => {
    const report = buildBleedReport(parsedFixture(toolCensusFixture, "/tmp/census.jsonl"));
    const tools = report.items.filter((item) => item.kind === "toolOutput");

    for (const item of tools) {
      // 合并项用「剩余工具 · K 类」（K 是类数），单一类别用「<工具名> · M 次调用」。
      // 两种形态都必须给出真实数字，不许出现「若干」。
      const stated = Number(item.label.match(/(\d+) (?:次调用|类)$/)?.[1]);
      expect(Number.isFinite(stated)).toBe(true);
      if (item.label.includes("次调用")) {
        expect(stated).toBe(item.recordIds.length);
      }
    }
    // 夹具里 Bash 被调用了 2 次（cen-bash-1 / cen-bash-2）。
    expect(tools.some((item) => item.label === "Bash · 2 次调用")).toBe(true);
    // 13 次调用分布在 11 类里，前 6 名之外的 5 类合并为一项。
    expect(tools).toHaveLength(TOOL_OUTPUT_TOP_N + 1);
    const tail = tools[tools.length - 1];
    expect(tail.label).toBe("剩余工具 · 5 类");
    // 合并项的证据面覆盖全部被折叠记录（每类 1 次 → 5 条）。
    expect(tail.recordIds).toHaveLength(5);
  });

  it("排序按调用次数降序 —— 不是按 totals.total（全为 0 时那是假排序）", () => {
    const records: SessionRecord[] = [];
    // 造 3 个工具，次数 1 / 5 / 3——按 total 排会退化成插入顺序，按次数排是 B > C > A。
    const push = (name: string, count: number) => {
      for (let i = 0; i < count; i += 1) {
        records.push(record({ fullId: `${name}-${i}`, kind: "tool", toolName: name }));
      }
    };
    push("Alpha", 1);
    push("Beta", 5);
    push("Gamma", 3);

    const tools = buildBleedReport(sessionWith(records)).items.filter(
      (item) => item.kind === "toolOutput"
    );
    expect(tools.map((item) => item.label)).toEqual([
      "Beta · 5 次调用",
      "Gamma · 3 次调用",
      "Alpha · 1 次调用"
    ]);
    // 所有条目 total 全为 0：证明排序确实没依赖 total。
    expect(tools.every((item) => item.totals.total === 0)).toBe(true);
  });

  it("超过 TOP_N 的类别合并为一项，K 是真实类数", () => {
    const records: SessionRecord[] = [];
    // 8 类，次数各不相同 → 前 6 名各成一档，「剩余工具 · 2 类」。
    for (let index = 0; index < 8; index += 1) {
      const name = `Tool${String.fromCharCode(65 + index)}`;
      for (let count = 0; count <= 8 - index; count += 1) {
        records.push(record({ fullId: `${name}-${count}`, kind: "tool", toolName: name }));
      }
    }

    const tools = buildBleedReport(sessionWith(records)).items.filter(
      (item) => item.kind === "toolOutput"
    );
    expect(tools).toHaveLength(TOOL_OUTPUT_TOP_N + 1);
    const tail = tools[tools.length - 1];
    expect(tail.label).toBe("剩余工具 · 2 类");
    // K 必须真实：合并项的证据面要覆盖被折叠的全部记录。
    // 次数递减构造 → 前 6 名是 ToolA..ToolF（9..4 次），
    // 尾部是 ToolG(3 次) + ToolH(2 次) = 5 条。
    expect(tail.recordIds).toHaveLength(5);
    expect(tail.usd).toBeNull();
    expect(tail.evidence).toBe("countOnly");
  });

  it("工具名缺失的记录归入「未标注工具」，不丢弃", () => {
    const records = [
      record({ fullId: "t1", kind: "tool", toolName: undefined }),
      record({ fullId: "t2", kind: "tool", toolName: "" }),
      record({ fullId: "t3", kind: "tool", toolName: "Read" })
    ];
    const tools = buildBleedReport(sessionWith(records)).items.filter(
      (item) => item.kind === "toolOutput"
    );

    const unnamed = tools.find((item) => item.label.startsWith(UNNAMED_TOOL_LABEL));
    expect(unnamed?.label).toBe(`${UNNAMED_TOOL_LABEL} · 2 次调用`);
    expect(unnamed?.recordIds).toEqual(["t1", "t2"]);
    // 一条都不许丢：3 条记录必须全部出现在证据面里。
    const covered = tools.flatMap((item) => item.recordIds);
    expect(covered.sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("非 tool 记录不进入 toolOutput 分组", () => {
    const records = [
      record({ fullId: "a1", kind: "assistant", toolName: "Read" }),
      record({ fullId: "t1", kind: "tool", toolName: "Read" })
    ];
    const tools = buildBleedReport(sessionWith(records)).items.filter(
      (item) => item.kind === "toolOutput"
    );
    expect(tools).toHaveLength(1);
    expect(tools[0].recordIds).toEqual(["t1"]);
  });
});

describe("buildBleedReport —— C 类 cacheRewrite", () => {
  it("cacheCreation 中位数为 0 → 不产出该类（不除以 0）", () => {
    // tool-census 夹具的 cacheCreation 全是 0（没写缓存），此时「2 倍于 0」
    // 不是信号。产出这一类会把每一笔普通调用都说成「缓存重写显著」。
    const report = buildBleedReport(parsedFixture(toolCensusFixture, "/tmp/census.jsonl"));
    expect(report.items.filter((item) => item.kind === "cacheRewrite")).toEqual([]);
  });

  it("没有样本时不产出该类", () => {
    const report = buildBleedReport(sessionWith([]));
    expect(report.items.filter((item) => item.kind === "cacheRewrite")).toEqual([]);
  });

  it("超过中位数 2 倍的调用被汇总，evidence 为 logged", () => {
    // 中位数 100，阈值 200：300/400 入选，50/100/100 落选。
    const cc = [50, 100, 100, 300, 400];
    const records = cc.map((value, index) =>
      record({
        fullId: `c${index}`,
        model: "claude-sonnet-4-5",
        usage: { inputTokens: 1, cacheCreationTokens: value }
      })
    );
    const report = buildBleedReport(sessionWith(records));
    const rewrite = report.items.filter((item) => item.kind === "cacheRewrite");

    expect(rewrite).toHaveLength(1);
    expect(rewrite[0].label).toBe("缓存重写 · 2 次调用");
    expect(rewrite[0].recordIds).toEqual(["c3", "c4"]);
    expect(rewrite[0].totals.cacheCreation).toBe(700);
    expect(rewrite[0].evidence).toBe("logged");
    // 这些记录有 usage 也有 model → 可定价。
    expect(rewrite[0].usd).not.toBeNull();
    expect(rewrite[0].unpricedCalls).toBe(0);
  });

  it("中位数恰为 > 0 时才启用该类（区分「没有缓存」与「缓存很小」）", () => {
    // 中位数 1，阈值 2：只有 3 入选。这条钉住 `median <= 0` 这个闸门的位置。
    const cc = [1, 1, 1, 3];
    const records = cc.map((value, index) =>
      record({
        fullId: `d${index}`,
        model: "claude-sonnet-4-5",
        usage: { inputTokens: 1, cacheCreationTokens: value }
      })
    );
    const rewrite = buildBleedReport(sessionWith(records)).items.filter(
      (item) => item.kind === "cacheRewrite"
    );
    expect(rewrite).toHaveLength(1);
    expect(rewrite[0].recordIds).toEqual(["d3"]);
  });
});

describe("buildBleedReport —— D 类计费（未知模型绝不定价为 0）", () => {
  it("未知模型 → usd === null 且 unpricedCalls > 0", () => {
    // 本轮最重要的诚实性断言。estimateCost 对未知 family 返回
    // { unknownModel: true }（pricingSnapshot.ts:53），绝不能变成 0 美元。
    const records = [
      record({
        fullId: "x1",
        model: "some-other-vendor-model",
        usage: { inputTokens: 1000, outputTokens: 500 }
      })
    ];
    const event: CompactEvent = {
      id: "b1",
      timestamp: 5,
      trigger: "auto",
      preTokens: 1,
      postTokens: 1,
      droppedTokens: 1,
      durationMs: 1,
      survivedUuids: [],
      summaryText: null,
      summaryUuid: null,
      logicalParentUuid: null
    };
    const report = buildBleedReport(sessionWith(records, [event]));
    const item = report.items.find((entry) => entry.kind === "compaction");

    expect(item?.usd).toBeNull();
    expect(item?.usd).not.toBe(0);
    expect(item?.unpricedCalls).toBeGreaterThan(0);
  });

  it("已知模型 → 真实金额，unpricedCalls 为 0", () => {
    // sonnet: input 3 / MTok。1000 input → 0.003 USD。
    const records = [
      record({
        fullId: "k1",
        model: "claude-sonnet-4-5",
        usage: { inputTokens: 1000, outputTokens: 0 }
      })
    ];
    const event: CompactEvent = {
      id: "b1",
      timestamp: 5,
      trigger: "auto",
      preTokens: 1,
      postTokens: 1,
      droppedTokens: 1,
      durationMs: 1,
      survivedUuids: [],
      summaryText: null,
      summaryUuid: null,
      logicalParentUuid: null
    };
    const item = buildBleedReport(sessionWith(records, [event])).items.find(
      (entry) => entry.kind === "compaction"
    );

    expect(item?.usd).toBeCloseTo(0.003, 10);
    expect(item?.unpricedCalls).toBe(0);
  });

  it("部分已知部分未知 → 金额是已知部分合计，且如实记未计入数", () => {
    const records = [
      record({
        fullId: "k1",
        model: "claude-sonnet-4-5",
        usage: { inputTokens: 1000 }
      }),
      record({
        fullId: "k2",
        model: "mystery-model",
        usage: { inputTokens: 5000 }
      })
    ];
    const event: CompactEvent = {
      id: "b1",
      timestamp: 5,
      trigger: "auto",
      preTokens: 1,
      postTokens: 1,
      droppedTokens: 1,
      durationMs: 1,
      survivedUuids: [],
      summaryText: null,
      summaryUuid: null,
      logicalParentUuid: null
    };
    const item = buildBleedReport(sessionWith(records, [event])).items.find(
      (entry) => entry.kind === "compaction"
    );

    // 只有 sonnet 那组的量被计入。
    expect(item?.usd).toBeCloseTo(0.003, 10);
    expect(item?.unpricedCalls).toBe(1);
  });

  it("hasEstimate 反映「是否有被定价的条目」，与 evidence 是两回事", () => {
    const priced = buildBleedReport(compactParsed);
    expect(priced.hasEstimate).toBe(true);

    // 只有 toolOutput 的会话：有 items 但一个金额都没定出来。
    const onlyTools = buildBleedReport(
      sessionWith([record({ fullId: "t1", kind: "tool", toolName: "Read" })])
    );
    expect(onlyTools.items.length).toBeGreaterThan(0);
    expect(onlyTools.hasEstimate).toBe(false);
  });

  it("pricingAsOf 取自定价快照常量", () => {
    expect(buildBleedReport(compactParsed).pricingAsOf).toBe(PRICING_AS_OF);
  });
});

describe("全库防回归断言", () => {
  /** 本仓库所有可用的会话夹具加上若干合成输入。 */
  const corpus: Array<[string, ParsedSession]> = [
    ["compact-session", compactParsed],
    ["tool-census-session", parsedFixture(toolCensusFixture, "/tmp/census.jsonl")],
    ["pulse-compact-none", parsedFixture(pulseNoneFixture, "/tmp/pulse-none.jsonl")],
    ["empty", sessionWith([])]
  ];

  it("totals.total === 0 且 evidence === logged 的条目必须为空集", () => {
    // 防回归核心：将来若有人又把「记录没有 usage」当成「0 token」并标成
    // logged 事实，这条会立刻失败。真正读自日志的条目理应有非零体积，
    // 而「读不出来」必须诚实地标成 countOnly。
    for (const [name, parsed] of corpus) {
      const offenders = buildBleedReport(parsed).items.filter(
        (item) => item.totals.total === 0 && item.evidence === "logged"
      );
      expect(offenders.map((item) => `${name}:${item.kind}:${item.label}`)).toEqual([]);
    }
  });

  it("所有数值有限（无 NaN / Infinity）", () => {
    for (const [name, parsed] of corpus) {
      const report = buildBleedReport(parsed);
      expect(everyNumberIsFinite(report), name).toBe(true);
    }
  });

  it("任何 usd 都不为 undefined，也永不为 NaN", () => {
    for (const [, parsed] of corpus) {
      for (const item of buildBleedReport(parsed).items) {
        expect(item.usd === null || Number.isFinite(item.usd)).toBe(true);
      }
    }
  });

  it("每条目都有非空 label 与 evidence，且 recordIds 无重复", () => {
    for (const [, parsed] of corpus) {
      for (const item of buildBleedReport(parsed).items) {
        expect(item.label.length).toBeGreaterThan(0);
        expect(item.label).not.toContain("undefined");
        expect(item.label).not.toContain("NaN");
        expect(["logged", "countOnly"]).toContain(item.evidence);
        expect(new Set(item.recordIds).size).toBe(item.recordIds.length);
      }
    }
  });

  it("每个 item 的四类计数器自洽（total 是分母，永远等于四类之和）", () => {
    for (const [, parsed] of corpus) {
      for (const item of buildBleedReport(parsed).items) {
        expect(item.totals.total).toBe(
          item.totals.input + item.totals.cacheCreation + item.totals.cacheRead + item.totals.output
        );
        // TTL 拆分也必须加得起来（与 tokenTotals.ts 的既有约定一致）。
        expect(item.totals.cacheCreationFiveMinute + item.totals.cacheCreationOneHour).toBe(
          item.totals.cacheCreation
        );
      }
    }
  });

  it("COUNT_ONLY_NOTE 是不含 U+FFFD 的中文说明", () => {
    expect(COUNT_ONLY_NOTE).not.toContain("\uFFFD");
    expect(COUNT_ONLY_NOTE.length).toBeGreaterThan(0);
  });
});

describe("bleedHeadline", () => {
  it("没有压缩 → 空态文案", () => {
    const report = buildBleedReport(parsedFixture(pulseNoneFixture, "/tmp/pulse-none.jsonl"));
    expect(bleedHeadline(report)).toBe("本会话没有发生压缩");
  });

  it("有压缩 → 「N 次压缩丢掉了 X 条消息」，数字可核对", () => {
    const report = buildBleedReport(compactParsed);
    // 94 + 82 = 176
    expect(bleedHeadline(report)).toBe("2 次压缩丢掉了 176 条消息");
  });

  it("有压缩但 items 为空 → 退回变体，绝不出现 undefined / 空串", () => {
    const empty: BleedReport = {
      items: [],
      compactionCount: 3,
      hasEstimate: false,
      pricingAsOf: PRICING_AS_OF
    };
    const headline = bleedHeadline(empty);
    expect(headline).not.toBe("");
    expect(headline).not.toContain("undefined");
    expect(headline).not.toContain("NaN");
    expect(headline).toBe("3 次压缩，但没有可归因的出血点");
  });

  it("有压缩但一条消息都没丢 → 说清「没丢」而不是编一个数字", () => {
    const report: BleedReport = {
      items: [
        {
          kind: "compaction",
          label: "压缩 #1 · 丢掉 0 条消息",
          totals: {
            input: 0,
            cacheCreation: 0,
            cacheCreationFiveMinute: 0,
            cacheCreationOneHour: 0,
            cacheRead: 0,
            output: 0,
            total: 0
          },
          recordIds: [],
          usd: null,
          unpricedCalls: 0,
          evidence: "logged"
        }
      ],
      compactionCount: 1,
      hasEstimate: false,
      pricingAsOf: PRICING_AS_OF
    };
    expect(bleedHeadline(report)).toBe("1 次压缩，但没有丢掉任何消息");
  });

  it("没有压缩事件时即便有 toolOutput 条目也说「没有发生压缩」", () => {
    const report = buildBleedReport(
      sessionWith([record({ fullId: "t1", kind: "tool", toolName: "Read" })])
    );
    expect(report.items.length).toBeGreaterThan(0);
    expect(bleedHeadline(report)).toBe("本会话没有发生压缩");
  });

  it("异常输入不抛异常且不产出空串", () => {
    const degenerate = { items: undefined, compactionCount: undefined } as unknown as BleedReport;
    expect(() => bleedHeadline(degenerate)).not.toThrow();
    const headline = bleedHeadline(degenerate);
    expect(headline.length).toBeGreaterThan(0);
    expect(headline).not.toContain("undefined");
  });

  it("计数为负数或非有限值时退回空态文案", () => {
    const negative = {
      items: [],
      compactionCount: -1,
      hasEstimate: false,
      pricingAsOf: PRICING_AS_OF
    } as unknown as BleedReport;
    expect(bleedHeadline(negative)).toBe("本会话没有发生压缩");
  });
});

describe("BleedItem 类型面", () => {
  it("compaction 与 cacheRewrite 是 logged，toolOutput 是 countOnly", () => {
    const report = buildBleedReport(parsedFixture(toolCensusFixture, "/tmp/census.jsonl"));
    const byKind = new Map(report.items.map((item) => [item.kind, item] as const));
    expect(byKind.get("toolOutput")?.evidence).toBe("countOnly");

    const compactReport = buildBleedReport(compactParsed);
    expect(
      compactReport.items.every(
        (item: BleedItem) => item.kind !== "compaction" || item.evidence === "logged"
      )
    ).toBe(true);
  });
});
