import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { StackedBar } from "./charts/StackedBar";
import type { CompactionStats } from "./compactionStats";
import styles from "./CompactionStatsPanel.module.css";

/**
 * 用量总览「压缩统计」面板（design §4）：读数 → 占比 → 去哪了 的一条横向
 * 叙事，因此住满 board 的第三行整行。周期内 0 次时面板保留（切时间档不闪
 * 没），体是一行事实文字——不画三根 0 柱、不画空堆叠条。
 */
export function CompactionStatsPanel({
  stats,
  days,
  onOpenSession
}: {
  stats: CompactionStats;
  days: number;
  /**
   * top3 行点击 → 打开会话分析并落到该会话（用量页与取证页的握手）。
   * 缺省（单测直挂组件时）行仍列出，只是不可点。
   */
  onOpenSession?: (session: SessionMeta) => void;
}) {
  return (
    <Panel
      title="压缩（上下文重置）"
      ariaLabel="压缩（上下文重置）"
      actions={<ProvenanceBadge provenance="logged" />}
    >
      {stats.count === 0 ? (
        <p className={styles.zeroState}>{`近 ${days} 天没有压缩记录——没有会话触发过上下文重置。`}</p>
      ) : (
        <>
          <div className={styles.statsRow}>
            <div className={styles.reading}>
              <span className={styles.readingLabel}>压缩次数</span>
              <span className={styles.readingValue}>
                {stats.count.toLocaleString("en-US")}
              </span>
            </div>
            <div className={styles.reading}>
              <span className={styles.readingLabel}>累计丢弃</span>
              <span className={styles.readingValue}>{`${formatTokenCount(stats.droppedTokens)} tok`}</span>
            </div>
            <div className={styles.reading}>
              <span className={styles.readingLabel}>触发会话</span>
              <span className={styles.readingValue}>
                {`${stats.sessions.toLocaleString("en-US")} 个`}
              </span>
            </div>
            <div className={styles.distribution}>
              <StackedBar
                data={[
                  { label: "自动", value: stats.autoCount },
                  { label: "手动", value: stats.manualCount }
                ]}
                ariaLabel="压缩触发方式分布"
                formatValue={(value) => `${value} 次`}
                /* 槽位经验证（design §1-8）：chart-1 × chart-4，两主题 CVD ΔE 21–24；
                   相邻的 chart-1/2 深色下塌缩（3.7），不许用。 */
                palette={[
                  { fill: "var(--chart-1-soft)", stroke: "var(--chart-1)" },
                  { fill: "var(--chart-4-soft)", stroke: "var(--chart-4)" }
                ]}
              />
              <ul className={styles.legend}>
                <li>
                  <span className={styles.legendSwatchAuto} aria-hidden="true" />
                  {`自动 ${stats.autoCount.toLocaleString("en-US")}`}
                </li>
                <li>
                  <span className={styles.legendSwatchManual} aria-hidden="true" />
                  {`手动 ${stats.manualCount.toLocaleString("en-US")}`}
                </li>
              </ul>
            </div>
          </div>
          {stats.topSessions.length > 0 ? (
            <ul className={styles.topSessions} aria-label="丢弃最多的会话">
              {stats.topSessions.map((slice, index) => {
                const reading = `${slice.count} 次 · ${formatTokenCount(slice.droppedTokens)}`;
                return (
                  <li key={`${slice.label}-${index}`}>
                    {slice.session && onOpenSession ? (
                      <button
                        type="button"
                        className={styles.topRow}
                        title={`打开会话分析：${slice.label}`}
                        onClick={() => onOpenSession(slice.session!)}
                      >
                        <span className={styles.topDiamond} aria-hidden="true">
                          ◆
                        </span>
                        <span className={styles.topName}>{slice.label}</span>
                        <span className={styles.topValue}>{reading}</span>
                      </button>
                    ) : (
                      <span className={styles.topRowStatic}>
                        <span className={styles.topDiamond} aria-hidden="true">
                          ◆
                        </span>
                        <span className={styles.topName}>{slice.label}</span>
                        <span className={styles.topValue}>{reading}</span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className={styles.narrative}>
            压缩把已积累的上下文重写为摘要；重读的上下文计入缓存读取，是消耗大头之一。
          </p>
        </>
      )}
    </Panel>
  );
}
