import type { SessionRecord } from "./types";

/**
 * The status dot's three states. A dot that is always on says nothing, so the
 * light must answer "why is it lit": today's activity, a failure inside the
 * session, or neither (just history).
 *
 * Errors win over recency: a session that ran today and also failed is more
 * usefully red than green — "recent" is ambient context, "broken" is actionable.
 */
export type SessionHealth = "has-errors" | "active-today" | "idle";

/** True when the record's timestamp falls on the same local calendar day as `now`. */
function isToday(timestamp: number, now: number): boolean {
  const record = new Date(timestamp);
  const today = new Date(now);
  return (
    record.getFullYear() === today.getFullYear() &&
    record.getMonth() === today.getMonth() &&
    record.getDate() === today.getDate()
  );
}

export function sessionHealth(
  records: readonly SessionRecord[],
  now: number = Date.now()
): SessionHealth {
  let hasToday = false;
  for (const record of records) {
    if (record.isError) return "has-errors";
    if (!hasToday && isToday(record.timestamp, now)) hasToday = true;
  }
  return hasToday ? "active-today" : "idle";
}

/** The dot's accessible text — the state must be readable, not just colored. */
export function sessionHealthText(health: SessionHealth): string {
  switch (health) {
    case "has-errors":
      return "含失败记录";
    case "active-today":
      return "今日活跃";
    case "idle":
      return "历史会话";
  }
}
