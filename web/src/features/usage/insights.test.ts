import { describe, expect, it } from "vitest";
import type { CompactEvent, SessionRecord } from "../sessions/types";
import type { ErrorEvent, ErrorSessionFacts } from "./errorStats";
import { dayStartOf, type UsageSessionInput } from "./usageAggregations";
import {
  COMPACTION_BASE_SESSIONS,
  INSIGHT_THRESHOLDS,
  buildInsights,
  formatInsightCompaction,
  formatInsightMinutes,
  formatInsightPercent,
  formatInsightTokens,
  type Insight
} from "./insights";

/**
 * 「值得注意的变化」纯逻辑层（Issue #383）的用例。
 *
 * 所有日期用本地 `Date` 构造、断言也用本地日历，因此在任何时区都成立。
 * 「今天」固定为 2026-11-21 18:00，区间 = 30 天：
 * - 当前窗口 = 11/21 往前 30 个本地日（10/23–11/21）；
 * - 对照窗口 = 紧邻的上一个 30 天（9/23–10/22）。
 * 夹具里的 `daysAgo` 因此以 30 为界：0–29 落在当前段，30–59 落在对照段。
 */

const NOW = new Date(2026, 10, 21, 18, 0, 0).getTime();
const DAYS = 30;
const MINUTE = 60_000;

const OPUS = "claude-opus-4-1-20250805";
const SONNET = "claude-sonnet-4-5-20250929";

/** 本地日期在 `daysAgo` 天前的正午（正午避开 DST 边界）。 */
function dayTs(daysAgo: number, hour = 12): number {
  return new Date(2026, 10, 21 - daysAgo, hour, 0, 0).getTime();
}

let seq = 0;
function rec(
  timestamp: number,
  opts: { model?: string; input?: number } = {}
): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    model: opts.model,
    text: "",
    isError: false,
    usage: opts.input === undefined ? undefined : { inputTokens: opts.input },
    raw: {}
  };
}

function compactEvent(id: string, timestamp: number): CompactEvent {
  return {
    id,
    timestamp,
    trigger: "auto",
    preTokens: 100,
    postTokens: 50,
    droppedTokens: 50,
    durationMs: 1,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null,
    raw: {}
  };
}

function session(
  records: SessionRecord[],
  over: Partial<UsageSessionInput> = {}
): UsageSessionInput {
  return { records, projectLabel: "proj-alpha", ...over };
}

/** 一段窗口内的工具调用失败事实（分子 / 分母走同一个提取通道）。 */
function errorExtractAt(ts: number, calls: number, errors: number): ErrorSessionFacts {
  const events: ErrorEvent[] = Array.from({ length: errors }, (_, i) => ({
    kind: "tool",
    timestamp: ts + i,
    toolName: "Bash",
    recordId: null,
    path: "/repo/session.jsonl",
    projectLabel: "proj-alpha",
    preview: ""
  }));
  return {
    events,
    days: new Map([
      [
        dayStartOf(ts),
        {
          assistantMessages: 0,
          records: calls,
          toolCalls: new Map([["Bash", calls]])
        }
      ]
    ])
  };
}

function errorInput(daysAgo: number, calls: number, errors: number): UsageSessionInput {
  const ts = dayTs(daysAgo);
  return session([rec(ts, { model: OPUS, input: 100 })], {
    errorExtract: errorExtractAt(ts, calls, errors)
  });
}

/** 模型占比夹具：同一天、每个模型一条会话，项目固定不变。 */
function modelSegment(
  tokensByModel: ReadonlyArray<{ model: string; tokens: number }>,
  daysAgo: number
): UsageSessionInput[] {
  return tokensByModel.map(({ model, tokens }) =>
    session([rec(dayTs(daysAgo), { model, input: tokens })])
  );
}

/** 项目占比夹具：模型固定不变，每个项目一条会话。 */
function projectSegment(
  tokensByProject: ReadonlyArray<{ project: string; path: string; tokens: number }>,
  daysAgo: number
): UsageSessionInput[] {
  return tokensByProject.map(({ project, path, tokens }) =>
    session([rec(dayTs(daysAgo), { model: OPUS, input: tokens })], {
      projectLabel: project,
      projectPath: path
    })
  );
}

