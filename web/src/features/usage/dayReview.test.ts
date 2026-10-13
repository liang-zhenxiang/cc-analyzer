import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import {
  addLocalDays,
  dayStartOf,
  type UsageSessionInput
} from "./usageAggregations";
import { buildUsageCalendar, daySessionsOf } from "./usageCalendar";
import {
  DAY_DENSITY_LEVELS,
  DAY_PROJECT_COLOR_CAP,
  clockAt,
  dayFractionOf,
  dayReviewOf,
  densityLevelOf,
  type DayReview
} from "./dayReview";
import dayReviewSource from "./dayReview.ts?raw";

/**
 * 「一日回望」数据层契约（Issue #192）：
 * ① 区间 = 当天首条 / 末条计数记录，跨午夜按记录时间切；
 * ② 逐小时分桶 = 本地 clock hour 的记录条数，`Σ hourly === messages`；
 * ③ tokens / costUsd / sessions 与 V1 的 `daySessionsOf` 同一份账（不重算）。
 * 时刻一律固定注入，断言不随运行日期漂移。
 */

const HOUR = 3_600_000;
const TODAY = new Date(2026, 9, 12).getTime(); // 2026-10-12 本地
const YESTERDAY = addLocalDays(TODAY, -1);
const DAY_END = addLocalDays(TODAY, 1);

let seq = 0;

/** 一条助手记录；`tokens` 落在 input 上，其余三类缺省即 0（`SessionUsage` 契约）。 */
function record(at: number, tokens = 0, patch: Partial<SessionRecord> = {}): SessionRecord {
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
    usage: { inputTokens: tokens },
    ...patch
  };
}

function meta(path: string, patch: Partial<SessionMeta> = {}): SessionMeta {
  return { path, projectLabel: "p", hasRecords: true, mtimeMs: 0, sizeBytes: 0, ...patch };
}

function input(
  records: SessionRecord[],
  projectLabel: string,
  session?: SessionMeta,
  projectPath?: string
): UsageSessionInput {
  return { records, projectLabel, session, projectPath };
}

/** 某天 `hour` 点（可带小数）的时刻。 */
function at(dayStart: number, hour = 10.5): number {
  return dayStart + hour * HOUR;
}

/** 当天全量行（等于 rows.length === base.sessions 的那一侧）。 */
function allRowsOf(inputs: readonly UsageSessionInput[], dayStart: number) {
  return daySessionsOf(inputs, dayStart, { top: Number.MAX_SAFE_INTEGER });
}

