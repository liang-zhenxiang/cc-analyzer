import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { parseJsonlText } from "../sessions/parseJsonl";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { extractToolCalls } from "./toolCensus";
import { dayStartOf, type UsageSessionInput } from "./usageAggregations";
import {
  MILESTONE_TIER_TABLE,
  firstsOf,
  historyFactsOf,
  milestonesOf,
  recordsOf,
  tiersOf,
  type HistoryFacts,
  type MilestoneMetric
} from "./milestones";

/**
 * 里程碑数据层契约（Issue #214，design.md §3）：档位表逐条钉死、并列取时间更早、
 * 畸形输入不当 0、全空返回空清单、首次类无原料则缺席。
 *
 * 期望值全部手算或从夹具现算——时刻一律写成 UTC ISO 字符串，日期断言一律经
 * `dayStartOf` 折算到本地天，测试因此不随运行机器时区漂移。
 */

const NOW = Date.parse("2026-05-01T12:00:00.000Z");
const AT = (iso: string): number => Date.parse(iso);

let recordSeq = 0;

function rec(overrides: Partial<SessionRecord> & { timestamp: number }): SessionRecord {
  recordSeq += 1;
  return {
    id: `rec-${recordSeq}`,
    fullId: `rec-${recordSeq}`,
    kind: "assistant",
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...overrides
  };
}

function usage(input: number, output: number, cacheCreation = 0, cacheRead = 0): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

function metaOf(pathValue: string, projectLabel: string, extra: Partial<SessionMeta> = {}): SessionMeta {
  return { path: pathValue, projectLabel, mtimeMs: 0, sizeBytes: 0, hasRecords: false, ...extra };
}

function inputOf(options: {
  records: SessionRecord[];
  projectLabel?: string;
  projectPath?: string;
  compactEvents?: UsageSessionInput["compactEvents"];
  toolCalls?: UsageSessionInput["toolCalls"];
  session?: SessionMeta;
}): UsageSessionInput {
  return {
    records: options.records,
    projectLabel: options.projectLabel ?? "-repo-demo",
    projectPath: options.projectPath,
    compactEvents: options.compactEvents,
    toolCalls: options.toolCalls,
    session: options.session
  };
}

/** 零值事实：手搓 `HistoryFacts` 的底座（只覆写被测的那一项）。 */
const EMPTY_FACTS: HistoryFacts = {
  tokens: 0,
  sessionCount: 0,
  messages: 0,
  compactions: 0,
  projects: [],
  models: [],
  tools: [],
  days: [],
  earliestSession: null,
  firstCompaction: null,
  firstSubagent: null,
  firstSkill: null,
  firstMcp: null,
  tokenRecord: null,
  durationRecord: null,
  compactionRecord: null
};

/** 把某个指标的当前值摆成 `value`（集合类用长度占位，元素内容无关）。 */
function factsWithMetric(metric: MilestoneMetric, value: number): HistoryFacts {
  const base = { ...EMPTY_FACTS };
  switch (metric) {
    case "tokens":
      base.tokens = value;
      break;
    case "sessions":
      base.sessionCount = value;
      break;
    case "messages":
      base.messages = value;
      break;
    case "compactions":
      base.compactions = value;
      break;
    case "projects":
      base.projects = Array.from({ length: value }, (_, index) => `project-${index}`);
      break;
    case "models":
      base.models = Array.from({ length: value }, (_, index) => `model-${index}`);
      break;
    case "tools":
      base.tools = Array.from({ length: value }, (_, index) => `tool-${index}`);
      break;
  }
  return base;
}

function tierOf(facts: HistoryFacts, metric: MilestoneMetric) {
  const tier = tiersOf(facts).find((item) => item.metric === metric);
  if (!tier) throw new Error(`档位表缺 ${metric}`);
  return tier;
}

