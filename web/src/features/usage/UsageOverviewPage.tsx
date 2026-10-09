import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Panel } from "../../components/Panel";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { formatModelId, formatProjectPath, formatTokenCount, formatUsd } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { PRICING_AS_OF, estimateCost } from "./pricingSnapshot";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { useUsageOverview } from "./useUsageOverview";
import { BillingWindowCard } from "./BillingWindowCard";
import { CompactionStatsPanel } from "./CompactionStatsPanel";
import { compactionStats } from "./compactionStats";
import { mergeErrorStats } from "./errorStats";
import { ErrorOverviewSection } from "./ErrorOverviewSection";
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

/** 页内子视图（N1）：缺省仍是「用量」——错误分析是显式选择，首屏不被垄断。 */
const VIEW_KEY = "cca-usage-view";
type UsageView = "usage" | "errors";

const VIEW_ITEMS: SegmentedItem<UsageView>[] = [
  { value: "usage", label: "用量" },
  { value: "errors", label: "错误" }
];

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

/** Stored values are untrusted: anything unknown falls back to the usage view. */
function readStoredView(): UsageView {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (stored === "errors") return "errors";
  } catch {
    // See readStoredRange: persistence is optional.
  }
  return "usage";
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

export function UsageOverviewPage({
  onOpenSession,
  onRevealRecord
}: {
  /** 压缩统计 top3 行的「打开会话」回调；缺省（单测）时行不可点。 */
  onOpenSession?: (session: SessionMeta) => void;
  /** 错误事件行的「跳回会话分析定位」回调（N1，与全局搜索的 onReveal 同款）。 */
  onRevealRecord?: (path: string, recordId: string | null) => void;
} = {}) {
  const { inputs, progress, scanning, error, skipped, refresh } = useUsageOverview();
  const [days, setDays] = useState<UsageRange>(readStoredRange);
  const [tokenClass, setTokenClass] = useState<TokenClass>("total");
  const [view, setView] = useState<UsageView>(readStoredView);

  useEffect(() => {
    try {
      localStorage.setItem(RANGE_KEY, String(days));
    } catch {
      // See readStoredRange: persistence is optional.
    }
  }, [days]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // See readStoredView: persistence is optional.
    }
  }, [view]);

  const range = useMemo(() => aggregateRange(inputs, days), [inputs, days]);
  // 压缩统计与 aggregateRange 同一口径的时间窗（周期口径与页面控件一致）。
  const compaction = useMemo(() => compactionStats(inputs, days), [inputs, days]);
  // 错误聚合同位（design §8）：与压缩统计一样独立 memo，不进既有聚合桶。
  const errorStats = useMemo(() => mergeErrorStats(inputs, days), [inputs, days]);

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

  // Buckets are keyed by the encoded project directory name; the sessions'
  // real paths come from the scan. First path wins — a project bucket can hold
  // sessions from several archive roots, and any of them names it truthfully.
  const projectPaths = useMemo(() => {
    const paths = new Map<string, string>();
    for (const input of inputs) {
      if (input.projectPath && !paths.has(input.projectLabel)) {
        paths.set(input.projectLabel, input.projectPath);
      }
    }
    return paths;
  }, [inputs]);

  const projectData = useMemo(
    () =>
      range.topProjects.map((slice) => {
        const path = projectPaths.get(slice.label);
        return {
          value: slice.value,
          label: formatProjectPath(slice.label, path),
          hint: path ?? slice.label
        };
      }),
    [range.topProjects, projectPaths]
  );

  // Model ids are raw API identifiers; the legend and the bar share this one
  // mapping so the two never disagree, and the untouched id stays in the tooltip.
  const modelData = useMemo(
    () =>
      range.topModels.map((slice) => ({
        value: slice.value,
        label: formatModelId(slice.label),
        hint: slice.label
      })),
    [range.topModels]
  );

  // 加载 / 空 / 出错共用同一块舞台（`stage` 把内容压在主区中线上）：
  // 三者是同一件事的三个阶段，位置不该跟着语义跳。
  if (error) {
    return (
      <div className={`${styles.page} ${styles.stage}`}>
        <ErrorState
          size="page"
          title="会话列表读取失败"
          hint="本机 ~/.claude/projects 里的会话没能读出来。确认目录可读后重试。"
          detail={error}
          onRetry={() => void refresh()}
        />
      </div>
    );
  }

  if (!scanning && inputs.length === 0 && progress.total === 0) {
    return (
      <div className={`${styles.page} ${styles.stage}`}>
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
      <div className={`${styles.page} ${styles.stage}`} data-probe-pending>
        <EmptyState size="page" title="正在扫描会话列表…" />
      </div>
    );
  }

  return (
    <section className={styles.page} aria-label="用量总览">
      <div className={styles.header}>
        {/* 视图分段放最左：视图身份先于时间范围（design §2.1）。区间控件与
            扫描进度行两档共用——不另造第二套窗口状态。 */}
        <div className={styles.headerControls}>
          <SegmentedControl
            items={VIEW_ITEMS}
            value={view}
            onChange={setView}
            ariaLabel="总览视图"
          />
          <SegmentedControl
            items={RANGE_ITEMS}
            value={String(days)}
            onChange={(next) => setDays(toRange(next))}
            ariaLabel="时间范围"
          />
        </div>
        <span className={styles.progress} {...(scanning ? { "data-probe-pending": true } : {})}>
          {scanning
            ? `已分析 ${progress.done} / ${progress.total} 个会话`
            : `近 ${days} 天内 ${range.kpi.sessions} 个会话纳入统计`}
          {skipped > 0 ? ` · ${skipped} 个会话读取失败已跳过` : ""}
        </span>
      </div>

      {view === "errors" ? (
        <ErrorOverviewSection
          stats={errorStats}
          days={days}
          sessionsInWindow={range.kpi.sessions}
          projectPaths={projectPaths}
          onRevealRecord={onRevealRecord}
        />
      ) : (
        <>
          <BillingWindowCard inputs={inputs} />

          <div className={styles.kpiRow}>
            {/* 来源徽章是标签行末尾的一枚圆点（`.kpi` 的两列网格把它放在第一行的
            右端），数值独占第二行——瓦片里先看到数字，再看标签与出处。 */}
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>Tokens 总量</span>
              <span className={styles.kpiValue}>{formatTokenCount(range.kpi.tokens)}</span>
              <ProvenanceBadge provenance="logged" />
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>会话数</span>
              <span className={styles.kpiValue}>{range.kpi.sessions.toLocaleString("en-US")}</span>
              <ProvenanceBadge provenance="logged" />
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>消息数</span>
              <span className={styles.kpiValue}>{range.kpi.messages.toLocaleString("en-US")}</span>
              <ProvenanceBadge provenance="logged" />
            </div>
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>估算成本</span>
              <span className={styles.kpiValue}>{formatUsd(cost.usd)}</span>
              <ProvenanceBadge provenance="estimated" detail={`快照日期 ${PRICING_AS_OF}`} />
            </div>
            {/* 免责说明跨列收在卡片底部：它此前是成本那一列的第三层（列头「非账单」
            + chip「估算」+「快照日期」），把整张卡撑高、另外三列各留 60px 死白。 */}
            <p className={styles.kpiFootnote}>
              Tokens 总量、会话数、消息数读自本机日志；估算成本按定价快照（{PRICING_AS_OF}）折算，
              不是账单。
              {cost.hasUnknown
                ? ` 部分会话未知价 · 约 ${formatTokenCount(cost.unknownTokens)} tok 未计入`
                : ""}
            </p>
          </div>

          {/* 两列网格：单列文档流下仪表盘比视口高 43%，「按项目分布」「按模型分布」
          「活跃时段」三块因此从来没进过首屏，也没进过任何一张归档截图。 */}
          <div className={styles.board}>
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
                height={170}
              />
            </Panel>

            <Panel title="按项目分布">
              <HBarChart data={projectData} ariaLabel="按项目分布" emptyText="所选范围内暂无项目消耗" />
            </Panel>

            <Panel title="按模型分布">
              <StackedBar data={modelData} ariaLabel="按模型分布" emptyText="所选范围内暂无模型消耗" />
              {modelData.length > 0 ? (
                <ul className={styles.modelLegend}>
                  {modelData.map((slice, index) => (
                    <li key={slice.hint}>
                      {/* 与 StackedBar 同一索引规则：module class 无法按索引计算，
                          内联 token 引用是该组件已认可的唯一例外。 */}
                      <span
                        className={styles.swatch}
                        style={{ background: `var(--chart-${(index % 6) + 1}, var(--accent))` }}
                      />
                      {/* 标签是缩短后的名字，原始 id 进 title——两个快照不是同一样东西。 */}
                      <span className={styles.modelName} title={slice.hint}>
                        {slice.label}
                      </span>
                      <span className={styles.modelValue}>{formatTokenCount(slice.value)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>

            <Panel title="活跃时段（周 × 小时）">
              <Heatmap counts={range.hourly} ariaLabel="活跃时段热力图" />
            </Panel>

            {/* 压缩统计住满第三行整行（design §4）：两列网格里塞半宽会留空洞，
                这块面板本来就是一条横向叙事。 */}
            <div className={styles.compactionRow}>
              <CompactionStatsPanel
                stats={compaction}
                days={days}
                onOpenSession={onOpenSession}
              />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
