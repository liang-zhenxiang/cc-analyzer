import {
  formatClock,
  formatDateTime,
  formatModelId,
  formatProjectPath,
  formatTokenCount,
  formatUsd
} from "../../lib/format";
import { escapeHtml } from "../sessions/exportHtml";
import { exportShellStyle, WORDMARK_SVG } from "../sessions/exportShell";
import { projectNameOf, REPO_URL } from "../sessions/exportTypes";
import {
  axisTicks,
  formatAxisValue,
  niceAxisMax,
  WEEKDAY_LABELS,
  WEEKDAY_ROW_TO_DAY
} from "./charts/chartPrimitives";
import { PLAN_LIMITS_AS_OF } from "./planLimits";
import { estimateCost, PRICING_AS_OF } from "./pricingSnapshot";
import { formatDayLabel, totalsSum } from "./usageAggregations";
import type { RangeAggregate, UsageSlice } from "./usageAggregations";
import type { BillingBlock } from "./billingWindow";
import type { QuotaAttribution } from "./quotaAttribution";
import type { WeeklyWindow } from "./weeklyWindow";

/**
 * 用量总览的单文件 HTML 快照（Issue #149）。
 *
 * 与会话报告（`sessions/exportHtml.ts`）同源：同一套自包含文档骨架、同一个
 * `escapeHtml`、同一条「唯一出站链接是仓库地址」的红线、同一组 `format*` 口径。
 * 区别只在数据源与视图——那份报告画一次会话，这份画整个用量页。
 *
 * **本模块不做任何聚合。** 传进来的一切都是页面已经算好的结果：
 * `aggregateRange` 的 `RangeAggregate`、`currentBlock` 的窗口、`weeklyWindow`
 * 的滚动 7 天、`attributeQuota` 的 Top 会话。这里既不再遍历会话记录、也不再
 * 切窗口边界——重算就是第二套数字的开始（测试里有一条结构性守卫盯着 import 面）。
 *
 * 时钟也是注入的：`now` 由调用方在真正生成的那一刻传进来，本模块不读系统
 * 时钟、不掷随机数，所以同一个输入必然产出逐字节相同的文件。
 */

export type UsageSnapshotInput = {
  /** 区间档位（7 / 30 / 90），只用来印「近 N 天」。 */
  days: number;
  /** 窗口数学用的时刻（= 屏幕上那组读数用的 tick 值），由调用方给（本模块不读时钟）。 */
  now: number;
  /**
   * 文档落款时刻（「生成于」与页脚），缺省取 `now`。
   *
   * 与 `now` 分开是因为窗口数学现在跟着屏幕走（最多 30 秒前的 tick 值，好处是
   * 文件与屏幕逐字一致），而落款必须是点击那一刻——否则「生成于」是一句假话。
   */
  generatedAt?: number;
  appVersion: string;
  /** 页面当时那份聚合结果。 */
  range: RangeAggregate;
  /** 项目标签 → 本机工作目录，只为把标签还原成目录名（路径本身不落盘）。 */
  projectPaths: ReadonlyMap<string, string>;
  billing: {
    /** `currentBlock(...)` 的结果；没有进行中的窗口时为 `null`。 */
    block: BillingBlock | null;
    /** `weeklyWindow(...)` 的结果。 */
    weekly: WeeklyWindow;
    /** 用户自设的 5 小时窗口限额；`null` / 缺省都表示没设置。 */
    planLimitTokens?: number | null;
  };
  /** `attributeQuota(...)` 的结果；没有窗口或没有记录时是 `null`。 */
  attribution: QuotaAttribution | null;
};

/**
 * h1 逐字用页面 `aria-label` 与侧栏标签。「快照」由 `<title>`、文件名与页脚
 * 已经说清，标题里不再重复一遍（设计规格 §1.3）。
 */
export const SNAPSHOT_TITLE = "用量总览";

/**
 * 单句自述：不含的那几块来自 Issue #149 的原句，不得改写（设计规格 §1.3）。
 * Round V（Issue #187）补上「消耗日历」：日历上线后这句若不跟着改，「不含」
 * 清单就成了漏报——读者会以为快照是整页仪表盘，而日历恰恰是页面新添的门面图。
 * 快照导出日历本身（SVG 化 / 打印矩阵）留待后续棒；这里的修改只是文案诚实性。
 * e2e 的 usage-snapshot.spec.ts 有一份逐字契约常量（SCOPE_NOTE），两处只能有
 * 一个原文。
 */
export const SNAPSHOT_SCOPE_NOTE =
  "本快照包含用量总览的读数与图表；不含消耗日历、工具与 skill 普查、压缩统计、错误档。";

/** 空态标题与正文（设计规格 §6.2）。`{days}` 由 `snapshotEmptyText` 填。 */
export const SNAPSHOT_EMPTY_TITLE = "所选区间内没有会话记录";
export const SNAPSHOT_EMPTY_TEXT =
  "生成这份快照的机器上，近 {days} 天内没有可统计的会话记录。这份快照只记录这个事实，没有图表可画。";

