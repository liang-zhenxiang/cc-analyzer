import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { Panel } from "../../components/Panel";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { formatTokenCount, formatUsd } from "../../lib/format";
import { PRICING_AS_OF, estimateCost } from "./pricingSnapshot";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { useUsageOverview } from "./useUsageOverview";
import { BillingWindowCard } from "./BillingWindowCard";
import {
  aggregateRange,
  formatDayLabel,
  totalsSum,
  type UsageTotals
} from "./usageAggregations";
import { BarChart } from "./charts/BarChart";
import { HBarChart } from "./charts/HBarChart";
import { StackedBar } from "./charts/StackedBar";
import { Heatmap } from "./charts/Heatmap";
import styles from "./UsageOverviewPage.module.css";

const RANGE_KEY = "cca-usage-range";
const RANGE_OPTIONS = [7, 30, 90] as const;
type UsageRange = (typeof RANGE_OPTIONS)[number];

const RANGE_ITEMS: SegmentedItem<string>[] = RANGE_OPTIONS.map((option) => ({
  value: String(option),
  label: `近 ${option} 天`
}));

/** 分段控件的值是字符串，这里把它窄化回数字档位（不用类型断言）。 */
function toRange(value: string): UsageRange {
  return value === "7" ? 7 : value === "90" ? 90 : 30;
}

function readStoredRange(): UsageRange {
  try {
    const stored = localStorage.getItem(RANGE_KEY);
    for (const option of RANGE_OPTIONS) {
      if (stored === String(option)) return option;
    }
  } catch {
    // localStorage may be unavailable; the default range still works.
  }
  return 30;
}

/**
 * The trend's token selector. "全部" is the four counters summed — the KPI
 * headline figure — while the other four isolate one counter, because a day
 * dominated by cache reads and a day dominated by output look identical under
 * a single merged number.
 */
const TOKEN_CLASSES = [
  { key: "total", label: "全部" },
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "cacheCreation", label: "缓存写入" },
  { key: "cacheRead", label: "缓存读取" }
] as const;
type TokenClass = (typeof TOKEN_CLASSES)[number]["key"];

const CLASS_ITEMS: SegmentedItem<TokenClass>[] = TOKEN_CLASSES.map((option) => ({
  value: option.key,
  label: option.label
}));

function tokenClassValue(totals: UsageTotals, tokenClass: TokenClass): number {
  return tokenClass === "total" ? totalsSum(totals) : totals[tokenClass];
}