describe("historyFactsOf", () => {
  it("空输入：全部事实为零，极值与首次都是 null", () => {
    const facts = historyFactsOf([]);
    expect(facts).toEqual(EMPTY_FACTS);
  });

  it("正常：一次遍历折出累计值、集合、最早会话与单会话极值", () => {
    const a = metaOf("/repo/a/s1.jsonl", "-repo-a", { cwd: "/repo/a" });
    const b = metaOf("/repo/b/s2.jsonl", "-repo-b", { cwd: "/repo/b" });
    const facts = historyFactsOf([
      inputOf({
        records: [
          rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), kind: "user" }),
          rec({ timestamp: AT("2026-03-01T10:00:10.000Z"), usage: usage(100, 10), model: "claude-sonnet-4-5" })
        ],
        projectLabel: "-repo-a",
        projectPath: "/repo/a",
        session: a
      }),
      inputOf({
        records: [
          rec({ timestamp: AT("2026-03-02T10:00:00.000Z"), kind: "user" }),
          rec({ timestamp: AT("2026-03-02T11:00:00.000Z"), usage: usage(900, 90), model: "claude-opus-4-1" }),
          rec({ timestamp: AT("2026-03-02T11:00:05.000Z"), usage: usage(200, 20), model: "claude-opus-4-1" })
        ],
        projectLabel: "-repo-b",
        projectPath: "/repo/b",
        session: b
      })
    ]);

    expect(facts.sessionCount).toBe(2);
    // 2 条 user（每会话各 1）+ 3 条 assistant。
    expect(facts.messages).toBe(5);
    expect(facts.tokens).toBe(100 + 10 + 900 + 90 + 200 + 20);
    expect(facts.projects).toEqual(["-repo-a", "-repo-b"]);
    expect(facts.models).toEqual(["claude-opus-4-1", "claude-sonnet-4-5"]);
    expect(facts.days).toEqual([
      dayStartOf(AT("2026-03-01T10:00:00.000Z")),
      dayStartOf(AT("2026-03-02T10:00:00.000Z"))
    ]);

    // 最早会话是 3-01 那个；它同时也是最长时长记录（3-01 只有 10 秒，故不是）。
    expect(facts.earliestSession?.ref.path).toBe("/repo/a/s1.jsonl");
    expect(facts.tokenRecord?.ref.path).toBe("/repo/b/s2.jsonl");
    expect(facts.tokenRecord?.tokens).toBe(1210);
    // 时长 = 末条 − 首条（与 dayReviewOf 的区间同口径）。
    expect(facts.durationRecord?.ref.path).toBe("/repo/b/s2.jsonl");
    expect(facts.durationRecord?.durationMs).toBe(
      AT("2026-03-02T11:00:05.000Z") - AT("2026-03-02T10:00:00.000Z")
    );
  });

  it("重复路径按 sessionKeyOf 合并：会话数不翻倍，账合到同一条", () => {
    const session = metaOf("/repo/a/s1.jsonl", "-repo-a", { cwd: "/repo/a" });
    const facts = historyFactsOf([
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), usage: usage(100, 0) })],
        session
      }),
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T10:05:00.000Z"), usage: usage(400, 0) })],
        session
      })
    ]);

    expect(facts.sessionCount).toBe(1);
    expect(facts.tokens).toBe(500);
    expect(facts.messages).toBe(2);
    expect(facts.tokenRecord?.tokens).toBe(500);
    expect(facts.earliestSession?.firstAt).toBe(AT("2026-03-01T10:00:00.000Z"));
    expect(facts.earliestSession?.lastAt).toBe(AT("2026-03-01T10:05:00.000Z"));
  });

  it("无元数据的输入按数组位置分行，标题退回项目标签", () => {
    const facts = historyFactsOf([
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), usage: usage(1, 0) })],
        projectLabel: "-repo-x"
      }),
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), usage: usage(1, 0) })],
        projectLabel: "-repo-y"
      })
    ]);

    expect(facts.sessionCount).toBe(2);
    expect(facts.earliestSession?.ref).toEqual({
      path: "",
      title: "-repo-x",
      projectLabel: "-repo-x",
      projectPath: undefined
    });
  });

  it("畸形 token 不当 0：非有限 / 负值的记录不计 token，但仍算消息", () => {
    const facts = historyFactsOf([
      inputOf({
        records: [
          rec({
            timestamp: AT("2026-03-01T10:00:00.000Z"),
            kind: "user",
            usage: usage(Number.NaN, 10)
          }),
          rec({
            timestamp: AT("2026-03-01T10:01:00.000Z"),
            kind: "user",
            usage: usage(-5, 10)
          }),
          rec({
            timestamp: AT("2026-03-01T10:02:00.000Z"),
            kind: "user",
            usage: usage(7, Number.POSITIVE_INFINITY)
          }),
          rec({ timestamp: AT("2026-03-01T10:03:00.000Z"), kind: "user", usage: usage(100, 0) })
        ]
      })
    ]);

    // 只有最后一条进了 token 账（100），三条畸形一条都没被当成 0 混进去。
    expect(facts.tokens).toBe(100);
    expect(facts.messages).toBe(4);
    expect(facts.tokenRecord?.tokens).toBe(100);
    // 非有限的计数器也会被极值的分母抖到——这里断言没有被低估成 0 的假读数。
    expect(facts.tokenRecord?.ref.title).toBe("-repo-demo");
  });

  it("非有限时间戳整条记录跳过：不计消息、不计天数、不进首次", () => {
    const facts = historyFactsOf([
      inputOf({
        records: [
          rec({ timestamp: Number.NaN, kind: "user", usage: usage(999, 0) }),
          rec({ timestamp: AT("2026-03-05T10:00:00.000Z"), kind: "user", usage: usage(10, 0) })
        ],
        compactEvents: [{ id: "e", timestamp: Number.NaN } as never]
      })
    ]);

    expect(facts.messages).toBe(1);
    expect(facts.tokens).toBe(10);
    expect(facts.days).toEqual([dayStartOf(AT("2026-03-05T10:00:00.000Z"))]);
    expect(facts.compactions).toBe(0);
    expect(facts.firstCompaction).toBeNull();
    expect(facts.earliestSession?.firstAt).toBe(AT("2026-03-05T10:00:00.000Z"));
  });

  it("首条有效记录晚于末条的乱序记录：跨度仍取两端", () => {
    const facts = historyFactsOf([
      inputOf({
        records: [
          rec({ timestamp: AT("2026-03-01T10:10:00.000Z"), usage: usage(1, 0) }),
          rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), usage: usage(1, 0) })
        ]
      })
    ]);

    expect(facts.durationRecord?.durationMs).toBe(10 * 60 * 1000);
    expect(facts.earliestSession?.dayStart).toBe(dayStartOf(AT("2026-03-01T10:00:00.000Z")));
  });

  it("全是非有限时间戳：会话仍计数，但最早会话为 null、天集合为空", () => {
    const facts = historyFactsOf([
      inputOf({
        records: [
          rec({ timestamp: Number.NaN, usage: usage(10, 0) }),
          rec({ timestamp: Number.NEGATIVE_INFINITY, usage: usage(10, 0) })
        ]
      })
    ]);

    expect(facts.sessionCount).toBe(1);
    expect(facts.messages).toBe(0);
    expect(facts.tokens).toBe(0);
    expect(facts.days).toEqual([]);
    expect(facts.earliestSession).toBeNull();
    // 一条可定位的记录都没有 → 首次类一枚都发不出来。
    expect(milestonesOf([inputOf({ records: [rec({ timestamp: Number.NaN })] })], NOW).firsts).toEqual(
      []
    );
  });
});