/** 趋势图下的口径句（设计规格 §4.2）。 */
export const SNAPSHOT_TREND_CAPTION =
  "每根柱 = 一个自然日（本地时区）；纵轴为四类 token 之和（与上方「Tokens 总量」同一个口径）。";

/** 归因表的分母句与两层限额的必带句（设计规格 §5.3、§5.4），逐字。 */
export const SNAPSHOT_ATTRIBUTION_DENOMINATOR =
  "占比分母 = 本窗口总消耗（与表盘中心同一个数）。";
export const SNAPSHOT_WEEKLY_NOTE = "滚动 7 天累计，不是官方重置窗口，两者不逐分钟吻合";
export const SNAPSHOT_NO_PLAN_NOTE =
  "未选择订阅计划：只显示消耗，不显示百分比——没有分母就没有比率。";
export const SNAPSHOT_NO_WINDOW_NOTE = "当前没有进行中的 5 小时计费窗口。";
export const SNAPSHOT_ATTRIBUTION_EMPTY = "本窗口没有可归因的会话消耗。";

export function snapshotEmptyText(days: number): string {
  return SNAPSHOT_EMPTY_TEXT.replace("{days}", String(days));
}

/**
 * 快照自己的规则。页面外壳（token、reset、body、sheet、页头、品牌字形、
 * `.meta`、页脚、深色与打印媒体查询，以及共用的读数带条目与表格语言）在
 * `sessions/exportShell.ts` 里只有一份权威定义——快照与会话报告是同一张纸的
 * 两个版次。留在这里的是这份文档独有的东西：`--chart-*` 调色板、KPI 上标读数
 * 带、图表/热力图/计费窗口/归因，以及窄屏与打印时的分页规则。
 */
const SNAPSHOT_TOKENS = `  --chart-1: #2f6b9f;
  --chart-1-soft: rgba(47, 107, 159, 0.24);
  --chart-2: #0f7f8f;
  --chart-2-soft: rgba(15, 127, 143, 0.24);
  --chart-3: #618428;
  --chart-3-soft: rgba(97, 132, 40, 0.24);
  --chart-4: #a67a08;
  --chart-4-soft: rgba(166, 122, 8, 0.24);
  --chart-5: #8a6fd4;
  --chart-5-soft: rgba(138, 111, 212, 0.24);
  --chart-6: #bf4a78;
  --chart-6-soft: rgba(191, 74, 120, 0.24);
`;

/** `.meta` 之后：包含声明条与四格读数带的容器。 */
const SNAPSHOT_BEFORE_READOUTS = `.coverage {
  margin: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--inset);
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 16px;
}
.readouts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 12px 0 0;
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--inset);
}
`;

/** 读数带条目之后：上标、出处说明与区块外壳。 */
const SNAPSHOT_BEFORE_HEADING = `.readout sup { font-size: 9px; line-height: 12px; }
.readouts-note { margin: 8px 0 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.block { margin-top: 32px; }
`;

/** `h2` 之后：图表、热力图、计费窗口与归因。 */
const SNAPSHOT_AFTER_HEADING = `h3 { margin: 20px 0 8px; color: var(--text); font-size: 13px; font-weight: 600; line-height: 20px; }
h3:first-of-type { margin-top: 0; }
.caption { margin: 8px 0 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.chart { display: block; width: 100%; height: auto; max-width: 720px; }
.grid-line { stroke: var(--border); stroke-width: 1; }
.axis-line { stroke: var(--border-strong); stroke-width: 1; }
.axis-text { fill: var(--text-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.trend-bar { fill: var(--chart-1-soft); stroke: var(--chart-1); stroke-width: 1; }
.dist-bar { fill: var(--chart-1-soft); stroke: var(--chart-1); stroke-width: 1; }
.model-segment { stroke-width: 1; }
.model-legend {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.model-legend li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  line-height: 16px;
}
.model-legend .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
/* 名字与数值必须读成一组：名字用省略号收窄（长 id 不撑破两列），
   数值与色块刚性不动，间距固定 8px。行里不留吸走空档的弹性轨道，否则
   数值会被推到格子右边缘，和名字之间裂开几百像素（#149 的排版缺陷）。 */
.model-legend .model-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.model-legend .model-value { flex: none; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.heat { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px 24px; }
.heat svg { width: 556px; max-width: 100%; height: auto; display: block; }
.heat-cell { fill: var(--chart-1); }
.heat-empty { fill: var(--inset); }
.heat-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0 0 4px;
  color: var(--text-tertiary);
  font-size: 11px;
  line-height: 16px;
}
.heat-legend-cell { width: 10px; height: 10px; background: var(--chart-1); }
.window { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; }
.gauge { width: 112px; height: 112px; }
.window-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin: 0;
  min-width: 280px;
  flex: 1 1 320px;
}
.window-facts div { display: flex; flex-direction: column; gap: 2px; }
.window-facts dt { color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.window-facts dd { margin: 0; font-size: 13px; line-height: 20px; font-variant-numeric: tabular-nums; }
.week {
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--inset);
}
.week-name { margin: 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.week-value {
  margin: 2px 0 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  font-variant-numeric: tabular-nums;
}
.week-sub { margin: 4px 0 0; color: var(--text-secondary); font-size: 13px; line-height: 20px; }
.week-sub em { font-style: normal; font-variant-numeric: tabular-nums; }
.week-note { margin: 8px 0 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.budget { margin-top: 8px; }
.budget-track { height: 4px; border-radius: 2px; background: var(--border-strong); overflow: hidden; }
.budget-fill { display: block; height: 100%; background: var(--chart-1); }
.budget-text { margin: 4px 0 0; color: var(--text-secondary); font-size: 11px; line-height: 16px; }
.plan-note { margin: 8px 0 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.denominator { margin: 0 0 8px; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
`;

