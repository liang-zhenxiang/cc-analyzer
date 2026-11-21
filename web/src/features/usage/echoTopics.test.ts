import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import {
  buildEchoGroups,
  ECHO_THRESHOLD,
  jaccard,
  topicSignature
} from "./echoTopics";

/**
 * 回声的纯逻辑：话题签名、Jaccard、连通分量聚类。
 *
 * 断言的数字都来自手算（bigram 集合、Jaccard 比值、金额），因为这一层
 * 的全部职责就是「同一件事」的判定必须可核实——不靠感觉。
 */

const NOW = new Date(2026, 0, 15, 18, 0, 0).getTime(); // 本地周四傍晚
const SONNET = "claude-sonnet-4-5-20250929";

function at(dayOffset: number, hour = 10): number {
  return new Date(2026, 0, 15 + dayOffset, hour).getTime();
}

function record(
  id: string,
  timestamp: number,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: null,
    ...overrides
  };
}

function priced(
  id: string,
  timestamp: number,
  inputTokens: number,
  model: string = SONNET
): SessionRecord {
  return record(id, timestamp, { model, usage: { inputTokens } });
}

function metaOf(path: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    path,
    mtimeMs: NOW,
    sizeBytes: 1,
    projectLabel: "",
    hasRecords: true,
    ...overrides
  };
}

/** 用 customTitle 精确控制签名（sessionTitle 的最高优先级）。 */
function titled(
  path: string,
  title: string,
  records: SessionRecord[] = [priced(`${path}-r`, at(0), 0)]
): UsageSessionInput {
  return { projectLabel: "", records, session: metaOf(path, { customTitle: title }) };
}

function optionKey(path: string, overrides: Partial<SessionMeta> = {}): UsageSessionInput {
  return {
    projectLabel: "",
    records: [priced(`${path}-r`, at(0), 0)],
    session: metaOf(path, overrides)
  };
}

describe("topicSignature", () => {
  it("turns a pure Chinese run into adjacent-character bigrams", () => {
    expect(topicSignature("上下文压缩")).toEqual(
      new Set(["上下", "下文", "文压", "压缩"])
    );
  });

  it("keeps a single Chinese character as itself", () => {
    expect(topicSignature("压")).toEqual(new Set(["压"]));
  });

  it("lowercases and splits western text on whitespace", () => {
    expect(topicSignature("Fix the Login Bug")).toEqual(
      new Set(["fix", "the", "login", "bug"])
    );
  });

  it("drops one-letter western words", () => {
    expect(topicSignature("Fix a bug")).toEqual(new Set(["fix", "bug"]));
  });

  it("keeps Chinese bigrams and western words in a mixed string", () => {
    expect(topicSignature("修复 login bug")).toEqual(
      new Set(["修复", "login", "bug"])
    );
  });

  it("treats punctuation and whitespace as boundaries for western words", () => {
    expect(topicSignature("Fix,  the.bug!")).toEqual(new Set(["fix", "the", "bug"]));
  });

  it("does not let punctuation break a Chinese run", () => {
    expect(topicSignature("上下文，压缩！")).toEqual(
      new Set(["上下", "下文", "文压", "压缩"])
    );
  });

  it("deduplicates repeated tokens", () => {
    expect(topicSignature("bug bug BUG")).toEqual(new Set(["bug"]));
  });

  it("returns an empty set for an empty or tokenless string", () => {
    expect(topicSignature("")).toEqual(new Set());
    expect(topicSignature("   ,.!?  ")).toEqual(new Set());
    expect(topicSignature("a")).toEqual(new Set());
  });
});

describe("jaccard", () => {
  const a = new Set(["a", "b", "c"]);
  const b = new Set(["b", "c", "d"]);

  it("is symmetric", () => {
    expect(jaccard(a, b)).toBe(0.5);
    expect(jaccard(b, a)).toBe(0.5);
  });

  it("returns 0 when either side is empty (no 0/0)", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(a, new Set())).toBe(0);
    expect(jaccard(new Set(), a)).toBe(0);
  });

  it("returns 1 for identical sets", () => {
    expect(jaccard(a, new Set(a))).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccard(new Set(["x"]), new Set(["y"]))).toBe(0);
  });
});

