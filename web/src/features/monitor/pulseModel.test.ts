import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { parseJsonlText } from "../sessions/parseJsonl";
import type { CompactEvent, SessionRecord, SessionUsage } from "../sessions/types";
import { BILLING_WINDOW_MS, burnRateOf } from "../usage/billingWindow";
import {
  COMPACTION_BAND_MAX_SAMPLES,
  COMPACTION_BAND_MIN_SAMPLES,
  CONTEXT_PANEL_DEFAULT_COUNT,
  LIVE_MS,
  RECENT_ACTIVITY_WINDOW_MS,
  RECENT_MS,
  compactionBand,
  contextPanel,
  fallbackSessionTitle,
  rateBuckets,
  recentRate,
  recencyOf,
  sessionRows,
  type SessionRowInput
} from "./pulseModel";

import compactFixture from "../../../tests/fixtures/compact-session.jsonl?raw";
import noneFixture from "../../../tests/fixtures/pulse-compact-none.jsonl?raw";
import twoFixture from "../../../tests/fixtures/pulse-compact-two.jsonl?raw";
import threeFixture from "../../../tests/fixtures/pulse-compact-three.jsonl?raw";
import sixFixture from "../../../tests/fixtures/pulse-compact-six.jsonl?raw";

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** 12:05:30.250 —— 带秒和毫秒，专门验证桶对齐到整分钟。 */
const NOW = new Date(2026, 8, 24, 12, 5, 30, 250).getTime();

function localMinute(day: number, hour: number, minute: number): number {
  return new Date(2026, 8, day, hour, minute, 0, 0).getTime();
}

function usage(inputTokens: number, outputTokens = 0): SessionUsage {
  return { inputTokens, outputTokens };
}