describe("tiersOf", () => {
  it("档位表照 design §3.3 逐条写死", () => {
    expect(MILESTONE_TIER_TABLE).toEqual([
      {
        metric: "tokens",
        label: "累计 token",
        unit: "token",
        tiers: [1_000_000, 10_000_000, 100_000_000, 1_000_000_000]
      },
      { metric: "sessions", label: "累计会话数", unit: "个", tiers: [1, 10, 100, 1000] },
      { metric: "messages", label: "累计消息数", unit: "条", tiers: [100, 1_000, 10_000, 100_000] },
      { metric: "projects", label: "涉及项目数", unit: "个", tiers: [1, 5, 10, 25] },
      { metric: "models", label: "用过模型数", unit: "个", tiers: [1, 3, 5] },
      { metric: "compactions", label: "累计压缩次数", unit: "次", tiers: [1, 10, 100] },
      { metric: "tools", label: "工具种类数", unit: "种", tiers: [1, 5, 15] }
    ]);
  });

  it("每档两侧各一例：正好达成算达成，差一点算没达成", () => {
    for (const spec of MILESTONE_TIER_TABLE) {
      spec.tiers.forEach((threshold, index) => {
        const reached = tierOf(factsWithMetric(spec.metric, threshold), spec.metric);
        expect({ metric: spec.metric, threshold, reachedIndex: reached.reachedIndex }).toEqual({
          metric: spec.metric,
          threshold,
          reachedIndex: index
        });
        expect(reached.current).toBe(threshold);
        expect(reached.next).toBe(spec.tiers[index + 1] ?? null);

        const below = tierOf(factsWithMetric(spec.metric, threshold - 1), spec.metric);
        expect(below.reachedIndex).toBe(index - 1);
        expect(below.next).toBe(threshold);
        expect(below.distanceToNext).toBe(1);
      });
    }
  });

  it("已达最高档：next 与 distanceToNext 都是 null；一档未达为 −1", () => {
    for (const spec of MILESTONE_TIER_TABLE) {
      const top = tierOf(factsWithMetric(spec.metric, spec.tiers[spec.tiers.length - 1]), spec.metric);
      expect(top.reachedIndex).toBe(spec.tiers.length - 1);
      expect(top.next).toBeNull();
      expect(top.distanceToNext).toBeNull();

      const beyond = tierOf(
        factsWithMetric(spec.metric, spec.tiers[spec.tiers.length - 1] * 4),
        spec.metric
      );
      expect(beyond.reachedIndex).toBe(spec.tiers.length - 1);
      expect(beyond.distanceToNext).toBeNull();

      const none = tierOf(factsWithMetric(spec.metric, spec.tiers[0] - 1), spec.metric);
      expect(none.reachedIndex).toBe(-1);
      expect(none.next).toBe(spec.tiers[0]);
      expect(none.distanceToNext).toBe(spec.tiers[0] - (spec.tiers[0] - 1));
    }
  });

  it("每项都给 current / reachedIndex / next / distanceToNext，条数与常量表一致", () => {
    const tiers = tiersOf(factsWithMetric("tokens", 5_500_000));
    expect(tiers).toHaveLength(MILESTONE_TIER_TABLE.length);
    const tokenTier = tierOf(factsWithMetric("tokens", 5_500_000), "tokens");
    expect(tokenTier).toMatchObject({
      current: 5_500_000,
      reachedIndex: 0,
      next: 10_000_000,
      distanceToNext: 4_500_000
    });
  });
});

