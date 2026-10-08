import { useEffect, useMemo, useState } from "react";
import type { SessionRecord } from "../sessions/types";
import { formatClock, formatTokenCount } from "../../lib/format";
import { totalsSum, type UsageSessionInput } from "./usageAggregations";
import {
  burnRateOf,
  clusterBillingBlocks,
  currentBlock,
  predictLimitReach
} from "./billingWindow";
import { predictWeeklyLimitReach, weeklyWindow } from "./weeklyWindow";
import { PLAN_LIMITS_AS_OF, usePlan } from "./planLimits";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { Gauge } from "./charts/Gauge";
import { BarChart } from "./charts/BarChart";
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
  now: nowProp
}: {
  inputs: readonly UsageSessionInput[];
  now?: number;
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
      <p className={styles.planNote}>
        {plan.limitTokens === null
          ? "未选择订阅计划：只显示消耗，不显示百分比——没有分母就没有比率。在「设置 → 计费窗口」选择计划。"
          : `限额为社区整理的估算值（整理于 ${PLAN_LIMITS_AS_OF}，非官方数字），仅供参照；估算与预测都不是账单。`}
      </p>
    </section>
  );
}
