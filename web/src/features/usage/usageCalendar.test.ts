import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { estimateCost, MODEL_PRICING, type CostEstimate } from "./pricingSnapshot";

/** 测试里的已知模型都应已定价：把联合类型收窄到 `{ usd }`（expect 不做 narrowing）。 */
function priced(estimate: CostEstimate): { usd: number } {
  if ("unknownModel" in estimate) throw new Error(`夹具模型意外未定价：${JSON.stringify(estimate)}`);
  return estimate;
}
import { addLocalDays, type UsageSessionInput, type UsageTotals } from "./usageAggregations";
import { buildUsageCalendar, daySessionsOf, levelOfCost, type UsageCalendar } from "./usageCalendar";

/** `estimateCost` 吃的是四类计数器（UsageTotals），测试里的 SessionUsage 先折一道。 */
function totalsOf(usage: SessionUsage): UsageTotals {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
}

/**
 * 消耗日历的契约（Issue #187）：窗口恒 365 个本地日、对齐周一后恒 53 列
 * （6 个 pad）、成本按 (day, model) 分桶逐模型折算、四分位是 Type 7。
 * `now` 一律注入固定时刻——日历的断言不允许随运行日期漂移。
 */

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();
const TODAY = new Date(2026, 9, 12).getTime();
const HOUR = 3_600_000;

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

/** 某天 10:30 的一条记录。 */
function at(dayStart: number, hour = 10.5): number {
  return dayStart + hour * HOUR;
}

/** 距今天 N 天（N=0 是今天）。 */
function daysAgo(n: number): number {
  return addLocalDays(TODAY, -n);
}

/**
 * 造一个「当天成本恰为 N 美元」的输入：haiku 的 input 单价是 $1/MTok，
 * cost × 1M tokens 折成整美元——四分位断言因此可以用整数分布手算。
 */
function dayWithCost(costUsd: number, dayStart: number, label = "-repo-cal"): UsageSessionInput {
  return input(
    [record(at(dayStart), 0, {
      model: "claude-haiku-4-5",
      usage: { inputTokens: costUsd * 1_000_000 }
    })],
    label
  );
}

/** 全部天格（pad 之外）。 */
function dayCells(calendar: UsageCalendar) {
  return calendar.cells.flat().filter((cell) => cell.kind === "day");
}

function cellOf(calendar: UsageCalendar, dayStart: number) {
  const found = dayCells(calendar).find(
    (cell) => cell.kind === "day" && cell.dayStart === dayStart
  );
  expect(found, `找不到天格 ${new Date(dayStart).toISOString()}`).toBeDefined();
  return found as Extract<UsageCalendar["cells"][number][number], { kind: "day" }>;
}