describe("firstsOf", () => {
  it("原料不存在就不产出这枚（不是产出成未达成）", () => {
    const facts = historyFactsOf([
      inputOf({ records: [rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), kind: "user" })] })
    ]);
    const firsts = firstsOf(facts);
    expect(firsts.map((entry) => entry.kind)).toEqual(["session"]);
    expect(firsts.some((entry) => entry.kind === "skill")).toBe(false);
    expect(firsts.some((entry) => entry.kind === "mcp")).toBe(false);
  });

  it("空事实 → 空清单（不报错）", () => {
    expect(firstsOf(EMPTY_FACTS)).toEqual([]);
  });

  it("首次类按会话 → 压缩 → 子 agent → skill → MCP 排序，且各带那天的天键", () => {
    const session = metaOf("/repo/a/s1.jsonl", "-repo-a", { cwd: "/repo/a" });
    const facts = historyFactsOf([
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T09:00:00.000Z"), kind: "user" })],
        compactEvents: [{ id: "e1", timestamp: AT("2026-03-01T09:01:00.000Z") } as never],
        toolCalls: [
          { key: { kind: "skill", skillName: "git-commit" }, timestamp: AT("2026-03-01T09:03:00.000Z"), sidechain: false },
          { key: { kind: "mcp", server: "demo", toolName: "query" }, timestamp: AT("2026-03-01T09:04:00.000Z"), sidechain: false },
          { key: { kind: "subagent", subagentType: "explore" }, timestamp: AT("2026-03-01T09:05:00.000Z"), sidechain: false }
        ],
        session
      })
    ]);

    const firsts = firstsOf(facts);
    expect(firsts.map((entry) => entry.kind)).toEqual(["session", "compaction", "subagent", "skill", "mcp"]);
    expect(firsts.map((entry) => entry.label)).toEqual([
      "第一次会话",
      "第一次压缩",
      "第一次用子 agent",
      "第一次用 skill",
      "第一次用 MCP 工具"
    ]);
    expect(firsts.map((entry) => entry.at)).toEqual([
      AT("2026-03-01T09:00:00.000Z"),
      AT("2026-03-01T09:01:00.000Z"),
      AT("2026-03-01T09:05:00.000Z"),
      AT("2026-03-01T09:03:00.000Z"),
      AT("2026-03-01T09:04:00.000Z")
    ]);
    for (const entry of firsts) {
      expect(entry.dayStart).toBe(dayStartOf(AT("2026-03-01T09:00:00.000Z")));
      expect(entry.session.path).toBe("/repo/a/s1.jsonl");
    }
  });

  it("跨会话的首次取更早那一刻（不是数组顺序里的第一个）", () => {
    const late = metaOf("/repo/late/s.jsonl", "-repo-late");
    const early = metaOf("/repo/early/s.jsonl", "-repo-early");
    const skillAt = (timestamp: number) => ({
      key: { kind: "skill", skillName: "x" } as const,
      timestamp,
      sidechain: false
    });
    const facts = historyFactsOf([
      inputOf({
        records: [rec({ timestamp: AT("2026-03-02T10:00:00.000Z") })],
        toolCalls: [skillAt(AT("2026-03-02T10:01:00.000Z"))],
        session: late
      }),
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T10:00:00.000Z") })],
        toolCalls: [skillAt(AT("2026-03-01T10:01:00.000Z"))],
        session: early
      })
    ]);

    const skill = firstsOf(facts).find((entry) => entry.kind === "skill");
    expect(skill?.at).toBe(AT("2026-03-01T10:01:00.000Z"));
    expect(skill?.session.path).toBe("/repo/early/s.jsonl");
  });

  it("同一会话里两次同类调用：detail 是更早那一次的名字（名字跟着时刻一起赢）", () => {
    const skillCall = (skillName: string, timestamp: number) => ({
      key: { kind: "skill", skillName } as const,
      timestamp,
      sidechain: false
    });
    // 数组顺序刻意与时间相反：晚的那次先出现。只记时刻、名字另取的话，这里会
    // 得到「09:10 的时刻 + 09:30 的名字」这种自相矛盾的一对。
    const facts = historyFactsOf([
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T09:00:00.000Z") })],
        toolCalls: [
          skillCall("z-late-name", AT("2026-03-01T09:30:00.000Z")),
          skillCall("a-early-name", AT("2026-03-01T09:10:00.000Z"))
        ]
      })
    ]);

    const skill = firstsOf(facts).find((entry) => entry.kind === "skill");
    expect(skill?.at).toBe(AT("2026-03-01T09:10:00.000Z"));
    expect(skill?.detail).toBe("a-early-name");
  });

  it("跨会话并列的那一刻也带上同一次调用的名字", () => {
    const skillAt = (skillName: string, timestamp: number) => ({
      key: { kind: "skill", skillName } as const,
      timestamp,
      sidechain: false
    });
    const at = AT("2026-03-01T10:01:00.000Z");
    const facts = historyFactsOf([
      inputOf({
        records: [rec({ timestamp: at })],
        toolCalls: [skillAt("from-z-session", at)],
        session: metaOf("/repo/z/s.jsonl", "-repo-z")
      }),
      inputOf({
        records: [rec({ timestamp: at })],
        toolCalls: [skillAt("from-a-session", at)],
        session: metaOf("/repo/a/s.jsonl", "-repo-a")
      })
    ]);

    // 并列按会话键裁决（更小的键赢），赢的是整个 moment——名字与时刻同一份。
    const skill = firstsOf(facts).find((entry) => entry.kind === "skill");
    expect(skill?.session.path).toBe("/repo/a/s.jsonl");
    expect(skill?.detail).toBe("from-a-session");
  });

  it("MCP 的 detail 写成 `server/tool`（工具身份仍是 censusKeyId 的 `mcp:server`）", () => {
    const facts = historyFactsOf([
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T09:00:00.000Z") })],
        toolCalls: [
          { key: { kind: "mcp", server: "docs", toolName: "search" } as const, timestamp: AT("2026-03-01T09:01:00.000Z"), sidechain: false }
        ]
      })
    ]);

    expect(firstsOf(facts).find((entry) => entry.kind === "mcp")?.detail).toBe("docs/search");
    expect(facts.tools).toEqual(["mcp:docs"]);
  });
});