/** 表格语言之后：归因表的列与空态。 */
const SNAPSHOT_AFTER_TABLE = `.session-title { overflow-wrap: anywhere; }
.project-cell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.share-cell { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.share-track { width: 56px; height: 6px; background: var(--border-strong); overflow: hidden; }
.share-fill { display: block; height: 100%; background: var(--chart-1); }
.rest-row td { border-top: 1px solid var(--border); color: var(--text-tertiary); }
.rest-row .share-fill { background: var(--chart-1-soft); }
.muted { margin: 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
.block.empty { margin-top: 32px; }
.block.empty p { margin: 0; color: var(--text-tertiary); font-size: 11px; line-height: 16px; }
`;

/** 页脚之后：窄屏降级。 */
const SNAPSHOT_AFTER_FOOT = `@media (max-width: 720px) {
  body { padding: 16px 8px; }
  .sheet { padding: 20px 16px; }
  .readouts { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 12px; }
  .readout { padding: 0; }
  .readout + .readout { border-left: 0; }
  .model-legend { grid-template-columns: minmax(0, 1fr); }
}
`;

const SNAPSHOT_DARK_TOKENS = `    --chart-1: #82b5e8;
    --chart-1-soft: rgba(130, 181, 232, 0.3);
    --chart-2: #55bfce;
    --chart-2-soft: rgba(85, 191, 206, 0.3);
    --chart-3: #8ec45c;
    --chart-3-soft: rgba(142, 196, 92, 0.3);
    --chart-4: #edc14e;
    --chart-4-soft: rgba(237, 193, 78, 0.3);
    --chart-5: #c398ec;
    --chart-5-soft: rgba(195, 152, 236, 0.3);
    --chart-6: #ef8ab3;
    --chart-6-soft: rgba(239, 138, 179, 0.3);
`;

/**
 * 打印时的浅色重声明。比会话报告那份更彻底：深色系统下打印时
 * `prefers-color-scheme` 通常仍生效，只刷白底会得到白纸上的浅灰字。
 */
const SNAPSHOT_PRINT_ROOT = `  :root {
    --bg: #ffffff;
    --surface: #ffffff;
    --inset: #f1f3f5;
    --text: #16181b;
    --text-secondary: #4a5260;
    --text-tertiary: #6b7381;
    --border: rgba(16, 24, 40, 0.1);
    --border-strong: rgba(16, 24, 40, 0.18);
    --accent: #2952cc;
    --chart-1: #2f6b9f;
    --chart-1-soft: rgba(47, 107, 159, 0.24);
    --chart-2: #0f7f8f;
    --chart-2-soft: rgba(15, 127, 143, 0.24);
    --chart-3: #618428;
    --chart-3-soft: rgba(97, 132, 40, 0.24);
    --chart-4: #a67a08;
    --chart-4-soft: rgba(166, 122, 8, 0.24);
    --chart-5: #8a6fd4;
    --chart-5-soft: rgba(138, 111, 212, 0.24);
    --chart-6: #bf4a78;
    --chart-6-soft: rgba(191, 74, 120, 0.24);
  }
`;

/** 打印块内 `.sheet` 之后：模块自己的分页规则。 */
const SNAPSHOT_PRINT_RULES = `  .readouts, .block, .table-wrap, .week, .model-legend, .heat { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  .foot a { text-decoration: none; }
`;

/** 快照的样式表，内联：外壳来自共享模块，插槽填的是上面这些专属规则。 */
const STYLE = exportShellStyle({
  tokens: SNAPSHOT_TOKENS,
  beforeReadouts: SNAPSHOT_BEFORE_READOUTS,
  beforeHeading: SNAPSHOT_BEFORE_HEADING,
  afterHeading: SNAPSHOT_AFTER_HEADING,
  afterTable: SNAPSHOT_AFTER_TABLE,
  afterFoot: SNAPSHOT_AFTER_FOOT,
  darkTokens: SNAPSHOT_DARK_TOKENS,
  printRoot: SNAPSHOT_PRINT_ROOT,
  printRules: SNAPSHOT_PRINT_RULES
});

