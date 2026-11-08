import { describe, expect, it } from "vitest";
import { buildChronicle, buildChronicleMarkdown } from "./chronicle";
import type { CompactEvent, SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import type { ToolCallFact } from "./toolCensus";
import type { ErrorSessionFacts } from "./errorStats";

/**
 * 夹具全部手造，期望值按夹具手算写在断言里——不从函数读回来当期望。
 * 时间一律用 `new Date(年, 月-1, 日, 时, 分)` 构造**本地时间**，本地日口径
 * 才有意义；`now` 固定注入，模型层不允许读当前时钟。
 */

let seq = 0;
function record(at: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function usage(
  input: number,
  output = 0,
  cacheCreation = 0,
  cacheRead = 0
): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

/** 2026 年本地时间。 */
function at(month: number, dayOfMonth: number, hour: number, minute = 0): number {
  return new Date(2026, month - 1, dayOfMonth, hour, minute).getTime();
}

function compactEvent(
  atMs: number,
  preTokens: number,
  postTokens: number,
  trigger: string | null = "auto"
): CompactEvent {
  seq += 1;
  return {
    id: `c${seq}`,
    timestamp: atMs,
    trigger,
    preTokens,
    postTokens,
    droppedTokens: preTokens - postTokens,
    durationMs: null,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null
  };
}

const NOW = at(11, 9, 12, 0); // 2026-11-09 12:00 本地
const DAYS = 30; // 窗口：2026-10-11 ~ 2026-11-09

const SONNET = "claude-sonnet-4-5-20250929";
const OPUS = "claude-opus-4-5-20251101";
const HAIKU = "claude-haiku-4-5-20251001";

/**
 * 主夹具：三个会话、三天、7 章齐活。
 *
 * - A「cc-analyzer」11-02 09:00→15:30，Sonnet，6450 token，7 条记录，3 条消息；
 * - B「web」11-05 10:00→11:00，Opus，2000 token，3 条记录，2 条消息；
 * - C「other-repo」11-03 09:00→09:30，Haiku，300000 token，3 条记录，2 条消息；
 * - 工具：Bash 4 次、Read 1 次、Grep 1 次（共 6 次）；
 * - 错误：A 里 1 条 isError 的 Bash 记录；
 * - 压缩：A 里 1 次 auto 压缩（180000 → 60000）。
 *
 * 手算合计：13 条记录、308450 token、3 个活跃日、日均 102816.67。
 */
function mainFixture(): UsageSessionInput[] {
  const a: UsageSessionInput = {
    projectLabel: "-Users-liang-Desktop-workspace-github-cc-analyzer",
    projectPath: "/Users/liang/Desktop/workspace/github/cc-analyzer",
    compactEvents: [compactEvent(at(11, 2, 14, 0), 180_000, 60_000)],
    records: [
      record(at(11, 2, 9, 0), { usage: usage(100, 50, 1000, 2000), model: SONNET }),
      record(at(11, 2, 9, 10), { kind: "user", text: "帮我看看这个仓库" }),
      record(at(11, 2, 9, 15), { kind: "tool", toolName: "Bash", toolInput: { command: "ls" } }),
      record(at(11, 2, 9, 20), { kind: "tool", toolName: "Bash", toolInput: { command: "git status" } }),
      record(at(11, 2, 9, 25), { kind: "tool", toolName: "Read", toolInput: { file_path: "a.ts" } }),
      record(at(11, 2, 9, 30), {
        kind: "tool",
        toolName: "Bash",
        isError: true,
        toolResult: "Error: ENOENT: /Users/liang/secret/project/file.ts not found"
      }),
      record(at(11, 2, 15, 30), { usage: usage(200, 100, 0, 3000), model: SONNET })
    ]
  };

  const b: UsageSessionInput = {
    projectLabel: "-Users-liang-Desktop-workspace-github-cc-analyzer-web",
    projectPath: "/Users/liang/Desktop/workspace/github/cc-analyzer/web",
    records: [
      record(at(11, 5, 10, 0), { usage: usage(1000), model: OPUS }),
      record(at(11, 5, 10, 10), { kind: "tool", toolName: "Bash", toolInput: { command: "npm test" } }),
      record(at(11, 5, 11, 0), { usage: usage(500, 0, 0, 500), model: OPUS })
    ]
  };

  const c: UsageSessionInput = {
    projectLabel: "-Users-liang-Desktop-workspace-github-other-repo",
    projectPath: "/Users/liang/Desktop/workspace/github/other-repo",
    records: [
      record(at(11, 3, 9, 0), { usage: usage(5000, 5000, 100_000, 150_000), model: HAIKU }),
      record(at(11, 3, 9, 10), { kind: "tool", toolName: "Grep", toolInput: { pattern: "TODO" } }),
      record(at(11, 3, 9, 30), { usage: usage(1000, 0, 0, 39_000), model: HAIKU })
    ]
  };

  return [a, b, c];
}

/**
 * 干净夹具：两个会话、四天记录，没有工具 / 错误 / 压缩。
 * 手算：600 token、2 个活跃日、4 条记录、日均 300。
 */
function cleanFixture(): UsageSessionInput[] {
  return [
    {
      projectLabel: "alpha",
      projectPath: "/Users/someone/work/alpha",
      records: [
        record(at(11, 6, 10, 0), { usage: usage(100), model: SONNET }),
        record(at(11, 6, 10, 10), { kind: "user", text: "好的" })
      ]
    },
    {
      projectLabel: "beta",
      projectPath: "/Users/someone/work/beta",
      records: [
        record(at(11, 7, 9, 0), { usage: usage(200), model: SONNET }),
        record(at(11, 7, 10, 0), { usage: usage(300), model: SONNET })
      ]
    }
  ];
}

function chapterById(
  chronicle: ReturnType<typeof buildChronicle>,
  id: string
) {
  const chapter = chronicle.chapters.find((item) => item.id === id);
  if (!chapter) throw new Error(`缺少章节：${id}`);
  return chapter;
}

describe("buildChronicle · 完整故事", () => {
  it("七章按固定顺序输出，编号与 kicker 连续", () => {
    const chronicle = buildChronicle(mainFixture(), DAYS, NOW);

    expect(chronicle.empty).toBe(false);
    expect(chronicle.chapters.map((chapter) => chapter.id)).toEqual([
      "opening",
      "busiest-day",
      "longest-session",
      "model-migration",
      "tool-handprint",
      "errors",
      "compaction"
    ]);
    expect(chronicle.chapters.map((chapter) => chapter.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(chronicle.chapters.map((chapter) => chapter.kicker)).toEqual([
      "第 1 章 · 起笔",
      "第 2 章 · 最忙的一天",
      "第 3 章 · 最长的一次会话",
      "第 4 章 · 模型的迁徙",
      "第 5 章 · 工具的手印",
      "第 6 章 · 错误的痕迹",
      "第 7 章 · 上下文的重置"
    ]);
  });

  it("第 1 章：3 个项目、3 个会话、3 个活跃日、308450 token", () => {
    const chapter = chapterById(buildChronicle(mainFixture(), DAYS, NOW), "opening");

    expect(chapter.title).toBe("30 天里的 3 个活跃日");
    expect(chapter.stat).toBe("308,450");
    expect(chapter.statUnit).toBe("token");
    expect(chapter.body).toBe("3 个项目、3 个会话，落在 3 个活跃日里。");
  });

  it("第 2 章：11-03 的 300000 token，日均 102816.67 → 2.9 倍", () => {
    const chapter = chapterById(buildChronicle(mainFixture(), DAYS, NOW), "busiest-day");

    expect(chapter.title).toBe("11-03 是这 30 天里最重的一天");
    expect(chapter.stat).toBe("300,000");
    expect(chapter.statUnit).toBe("token");
    expect(chapter.body).toBe(
      "11-03 这天记入了 300,000 token，来自 1 个会话；是日均的 2.9 倍。"
    );
  });

  it("第 2 章 chart：只给最近 14 天，标签 MM-DD，数值按本地日", () => {
    const chapter = chapterById(buildChronicle(mainFixture(), DAYS, NOW), "busiest-day");
    const chart = chapter.chart;

    expect(chart?.kind).toBe("bars");
    if (chart?.kind !== "bars") throw new Error("chart 不是 bars");

    expect(chart.values).toHaveLength(14);
    expect(chart.labels).toHaveLength(14);
    expect(chart.labels[0]).toBe("10-27");
    expect(chart.labels[13]).toBe("11-09");
    // 序号：0=10-27 … 6=11-02、7=11-03、9=11-05。
    expect(chart.values[6]).toBe(6450);
    expect(chart.values[7]).toBe(300_000);
    expect(chart.values[9]).toBe(2000);
    expect(chart.values[8]).toBe(0);
  });

  it("第 3 章：A 的 6h30m 跨度、项目名与 3 条消息", () => {
    const chapter = chapterById(
      buildChronicle(mainFixture(), DAYS, NOW),
      "longest-session"
    );

    expect(chapter.title).toBe("最长的一次会话在 cc-analyzer");
    expect(chapter.stat).toBe("6.5");
    expect(chapter.statUnit).toBe("小时");
    expect(chapter.body).toBe(
      "cc-analyzer 的这个会话从 11-02 起跑了 6h30m0s，里面有 3 条消息。"
    );
    // 项目名是 basename，绝不带出用户的绝对路径。
    expect(chapter.body).not.toContain("/Users/");
    expect(chapter.title).not.toContain("/Users/");
  });

  it("第 4 章：Sonnet → Opus，切换在窗口第 24 天（11-03）", () => {
    const chapter = chapterById(
      buildChronicle(mainFixture(), DAYS, NOW),
      "model-migration"
    );

    expect(chapter.title).toBe("从 Sonnet 4.5 迁到 Opus 4.5");
    expect(chapter.stat).toBe("3");
    expect(chapter.statUnit).toBe("种模型");
    expect(chapter.body).toBe(
      "切换发生在窗口第 24 天（11-03）；窗口的最后一个会话以 Opus 4.5 为主。"
    );
  });

  it("第 5 章：Bash 4 次，占 6 次调用的 67%", () => {
    const chapter = chapterById(
      buildChronicle(mainFixture(), DAYS, NOW),
      "tool-handprint"
    );

    expect(chapter.title).toBe("Bash 是你的手印");
    expect(chapter.stat).toBe("4");
    expect(chapter.statUnit).toBe("次");
    expect(chapter.body).toBe("Bash 被调用了 4 次，占全部调用的 67%，跨 2 个会话。");
  });

  it("第 6 章：13 条记录里 1 条失败，签名折叠路径", () => {
    const chapter = chapterById(buildChronicle(mainFixture(), DAYS, NOW), "errors");

    expect(chapter.title).toBe("最常见的是「Error: ENOENT: <path> not found」");
    expect(chapter.stat).toBe("1");
    expect(chapter.statUnit).toBe("条失败");
    expect(chapter.body).toBe("窗口里留下了 1 条失败，其中 1 条是同一个签名。");
    expect(chapter.body).not.toContain("/Users/");
    expect(chapter.title).not.toContain("/Users/");
  });

  it("第 7 章：1 次 auto 压缩，最近 11-02，腾出 120000 token", () => {
    const chapter = chapterById(
      buildChronicle(mainFixture(), DAYS, NOW),
      "compaction"
    );

    expect(chapter.title).toBe("上下文重置了 1 次");
    expect(chapter.stat).toBe("1");
    expect(chapter.statUnit).toBe("次");
    expect(chapter.body).toBe(
      "窗口里压缩了 1 次，最近一次在 11-02，前后腾出了 120,000 token。"
    );
  });

  it("summary 由实际数据拼出", () => {
    const chronicle = buildChronicle(mainFixture(), DAYS, NOW);

    expect(chronicle.summary).toBe(
      "这 30 天，你在 3 个项目里留下了 3 个会话；最重的一天是 11-03。"
    );
  });
});

describe("buildChronicle · 章节取舍", () => {
  it("无工具调用时省略第 5 章，后续编号重排", () => {
    const chronicle = buildChronicle(cleanFixture(), DAYS, NOW);
    const ids = chronicle.chapters.map((chapter) => chapter.id);

    expect(ids).not.toContain("tool-handprint");
    expect(ids).toEqual([
      "opening",
      "busiest-day",
      "longest-session",
      "model-migration",
      "errors",
      "compaction"
    ]);
    expect(chronicle.chapters.map((chapter) => chapter.index)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(chapterById(chronicle, "errors").kicker).toBe("第 5 章 · 错误的痕迹");
  });

  it("无错误时第 6 章写「没有留下错误」并把 0 当事实", () => {
    const chapter = chapterById(buildChronicle(cleanFixture(), DAYS, NOW), "errors");

    expect(chapter.title).toBe("没有留下错误");
    expect(chapter.stat).toBe("0");
    expect(chapter.statUnit).toBe("条失败");
    expect(chapter.body).toBe("这个窗口的 4 条记录里没有失败。");
  });

  it("无压缩时写「没有触发过上下文压缩」并给 P90（样本足够）", () => {
    const chapter = chapterById(
      buildChronicle(cleanFixture(), DAYS, NOW),
      "compaction"
    );

    expect(chapter.title).toBe("没有触发过上下文压缩");
    expect(chapter.stat).toBe("0");
    expect(chapter.statUnit).toBe("次");
    // 两会话上下文峰值 100 / 300，最近邻 P90 = 第 ceil(1.8)=2 个 = 300。
    expect(chapter.body).toBe(
      "这个窗口没有触发过上下文压缩；上下文峰值 P90 是 300 token。"
    );
  });

  it("单一模型时第 4 章写「你只用了一种模型」", () => {
    const chapter = chapterById(
      buildChronicle(cleanFixture(), DAYS, NOW),
      "model-migration"
    );

    expect(chapter.title).toBe("你只用了一种模型");
    expect(chapter.stat).toBe("1");
    expect(chapter.statUnit).toBe("种模型");
    expect(chapter.body).toBe("2 个有模型记录的会话全部落在 Sonnet 4.5 上。");
  });

  it("唯一有消耗的一天不硬算「日均倍数」", () => {
    const singleDay: UsageSessionInput[] = [
      {
        projectLabel: "alpha",
        records: [
          record(at(11, 8, 9, 0), { usage: usage(100), model: SONNET }),
          record(at(11, 8, 9, 10), { kind: "tool", toolName: "Bash" })
        ]
      }
    ];
    const chapter = chapterById(buildChronicle(singleDay, DAYS, NOW), "busiest-day");

    expect(chapter.body).toBe(
      "11-08 这天记入了 100 token，来自 1 个会话；这是窗口里唯一有消耗的一天。"
    );
  });
});

describe("buildChronicle · 空态", () => {
  it("空输入 → empty，chapters 与 summary 都为空", () => {
    expect(buildChronicle([], DAYS, NOW)).toEqual({
      chapters: [],
      summary: "",
      empty: true
    });
  });

  it("记录全部落在窗口外 → empty（窗口外的不算数）", () => {
    const stale: UsageSessionInput[] = [
      {
        projectLabel: "old",
        records: [record(at(9, 1, 10, 0), { usage: usage(9999), model: SONNET })]
      }
    ];
    expect(buildChronicle(stale, DAYS, NOW)).toEqual({
      chapters: [],
      summary: "",
      empty: true
    });
  });
});

describe("buildChronicle · 本地日与事实口径", () => {
  it("跨本地午夜按本地日归属（00:10 属于 11-04，不是 UTC 的 11-03）", () => {
    const crossed: UsageSessionInput[] = [
      {
        projectLabel: "alpha",
        records: [
          record(at(11, 3, 23, 50), { usage: usage(10), model: SONNET }),
          record(at(11, 4, 0, 10), { usage: usage(100), model: SONNET })
        ]
      }
    ];
    // 窗口 11-03 ~ 11-05；两天都有消耗，最忙的是本地 11-04。
    const chronicle = buildChronicle(crossed, 3, at(11, 5, 12, 0));
    const chapter = chapterById(chronicle, "busiest-day");

    expect(chapter.title).toBe("11-04 是这 3 天里最重的一天");
    expect(chapter.body).toBe(
      "11-04 这天记入了 100 token，来自 1 个会话；是日均的 1.8 倍。"
    );
    expect(chronicle.summary).toContain("最重的一天是 11-04");
  });

  it("有 toolCalls 事实时优先用它（含 sidechain），不从 records 重数", () => {
    const inputs = cleanFixture();
    const facts: ToolCallFact[] = [
      { key: { kind: "builtin", toolName: "Bash" }, timestamp: at(11, 6, 10, 5), sidechain: false },
      { key: { kind: "builtin", toolName: "Bash" }, timestamp: at(11, 6, 10, 6), sidechain: true },
      { key: { kind: "builtin", toolName: "Bash" }, timestamp: at(11, 6, 10, 7), sidechain: true },
      { key: { kind: "builtin", toolName: "Bash" }, timestamp: at(11, 6, 10, 8), sidechain: false },
      { key: { kind: "builtin", toolName: "Read" }, timestamp: at(11, 6, 10, 9), sidechain: false }
    ];
    inputs[0] = { ...inputs[0], toolCalls: facts };

    const chapter = chapterById(buildChronicle(inputs, DAYS, NOW), "tool-handprint");

    // records 里一条 tool 行都没有；数字全部来自 facts。
    expect(chapter.stat).toBe("4");
    expect(chapter.body).toBe(
      "Bash 被调用了 4 次，占全部调用的 80%，跨 1 个会话。"
    );
  });

  it("有 errorExtract 时优先用它，records 的 isError 不再参与", () => {
    const inputs = cleanFixture();
    const events: ErrorSessionFacts = {
      events: [
        {
          kind: "api",
          timestamp: at(11, 6, 10, 30),
          apiStatus: 500,
          recordId: null,
          path: "/Users/someone/.claude/alpha.jsonl",
          projectLabel: "alpha",
          preview: "API Error: 500 Internal Server Error"
        }
      ],
      days: new Map()
    };
    inputs[0] = { ...inputs[0], errorExtract: events };

    const chapter = chapterById(buildChronicle(inputs, DAYS, NOW), "errors");

    expect(chapter.stat).toBe("1");
    // 数字也按既有签名口径折叠：500 → <n>。
    expect(chapter.title).toBe("最常见的是「API Error: <n> Internal Server Error」");
  });
});

describe("buildChronicleMarkdown", () => {
  it("按章节顺序输出标题、大数字与正文，结尾附 summary", () => {
    const chronicle = {
      chapters: [
        {
          id: "a",
          index: 2,
          kicker: "第 2 章 · 最忙的一天",
          title: "11-03 最重",
          stat: "302,500",
          statUnit: "token",
          body: "当天有 3 个会话。",
          footnote: "按本地日聚合"
        },
        {
          id: "b",
          index: 1,
          kicker: "第 1 章 · 起笔",
          title: "从 2 个项目开始",
          stat: "63,050",
          statUnit: "token",
          body: "2 个项目、4 个会话。"
        },
        {
          id: "c",
          index: 3,
          kicker: "第 3 章 · 工具的手印",
          title: "Bash 用得最多",
          stat: "4",
          statUnit: "次",
          body: "占全部调用的 67%。"
        }
      ],
      summary: "这 30 天你在 2 个项目里留下了 4 个会话。",
      empty: false
    };
    const md = buildChronicleMarkdown(chronicle, 30);
    const first = md.indexOf("第 1 章 · 起笔");
    const second = md.indexOf("第 2 章 · 最忙的一天");
    const third = md.indexOf("第 3 章 · 工具的手印");
    // 章节按 index 排序，而不是数组顺序。
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
    expect(md).toContain("# 数据故事 · 近 30 天");
    expect(md).toContain("**302,500 token**");
    expect(md).toContain("> 按本地日聚合");
    expect(md.trimEnd().endsWith(chronicle.summary)).toBe(true);
    // 导出物会被带出本机：不得出现绝对路径。
    expect(md).not.toContain("/Users/");
    expect(md).not.toContain("/home/");
  });

  it("空故事只输出标题", () => {
    const md = buildChronicleMarkdown({ chapters: [], summary: "", empty: true }, 7);
    expect(md).toBe("# 数据故事 · 近 7 天\n");
  });
});
