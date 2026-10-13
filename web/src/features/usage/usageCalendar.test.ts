import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { estimateCost, MODEL_PRICING, type CostEstimate } from "./pricingSnapshot";

/** 测试里的已知模型都应已定价：把联合类型收窄到 `{ usd }`（expect 不做 narrowing）。 */
function priced(estimate: CostEstimate): { usd: number } {
  if ("unknownModel" in estimate) throw new Error(`夹具模型意外未定价：${JSON.stringify(estimate)}`);
  return estimate;
}
import {
  UNKNOWN_MODEL_LABEL,
  addLocalDays,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";
import {
  buildUsageCalendar,
  daySessionsOf,
  dayTimelineOf,
  levelOfCost,
  type DayTimeline,
  type UsageCalendar
} from "./usageCalendar";

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

describe("dayTimelineOf · 一日回望（Issue #192）", () => {
  const day = daysAgo(1);

  /** 泳道不变量复用断言：同泳道两两不重叠（effectiveEnd 口径）、max(lane) 封顶。 */
  function assertLanesValid(timeline: DayTimeline): void {
    expect(timeline.sessions.length).toBeGreaterThan(0);
    const effectiveEndOf = (session: { instant: boolean; startTs: number; endTs: number }) =>
      session.instant ? session.startTs + 60_000 : session.endTs;
    const byLane = new Map<number, DayTimeline["sessions"]>();
    for (const session of timeline.sessions) {
      expect(session.lane).toBeGreaterThanOrEqual(0);
      expect(session.lane).toBeLessThan(timeline.laneCount);
      byLane.set(session.lane, [...(byLane.get(session.lane) ?? []), session]);
    }
    for (const group of byLane.values()) {
      const sorted = [...group].sort((a, b) => a.startTs - b.startTs);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(effectiveEndOf(sorted[index - 1])).toBeLessThanOrEqual(sorted[index].startTs);
      }
    }
    expect(Math.max(...timeline.sessions.map((session) => session.lane))).toBe(
      timeline.laneCount - 1
    );
  }

  it("首末时刻：多记录取 min/max；跨午夜会话按记录归属切，两天各见各的", () => {
    const monday = daysAgo(2);
    const lateNight = new Date(monday).setHours(23, 30, 0, 0);
    const afterMidnight = new Date(monday).setHours(25, 30, 0, 0);
    const session = input(
      [record(lateNight, 1_000), record(afterMidnight, 2_000)],
      "-repo-x",
      meta("/sessions/x.jsonl")
    );

    // 今天侧只有 00:30 一条 → 首末同刻、瞬时会话（条 ≠ 会话真实起止，口径同 daySessionsOf）。
    const tuesday = dayTimelineOf([session], addLocalDays(monday, 1));
    expect(tuesday.sessions).toHaveLength(1);
    expect(tuesday.sessions[0].startTs).toBe(afterMidnight);
    expect(tuesday.sessions[0].endTs).toBe(afterMidnight);
    expect(tuesday.sessions[0].instant).toBe(true);
    expect(tuesday.summary.firstTs).toBe(afterMidnight);
    expect(tuesday.summary.lastTs).toBe(afterMidnight);

    const mondayTimeline = dayTimelineOf([session], monday);
    expect(mondayTimeline.sessions).toHaveLength(1);
    expect(mondayTimeline.sessions[0].startTs).toBe(lateNight);
    expect(mondayTimeline.sessions[0].endTs).toBe(lateNight);

    // 多记录乱序（后写的更早）：首末仍取 min/max，不信任行序。
    const shuffledTimes = input(
      [record(at(day, 12), 5), record(at(day, 9), 5), record(at(day, 10), 5)],
      "-repo-m",
      meta("/sessions/m.jsonl")
    );
    const multi = dayTimelineOf([shuffledTimes], day);
    expect(multi.sessions[0].startTs).toBe(at(day, 9));
    expect(multi.sessions[0].endTs).toBe(at(day, 12));
  });

  it("逐小时分桶：9:30 / 10:15 各得其所；Σ hourlyTokens === tokens；无 usage 只计 messages", () => {
    const nineThirty = new Date(day).setHours(9, 30, 0, 0);
    const tenFifteen = new Date(day).setHours(10, 15, 0, 0);
    const active = input(
      [record(nineThirty, 3_000), record(tenFifteen, 4_000)],
      "-repo-active",
      meta("/sessions/active.jsonl")
    );
    const quiet = input(
      [record(new Date(day).setHours(14, 0, 0, 0), 0, { kind: "user", usage: undefined })],
      "-repo-quiet",
      meta("/sessions/quiet.jsonl")
    );

    const timeline = dayTimelineOf([active, quiet], day);
    const activeBar = timeline.sessions.find((session) => session.path === "/sessions/active.jsonl")!;
    const quietBar = timeline.sessions.find((session) => session.path === "/sessions/quiet.jsonl")!;
    expect(activeBar.hourlyTokens).toHaveLength(24);
    expect(activeBar.hourlyTokens[9]).toBe(3_000);
    expect(activeBar.hourlyTokens[10]).toBe(4_000);
    expect(activeBar.hourlyTokens.filter((value) => value !== 0)).toHaveLength(2);
    expect(
      activeBar.hourlyTokens.reduce((sum, value) => sum + value, 0)
    ).toBe(activeBar.tokens);
    // 无 usage 记录不进桶但计 messages：quiet 条零密度、形状在场。
    expect(quietBar.hourlyTokens.every((value) => value === 0)).toBe(true);
    expect(quietBar.tokens).toBe(0);
    expect(timeline.summary.messages).toBe(3);
  });

  it("instant 判定：59_999 → true、60_000 → false、单记录（start === end）→ true", () => {
    const start = at(day, 9);
    const timeline = dayTimelineOf(
      [
        input(
          [record(start, 100), record(start + 59_999, 100)],
          "-repo-under",
          meta("/sessions/under.jsonl")
        ),
        input(
          [record(start, 100), record(start + 60_000, 100)],
          "-repo-exactly",
          meta("/sessions/exactly.jsonl")
        ),
        input([record(start, 100)], "-repo-single", meta("/sessions/single.jsonl"))
      ],
      day
    );
    const byPath = new Map(timeline.sessions.map((session) => [session.path, session]));
    expect(byPath.get("/sessions/under.jsonl")!.instant).toBe(true);
    expect(byPath.get("/sessions/exactly.jsonl")!.instant).toBe(false);
    expect(byPath.get("/sessions/single.jsonl")!.instant).toBe(true);
  });

  it("泳道贪心：不重叠同泳道、重叠 / 包含分泳道、同刻瞬时分泳道（effectiveEnd）", () => {
    // A 09:00–10:00；C 09:30–10:30（与 A 重叠）；D 09:45–09:50（被 A 包含）；
    // B 10:00–11:00（与 A 背靠背：A 恰在 B 开始的同一毫秒结束 → 复用泳道 0）；
    // E / F 12:00 同刻瞬时会话（effectiveEnd 生效必然分泳道）。
    const timeline = dayTimelineOf(
      [
        input(
          [record(at(day, 9), 1), record(at(day, 10), 1)],
          "-repo-a",
          meta("/sessions/lane-a.jsonl")
        ),
        input(
          [record(at(day, 10), 1), record(at(day, 11), 1)],
          "-repo-b",
          meta("/sessions/lane-b.jsonl")
        ),
        input(
          [record(at(day, 9.5), 1), record(at(day, 10.5), 1)],
          "-repo-c",
          meta("/sessions/lane-c.jsonl")
        ),
        input(
          [record(at(day, 9.75), 1), record(at(day, 9) + 50 * 60_000, 1)],
          "-repo-d",
          meta("/sessions/lane-d.jsonl")
        ),
        input([record(at(day, 12), 1)], "-repo-e", meta("/sessions/lane-e.jsonl")),
        input([record(at(day, 12), 1)], "-repo-f", meta("/sessions/lane-f.jsonl"))
      ],
      day
    );
    const byPath = new Map(timeline.sessions.map((session) => [session.path, session]));
    expect(byPath.get("/sessions/lane-a.jsonl")!.lane).toBe(0);
    expect(byPath.get("/sessions/lane-b.jsonl")!.lane).toBe(0);
    expect(byPath.get("/sessions/lane-c.jsonl")!.lane).toBe(1);
    expect(byPath.get("/sessions/lane-d.jsonl")!.lane).toBe(2);
    // 两个同刻瞬时会话：第一个复用已空出的泳道 0（effectiveEnd 12:01），第二个必然换道。
    expect(byPath.get("/sessions/lane-e.jsonl")!.lane).toBe(0);
    expect(byPath.get("/sessions/lane-f.jsonl")!.lane).toBe(1);
    assertLanesValid(timeline);
  });

  it("项目槽位：3 项目按当日 token 降序拿 0/1/2；并列按 label 字典序", () => {
    const timeline = dayTimelineOf(
      [
        input(
          [record(at(day), 1_000)],
          "-repo-small",
          meta("/sessions/s.jsonl"),
          "/repo/small"
        ),
        input([record(at(day), 9_000)], "-repo-big", meta("/sessions/b.jsonl"), "/repo/big"),
        input([record(at(day), 5_000)], "-repo-mid", meta("/sessions/m.jsonl"), "/repo/mid")
      ],
      day
    );
    expect(timeline.projectSlots.map((slot) => slot.label)).toEqual([
      "-repo-big",
      "-repo-mid",
      "-repo-small"
    ]);
    expect(timeline.projectSlots.map((slot) => slot.slot)).toEqual([0, 1, 2]);
    expect(timeline.projectSlots[0]).toMatchObject({ path: "/repo/big", sessions: 1 });

    // token 并列 → label 字典序（a-lose 在 b-tail 前，两者同量）。
    const tie = dayTimelineOf(
      [
        input([record(at(day), 5_000)], "-repo-b-tail", meta("/sessions/t1.jsonl")),
        input([record(at(day), 5_000)], "-repo-a-lose", meta("/sessions/t2.jsonl"))
      ],
      day
    );
    expect(tie.projectSlots.map((slot) => slot.label)).toEqual(["-repo-a-lose", "-repo-b-tail"]);
  });

  it("项目槽位折叠：6 项目恰 5 彩槽 + other；7 项目 other 合并第 6+（Σ === summary.tokens）", () => {
    const labels = ["a", "b", "c", "d", "e", "f", "g"];
    const inputs = labels.map((name, index) =>
      input(
        [record(at(day, 9 + index * 0.1), (7 - index) * 1_000)],
        `-repo-${name}`,
        meta(`/sessions/p${index}.jsonl`)
      )
    );

    const seven = dayTimelineOf(inputs, day);
    expect(seven.projectSlots).toHaveLength(6);
    expect(seven.projectSlots.map((slot) => slot.slot)).toEqual([0, 1, 2, 3, 4, "other"]);
    expect(seven.projectSlots[5].tokens).toBe(1_000 + 2_000);
    expect(seven.projectSlots[5].sessions).toBe(2);
    expect(seven.projectSlots.reduce((sum, slot) => sum + slot.tokens, 0)).toBe(
      seven.summary.tokens
    );

    const six = dayTimelineOf(inputs.slice(0, 6), day);
    expect(six.projectSlots).toHaveLength(6);
    expect(six.projectSlots[5].slot).toBe("other");
    expect(six.projectSlots[5].tokens).toBe(2_000);
    // 5 个及以内零折叠。
    const five = dayTimelineOf(inputs.slice(0, 5), day);
    expect(five.projectSlots.map((slot) => slot.slot)).toEqual([0, 1, 2, 3, 4]);
  });

  it("summary.topModel：token 最大者；并列按 id 字典序；全无 usage → null；unknown 命中 → UNKNOWN_MODEL_LABEL", () => {
    const top = dayTimelineOf(
      [
        input(
          [
            record(at(day), 0, {
              model: "claude-haiku-4-5",
              usage: { inputTokens: 1_000_000 }
            })
          ],
          "-repo-a"
        ),
        input(
          [
            record(at(day, 11), 0, {
              model: "claude-sonnet-4-5",
              usage: { inputTokens: 1_000 }
            })
          ],
          "-repo-b"
        )
      ],
      day
    );
    expect(top.summary.topModel).toBe("claude-haiku-4-5");

    // 并列（同 token）→ id 字典序最小。
    const tie = dayTimelineOf(
      [
        input(
          [
            record(at(day), 0, {
              model: "claude-sonnet-4-5",
              usage: { inputTokens: 1_000 }
            })
          ],
          "-repo-a"
        ),
        input(
          [
            record(at(day, 11), 0, {
              model: "claude-haiku-4-5",
              usage: { inputTokens: 1_000 }
            })
          ],
          "-repo-b"
        )
      ],
      day
    );
    expect(tie.summary.topModel).toBe("claude-haiku-4-5");

    const none = dayTimelineOf(
      [input([record(at(day), 0, { kind: "user", usage: undefined })], "-repo-n")],
      day
    );
    expect(none.summary.topModel).toBeNull();

    // unknown 模型的 token 计入排名：量最大时如实报「未知模型」。
    const unknownTop = dayTimelineOf(
      [
        input(
          [
            record(at(day), 0, {
              model: "claude-haiku-4-5",
              usage: { inputTokens: 1_000 }
            })
          ],
          "-repo-a"
        ),
        input(
          [
            record(at(day, 11), 0, {
              model: "gpt-unknown-9",
              usage: { inputTokens: 9_000 }
            })
          ],
          "-repo-b"
        )
      ],
      day
    );
    expect(unknownTop.summary.topModel).toBe(UNKNOWN_MODEL_LABEL);
    expect(unknownTop.summary.hasUnknownCost).toBe(true);
  });

  it("summary：projects 只计非空 label；空输入可构造且 firstTs / lastTs 为 null", () => {
    const timeline = dayTimelineOf(
      [
        input([record(at(day), 100)], "-repo-a", meta("/sessions/a.jsonl")),
        input([record(at(day, 11), 100)], "-repo-a", meta("/sessions/a2.jsonl")),
        input([record(at(day, 12), 100)], "-repo-b", meta("/sessions/b.jsonl"))
      ],
      day
    );
    expect(timeline.summary.projects).toBe(2);
    expect(timeline.summary.sessions).toBe(3);

    const empty = dayTimelineOf([], day);
    expect(empty.summary).toMatchObject({
      sessions: 0,
      messages: 0,
      firstTs: null,
      lastTs: null,
      tokens: 0,
      topModel: null,
      projects: 0
    });
    expect(empty.sessions).toEqual([]);
    expect(empty.laneCount).toBe(0);
    expect(empty.projectSlots).toEqual([]);
  });
});