/** 热力图几何，逐值抄 `charts/Heatmap.tsx`。 */
const HEAT_CELL = 20;
const HEAT_GAP = 2;
const HEAT_LABEL_LEFT = 22;
const HEAT_LABEL_TOP = 16;
const HEAT_HOUR_STRIDE = 4;
const HEAT_OPACITY_STEPS = [0, 0.3, 0.5, 0.68, 0.84];

/** 趋势图几何，逐值抄 `charts/BarChart.tsx`。 */
const TREND_WIDTH = 720;
const TREND_HEIGHT = 170;
const TREND_PAD_LEFT = 56;
const TREND_PAD_RIGHT = 10;
const TREND_PAD_TOP = 8;
const TREND_PAD_BOTTOM = 22;
const TREND_MIN_BAR = 1.5;

/** 横向分布几何，逐值抄 `charts/HBarChart.tsx`。 */
const BAR_WIDTH = 720;
const BAR_LABEL_WIDTH = 170;
const BAR_VALUE_WIDTH = 76;
const BAR_ROW_HEIGHT = 26;
const BAR_PAD_Y = 4;

/** 堆叠条几何，逐值抄 `charts/StackedBar.tsx`。 */
const STACK_WIDTH = 720;
const STACK_HEIGHT = 30;
const STACK_PAD = 2;

/** 表盘几何，逐值抄 `charts/Gauge.tsx`。 */
const GAUGE_SIZE = 120;
const GAUGE_STROKE = 10;
const GAUGE_RADIUS = (GAUGE_SIZE - GAUGE_STROKE) / 2;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

/** 归因表的占比条：56×6，非零最小 2px（设计规格 §5.4）。 */
const SHARE_TRACK = 56;
const SHARE_MIN_FILL = 2;

function readout(label: string, value: string, marker: string): string {
  return `<div class="readout"><dt>${escapeHtml(label)}<sup>${escapeHtml(marker)}</sup></dt><dd>${escapeHtml(value)}</dd></div>`;
}

function windowFact(label: string, value: string): string {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function block(name: string, title: string, body: string): string {
  return `<section class="block" data-snapshot-section="${name}"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

/** 占比文案：精确值 ×100 保留 1 位；非零但极小写 `<0.1%`（设计规格 §5.4）。 */
function shareText(part: number, whole: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return "";
  const percent = (part / whole) * 100;
  if (percent > 0 && percent < 0.05) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/**
 * 项目名只出目录名。`projectNameOf` 顺带挡住「项目就落在主目录」那种情况
 * ——那时目录名是用户名，正是会话报告一直在防的泄露（见 `exportTypes.ts`）。
 */
function projectName(label: string, cwd: string | undefined): string {
  return projectNameOf(cwd, formatProjectPath(label));
}

/**
 * 成本的口径与用量页 KPI 那一格完全一致：逐个模型按自己的族价折算，
 * 未收录定价的模型不进分子，而是单独记数——把一个未知价的模型算成 0
 * 会让总额读起来像账单。
 */
function costOf(models: RangeAggregate["models"]): {
  usd: number;
  hasUnknown: boolean;
  unknownTokens: number;
} {
  let usd = 0;
  let hasUnknown = false;
  let unknownTokens = 0;
  for (const [model, totals] of models) {
    const estimate = estimateCost(totals, model);
    if ("unknownModel" in estimate) {
      hasUnknown = true;
      unknownTokens += totalsSum(totals);
    } else {
      usd += estimate.usd;
    }
  }
  return { usd, hasUnknown, unknownTokens };
}

/** 每日趋势：柱数就是日序列长度，一根不多一根不少。 */
function trendSvg(series: RangeAggregate["dailySeries"]): string {
  if (series.length === 0) return '<p class="muted">所选范围内暂无消耗</p>';

  const plotWidth = TREND_WIDTH - TREND_PAD_LEFT - TREND_PAD_RIGHT;
  const plotHeight = TREND_HEIGHT - TREND_PAD_TOP - TREND_PAD_BOTTOM;
  const values = series.map((point) => totalsSum(point));
  const max = niceAxisMax(Math.max(...values));
  const slot = plotWidth / series.length;
  const barWidth = Math.min(slot * 0.72, 44);
  const labelStride = Math.max(1, Math.ceil(series.length / 12));

  const parts: string[] = [];
  for (const tick of axisTicks(max, 3)) {
    const y = TREND_PAD_TOP + (1 - tick / max) * plotHeight;
    parts.push(
      `<line class="${tick === 0 ? "axis-line" : "grid-line"}" x1="${TREND_PAD_LEFT}" x2="${TREND_WIDTH - TREND_PAD_RIGHT}" y1="${y.toFixed(2)}" y2="${y.toFixed(2)}"/>`
    );
    parts.push(
      `<text class="axis-text" x="${TREND_PAD_LEFT - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(formatAxisValue(tick))}</text>`
    );
  }

  series.forEach((point, index) => {
    const value = values[index];
    // 空桶也留一根 1.5px 的桩：高度为 0 的柱子和「图没画出来」分不清。
    const barHeight = Math.max((value / max) * plotHeight, TREND_MIN_BAR);
    const x = TREND_PAD_LEFT + index * slot + (slot - barWidth) / 2;
    const y = TREND_PAD_TOP + plotHeight - barHeight;
    parts.push(
      `<rect class="trend-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}"><title>${escapeHtml(`${formatDayLabel(point.dayStart)}：${formatTokenCount(value)}`)}</title></rect>`
    );
    if (index % labelStride === 0) {
      parts.push(
        `<text class="axis-text" x="${(TREND_PAD_LEFT + index * slot + slot / 2).toFixed(2)}" y="${TREND_HEIGHT - 6}" text-anchor="middle">${escapeHtml(formatDayLabel(point.dayStart))}</text>`
      );
    }
  });

  return (
    `<svg class="chart" viewBox="0 0 ${TREND_WIDTH} ${TREND_HEIGHT}" role="img" aria-label="每日 Token 消耗趋势">` +
    parts.join("") +
    "</svg>" +
    `<p class="caption">${escapeHtml(SNAPSHOT_TREND_CAPTION)}</p>`
  );
}