describe("buildUsageCalendar · 网格几何", () => {
  it("53 列恒等式：任意星期锚点下 53 列、365 天格、6 pad、首列从周一开始", () => {
    // 扫过一周 7 个锚点——今天的星期数是这个恒等式唯一可能依赖的变量。
    for (let offset = 0; offset < 7; offset += 1) {
      const anchor = new Date(2026, 9, 12 + offset, 12, 0, 0).getTime();
      const calendar = buildUsageCalendar([], anchor);
      expect(calendar.weekStarts).toHaveLength(53);
      expect(dayCells(calendar)).toHaveLength(365);
      const pads = calendar.cells.flat().filter((cell) => cell.kind === "pad");
      expect(pads).toHaveLength(6);

      // 每列起点都是周一。
      for (const weekStart of calendar.weekStarts) {
        expect(new Date(weekStart).getDay()).toBe(1);
      }

      // 首列在窗口起点前恰有 offsetStart 个 pad；窗口起点与今天同星期。
      const firstColumnPads = calendar.cells[0].filter((cell) => cell.kind === "pad").length;
      const windowStart = addLocalDays(new Date(anchor).setHours(0, 0, 0, 0), -364);
      const expectedOffset = (new Date(windowStart).getDay() + 6) % 7;
      expect(firstColumnPads).toBe(expectedOffset);
      // pad 全部收在首尾两列（中间列不缺天）。
      const lastColumnPads = calendar.cells[52].filter((cell) => cell.kind === "pad").length;
      expect(firstColumnPads + lastColumnPads).toBe(6);
      expect(new Date(windowStart).getDay()).toBe(new Date(anchor).getDay());
    }
  });

  it("周一先行：第一行是周一、最后一行是周日（数据层的列对齐事实）", () => {
    const calendar = buildUsageCalendar([], NOW);
    // cells[w][0] 对应 weekStarts[w] 的周一（row 0）；今天是周一（2026-10-12），
    // 今天的格子必在 row 0。
    expect(new Date(TODAY).getDay()).toBe(1);
    const todayCell = cellOf(calendar, TODAY);
    expect(calendar.cells[52][0]).toBe(todayCell);
    // 周日（2026-10-11 = 昨天）在 row 6。
    expect(calendar.cells[51][6]).toBe(cellOf(calendar, daysAgo(1)));
  });

  it("跨年窗口：月名重复时两个标签都带年号，其余不带", () => {
    const calendar = buildUsageCalendar([], NOW);
    const labels = calendar.monthMarks.map((mark) => mark.label);
    expect(labels).toContain("2025/10");
    expect(labels).toContain("2026/10");
    expect(labels.filter((label) => label.includes("/"))).toHaveLength(2);
    // 365 天窗口跨 12~13 个日历月（今天非月末时是 13）。
    expect(labels.length).toBeGreaterThanOrEqual(12);
    expect(labels.length).toBeLessThanOrEqual(13);
  });

  it("年初锚点：月初的窗口只有 12 个列头月、无重复；月中的窗口 13 个且 1 月重复都带年", () => {
    // 月初锚点：末列周一是 2025-12-29，2026-01-01 那天住在这列里但列头
    // 归 12 月——列头描述列的起点月（GitHub 同款），于是恰 12 个、无重复。
    const newYear = new Date(2026, 0, 1, 12, 0, 0).getTime();
    const labelsOfYearStart = buildUsageCalendar([], newYear).monthMarks.map((m) => m.label);
    expect(labelsOfYearStart).toHaveLength(12);
    expect(labelsOfYearStart.filter((label) => label.includes("/"))).toHaveLength(0);

    // 月中锚点：窗口 [2025-01-16, 2026-01-15]，1 月在首尾各出现一次 → 都带年号。
    const midJanuary = new Date(2026, 0, 15, 12, 0, 0).getTime();
    const labels = buildUsageCalendar([], midJanuary).monthMarks.map((m) => m.label);
    expect(labels).toHaveLength(13);
    expect(labels).toContain("2025/1");
    expect(labels).toContain("2026/1");
    expect(labels.filter((label) => label.includes("/"))).toHaveLength(2);
  });

  it("闰年：窗口含 2/29 时天格仍 365，2/29 落在正确的列与行", () => {
    const anchor = new Date(2024, 2, 10, 12, 0, 0).getTime();
    const calendar = buildUsageCalendar([], anchor);
    expect(dayCells(calendar)).toHaveLength(365);
    const leapDay = new Date(2024, 1, 29).getTime();
    // 2024-02-29 是周四：找到它的格子，反推它所在的列周一 + 行偏移必须吻合。
    const weekIndex = calendar.cells.findIndex((column) =>
      column.some((cell) => cell.kind === "day" && cell.dayStart === leapDay)
    );
    expect(weekIndex).toBeGreaterThanOrEqual(0);
    const row = calendar.cells[weekIndex].findIndex(
      (cell) => cell.kind === "day" && cell.dayStart === leapDay
    );
    // 周四 = Monday-first 的 row 3。
    expect(row).toBe(3);
    expect(calendar.cells[weekIndex][row]).toBe(cellOf(calendar, leapDay));
  });
});

