import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Panel } from "../../components/Panel";
import { formatProjectPath, formatTokenCount, formatUsd } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { PRICING_AS_OF } from "./pricingSnapshot";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { WEEKDAY_LABELS } from "./charts/chartPrimitives";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import {
  buildUsageCalendar,
  daySessionsOf,
  type CalendarSessionRow
} from "./usageCalendar";
import styles from "./UsageCalendarPanel.module.css";

/** 面板脚注：窗口正交（Issue 原话「固定滚动 12 个月，不随区间选择器变」）。 */
const FOOTNOTE =
  "窗口固定滚动近 12 个月（365 天），不随上方区间选择器变化；色深 = 当日估算成本的四分位档，0 档 = 无消耗。";

/** 展开区脚注：分母口径与「成本是估算」两条都写在明处（同归因面板的先例）。 */
const SESSIONS_FOOTNOTE = "占比分母 = 当日 token 总量；成本为估算值。";

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

/**
 * 消耗日历（Issue #187）：近 12 个月的 GitHub 式滚动 365 天网格。色深 = 当日
 * 估算成本四分位（数据层 `usageCalendar.ts`），点击行内展开当天会话 Top 清单，
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
        {detail ? (
          <section
            className={styles.sessions}
            aria-label={`${shortDateOf(selected!)}会话清单`}
            data-calendar-sessions
          >
            <div className={styles.sessionsHead}>
              <span className={styles.sessionsTitle}>{`${shortDateOf(
                selected!
              )}消耗 Top 会话 · 共 ${detail.sessions} 个`}</span>
              <button type="button" className={styles.clear} onClick={() => setSelected(null)}>
                × 清除
              </button>
            </div>
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
