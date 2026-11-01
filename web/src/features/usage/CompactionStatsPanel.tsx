import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { StackedBar } from "./charts/StackedBar";
import { Sparkline } from "./Sparkline";
import type { CacheHealth } from "./cacheHealth";
import type { CompactionStats } from "./compactionStats";
import type { ContextQuantiles } from "./contextQuantiles";
import styles from "./CompactionStatsPanel.module.css";

/**
 * 分位读数的显示格式（design §G7 样例 42.1k / 131k / 196k）：
 * - < 1,000：原样（千分位是日级 KPI 的量级，不需要缩写）；
 * - < 1M：一位小数的 k，尾 0 去掉（131.0k → 131k）；
 * - ≥ 1M：交给 formatTokenCount（它的 1.2M 档从百万起，正好接住）。
 * formatTokenCount 没有 k 档（lib/format.ts），所以 k 档在这里本地实现。
 */
function formatQuantile(value: number): string {
  if (value < 1000) return value.toLocaleString("en-US");
  if (value < 1_000_000) {
    const k = (value / 1000).toFixed(1);
    return `${k.endsWith(".0") ? k.slice(0, -2) : k}k`;
  }
  return formatTokenCount(value);
}

/** H7 的方向词：模型给的是机器可读的枚举，界面只说人话，且不染色。 */
const CACHE_TREND_LABEL: Record<"improving" | "flat" | "declining", string> = {
  improving: "在变好",
  flat: "持平",
  declining: "在变差"
};

/** 五个读数的 (键, 显示面) 固定序列——键面与 design §G7 的样例一致。 */
const QUANTILE_ITEMS: ReadonlyArray<{
  key: "p50" | "p75" | "p90" | "p99" | "max";
  label: string;
}> = [
  { key: "p50", label: "P50" },
  { key: "p75", label: "P75" },
  { key: "p90", label: "P90" },
  { key: "p99", label: "P99" },
  { key: "max", label: "最大" }
];

/**
 * 用量总览「压缩统计」面板（design §4）：读数 → 占比 → 去哪了 的一条横向
 * 叙事，因此住满 board 的第三行整行。周期内 0 次时面板保留（切时间档不闪
 * 没），体是一行事实文字——不画三根 0 柱、不画空堆叠条。
 *
 * G7（design §G7）：主分支末尾挂「会话上下文峰值」分位行——与压缩共用
 * 「上下文有多重」这条叙事线。quantiles 由页面按窗口算好传入（哑组件先例，
 * 同 stats）；缺省不渲染该行（单测直挂旧快照不破）。
 */
export function CompactionStatsPanel({
  stats,
  days,
  quantiles,
  cacheHealth,
  onOpenSession
}: {
  stats: CompactionStats;
  days: number;
  /** 窗口内会话上下文峰值分位（contextQuantiles，页面 memo 产出）。
   *  缺省 = 不渲染分位行（向后兼容：没接线的调用方与旧快照）。 */
  quantiles?: ContextQuantiles;
  /** H7 缓存命中率（cacheHealth，页面 memo 产出）。缺省不渲染第二个 section
   *  ——与 quantiles 同一条「哑组件 + 加法式接线」先例，旧快照不破。 */
  cacheHealth?: CacheHealth;
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
          {quantiles ? (
            quantiles.count === 0 ? (
              // count===0：窗口内有会话但没有一条带 usage 的上下文读数——
              // 与「压缩 0 次」的事实行同语气，不印五个 0。
              <p className={styles.quantileEmpty}>本窗口的会话没有上下文读数</p>
            ) : quantiles.count === 1 || quantiles.p50 === null ? (
              // count===1（或模型因样本 <2 给 null）：单样本分位数没有统计
              // 意义——模型层 nearest-rank 在 <2 会话时五读数全 null（已验收
              // 口径），界面只说「样本不足」，不印五个相同数字。
              <p className={styles.quantileEmpty}>样本不足</p>
            ) : (
              <div className={styles.quantiles} data-probe="ctx-quantiles" aria-label="会话上下文峰值分位数">
                <span className={styles.qLabel}>会话上下文峰值</span>
                {QUANTILE_ITEMS.map(({ key, label }) => (
                  <span key={key} className={styles.qItem} data-probe="ctx-q" data-q={key}>
                    <span className={styles.qKey}>{label}</span>
                    <span className={styles.qVal}>{formatQuantile(quantiles[key] ?? 0)}</span>
                  </span>
                ))}
              </div>
            )
          ) : null}
        </>
      )}
      {cacheHealth ? (
        <CacheHitSection health={cacheHealth} />
      ) : null}
    </Panel>
  );
}

/**
 * H7 缓存命中率：压缩卡里的第二个 section。
 *
 * 三条「不印」规则：分母为 0 的周是 null（不是 0%）；不足 3 个非 null 周
 * 不画线（两周的折线会被读成趋势）；没有读数时不把「—」当成 0.0%。
 */
function CacheHitSection({ health }: { health: CacheHealth }) {
  const readings = health.weeks.filter((week) => week.hitRate !== null);
  const hitPct = health.latest === null ? null : health.latest * 100;
  const sparkValues = readings.map((week) => (week.hitRate ?? 0) * 100);

  return (
    <section className={styles.cacheSection} data-probe="cache-hit">
      <header className={styles.cacheHead}>
        <span className={styles.cacheLabel}>缓存命中率</span>
        <span className={styles.cacheRight}>
          {health.trend ? (
            <span className={styles.cacheTrend}>{CACHE_TREND_LABEL[health.trend]}</span>
          ) : null}
          <strong className={styles.cacheValue} data-probe="cache-hit-value">
            {hitPct === null ? "—" : `${hitPct.toFixed(1)}%`}
          </strong>
        </span>
      </header>
      {readings.length < 3 ? (
        <p className={styles.cacheEmpty}>
          {readings.length === 0 ? "本窗口没有输入读数" : "样本不足"}
        </p>
      ) : (
        <Sparkline values={sparkValues} width={480} height={24} probe="cache-sparkline" />
      )}
      <p className={styles.cacheNote}>按周：缓存读取 ÷（输入 + 缓存写入 + 缓存读取）</p>
    </section>
  );
}
