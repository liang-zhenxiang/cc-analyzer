import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { formatShortStamp, formatTokenCount } from "../../lib/format";
import { storyLog, type StoryDay } from "./storyLog";
import { dayReviewOf } from "./dayReview";
import { dayStartOf, type UsageSessionInput } from "./usageAggregations";
import styles from "./StoryLogPanel.module.css";

/**
 * 工作日志（G1，Round GG）：窗口内「那天干了什么」的叙事行。
 *
 * 位置：KPI 行之后、周战报之前——量级（KPI）→ 逐日叙事 → 周方向，粒度
 * 从粗到细再到横向对比。
 *
 * 收起态一行一天（24px）：`10-30 · 4 会话 · 3 项目 · 1.2M token · 最忙 14:00`；
 * 点击展开当天会话列表（≤160px，id + 时长 + tokens）。首屏成本一行：
 * 展开状态住在组件内部（design §4：不上提），日期倒序由 storyLog 定死。
 *
 * 展开行的账全部来自 `dayReviewOf`（日历「一日回望」同一份账）——本组件
 * 不重算「当天有哪些会话 / 每段多少 token」，只做排版。空窗（无记录）
 * 走 Panel 空态，不冒充「今天什么都没干」。
 */

/** 「10-30」：月-日（补零），叙事行的日期拍子；年份去哪了由窗口决定。 */
function monthDayOf(date: string): string {
  // StoryDay.date 恒为 YYYY-MM-DD（storyLog 手动拼的本地日），直接切片零 locale 风险。
  return `${date.slice(5, 7)}-${date.slice(8, 10)}`;
}

/** 「最忙 14:00」；无消息日显示「无消息」（不猜 0 点，模型层 busiestHour=null 同款）。 */
function busiestLabel(day: StoryDay): string {
  if (day.busiestHour === null) return "无消息";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `最忙 ${pad(day.busiestHour)}:00`;
}

export function StoryLogPanel({ inputs }: { inputs: readonly UsageSessionInput[] }) {
  const days = useMemo(() => storyLog(inputs), [inputs]);
  const [openDate, setOpenDate] = useState<string | null>(null);

  const openDay = days.length === 0 ? null : days.find((day) => day.date === openDate) ?? null;
  // 展开区的账：dayReviewOf 吃全量 inputs + 该日本地零点（与日历下钻同一条
  // 路径）。openDay 是 openDate 的派生值，依赖收在 [inputs, openDayStart] 上。
  // 所有 hooks 必须在任何 early return 之前调用（Rules of Hooks）：空窗路径
  // 返回早退但 hooks 数量不能漂移，否则跨渲染顺序崩坏。
  const openDayStart = openDay ? dayStartOf(new Date(openDay.date + "T00:00:00").getTime()) : null;
  const review = useMemo(
    () => (openDayStart === null ? null : dayReviewOf(inputs, openDayStart)),
    [inputs, openDayStart]
  );

  if (days.length === 0) {
    return (
      <Panel title="工作日志" ariaLabel="工作日志">
        <p className={styles.empty}>这个窗口没有可讲的日志——先扫描一次，或把区间拉长。</p>
      </Panel>
    );
  }

  return (
    <Panel title="工作日志" ariaLabel="工作日志">
      <div className={styles.days} data-probe="story-log">
        {days.map((day) => {
          const isOpen = day.date === openDate;
          return (
            <div key={day.date} className={styles.dayBlock}>
              <button
                type="button"
                className={styles.dayRow}
                data-probe="story-day"
                aria-expanded={isOpen}
                aria-controls={isOpen ? `story-detail-${day.date}` : undefined}
                onClick={() => setOpenDate(isOpen ? null : day.date)}
              >
                <span className={styles.dayDate}>{monthDayOf(day.date)}</span>
                <span className={styles.dayMeta}>
                  {day.sessions} 会话 · {day.projects.length} 项目 ·{" "}
                  {formatTokenCount(day.tokens)} token · {busiestLabel(day)}
                </span>
              </button>
              {isOpen && review ? (
                <ul className={styles.sessionList} id={`story-detail-${day.date}`} data-probe="story-detail">
                  {review.rows.map((row) => (
                    <li key={row.path + row.start} className={styles.sessionRow}>
                      <span className={styles.sessionTitle}>{row.title}</span>
                      <span className={styles.sessionMeta}>
                        {formatShortStamp(row.start)} ·{" "}
                        {row.durationMs > 0 ? `${Math.round(row.durationMs / 60_000)} 分` : "—"} ·{" "}
                        {formatTokenCount(row.tokens)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className={styles.footnote}>
        会话归属开工那天；展开行与日历「一日回望」同一份账。收起态一行一天，点开看当天的会话。
      </p>
    </Panel>
  );
}