describe("buildUsageCalendar · 四分位与档位", () => {
  it("Type 7 四分位与档位成员：8 天成本 [1..7,100] 的每档成员", () => {
    const costs = [1, 2, 3, 4, 5, 6, 7, 100];
    const inputs = costs.map((cost, index) => dayWithCost(cost, daysAgo(index + 1)));
    const calendar = buildUsageCalendar(inputs, NOW);

    // Type 7 手算（§2.2 的公式逐字）：rank = p×(n−1)，n=8 → 1.75 / 3.5 / 5.25，
    // 插值点落在 values[1..2] / [3..4] / [5..6] 上。
    // （规格 §7.1 写的 3.25 / 6.75 是 (n+1) 法的数字，与其自己的公式矛盾——
    //   以「可单测的唯一公式」§2.2 为准。）
    expect(calendar.quartiles).not.toBeNull();
    expect(calendar.quartiles!.q1).toBeCloseTo(2.75, 10);
    expect(calendar.quartiles!.q2).toBeCloseTo(4.5, 10);
    expect(calendar.quartiles!.q3).toBeCloseTo(6.25, 10);

    const levelOf = (cost: number) => cellOf(calendar, daysAgo(costs.indexOf(cost) + 1)).level;
    expect(costs.filter((cost) => cost <= 2.75).map(levelOf)).toEqual([1, 1]);
    expect(costs.filter((cost) => cost > 2.75 && cost <= 4.5).map(levelOf)).toEqual([2, 2]);
    expect(costs.filter((cost) => cost > 4.5 && cost <= 6.25).map(levelOf)).toEqual([3, 3]);
    expect(costs.filter((cost) => cost > 6.25).map(levelOf)).toEqual([4, 4]);
  });

  it("相等成本必然同档：[5,5,5,9] 三个 5 同档", () => {
    const inputs = [5, 5, 5, 9].map((cost, index) => dayWithCost(cost, daysAgo(index + 1)));
    const calendar = buildUsageCalendar(inputs, NOW);
    const levels = [5, 5, 5, 9].map((_, index) => cellOf(calendar, daysAgo(index + 1)).level);
    expect(levels.slice(0, 3)).toEqual([1, 1, 1]);
    expect(levels[3]).toBe(4);
  });

  it("退化分布：n=1 → 1 档；n=0 → quartiles 为 null 且全 0 档；全同值 → 全 1 档", () => {
    const single = buildUsageCalendar([dayWithCost(7, daysAgo(1))], NOW);
    expect(single.quartiles).toEqual({ q1: 7, q2: 7, q3: 7 });
    expect(cellOf(single, daysAgo(1)).level).toBe(1);

    const empty = buildUsageCalendar([], NOW);
    expect(empty.quartiles).toBeNull();
    expect(dayCells(empty).every((cell) => cell.kind === "day" && cell.level === 0)).toBe(true);

    const uniform = buildUsageCalendar(
      [1, 2, 3, 4].map((_, index) => dayWithCost(6, daysAgo(index + 1))),
      NOW
    );
    expect(uniform.quartiles).toEqual({ q1: 6, q2: 6, q3: 6 });
    expect(
      [1, 2, 3, 4].every((_, index) => cellOf(uniform, daysAgo(index + 1)).level === 1)
    ).toBe(true);
  });

  it("levelOfCost 独立断言：阈值比较（≤）、0 与 null 都落 0 档", () => {
    const q = { q1: 3.25, q2: 4.5, q3: 6.75 };
    expect(levelOfCost(0, q)).toBe(0);
    expect(levelOfCost(-1, q)).toBe(0);
    expect(levelOfCost(5, null)).toBe(0);
    expect(levelOfCost(3.25, q)).toBe(1);
    expect(levelOfCost(3.2499, q)).toBe(1);
    expect(levelOfCost(4.5, q)).toBe(2);
    expect(levelOfCost(6.75, q)).toBe(3);
    expect(levelOfCost(6.7501, q)).toBe(4);
  });
});