describe("recordsOf", () => {
  it("值 + 会话定位（path / 标题 / 日期）", () => {
    const session = metaOf("/repo/a/s1.jsonl", "-repo-a", {
      cwd: "/repo/a",
      sessionId: "abcdefghijkl",
      aiTitle: "重构解析层"
    });
    const facts = historyFactsOf([
      inputOf({
        records: [
          rec({ timestamp: AT("2026-03-01T09:00:00.000Z"), kind: "user" }),
          rec({ timestamp: AT("2026-03-01T09:30:00.000Z"), kind: "user", usage: usage(1000, 100) })
        ],
        compactEvents: [{ id: "e", timestamp: AT("2026-03-01T09:10:00.000Z") } as never],
        session
      })
    ]);

    const records = recordsOf(facts);
    expect(records.map((entry) => entry.kind)).toEqual(["tokens", "duration", "compactions"]);
    expect(records.map((entry) => entry.label)).toEqual([
      "单会话最多 token",
      "单会话最长时长",
      "单会话最多压缩次数"
    ]);
    expect(records[0].value).toBe(1100);
    expect(records[1].value).toBe(30 * 60 * 1000);
    expect(records[2].value).toBe(1);
    for (const entry of records) {
      expect(entry.session.path).toBe("/repo/a/s1.jsonl");
      expect(entry.session.title).toBe("重构解析层");
      expect(entry.dayStart).toBe(dayStartOf(AT("2026-03-01T09:00:00.000Z")));
    }
  });

  it("并列取时间更早的会话——与 calendarInsightsOf 的「并列取最近段」相反", () => {
    const earlier = metaOf("/repo/early/s.jsonl", "-repo-early");
    const later = metaOf("/repo/late/s.jsonl", "-repo-late");
    const sessionOf = (session: SessionMeta, iso: string) =>
      inputOf({
        records: [rec({ timestamp: AT(iso), kind: "user", usage: usage(500, 500) })],
        session
      });

    // 时间更早的排在数组后面：并列的答案必须与输入顺序无关。
    const tie = historyFactsOf([
      sessionOf(later, "2026-03-05T10:00:00.000Z"),
      sessionOf(earlier, "2026-03-01T10:00:00.000Z")
    ]);
    expect(tie.tokenRecord?.ref.path).toBe("/repo/early/s.jsonl");

    // 时间更早但值更小：这时记录归值更大的那个——并列规则不能盖过最大值。
    const bigger = historyFactsOf([
      sessionOf(later, "2026-03-05T10:00:00.000Z"),
      inputOf({
        records: [rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), kind: "user", usage: usage(400, 400) })],
        session: earlier
      })
    ]);
    expect(bigger.tokenRecord?.ref.path).toBe("/repo/late/s.jsonl");
  });

  it("无正值的极值缺席：全 0 token / 无压缩不发这三枚", () => {
    const facts = historyFactsOf([
      inputOf({ records: [rec({ timestamp: AT("2026-03-01T10:00:00.000Z"), kind: "user" })] })
    ]);
    expect(recordsOf(facts)).toEqual([]);
  });
});

