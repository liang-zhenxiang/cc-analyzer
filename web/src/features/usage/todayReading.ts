import { localDayKey, type StoryDay } from "./storyLog";

/**
 * 首屏「今天」读数（Issue #342）：用户打开应用最想知道「我今天用了多少」，
 * 但工作日志第一行权重太低。这里只做一件事——从 `storyLog` 的输出里挑出
 * **本地今天**那一行，交给 KPI 的第一格。
 *
 * 口径全部复用 storyLog，不另算一遍：会话归属开工日、tokens 四计数器之和、
 * 消息判定（user/assistant 且非 compactSummary）都已是那边的既定规则。
 * 因此「今天」说的是「今天开工的会话」，与工作日志第一行逐字一致。
 *
 * 首项不是今天（窗口里只有更早的日子）时返回 0，而不是隐藏整格：KPI 行
 * 固定 5 列，少一格会让布局塌陷跳动。今天没有记录本身也是一个诚实的读数。
 */
export type TodayReading = {
  tokens: number;
  sessions: number;
  messages: number;
};

const ZERO: TodayReading = { tokens: 0, sessions: 0, messages: 0 };

/**
 * `days` 必须是 `storyLog` 的输出（按日期倒序）。只认第一项：它就是最新一天；
 * 用本地自然日的 `YYYY-MM-DD` 键与 `now` 比较，跨本地日边界不会错位。
 */
export function todayReadingOf(days: readonly StoryDay[], now: number): TodayReading {
  const first = days[0];
  if (!first || first.date !== localDayKey(now)) return ZERO;
  return {
    tokens: first.tokens,
    sessions: first.sessions,
    messages: first.messages
  };
}