describe("buildUsageCalendar · 记录口径", () => {
  it("0 成本天：只有 user 记录时 level 0 但 messages / sessions 照计", () => {
    const userOnly = input(
      [
        record(at(daysAgo(1)), 0, { kind: "user", usage: undefined }),
        record(at(daysAgo(1), 11), 0, { kind: "user", usage: undefined })
      ],
      "-repo-a",
      meta("/sessions/a.jsonl")
    );
    const cell = cellOf(buildUsageCalendar([userOnly], NOW), daysAgo(1));
    expect(cell.level).toBe(0);
    expect(cell.messages).toBe(2);
    expect(cell.sessions).toBe(1);
    expect(cell.hasUnknownCost).toBe(false);
    expect(cell.tokens).toBe(0);
  });

  it("全 unknown 模型：level 0、hasUnknownCost 为 true，token 与会话照进格子", () => {
    const unknown = input(
      [record(at(daysAgo(2)), 123_456, { model: "gpt-unknown-9" })],
      "-repo-b",
      meta("/sessions/b.jsonl")
    );
    const cell = cellOf(buildUsageCalendar([unknown], NOW), daysAgo(2));
    expect(cell.costUsd).toBe(0);
    expect(cell.hasUnknownCost).toBe(true);
    expect(cell.level).toBe(0);
    expect(cell.tokens).toBe(123_456);
    expect(cell.sessions).toBe(1);
  });

  it("成本按 (day, model) 分桶：同一天 sonnet + haiku 的 costUsd = 两笔 estimateCost 之和", () => {
    const day = daysAgo(1);
    const sonnetUsage: SessionUsage = { inputTokens: 2_000_000, outputTokens: 1_000_000 };
    const haikuUsage: SessionUsage = { inputTokens: 3_000_000, cacheReadTokens: 500_000 };
    const mixed = input(
      [
        record(at(day), 0, { model: "claude-sonnet-4-5", usage: sonnetUsage }),
        record(at(day, 11), 0, { model: "claude-haiku-4-5", usage: haikuUsage })
      ],
      "-repo-mixed"
    );

    const cell = cellOf(buildUsageCalendar([mixed], NOW), day);
    const sonnet = priced(estimateCost(totalsOf(sonnetUsage), "claude-sonnet-4-5"));
    const haiku = priced(estimateCost(totalsOf(haikuUsage), "claude-haiku-4-5"));
    // 手算对照（MODEL_PRICING 逐项）：21 + 3.05。
    expect(sonnet.usd).toBeCloseTo(
      2 * MODEL_PRICING.sonnet.input + 1 * MODEL_PRICING.sonnet.output,
      10
    );
    expect(haiku.usd).toBeCloseTo(
      3 * MODEL_PRICING.haiku.input + 0.5 * MODEL_PRICING.haiku.cacheRead,
      10
    );
    expect(cell.costUsd).toBeCloseTo(sonnet.usd + haiku.usd, 10);
    expect(cell.hasUnknownCost).toBe(false);
    expect(cell.tokens).toBe(2_000_000 + 1_000_000 + 3_000_000 + 500_000);
  });

  it("跨午夜会话：记录分落两天，各天只拿自己的记录", () => {
    const monday = daysAgo(2);
    const midnight = new Date(monday).setHours(23, 30, 0, 0);
    const afterMidnight = new Date(monday).setHours(25, 30, 0, 0);
    const session = input(
      [record(midnight, 1_000), record(afterMidnight, 2_000)],
      "-repo-x",
      meta("/sessions/x.jsonl")
    );

    const calendar = buildUsageCalendar([session], NOW);
    expect(cellOf(calendar, monday).tokens).toBe(1_000);
    expect(cellOf(calendar, addLocalDays(monday, 1)).tokens).toBe(2_000);
    expect(cellOf(calendar, monday).messages).toBe(1);
  });

  it("窗口外记录不进日历：364 天前那天与明天都不收", () => {
    const outside = input(
      [
        record(at(addLocalDays(TODAY, -365)), 999),
        record(at(addLocalDays(TODAY, 1)), 888)
      ],
      "-repo-out"
    );
    const calendar = buildUsageCalendar([outside], NOW);
    expect(dayCells(calendar).every((cell) => cell.kind === "day" && cell.tokens === 0)).toBe(true);
  });
});

describe("buildUsageCalendar · topProject", () => {
  it("多项目同天：token 最大者胜出", () => {
    const inputs = [
      input([record(at(daysAgo(1)), 1_000)], "-repo-small", meta("/sessions/s.jsonl"), "/repo/small"),
      input([record(at(daysAgo(1)), 9_000)], "-repo-big", meta("/sessions/b.jsonl"), "/repo/big")
    ];
    const cell = cellOf(buildUsageCalendar(inputs, NOW), daysAgo(1));
    expect(cell.topProject).toEqual({ label: "-repo-big", path: "/repo/big" });
  });

  it("token 并列时取 label 字典序最小", () => {
    const inputs = [
      input([record(at(daysAgo(1)), 5_000)], "-repo-zeta"),
      input([record(at(daysAgo(1)), 5_000)], "-repo-alpha")
    ];
    const cell = cellOf(buildUsageCalendar(inputs, NOW), daysAgo(1));
    expect(cell.topProject).toEqual({ label: "-repo-alpha", path: undefined });
  });

  it("无 token 的天：topProject 为 null", () => {
    const noUsage = input(
      [record(at(daysAgo(1)), 0, { kind: "user", usage: undefined })],
      "-repo-a"
    );
    const cell = cellOf(buildUsageCalendar([noUsage], NOW), daysAgo(1));
    expect(cell.topProject).toBeNull();
  });
});

