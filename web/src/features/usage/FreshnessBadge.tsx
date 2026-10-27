import { useEffect, useState } from "react";
import { freshnessOf, type FreshnessBadgeModel } from "./freshness";
import styles from "./FreshnessBadge.module.css";

const TICK_MS = 30_000;

function minutesText(model: FreshnessBadgeModel): string {
  if (model.minutesAgo === null) return "";
  return model.minutesAgo === 0 ? "刚刚" : `${model.minutesAgo} 分钟前`;
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
    model.staleness === "unknown"
      ? model.label
      : `${model.label}（${minutesText(model)}）`;

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