describe("buildEchoGroups", () => {
  it("returns an empty result when the window has no sessions", () => {
    const result = buildEchoGroups([], NOW);
    expect(result).toEqual({ groups: [], totalSessions: 0, totalUsd: 0 });
  });

  it("does not make a group out of a single session", () => {
    const result = buildEchoGroups([titled("/s/one", "修复登录 bug")], NOW);
    expect(result.groups).toEqual([]);
    expect(result.totalSessions).toBe(0);
    expect(result.totalUsd).toBe(0);
  });

  it("keeps two clearly different topics apart", () => {
    const input = [
      titled("/s/r1", "修复登录 bug"),
      titled("/s/r2", "修复登录 bug 了"),
      titled("/s/r3", "登录 bug 修复"),
      titled("/s/d1", "部署发布流水线"),
      titled("/s/d2", "部署发布流水线卡住了")
    ];

    const result = buildEchoGroups(input, NOW);
    expect(result.groups).toHaveLength(2);
    expect(result.totalSessions).toBe(5);
    // 两组按金额排序（这里都为 0，再按会话数降序）：
    // 「修复」组 3 条，排在「部署」组 2 条之前。
    expect(result.groups[0].sessions).toHaveLength(3);
    expect(result.groups[0].sessions.map((s) => s.id)).toEqual([
      "path:/s/r1",
      "path:/s/r2",
      "path:/s/r3"
    ]);
    expect(result.groups[1].sessions).toHaveLength(2);
    expect(result.groups[1].sessions.map((s) => s.id)).toEqual([
      "path:/s/d1",
      "path:/s/d2"
    ]);
  });

  it("merges three phrasings of the same request through their shared topic", () => {
    const result = buildEchoGroups(
      [
        titled("/s/a", "修复登录 bug"),
        titled("/s/b", "修复登录 bug 了"),
        titled("/s/c", "登录 bug 修复")
      ],
      NOW
    );
    expect(result.groups).toHaveLength(1);
    expect(result.totalSessions).toBe(3);
    expect(result.groups[0].sessions.map((s) => s.title)).toEqual([
      "修复登录 bug",
      "修复登录 bug 了",
      "登录 bug 修复"
    ]);
  });

  it("merges at exactly the threshold and not above it", () => {
    // 11 个共同 token、并集 20 个 → Jaccard = 11/20 = 0.55（恰好等于默认阈值）。
    const shared = "aa bb cc dd ee ff gg hh ii jj kk";
    const input = [
      titled("/s/left", shared),
      titled("/s/right", `${shared} ll mm nn oo pp qq rr ss tt`)
    ];

    expect(ECHO_THRESHOLD).toBe(0.55);
    expect(buildEchoGroups(input, NOW).groups).toHaveLength(1);
    expect(buildEchoGroups(input, NOW, 0.56).groups).toHaveLength(0);
  });

  it("picks the real title of the highest-token, earliest session as the label", () => {
    const early = {
      projectLabel: "",
      records: [priced("early", at(-3), 100_000)],
      session: metaOf("/s/early", { customTitle: "修复登录 bug" })
    };
    const late = {
      projectLabel: "",
      records: [priced("late", at(-1), 5_000_000)],
      session: metaOf("/s/late", { customTitle: "修复登录 bug 了" })
    };

    const [group] = buildEchoGroups([early, late], NOW).groups;
    // 代表标题是 late 的真实标题，不是根据共同 token 生成的短语。
    expect(group.label).toBe("修复登录 bug 了");
    // 组成员按时间升序，不是按代表标题排序。
    expect(group.sessions.map((s) => s.id)).toEqual(["path:/s/early", "path:/s/late"]);
    expect(group.spanDays).toBe(2);
    // Jan 12 → Jan 14：自然日差 2。
    expect(group.sessions[0].at).toBe(at(-3));
    expect(group.sessions[1].at).toBe(at(-1));
  });

  it("uses the earliest in-window record as the session time", () => {
    const straddling = {
      projectLabel: "",
      records: [priced("old", at(-40), 1_000_000), priced("new", at(-1), 1_000_000)],
      session: metaOf("/s/straddling", { customTitle: "修复登录 bug" })
    };
    const other = titled("/s/other", "修复登录 bug 了", [priced("o", at(-1), 1_000_000)]);

    const [group] = buildEchoGroups([straddling, other], NOW).groups;
    const member = group.sessions.find((s) => s.id === "path:/s/straddling");
    expect(member?.at).toBe(at(-1));
    // 窗口外那条记录不计入金额：只有窗口内的 1M token → $3。
    expect(member?.usd).toBeCloseTo(3, 10);
    expect(group.usd).toBeCloseTo(6, 10);
  });

  it("sums the priced sessions in a group", () => {
    const result = buildEchoGroups(
      [
        titled("/s/a", "修复登录 bug", [priced("a", at(-1), 1_000_000)]),
        titled("/s/b", "修复登录 bug 了", [priced("b", at(0), 1_000_000)])
      ],
      NOW
    );
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].usd).toBeCloseTo(6, 10);
    expect(result.totalUsd).toBeCloseTo(6, 10);
  });

  it("turns the whole group (and the total) null when one member is unpriced", () => {
    const result = buildEchoGroups(
      [
        titled("/s/priced", "修复登录 bug", [priced("p", at(-1), 1_000_000)]),
        titled("/s/unknown", "修复登录 bug 了", [
          priced("u", at(0), 1_000_000, "gpt-4o")
        ])
      ],
      NOW
    );

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].sessions[1].usd).toBeNull();
    expect(result.groups[0].usd).toBeNull();
    expect(result.totalUsd).toBeNull();
  });

  it("sorts priced groups first, with unpriced groups last", () => {
    const result = buildEchoGroups(
      [
        titled("/s/d1", "部署发布流水线", [priced("d1", at(0), 0, "gpt-4o")]),
        titled("/s/d2", "部署发布流水线卡住了", [priced("d2", at(0), 0, "gpt-4o")]),
        titled("/s/r1", "修复登录 bug", [priced("r1", at(-1), 1_000_000)]),
        titled("/s/r2", "修复登录 bug 了", [priced("r2", at(0), 1_000_000)])
      ],
      NOW
    );

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].label).toBe("修复登录 bug");
    expect(result.groups[0].usd).toBeCloseTo(6, 10);
    expect(result.groups[1].usd).toBeNull();
    expect(result.totalUsd).toBeNull();
  });

  it("excludes sessions with no record inside the window", () => {
    const result = buildEchoGroups(
      [
        titled("/s/old-a", "修复登录 bug", [priced("a", at(-40), 1_000_000)]),
        titled("/s/old-b", "修复登录 bug 了", [priced("b", at(-40), 1_000_000)])
      ],
      NOW
    );
    expect(result).toEqual({ groups: [], totalSessions: 0, totalUsd: 0 });
  });

  it("honours an explicit window length", () => {
    const input = [
      titled("/s/a", "修复登录 bug", [priced("a", at(-10), 1_000_000)]),
      titled("/s/b", "修复登录 bug 了", [priced("b", at(-10), 1_000_000)])
    ];
    // 7 天窗口从 1/9 起，at(-10)=1/5 在窗口外。
    expect(buildEchoGroups(input, NOW, ECHO_THRESHOLD, 7).groups).toHaveLength(0);
    expect(buildEchoGroups(input, NOW, ECHO_THRESHOLD, 30).groups).toHaveLength(1);
  });

  it("never invents a topic for sessions with neither title nor first message", () => {
    const blank = (path: string): UsageSessionInput => ({
      projectLabel: "",
      records: [priced(`${path}-r`, at(0), 1_000_000)],
      session: metaOf(path) // projectLabel 为空，也没有 customTitle / userPrompt
    });

    const result = buildEchoGroups([blank("/s/a"), blank("/s/b")], NOW);
    expect(result).toEqual({ groups: [], totalSessions: 0, totalUsd: 0 });
  });

  it("uses the first user message, truncated to 200 characters", () => {
    const marker = "x".repeat(200);
    // customTitle 固定，签名只由首条用户消息决定；尾部的 6 个词在 200 字符之外。
    const result = buildEchoGroups(
      [
        optionKey("/s/a", {
          customTitle: "same topic",
          userPrompt: `${marker} alpha bravo charlie delta echo foxtrot`
        }),
        optionKey("/s/b", { customTitle: "same topic", userPrompt: marker })
      ],
      NOW
    );
    // 截断后两条消息相同 → 签名相同；若未截断，尾部 6 个词会把相似度压到 0.55 以下。
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].sessions).toHaveLength(2);
  });
});