export function UsageOverviewPage() {
  const { inputs, progress, scanning, error, skipped } = useUsageOverview();
  const [days, setDays] = useState<UsageRange>(readStoredRange);
  const [tokenClass, setTokenClass] = useState<TokenClass>("total");

  useEffect(() => {
    try {
      localStorage.setItem(RANGE_KEY, String(days));
    } catch {
      // See readStoredRange: persistence is optional.
    }
  }, [days]);

  const range = useMemo(() => aggregateRange(inputs, days), [inputs, days]);

  const cost = useMemo(() => {
    let usd = 0;
    let hasUnknown = false;
    let unknownTokens = 0;
    for (const [model, totals] of range.models) {
      const estimate = estimateCost(totals, model);
      if ("unknownModel" in estimate) {
        hasUnknown = true;
        unknownTokens += totalsSum(totals);
      } else {
        usd += estimate.usd;
      }
    }
    return { usd, hasUnknown, unknownTokens };
  }, [range]);

  const trendData = useMemo(
    () =>
      range.dailySeries.map((point) => ({
        label: formatDayLabel(point.dayStart),
        value: tokenClassValue(point, tokenClass)
      })),
    [range, tokenClass]
  );

  if (error) {
    return (
      <div className={styles.page}>
        <EmptyState size="page" title="会话列表读取失败" description={error} />
      </div>
    );
  }

  if (!scanning && inputs.length === 0 && progress.total === 0) {
    return (
      <div className={styles.page}>
        <EmptyState
          size="page"
          title="还没有可统计的会话"
          description="本机 ~/.claude/projects 下没有发现会话记录。切到「会话分析」标签确认扫描结果，产生新会话后再回到本页。"
        />
      </div>
    );
  }

  if (scanning && progress.total === 0) {
    return (
      /* data-probe-pending：真机取图前会等这个标记消失，免得拍到「还没算完」的一帧。 */
      <div className={styles.page} data-probe-pending>
        <EmptyState size="page" title="正在扫描会话列表…" />
      </div>
    );
  }

  return (
    <section className={styles.page} aria-label="用量总览">
      <div className={styles.header}>
        <SegmentedControl
          items={RANGE_ITEMS}
          value={String(days)}
          onChange={(next) => setDays(toRange(next))}
          ariaLabel="时间范围"
        />
        <span className={styles.progress} {...(scanning ? { "data-probe-pending": true } : {})}>
          {scanning
            ? `已分析 ${progress.done} / ${progress.total} 个会话`
            : `近 ${days} 天内 ${range.kpi.sessions} 个会话纳入统计`}
          {skipped > 0 ? ` · ${skipped} 个会话读取失败已跳过` : ""}
        </span>
      </div>

      <BillingWindowCard inputs={inputs} />

      <div className={styles.kpiRow}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>Tokens 总量</span>
          <span className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{formatTokenCount(range.kpi.tokens)}</span>
            <ProvenanceBadge provenance="logged" />
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>会话数</span>
          <span className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{range.kpi.sessions.toLocaleString("en-US")}</span>
            <ProvenanceBadge provenance="logged" />
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>消息数</span>
          <span className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{range.kpi.messages.toLocaleString("en-US")}</span>
            <ProvenanceBadge provenance="logged" />
          </span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>估算成本 · 非账单</span>
          <span className={styles.kpiValueRow}>
            <span className={styles.kpiValue}>{formatUsd(cost.usd)}</span>
            <ProvenanceBadge provenance="estimated" detail={`快照日期 ${PRICING_AS_OF}`} />
          </span>
          {cost.hasUnknown ? (
            <span className={styles.kpiNote}>
              部分会话未知价 · 约 {formatTokenCount(cost.unknownTokens)} tok 未计入
            </span>
          ) : null}
        </div>
      </div>

      <Panel
        title="每日 Token 消耗"
        actions={
          <SegmentedControl
            items={CLASS_ITEMS}
            value={tokenClass}
            onChange={setTokenClass}
            ariaLabel="Token 类别"
          />
        }
      >
        <BarChart
          data={trendData}
          ariaLabel="每日 Token 消耗趋势"
          emptyText="所选范围内暂无消耗"
        />
      </Panel>

      <div className={styles.distributionRow}>
        <Panel title="按项目分布">
          <HBarChart data={range.topProjects} ariaLabel="按项目分布" emptyText="所选范围内暂无项目消耗" />
        </Panel>
        <Panel title="按模型分布">
          <StackedBar data={range.topModels} ariaLabel="按模型分布" emptyText="所选范围内暂无模型消耗" />
          {range.topModels.length > 0 ? (
            <ul className={styles.modelLegend}>
              {range.topModels.map((slice, index) => (
                <li key={slice.label}>
                  {/* 与 StackedBar 同一索引规则：module class 无法按索引计算，
                      内联 token 引用是该组件已认可的唯一例外。 */}
                  <span
                    className={styles.swatch}
                    style={{ background: `var(--chart-${(index % 6) + 1}, var(--accent))` }}
                  />
                  <span className={styles.modelName}>{slice.label}</span>
                  <span className={styles.modelValue}>{formatTokenCount(slice.value)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </div>

      <Panel title="活跃时段（7×24）">
        <Heatmap counts={range.hourly} ariaLabel="活跃时段热力图" />
      </Panel>
    </section>
  );
}