/** 压缩夹具：把 `compactionCount` 个事件轮转挂到 `sessionCount` 条会话上。 */
function compactionSegment(
  daysAgoBase: number,
  sessionCount: number,
  compactionCount: number
): UsageSessionInput[] {
  const perSession = Array.from({ length: sessionCount }, () => 0);
  for (let i = 0; i < compactionCount; i += 1) {
    perSession[i % sessionCount] += 1;
  }
  return perSession.map((count, i) => {
    const ts = dayTs(daysAgoBase + i);
    return session([rec(ts, { model: OPUS, input: 100 })], {
      compactEvents: Array.from({ length: count }, (_, j) =>
        compactEvent(`c-${daysAgoBase}-${i}-${j}`, ts + j * MINUTE)
      )
    });
  });
}

/** 会话长度夹具：每条会话两条记录，首末相差 `spanMs`。 */
function lengthSegment(
  daysAgoBase: number,
  sessionCount: number,
  spanMs: number
): UsageSessionInput[] {
  return Array.from({ length: sessionCount }, (_, i) => {
    const start = dayTs(daysAgoBase + i);
    return session([
      rec(start, { model: OPUS, input: 100 }),
      rec(start + spanMs, { model: OPUS, input: 100 })
    ]);
  });
}

/** 日均用量夹具：每个活跃日一条会话（单条记录 → 会话时长 0）。 */
function dailySegment(
  daysAgoBase: number,
  activeDays: number,
  tokensPerDay: number
): UsageSessionInput[] {
  return Array.from({ length: activeDays }, (_, i) =>
    session([rec(dayTs(daysAgoBase + i), { model: OPUS, input: tokensPerDay })])
  );
}

/**
 * 六条规则同时成立的布景，用来钉排序与条数上限：
 * model 100pp→5，project 100pp→5，error 10pp→2，compaction 1.0 次/会话→2，
 * session length +100%→2，daily tokens +100%→2。前五条按规则序号进榜，
 * 第六条（dailyTokens）被 `maxInsights` 截掉。
 */
function comprehensiveInputs(): UsageSessionInput[] {
  const currentCompactions = [2, 2, 2, 1, 1, 1, 0]; // 合计 9
  const previousCompactions = [1, 1, 0, 0, 0, 0, 0]; // 合计 2

  const current = Array.from({ length: 7 }, (_, i) => {
    const start = dayTs(i);
    return session(
      [
        rec(start, { model: OPUS, input: 2000 }),
        rec(start + 20 * MINUTE, { model: OPUS, input: 2000 })
      ],
      {
        projectLabel: "proj-p",
        projectPath: "/repo/p",
        compactEvents: Array.from({ length: currentCompactions[i] }, (_, j) =>
          compactEvent(`cur-${i}-${j}`, start + j * MINUTE)
        )
      }
    );
  });

  const previous = Array.from({ length: 7 }, (_, i) => {
    const start = dayTs(30 + i);
    return session(
      [
        rec(start, { model: SONNET, input: 1000 }),
        rec(start + 10 * MINUTE, { model: SONNET, input: 1000 })
      ],
      {
        projectLabel: "proj-q",
        projectPath: "/repo/q",
        compactEvents: Array.from({ length: previousCompactions[i] }, (_, j) =>
          compactEvent(`prev-${i}-${j}`, start + j * MINUTE)
        )
      }
    );
  });

  current[0] = { ...current[0], errorExtract: errorExtractAt(dayTs(0), 100, 10) };
  previous[0] = { ...previous[0], errorExtract: errorExtractAt(dayTs(30), 100, 0) };

  return [...current, ...previous];
}

function kindsOf(inputs: readonly UsageSessionInput[]): string[] {
  return buildInsights(inputs, DAYS, NOW).map((insight) => insight.kind);
}

function findKind(
  inputs: readonly UsageSessionInput[],
  kind: Insight["kind"]
): Insight | undefined {
  return buildInsights(inputs, DAYS, NOW).find((insight) => insight.kind === kind);
}

