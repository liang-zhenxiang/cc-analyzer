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

  const blocks = useMemo(() => {
    // Interleave every session's records into one time-ordered stream:
    // billing windows are machine-wide, not per-session.
    const records: SessionRecord[] = [];
    for (const input of inputs) records.push(...input.records);
    records.sort((a, b) => a.timestamp - b.timestamp);
    return clusterBillingBlocks(records);
  }, [inputs]);

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
