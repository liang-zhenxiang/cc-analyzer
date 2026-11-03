import { useEffect, useState } from "react";
import { freshnessOf, type FreshnessBadgeModel } from "./freshness";
import styles from "./FreshnessBadge.module.css";

const TICK_MS = 30_000;

/**
 * 相对时刻分级：旧数据不再印「435215 分钟前」这种噪声。
 *
 * 分档以「人一眼能换算成时间」为准：60 分钟内保留分钟（本次会话的新鲜度），
 * 一天内给小时，一周内给天；再旧就印日期——「7 天前」与「3 周前」对判断
 * 「这份数据还能不能用」已经没有区别，日期反而能直接对上日历。
 *
 * 跨年时补全年份：只写 `1-5` 会让人分不清是今年还是去年。
 */
function relativeText(model: FreshnessBadgeModel, lastRecordAt: number, now: number): string {
  const minutes = model.minutesAgo;
  if (minutes === null) return "";
  if (minutes === 0) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} 小时前`;
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / (24 * 60))} 天前`;

  const date = new Date(lastRecordAt);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if (date.getFullYear() !== new Date(now).getFullYear()) {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(month)}-${pad(day)}`;
  }
  return `${month}-${day}`;
}

/**
 * E9: "how old is what I am looking at", next to the page title.
 *
 * The label comes from `freshnessOf` (Round EE model layer) so "数据截至" and
 * the relative minutes cannot disagree with each other. The dot tier is a
 * presentation mapping on top of `staleness`: the model's 5-minute line is the
 * *badge* threshold, while the amber/red split (10 min / 1 h) is about how
 * loudly to say it.
 *
 * A running scan is its own state: printing a fresh "数据截至" while the list
 * is being rewritten would be a lie, so it says 「刷新中…（上次 HH:MM）」.
 */
export function FreshnessBadge({
  lastRecordAt,
  lastScanAt,
  scanning = false,
  now
}: {
  lastRecordAt: number | null;
  lastScanAt: number | null;
  scanning?: boolean;
  /** Injected clock (tests, or a page that already ticks). Omitted → 30s tick. */
  now?: number;
}) {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    if (now !== undefined) return;
    const timer = window.setInterval(() => setTick(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [now]);

  const at = now ?? tick;
  const model = freshnessOf(at, lastRecordAt, lastScanAt);

  if (scanning) {
    return (
      <span className={styles.badge} data-probe="data-freshness" data-state="scanning">
        <i className={styles.dot} aria-hidden="true" />
        {lastScanAt === null ? "刷新中…" : `刷新中…（上次 ${clockOf(lastScanAt)}）`}
      </span>
    );
  }

  const dotState =
    model.staleness === "unknown"
      ? "unknown"
      : model.staleness === "fresh"
        ? "fresh"
        : model.minutesAgo !== null && model.minutesAgo > 60
          ? "old"
          : "stale";
  const text =
    model.staleness === "unknown" || lastRecordAt === null
      ? model.label
      : `${model.label}（${relativeText(model, lastRecordAt, at)}）`;

  return (
    <span
      className={styles.badge}
      data-probe="data-freshness"
      data-state={dotState}
      title={model.hint || text}
    >
      <i className={styles.dot} aria-hidden="true" />
      {text}
    </span>
  );
}

/** Local clock face, same construction as `freshnessOf` (no locale). */
function clockOf(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