describe("INSIGHT_THRESHOLDS", () => {
  it("pins the contract from Issue #383", () => {
    expect(INSIGHT_THRESHOLDS).toEqual({
      modelSharePp: 20,
      projectSharePp: 20,
      errorRatePp: 5,
      compactionPerSession: 0.5,
      sessionLengthPct: 50,
      dailyTokensPct: 50,
      minSessions: 5,
      minToolCalls: 20,
      minActiveDays: 7,
      maxInsights: 5
    });
  });
});

describe("model composition (rule 1)", () => {
  it("produces an insight at exactly 20 percentage points", () => {
    // Opus 58% vs 38% = 20pp；浮点会得到 19.999999999999996，阈值比较必须容忍。
    const inputs = [
      ...modelSegment(
        [
          { model: OPUS, tokens: 58 },
          { model: SONNET, tokens: 42 }
        ],
        1
      ),
      ...modelSegment(
        [
          { model: OPUS, tokens: 38 },
          { model: SONNET, tokens: 62 }
        ],
        31
      )
    ];
    const insight = findKind(inputs, "model");
    expect(insight).toBeDefined();
    expect(insight?.evidence[0].before).toBeCloseTo(38, 9);
    expect(insight?.evidence[0].after).toBeCloseTo(58, 9);
    expect(insight?.intensity).toBeCloseTo(1, 9);
    expect(insight?.text).toContain("Opus 4.1");
    expect(insight?.text).toContain("升到");
  });

  it("does not produce an insight at 19 percentage points", () => {
    const inputs = [
      ...modelSegment(
        [
          { model: OPUS, tokens: 57 },
          { model: SONNET, tokens: 43 }
        ],
        1
      ),
      ...modelSegment(
        [
          { model: OPUS, tokens: 38 },
          { model: SONNET, tokens: 62 }
        ],
        31
      )
    ];
    expect(kindsOf(inputs)).not.toContain("model");
  });

  it("does not produce an insight when one segment has no token baseline", () => {
    const inputs = modelSegment([{ model: OPUS, tokens: 100 }], 1);
    expect(kindsOf(inputs)).not.toContain("model");
  });
});

describe("project concentration (rule 2)", () => {
  it("produces an insight at exactly 20 percentage points", () => {
    const inputs = [
      ...projectSegment(
        [
          { project: "proj-a", path: "/repo/a", tokens: 58 },
          { project: "proj-b", path: "/repo/b", tokens: 42 }
        ],
        1
      ),
      ...projectSegment(
        [
          { project: "proj-a", path: "/repo/a", tokens: 38 },
          { project: "proj-b", path: "/repo/b", tokens: 62 }
        ],
        31
      )
    ];
    const insight = findKind(inputs, "project");
    expect(insight).toBeDefined();
    expect(insight?.evidence[0].label).toBe("a");
    expect(insight?.evidence[0].before).toBeCloseTo(38, 9);
    expect(insight?.evidence[0].after).toBeCloseTo(58, 9);
    expect(insight?.text).toBe("a 的用量占比从 38% 升到 58%");
  });

  it("does not produce an insight at 19 percentage points", () => {
    const inputs = [
      ...projectSegment(
        [
          { project: "proj-a", path: "/repo/a", tokens: 57 },
          { project: "proj-b", path: "/repo/b", tokens: 43 }
        ],
        1
      ),
      ...projectSegment(
        [
          { project: "proj-a", path: "/repo/a", tokens: 38 },
          { project: "proj-b", path: "/repo/b", tokens: 62 }
        ],
        31
      )
    ];
    expect(kindsOf(inputs)).not.toContain("project");
  });

  it("does not produce an insight when one segment has no token baseline", () => {
    const inputs = projectSegment(
      [{ project: "proj-a", path: "/repo/a", tokens: 100 }],
      1
    );
    expect(kindsOf(inputs)).not.toContain("project");
  });
});

