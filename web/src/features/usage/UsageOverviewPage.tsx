import { useEffect, useMemo, useRef, useState } from "react";
import { useBridges } from "../../api/bridges";
import { useNotifications } from "../../app/NotificationProvider";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { ErrorState } from "../../components/ErrorState";
import { Panel } from "../../components/Panel";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { formatModelId, formatProjectPath, formatTokenCount, formatUsd } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { useBillingReadouts } from "./billingReadouts";
import { PRICING_AS_OF, estimateCost } from "./pricingSnapshot";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { useUsageOverview } from "./useUsageOverview";
import { BillingWindowCard } from "./BillingWindowCard";
import { CompactionStatsPanel } from "./CompactionStatsPanel";
import { compactionStats } from "./compactionStats";
import { mergeErrorStats } from "./errorStats";
import { ErrorOverviewSection } from "./ErrorOverviewSection";
import { MilestonesPanel } from "./MilestonesPanel";
import { milestonesOf } from "./milestones";
import { toolCensus } from "./toolCensus";
import { ToolCensusPanel } from "./ToolCensusPanel";
import { UsageCalendarPanel } from "./UsageCalendarPanel";
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
import { usageSnapshotFileName, usageSnapshotHtml } from "./usageSnapshot";
import styles from "./UsageOverviewPage.module.css";

const RANGE_KEY = "cca-usage-range";
const RANGE_OPTIONS = [7, 30, 90] as const;
type UsageRange = (typeof RANGE_OPTIONS)[number];

/**
 * 页内子视图（N1 / Round Y）：缺省仍是「用量」——错误分析与里程碑都是显式选择，
 * 首屏不被垄断。三档共用同一次扫描（里程碑吃同一份全历史 `inputs`，零新增 I/O）。
 */
const VIEW_KEY = "cca-usage-view";
type UsageView = "usage" | "milestones" | "errors";