describe("milestonesOf", () => {
  it("空输入 → empty 报告，三层都是空数组", () => {
    const report = milestonesOf([], NOW);
    expect(report.empty).toBe(true);
    expect(report.generatedAt).toBe(NOW);
    expect(report.tiers).toEqual([]);
    expect(report.firsts).toEqual([]);
    expect(report.records).toEqual([]);
    expect(report.facts).toEqual(EMPTY_FACTS);
  });

  it("非空 → 组装三层，facts 仍是事实层", () => {
    const session = metaOf("/repo/a/s1.jsonl", "-repo-a", { cwd: "/repo/a" });
    const report = milestonesOf(
      [
        inputOf({
          records: [
            rec({ timestamp: AT("2026-03-01T09:00:00.000Z"), kind: "user" }),
            rec({
              timestamp: AT("2026-03-01T09:00:10.000Z"),
              usage: usage(1_200_000, 0),
              model: "claude-sonnet-4-5"
            })
          ],
          session
        })
      ],
      NOW
    );

    expect(report.empty).toBe(false);
    expect(report.tiers).toHaveLength(MILESTONE_TIER_TABLE.length);
    expect(tierOf(report.facts, "tokens").reachedIndex).toBe(0);
    expect(report.firsts.map((entry) => entry.kind)).toEqual(["session"]);
    expect(report.records.map((entry) => entry.kind)).toEqual(["tokens", "duration"]);
  });
});

