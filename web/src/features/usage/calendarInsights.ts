import { addLocalDays, dayStartOf } from "./usageAggregations";
import type { CalendarDayFacts, UsageCalendar } from "./usageCalendar";

/**
 * 「一年洞察」（Issue #199，Round V 第三棒）：消耗日历面板里六句实事的纯数据层
 * ——最长连胜 / 当前连胜 / 最贵一天 / 最长空白 / 活跃占比 / 本月环比。
 *
 * 输入吃现成的 `UsageCalendar`（页面已有 memo），**零新增数据通道**：六句要的
 * 数字全在 `cells` 的 `CalendarDayFacts` 里。「有消耗」判定 = `costUsd > 0`，
 * 与格子 0 档同一口径——用户对着格子数连胜数的是有色格，全 unknown 定价的天
 * （有 token 但成本未知）不算有消耗，两套口径会让「数字对上格子」的核对
 * 闭环破裂。并列一律取最近段：滚动窗口的首段可能被裁断（`touchesWindowStart`
 * 标记），近段的数据完整性总是更好。
 */

/** 一段连续区间（连胜或空白）；单日段 startDay === endDay。 */
export type InsightSpan = {
  days: number;
  startDay: number;
  endDay: number;
  /** 段起点 === 窗口第一天：真实长度可能延续到窗口外，渲染时 title 注明。 */
  touchesWindowStart: boolean;
};

/** 当前连胜的三态（「有消耗」= costUsd > 0）。 */
export type CurrentStreak =
  | { kind: "active"; days: number; startDay: number } // 今天有消耗
  | { kind: "pending"; days: number; startDay: number; endDay: number } // 今天没有，昨天往前连续
  | { kind: "broken"; lastActiveDay: number; idleDays: number }; // 昨天也没有

/** 本月 vs 上月同期（等长对齐窗口）。 */
export type MonthCompare = {
  /** 对齐天数 N = min(今天几号, 上月天数)。 */
  days: number;
  /** 本月第 1..N 天的 costUsd 之和。 */
  currentUsd: number;
  /** 上月第 1..N 天的 costUsd 之和。 */
  previousUsd: number;
};

export type CalendarInsights = {
  /** 窗口内最长连胜；全年无消耗天为 null（空态）。并列取最近段。 */
  longestStreak: InsightSpan | null;
  /** 三态之一；全年无消耗时为 broken 的哨兵（lastActiveDay: null，渲染层走空态）。 */
  currentStreak:
    | CurrentStreak
    | { kind: "broken"; lastActiveDay: null; idleDays: 0 };
  /** 最贵一天；全空年为 null。并列取最近。 */
  peakDay: { dayStart: number; costUsd: number } | null;
  /** 最长空白；365 天全有消耗为 null（理论态，真实不可达）。并列取最近段。 */
  longestGap: InsightSpan | null;
  /** 窗口天数从天格实数（恒 365，但不断字面量——窗口变长时口径跟着走）。 */
  activeDays: { days: number; total: number };
  /** 永远可算（纯日历数学）；空态由渲染层处理。 */
  monthCompare: MonthCompare;
};

/** 连续段扫描的中间态（无 touchesWindowStart——它要对着窗口首日判）。 */
type RunState = { days: number; startDay: number; endDay: number };

/**
 * 从 `calendar.cells` 拍平出升序的窗口内天格（pad 丢弃）。显式排序而不是信任
 * cells 的内部顺序：`buildUsageCalendar` 保证升序，但等价重排（同 facts 不同
 * 顺序）的 calendar 必须给出同一份洞察——顺序无关由这里兜底。
 */
function dayFactsOf(calendar: UsageCalendar): CalendarDayFacts[] {
  const days: CalendarDayFacts[] = [];
  for (const column of calendar.cells) {
    for (const cell of column) {
      if (cell.kind === "day") days.push(cell);
    }
  }
  days.sort((a, b) => a.dayStart - b.dayStart);
  return days;
}

/**
 * 最长连续段（连胜与空白是同一个扫描器换判定谓词）。比较键：days 降序 →
 * endDay 降序——days 相同的连续段 endDay 必不同，无第三键；「并列取最近」
 * 的裁决就落在这第二个键上。连续性按日历日判定（addLocalDays），不按数组
 * 相邻——后者在 dayStart 有洞时会误连。
 */
function longestRunOf(
  dayFacts: readonly CalendarDayFacts[],
  isActive: (facts: CalendarDayFacts) => boolean
): RunState | null {
  let best: RunState | null = null;
  let run: RunState | null = null;
  for (const facts of dayFacts) {
    if (isActive(facts)) {
      run =
        run !== null && addLocalDays(run.endDay, 1) === facts.dayStart
          ? { days: run.days + 1, startDay: run.startDay, endDay: facts.dayStart }
          : { days: 1, startDay: facts.dayStart, endDay: facts.dayStart };
    } else {
      run = null;
    }
    if (
      run !== null &&
      (best === null ||
        run.days > best.days ||
        (run.days === best.days && run.endDay > best.endDay))
    ) {
      best = run;
    }
  }
  return best;
}