describe("daySessionsOf", () => {
  const day = daysAgo(1);

  function ladderSessions(count: number): UsageSessionInput[] {
    return Array.from({ length: count }, (_, index) =>
      input(
        [record(at(day, 9 + index * 0.1), (count - index) * 1_000)],
        `-repo-s${index}`,
        meta(`/sessions/s${index}.jsonl`, { customTitle: `会话 ${index}` })
      )
    );
  }

  it("恒等式三条 + 排序 + Top 5 折尾「其余 N 个」", () => {
    const inputs = ladderSessions(8);
    const result = daySessionsOf(inputs, day);

    expect(result.sessions).toBe(8);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((row) => row.tokens)).toEqual([8_000, 7_000, 6_000, 5_000, 4_000]);
    expect(result.remainder).not.toBeNull();
    expect(result.remainder!.sessions).toBe(3);
    expect(result.remainder!.tokens).toBe(6_000);

    // Σ rows.tokens + remainder.tokens === dayTokens（当天总量）。
    const rowTokens = result.rows.reduce((sum, row) => sum + row.tokens, 0);
    expect(rowTokens + result.remainder!.tokens).toBe(result.dayTokens);
    // Σ shares === 1（浮点容差 1e-9）。
    const shareSum =
      result.rows.reduce((sum, row) => sum + row.share, 0) + result.remainder!.share;
    expect(Math.abs(shareSum - 1)).toBeLessThan(1e-9);
    // rows.length === min(top, sessions)；remainder === null ⇔ sessions ≤ top。
    expect(result.rows.length).toBe(Math.min(5, result.sessions));
  });

  it("会话数 ≤ 5 时不造余项行", () => {
    const result = daySessionsOf(ladderSessions(3), day);
    expect(result.rows).toHaveLength(3);
    expect(result.remainder).toBeNull();
    expect(result.sessions).toBe(3);
  });

  it("行成本按该会话当天记录的 (model, usage) 折算，unknown 记入 hasUnknown", () => {
    const usage: SessionUsage = { inputTokens: 1_000_000, outputTokens: 0 };
    const pricedSession = input(
      [record(at(day), 0, { model: "claude-sonnet-4-5", usage })],
      "-repo-p",
      meta("/sessions/p.jsonl")
    );
    const unknown = input(
      [record(at(day, 11), 500_000, { model: "gpt-unknown-9" })],
      "-repo-u",
      meta("/sessions/u.jsonl")
    );

    const rows = daySessionsOf([pricedSession, unknown], day).rows;
    const expected = priced(estimateCost(totalsOf(usage), "claude-sonnet-4-5"));
    expect(rows[0].costUsd).toBeCloseTo(expected.usd, 10);
    expect(rows[0].hasUnknownCost).toBe(false);
    expect(rows[1].costUsd).toBe(0);
    expect(rows[1].hasUnknownCost).toBe(true);
    expect(rows[1].tokens).toBe(500_000);
  });

  it("没有元数据的行 path 为空串、title 退回项目标签", () => {
    const rows = daySessionsOf(
      [input([record(at(day), 1_000)], "-repo-anon")],
      day
    ).rows;
    expect(rows[0].path).toBe("");
    expect(rows[0].title).toBe("-repo-anon");
  });

  it("同键复数输入并入一行：token 是两段之和，不是后者覆盖前者", () => {
    // 同一个 session.path 出现在两份输入里（当前数据流按路径唯一，这里是
    // 硬化隐患：同键必须合并成一行，与配额归因的口径一致）。
    const shared = meta("/sessions/dup.jsonl", { customTitle: "重复会话" });
    const inputs = [
      input([record(at(day, 9), 100_000)], "-repo-dup", shared),
      input([record(at(day, 14), 200_000)], "-repo-dup", shared)
    ];

    const result = daySessionsOf(inputs, day);
    expect(result.sessions).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].path).toBe("/sessions/dup.jsonl");
    expect(result.rows[0].tokens).toBe(300_000);
    expect(result.rows[0].share).toBe(1);
    expect(result.dayTokens).toBe(300_000);
    expect(result.remainder).toBeNull();

    // 副作用就是这条：展开区的当日总量必须与同一个格子的 tokens 对得上。
    const cell = cellOf(buildUsageCalendar(inputs, NOW), day);
    expect(cell.sessions).toBe(1);
    expect(result.dayTokens).toBe(cell.tokens);
  });

  it("并列时按标题、再按路径稳定排序", () => {
    const sessions = [
      input([record(at(day), 500)], "-repo-b", meta("/sessions/beta.jsonl", { customTitle: "beta" })),
      input([record(at(day, 9.5), 500)], "-repo-z", meta("/sessions/zeta.jsonl", { customTitle: "alpha" })),
      input([record(at(day, 9.8), 500)], "-repo-a", meta("/sessions/alpha.jsonl", { customTitle: "alpha" }))
    ];
    const rows = daySessionsOf(sessions, day).rows;
    expect(rows.map((row) => row.path)).toEqual([
      "/sessions/alpha.jsonl",
      "/sessions/zeta.jsonl",
      "/sessions/beta.jsonl"
    ]);
  });

  it("与格子出自同一批 inputs 时 sessions 恒等式：展开区会话数 = 格子的 sessions", () => {
    const inputs = [
      ...ladderSessions(2),
      input([record(at(day, 15), 0, { kind: "user", usage: undefined })], "-repo-quiet")
    ];
    const cell = cellOf(buildUsageCalendar(inputs, NOW), day);
    const detail = daySessionsOf(inputs, day);
    expect(detail.sessions).toBe(cell.sessions);
    expect(detail.dayTokens).toBe(cell.tokens);
  });
});

