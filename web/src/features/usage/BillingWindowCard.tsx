import { useEffect, useMemo, useState } from "react";
import { formatClock, formatProjectPath, formatTokenCount } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { totalsSum, type UsageSessionInput } from "./usageAggregations";
import {
  burnRateOf,
  clusterBillingBlocks,
  currentBlock,
  predictLimitReach,
  type BillingBlock
} from "./billingWindow";
import { predictWeeklyLimitReach, weeklyWindow } from "./weeklyWindow";
import { PLAN_LIMITS_AS_OF, usePlan } from "./planLimits";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { Gauge } from "./charts/Gauge";
import { BarChart } from "./charts/BarChart";
import { attributeQuota, type QuotaAttributionRow } from "./quotaAttribution";
import styles from "./BillingWindowCard.module.css";

/** Countdown freshness: the window close time moves, the readout must too. */
const CLOCK_TICK_MS = 30_000;

function formatCountdown(ms: number): string {
  if (ms <= 0) return "已关闭";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} 时 ${minutes} 分` : `${minutes} 分钟`;
}

function formatPredictionTime(at: number): string {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 分母脚注：屏幕上先读到「分母是什么」，完整口径留在 title / aria-label 里。 */
const ATTRIBUTION_FOOTNOTE = "占比分母 = 本窗口总消耗（与表盘中心同一个数）。";
const ATTRIBUTION_FOOTNOTE_DETAIL =
  "占比分母 = 本窗口总消耗（与表盘中心同一个数）。精确占比之和恒为 100%；行内按 0.1% 四舍五入显示，合计可能与 100% 相差 0.1 到 0.3 个百分点。";

/**
 * 占比显示口径：精确 share 乘 100 后按 0.1% 四舍五入。有消耗但四舍五入到 0.0
 * 的行显示 `<0.1%`——把「很小」和「没有」分开，是这个面板存在的意义之一。
 */
function formatShareText(row: { tokens: number; share: number }): string {
  if (row.tokens > 0 && row.share * 100 < 0.05) return "<0.1%";
  return `${(row.share * 100).toFixed(1)}%`;
}

/**
 * 一个真实会话行：整行是按钮，四件套为「标题 / 消耗 / 占比条 / 占比」。
 * 无元数据（`path` 为空或输入里找不到 `SessionMeta`）时按钮禁用——行照列，
 * 只是不冒充一条能跳转的会话（design §4.5）。
 */
function AttributionSessionRow({
  row,
  session,
  onOpenSession
}: {
  row: QuotaAttributionRow;
  session: SessionMeta | undefined;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const canOpen = session !== undefined && onOpenSession !== undefined;
  // 项目名只走 formatProjectPath：拿不到 cwd 时退回去掉前导 `-` 的编码名，
  // 完整绝对路径不出现在可见文本、title 或 aria-label 里。
  const project = formatProjectPath(row.projectLabel, row.projectPath);
  const pctText = formatShareText(row);
  const reading = `${row.title}（项目：${project}）· 本窗口消耗 ${row.tokens.toLocaleString("en-US")} tok · 占本窗口 ${pctText}`;
  const label = canOpen ? `打开会话：${reading}` : `${reading} · 当前不可打开`;

  return (
    <li className={styles.attributionItem}>
      <button
        type="button"
        className={styles.attributionRow}
        data-probe="attribution-row"
        title={label}
        aria-label={label}
        disabled={!canOpen}
        onClick={canOpen ? () => onOpenSession(session) : undefined}
      >
        <span className={styles.attributionRowTitle} data-probe="attribution-row-title">
          {row.title}
        </span>
        <span className={styles.attributionToken} data-probe="attribution-row-token">
          {`${formatTokenCount(row.tokens)} tok`}
        </span>
        <span className={styles.attributionBarTrack} aria-hidden="true">
          {row.tokens > 0 ? (
            <span
              className={styles.attributionBarFill}
              data-probe="attribution-row-bar"
              style={{ width: `${row.share * 100}%` }}
            />
          ) : (
            <span className={styles.attributionBarEmpty} data-probe="attribution-row-bar" />
          )}
        </span>
        <span className={styles.attributionPct} data-probe="attribution-row-pct">
          {pctText}
        </span>
      </button>
    </li>
  );
}

/**
 * 「本窗口消耗 Top 会话」面板（Issue #151）：表盘中心那个数摊到会话上是谁在烧。
 *
 * 数据只有一条来源——调用方手上那个 `block`：窗口边界与分母都由它给出
 * （`attributeQuota` 内部取 `totalsSum(block.totals)`），组件不重算窗口、不另
 * 加总，因此面板的百分比与表盘不可能对不上。空窗口或分母为 0 时整块不渲染：
 * 没有分母就没有比率，不画 0 行空列表。
 */
function QuotaAttributionPanel({
  inputs,
  block,
  onOpenSession
}: {
  inputs: readonly UsageSessionInput[];
  block: BillingBlock;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const attribution = useMemo(() => attributeQuota(inputs, block), [inputs, block]);
  // 行只带 path；点行要交回完整 SessionMeta（与压缩统计 top3 同一条握手协议）。
  const sessionsByPath = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const input of inputs) {
      const session = input.session;
      if (session && !map.has(session.path)) map.set(session.path, session);
    }
    return map;
  }, [inputs]);

  if (attribution.sessionsInWindow === 0 || attribution.windowTokens <= 0) return null;

  return (
    <section
      className={styles.attribution}
      aria-labelledby="attribution-title"
      data-probe="attribution-panel"
    >
      <div className={styles.attributionHead}>
        <h3 id="attribution-title" className={styles.attributionTitle} data-probe="attribution-title">
          本窗口消耗 Top 会话
        </h3>
        {/* 归因只读日志，不推算：这一枚圆点说明整块的口径。 */}
        <ProvenanceBadge provenance="logged" />
        <span
          className={styles.attributionFootnote}
          data-probe="attribution-footnote"
          title={ATTRIBUTION_FOOTNOTE_DETAIL}
          aria-label={ATTRIBUTION_FOOTNOTE_DETAIL}
        >
          {ATTRIBUTION_FOOTNOTE}
        </span>
      </div>
      <ol
        className={styles.attributionList}
        data-probe="attribution-list"
        aria-label="本窗口消耗最多的会话"
      >
        {attribution.rows.map((row, index) => (
          <AttributionSessionRow
            key={row.path === "" ? `anonymous:${index}` : row.path}
            row={row}
            session={row.path === "" ? undefined : sessionsByPath.get(row.path)}
            onOpenSession={onOpenSession}
          />
        ))}
        {attribution.remainder ? (
          <li className={styles.attributionRest} data-probe="attribution-rest">
            <span className={styles.attributionRestTitle}>
              {`其余 ${attribution.remainder.sessions} 个会话`}
            </span>
            <span className={styles.attributionToken}>
              {`${formatTokenCount(attribution.remainder.tokens)} tok`}
            </span>
            <span className={styles.attributionBarTrack} aria-hidden="true">
              {attribution.remainder.tokens > 0 ? (
                <span
                  className={styles.attributionRestFill}
                  style={{ width: `${attribution.remainder.share * 100}%` }}
                />
              ) : null}
            </span>
            <span className={styles.attributionPct}>
              {formatShareText(attribution.remainder)}
            </span>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

/**
 * The billing-window instrument at the top of the usage page: what the current
 * 5h window consumed, how long until it closes, and — only when a plan limit
 * exists — when that limit will be reached at the current burn rate. Numbers
 * read from the log carry "读自日志"; the extrapolated ETA carries "推算";
 * plan limits themselves are community estimates, labelled as such.
 *
 * The card also carries the subscription's second limit layer, the rolling
 * 7-day window: consumption read from the log, an optional self-set budget to
 * compare against, and — the honest sentence this layer must always show —
 * the note that it is a rolling window, not Anthropic's official weekly reset.
 */
export function BillingWindowCard({
  inputs,
  now: nowProp,
  onOpenSession
}: {
  inputs: readonly UsageSessionInput[];
  now?: number;
  /** 归因行点击 → 打开会话分析并落到该会话（与压缩统计 top3 同一条握手）。 */
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const plan = usePlan();
  const [, setTick] = useState(0);
  const now = nowProp ?? Date.now();

  useEffect(() => {
    if (nowProp !== undefined) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, [nowProp]);

  // 5h 窗口与滚动 7 天共用同一条记录流：两层数字必须出自同一份日志，
  // 否则「本窗口消耗」与「7 天消耗」会在同屏互相打架。
  const records = useMemo(() => {
    // Interleave every session's records into one time-ordered stream:
    // billing windows are machine-wide, not per-session.
    const all: SessionRecord[] = [];
    for (const input of inputs) all.push(...input.records);
    all.sort((a, b) => a.timestamp - b.timestamp);
    return all;
  }, [inputs]);

  const blocks = useMemo(() => clusterBillingBlocks(records), [records]);

  const week = useMemo(
    () => weeklyWindow(records, plan.weeklyLimitTokens, now),
    [records, plan.weeklyLimitTokens, now]
  );

  const active = currentBlock(blocks, now);
  const history = blocks.slice(-8, -1).map((block) => ({
    label: formatClock(block.start),
    value: totalsSum(block.totals)
  }));

  if (!active) {
    return null;
  }

  const consumed = totalsSum(active.totals);
  const closesIn = active.end - now;
  const progress =
    plan.limitTokens && plan.limitTokens > 0 ? consumed / plan.limitTokens : null;
  const prediction = predictLimitReach(active, plan.limitTokens, now);
  const rate = burnRateOf(active, now);

  const weeklyConsumed = totalsSum(week.consumed);
  const previousConsumed = totalsSum(week.previousConsumed);
  const weeklyShare =
    week.limitTokens && week.limitTokens > 0 ? weeklyConsumed / week.limitTokens : null;
  const weeklyPrediction = predictWeeklyLimitReach(week, now);
  // 上一周期的对照只在两边都有数据时给百分比；一边为 0 的「+100%/−100%」
  // 说的不是趋势，是「那时候还没开始用」。
  const weeklyDeltaPct =
    previousConsumed > 0 && weeklyConsumed > 0
      ? Math.round(((weeklyConsumed - previousConsumed) / previousConsumed) * 100)
      : null;
  // 触达文案与徽章分开：徽章只标真正的外推（未来的那一刻）；
  // 「已达预算」是读出来的事实，不挂「推算」的牌子。
  const weeklyEta: { text: string; extrapolated: boolean } =
    week.limitTokens === null || week.limitTokens <= 0
      ? { text: "", extrapolated: false }
      : weeklyConsumed >= week.limitTokens
        ? { text: "已达预算", extrapolated: false }
        : "reachAt" in weeklyPrediction
          ? {
              text: `按日均推算 ${formatPredictionTime(weeklyPrediction.reachAt)} 触达`,
              extrapolated: true
            }
          : { text: "样本不足，不外推", extrapolated: false };
  const shareText =
    progress !== null ? `当前窗口已用 ${(progress * 100).toFixed(0)}%（估算限额）` : "当前窗口消耗";

  return (
    <section className={styles.card} aria-label="计费窗口">
      <div className={styles.gaugeArea}>
        <Gauge
          progress={progress}
          centerValue={formatTokenCount(consumed)}
          centerLabel="本窗口消耗"
          ariaLabel={shareText}
        />
        <div className={styles.readouts}>
          {/* 两层限额并排后，「窗口」这个词只指 5 小时层——层名让两组读数
              不靠位置也能分清归属。 */}
          <span className={styles.layerTitle}>5 小时窗口</span>
          <span className={styles.readout}>
            <span className={styles.labelRow}>
              <span className={styles.label}>窗口开启</span>
              <ProvenanceBadge provenance="logged" />
            </span>
            <b className={styles.value}>{formatClock(active.start)}</b>
          </span>
          <span className={styles.readout}>
            <span className={styles.labelRow}>
              <span className={styles.label}>窗口关闭</span>
            </span>
            <b className={styles.value}>{formatCountdown(closesIn)}</b>
            <span className={styles.sub}>{formatClock(active.end)}</span>
          </span>
          <span className={styles.readout}>
            <span className={styles.labelRow}>
              <span className={styles.label}>消耗速度</span>
              {"insufficientSample" in rate ? null : <ProvenanceBadge provenance="inferred" />}
            </span>
            <b className={styles.value}>
              {"insufficientSample" in rate ? "样本不足" : `${formatTokenCount(rate.tokensPerHour)}/时`}
            </b>
          </span>
          <span className={styles.readout}>
            <span className={styles.labelRow}>
              <span className={styles.label}>预计到达限额</span>
              {plan.limitTokens !== null && !("insufficientSample" in prediction) ? (
                <ProvenanceBadge provenance="inferred" detail="线性外推" />
              ) : null}
            </span>
            <b className={styles.value}>
              {plan.limitTokens === null
                ? /* 缺数据的占位不跟真值同权重。 */
                  <span className={styles.valueMuted}>未选计划</span>
                : "insufficientSample" in prediction
                  ? "样本不足"
                  : "reachAt" in prediction
                    ? formatPredictionTime(prediction.reachAt)
                    : "—"}
            </b>
          </span>
        </div>
        <section className={styles.weekly} aria-label="周用量（滚动 7 天）">
          <span className={styles.labelRow}>
            <span className={styles.label}>滚动 7 天</span>
            <ProvenanceBadge provenance="logged" />
          </span>
          <b className={styles.value}>{formatTokenCount(weeklyConsumed)}</b>
          <div className={styles.weeklyMeta}>
            <span className={styles.weeklyStat}>
              日均 {formatTokenCount(Math.round(weeklyConsumed / 7))}/日
              <ProvenanceBadge provenance="inferred" />
            </span>
            <span className={styles.weeklyStat}>
              {weeklyDeltaPct !== null
                ? `较上一周期 ${weeklyDeltaPct > 0 ? "+" : ""}${weeklyDeltaPct}%`
                : "上一周期 0"}
            </span>
          </div>
          {weeklyShare === null ? (
            <span className={styles.weeklyMuted}>未设周预算——只显示消耗</span>
          ) : (
            <div className={styles.weeklyBudget}>
              {/* 窄条走描边档语言（同日志表占比条）；宽度是数据，只能在行内给。 */}
              <div className={styles.weeklyBarTrack} aria-hidden="true">
                <div
                  className={styles.weeklyBarFill}
                  style={{ width: `${Math.min(100, weeklyShare * 100)}%` }}
                />
              </div>
              <span className={styles.weeklyBudgetText}>
                周预算已用 {Math.round(weeklyShare * 100)}%（预算为自设数字）
              </span>
              <span className={styles.weeklyStat}>
                {weeklyEta.text}
                {weeklyEta.extrapolated ? (
                  <ProvenanceBadge provenance="inferred" detail="按近 7 天日均外推" />
                ) : null}
              </span>
            </div>
          )}
          {/* 必须随行的一句话：本机日志推不出官方周重置时刻，这个层给的是
              滚动值，不能让用户把它当成官方窗口读数。 */}
          <span className={styles.weeklyNote}>滚动 7 天累计，不是官方重置窗口，两者不逐分钟吻合</span>
        </section>
        {/* 归因与历史条共用右侧一列：归因用的就是上面这同一个 active 块（窗口与
            分母各只有一份），DOM 顺序也保持「归因在前、历史条在后」。
            历史图不能独占整行——它的 SVG 是 width:100% + viewBox，被拉到 1390px
            宽会把整张图放大到约 1.9 倍，纵轴标签当场互相压住。 */}
        <div className={styles.sideStack}>
          <QuotaAttributionPanel inputs={inputs} block={active} onOpenSession={onOpenSession} />
          {history.length > 0 ? (
            <div className={styles.history}>
              <span className={styles.historyLabel}>近几个窗口</span>
              <BarChart
                data={history}
                ariaLabel="历史计费窗口消耗"
                emptyText="暂无历史窗口"
                /* 90 个单位的图在这张卡里会被拉到 750px 宽、130px 高，把卡片
                   顶成首屏的三分之一；它是一条辅助趋势，不是主角。 */
                height={72}
                /* 横轴标签是窗口开始时刻、按柱位等距排布，真实间隔并不相等
                   （相邻窗口可以差 5 分钟，也可以差 7 小时）——轴上必须说明这件事，
                   否则等距的柱让人误以为时间也等距。 */
                caption="每个柱 = 一个 5 小时计费窗口；横轴按窗口开始时刻等距排布，柱间距不代表真实间隔"
              />
            </div>
          ) : null}
        </div>
      </div>
      <p className={styles.planNote}>
        {plan.limitTokens === null
          ? "未选择订阅计划：只显示消耗，不显示百分比——没有分母就没有比率。在「设置 → 计费窗口」选择计划。"
          : `限额为社区整理的估算值（整理于 ${PLAN_LIMITS_AS_OF}，非官方数字），仅供参照；估算与预测都不是账单。`}
      </p>
    </section>
  );
}