/**
 * 按项目分布：横向条，几何与 `HBarChart.tsx` 逐值相同。
 * `<title>` 只放目录名——这个文件是要发出去的，完整路径不上纸面。
 */
function projectSvg(
  slices: readonly UsageSlice[],
  projectPaths: ReadonlyMap<string, string>
): string {
  if (slices.length === 0) return '<p class="muted">所选范围内暂无项目消耗</p>';

  const plotWidth = BAR_WIDTH - BAR_LABEL_WIDTH - BAR_VALUE_WIDTH;
  const height = BAR_PAD_Y + slices.length * BAR_ROW_HEIGHT + BAR_PAD_Y;
  const max = Math.max(...slices.map((slice) => slice.value), 1);

  const rows = slices.map((slice, index) => {
    const y = BAR_PAD_Y + index * BAR_ROW_HEIGHT;
    const name = projectName(slice.label, projectPaths.get(slice.label));
    const barWidth = (slice.value / max) * plotWidth;
    return (
      `<g class="dist-row">` +
      `<text class="axis-text" x="${BAR_LABEL_WIDTH - 8}" y="${y + BAR_ROW_HEIGHT / 2 + 4}" text-anchor="end">${escapeHtml(name)}</text>` +
      `<rect class="dist-bar" x="${BAR_LABEL_WIDTH}" y="${y + 5}" width="${barWidth.toFixed(2)}" height="${BAR_ROW_HEIGHT - 10}"><title>${escapeHtml(name)}</title></rect>` +
      `<text class="axis-text" x="${(BAR_LABEL_WIDTH + barWidth + 8).toFixed(2)}" y="${y + BAR_ROW_HEIGHT / 2 + 4}">${escapeHtml(formatTokenCount(slice.value))}</text>` +
      `</g>`
    );
  });

  return `<svg class="chart" viewBox="0 0 ${BAR_WIDTH} ${height}" role="img" aria-label="按项目分布">${rows.join("")}</svg>`;
}

/**
 * 按模型分布：单行堆叠条 + 两列图例。
 * 原始模型 id **不进快照**——纸上没有悬停，完整 id 清单也不属于这张摘要。
 */
function modelChart(slices: readonly UsageSlice[]): string {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (slices.length === 0 || total <= 0) {
    return '<p class="muted">所选范围内暂无模型消耗</p>';
  }

  const plotWidth = STACK_WIDTH - STACK_PAD * 2;
  let x = STACK_PAD;
  const segments: string[] = [];
  slices.forEach((slice, index) => {
    const width = (slice.value / total) * plotWidth;
    const color = (index % 6) + 1;
    segments.push(
      `<rect class="model-segment" x="${x.toFixed(2)}" y="4" width="${width.toFixed(2)}" height="${STACK_HEIGHT - 8}" fill="var(--chart-${color}-soft)" stroke="var(--chart-${color})"/>`
    );
    x += width;
  });

  const legend = slices
    .map(
      (slice, index) =>
        `<li><span class="swatch" style="background:var(--chart-${(index % 6) + 1})"></span>` +
        `<span class="model-name">${escapeHtml(formatModelId(slice.label))}</span>` +
        `<span class="model-value">${escapeHtml(formatTokenCount(slice.value))}</span></li>`
    )
    .join("");

  return (
    `<svg class="chart" viewBox="0 0 ${STACK_WIDTH} ${STACK_HEIGHT}" role="img" aria-label="按模型分布">${segments.join("")}</svg>` +
    `<ul class="model-legend">${legend}</ul>`
  );
}

