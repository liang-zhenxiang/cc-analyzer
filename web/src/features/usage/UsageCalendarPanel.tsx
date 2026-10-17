import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Panel } from "../../components/Panel";
import {
  formatClock,
  formatDuration,
  formatModelId,
  formatProjectPath,
  formatTokenCount,
  formatUsd
} from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import {
  clockAt,
  dayFractionOf,
  dayReviewOf,
  densityLevelOf,
  type DayReview,
  type DaySessionSpan,
  type DaySummary
} from "./dayReview";
import { PRICING_AS_OF } from "./pricingSnapshot";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { Provenance } from "./provenance";
import { WEEKDAY_LABELS } from "./charts/chartPrimitives";
import {
  calendarInsightsOf,
  type CalendarInsights,
  type MonthCompare
} from "./calendarInsights";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import { buildUsageCalendar, type CalendarDayFacts } from "./usageCalendar";
import styles from "./UsageCalendarPanel.module.css";

/** 面板脚注：窗口正交（Issue 原话「固定滚动 12 个月，不随区间选择器变」）。 */
const FOOTNOTE =
  "窗口固定滚动近 12 个月（365 天），不随上方区间选择器变化；色深 = 当日估算成本的四分位档，0 档 = 无消耗。";

/**
 * 展开区脚注（Round V2 §4.3 逐字）：四条口径都写在明处——活跃跨度的定义、
 * 占比分母、成本是估算、项目色的取色档位。快照日期只有 PRICING_AS_OF 一个来源。
 */
const DAY_FOOTNOTE = `活跃跨度 = 当天首条至末条记录的时刻，不是有活动的小时数；占比分母 = 当日 token 总量。成本为估算值（定价快照 ${PRICING_AS_OF}），token、会话数、消息数读自本机日志；项目色按当日 token 降序取前 5 名，其余项目并入「其他」。`;

/** 轴刻度的小时（0/3/…/21）；第 9 个刻度是 `24:00`（一天的终点）。 */
const AXIS_HOURS = [0, 3, 6, 9, 12, 15, 18, 21] as const;

/** 摘要行的六项，顺序即契约（门禁数 items === 6，键写死）。 */
type SummaryKey = "cost" | "sessions" | "messages" | "span" | "model" | "projects";

/**
 * 格子的可访问名 / 悬停说明——一份格式函数两处用，不许分叉。日期永远带年
 * （title 是跨年窗口里唯一可靠的年号来源）；行序固定：日期 → 成本 → token →
 * 会话数 → 项目（成本是色深口径所以先于 token，Issue 契约的顺序）。
 */
function cellLabelOf(cell: {
  dayStart: number;
  tokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
  messages: number;
  sessions: number;
  topProject: { label: string; path?: string } | null;
}): string {
  const date = new Date(cell.dayStart);
  const dateText = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
  if (cell.messages === 0) return `${dateText} · 无消耗`;
  if (cell.costUsd > 0) {
    const parts = [
      dateText,
      `估算成本 ${formatUsd(cell.costUsd)}`,
      `${formatTokenCount(cell.tokens)} tok`,
      `${cell.sessions} 个会话`
    ];
    if (cell.topProject) {
      parts.push(formatProjectPath(cell.topProject.label, cell.topProject.path));
    }
    if (cell.hasUnknownCost) parts.push("部分会话未知价");
    return parts.join(" · ");
  }
  // 有记录无成本（只有无 usage 的记录 / 全 unknown）：token 与会话数照报，
  // 不因为成本缺失装作没有活动。
  return `${dateText} · ${formatTokenCount(cell.tokens)} tok · ${cell.sessions} 个会话 · 定价未知`;
}

