import { useMemo, useRef, useState, type KeyboardEvent } from "react";
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
import { PRICING_AS_OF } from "./pricingSnapshot";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { WEEKDAY_LABELS } from "./charts/chartPrimitives";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import {
  buildUsageCalendar,
  daySessionsOf,
  dayTimelineOf,
  type CalendarSessionRow,
  type DayTimeline
} from "./usageCalendar";
import styles from "./UsageCalendarPanel.module.css";

/** 面板脚注：窗口正交（Issue 原话「固定滚动 12 个月，不随区间选择器变」）。 */
const FOOTNOTE =
  "窗口固定滚动近 12 个月（365 天），不随上方区间选择器变化；色深 = 当日估算成本的四分位档，0 档 = 无消耗。";

/** 展开区脚注：分母口径与「成本是估算」两条都写在明处（同归因面板的先例）。 */
const SESSIONS_FOOTNOTE = "占比分母 = 当日 token 总量；成本为估算值。";

/**
 * 摘要行旁的口径脚注：时间线的三条事实（本地时区 / 跨午夜切分 / 估算）。
 * 「条 = 当天首末记录」是时间线最容易误读的口径，必须在图旁边说清楚。
 */
const TIMELINE_NOTE =
  "时刻为本地时间；跨午夜会话按当天记录切分（条 = 当天首末记录，不是会话真实起止）；成本为估算值。";

/**
 * 小时轴刻度：4 小时一格，照抄 Heatmap 的 HOUR_STRIDE——同一应用里两张
 * 「小时 × 活动」的图用同一刻度节奏，用户只需要学一次（24 与 0 重合不标）。
 */
const HOUR_TICKS = [0, 4, 8, 12, 16, 20];

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
 * 占比显示口径（同归因面板）：精确 share 乘 100 后按 0.1% 四舍五入。
 * 有消耗但四舍五入到 0.0 的行显示 `<0.1%`——把「很小」和「没有」分开。
 */
function formatShareText(row: { tokens: number; share: number }): string {
  if (row.tokens > 0 && row.share * 100 < 0.05) return "<0.1%";
  return `${(row.share * 100).toFixed(1)}%`;
}

/**
 * 展开区的一个会话行：四件套复用归因面板的形态（标题 / 读数 / 占比条 / 占比），
 * 但读数列是「$X · N tok」双数——色深是成本口径，行给双数呼应。无元数据的行
 * 照列但不可点（同归因面板的 canOpen 逻辑）。
 */