function record(timestamp: number, tokens: SessionUsage | undefined, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `r-${timestamp}`,
    fullId: `full-${timestamp}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    usage: tokens,
    ...overrides
  } as unknown as SessionRecord;
}

function sessionMeta(path: string, mtimeMs: number, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    path,
    projectLabel: "repo-demo",
    mtimeMs,
    sizeBytes: 1024,
    hasRecords: false,
    metadataStatus: "pending",
    ...overrides
  };
}

function compactionEvents(fixture: string, path: string): CompactEvent[] {
  return parseJsonlText(fixture, path).compactEvents ?? [];
}

describe("recencyOf", () => {
  it("三档分别命中：0 / 30 分钟 / 3 小时", () => {
    expect(recencyOf(0)).toBe("live");
    // 5 分钟落在 120s < age ≤ 900s 的中间档，30 分钟已经掉出「最近」。
    expect(recencyOf(5 * 60_000)).toBe("recent");
    expect(recencyOf(30 * 60_000)).toBe("idle");
    expect(recencyOf(3 * HOUR)).toBe("idle");
  });

  // 阈值本身是常量而不是散落的字面量：改档位只需改一处，测试跟着钉死数值。
  it("阈值常量就是 120s / 900s", () => {
    expect(LIVE_MS).toBe(120_000);
    expect(RECENT_MS).toBe(900_000);
  });

  it("两个边界都取闭区间：120000/900000 仍属上一档，多 1ms 才降档", () => {
    expect(recencyOf(119_999)).toBe("live");
    expect(recencyOf(120_000)).toBe("live");
    expect(recencyOf(120_001)).toBe("recent");
    expect(recencyOf(900_000)).toBe("recent");
    expect(recencyOf(900_001)).toBe("idle");
  });

  // 日志时间戳领先本机时钟时年龄为负：会话确实刚写过，不该掉进「更早」。
  it("负年龄按「刚刚」处理（时钟偏移）", () => {
    expect(recencyOf(-5_000)).toBe("live");
  });

  // 非有限的年龄无法比较：宁可说「更早」，也不能凭 NaN 打上 live 这个事实断言。
  it("非有限年龄降级为 idle（不猜）", () => {
    expect(recencyOf(Number.NaN)).toBe("idle");
    expect(recencyOf(Number.POSITIVE_INFINITY)).toBe("idle");
  });
});

describe("rateBuckets", () => {
  it("默认 60 桶，按本地整分钟对齐，只有最后一桶 partial", () => {
    const buckets = rateBuckets([], NOW);

    expect(buckets).toHaveLength(60);
    expect(buckets[0].start).toBe(localMinute(24, 11, 6));
    expect(buckets[59].start).toBe(localMinute(24, 12, 5));
    // 每一桶的起点都落在整分钟上（秒与毫秒归零）。
    for (const bucket of buckets) {
      const date = new Date(bucket.start);
      expect([date.getSeconds(), date.getMilliseconds()]).toEqual([0, 0]);
    }
    expect(buckets.filter((bucket) => bucket.partial).map((bucket) => bucket.start)).toEqual([
      localMinute(24, 12, 5)
    ]);
  });

  it("跨分钟边界的记录归到它 timestamp 所在的那一分钟", () => {
    const buckets = rateBuckets(
      [
        record(localMinute(24, 12, 4) + 59_999, usage(10)),
        record(localMinute(24, 12, 5), usage(20)),
        // 当前这一分钟里更靠后的记录仍算进（未完成）末桶。
        record(localMinute(24, 12, 5) + 30_000, usage(30))
      ],
      NOW
    );

    expect(buckets[58]).toMatchObject({ start: localMinute(24, 12, 4), tokens: 10 });
    expect(buckets[59]).toMatchObject({ start: localMinute(24, 12, 5), tokens: 50, partial: true });
  });

  it("口径是四类 token 之和（totalsSum），缺字段按 0", () => {
    const buckets = rateBuckets(
      [
        record(NOW - 1_000, {
          inputTokens: 1,
          outputTokens: 2,
          cacheCreationTokens: 3,
          cacheReadTokens: 4
        }),
        record(NOW - 2_000, { outputTokens: 7 })
      ],
      NOW,
      1
    );

    expect(buckets).toEqual([{ start: localMinute(24, 12, 5), tokens: 17, partial: true }]);
  });

  it("没有 usage 的记录不计，窗口外的记录落在窗口外", () => {
    const buckets = rateBuckets(
      [
        record(NOW - 1_000, undefined),
        record(localMinute(24, 12, 5) - 61 * MINUTE, usage(999))
      ],
      NOW,
      1
    );

    expect(buckets[0].tokens).toBe(0);
  });

  it("空数组给 60 个零桶，null 不抛也不吞窗口", () => {
    expect(rateBuckets([], NOW).every((bucket) => bucket.tokens === 0)).toBe(true);
    const fromNull = rateBuckets(null as unknown as SessionRecord[], NOW);
    expect(fromNull).toHaveLength(60);
    expect(fromNull[59]).toMatchObject({ tokens: 0, partial: true });
  });

  it("畸形的桶数没有可画的窗口：0 / 负数 / NaN 一律空数组", () => {
    expect(rateBuckets([], NOW, 0)).toEqual([]);
    expect(rateBuckets([], NOW, -3)).toEqual([]);
    expect(rateBuckets([], NOW, Number.NaN)).toEqual([]);
  });

  it("minutes = 1 时只剩当前这一桶且必须标 partial", () => {
    expect(rateBuckets([record(NOW, usage(5))], NOW, 1)).toEqual([
      { start: localMinute(24, 12, 5), tokens: 5, partial: true }
    ]);
  });

  // 非有限时间戳一旦算进桶索引就会变成 NaN 索引；非有限计数器会把整条曲线涂成 NaN。
  it("非有限数值不吞窗口：烂时间戳跳过，烂计数器降级为 0", () => {
    const buckets = rateBuckets(
      [
        record(Number.NaN, usage(500)),
        record(Number.POSITIVE_INFINITY, usage(500)),
        record(NOW - 1_000, { inputTokens: Number.NaN, outputTokens: 12 })
      ],
      NOW,
      1
    );

    expect(buckets[0].tokens).toBe(12);
    expect(Number.isFinite(buckets[0].tokens)).toBe(true);
  });
});

describe("recentRate", () => {
  const WINDOW = 15 * MINUTE;

  it("窗口内实测：tokens / 窗口长度换算成每小时", () => {
    // 4 × 1000 token 在 15 分钟窗口里 = 4000 / 0.25h = 16000 tokens/h。
    const records = [0, 1, 2, 3].map((index) => record(NOW - index * MINUTE, usage(1_000)));
    expect(recentRate(records, NOW, WINDOW)).toBe(16_000);
  });

  it("窗口是闭区间：恰好等于下界的记录算进来，早 1ms 的不算", () => {
    expect(recentRate([record(NOW - WINDOW, usage(1_000))], NOW, WINDOW)).toBe(4_000);
    expect(recentRate([record(NOW - WINDOW - 1, usage(1_000))], NOW, WINDOW)).toBe(0);
    expect(recentRate([record(NOW, usage(1_000))], NOW, WINDOW)).toBe(4_000);
  });

  // 未来的时间戳不是这个窗口里的实测：宁可少算，也不让未发生的记录抬高读数。
  it("未来时间戳不计入", () => {
    expect(recentRate([record(NOW + 1_000, usage(1_000))], NOW, WINDOW)).toBe(0);
  });

  it("无 usage 的记录不计；空数组与 null 都是 0", () => {
    expect(recentRate([record(NOW, undefined)], NOW, WINDOW)).toBe(0);
    expect(recentRate([], NOW, WINDOW)).toBe(0);
    expect(recentRate(null as unknown as SessionRecord[], NOW, WINDOW)).toBe(0);
  });

  it("窗口长度非正或非有限时返回 0 而不是 Infinity/NaN", () => {
    const records = [record(NOW, usage(1_000))];
    expect(recentRate(records, NOW, 0)).toBe(0);
    expect(recentRate(records, NOW, -MINUTE)).toBe(0);
    expect(recentRate(records, NOW, Number.NaN)).toBe(0);
  });

  it("非有限时间戳不参与，也不污染结果", () => {
    expect(recentRate([record(Number.NaN, usage(1_000))], NOW, WINDOW)).toBe(0);
  });

  // 单位必须与 5 小时表盘一致，否则两块读数并排放会被读成同一个量。
  it("与 burnRateOf 同单位：同样消耗、同样时长 → 同一个数字", () => {
    // 45 分钟的窗口同时满足 burnRateOf 的 MIN_SAMPLE_MS（30 分钟）门槛。
    const records = [record(NOW - 20 * MINUTE, usage(30_000))];
    const rate = burnRateOf(
      {
        start: NOW - 45 * MINUTE,
        end: NOW - 45 * MINUTE + BILLING_WINDOW_MS,
        totals: { input: 30_000, output: 0, cacheCreation: 0, cacheRead: 0 },
        messages: 1
      },
      NOW
    );
    if ("insufficientSample" in rate) throw new Error("夹具窗口不足 30 分钟");

    // burnRateOf 的分母是块开始到 now；把块起点对齐窗口下界，两边就是同一个窗口。
    expect(recentRate(records, NOW, 45 * MINUTE)).toBeCloseTo(rate.tokensPerHour, 6);
  });
});

describe("contextPanel", () => {
  function compactSession() {
    const session = parseJsonlText(compactFixture, "/tmp/compact-session.jsonl");
    return {
      records: session.records,
      events: session.compactEvents ?? []
    };
  }

  it("默认只留最近 40 个样本", () => {
    const { records, events } = compactSession();
    const panel = contextPanel(records, events);

    expect(CONTEXT_PANEL_DEFAULT_COUNT).toBe(40);
    expect(panel.samples).toHaveLength(40);
    expect(panel.samples[0].uuid).toBe("cs-asst-080");
    expect(panel.samples.at(-1)?.uuid).toBe("cs-asst-119");
  });

  // 锚点先在全序列上定位再平移：否则被截掉的那次压缩会退化到窗口左边缘，
  // 画出一条并不存在的断崖（夹具里第一次压缩的崖边在索引 49，已被截掉）。
  it("锚点按截断偏移平移，窗口外的那次压缩不画", () => {
    const { records, events } = compactSession();
    const panel = contextPanel(records, events);

    expect(events).toHaveLength(2);
    expect(panel.anchors).toEqual([
      { eventId: "cs-boundary-002", beforeIndex: 9, afterIndex: 10 }
    ]);
    expect(panel.samples[panel.anchors[0].beforeIndex].uuid).toBe("cs-asst-089");
    expect(panel.samples[panel.anchors[0].afterIndex].uuid).toBe("cs-asst-090");
  });

  it("样本不足 count 时全取，锚点索引保持不变", () => {
    const { records, events } = compactSession();
    const panel = contextPanel(records, events, 120);

    expect(panel.samples).toHaveLength(120);
    expect(panel.anchors).toEqual([
      { eventId: "cs-boundary-001", beforeIndex: 49, afterIndex: 50 },
      { eventId: "cs-boundary-002", beforeIndex: 89, afterIndex: 90 }
    ]);
  });

  it("count = 0 → 空窗口；count 非有限 → 回落默认 40", () => {
    const { records, events } = compactSession();

    expect(contextPanel(records, events, 0)).toEqual({ samples: [], anchors: [] });
    expect(contextPanel(records, events, Number.NaN).samples).toHaveLength(40);
  });

  it("空数组与 null 给空面板", () => {
    expect(contextPanel([], [])).toEqual({ samples: [], anchors: [] });
    expect(
      contextPanel(null as unknown as SessionRecord[], null as unknown as CompactEvent[])
    ).toEqual({ samples: [], anchors: [] });
  });
});

describe("compactionBand", () => {
  it("自动压缩 0 次 → 无带（insufficient n=0）", () => {
    const events = compactionEvents(noneFixture, "/tmp/pulse-compact-none.jsonl");
    expect(events).toHaveLength(0);
    expect(compactionBand(events)).toEqual({ insufficient: true, n: 0 });
  });

  it("自动压缩 2 次 → 样本不足（insufficient n=2）", () => {
    const events = compactionEvents(twoFixture, "/tmp/pulse-compact-two.jsonl");
    expect(events.map((event) => event.preTokens)).toEqual([100000, 120000]);
    expect(compactionBand(events)).toEqual({ insufficient: true, n: 2 });
  });

  it("自动压缩 3 次 → 画出 [min, max]，手动压缩与 null 事件不进样本", () => {
    const events = compactionEvents(threeFixture, "/tmp/pulse-compact-three.jsonl");

    // 夹具里另有 1 次 manual（preTokens 999999）和 1 次 preTokens 缺失的 auto。
    expect(events).toHaveLength(5);
    expect(events.filter((event) => event.trigger === "manual")).toHaveLength(1);
    expect(compactionBand(events)).toEqual({ min: 100000, max: 200000, n: 3 });
  });

  it("自动压缩 6 次 → 只取最近 5 次（最老那次被挤掉）", () => {
    const events = compactionEvents(sixFixture, "/tmp/pulse-compact-six.jsonl");
    expect(events.map((event) => event.preTokens)).toEqual([
      100000, 110000, 120000, 130000, 140000, 650000
    ]);

    // 全历史 min 是 100000；参考带只认最近 5 次，所以 min 必须是 110000。
    expect(compactionBand(events)).toEqual({ min: 110000, max: 650000, n: 5 });
    expect(COMPACTION_BAND_MAX_SAMPLES).toBe(5);
  });

  it("manual 与 preTokens = null 一律不计（只有它们时就是 n=0）", () => {
    const manual = compactionEvents(threeFixture, "/tmp/pulse-compact-three.jsonl").filter(
      (event) => event.trigger !== "auto"
    );
    expect(manual).toHaveLength(1);
    expect(compactionBand(manual)).toEqual({ insufficient: true, n: 0 });

    const manualNoise: CompactEvent[] = [
      { ...manual[0], id: "manual-1", preTokens: 10 },
      { ...manual[0], id: "manual-2", preTokens: 20 },
      { ...manual[0], id: "manual-3", preTokens: 30 }
    ];
    expect(compactionBand(manualNoise)).toEqual({ insufficient: true, n: 0 });
  });

  it("非有限的 preTokens 会污染 min/max，按「没有这个数」丢掉", () => {
    const base = compactionEvents(twoFixture, "/tmp/pulse-compact-two.jsonl")[0];
    const events: CompactEvent[] = [
      { ...base, id: "b-1", preTokens: 100_000 },
      { ...base, id: "b-2", preTokens: 120_000 },
      { ...base, id: "b-3", preTokens: Number.NaN },
      { ...base, id: "b-4", preTokens: Number.POSITIVE_INFINITY }
    ];

    expect(compactionBand(events)).toEqual({ insufficient: true, n: 2 });
  });

  it("空数组与 null 都是「无带」，n 至少报 0", () => {
    expect(compactionBand([])).toEqual({ insufficient: true, n: 0 });
    expect(compactionBand(null as unknown as CompactEvent[])).toEqual({
      insufficient: true,
      n: 0
    });
    expect(COMPACTION_BAND_MIN_SAMPLES).toBe(3);
  });
});

describe("sessionRows", () => {
  it("只留 5 小时内活动的会话，按最近活动倒序，并给出年龄与新近度", () => {
    const rows = sessionRows(
      [
        { session: sessionMeta("/p/a.jsonl", NOW - 3 * MINUTE), records: [] },
        { session: sessionMeta("/p/b.jsonl", NOW - 3 * HOUR), records: [] },
        { session: sessionMeta("/p/c.jsonl", NOW - 60_000), records: [] },
        { session: sessionMeta("/p/old.jsonl", NOW - 6 * HOUR), records: [] }
      ],
      NOW
    );

    expect(rows.map((row) => row.path)).toEqual(["/p/c.jsonl", "/p/a.jsonl", "/p/b.jsonl"]);
    expect(rows.map((row) => row.ageMs)).toEqual([60_000, 3 * MINUTE, 3 * HOUR]);
    expect(rows.map((row) => row.recency)).toEqual(["live", "recent", "idle"]);
  });

  it("活跃窗口就是 5 小时，边界含在内", () => {
    expect(RECENT_ACTIVITY_WINDOW_MS).toBe(5 * HOUR);
    expect(RECENT_ACTIVITY_WINDOW_MS).toBe(BILLING_WINDOW_MS);

    const rows = sessionRows(
      [
        { session: sessionMeta("/p/edge.jsonl", NOW - RECENT_ACTIVITY_WINDOW_MS), records: [] },
        {
          session: sessionMeta("/p/just-outside.jsonl", NOW - RECENT_ACTIVITY_WINDOW_MS - 1),
          records: []
        }
      ],
      NOW
    );

    expect(rows.map((row) => row.path)).toEqual(["/p/edge.jsonl"]);
  });

  // 活跃会话必然是 pending 元数据：拿不到 sessionId，id 只能从 <sessionId>.jsonl 的文件名取。
  it("没有标题时退回「项目标签 · 会话 id 前 8 位」", () => {
    const rows = sessionRows(
      [
        {
          session: sessionMeta("/p/ab12cd34-1234-5678-9abc-def012345678.jsonl", NOW),
          records: []
        }
      ],
      NOW
    );

    expect(rows[0].title).toBe("repo-demo · ab12cd34");
    expect(
      fallbackSessionTitle(sessionMeta("/p/ab12cd34-1234.jsonl", NOW, { sessionId: "deadbeef01" }))
    ).toBe("repo-demo · deadbeef");
  });

  it("头部解析出的标题优先；空白标题视为没有", () => {
    const rows = sessionRows(
      [
        { session: sessionMeta("/p/a.jsonl", NOW), records: [], title: "修复登录" },
        { session: sessionMeta("/p/b.jsonl", NOW), records: [], title: "   " }
      ],
      NOW
    );

    expect(rows.map((row) => row.title)).toEqual(["修复登录", "repo-demo · b"]);
  });

  it("已补全的元数据里有真标题时用标题，不退回 id", () => {
    const rows = sessionRows(
      [
        {
          session: sessionMeta("/p/a.jsonl", NOW, { aiTitle: "整理解析层", metadataStatus: "complete" }),
          records: []
        }
      ],
      NOW
    );

    expect(rows[0].title).toBe("整理解析层");
  });

  it("活动时间取 mtime 与记录时间戳的较大者", () => {
    const rows = sessionRows(
      [
        {
          // mtime 落后于最后一次写入：排序要用更新的记录时间。
          session: sessionMeta("/p/a.jsonl", NOW - 4 * HOUR),
          records: [record(NOW - MINUTE, usage(10))]
        },
        {
          // mtime 更新（归档/同步过的会话）：以 mtime 为准。
          session: sessionMeta("/p/b.jsonl", NOW - 2 * MINUTE),
          records: [record(NOW - 3 * HOUR, usage(10))]
        }
      ],
      NOW
    );

    expect(rows.map((row) => row.path)).toEqual(["/p/a.jsonl", "/p/b.jsonl"]);
    expect(rows.map((row) => row.ageMs)).toEqual([MINUTE, 2 * MINUTE]);
  });

  it("未来时间戳夹到 ageMs = 0 且算 live，行不能因为时钟偏移消失", () => {
    const rows = sessionRows(
      [{ session: sessionMeta("/p/a.jsonl", NOW), records: [record(NOW + 5_000, usage(10))] }],
      NOW
    );

    expect(rows[0]).toMatchObject({ ageMs: 0, recency: "live", lastActivityMs: NOW + 5_000 });
  });

  it("时间相同时按路径排序（两次列表顺序不同不能让行跳）", () => {
    const rows = sessionRows(
      [
        { session: sessionMeta("/p/b.jsonl", NOW - MINUTE), records: [] },
        { session: sessionMeta("/p/a.jsonl", NOW - MINUTE), records: [] }
      ],
      NOW
    );

    expect(rows.map((row) => row.path)).toEqual(["/p/a.jsonl", "/p/b.jsonl"]);
  });

  it("时间全不可读的会话不列；空数组与 null 给空列表", () => {
    expect(
      sessionRows(
        [
          {
            session: sessionMeta("/p/broken.jsonl", Number.NaN),
            records: [record(Number.NaN, usage(10))]
          }
        ],
        NOW
      )
    ).toEqual([]);
    expect(sessionRows([], NOW)).toEqual([]);
    expect(sessionRows(null as unknown as SessionRowInput[], NOW)).toEqual([]);
  });

  it("now 非有限时给空列表（没有可比较的「此刻」）", () => {
    expect(sessionRows([{ session: sessionMeta("/p/a.jsonl", NOW), records: [] }], Number.NaN)).toEqual(
      []
    );
  });
});