describe("dayTimelineOf · 与既有函数的一致性恒等式（§2.4 八条）", () => {
  // 同一天、同一批 inputs 下 `dayTimelineOf` / `daySessionsOf` /
  // `buildUsageCalendar` 必然一致——升级是增量的，两套实现不许悄悄分叉。
  const day1 = daysAgo(1);
  const day2 = daysAgo(2);

  function mixedInputs(): UsageSessionInput[] {
    return [
      input(
        [
          record(at(day1, 9), 2_000_000, { model: "claude-haiku-4-5" }),
          record(at(day1, 10), 1_000_000, { model: "gpt-unknown-9" }),
          record(at(day2, 14), 3_000_000, { model: "claude-haiku-4-5" })
        ],
        "-repo-a",
        meta("/sessions/a.jsonl", { customTitle: "a" })
      ),
      input([record(at(day1, 11), 2_000)], "-repo-b", meta("/sessions/b.jsonl")),
      input([record(at(day1, 15), 0, { kind: "user", usage: undefined })], "-repo-c"),
      input([record(at(day2, 15), 5_000)], "-repo-d", meta("/sessions/d.jsonl"))
    ];
  }

  it("同一天三函数对账：会话数 / token / 成本 / messages 逐字段相等，summary 与天 facts 同构", () => {
    const inputs = mixedInputs();
    const facts = cellOf(buildUsageCalendar(inputs, NOW), day1);
    const detail = daySessionsOf(inputs, day1);
    const timeline = dayTimelineOf(inputs, day1);

    // 1 + 2. 会话数与 token 三处恒等。
    expect(timeline.sessions.length).toBe(timeline.summary.sessions);
    expect(timeline.summary.sessions).toBe(detail.sessions);
    expect(timeline.summary.sessions).toBe(facts.sessions);
    const sessionTokens = timeline.sessions.reduce((sum, session) => sum + session.tokens, 0);
    expect(sessionTokens).toBe(timeline.summary.tokens);
    expect(timeline.summary.tokens).toBe(detail.dayTokens);
    expect(timeline.summary.tokens).toBe(facts.tokens);

    // 3. summary 与 buildUsageCalendar 的天 facts 逐字段（成本浮点容差，口径同构）。
    expect(timeline.summary.costUsd).toBeCloseTo(facts.costUsd, 10);
    expect(timeline.summary.hasUnknownCost).toBe(facts.hasUnknownCost);
    expect(timeline.summary.messages).toBe(facts.messages);

    // 4. firstTs / lastTs 与 sessions 的 min / max。
    expect(timeline.summary.firstTs).toBe(Math.min(...timeline.sessions.map((s) => s.startTs)));
    expect(timeline.summary.lastTs).toBe(Math.max(...timeline.sessions.map((s) => s.endTs)));

    // 5. 每条 Σ hourlyTokens === tokens；instant 判定精确式。
    for (const session of timeline.sessions) {
      expect(session.hourlyTokens.reduce((sum, value) => sum + value, 0)).toBe(session.tokens);
      expect(session.instant).toBe(session.endTs - session.startTs < 60_000);
    }

    // 6. 泳道：同泳道两两不重叠（effectiveEnd 口径）、max(lane) === laneCount − 1。
    const effectiveEndOf = (session: (typeof timeline.sessions)[number]) =>
      session.instant ? session.startTs + 60_000 : session.endTs;
    const byLane = new Map<number, typeof timeline.sessions>();
    for (const session of timeline.sessions) {
      byLane.set(session.lane, [...(byLane.get(session.lane) ?? []), session]);
    }
    for (const group of byLane.values()) {
      const sorted = [...group].sort((a, b) => a.startTs - b.startTs);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(effectiveEndOf(sorted[index - 1])).toBeLessThanOrEqual(sorted[index].startTs);
      }
    }
    expect(Math.max(...timeline.sessions.map((session) => session.lane))).toBe(
      timeline.laneCount - 1
    );

    // 7. projectSlots 的 Σ tokens === summary.tokens（other 桽尾合并所有第 6+ 项目）。
    expect(timeline.projectSlots.reduce((sum, slot) => sum + slot.tokens, 0)).toBe(
      timeline.summary.tokens
    );

    // 8. daySessionsOf 的行成员与 timeline 的条成员同集（同一天同身份键）。
    expect(new Set(detail.rows.map((row) => row.path))).toEqual(
      new Set(timeline.sessions.map((session) => session.path))
    );
  });

  it("输入顺序无关：打乱 inputs 与记录顺序，输出逐字段相等", () => {
    const baseline = dayTimelineOf(mixedInputs(), day1);
    const [a, b, c, d] = mixedInputs();
    const shuffled = dayTimelineOf(
      [
        { ...d, records: [...d.records].reverse() },
        { ...c, records: [...c.records].reverse() },
        { ...b, records: [...b.records].reverse() },
        { ...a, records: [...a.records].reverse() }
      ],
      day1
    );

    // sessions 数组逐字段（排序键含 startTs / title / path，打乱后序不变）。
    expect(shuffled.sessions).toEqual(baseline.sessions);
    expect(shuffled.laneCount).toBe(baseline.laneCount);
    expect(shuffled.projectSlots).toEqual(baseline.projectSlots);
    expect(shuffled.summary.sessions).toBe(baseline.summary.sessions);
    expect(shuffled.summary.tokens).toBe(baseline.summary.tokens);
    expect(shuffled.summary.messages).toBe(baseline.summary.messages);
    expect(shuffled.summary.firstTs).toBe(baseline.summary.firstTs);
    expect(shuffled.summary.lastTs).toBe(baseline.summary.lastTs);
    expect(shuffled.summary.topModel).toBe(baseline.summary.topModel);
    expect(shuffled.summary.projects).toBe(baseline.summary.projects);
    expect(shuffled.summary.hasUnknownCost).toBe(baseline.summary.hasUnknownCost);
    expect(shuffled.summary.costUsd).toBeCloseTo(baseline.summary.costUsd, 10);
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