describe("tool error rate (rule 3)", () => {
  it("produces an insight at exactly 5 percentage points", () => {
    const inputs = [errorInput(1, 100, 5), errorInput(31, 100, 0)];
    const insight = findKind(inputs, "errorRate");
    expect(insight).toBeDefined();
    expect(insight?.evidence[0].before).toBeCloseTo(0, 9);
    expect(insight?.evidence[0].after).toBeCloseTo(5, 9);
    expect(insight?.intensity).toBeCloseTo(1, 9);
    expect(insight?.text).toBe("工具调用失败率从 0% 升到 5%");
    expect(insight?.direction).toBe("up-bad");
  });

  it("does not produce an insight at 4 percentage points", () => {
    const inputs = [errorInput(1, 100, 4), errorInput(31, 100, 0)];
    expect(kindsOf(inputs)).not.toContain("errorRate");
  });

  it("enforces the 20 tool-call floor on both segments", () => {
    // 100pp 的变化，但当前段只有 19 次调用 → 样本不足，不产出。
    const inputs = [errorInput(1, 19, 19), errorInput(31, 100, 0)];
    expect(kindsOf(inputs)).not.toContain("errorRate");
  });

  it("keeps up-bad when the rate falls", () => {
    const inputs = [errorInput(1, 100, 0), errorInput(31, 100, 10)];
    const insight = findKind(inputs, "errorRate");
    expect(insight?.text).toContain("降到");
    expect(insight?.direction).toBe("up-bad");
  });
});

describe("compaction frequency (rule 4)", () => {
  it("produces an insight at exactly 0.5 compactions per session", () => {
    // 4 会话：对照 2 次 = 0.5/会话，当前 4 次 = 1.0/会话；变化恰为 0.5。
    const inputs = [...compactionSegment(1, 4, 4), ...compactionSegment(31, 4, 2)];
    const insight = findKind(inputs, "compaction");
    expect(insight).toBeDefined();
    expect(insight?.evidence[0].before).toBeCloseTo(5, 9);
    expect(insight?.evidence[0].after).toBeCloseTo(10, 9);
    expect(insight?.intensity).toBeCloseTo(1, 9);
    expect(insight?.text).toBe(
      `平均每 ${COMPACTION_BASE_SESSIONS} 个会话压缩次数从 5 次 升到 10 次`
    );
  });

  it("does not produce an insight at 0.25 compactions per session", () => {
    const inputs = [...compactionSegment(1, 4, 3), ...compactionSegment(31, 4, 2)];
    expect(kindsOf(inputs)).not.toContain("compaction");
  });

  it("does not produce an insight when one segment has no sessions", () => {
    const inputs = compactionSegment(1, 4, 4);
    expect(kindsOf(inputs)).not.toContain("compaction");
  });
});

describe("average session length (rule 5)", () => {
  it("produces an insight at exactly 50 percent", () => {
    const inputs = [...lengthSegment(1, 5, 15 * MINUTE), ...lengthSegment(31, 5, 10 * MINUTE)];
    const insight = findKind(inputs, "sessionLength");
    expect(insight).toBeDefined();
    expect(insight?.evidence[0].before).toBeCloseTo(10, 9);
    expect(insight?.evidence[0].after).toBeCloseTo(15, 9);
    expect(insight?.intensity).toBeCloseTo(1, 9);
    expect(insight?.text).toBe("平均会话时长从 10 分钟 升到 15 分钟");
  });

  it("does not produce an insight at 49 percent", () => {
    const inputs = [
      ...lengthSegment(1, 5, 14.9 * MINUTE),
      ...lengthSegment(31, 5, 10 * MINUTE)
    ];
    expect(kindsOf(inputs)).not.toContain("sessionLength");
  });

  it("enforces the 5-session floor on both segments", () => {
    const inputs = [...lengthSegment(1, 5, 15 * MINUTE), ...lengthSegment(31, 4, 10 * MINUTE)];
    expect(kindsOf(inputs)).not.toContain("sessionLength");
  });
});

