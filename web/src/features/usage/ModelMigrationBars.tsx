import { useMemo } from "react";
import { dayStartOf, formatDayLabel, totalsSum } from "./usageAggregations";
import { formatModelId } from "../../lib/format";
import type { ModelGapFlag, ModelTimelineEntry } from "./modelTimeline";
import styles from "./ModelMigrationBars.module.css";

const DAY_MS = 86_400_000;
const ROW_LIMIT = 6;
const OTHER_LABEL = "其他";

/**
 * E6: when did I move from one model to another.
 *
 * Rows are models (up to six, the tail folded into 「其他」) sorted by first
 * use — reading top-down is reading left-to-right in time. Each bar spans the
 * model's first→last use *inside the selected window*, so switching the range
 * answers the same question at a different zoom.
 *
 * Colours reuse the model legend's index (`--chart-N`) so the same model keeps
 * the same colour in the share chart and here. Every bar also carries its name
 * and dates as text: colour is never the only channel.
 */
export function ModelMigrationBars({
  entries,
  gapFlags,
  colors,
  start,
  end
}: {
  entries: readonly ModelTimelineEntry[];
  gapFlags: readonly ModelGapFlag[];
  /** Model → 1..6 chart colour index, from the share chart's legend order. */
  colors: ReadonlyMap<string, number>;
  /** Window start (inclusive, local midnight). */
  start: number;
  /** Window end (exclusive, local midnight after the last day). */
  end: number;
}) {
  const span = Math.max(1, end - start);

  const rows = useMemo(() => {
    const sorted = [...entries].sort(
      (a, b) => a.first - b.first || a.model.localeCompare(b.model)
    );
    if (sorted.length <= ROW_LIMIT) return sorted.map((entry) => ({ entry, isOther: false }));
    const head = sorted
      .slice()
      .sort((a, b) => totalsSum(b.tokens) - totalsSum(a.tokens) || a.model.localeCompare(b.model))
      .slice(0, ROW_LIMIT - 1);
    const headModels = new Set(head.map((entry) => entry.model));
    const tail = sorted.filter((entry) => !headModels.has(entry.model));
    const other: ModelTimelineEntry = {
      model: OTHER_LABEL,
      first: Math.min(...tail.map((entry) => entry.first)),
      last: Math.max(...tail.map((entry) => entry.last)),
      sessions: tail.reduce((sum, entry) => sum + entry.sessions, 0),
      tokens: tail.reduce(
        (sum, entry) => {
          sum.input += entry.tokens.input;
          sum.output += entry.tokens.output;
          sum.cacheCreation += entry.tokens.cacheCreation;
          sum.cacheRead += entry.tokens.cacheRead;
          return sum;
        },
        { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
      )
    };
    return [...head, other]
      .sort((a, b) => a.first - b.first || a.model.localeCompare(b.model))
      .map((entry) => ({ entry, isOther: entry.model === OTHER_LABEL }));
  }, [entries]);

  if (rows.length === 0) {
    return <p className={styles.empty}>所选范围内还没有模型使用记录</p>;
  }
  if (rows.length === 1) {
    return <p className={styles.empty}>所选范围内只有一个模型，没有迁移可画</p>;
  }

  const percent = (ms: number) => ((ms - start) / span) * 100;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));

  // A handover line is drawn where the next row starts after the previous row
  // ended — that instant is the "I switched" moment the whole card is about.
  const handovers: number[] = [];
  let previousEnd = Number.NEGATIVE_INFINITY;
  for (const { entry } of rows) {
    if (entry.first > previousEnd && previousEnd !== Number.NEGATIVE_INFINITY) {
      handovers.push(entry.first);
    }
    previousEnd = Math.max(previousEnd, entry.last);
  }

  const axis = [start, start + (end - start) / 2, end - 1];
  const summary = rows
    .map(({ entry }) => {
      const from = formatDayLabel(dayStartOf(Math.max(entry.first, start)));
      const to = formatDayLabel(dayStartOf(Math.min(entry.last, end - 1)));
      return `${formatModelId(entry.model)} ${from} 至 ${to}`;
    })
    .join("；");

  return (
    <div className={styles.wrap} data-probe="model-migration">
      <div className={styles.chart} role="img" aria-label={`模型迁移：${summary}`}>
        {rows.map(({ entry, isOther }) => {
          const left = clamp(percent(Math.max(entry.first, start)));
          const right = clamp(percent(Math.min(entry.last + DAY_MS, end)));
          const width = Math.max(0, right - left);
          const colorIndex = isOther ? 0 : (colors.get(entry.model) ?? 1);
          const barStyle = isOther
            ? { left: `${left}%`, width: `max(${width}%, 2px)`, background: "var(--text-tertiary)" }
            : {
                left: `${left}%`,
                width: `max(${width}%, 2px)`,
                background: `var(--chart-${colorIndex}, var(--accent))`
              };
          const from = formatDayLabel(dayStartOf(Math.max(entry.first, start)));
          const to = formatDayLabel(dayStartOf(Math.min(entry.last, end - 1)));
          return (
            <div className={styles.row} key={entry.model}>
              <span className={styles.label} title={entry.model}>
                <span className={styles.model}>{formatModelId(entry.model)}</span>
                <span className={styles.dates}>
                  {from} – {to}
                </span>
              </span>
              <span className={styles.track}>
                <span className={styles.bar} style={barStyle} data-probe="migration-bar" />
                {gapFlags
                  .filter((flag) => flag.model === entry.model)
                  .map((flag) => {
                    const gapLeft = clamp(percent(Math.max(flag.from, start)));
                    const gapRight = clamp(percent(Math.min(flag.to, end)));
                    return (
                      <span
                        className={styles.gap}
                        key={`${flag.model}-${flag.from}`}
                        style={{
                          left: `${gapLeft}%`,
                          width: `${Math.max(0, gapRight - gapLeft)}%`
                        }}
                        data-probe="migration-gap"
                      />
                    );
                  })}
              </span>
            </div>
          );
        })}
        <span className={styles.overlay} aria-hidden="true">
          {handovers.map((ms) => (
            <span
              className={styles.handover}
              key={`handover-${ms}`}
              data-probe="migration-handover"
              style={{ left: `${clamp(percent(ms))}%` }}
            />
          ))}
        </span>
      </div>
      <div className={styles.axis} aria-hidden="true">
        {axis.map((ms, index) => (
          <span key={index}>{formatDayLabel(dayStartOf(ms))}</span>
        ))}
      </div>
    </div>
  );
}