/** 7×24 活跃时段。`hourly` 是 `[getDay()][hour]`（0 = 周日），显示按周一开头。 */
function heatmap(block: string, hourly: readonly number[][]): string {
  const total = hourly.reduce(
    (sum, row) => sum + row.reduce((rowSum, count) => rowSum + count, 0),
    0
  );
  if (total <= 0) {
    return `<section class="block" data-snapshot-section="heatmap"><h2>${escapeHtml(block)}</h2><p class="muted">暂无活跃时段</p></section>`;
  }

  const max = hourly.reduce((highest, row) => Math.max(highest, ...row), 0);
  const width = HEAT_LABEL_LEFT + 24 * HEAT_CELL + 23 * HEAT_GAP + 8;
  const height = HEAT_LABEL_TOP + 7 * HEAT_CELL + 6 * HEAT_GAP + 6;
  const parts: string[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    if (hour % HEAT_HOUR_STRIDE !== 0) continue;
    parts.push(
      `<text class="axis-text" x="${HEAT_LABEL_LEFT + hour * (HEAT_CELL + HEAT_GAP)}" y="12">${hour}</text>`
    );
  }

  WEEKDAY_ROW_TO_DAY.forEach((day, rowIndex) => {
    parts.push(
      `<text class="axis-text heat-weekday" x="${HEAT_LABEL_LEFT - 8}" y="${HEAT_LABEL_TOP + rowIndex * (HEAT_CELL + HEAT_GAP) + HEAT_CELL / 2 + 4}" text-anchor="end">${escapeHtml(WEEKDAY_LABELS[rowIndex])}</text>`
    );
    for (let hour = 0; hour < 24; hour += 1) {
      const count = hourly[day]?.[hour] ?? 0;
      const level =
        count <= 0
          ? 0
          : Math.max(1, Math.ceil((count / max) * (HEAT_OPACITY_STEPS.length - 1)));
      const opacity = level === 0 ? "" : ` fill-opacity="${HEAT_OPACITY_STEPS[level]}"`;
      parts.push(
        `<rect class="heat-cell${level === 0 ? " heat-empty" : ""}" x="${HEAT_LABEL_LEFT + hour * (HEAT_CELL + HEAT_GAP)}" y="${HEAT_LABEL_TOP + rowIndex * (HEAT_CELL + HEAT_GAP)}" width="${HEAT_CELL}" height="${HEAT_CELL}"${opacity}><title>${escapeHtml(`${WEEKDAY_LABELS[rowIndex]} ${hour}时：${count} 条消息`)}</title></rect>`
      );
    }
  });

  // 色阶图例与格子共用同一组透明度：没有图例的色阶不算刻度。
  const legend = HEAT_OPACITY_STEPS.slice(1)
    .map((step) => `<span class="heat-legend-cell" style="opacity:${step}"></span>`)
    .join("");

  return (
    `<section class="block" data-snapshot-section="heatmap"><h2>${escapeHtml(block)}</h2><div class="heat">` +
    `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="活跃时段热力图">${parts.join("")}</svg>` +
    `<div class="heat-legend"><span>少</span>${legend}<span>多</span></div>` +
    `</div></section>`
  );
}

/** 表盘：只在有分母（选了计划）时画，弧的比例另用一句话写出来。 */
function gaugeSvg(consumed: number, limitTokens: number): string {
  const share = Math.min(1, Math.max(0, consumed / limitTokens));
  const dash = share * GAUGE_CIRCUMFERENCE;
  const center = GAUGE_SIZE / 2;
  return (
    `<svg class="gauge" viewBox="0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}" role="img" aria-label="5 小时窗口已用 ${escapeHtml(shareText(consumed, limitTokens))}">` +
    `<circle cx="${center}" cy="${center}" r="${GAUGE_RADIUS}" fill="none" stroke="var(--border)" stroke-width="${GAUGE_STROKE}"/>` +
    `<circle cx="${center}" cy="${center}" r="${GAUGE_RADIUS}" fill="none" stroke="var(--chart-1)" stroke-width="${GAUGE_STROKE}" stroke-linecap="round" stroke-dasharray="${dash.toFixed(2)} ${GAUGE_CIRCUMFERENCE.toFixed(2)}" transform="rotate(-90 ${center} ${center})"/>` +
    `<text class="gauge-value" x="50%" y="47%" text-anchor="middle" fill="var(--text)" font-size="20" font-weight="600">${escapeHtml(formatTokenCount(consumed))}</text>` +
    `<text class="gauge-label" x="50%" y="60%" text-anchor="middle" fill="var(--text-tertiary)" font-size="11">本窗口消耗</text>` +
    `</svg>`
  );
}