function CalendarSessionListRow({
  row,
  session,
  onOpenSession
}: {
  row: CalendarSessionRow;
  session: SessionMeta | undefined;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const canOpen = session !== undefined && onOpenSession !== undefined;
  const project = formatProjectPath(row.projectLabel, row.projectPath);
  const pctText = formatShareText(row);
  const reading = `${formatUsd(row.costUsd)} · ${formatTokenCount(row.tokens)} tok${
    row.hasUnknownCost ? " · 部分未知" : ""
  }`;
  const spoken = `${row.title}（项目：${project}）· 当日消耗 ${formatUsd(row.costUsd)} · ${formatTokenCount(
    row.tokens
  )} tok · 占当日 ${pctText}`;
  const label = canOpen ? `打开会话：${spoken}` : `${spoken} · 当前不可打开`;

  return (
    <li className={styles.sessionItem}>
      <button
        type="button"
        className={styles.sessionRow}
        title={label}
        aria-label={label}
        disabled={!canOpen}
        onClick={canOpen ? () => onOpenSession(session) : undefined}
      >
        <span className={styles.sessionRowTitle}>{row.title}</span>
        <span className={styles.sessionReading}>{reading}</span>
        <span className={styles.barTrack} aria-hidden="true">
          {row.tokens > 0 ? (
            <span className={styles.barFill} style={{ width: `${row.share * 100}%` }} />
          ) : null}
        </span>
        <span className={styles.sessionPct}>{pctText}</span>
      </button>
    </li>
  );
}

/** 摘要行的活跃段：首末同刻（全天一个瞬时会话）显示单时刻。 */
function activeSpanOf(summary: DayTimeline["summary"]): string {
  if (summary.firstTs === null || summary.lastTs === null) return "—";
  if (summary.firstTs === summary.lastTs) return formatClock(summary.firstTs);
  return `${formatClock(summary.firstTs)}–${formatClock(summary.lastTs)}`;
}

/**
 * 时间线条的可访问名 / 悬停说明（§5.2）：一份格式函数 title 与 aria-label
 * 两处用。与清单行 `spoken` 有意不同（清单有占比、条有起止），但共享
 * 「标题（项目）· …」的前缀语序，同一家族。时长照 formatDuration 的实际值
 * （`0ms` / `1.5s`），不把瞬时会话粉饰成「<1 分钟」。
 */
function barLabelOf(session: DayTimeline["sessions"][number]): string {
  const project = formatProjectPath(session.projectLabel, session.projectPath);
  return (
    `${session.title}（项目：${project}）· ` +
    `${formatClock(session.startTs)}–${formatClock(session.endTs)} · ` +
    `时长 ${formatDuration(session.endTs - session.startTs)} · ` +
    `当日消耗 ${formatUsd(session.costUsd)} · ${formatTokenCount(session.tokens)} tok` +
    (session.hasUnknownCost ? " · 部分未知" : "")
  );
}

/**
 * 24h 甘特式时间线（Issue #192）：条 = 会话当天跨度（首末记录），色 = 项目
 * 槽位（`--cat-*`），条内密度段 = 逐小时 token（max 归一 4 档，与 Heatmap 同
 * 公式）。坐标系用**真实天长** daySpan（DST 天 23/25 小时时条仍铺满全天、与
 * 「次日 0 点」刻度对齐），x% = (ts − dayStart) / daySpan × 100。
 *
 * 键盘：整个时间线一个 Tab stop（roving tabindex），←/→ 按 startTs 序移动、
 * 首尾越界不环绕、Home/End 时间序首尾——泳道是防重叠的布局产物，不是用户
 * 的导航语义（用户想的是「下一个会话」，不是「上一泳道」），所以不做 ↑/↓。
 * 初始焦点 = 第一条（时间最早）。组件经 key={dayStart} 重挂：切天即重置 roving。
 */
function DayTimelineChart({
  dayStart,
  timeline,
  sessionsByPath,
  onOpenSession
}: {
  dayStart: number;
  timeline: DayTimeline;
  sessionsByPath: Map<string, SessionMeta>;
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonByIndex = useRef<Array<HTMLButtonElement | null>>([]);

  const daySpan = addLocalDays(dayStart, 1) - dayStart;
  // 项目 → 槽位：彩槽才有专属映射，落选（含无 usage 的项目）一律 "other" 灰。
  const slotByLabel = new Map(
    timeline.projectSlots
      .filter((slot) => slot.slot !== "other")
      .map((slot) => [slot.label, slot.slot as string])
  );

  const onLanesKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const count = timeline.sessions.length;
    if (count === 0) return;
    let target: number;
    switch (event.key) {
      case "ArrowLeft":
        target = Math.max(0, focusIndex - 1);
        break;
      case "ArrowRight":
        target = Math.min(count - 1, focusIndex + 1);
        break;
      case "Home":
        target = 0;
        break;
      case "End":
        target = count - 1;
        break;
      default:
        return;
    }
    // 越界（首尾）也吞掉按键：不环绕（同 V1 网格的纪律）。
    event.preventDefault();
    if (target === focusIndex) return;
    setFocusIndex(target);
    const button = buttonByIndex.current[target];
    if (!button) return;
    button.focus();
    if (typeof button.scrollIntoView === "function") {
      // 泳道内竖滚与窄条横向都要跟随，不跳动（同 V1 网格的做法）。
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const otherSlot = timeline.projectSlots.find((slot) => slot.slot === "other");

  return (
    <div
      className={styles.timeline}
      role="group"
      aria-label={`${shortDateOf(dayStart)}会话时间线`}
    >
      <div className={styles.chartArea}>
        {/* 轴标签是装饰性 tick（条的可访问名里已有精确 HH:mm），左缘对齐刻度
            线（同 Heatmap 的 SVG text 默认锚点）。 */}
        <div className={styles.axis} aria-hidden="true">
          {HOUR_TICKS.map((hour) => (
            <span
              key={hour}
              className={styles.axisLabel}
              style={{ left: `${(hour / 24) * 100}%` }}
            >
              {hour}
            </span>
          ))}
        </div>
        {/* 竖刻度线画在轴 + 泳道的公共容器上：贯穿可视泳道区，不随泳道竖滚
            （时间是横轴，滚动是纵轴，两者正交）。0 点在容器左缘，不另画。 */}
        {HOUR_TICKS.slice(1).map((hour) => (
          <span
            key={hour}
            aria-hidden="true"
            className={styles.axisTick}
            style={{ left: `${(hour / 24) * 100}%` }}
          />
        ))}
        {/* 行内 height 按数据层 laneCount 设：条全是 absolute 定位，不撑容器
            高度——没有这一行，.lanes 的 clientHeight 恒 0（max-height 只封顶
            不给高度），泳道区的可视高/滚动几何全部失真。视觉上限仍由 CSS 的
            max-height（7 行）截，超出内滚。 */}
        <div
          className={styles.lanes}
          data-calendar-lanes
          onKeyDown={onLanesKeyDown}
          style={{ height: `calc(${timeline.laneCount} * var(--control-h-sm))` }}
        >
          {timeline.sessions.map((session, index) => {
            const sessionMeta =
              session.path === "" ? undefined : sessionsByPath.get(session.path);
            const canOpen = sessionMeta !== undefined && onOpenSession !== undefined;
            const label = barLabelOf(session);
            const leftPct = ((session.startTs - dayStart) / daySpan) * 100;
            // instant 条宽 0，视觉宽度由 CSS 的 min-width（2px）兜底——一条
            // 竖线短杠，如实表达「这里有一个瞬时会话」。
            const widthPct = Math.max(0, ((session.endTs - session.startTs) / daySpan) * 100);
            const maxHour = Math.max(...session.hourlyTokens);
            return (
              <button
                type="button"
                key={session.path === "" ? `anonymous:${index}` : session.path}
                ref={(element) => {
                  buttonByIndex.current[index] = element;
                }}
                className={styles.bar}
                data-probe="calendar-bar"
                data-lane={session.lane}
                data-slot={slotByLabel.get(session.projectLabel) ?? "other"}
                data-instant={session.instant}
                tabIndex={index === focusIndex ? 0 : -1}
                disabled={!canOpen}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  top: `calc(${session.lane} * var(--control-h-sm))`
                }}
                title={label}
                aria-label={label}
                onClick={canOpen ? () => onOpenSession(sessionMeta) : undefined}
              >
                {/* barFrame 是 16px 可视层（描边 + 裁剪窗）；button 自己 24px
                    高撑满行高——击中目标 24px 对齐 WCAG 2.5.8 最小目标尺寸。 */}
                <span className={styles.barFrame} aria-hidden="true">
                  {session.hourlyTokens.map((value, hour) => {
                    if (value <= 0) return null;
                    // 密度档：该会话当天自己的最大小时归一（「高峰在它自己的
                    // 哪个时刻」，跨会话不比），与 Heatmap 的档位公式同式。
                    const level = Math.min(4, Math.max(1, Math.ceil((value / maxHour) * 4)));
                    return (
                      <span
                        key={hour}
                        className={styles.seg}
                        data-seg-hour={hour}
                        data-seg-level={level}
                        style={{ left: `${(hour / 24) * 100}%`, width: `${100 / 24}%` }}
                      />
                    );
                  })}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {/* 项目图例：「条色 ↔ 项目」的唯一静态对照（条上无文字），槽位不足 5 时
          只列在场的槽，不造空槽位占位；other 在场时末尾声明折叠数。 */}
      <div className={styles.projLegend}>
        {timeline.projectSlots
          .filter((slot) => slot.slot !== "other")
          .map((slot) => (
            <span key={slot.label} className={styles.projLegendItem}>
              <span
                className={styles.swatch}
                data-slot={slot.slot}
                aria-hidden="true"
              />
              {formatProjectPath(slot.label, slot.path)}
            </span>
          ))}
        {otherSlot ? (
          <span className={styles.projLegendItem}>
            <span className={styles.swatch} data-slot="other" aria-hidden="true" />
            {`其他 ${timeline.summary.projects - 5} 个项目`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 消耗日历（Issue #187）：近 12 个月的 GitHub 式滚动 365 天网格。色深 = 当日
 * 估算成本四分位（数据层 `usageCalendar.ts`），点击行内展开「一日回望」
 * （Issue #192：日摘要行 + 24h 时间线 + 保留的当天会话 Top 清单），
 * 键盘可达（roving tabindex：整个网格一个 Tab stop，初始焦点 = 今天）。
 *
 * 聚合只依赖 `inputs`——7/30/90 区间选择器与它正交（脚注声明）。
 * `now` 由页面注入（日历不参与计费对账，与 `readouts.now` 各算各的）。
 */
export function UsageCalendarPanel({
  inputs,
  now,
  onOpenSession
}: {
  inputs: readonly UsageSessionInput[];
  /** 窗口终点（今天）的时钟，由调用方注入。 */
  now: number;
  /** 展开区会话行的「打开会话」回调；缺省（单测直挂组件）时行仍列出，只是不可点。 */
  onOpenSession?: (session: SessionMeta) => void;
}) {
  const calendar = useMemo(() => buildUsageCalendar(inputs, now), [inputs, now]);
  const todayStart = useMemo(() => dayStartOf(now), [now]);
  const windowStart = useMemo(() => addLocalDays(todayStart, -364), [todayStart]);

  const [selected, setSelected] = useState<number | null>(null);
  // roving tabindex 的逻辑焦点。初始 = 今天：用户最关心的位置，省一次导航。
  const [focusDay, setFocusDay] = useState<number>(todayStart);
  const buttonByDay = useRef(new Map<number, HTMLButtonElement>());

  const detail = useMemo(
    () => (selected === null ? null : daySessionsOf(inputs, selected)),
    [inputs, selected]
  );

  // 一日回望的时间形状（Issue #192）。与 detail 同款依赖：`now` 不进展开区
  // 数据层——时间线是纯历史事实，没有「现在进行时」的推算（今天进行中的
  // 会话条到当前末条记录为止，不画虚线延伸）。
  const timeline = useMemo(
    () => (selected === null ? null : dayTimelineOf(inputs, selected)),
    [inputs, selected]
  );

  // 行只带 path；点行要交回完整 SessionMeta（与归因 / 压缩 top3 同一条握手协议）。
  const sessionsByPath = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const input of inputs) {
      const session = input.session;
      if (session && !map.has(session.path)) map.set(session.path, session);
    }
    return map;
  }, [inputs]);

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
    setSelected((current) => (current === dayStart ? null : dayStart));
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
        {detail && timeline ? (
          <section
            className={styles.sessions}
            aria-label={`${shortDateOf(selected!)}一日回望`}
            data-calendar-sessions
          >
            <div className={styles.sessionsHead}>
              <span className={styles.sessionsTitle}>{`${shortDateOf(
                selected!
              )} · 共 ${detail.sessions} 个会话`}</span>
              <button type="button" className={styles.clear} onClick={() => setSelected(null)}>
                × 清除
              </button>
            </div>
            {/* 摘要行：读数行语言，不做六张 KPI 卡（高度有界，卡片会把一行
                信息撑成三行高）。首末同刻（全天一个瞬时会话）显示单时刻。 */}
            <p className={styles.summary} data-calendar-summary>
              消耗 <span className={styles.summaryNum}>{formatUsd(timeline.summary.costUsd)}</span>{" "}
              · <span className={styles.summaryNum}>{formatTokenCount(timeline.summary.tokens)}</span>{" "}
              tok · <span className={styles.summaryNum}>{timeline.summary.sessions}</span> 个会话 ·{" "}
              <span className={styles.summaryNum}>{timeline.summary.messages}</span> 条消息 · 活跃{" "}
              <span className={styles.summaryNum}>{activeSpanOf(timeline.summary)}</span>{" "}
              · 主力{" "}
              <span className={styles.summaryNum}>
                {timeline.summary.topModel === null
                  ? "—"
                  : formatModelId(timeline.summary.topModel)}
              </span>{" "}
              · <span className={styles.summaryNum}>{timeline.summary.projects}</span> 个项目
              {timeline.summary.hasUnknownCost ? " · 部分未知价" : null}
            </p>
            <p className={styles.summaryNote}>{TIMELINE_NOTE}</p>
            <DayTimelineChart
              key={selected}
              dayStart={selected!}
              timeline={timeline}
              sessionsByPath={sessionsByPath}
              onOpenSession={onOpenSession}
            />
            <ol className={styles.sessionList} aria-label={`${shortDateOf(selected!)}消耗最多的会话`}>
              {detail.rows.map((row, index) => (
                <CalendarSessionListRow
                  key={row.path === "" ? `anonymous:${index}` : row.path}
                  row={row}
                  session={row.path === "" ? undefined : sessionsByPath.get(row.path)}
                  onOpenSession={onOpenSession}
                />
              ))}
              {detail.remainder ? (
                <li className={styles.sessionRest}>
                  <span className={styles.sessionRowTitle}>
                    {`其余 ${detail.remainder.sessions} 个会话`}
                  </span>
                  <span className={styles.sessionReading}>
                    {`${formatTokenCount(detail.remainder.tokens)} tok`}
                  </span>
                  <span className={styles.barTrack} aria-hidden="true">
                    {detail.remainder.tokens > 0 ? (
                      <span
                        className={styles.barRestFill}
                        style={{ width: `${detail.remainder.share * 100}%` }}
                      />
                    ) : null}
                  </span>
                  <span className={styles.sessionPct}>{formatShareText(detail.remainder)}</span>
                </li>
              ) : null}
            </ol>
            <p className={styles.sessionsFootnote}>{SESSIONS_FOOTNOTE}</p>
          </section>
        ) : null}
        <p className={styles.footnote}>{FOOTNOTE}</p>
      </div>
    </Panel>
  );
}