const VIEW_ITEMS: SegmentedItem<UsageView>[] = [
  { value: "usage", label: "用量" },
  { value: "milestones", label: "里程碑" },
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
    if (stored === "milestones") return "milestones";
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
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // 里程碑 → 日历的下钻请求（Round Y #214）：与 `AppShell` 的 `revealRequest`
  // 同款——请求带一个自增 nonce（不用 `Date.now()`：同毫秒的两次点击是两次
  // 独立请求，第二次要能收起），面板消费后回调把它清掉。
  const [dayDrill, setDayDrill] = useState<{ dayStart: number; nonce: number } | null>(null);
  const dayDrillSeq = useRef(0);
  // 报告落款要写版本号；取不到就留空（宁可少一行信息，也不写一个假版本）。
  const [appVersion, setAppVersion] = useState("");
  const bridges = useBridges();
  const { notify } = useNotifications();
  // 计费读数的唯一实例：计费卡与「导出快照」共用同一份 `now` 与同一批窗口
  // 数学（Issue #174），同屏与文件里不可能各算一套。
  const readouts = useBillingReadouts(inputs);
  // 消耗日历的窗口终点（Issue #187）：readouts 之外另取一个时钟实例——日历
  // 不参与计费对账，滚动 365 天窗口不需要 30 秒 tick；取挂载那一刻并保持
  // 稳定，memo 才不会每帧失效（跨天挂机不重算，与其它面板同一取舍）。
  const [calendarNow] = useState(() => Date.now());
  // 里程碑的 `now`（Round Y §5）：与 calendarNow 同一条取舍——取挂载那一刻并
  // 保持稳定。报告里的每条事实都是历史的，它只盖 `generatedAt`。
  const [milestonesNow] = useState(() => Date.now());

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

  useEffect(() => {
    let cancelled = false;
    const pending = bridges.updater?.appVersion();
    pending
      ?.then((value) => {
        if (!cancelled) setAppVersion(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bridges]);

  const range = useMemo(() => aggregateRange(inputs, days), [inputs, days]);
  // 压缩统计与 aggregateRange 同一口径的时间窗（周期口径与页面控件一致）。
  const compaction = useMemo(() => compactionStats(inputs, days), [inputs, days]);
  // 错误聚合同位（design §8）：与压缩统计一样独立 memo，不进既有聚合桶。
  const errorStats = useMemo(() => mergeErrorStats(inputs, days), [inputs, days]);
  // 工具普查（N3）同位：窗口化口径与上两者一致，不进既有聚合桶。
  const census = useMemo(() => toolCensus(inputs, days), [inputs, days]);
  // 里程碑（Round Y #214）同位：吃同一份**全历史** inputs，一次遍历折成三层
  // 清单。它与 7/30/90 区间正交（全历史口径），所以不依赖 `days`；R9 要求只在
  // `inputs` 变化时重算，这里靠 memo 的依赖保证。
  const milestoneReport = useMemo(
    () => milestonesOf(inputs, milestonesNow),
    [inputs, milestonesNow]
  );

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

  // 里程碑的会话入口交回的是 **path**（纯逻辑层手上只有 path）；页面把它换回
  // 完整的 `SessionMeta` 再走既有的「打开会话」握手——与压缩 top3 / 日历同一路。
  const sessionsByPath = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const input of inputs) {
      const session = input.session;
      if (session && !map.has(session.path)) map.set(session.path, session);
    }
    return map;
  }, [inputs]);

  function openSessionByPath(path: string) {
    const session = sessionsByPath.get(path);
    if (session && onOpenSession) onOpenSession(session);
  }

  /**
   * 「打开某天」：切回「用量」档（日历就在那一档），再发一次下钻请求让日历
   * 展开到那一天并把格子滚进视野。
   *
   * 展开状态（`selected`）仍住在 `UsageCalendarPanel` 内部——页面只发「请求 +
   * nonce」，面板消费后回调收口（design §4：不把 `selected` 整体上提，也不在
   * 页面另造第二份下钻状态）。
   */
  function openDay(dayStart: number) {
    setView("usage");
    dayDrillSeq.current += 1;
    setDayDrill({ dayStart, nonce: dayDrillSeq.current });
  }

  /**
   * 用量总览 → 单文件 HTML 快照（Issue #149）。
   *
   * 窗口与归因直接吃页面那一份 `readouts`（`useBillingReadouts`，Issue #174）——
   * 归因也已经在 `billingReadoutsOf` 里算好，这里不再自己调 `attributeQuota`。
   * 生成器只负责排版：它不重算边界、不重新加总（`usageSnapshot.ts` 的契约）。
   * 区间口径与 KPI 取自页面上那份 `range`，所以文件里的数与屏幕上不可能对不上。
   */
  async function handleExportSnapshot() {
    // 扫描是渐进的：中途导出会得到一份看不出缺口的半份统计。禁用在按钮上，
    // 这里再挡一次（快速双击 / 键盘回车都走这条路）。
    if (scanning || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      // 窗口数学与文件名用 readouts.now（= 屏幕上那组读数用的 tick 值，两者
      // 必须逐字一致）；文档落款用点击这一刻——「生成于」不该写在 30 秒前。
      const generatedAt = Date.now();
      const html = usageSnapshotHtml({
        days,
        now: readouts.now,
        generatedAt,
        appVersion,
        range,
        projectPaths,
        billing: {
          block: readouts.active,
          weekly: readouts.week,
          planLimitTokens: readouts.plan.limitTokens
        },
        attribution: readouts.attribution
      });
      const path = await bridges.dialog.savePath(usageSnapshotFileName(readouts.now), {
        title: "导出用量快照（单文件 HTML）",
        filterName: "HTML",
        extensions: ["html"]
      });
      // 取消不是失败：不写文件、不报错、不提示。
      if (path === null) return;
      await bridges.fs.writeText(path, html);
      notify("已导出用量快照", "success");
    } catch (cause) {
      // toast 会消失，错误不该跟着消失：就地那行 `role="alert"` 才是主声明。
      const message = `导出失败：${String(cause)}`;
      setExportError(message);
      notify(message, "error");
    } finally {
      setExporting(false);
    }
  }

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

  // 里程碑档自己承担空态（§4.1 第 3 条 / §7）：那句「还没有可统计的会话」是
  // 用量档的语言，让位一行即可——不改文案，免得连带改掉两档的既有截图与断言。
  if (!scanning && inputs.length === 0 && progress.total === 0 && view !== "milestones") {
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
          {/* 里程碑的口径是**全历史**（R2），「近 N 天」对它没有任何作用；摆一个
              不起作用的控件比缺一个控件更坏——用户会以为数字受它影响。 */}
          {view !== "milestones" ? (
            <SegmentedControl
              items={RANGE_ITEMS}
              value={String(days)}
              onChange={(next) => setDays(toRange(next))}
              ariaLabel="时间范围"
            />
          ) : null}
        </div>
        {/* 右簇：进度文本在前、导出按钮在后——右簇贴右，进度变长时向左生长，
            按钮的右边缘固定不动。快照描述的就是「用量」这个视图，所以按钮
            只在用量档渲染。 */}
        <div className={styles.headerActions}>
          <span
            className={styles.progress}
            data-probe="usage-progress"
            {...(scanning ? { "data-probe-pending": true } : {})}
          >
            {scanning
              ? `已分析 ${progress.done} / ${progress.total} 个会话`
              : view === "milestones"
                ? `全部 ${milestoneReport.facts.sessionCount} 个已扫描会话纳入统计`
                : `近 ${days} 天内 ${range.kpi.sessions} 个会话纳入统计`}
            {skipped > 0 ? ` · ${skipped} 个会话读取失败已跳过` : ""}
          </span>
          {view === "usage" ? (
            <Button
              type="button"
              variant="secondary"
              data-probe="usage-snapshot-export"
              aria-label="导出用量快照（单文件 HTML）"
              title={scanning ? "正在扫描会话，扫描完成后可导出" : "导出用量快照（单文件 HTML）"}
              disabled={scanning || exporting}
              onClick={() => void handleExportSnapshot()}
            >
              导出快照
            </Button>
          ) : null}
        </div>
      </div>

      {exportError ? (
        <p className={styles.actionError} role="alert">
          {exportError}
        </p>
      ) : null}

      {view === "errors" ? (
        <ErrorOverviewSection
          stats={errorStats}
          days={days}
          sessionsInWindow={range.kpi.sessions}
          projectPaths={projectPaths}
          onRevealRecord={onRevealRecord}
        />
      ) : view === "milestones" ? (
        /* 里程碑（Round Y）：同一份全历史 inputs、同一次扫描，零新增 I/O。
           `onOpenSession` 缺省（单测直挂页面）时不传，入口退成静态行而不是空按钮。 */
        <MilestonesPanel
          report={milestoneReport}
          onOpenSession={onOpenSession ? openSessionByPath : undefined}
          onOpenDay={openDay}
        />
      ) : (
        <>
          {/* 归因行与压缩统计 top3 共用同一个「打开会话」握手，不新开跳转路径。 */}
          <BillingWindowCard inputs={inputs} readouts={readouts} onOpenSession={onOpenSession} />

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

            {/* 消耗日历住满第二行整行（Issue #187）：53 列的网格不可能塞进半宽
                列，插在「每日 Token 消耗 | 按项目分布」之后也让第一行不留半宽
                空洞（compactionRow 的立身之本）。它是全应用最具传播力的一张图，
                占住第二行整行、进首屏，位置本身是产品决策。聚合依赖只有
                `inputs`——7/30/90 区间选择器与它正交（面板脚注声明）。 */}
            <div className={styles.compactionRow}>
              <UsageCalendarPanel
                inputs={inputs}
                now={calendarNow}
                onOpenSession={onOpenSession}
                drillRequest={dayDrill}
                onDrillHandled={() => setDayDrill(null)}
              />
            </div>

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

            {/* 工具与 skill（N3）住活跃时段之后、压缩统计之前（design 裁决 10）：
                「量级主体 → 配置清单 → 现场（会话）」是一条横向叙事，整行同
                compactionRow 形态（复用同一个类——两处整行容器不该有两个名字）。 */}
            <div className={styles.compactionRow}>
              <ToolCensusPanel
                census={census}
                days={days}
                sessionsInWindow={range.kpi.sessions}
                onOpenSession={onOpenSession}
              />
            </div>

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