/** 两层限额：读数全部取自已算好的窗口对象。 */
function billingSection(
  block: BillingBlock | null,
  weekly: WeeklyWindow,
  planLimitTokens: number | null
): string {
  const hasPlanLimit =
    planLimitTokens !== null && planLimitTokens !== undefined && planLimitTokens > 0;
  const consumed = block ? totalsSum(block.totals) : 0;

  // 5 小时层：没有进行中的窗口时不整块消失，换一句实话（设计规格 §5.5）。
  const windowBody = block
    ? `<div class="window">` +
      (hasPlanLimit ? gaugeSvg(consumed, planLimitTokens) : "") +
      `<dl class="window-facts">` +
      windowFact("窗口开启", formatClock(block.start)) +
      windowFact("窗口关闭", formatClock(block.end)) +
      windowFact("本窗口消耗", `${formatTokenCount(consumed)} tok`) +
      windowFact("消息数", block.messages.toLocaleString("en-US")) +
      windowFact(
        "限额",
        hasPlanLimit ? `${formatTokenCount(planLimitTokens)} tok` : "未设置"
      ) +
      windowFact("已用", hasPlanLimit ? shareText(consumed, planLimitTokens) : "—") +
      `</dl></div>` +
      (hasPlanLimit
        ? `<p class="caption">当前窗口已用 ${escapeHtml(shareText(consumed, planLimitTokens))}（估算限额）</p>`
        : "") +
      `<p class="plan-note">${
        hasPlanLimit
          ? escapeHtml(
              `限额为社区整理的估算值（整理于 ${PLAN_LIMITS_AS_OF}，非官方数字），仅供参照，不是账单。`
            )
          : escapeHtml(SNAPSHOT_NO_PLAN_NOTE)
      }</p>`
    : `<p class="muted">${escapeHtml(SNAPSHOT_NO_WINDOW_NOTE)}</p>`;

  const weekConsumed = totalsSum(weekly.consumed);
  const weekPrevious = totalsSum(weekly.previousConsumed);
  const weekLimit = weekly.limitTokens;
  const hasWeekLimit = weekLimit !== null && weekLimit > 0;
  const delta =
    weekPrevious > 0
      ? `${weekConsumed >= weekPrevious ? "+" : "-"}${(Math.abs(weekConsumed - weekPrevious) / weekPrevious * 100).toFixed(1)}%`
      : "";

  const weekBody =
    `<div class="week">` +
    `<p class="week-name">滚动 7 天</p>` +
    `<p class="week-value">${escapeHtml(formatTokenCount(weekConsumed))}</p>` +
    `<p class="week-sub">日均 <em>${escapeHtml(formatTokenCount(Math.round(weekConsumed / 7)))}</em>/日 · ${
      delta ? `较上一周期 <em>${escapeHtml(delta)}</em>` : "上一周期 0"
    }</p>` +
    `<p class="week-sub">活跃天数 <em>${weekly.activeDays.toLocaleString("en-US")}</em> 天</p>` +
    (hasWeekLimit
      ? `<div class="budget">` +
        `<div class="budget-track"><div class="budget-fill" style="width:${Math.min(100, (weekConsumed / weekLimit) * 100).toFixed(2)}%"></div></div>` +
        `<p class="budget-text">周预算已用 ${escapeHtml(shareText(weekConsumed, weekLimit))}（预算为自设数字）</p>` +
        `</div>`
      : `<p class="budget-text">未设周预算——只显示消耗</p>`) +
    `<p class="week-note">${escapeHtml(SNAPSHOT_WEEKLY_NOTE)}</p>` +
    `</div>`;

  return (
    `<section class="block" data-snapshot-section="limits"><h2>计费窗口</h2>` +
    `<h3>5 小时窗口</h3>${windowBody}` +
    `<h3>滚动 7 天</h3>${weekBody}` +
    `</section>`
  );
}

/** 本窗口消耗 Top 会话：只列会话标题与目录名，日志路径不上文件。 */
function attributionBlock(attribution: QuotaAttribution | null): string {
  const rows = attribution?.rows ?? [];
  const denominator = `<p class="denominator">${escapeHtml(SNAPSHOT_ATTRIBUTION_DENOMINATOR)}</p>`;
  const head =
    `<section class="block" data-snapshot-section="attribution"><h3>本窗口消耗 Top 会话</h3>` +
    denominator;

  if (!attribution || attribution.windowTokens <= 0 || rows.length === 0) {
    return head + `<p class="muted">${escapeHtml(SNAPSHOT_ATTRIBUTION_EMPTY)}</p></section>`;
  }

  const shareCell = (part: number, fill: string): string => {
    const width =
      part > 0 ? Math.max(SHARE_MIN_FILL, (part / attribution.windowTokens) * SHARE_TRACK) : 0;
    return (
      `<td class="num"><span class="share-cell"><span class="share-track">` +
      `<span class="share-fill" style="width:${width.toFixed(2)}px;background:${fill}"></span>` +
      `</span>${escapeHtml(shareText(part, attribution.windowTokens))}</span></td>`
    );
  };

  const body = rows
    .map(
      (row) =>
        `<tr class="attribution-row">` +
        `<td class="session-title">${escapeHtml(row.title)}</td>` +
        `<td class="project-cell">${escapeHtml(projectName(row.projectLabel, row.projectPath))}</td>` +
        `<td class="num">${escapeHtml(formatTokenCount(row.tokens))} tok</td>` +
        shareCell(row.tokens, "var(--chart-1)") +
        `</tr>`
    )
    .join("");
  const remainder = attribution.remainder
    ? `<tr class="rest-row">` +
      `<td colspan="2">其余 ${attribution.remainder.sessions.toLocaleString("en-US")} 个会话</td>` +
      `<td class="num">${escapeHtml(formatTokenCount(attribution.remainder.tokens))} tok</td>` +
      shareCell(attribution.remainder.tokens, "var(--chart-1-soft)") +
      `</tr>`
    : "";

  return (
    head +
    `<div class="table-wrap"><table><thead><tr>` +
    `<th>会话</th><th>项目</th><th class="num">本窗口消耗</th><th class="num">占比</th>` +
    `</tr></thead><tbody>${body}${remainder}</tbody></table></div></section>`
  );
}