/** 展开区日期短标（头部与 aria-label 共用）：`10月12日`。 */
function shortDateOf(dayStart: number): string {
  const date = new Date(dayStart);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 洞察句正文里的日期（§3.6）：与今年同年的天用 `shortDateOf` 的短式，跨年
 * （滚动窗口首尾附近的日期）带年——「需要区分时才带年」，与月份标签的
 * 「重复 ⇔ 都带」同精神。完整格式永远在按钮的 title / aria-label 里。
 */
function insightDateText(dayStart: number, currentYear: number): string {
  const date = new Date(dayStart);
  const text = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === currentYear ? text : `${date.getFullYear()}年${text}`;
}

/** 洞察日期按钮的可访问名 / 悬停说明（cellLabelOf 原则：年号必须有可靠落点）。 */
function insightDateLabel(dayStart: number): string {
  const date = new Date(dayStart);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · 打开一日回望`;
}

/**
 * 句内日期（§5.1）：可点资格 = 当天 `sessions > 0`，与格子点击同一条线——密集日
 * （有会话、全 unknown 或无 usage → costUsd = 0）照样可点开一日回望；真空白天
 * 渲染为纯文本而不是禁用按钮：点了没有任何反馈的控件是坏交互，格子对空白天
 * 也只是一个色块。
 */
function InsightDate({
  dayStart,
  facts,
  text,
  onDrill,
  onKeyDown
}: {
  dayStart: number;
  facts: CalendarDayFacts | undefined;
  text: string;
  onDrill: (dayStart: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, dayStart: number) => void;
}) {
  if (!facts || facts.sessions === 0) {
    return <span className={styles.insightNum}>{text}</span>;
  }
  const label = insightDateLabel(dayStart);
  return (
    <button
      type="button"
      className={styles.insightDate}
      title={label}
      aria-label={label}
      onClick={() => onDrill(dayStart)}
      onKeyDown={(event) => onKeyDown(event, dayStart)}
    >
      {text}
    </button>
  );
}

/**
 * 占比显示口径（同归因面板）：精确 share 乘 100 后按 0.1% 四舍五入。
 * 有消耗但四舍五入到 0.0 的行显示 `<0.1%`——把「很小」和「没有」分开。
 */
function formatShareText(row: { tokens: number; share: number }): string {
  if (row.tokens > 0 && row.share * 100 < 0.05) return "<0.1%";
  return `${(row.share * 100).toFixed(1)}%`;
}

/** 项目展示名（未知项目兜底与行可访问名同一口径）。 */
function projectNameOf(label: string, path?: string): string {
  return formatProjectPath(label, path) || "未知项目";
}

/** 活跃跨度的中文话术（摘要 title 用）：`18 小时 15 分` / `45 分`。 */
function spanWords(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `${hours} 小时 ${rest} 分` : `${rest} 分`;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** 活动块：一个「有记录的整点小时」在轨道上的落地几何。 */
type HourBlock = { hour: number; left: number; width: number; level: 1 | 2 | 3; count: number };

/**
 * 逐小时块 = 该 clock hour 与 [start, end] 的交集；无记录的整点小时不产块。
 * 时间是几何，`left / width` 都是 0..1 的比例（分母 = 本地日长，DST 安全）。
 * 一天 24 桶（clock hour），所以 DST 重复的那一小时天然合并成一块。
 */
function hourBlocksOf(row: DaySessionSpan, dayStart: number, dayEnd: number): HourBlock[] {
  const blocks: HourBlock[] = [];
  row.hourly.forEach((count, hour) => {
    if (count <= 0) return;
    const level = densityLevelOf(count);
    if (level === 0) return;
    const from = Math.max(clockAt(dayStart, hour), row.start);
    const to = Math.max(Math.min(clockAt(dayStart, hour + 1), row.end), from);
    const left = dayFractionOf(from, dayStart, dayEnd);
    const right = dayFractionOf(to, dayStart, dayEnd);
    blocks.push({ hour, left, width: right - left, level, count });
  });
  return blocks;
}

/** 日摘要的一格：第一行「标签 + 出处圆点」，第二行数值（双数格多一段副读数）。 */
function SummaryItem({
  itemKey,
  label,
  title,
  provenance,
  detail,
  value,
  sub,
  mono
}: {
  itemKey: SummaryKey;
  label: string;
  title: string;
  provenance: Provenance;
  detail?: string;
  value: ReactNode;
  sub?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className={styles.summaryItem}
      data-probe="day-summary-item"
      data-summary-key={itemKey}
      title={title}
    >
      <span className={styles.summaryLabel}>{label}</span>
      <ProvenanceBadge provenance={provenance} {...(detail ? { detail } : {})} />
      <span className={`${styles.summaryValue}${mono ? ` ${styles.summaryMono}` : ""}`}>
        {value}
        {sub ? <span className={styles.summarySub}>{sub}</span> : null}
      </span>
    </div>
  );
}

/**
 * 日摘要（§4）：六项读数带，项数恒 6、键写死。双数格（当日消耗）取两侧里较
 * 弱的那一侧作徽章——成本是估算、token 是读数，所以这一格挂 estimated，token
 * 的 logged 由脚注兜住。
 */
function DaySummaryRow({ summary }: { summary: DaySummary }) {
  const costText = formatUsd(summary.costUsd);
  const tokenText = formatTokenCount(summary.tokens);
  // 「部分会话定价未知」是这一天成本的一条限定，不是装饰：有未命中定价快照的模型时，
  // `costUsd` 只统计了已知部分，屏幕上不标出来就是**静默偏低**。天格（`cellLabelOf`）
  // 已经标了，展开区的摘要也必须标——Issue #195。提示做成一行**可见**小字而不是
  // 只进 `title`：只进 hover 的话，不悬停的用户看到的仍是一个没有限定的数字。
  const unknownCostNote = summary.hasUnknownCost
    ? "；部分会话定价未知，此成本为已知部分的合计"
    : "";
  const hasSpan = summary.firstAt !== null && summary.lastAt !== null;
  const spanValue = hasSpan
    ? `${formatClock(summary.firstAt!)}–${formatClock(summary.lastAt!)}`
    : "—";
  const spanTitle = hasSpan
    ? `活跃跨度：当天首条记录 ${formatClock(summary.firstAt!)}，末条 ${formatClock(
        summary.lastAt!
      )}，跨度 ${spanWords(summary.spanMs)}（不是有活动的小时数）`
    : "当天没有可统计的记录";
  const modelTitle = summary.topModel
    ? `${summary.topModel.id} · ${formatTokenCount(summary.topModel.tokens)} tok`
    : "当天没有可归因的模型用量";

  return (
    <>
      <div className={styles.daySummary} data-probe="day-summary">
        <SummaryItem
          itemKey="cost"
          label="当日消耗"
          title={`当日估算成本 ${costText}（定价快照 ${PRICING_AS_OF}）${unknownCostNote}；token 合计 ${tokenText}，读自本机日志`}
          provenance="estimated"
          detail={`成本按定价快照 ${PRICING_AS_OF}${
            summary.hasUnknownCost ? "；部分会话未知价" : ""
          }`}
          value={costText}
          sub={` · ${tokenText} tok`}
        />
        <SummaryItem
          itemKey="sessions"
          label="会话数"
          title="当天有记录的会话数"
          provenance="logged"
          value={summary.sessions.toLocaleString("en-US")}
        />
        <SummaryItem
          itemKey="messages"
          label="消息数"
          title="当天 user / assistant 记录的条数（不含压缩摘要）"
          provenance="logged"
          value={summary.messages.toLocaleString("en-US")}
        />
        <SummaryItem
          itemKey="span"
          label="活跃跨度"
          title={spanTitle}
          provenance="logged"
          value={spanValue}
          mono
        />
        <SummaryItem
          itemKey="model"
          label="最常用模型"
          title={modelTitle}
          provenance="logged"
          value={summary.topModel ? formatModelId(summary.topModel.id) : "—"}
        />
        <SummaryItem
          itemKey="projects"
          label="涉及项目"
          title="当天涉及的项目数（按项目标签去重）"
          provenance="logged"
          value={summary.projects.toLocaleString("en-US")}
        />
      </div>
      {summary.hasUnknownCost ? (
        <p className={styles.unknownCostNote} data-probe="day-summary-unknown-cost">
          部分会话定价未知，当日成本为已知部分的合计。
        </p>
      ) : null}
    </>
  );
}

/**
 * 消耗日历（Issue #187）：近 12 个月的 GitHub 式滚动 365 天网格。色深 = 当日
 * 估算成本四分位（数据层 `usageCalendar.ts`），点击行内展开**一日回望**
 * （Round V2）：日摘要 + 24 小时时间线（一行一会话，形状与账目同处一行）。
 * 键盘可达（roving tabindex：网格一个 Tab stop、时间线一个 Tab stop）。
 *
 * 聚合只依赖 `inputs`——7/30/90 区间选择器与它正交（脚注声明）。
 * `now` 由页面注入（日历不参与计费对账，与 `readouts.now` 各算各的）。
 * 展开区的账全部来自 `dayReviewOf`（它自己不重算当天消耗，见 dayReview.ts）。
 */
export function UsageCalendarPanel({
  inputs,
  now,
  onOpenSession,
  drillRequest,
  onDrillHandled
}: {
  inputs: readonly UsageSessionInput[];
  /** 窗口终点（今天）的时钟，由调用方注入。 */
  now: number;
  /** 展开区会话行的「打开会话」回调；缺省（单测直挂组件）时行仍列出，只是不可点。 */
  onOpenSession?: (session: SessionMeta) => void;
  /**
   * 受控下钻请求（Round Y #214）：页面（里程碑的日期入口）把「展开我知道的
   * 那一天」交进来。与 `AppShell` 的 `revealRequest` 同款收口——请求带 `nonce`，
   * 面板消费后回调 `onDrillHandled` 把它清掉。**不传时行为与从前逐字一致**。
   */
  drillRequest?: { dayStart: number; nonce: number } | null;
  /** 请求已消费的信号（页面据此把 `drillRequest` 置回 null）。 */
  onDrillHandled?: () => void;
}) {
  const calendar = useMemo(() => buildUsageCalendar(inputs, now), [inputs, now]);
  const todayStart = useMemo(() => dayStartOf(now), [now]);
  const windowStart = useMemo(() => addLocalDays(todayStart, -364), [todayStart]);
  // 一年洞察（Round V3）：与格子同一份 calendar、同一个 now 实例——重算时机
  // 与格子完全同拍（渐进扫描随批次刷新），零新增状态、零新时钟。
  const insights = useMemo(() => calendarInsightsOf(calendar, now), [calendar, now]);
  // 洞察日期的可点资格查表（O(365) 拍平一次）：数据层保持纯数字语义。
  const factsByDay = useMemo(() => {
    const map = new Map<number, CalendarDayFacts>();
    for (const column of calendar.cells) {
      for (const cell of column) {
        if (cell.kind === "day") map.set(cell.dayStart, cell);
      }
    }
    return map;
  }, [calendar]);
  const insightYear = useMemo(() => new Date(now).getFullYear(), [now]);

  const [selected, setSelected] = useState<number | null>(null);
  // roving tabindex 的逻辑焦点。初始 = 今天：用户最关心的位置，省一次导航。
  const [focusDay, setFocusDay] = useState<number>(todayStart);
  // 时间线的 roving 焦点（`rows` 里的下标；展开新的一天时回到 0 = 起点最早那行）。
  const [focusRow, setFocusRow] = useState<number>(0);
  const buttonByDay = useRef(new Map<number, HTMLButtonElement>());
  const rowByIndex = useRef(new Map<number, HTMLButtonElement>());

  const review: DayReview | null = useMemo(
    () => (selected === null ? null : dayReviewOf(inputs, selected)),
    [inputs, selected]
  );
  const rows = review?.rows ?? [];
  /** 当天段的右端（本地日长，不是 86400000——DST 切换日 23 / 25 小时）。 */
  const dayEnd = useMemo(() => (selected === null ? 0 : addLocalDays(selected, 1)), [selected]);

  // 行只带 path；点行要交回完整 SessionMeta（与归因 / 压缩 top3 同一条握手协议）。
  const sessionsByPath = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const input of inputs) {
      const session = input.session;
      if (session && !map.has(session.path)) map.set(session.path, session);
    }
    return map;
  }, [inputs]);

  // 键盘在时间线里只走「可打开」的行（无元数据的行照列但 disabled，不能停）。
  const openableIndexes = useMemo(
    () =>
      rows
        .map((row, index) => (row.path !== "" && sessionsByPath.has(row.path) ? index : -1))
        .filter((index) => index >= 0),
    [rows, sessionsByPath]
  );
  const tabStop = openableIndexes.includes(focusRow) ? focusRow : (openableIndexes[0] ?? -1);

  // 键盘移动：目标是 pad 或越界则不动（不环绕）。所有窗口内天都有格子，
  // 只需按窗口边界判。物理焦点直接落到目标按钮（它已渲染，tabIndex 随后跟上），
  // 并 scrollIntoView 让横向滚动跟随、不跳动。
  const moveFocus = (target: number): void => {
    if (target < windowStart || target > todayStart) return;
    setFocusDay(target);
    const button = buttonByDay.current.get(target);
    if (!button) return;
    button.focus();
    if (typeof button.scrollIntoView === "function") {
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const onGridKeyDown = (event: KeyboardEvent<HTMLButtonElement>, dayStart: number): void => {
    switch (event.key) {
      case "ArrowLeft":
        moveFocus(addLocalDays(dayStart, -7));
        break;
      case "ArrowRight":
        moveFocus(addLocalDays(dayStart, 7));
        break;
      case "ArrowUp":
        moveFocus(addLocalDays(dayStart, -1));
        break;
      case "ArrowDown":
        moveFocus(addLocalDays(dayStart, 1));
        break;
      case "Home": {
        const weekMonday = addLocalDays(dayStart, -((new Date(dayStart).getDay() + 6) % 7));
        moveFocus(Math.max(weekMonday, windowStart));
        break;
      }
      case "End": {
        const weekMonday = addLocalDays(dayStart, -((new Date(dayStart).getDay() + 6) % 7));
        moveFocus(Math.min(addLocalDays(weekMonday, 6), todayStart));
        break;
      }
      case "Escape":
        // 只有焦点格处于展开态时收起，焦点留在格上（网格操作连续性优先）。
        if (selected === dayStart) setSelected(null);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const onCellClick = (dayStart: number, sessions: number): void => {
    // 物理焦点已由浏览器落到按钮；这里同步逻辑焦点，Tab 离开网格后回来不跳。
    setFocusDay(dayStart);
    if (sessions === 0) return;
    setFocusRow(0);
    setSelected((current) => (current === dayStart ? null : dayStart));
  };

  /** 洞察日期下钻（§5.1）：与格子点击同一条 state（toggle），并把对应格子滚进
      视野——洞察点到的常是很久以前的日期，格子多半不在横向视野内，滚过去
      用户才能看到选中描边（aria-expanded=true 的 2px accent outline）。 */
  const onInsightDateDrill = (dayStart: number): void => {
    setFocusDay(dayStart);
    if ((factsByDay.get(dayStart)?.sessions ?? 0) === 0) return;
    setFocusRow(0);
    setSelected((current) => (current === dayStart ? null : dayStart));
    const button = buttonByDay.current.get(dayStart);
    if (button && typeof button.scrollIntoView === "function") {
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  /**
   * 受控下钻（Round Y #214）：把页面交进来的请求喂给**同一条**内部逻辑
   * （`onInsightDateDrill` 的 toggle + 滚进视野），不写第二份。
   *
   * 依赖只落在 `nonce` 上：同一天连点两下必须是两次独立请求——第二次要能收起
   * （与格子点击同语义），只盯 `dayStart` 会让第二次点击被当成「没有变化」而吞掉。
   * 请求消费完立刻回调收口；面板自己的 `selected` 仍是唯一状态源（design §4：
   * 不把这个状态上提到页面）。
   */
  const drillNonce = drillRequest?.nonce ?? null;
  useEffect(() => {
    if (drillRequest === undefined || drillRequest === null) return;
    onInsightDateDrill(drillRequest.dayStart);
    onDrillHandled?.();
  }, [drillNonce]);

  const onInsightDateKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    dayStart: number
  ): void => {
    if (event.key !== "Escape") return;
    // 收起展开区、焦点留在日期按钮上（对称于时间线行的 Escape：那边把焦点
    // 还给天格，这边按钮本身就是句内控件，焦点不动）。
    if (selected === dayStart) setSelected(null);
    event.preventDefault();
  };

  /** 时间线内的物理焦点移动（不环绕）。 */
  const moveRowFocus = (target: number): void => {
    setFocusRow(target);
    const button = rowByIndex.current.get(target);
    if (!button) return;
    button.focus();
    if (typeof button.scrollIntoView === "function") {
      button.scrollIntoView({ block: "nearest" });
    }
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const position = openableIndexes.indexOf(index);
    switch (event.key) {
      case "ArrowDown":
        if (position >= 0 && position < openableIndexes.length - 1) {
          moveRowFocus(openableIndexes[position + 1]);
        }
        break;
      case "ArrowUp":
        if (position > 0) moveRowFocus(openableIndexes[position - 1]);
        break;
      case "Home":
        if (openableIndexes.length > 0) moveRowFocus(openableIndexes[0]);
        break;
      case "End":
        if (openableIndexes.length > 0) moveRowFocus(openableIndexes[openableIndexes.length - 1]);
        break;
      case "Escape": {
        // 焦点现在能进展开区，就得有条路回到网格：Escape 收起并把焦点还给选中的天格。
        const dayStart = selected;
        setSelected(null);
        if (dayStart !== null) buttonByDay.current.get(dayStart)?.focus();
        break;
      }
      default:
        return;
    }
    event.preventDefault();
  };

  // —— 一年洞察（Round V3 / #199）的句内元件：正文模板逐字（§4.1），数字与
  // 日期提一档（--text + tabular-nums），日期按钮走 --accent 的「链接」语义位。

  const insightDateAt = (dayStart: number): ReactNode => (
    <InsightDate
      dayStart={dayStart}
      facts={factsByDay.get(dayStart)}
      text={insightDateText(dayStart, insightYear)}
      onDrill={onInsightDateDrill}
      onKeyDown={onInsightDateKeyDown}
    />
  );

  /** 句内区间（§6）：单日段只写一次日期（不写「8月12日–8月12日」的冗余），
      两端各自适用年份规则；连接符 en dash（formatClock 的 00:25–18:41 同款先例）。 */
  const insightRange = (startDay: number, endDay: number): ReactNode =>
    startDay === endDay ? (
      insightDateAt(startDay)
    ) : (
      <>
        {insightDateAt(startDay)}–{insightDateAt(endDay)}
      </>
    );

  const insightNum = (value: ReactNode): ReactNode => (
    <span className={styles.insightNum}>{value}</span>
  );

  /** current-streak 的三态正文（§3.4 逐字）。broken 的哨兵（全空年）不会走到
      这里——外层按 longestStreak === null 整区走了空态。 */
  const currentStreakItem = (streak: CalendarInsights["currentStreak"]): ReactNode => {
    const title =
      "从今天往回数「当日估算成本 > $0」的连续天数；今天没有消耗时如实说明，不预设今天结束";
    if (streak.kind === "active") {
      return (
        <li
          className={styles.insightItem}
          data-probe="calendar-insight-item"
          data-insight-key="current-streak"
          title={title}
        >
          当前连胜 {insightNum(`${streak.days} 天`)}（{insightDateAt(streak.startDay)}
          至今）
        </li>
      );
    }
    if (streak.kind === "pending") {
      return (
        <li
          className={styles.insightItem}
          data-probe="calendar-insight-item"
          data-insight-key="current-streak"
          title={title}
        >
          今天还没有消耗；此前连续 {insightNum(`${streak.days} 天`)}（
          {insightRange(streak.startDay, streak.endDay)}）
        </li>
      );
    }
    if (streak.lastActiveDay === null) return null;
    return (
      <li
        className={styles.insightItem}
        data-probe="calendar-insight-item"
        data-insight-key="current-streak"
        title={title}
      >
        连胜已断：最近消耗 {insightDateAt(streak.lastActiveDay)}（
        {insightNum(`${streak.idleDays} 天前`)}）
      </li>
    );
  };

  /** month-compare 的五分支正文（§3.5 逐字）。方向词用「多 / 少」：中文句子里
      符号方向易漏看；prev = 0 不写百分比（分母为 0，+∞% 是噪声）。 */
  const monthCompareItem = (compare: MonthCompare): ReactNode => {
    const title = `本月第 1..${compare.days} 天与上月同期 ${compare.days} 天的估算成本之和对比（等长日历窗，不拿部分月比完整月）；成本为估算值（定价快照 ${PRICING_AS_OF}）`;
    const days = insightNum(`${compare.days} 天`);
    const current = insightNum(formatUsd(compare.currentUsd));
    if (compare.previousUsd <= 0 && compare.currentUsd <= 0) {
      return (
        <li
          className={styles.insightItem}
          data-probe="calendar-insight-item"
          data-insight-key="month-compare"
          title={title}
        >
          本月前 {days}与上月同期都无消耗
        </li>
      );
    }
    if (compare.previousUsd <= 0) {
      return (
        <li
          className={styles.insightItem}
          data-probe="calendar-insight-item"
          data-insight-key="month-compare"
          title={title}
        >
          本月前 {days} {current}（上月同期无消耗）
        </li>
      );
    }
    const pct = Math.round(
      ((compare.currentUsd - compare.previousUsd) / compare.previousUsd) * 100
    );
    if (compare.currentUsd > compare.previousUsd) {
      return (
        <li
          className={styles.insightItem}
          data-probe="calendar-insight-item"
          data-insight-key="month-compare"
          title={title}
        >
          本月前 {days} {current}（较上月同期多 {insightNum(`${pct}%`)}）
        </li>
      );
    }
    if (compare.currentUsd < compare.previousUsd) {
      return (
        <li
          className={styles.insightItem}
          data-probe="calendar-insight-item"
          data-insight-key="month-compare"
          title={title}
        >
          本月前 {days} {current}（较上月同期少 {insightNum(`${-pct}%`)}）
        </li>
      );
    }
    return (
      <li
        className={styles.insightItem}
        data-probe="calendar-insight-item"
        data-insight-key="month-compare"
        title={title}
      >
        本月前 {days} {current}（与上月同期持平）
      </li>
    );
  };

  return (
    <Panel
      title="消耗日历（近 12 个月）"
      ariaLabel="消耗日历（近 12 个月）"
      actions={
        <ProvenanceBadge
          provenance="estimated"
          detail={`色深按估算成本折算（定价快照 ${PRICING_AS_OF}）`}
        />
      }
    >
      <div className={styles.calendar}>
        {/* data-usage-calendar 挂在滚动容器上：门禁 / e2e 量的 overflowX 与
            滚动几何就是这一层（网格固有宽 > 容器宽时滚动收在这里）。 */}
        <div className={styles.scroll} data-usage-calendar>
          <table className={styles.table} aria-label="消耗日历（近 12 个月）">
            <tbody>
              <tr className={styles.monthRow}>
                <th scope="row" aria-hidden="true" className={styles.corner} />
                {calendar.monthMarks.map((mark, index) => {
                  const next = calendar.monthMarks[index + 1]?.weekIndex ?? 53;
                  return (
                    <th
                      key={mark.weekIndex}
                      scope="col"
                      colSpan={next - mark.weekIndex}
                      className={styles.monthMark}
                    >
                      {mark.label}
                    </th>
                  );
                })}
              </tr>
              {WEEKDAY_LABELS.map((weekday, row) => (
                <tr key={weekday}>
                  <th scope="row" className={styles.weekdayLabel}>
                    {weekday}
                  </th>
                  {calendar.cells.map((column, week) => {
                    const cell = column[row];
                    if (cell.kind === "pad") {
                      return <td key={week} className={styles.padCell} />;
                    }
                    const isToday = cell.dayStart === todayStart;
                    const isSelected = selected === cell.dayStart;
                    const label = cellLabelOf(cell);
                    return (
                      <td
                        key={week}
                        className={styles.dayCell}
                        // 今天标记挂在 td 上而不是 button：按钮的 data-probe 全部
                        // 留给 "calendar-day"（365 计数是全链条的几何锚），真机点选
                        // 走 `[data-probe='calendar-today'] button` 后代选择器
                        // （同 data-changes-file 的先例）。
                        {...(isToday ? { "data-probe": "calendar-today" } : {})}
                      >
                        <button
                          type="button"
                          ref={(element) => {
                            if (element) {
                              buttonByDay.current.set(cell.dayStart, element);
                            } else {
                              buttonByDay.current.delete(cell.dayStart);
                            }
                          }}
                          className={styles.dayButton}
                          data-probe="calendar-day"
                          data-cal-level={cell.level}
                          data-sessions={cell.sessions}
                          title={label}
                          aria-label={label}
                          {...(cell.sessions > 0
                            ? { "aria-expanded": isSelected }
                            : {})}
                          tabIndex={focusDay === cell.dayStart ? 0 : -1}
                          onClick={() => onCellClick(cell.dayStart, cell.sessions)}
                          onKeyDown={(event) => onGridKeyDown(event, cell.dayStart)}
                        >
                          <span className={styles.daySwatch} aria-hidden="true" />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* 图例（刻度是组件的一部分，同 Heatmap）：0 档格带「无消耗」标注。 */}
        <div className={styles.legend} data-cal-legend>
          <span className={styles.legendText}>无</span>
          <span className={styles.legendCell} data-legend-level="0" title="无消耗" aria-hidden="true" />
          <span className={styles.legendText}>／ 少</span>
          {[1, 2, 3, 4].map((level) => (
            <span key={level} className={styles.legendCell} data-legend-level={level} aria-hidden="true" />
          ))}
          <span className={styles.legendText}>多</span>
        </div>
        {/* 一年洞察（Round V3 / #199）：主图的「读后感」——六句实事住在图例与
            展开区之间，展开一日回望时句子不动、展开区从它下方生长。全部数字
            读自同一份 calendar（零新增数据通道），「有消耗」与格子 0 档同口径
            （数字能对上格子）；每句的口径挂在自己的 title 上，不塞进面板脚注。 */}
        <ul className={styles.insights} aria-label="一年洞察" data-probe="calendar-insights">
          {insights.longestStreak === null ? (
            <li className={styles.insightEmpty}>这一年还没有可统计的消耗</li>
          ) : (
            <>
              <li
                className={styles.insightItem}
                data-probe="calendar-insight-item"
                data-insight-key="longest-streak"
                title={`连续 ${insights.longestStreak.days} 天 = 窗口内连续「当日估算成本 > $0」的最长天数，与格子 0 档同口径（定价未知的天不计）；并列取最近一段${
                  insights.longestStreak.touchesWindowStart
                    ? "；区间自窗口首日起算，实际可能更长"
                    : ""
                }`}
              >
                最长连胜 {insightNum(`${insights.longestStreak.days} 天`)}（
                {insightRange(insights.longestStreak.startDay, insights.longestStreak.endDay)}）
              </li>
              {currentStreakItem(insights.currentStreak)}
              {insights.peakDay === null ? null : (
                <li
                  className={styles.insightItem}
                  data-probe="calendar-insight-item"
                  data-insight-key="peak-day"
                  title={`当日估算成本最大的一天，与格子色深同口径（定价快照 ${PRICING_AS_OF}）；并列取最近`}
                >
                  最贵一天 {insightDateAt(insights.peakDay.dayStart)}（
                  {insightNum(formatUsd(insights.peakDay.costUsd))}）
                </li>
              )}
              {insights.longestGap === null ? null : (
                <li
                  className={styles.insightItem}
                  data-probe="calendar-insight-item"
                  data-insight-key="longest-gap"
                  title={`连续「当日估算成本 ≤ $0」的最长天数；定价未知的天计入空白（与格子 0 档同口径）；并列取最近一段${
                    insights.longestGap.touchesWindowStart
                      ? "；区间自窗口首日起算，实际可能长"
                      : ""
                  }`}
                >
                  最长空白 {insightNum(`${insights.longestGap.days} 天`)}（
                  {insightRange(insights.longestGap.startDay, insights.longestGap.endDay)}）
                </li>
              )}
              <li
                className={styles.insightItem}
                data-probe="calendar-insight-item"
                data-insight-key="active-share"
                title={`窗口 ${insights.activeDays.total} 天里「当日估算成本 > $0」的天数；定价未知的天不计入`}
              >
                这一年{" "}
                {insightNum(`${insights.activeDays.days}/${insights.activeDays.total} 天`)}
                有消耗（
                {insightNum(
                  `${Math.round(
                    (insights.activeDays.days / insights.activeDays.total) * 100
                  )}%`
                )}
                ）
              </li>
              {monthCompareItem(insights.monthCompare)}
            </>
          )}
        </ul>
        {selected !== null && review !== null ? (
          <section
            className={styles.sessions}
            aria-label={`${shortDateOf(selected)}会话清单`}
            data-calendar-sessions
          >
            <div className={styles.sessionsHead}>
              <span className={styles.sessionsTitle}>{`${shortDateOf(selected)} · ${
                review.summary.sessions
              } 个会话`}</span>
              <button type="button" className={styles.clear} onClick={() => setSelected(null)}>
                × 清除
              </button>
            </div>
            {review.summary.sessions === 0 ? (
              // 防御态：正常路径不可达（色即消耗，0 档格子不可展开），但数据在
              // 渐进扫描里被刷新掉时可能走到——只留一行实话。
              <p className={styles.dayEmpty}>这一天没有会话记录</p>
            ) : (
              <>
                <DaySummaryRow summary={review.summary} />
                <div
                  className={styles.dayTimeline}
                  data-probe="day-timeline"
                  data-session-count={review.summary.sessions}
                >
                  <div className={styles.dayAxis} aria-hidden="true">
                    <span />
                    <div className={styles.axisTrack}>
                      {AXIS_HOURS.map((hour, index) => (
                        <span
                          key={hour}
                          className={`${styles.axisTick}${index === 0 ? ` ${styles.axisTickStart}` : ""}`}
                          data-probe="day-timeline-tick"
                          style={{ left: `${dayFractionOf(clockAt(selected, hour), selected, dayEnd) * 100}%` }}
                        >
                          {formatClock(clockAt(selected, hour))}
                        </span>
                      ))}
                      <span
                        className={`${styles.axisTick} ${styles.axisTickEnd}`}
                        data-probe="day-timeline-tick"
                      >
                        24:00
                      </span>
                    </div>
                    <span />
                    <span />
                  </div>
                  <ol
                    className={styles.dayRows}
                    data-probe="day-timeline-list"
                    aria-label={`${shortDateOf(selected)}会话时间线`}
                  >
                    {rows.map((row, index) => {
                      const session = sessionsByPath.get(row.path);
                      const canOpen =
                        row.path !== "" && session !== undefined && onOpenSession !== undefined;
                      const color = review.colorOf.get(row.path) ?? 1;
                      const project = projectNameOf(row.projectLabel, row.projectPath);
                      const shareText = formatShareText(row);
                      const spoken =
                        `${row.title}（项目：${project}）· ${formatClock(row.start)}–${formatClock(
                          row.end
                        )} · 时长 ${formatDuration(row.durationMs)} · 当日消耗 ${formatUsd(
                          row.costUsd
                        )} · ${formatTokenCount(row.tokens)} tok · 占当日 ${shareText}` +
                        (row.crossDay ? " · 跨天" : "");
                      const label = canOpen ? `打开会话：${spoken}` : `${spoken} · 当前不可打开`;
                      // 行按起点升序（数据层已排）；这里是纯几何，分母是本地日长。
                      const left = dayFractionOf(row.start, selected, dayEnd) * 100;
                      const width =
                        (dayFractionOf(row.end, selected, dayEnd) -
                          dayFractionOf(row.start, selected, dayEnd)) *
                        100;
                      return (
                        <li key={row.path === "" ? `anonymous:${index}` : row.path}>
                          <button
                            type="button"
                            ref={(element) => {
                              if (element) {
                                rowByIndex.current.set(index, element);
                              } else {
                                rowByIndex.current.delete(index);
                              }
                            }}
                            className={styles.dayRow}
                            data-probe="day-timeline-bar"
                            data-session-path={row.path}
                            {...(row.crossDay ? { "data-cross-day": "true" } : {})}
                            title={label}
                            aria-label={label}
                            disabled={!canOpen}
                            tabIndex={index === tabStop ? 0 : -1}
                            onClick={
                              canOpen
                                ? () => {
                                    setFocusRow(index);
                                    onOpenSession(session);
                                  }
                                : undefined
                            }
                            onKeyDown={(event) => onRowKeyDown(event, index)}
                          >
                            <span className={styles.rowLabel}>
                              <span
                                className={styles.projectDot}
                                data-probe="day-project-dot"
                                data-project-index={color}
                                aria-hidden="true"
                                style={{ background: `var(--chart-${color})` }}
                              />
                              <span className={styles.rowTitle}>{row.title}</span>
                              {row.crossDay ? (
                                <span
                                  className={styles.crossDay}
                                  title="该会话在当天之外还有记录，这里只画落在当天的那一段"
                                >
                                  跨天
                                </span>
                              ) : null}
                            </span>
                            <span className={styles.track} aria-hidden="true">
                              <span
                                className={styles.rail}
                                style={{
                                  left: `${left}%`,
                                  width: `${width}%`,
                                  background: `var(--chart-${color})`
                                }}
                              />
                              {hourBlocksOf(row, selected, dayEnd).map((block) => (
                                <span
                                  key={block.hour}
                                  className={styles.block}
                                  data-probe="day-timeline-density"
                                  data-density-level={block.level}
                                  title={`${pad2(block.hour)}:00–${pad2(block.hour + 1)}:00 · ${
                                    block.count
                                  } 条记录`}
                                  style={{
                                    left: `${block.left * 100}%`,
                                    width: `${block.width * 100}%`,
                                    background: `var(--chart-${color})`
                                  }}
                                />
                              ))}
                            </span>
                            <span className={styles.rowTime}>{`${formatClock(
                              row.start
                            )}–${formatClock(row.end)}`}</span>
                            <span className={styles.rowRead}>{`${formatUsd(
                              row.costUsd
                            )} · ${formatTokenCount(row.tokens)} tok · ${shareText}`}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
                {review.key.length > 0 ? (
                  <ul className={styles.projectKey} data-probe="day-project-key">
                    {review.key.map((entry) => (
                      <li key={`${entry.color}:${entry.label}`} className={styles.projectKeyItem}>
                        <span
                          className={styles.projectDot}
                          data-probe="day-project-dot"
                          data-project-index={entry.color}
                          aria-hidden="true"
                          style={{ background: `var(--chart-${entry.color})` }}
                        />
                        {entry.folded > 0
                          ? `其他 ${entry.folded} 个项目`
                          : projectNameOf(entry.label, entry.path)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className={styles.sessionsFootnote}>{DAY_FOOTNOTE}</p>
              </>
            )}
          </section>
        ) : null}
        <p className={styles.footnote}>{FOOTNOTE}</p>
      </div>
    </Panel>
  );
}