describe("输入顺序无关", () => {
  it("打乱 inputs 与记录顺序，输出逐字段相等（成本按浮点容差比）", () => {
    const day1 = daysAgo(1);
    const day2 = daysAgo(3);
    const make = () => [
      input(
        [
          record(at(day1), 3_000_000, { model: "claude-haiku-4-5" }),
          record(at(day2, 14), 1_000_000, { model: "claude-haiku-4-5" })
        ],
        "-repo-a",
        meta("/sessions/a.jsonl", { customTitle: "a" })
      ),
      input([record(at(day1, 11), 2_000)], "-repo-b", meta("/sessions/b.jsonl")),
      input([record(at(day2, 15), 0, { kind: "user", usage: undefined })], "-repo-c")
    ];

    const baseline = buildUsageCalendar(make(), NOW);
    const shuffled = buildUsageCalendar(
      [
        input([...make()[2].records].reverse(), "-repo-c"),
        input([...make()[0].records].reverse(), "-repo-a", meta("/sessions/a.jsonl", { customTitle: "a" })),
        input([...make()[1].records].reverse(), "-repo-b", meta("/sessions/b.jsonl"))
      ],
      NOW
    );

    expect(shuffled.weekStarts).toEqual(baseline.weekStarts);
    expect(shuffled.monthMarks).toEqual(baseline.monthMarks);
    expect(shuffled.cells.length).toEqual(baseline.cells.length);
    for (let week = 0; week < baseline.cells.length; week += 1) {
      expect(shuffled.cells[week].length).toEqual(baseline.cells[week].length);
      for (let row = 0; row < baseline.cells[week].length; row += 1) {
        const left = shuffled.cells[week][row];
        const right = baseline.cells[week][row];
        if (right.kind === "pad" || left.kind === "pad") {
          expect(left.kind).toBe(right.kind);
          continue;
        }
        if (left.kind === "day" && right.kind === "day") {
          expect(left.dayStart).toBe(right.dayStart);
          expect(left.tokens).toBe(right.tokens);
          expect(left.messages).toBe(right.messages);
          expect(left.sessions).toBe(right.sessions);
          expect(left.hasUnknownCost).toBe(right.hasUnknownCost);
          expect(left.topProject).toEqual(right.topProject);
          expect(left.level).toBe(right.level);
          expect(left.costUsd).toBeCloseTo(right.costUsd, 10);
        }
      }
    }

    // daySessionsOf 同样与顺序无关：行的身份与量不随输入顺序变。
    const baselineInputs = make();
    const shuffledInputs = [...baselineInputs].reverse();
    expect(
      daySessionsOf(shuffledInputs, day1).rows.map((row) => [row.path, row.tokens, row.title])
    ).toEqual(
      daySessionsOf(baselineInputs, day1).rows.map((row) => [row.path, row.tokens, row.title])
    );
  });
});