/** 快照文件名：`cc-analyzer-usage-YYYY-MM-DD.html`（本地日历日，没有空格）。 */
export function usageSnapshotFileName(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `cc-analyzer-usage-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.html`;
}

/**
 * 一个自包含的单文件 HTML 快照：一个 `<style>`、几张内联 SVG、一个出站链接。
 *
 * 与会话报告同一条约束链：能离线打开（无 CDN、无字体文件、无图片）、能被
 * 直接贴进聊天窗口（语义骨架、无 JS）、只带窗口里本来就有的东西——项目以
 * 目录名出现，路径与日志文件名一个都不上文件。
 */
export function usageSnapshotHtml(input: UsageSnapshotInput): string {
  const { range, days, appVersion } = input;
  // `now` 只喂窗口数学（在调用方）；文档上的时刻一律用落款时刻。
  const generatedAt = input.generatedAt ?? input.now;
  const cost = costOf(range.models);
  const empty = range.kpi.sessions === 0;

  const costNote =
    `² 估算成本按定价快照（${PRICING_AS_OF}）折算，不是账单。` +
    (cost.hasUnknown
      ? `部分会话未知价 · 约 ${formatTokenCount(cost.unknownTokens)} tok 未计入。`
      : "");

  const head =
    `<header class="head">` +
    `<span class="wordmark">${WORDMARK_SVG} CC Analyzer</span>` +
    `<h1>${escapeHtml(SNAPSHOT_TITLE)}</h1>` +
    `<p class="meta">区间 <code>近 ${escapeHtml(String(days))} 天</code> · 生成于 ${escapeHtml(formatDateTime(generatedAt))} · CC Analyzer v${escapeHtml(appVersion)} · 定价快照 <code>${escapeHtml(PRICING_AS_OF)}</code></p>` +
    `<p class="coverage">本快照的数字取自用量总览当时的聚合结果，生成时未重算；${escapeHtml(SNAPSHOT_SCOPE_NOTE)}</p>` +
    `</header>`;

  const readouts =
    `<dl class="readouts">` +
    readout("Tokens 总量", formatTokenCount(range.kpi.tokens), "1") +
    readout("会话数", range.kpi.sessions.toLocaleString("en-US"), "1") +
    readout("消息数", range.kpi.messages.toLocaleString("en-US"), "1") +
    readout("估算成本", formatUsd(cost.usd), "2") +
    `</dl>` +
    `<p class="readouts-note">${escapeHtml(`¹ Tokens 总量、会话数、消息数读自本机日志；${costNote}`)}</p>`;

  // 整篇空态：读数是 0 会被读成真实数据，成本没有分母时是「未知」不是 $0.00，
  // 所以这一档既不给读数带、也不给任何空图（设计规格 §6）。
  const body = empty
    ? `<section class="block empty"><h2>${escapeHtml(SNAPSHOT_EMPTY_TITLE)}</h2><p>${escapeHtml(snapshotEmptyText(days))}</p></section>`
    : readouts +
      block("trend", "每日 Token 消耗", trendSvg(range.dailySeries)) +
      block("projects", "按项目分布", projectSvg(range.topProjects, input.projectPaths)) +
      block("models", "按模型分布", modelChart(range.topModels)) +
      heatmap("活跃时段（周 × 小时）", range.hourly) +
      billingSection(input.billing.block, input.billing.weekly, input.billing.planLimitTokens ?? null) +
      attributionBlock(input.attribution);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <title>CC Analyzer 用量快照 · 近 ${escapeHtml(String(days))} 天</title>
  <style>${STYLE}</style>
</head>
<body>
  <main class="sheet">
    ${head}
    ${body}
    <footer class="foot">
      <p>本快照由 CC Analyzer 生成，数据未上传至任何服务器。</p>
      <p>CC Analyzer v${escapeHtml(appVersion)} · <a href="${REPO_URL}" rel="noreferrer">github.com/liang-zhenxiang/cc-analyzer</a></p>
      <p>快照生成于 ${escapeHtml(formatDateTime(generatedAt))}</p>
    </footer>
  </main>
</body>
</html>
`;
}