/** 结构化快照：Map 不可直接 toEqual，键顺序也不该参与断言。 */
function snapshot(review: DayReview) {
  return {
    summary: review.summary,
    rows: review.rows.map((row) => ({ ...row, hourly: [...row.hourly] })),
    key: review.key,
    colorOf: [...review.colorOf.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  };
}

/** 一个项目的 N 条会话：第 i 条 1 条记录、token 给定量、起点依次后移。 */
function projectSessions(label: string, tokens: readonly number[], dayStart = TODAY) {
  return tokens.map((value, index) =>
    input(
      [record(at(dayStart, 9 + index * 0.5), value)],
      label,
      meta(`/sessions/${label}-${index}.jsonl`),
      `/repo/${label}`
    )
  );
}

describe("dayReviewOf · 结构守卫（不重算）", () => {
  it("账本只走 daySessionsOf：源码含调用、不含任何重算成本的入口", () => {
    expect(dayReviewSource).toContain("daySessionsOf(");
    expect(dayReviewSource).toContain("dayStartOf(");
    expect(dayReviewSource).not.toMatch(/estimateCost/);
    expect(dayReviewSource).not.toMatch(/pricingSnapshot/);
    // 本地日长不写死：DST 日 23 / 25 小时都不能被按 86400000 切开。
    expect(dayReviewSource).not.toMatch(/86400000|86_400_000/);
    // 纯函数：没有自己的时钟与随机源。
    expect(dayReviewSource).not.toMatch(/Date\.now\(|performance\.now\(|Math\.random/);
  });

  it("import 面是白名单：只有聚合层与 V1 日聚合两处数据来源", () => {
    const specifiers = [...dayReviewSource.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(specifiers)).toEqual(
      new Set(["../sessions/types", "./usageAggregations", "./usageCalendar"])
    );
  });

  it("行为守卫七条恒等式：行集合、token、成本、占比、消息数、逐桶对账", () => {
    const inputs = [
      input(
        [
          record(at(TODAY, 9.2), 0, { kind: "user", usage: undefined }),
          record(at(TODAY, 9.7), 120_000, { model: "claude-sonnet-4-5" }),
          record(at(TODAY, 11.1), 80_000, { model: "claude-haiku-4-5" })
        ],
        "-repo-a",
        meta("/sessions/a.jsonl")
      ),
      input(
        [record(at(TODAY, 14.0), 300_000, { model: "claude-sonnet-4-5" })],
        "-repo-b",
        meta("/sessions/b.jsonl")
      ),
      // 当天没有落点的会话不进今天的行（它只出现在昨天那天）。
      input([record(at(YESTERDAY, 20), 999_000)], "-repo-c", meta("/sessions/c.jsonl"))
    ];
    const review = dayReviewOf(inputs, TODAY);
    const base = allRowsOf(inputs, TODAY);

    expect(review.rows.length).toBe(base.sessions);
    const rowTokens = review.rows.reduce((sum, row) => sum + row.tokens, 0);
    const rowCost = review.rows.reduce((sum, row) => sum + row.costUsd, 0);
    const rowShare = review.rows.reduce((sum, row) => sum + row.share, 0);
    const rowMessages = review.rows.reduce((sum, row) => sum + row.messages, 0);
    expect(rowTokens).toBe(base.dayTokens);
    expect(rowTokens).toBe(review.summary.tokens);
    expect(Math.abs(rowCost - review.summary.costUsd)).toBeLessThan(1e-9);
    expect(Math.abs(rowShare - 1)).toBeLessThan(1e-9);
    expect(rowMessages).toBe(review.summary.messages);

    // 逐桶求和 = 当天该小时的总记录数（分桶与行集合同源）。
    const hourlyTotal = new Array<number>(24).fill(0);
    for (const source of inputs) {
      for (const item of source.records) {
        if (item.kind !== "user" && item.kind !== "assistant") continue;
        if (item.compactSummary === true) continue;
        if (dayStartOf(item.timestamp) !== TODAY) continue;
        hourlyTotal[new Date(item.timestamp).getHours()] += 1;
      }
    }
    for (let hour = 0; hour < 24; hour += 1) {
      const summed = review.rows.reduce((sum, row) => sum + row.hourly[hour], 0);
      expect(summed).toBe(hourlyTotal[hour]);
    }
  });

  it("与 V1 日聚合逐字段对账：tokens / sessions / messages 三处同源（漂移即红）", () => {
    const inputs = [
      input(
        [
          record(at(TODAY, 9.2), 0, { kind: "user", usage: undefined }),
          record(at(TODAY, 9.7), 120_000),
          // 压缩摘要不是「消息」也不进账（口径与 aggregateSession 一致）。
          record(at(TODAY, 10.4), 500_000, { compactSummary: true }),
          // 别的 kind 一律不计。
          record(at(TODAY, 12.0), 700_000, { kind: "system" }),
          record(at(YESTERDAY, 23.5), 900_000)
        ],
        "-repo-a",
        meta("/sessions/a.jsonl")
      )
    ];
    const review = dayReviewOf(inputs, TODAY);
    const cell = buildUsageCalendar(inputs, TODAY).cells
      .flat()
      .find((item) => item.kind === "day" && item.dayStart === TODAY);
    expect(cell?.kind).toBe("day");
    if (cell?.kind !== "day") throw new Error("今天的天格不在日历里");

    expect(review.summary.tokens).toBe(cell.tokens);
    expect(review.summary.sessions).toBe(cell.sessions);
    expect(review.summary.messages).toBe(cell.messages);
    // 摘要的 token 只认当天、非压缩摘要的记录。
    expect(review.summary.tokens).toBe(120_000);
    expect(review.summary.messages).toBe(2);
  });

  it("同一 path 的两份输入：与 V1 同一份账（键相同 ⇒ 两份记录合并成一份账）", () => {
    const inputs = [
      input([record(at(TODAY, 9), 100_000)], "-repo-a", meta("/sessions/same.jsonl")),
      input([record(at(TODAY, 10), 200_000)], "-repo-a", meta("/sessions/same.jsonl"))
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.rows).toHaveLength(1);
    expect(review.summary.sessions).toBe(1);
    // daySessionsOf 对同一个键是**合并**（循环前先 tallies.get(key) 复用已有 tally），
    // 所以两份输入的记录进同一份账：300,000 而不是任何一份单独的读数。本模块照抄
    // 这份账，不另立一套；消息数与区间是新口径，也按记录如实合并（两条记录）。
    expect(review.rows[0].tokens).toBe(300_000);
    expect(review.summary.tokens).toBe(300_000);
    expect(review.summary.tokens).toBe(allRowsOf(inputs, TODAY).dayTokens);
    expect(review.rows[0].messages).toBe(2);
  });

  it("无元数据的输入不合并：同项目名的两份匿名输入是两行", () => {
    const inputs = [
      input([record(at(TODAY, 9), 100_000)], "-repo-a"),
      input([record(at(TODAY, 11), 200_000)], "-repo-a")
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.rows).toHaveLength(2);
    expect(review.summary.sessions).toBe(2);
    // 匿名行没有 path 可对账，但账必须落在正确的那一行上（tokens 降序对齐）。
    expect(review.rows.map((row) => row.tokens).sort((a, b) => b - a)).toEqual([200_000, 100_000]);
    expect(review.rows.every((row) => row.path === "")).toBe(true);
    expect(review.summary.tokens).toBe(300_000);
  });
});

describe("dayReviewOf · 区间与逐小时分桶", () => {
  it("首末时刻：09:12 / 09:40 / 11:05 → start / end / durationMs / 摘要跨度", () => {
    const nineTwelve = at(TODAY, 9 + 12 / 60);
    const elevenFive = at(TODAY, 11 + 5 / 60);
    const inputs = [
      input(
        [
          record(nineTwelve, 1_000),
          record(at(TODAY, 9 + 40 / 60), 1_000),
          record(elevenFive, 1_000)
        ],
        "-repo-a",
        meta("/sessions/a.jsonl")
      ),
      input(
        [record(at(TODAY, 8 + 30 / 60), 1_000)],
        "-repo-b",
        meta("/sessions/b.jsonl")
      )
    ];
    const review = dayReviewOf(inputs, TODAY);
    const first = review.rows.find((row) => row.path === "/sessions/a.jsonl")!;

    expect(first.start).toBe(nineTwelve);
    expect(first.end).toBe(elevenFive);
    expect(first.durationMs).toBe(elevenFive - nineTwelve); // 1h53m
    expect(first.messages).toBe(3);
    // 摘要的首末时刻是当天全部会话的极小 / 极大。
    expect(review.summary.firstAt).toBe(at(TODAY, 8.5));
    expect(review.summary.lastAt).toBe(elevenFive);
    expect(review.summary.spanMs).toBe(elevenFive - at(TODAY, 8.5));
  });

  it("逐小时分桶落在本地 clock hour 上，且桶和 = 消息数", () => {
    const inputs = [
      input(
        [
          record(at(TODAY, 9 + 5 / 60), 1_000),
          record(at(TODAY, 9 + 59 / 60), 1_000),
          record(at(TODAY, 10 + 1 / 60), 1_000),
          record(at(TODAY, 23 + 30 / 60), 1_000)
        ],
        "-repo-a",
        meta("/sessions/a.jsonl")
      )
    ];
    const row = dayReviewOf(inputs, TODAY).rows[0];

    expect(row.hourly).toHaveLength(24);
    expect(row.hourly[9]).toBe(2);
    expect(row.hourly[10]).toBe(1);
    expect(row.hourly[23]).toBe(1);
    expect(row.hourly.filter((count) => count > 0)).toHaveLength(3);
    expect(row.hourly.reduce((sum, count) => sum + count, 0)).toBe(row.messages);
    expect(row.messages).toBe(4);
    expect(row.start).toBe(at(TODAY, 9 + 5 / 60));
    expect(row.end).toBe(at(TODAY, 23.5));
  });

  it("极短会话（零跨度）：单条记录 → durationMs 0、只有一个桶有值", () => {
    const inputs = [
      input([record(at(TODAY, 9 + 20 / 60), 1_000)], "-repo-a", meta("/sessions/a.jsonl"))
    ];
    const row = dayReviewOf(inputs, TODAY).rows[0];
    expect(row.durationMs).toBe(0);
    expect(row.start).toBe(row.end);
    expect(row.messages).toBe(1);
    expect(row.hourly[9]).toBe(1);
    expect(row.hourly.reduce((sum, count) => sum + count, 0)).toBe(1);
  });

  it("跨午夜按记录时间切：两天各拿自己那一天，两行都标 crossDay", () => {
    const lateNight = at(YESTERDAY, 23 + 40 / 60);
    const afterMidnight = at(TODAY, 25 / 60);
    const pastOne = at(TODAY, 1 + 10 / 60);
    const session = input(
      [
        record(lateNight, 1_000, { kind: "user", usage: undefined }),
        record(afterMidnight, 2_000),
        record(pastOne, 4_000, { kind: "user", usage: undefined })
      ],
      "-repo-x",
      meta("/sessions/x.jsonl")
    );

    const today = dayReviewOf([session], TODAY).rows[0];
    expect(today.crossDay).toBe(true);
    expect(today.start).toBe(afterMidnight);
    expect(today.end).toBe(pastOne);
    expect(today.messages).toBe(2);
    expect(today.hourly[0]).toBe(1);
    expect(today.hourly[1]).toBe(1);
    expect(dayStartOf(today.start)).toBe(TODAY);
    expect(dayStartOf(today.end)).toBe(TODAY);
    // 今天的账只算落在今天的记录：那条 2,000 的助手记录（user 记录没有 usage）。
    expect(today.tokens).toBe(2_000);

    const yesterday = dayReviewOf([session], YESTERDAY).rows[0];
    expect(yesterday.crossDay).toBe(true);
    expect(yesterday.start).toBe(lateNight);
    expect(yesterday.end).toBe(lateNight);
    expect(yesterday.durationMs).toBe(0);
    expect(yesterday.messages).toBe(1);
    expect(yesterday.hourly[23]).toBe(1);
    expect(yesterday.tokens).toBe(0);
    expect(dayStartOf(yesterday.start)).toBe(YESTERDAY);
  });

  it("只有当天记录 → crossDay 为 false；别天有记录才为 true", () => {
    const onlyToday = input([record(at(TODAY, 9), 1_000)], "-repo-a", meta("/sessions/a.jsonl"));
    const spansDays = input(
      [record(at(TODAY, 9), 1_000), record(at(YESTERDAY, 9), 1_000)],
      "-repo-b",
      meta("/sessions/b.jsonl")
    );
    const review = dayReviewOf([onlyToday, spansDays], TODAY);
    expect(review.rows.find((row) => row.path === "/sessions/a.jsonl")!.crossDay).toBe(false);
    expect(review.rows.find((row) => row.path === "/sessions/b.jsonl")!.crossDay).toBe(true);
  });

  it("排序：起点升序，并列按终点、标题、路径", () => {
    const inputs = [
      input([record(at(TODAY, 12), 1_000)], "-repo-late", meta("/sessions/z.jsonl", { customTitle: "乙" })),
      input([record(at(TODAY, 9), 1_000)], "-repo-early", meta("/sessions/b.jsonl", { customTitle: "同" })),
      input([record(at(TODAY, 9), 1_000)], "-repo-early", meta("/sessions/a.jsonl", { customTitle: "同" })),
      input([record(at(TODAY, 9), 1_000)], "-repo-early", meta("/sessions/c.jsonl", { customTitle: "甲" }))
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.rows.map((row) => row.path)).toEqual([
      "/sessions/a.jsonl",
      "/sessions/b.jsonl",
      "/sessions/c.jsonl",
      "/sessions/z.jsonl"
    ]);
  });

  it("输入顺序无关：打乱输入数组与记录顺序，逐字段相等", () => {
    const sessionA = input(
      [record(at(TODAY, 9), 1_000), record(at(TODAY, 11), 2_000)],
      "-repo-a",
      meta("/sessions/a.jsonl")
    );
    const sessionB = input(
      [record(at(TODAY, 10), 3_000), record(at(YESTERDAY, 22), 5_000)],
      "-repo-b",
      meta("/sessions/b.jsonl")
    );
    const straight = dayReviewOf([sessionA, sessionB], TODAY);
    const shuffled = dayReviewOf(
      [
        { ...sessionB, records: [...sessionB.records].reverse() },
        { ...sessionA, records: [...sessionA.records].reverse() }
      ],
      TODAY
    );
    expect(snapshot(shuffled)).toEqual(snapshot(straight));
  });
});

describe("dayReviewOf · 摘要", () => {
  it("最常用模型：token 降序、并列按 id 字典序、无 usage 为 null", () => {
    const ranked = dayReviewOf(
      [
        input(
          [
            record(at(TODAY, 9), 100_000, { model: "claude-haiku-4-5" }),
            record(at(TODAY, 10), 300_000, { model: "claude-sonnet-4-5" })
          ],
          "-repo-a",
          meta("/sessions/a.jsonl")
        )
      ],
      TODAY
    );
    expect(ranked.summary.topModel).toEqual({ id: "claude-sonnet-4-5", tokens: 300_000 });

    const tied = dayReviewOf(
      [
        input(
          [
            record(at(TODAY, 9), 200_000, { model: "zzz-model" }),
            record(at(TODAY, 10), 200_000, { model: "aaa-model" })
          ],
          "-repo-a",
          meta("/sessions/a.jsonl")
        )
      ],
      TODAY
    );
    expect(tied.summary.topModel).toEqual({ id: "aaa-model", tokens: 200_000 });

    const noUsage = dayReviewOf(
      [
        input(
          [record(at(TODAY, 9), 0, { kind: "user", usage: undefined })],
          "-repo-a",
          meta("/sessions/a.jsonl")
        )
      ],
      TODAY
    );
    expect(noUsage.summary.topModel).toBeNull();
    // 模型缺失时按 UNKNOWN_MODEL_LABEL 归桶（口径来自 aggregateSession）。
    const unknown = dayReviewOf(
      [input([record(at(TODAY, 9), 42_000, { model: undefined })], "-repo-a", meta("/sessions/a.jsonl"))],
      TODAY
    );
    expect(unknown.summary.topModel).toEqual({ id: "未知模型", tokens: 42_000 });
  });

  it("无 usage 的会话仍在行里：tokens 与 share 都是 0（不是 NaN），会话数照计", () => {
    const inputs = [
      input(
        [
          record(at(TODAY, 9), 0, { kind: "user", usage: undefined }),
          record(at(TODAY, 9.5), 0, { kind: "user", usage: undefined })
        ],
        "-repo-a",
        meta("/sessions/a.jsonl")
      )
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0].tokens).toBe(0);
    expect(review.rows[0].share).toBe(0);
    expect(Number.isNaN(review.rows[0].share)).toBe(false);
    expect(review.summary.tokens).toBe(0);
    expect(review.summary.sessions).toBe(1);
    expect(review.summary.messages).toBe(2);
    expect(review.summary.projects).toBe(1);
  });

  it("unknown 模型：成本不折为 0 价，hasUnknownCost 从行冒到摘要", () => {
    const inputs = [
      input(
        [record(at(TODAY, 9), 123_456, { model: "gpt-unknown-9" })],
        "-repo-a",
        meta("/sessions/a.jsonl")
      )
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.rows[0].costUsd).toBe(0);
    expect(review.rows[0].hasUnknownCost).toBe(true);
    expect(review.summary.hasUnknownCost).toBe(true);
    expect(review.summary.costUsd).toBe(0);
    // 部分未知：另一条已定价记录的成本照样进账。
    const mixed = dayReviewOf(
      [
        input(
          [
            record(at(TODAY, 9), 100_000, { model: "claude-haiku-4-5" }),
            record(at(TODAY, 10), 100_000, { model: "gpt-unknown-9" })
          ],
          "-repo-a",
          meta("/sessions/a.jsonl")
        )
      ],
      TODAY
    );
    expect(mixed.summary.hasUnknownCost).toBe(true);
    expect(mixed.summary.costUsd).toBeGreaterThan(0);
  });

  it("涉及项目数按 projectLabel 去重（同一项目的两个会话算一个）", () => {
    const inputs = [
      ...projectSessions("-repo-a", [1_000, 2_000]),
      ...projectSessions("-repo-b", [3_000])
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.summary.sessions).toBe(3);
    expect(review.summary.projects).toBe(2);
  });
});

describe("densityLevelOf 与 24 小时几何", () => {
  it("密度档：0 / 1–2 / 3–5 / ≥6 条 → 0 / 1 / 2 / 3", () => {
    expect([0, 1, 2, 3, 5, 6].map(densityLevelOf)).toEqual([0, 1, 1, 2, 2, 3]);
    expect(densityLevelOf(-3)).toBe(0);
    expect(densityLevelOf(1_000)).toBe(3);
    expect([...DAY_DENSITY_LEVELS]).toEqual([4, 8, 12]);
  });

  it("DST 安全的刻度：clockAt(day, 24) 等于次日零点，24 个刻度占比单调不减且在 [0,1]", () => {
    expect(clockAt(TODAY, 24)).toBe(addLocalDays(TODAY, 1));
    let previous = -1;
    for (let hour = 0; hour <= 24; hour += 1) {
      const fraction = dayFractionOf(clockAt(TODAY, hour), TODAY, DAY_END);
      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThanOrEqual(1);
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
    expect(dayFractionOf(at(TODAY, 9), TODAY, DAY_END)).toBeCloseTo(9 / 24, 10);
    expect(dayFractionOf(DAY_END, TODAY, DAY_END)).toBe(1);
  });

  it("行的起止占比都落在 [0,1] 内（含跨午夜那一段）", () => {
    const session = input(
      [record(at(TODAY, 25 / 60), 1_000), record(at(TODAY, 18 + 40 / 60), 1_000)],
      "-repo-a",
      meta("/sessions/a.jsonl")
    );
    const row = dayReviewOf([session], TODAY).rows[0];
    expect(dayFractionOf(row.start, TODAY, DAY_END)).toBeGreaterThanOrEqual(0);
    expect(dayFractionOf(row.end, TODAY, DAY_END)).toBeLessThanOrEqual(1);
    expect(dayFractionOf(row.end, TODAY, DAY_END)).toBeGreaterThan(
      dayFractionOf(row.start, TODAY, DAY_END)
    );
  });
});

describe("dayReviewOf · 项目色", () => {
  it("单项目日：不造色键、全部行色档 1", () => {
    const inputs = projectSessions("-repo-only", [1_000, 2_000]);
    const review = dayReviewOf(inputs, TODAY);
    expect(review.key).toEqual([]);
    expect([...review.colorOf.values()]).toEqual([1, 1]);
    // 同一项目的两个会话在色键缺席时也用同一档。
    expect(new Set(review.rows.map((row) => review.colorOf.get(row.path)))).toEqual(new Set([1]));
  });

  it("6 个项目：前 5 名占 1..5，第 6 并入色档 6（folded 1）", () => {
    const tokens = [600_000, 500_000, 400_000, 300_000, 200_000, 100_000];
    const inputs = tokens.flatMap((value, index) => projectSessions(`-repo-${index}`, [value]));
    const review = dayReviewOf(inputs, TODAY);
    expect(DAY_PROJECT_COLOR_CAP).toBe(5);
    expect(review.key.map((entry) => entry.color)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(review.key.map((entry) => entry.label)).toEqual([
      "-repo-0",
      "-repo-1",
      "-repo-2",
      "-repo-3",
      "-repo-4",
      "其他"
    ]);
    expect(review.key[5].folded).toBe(1);
    expect(review.key[5].tokens).toBe(100_000);
    expect(review.key[5].path).toBeUndefined();
    expect(review.key.slice(0, 5).every((entry) => entry.folded === 0)).toBe(true);
    // 第 6 个项目的行也落到色档 6。
    expect(review.colorOf.get("/sessions/-repo-5-0.jsonl")).toBe(6);
  });

  it("7 个项目：折尾项 folded 2；并列 token 按 label 字典序", () => {
    const inputs = [
      ...projectSessions("-repo-a", [700_000]),
      ...projectSessions("-repo-b", [600_000]),
      ...projectSessions("-repo-c", [500_000]),
      ...projectSessions("-repo-d", [400_000]),
      ...projectSessions("-repo-e", [300_000]),
      ...projectSessions("-repo-zeta", [100_000]),
      ...projectSessions("-repo-alpha", [100_000])
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.key).toHaveLength(6);
    expect(review.key[5]).toEqual({
      label: "其他",
      tokens: 200_000,
      color: 6,
      folded: 2
    });
    // 折尾组里的两个项目共享色档 6。
    expect(review.colorOf.get("/sessions/-repo-zeta-0.jsonl")).toBe(6);
    expect(review.colorOf.get("/sessions/-repo-alpha-0.jsonl")).toBe(6);
  });

  it("两个项目 token 并列：字典序小者占色档 1", () => {
    const inputs = [
      ...projectSessions("-repo-zeta", [500_000]),
      ...projectSessions("-repo-alpha", [500_000])
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.key.map((entry) => entry.label)).toEqual(["-repo-alpha", "-repo-zeta"]);
    expect(review.key.map((entry) => entry.color)).toEqual([1, 2]);
  });

  it("色键带的 path 用该项目的 cwd；行取色与色键同档", () => {
    const inputs = [
      ...projectSessions("-repo-a", [900_000]),
      ...projectSessions("-repo-b", [100_000])
    ];
    const review = dayReviewOf(inputs, TODAY);
    expect(review.key[0].path).toBe("/repo/-repo-a");
    for (const row of review.rows) {
      expect(review.colorOf.get(row.path)).toBe(
        review.key.find((entry) => entry.label === row.projectLabel)!.color
      );
    }
  });
});

describe("dayReviewOf · 空态（防御）", () => {
  it("当天没有任何计数记录：不造行、不造轴数据，摘要给 null / 0", () => {
    const otherDay = [input([record(at(YESTERDAY, 20), 999)], "-repo-a", meta("/sessions/a.jsonl"))];
    const review = dayReviewOf(otherDay, TODAY);
    expect(review.rows).toEqual([]);
    expect(review.key).toEqual([]);
    expect(review.colorOf.size).toBe(0);
    expect(review.summary).toEqual({
      dayStart: TODAY,
      tokens: 0,
      costUsd: 0,
      hasUnknownCost: false,
      sessions: 0,
      messages: 0,
      firstAt: null,
      lastAt: null,
      spanMs: 0,
      topModel: null,
      projects: 0
    });

    const empty = dayReviewOf([], TODAY);
    expect(snapshot(empty)).toEqual(snapshot(review));
  });

  it("只有压缩摘要记录的那一天：与 V1 一样不算会话，落空态", () => {
    const compactOnly = [
      input([record(at(TODAY, 9), 10_000, { compactSummary: true })], "-repo-a", meta("/sessions/a.jsonl"))
    ];
    const review = dayReviewOf(compactOnly, TODAY);
    expect(review.rows).toEqual([]);
    expect(review.summary.sessions).toBe(0);
    expect(review.summary.tokens).toBe(0);
    expect(allRowsOf(compactOnly, TODAY).sessions).toBe(0);
  });
});