describe("夹具：milestones-firsts.jsonl", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const text = readFileSync(path.join(here, "../../../tests/fixtures/milestones-firsts.jsonl"), "utf8");
  const session = metaOf("/repo/milestones-demo/milestones-0001.jsonl", "-repo-milestones-demo", {
    cwd: "/repo/milestones-demo",
    sessionId: "milestones-0001"
  });
  const parsed = parseJsonlText(text, session.path);
  const input = inputOf({
    records: parsed.records,
    projectLabel: session.projectLabel,
    projectPath: session.cwd,
    compactEvents: parsed.compactEvents ?? [],
    toolCalls: extractToolCalls(parsed),
    session
  });
  const facts = historyFactsOf([input]);

  it("首次类逐枚对上夹具账", () => {
    const firsts = firstsOf(facts);
    expect(firsts.map((entry) => entry.kind)).toEqual(["session", "compaction", "subagent", "skill", "mcp"]);
    expect(firsts.map((entry) => entry.at)).toEqual([
      AT("2026-04-01T09:00:00.000Z"),
      AT("2026-04-01T09:01:00.000Z"),
      AT("2026-04-01T09:05:00.000Z"),
      AT("2026-04-01T09:03:00.000Z"),
      AT("2026-04-01T09:04:00.000Z")
    ]);
    expect(firsts[0].session.path).toBe(session.path);
    expect(firsts[1].dayStart).toBe(dayStartOf(AT("2026-04-01T09:00:00.000Z")));
  });

  it("首枚 skill / MCP / 子 agent 的 detail 就是那次调用自己的名字", () => {
    const firsts = firstsOf(facts);
    const detailOf = (kind: string) => firsts.find((entry) => entry.kind === kind)?.detail;

    expect(detailOf("skill")).toBe("git-commit");
    expect(detailOf("mcp")).toBe("demo/query");
    expect(detailOf("subagent")).toBe("explore");
    // 会话与压缩没有「目标名」这一回事——不编一个名字出来，界面照旧退回会话标题。
    expect(detailOf("session")).toBeUndefined();
    expect(detailOf("compaction")).toBeUndefined();
  });

  it("累计事实与夹具账一致：token / 消息 / 天 / 模型 / 工具 / 压缩", () => {
    const expectedTokens = parsed.records.reduce((sum, record) => {
      const u = record.usage;
      if (!u) return sum;
      return (
        sum +
        (u.inputTokens ?? 0) +
        (u.outputTokens ?? 0) +
        (u.cacheCreationTokens ?? 0) +
        (u.cacheReadTokens ?? 0)
      );
    }, 0);

    expect(facts.sessionCount).toBe(1);
    expect(facts.tokens).toBe(expectedTokens);
    // 消息账 = 2 条 user 文本 + 6 条 assistant；tool_result 行与 tool_use 的
    // 工具记录都不是「消息」（`countsAsMessage` 口径），所以不是 records.length。
    expect(facts.messages).toBe(8);
    expect(facts.compactions).toBe(1);
    expect(facts.projects).toEqual(["-repo-milestones-demo"]);
    expect(facts.models).toEqual(["claude-opus-4-1", "claude-sonnet-4-5"]);
    expect(facts.tools).toEqual(["builtin:Bash", "mcp:demo", "skill:git-commit", "subagent:explore"]);
    expect(facts.days).toEqual([
      dayStartOf(AT("2026-04-01T09:00:00.000Z")),
      dayStartOf(AT("2026-04-02T10:00:00.000Z"))
    ]);
  });

  it("标题取不到真标题时退回「项目标签 · 会话 id 前 8 位」", () => {
    const records = recordsOf(facts);
    // sessionId = "milestones-0001"，取前 8 位即 "mileston"。
    expect(records[0].session.title).toBe("-repo-milestones-demo · mileston");
  });
});