describe("daily token usage (rule 6)", () => {
  it("produces an insight at exactly 50 percent", () => {
    const inputs = [...dailySegment(1, 7, 1500), ...dailySegment(31, 7, 1000)];
    const insight = findKind(inputs, "dailyTokens");
    expect(insight).toBeDefined();
    expect(insight?.evidence[0].before).toBeCloseTo(1000, 9);
    expect(insight?.evidence[0].after).toBeCloseTo(1500, 9);
    expect(insight?.intensity).toBeCloseTo(1, 9);
    expect(insight?.text).toBe("活跃日均 token 从 1,000 升到 1,500");
  });

  it("does not produce an insight at 49.9 percent", () => {
    const inputs = [...dailySegment(1, 7, 1499), ...dailySegment(31, 7, 1000)];
    expect(kindsOf(inputs)).not.toContain("dailyTokens");
  });

  it("enforces the 7-active-day floor on both segments", () => {
    const inputs = [...dailySegment(1, 7, 1500), ...dailySegment(31, 6, 1000)];
    expect(kindsOf(inputs)).not.toContain("dailyTokens");
  });
});

describe("ordering and cap", () => {
  it("sorts by intensity, breaks ties by rule order, and keeps at most 5", () => {
    const insights = buildInsights(comprehensiveInputs(), DAYS, NOW);
    expect(insights.map((insight) => insight.kind)).toEqual([
      "model",
      "project",
      "errorRate",
      "compaction",
      "sessionLength"
    ]);
    const expectedIntensity = [5, 5, 2, 2, 2];
    insights.forEach((insight, index) => {
      expect(insight.intensity).toBeCloseTo(expectedIntensity[index], 9);
    });
    // dailyTokens 也达到了阈值，但被 maxInsights 截掉。
    expect(insights).toHaveLength(INSIGHT_THRESHOLDS.maxInsights);
    expect(insights.map((insight) => insight.kind)).not.toContain("dailyTokens");
  });
});

describe("direction semantics", () => {
  it("marks only the error rate as up-bad", () => {
    const insights = buildInsights(comprehensiveInputs(), DAYS, NOW);
    for (const insight of insights) {
      expect(insight.direction).toBe(insight.kind === "errorRate" ? "up-bad" : "neutral");
    }
  });
});

describe("empty and one-sided windows", () => {
  it("returns nothing when both windows are empty", () => {
    expect(buildInsights([], DAYS, NOW)).toEqual([]);
  });

  it("returns nothing when only the current window has data", () => {
    expect(buildInsights(dailySegment(1, 7, 1500), DAYS, NOW)).toEqual([]);
  });

  it("returns nothing when only the comparison window has data", () => {
    expect(buildInsights(dailySegment(31, 7, 1000), DAYS, NOW)).toEqual([]);
  });
});

describe("evidence matches the rendered text", () => {
  it("formats every evidence value into the sentence it backs", () => {
    const insights = buildInsights(comprehensiveInputs(), DAYS, NOW);
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      expect(insight.evidence).toHaveLength(1);
      const [{ before, after }] = insight.evidence;
      switch (insight.kind) {
        case "model":
        case "project":
        case "errorRate":
          expect(insight.text).toContain(formatInsightPercent(before));
          expect(insight.text).toContain(formatInsightPercent(after));
          break;
        case "compaction":
          expect(insight.text).toContain(formatInsightCompaction(before));
          expect(insight.text).toContain(formatInsightCompaction(after));
          break;
        case "sessionLength":
          expect(insight.text).toContain(formatInsightMinutes(before));
          expect(insight.text).toContain(formatInsightMinutes(after));
          break;
        case "dailyTokens":
          expect(insight.text).toContain(formatInsightTokens(before));
          expect(insight.text).toContain(formatInsightTokens(after));
          break;
      }
    }
  });
});

describe("fact-only copy", () => {
  const FORBIDDEN = [
    "建议",
    "应该",
    "可能",
    "注意",
    "需要",
    "好",
    "坏",
    "问题",
    "正常",
    "异常"
  ];

  it("never uses judgment words", () => {
    const insights = buildInsights(comprehensiveInputs(), DAYS, NOW);
    expect(insights.length).toBeGreaterThan(0);
    for (const insight of insights) {
      for (const word of FORBIDDEN) {
        expect(insight.text).not.toContain(word);
      }
    }
  });
});