/** 两个本地日之间的天数差。逐日历日计数（addLocalDays）——DST 日不等长，ms 除法会漂。 */
function daysBetween(fromDay: number, toDay: number): number {
  let count = 0;
  let cursor = fromDay;
  while (cursor < toDay) {
    cursor = addLocalDays(cursor, 1);
    count += 1;
  }
  return count;
}

export function calendarInsightsOf(
  calendar: UsageCalendar,
  now: number
): CalendarInsights {
  const dayFacts = dayFactsOf(calendar);
  const firstDay = dayFacts[0].dayStart;
  const lastDay = dayFacts[dayFacts.length - 1].dayStart;
  const costByDay = new Map<number, number>();
  for (const facts of dayFacts) costByDay.set(facts.dayStart, facts.costUsd);
  const isActive = (facts: CalendarDayFacts): boolean => facts.costUsd > 0;

  // 公式 1 / 4：最长连胜与最长空白——同一个扫描器，「有消耗」与它的补集。
  // touchesWindowStart = 段起点落在窗口首日（真实长度是下界，title 注明）。
  const spanOf = (run: RunState | null): InsightSpan | null =>
    run === null
      ? null
      : {
          days: run.days,
          startDay: run.startDay,
          endDay: run.endDay,
          touchesWindowStart: run.startDay === firstDay
        };
  const longestStreak = spanOf(longestRunOf(dayFacts, isActive));
  const longestGap = spanOf(longestRunOf(dayFacts, (facts) => !isActive(facts)));

  // 公式 2：当前连胜的三态。「今天」必须是生成这份 calendar 的同一个 now 的
  // dayStart（跨天挂机的理论边界下不在窗口内，按窗口最后一天算——正常不可达，
  // 传参约定由调用方保证两个值同源）。
  let today = dayStartOf(now);
  if (today < firstDay || today > lastDay) today = lastDay;
  const activeOn = (dayStart: number): boolean => (costByDay.get(dayStart) ?? 0) > 0;
  const runBackwardsFrom = (startDay: number): RunState => {
    let cursor = startDay;
    while (activeOn(addLocalDays(cursor, -1))) cursor = addLocalDays(cursor, -1);
    return { days: daysBetween(cursor, startDay) + 1, startDay: cursor, endDay: startDay };
  };

  let currentStreak: CalendarInsights["currentStreak"];
  if (activeOn(today)) {
    const run = runBackwardsFrom(today);
    currentStreak = { kind: "active", days: run.days, startDay: run.startDay };
  } else if (activeOn(addLocalDays(today, -1))) {
    // pending 不说「已断」：午夜之前今天永远可能产生新记录，「今天还没有
    // 消耗」是事实的全部（quotaReadout「没有数据 ≠ 读了是零」的同款立场）。
    const run = runBackwardsFrom(addLocalDays(today, -1));
    currentStreak = {
      kind: "pending",
      days: run.days,
      startDay: run.startDay,
      endDay: run.endDay
    };
  } else {
    let lastActive: number | null = null;
    for (const facts of dayFacts) {
      if (isActive(facts)) lastActive = facts.dayStart;
    }
    currentStreak =
      lastActive === null
        ? { kind: "broken", lastActiveDay: null, idleDays: 0 } // 全空年的哨兵：整区走空态
        : { kind: "broken", lastActiveDay: lastActive, idleDays: daysBetween(lastActive, today) };
  }

  // 公式 3：最贵一天。costUsd 降序 → dayStart 降序（并列取最近），无 active 天为 null。
  let peakDay: CalendarInsights["peakDay"] = null;
  for (const facts of dayFacts) {
    if (!isActive(facts)) continue;
    if (
      peakDay === null ||
      facts.costUsd > peakDay.costUsd ||
      (facts.costUsd === peakDay.costUsd && facts.dayStart > peakDay.dayStart)
    ) {
      peakDay = { dayStart: facts.dayStart, costUsd: facts.costUsd };
    }
  }

  // 公式 5：活跃占比。total 从天格实数，不写字面量。
  const activeDays = {
    days: dayFacts.reduce((count, facts) => (isActive(facts) ? count + 1 : count), 0),
    total: dayFacts.length
  };

  // 公式 6：本月前 N 天 vs 上月同期 N 天（等长对齐窗，不拿部分月比完整月——
  // 那是日历的形状不是行为变化）。全走日历分量（照 clockAt 的做法，不用 ms
  // 数学）：上月末回退「上月几号 − 1」天就是上月 1 号，两个区间各自从月首
  // 对齐取 N 天，两端闭区间。
  const todayDate = new Date(today);
  const monthStart = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1).getTime();
  const lastMonthEnd = addLocalDays(monthStart, -1);
  const lastMonthDays = new Date(lastMonthEnd).getDate();
  const n = Math.min(todayDate.getDate(), lastMonthDays);
  const sumRange = (startDay: number, days: number): number => {
    let sum = 0;
    for (let index = 0; index < days; index += 1) {
      sum += costByDay.get(addLocalDays(startDay, index)) ?? 0;
    }
    return sum;
  };
  const prevStart = addLocalDays(lastMonthEnd, -(lastMonthDays - 1));
  const monthCompare: MonthCompare = {
    days: n,
    currentUsd: sumRange(monthStart, n),
    previousUsd: sumRange(prevStart, n)
  };

  return { longestStreak, currentStreak, peakDay, longestGap, activeDays, monthCompare };
}
