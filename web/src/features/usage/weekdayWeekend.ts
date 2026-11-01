/**
 * I2 工作日 vs 周末：把会话按本地日历日分成工作日（周一至周五）与周末
 * （周六日），各给会话数、token 总量与「平均每天活跃小时」。
 *
 * 口径：
 *   - 周末判定走**本地日历日**（`new Date(ts).getDay()`，0=周日、6=周六），
 *     与用量页热力图、aggregateSession 的本地日分桶一致；不用 UTC，否则
 *     东八区周日 0–8 点会被算成周六。
 *   - `activeHours` 是调用方给的「活跃整点集合」，合计取 `size`（同一小时
 *     只算一次，一天最多 24）。
 *   - `avgHoursPerDay` 的分母是**日历基准**：工作日 5 天、周末 2 天，与观测
 *     窗口里实际有几天活动无关。这样两栏可以直接对比「每个工作日/周末
 *     平均投入几小时」；如果按实际有活动的天数除，忙一天和忙五天会被抹平。
 *   - `activeHours` 缺省按 0 计，但平均仍除以天数——没有读数不等于没活跃，
 *     不拿 0 冒充「确实 0 小时」；界面应把「无数据」的会话标出来。
 *   - 两侧会话都为 0（含空输入、时间戳全部非法）返回 null。
 */

export type WeekdaySideStats = {
  sessions: number;
  tokens: number;
  activeHours: number;
  avgHoursPerDay: number;
};

export type WeekdayWeekendSplit = {
  weekday: WeekdaySideStats;
  weekend: WeekdaySideStats;
};

export type WeekdayWeekendSession = {
  startTimestamp: number;
  tokens: number;
  activeHours?: Set<number>;
};

/** 日历基准：工作日 5 天、周末 2 天。 */
export const WEEKDAY_CALENDAR_DAYS = 5;
export const WEEKEND_CALENDAR_DAYS = 2;

export function weekdayWeekendOf(
  sessions: readonly WeekdayWeekendSession[]
): WeekdayWeekendSplit | null {
  let weekdaySessions = 0;
  let weekdayTokens = 0;
  let weekdayHours = 0;
  let weekendSessions = 0;
  let weekendTokens = 0;
  let weekendHours = 0;

  for (const session of sessions) {
    if (!Number.isFinite(session.startTimestamp)) continue;
    const day = new Date(session.startTimestamp).getDay();
    const isWeekend = day === 0 || day === 6;
    const tokens = Number.isFinite(session.tokens) ? session.tokens : 0;
    const hours = session.activeHours?.size ?? 0;

    if (isWeekend) {
      weekendSessions += 1;
      weekendTokens += tokens;
      weekendHours += hours;
    } else {
      weekdaySessions += 1;
      weekdayTokens += tokens;
      weekdayHours += hours;
    }
  }

  if (weekdaySessions + weekendSessions === 0) return null;

  return {
    weekday: {
      sessions: weekdaySessions,
      tokens: weekdayTokens,
      activeHours: weekdayHours,
      avgHoursPerDay: weekdayHours / WEEKDAY_CALENDAR_DAYS
    },
    weekend: {
      sessions: weekendSessions,
      tokens: weekendTokens,
      activeHours: weekendHours,
      avgHoursPerDay: weekendHours / WEEKEND_CALENDAR_DAYS
    }
  };
}
