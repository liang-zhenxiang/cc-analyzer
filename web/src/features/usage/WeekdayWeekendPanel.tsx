import { useMemo } from "react";
import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import { weekdayWeekendOf, type WeekdaySideStats } from "./weekdayWeekend";
import styles from "./WeekdayWeekendPanel.module.css";

/**
 * I2 工作日 vs 周末（实验室档，收工推演之后）。
 *
 * 模型只做分组与日均（分母固定 5 / 2 天），界面补两件模型不负责的事：
 *   - 空侧写 `—` 而不是 0：过去 7 天没有周末记录，不等于「周末消耗为 0」；
 *   - 空侧脚注点名：「过去 N 天没有周末记录」。
 * 活跃小时按「该会话里出现过记录的本地小时」去重，不是墙钟跨度——
 * 一条横跨午夜的会话会被算成它真正干活的那些小时。
 */

function sideRow(key: "weekday" | "weekend", side: WeekdaySideStats) {
  const label = key === "weekday" ? "工作日" : "周末";
  const empty = side.sessions === 0;
  return (
    <tr data-probe="workday-row" data-group={key}>
      <th scope="row">{label}</th>
      <td className={styles.num}>{empty ? "—" : formatTokenCount(side.tokens)}</td>
      <td className={styles.num}>{side.sessions.toLocaleString("en-US")}</td>
      <td className={styles.num}>{empty ? "—" : side.activeHours.toFixed(1)}</td>
      <td className={styles.num}>{empty ? "—" : side.avgHoursPerDay.toFixed(1)}</td>
    </tr>
  );
}

export function WeekdayWeekendPanel({
  inputs,
  days,
  now
}: {
  inputs: readonly UsageSessionInput[];
  days: number;
  now: number;
}) {
  const { split, hasWeekend, hasWeekday } = useMemo(() => {
    const startTs = addLocalDays(dayStartOf(now), -(Math.max(1, Math.floor(days)) - 1));
    const sessions = inputs.flatMap((input) => {
      const records = input.records.filter((record) => record.timestamp >= startTs);
      if (records.length === 0) return [];
      let tokens = 0;
      const activeHours = new Set<number>();
      let start = Number.POSITIVE_INFINITY;
      for (const record of records) {
        start = Math.min(start, record.timestamp);
        activeHours.add(new Date(record.timestamp).getHours());
        const usage = record.usage;
        if (!usage) continue;
        tokens +=
          (usage.inputTokens ?? 0) +
          (usage.outputTokens ?? 0) +
          (usage.cacheCreationTokens ?? 0) +
          (usage.cacheReadTokens ?? 0);
      }
      return [{ startTimestamp: start, tokens, activeHours }];
    });

    const result = weekdayWeekendOf(sessions);
    return {
      split: result,
      hasWeekday: (result?.weekday.sessions ?? 0) > 0,
      hasWeekend: (result?.weekend.sessions ?? 0) > 0
    };
  }, [inputs, days, now]);

  return (
    <Panel
      title="工作日 vs 周末"
      ariaLabel="工作日 vs 周末"
      actions={<ProvenanceBadge provenance="logged" />}
    >
      {split === null ? (
        <p className={styles.empty}>这一窗没有可对照的会话</p>
      ) : (
        <>
          <table className={styles.table} data-probe="workday-split">
            <caption className={styles.caption}>工作日与周末的消耗对照</caption>
            <thead>
              <tr>
                <th scope="col">分组</th>
                <th scope="col">Token</th>
                <th scope="col">会话</th>
                <th scope="col">活跃小时</th>
                <th scope="col">日均活跃小时</th>
              </tr>
            </thead>
            <tbody>
              {sideRow("weekday", split.weekday)}
              {sideRow("weekend", split.weekend)}
            </tbody>
          </table>
          <p className={styles.note}>
            按本地日历日分组；日均活跃小时的分母固定 5 天 / 2 天（按每周 5/2 天折算）。
            {!hasWeekend ? ` 过去 ${days} 天没有周末记录。` : ""}
            {!hasWeekday ? ` 过去 ${days} 天没有工作日记录。` : ""}
          </p>
        </>
      )}
    </Panel>
  );
}
