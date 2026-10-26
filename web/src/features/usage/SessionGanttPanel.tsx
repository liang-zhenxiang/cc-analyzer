import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { formatDayLabel, dayStartOf, addLocalDays, type UsageSessionInput } from "./usageAggregations";
import { sessionTitle, type SessionMeta } from "../sessions/metadataCache";
import { buildGantt } from "./sessionGantt";
import { useFontScale } from "../settings/fontScale";
import styles from "./SessionGanttPanel.module.css";

/**
 * 「会话甘特」（D7）：把窗口内的会话按真实时间画成条，重叠处能直接看出来。
 *
 * 横轴取**画出来的这些会话的区间**（模型层的 `spanStart/spanEnd`），不是窗口
 * 端点：一个 30 天窗口里只有两小时有会话时，按窗口画会把两条压成两根针。
 * 行数按字号收敛（130% 只画 7 行），多的在脚注里报数。
 */

function buildTicks(spanStart: number, spanEnd: number, days: number): number[] {
  const ticks: number[] = [];
  if (!(spanEnd > spanStart)) return ticks;
  if (days <= 7) {
    for (let cursor = dayStartOf(spanStart); cursor <= spanEnd; cursor = addLocalDays(cursor, 1)) {
      ticks.push(cursor);
    }
    return ticks;
  }
  if (days <= 30) {
    let cursor = dayStartOf(spanStart);
    const weekday = new Date(cursor).getDay();
    cursor = addLocalDays(cursor, -((weekday + 6) % 7));
    for (; cursor <= spanEnd; cursor = addLocalDays(cursor, 7)) ticks.push(cursor);
    return ticks;
  }
  const first = new Date(dayStartOf(spanStart));
  first.setDate(1);
  let cursor = dayStartOf(first.getTime());
  while (cursor <= spanEnd) {
    ticks.push(cursor);
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    cursor = dayStartOf(next.getTime());
  }
  return ticks;
}

export function SessionGanttPanel({
  inputs,
  days,
  now,
  onOpenSession
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now?: number;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const [mountedNow] = useState(() => Date.now());
  const tick = now ?? mountedNow;
  const fontScale = useFontScale();
  const rowLimit = fontScale > 1.2 ? 7 : 12;
  const gantt = useMemo(() => buildGantt(inputs, tick), [inputs, tick]);
  const rows = gantt.rows.slice(0, rowLimit);
  const hiddenRows = gantt.rows.length - rows.length;
  const span = Math.max(1, gantt.spanEnd - gantt.spanStart);
  const ticks = useMemo(
    () => buildTicks(gantt.spanStart, gantt.spanEnd, days),
    [gantt.spanStart, gantt.spanEnd, days]
  );

  // 模型层的行不带 SessionMeta；用「起止 + 标题」回到原会话，找不到就不给点。
  const metaOfRow = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const input of inputs) {
      if (!input.session || input.records.length === 0) continue;
      let start = Number.POSITIVE_INFINITY;
      let end = Number.NEGATIVE_INFINITY;
      for (const record of input.records) {
        start = Math.min(start, record.timestamp);
        end = Math.max(end, record.timestamp);
      }
      map.set(`${start}|${end}|${sessionTitle(input.session)}`, input.session);
    }
    return map;
  }, [inputs]);

  const overlapping = gantt.maxOverlaps > 0;

  return (
    <Panel
      title="会话甘特"
      ariaLabel="会话甘特"
      actions={<span className={styles.scope}>{`${gantt.rows.length} 个会话`}</span>}
    >
      {gantt.rows.length === 0 ? (
        <p className={styles.empty}>本窗口还没有会话</p>
      ) : (
        <div className={styles.chart} data-probe="gantt">
          {gantt.rows.length === 1 ? <p className={styles.note}>本窗口只有 1 个会话</p> : null}
          <div className={styles.axis} aria-hidden="true">
            {ticks.map((value) => (
              <span
                key={value}
                className={styles.axisLabel}
                style={{ left: `${((value - gantt.spanStart) / span) * 100}%` }}
              >
                {formatDayLabel(value)}
              </span>
            ))}
          </div>
          <div className={styles.body}>
            {ticks.map((value) => (
              <span
                key={value}
                className={styles.tick}
                aria-hidden="true"
                style={{ left: `${((value - gantt.spanStart) / span) * 100}%` }}
              />
            ))}
            {rows.map((row) => {
              const meta = metaOfRow.get(`${row.start}|${row.end}|${row.label}`);
              const left = ((row.start - gantt.spanStart) / span) * 100;
              const width = Math.max(0.22, ((row.end - row.start) / span) * 100);
              return (
                <button
                  type="button"
                  key={`${row.label}-${row.start}`}
                  className={styles.row}
                  data-probe="gantt-row"
                  aria-label={`${row.label}：${formatDayLabel(dayStartOf(row.start))} 起，${row.tokens.toLocaleString("en-US")} token${row.overlapCount > 0 ? "，与其它会话重叠" : ""}`}
                  onClick={meta && onOpenSession ? () => onOpenSession(meta) : undefined}
                >
                  <span className={styles.label} title={row.label}>
                    {row.label}
                  </span>
                  <span className={styles.track}>
                    <span
                      className={styles.bar}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </span>
                  {row.overlapCount > 0 ? (
                    <span className={styles.overlap} aria-hidden="true">
                      ∥
                    </span>
                  ) : (
                    <span className={styles.overlap} aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
          <p className={styles.footnote}>
            {overlapping
              ? "这些会话的时间区间有重合；条长按最小可见宽度画，∥ 标出并行的行。"
              : "横轴按这些会话的实际起止时间画。"}
            {hiddenRows > 0 ? `另有 ${hiddenRows} 个会话未画出，按开始时间排在后面。` : ""}
          </p>
        </div>
      )}
    </Panel>
  );
}
