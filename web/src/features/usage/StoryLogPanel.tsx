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
 * **窗口口径由调用方负责**（P0-1）：`inputs` 必须是按页面时间范围裁剪过的
 * 一份（与 KPI / 会话形状同一份 `shapeInputs`），本组件不再碰全量输入——
 * 否则 30 天档会讲出 7 月的日子，和 KPI 数字互相矛盾。
 *
 * 收起态一行一天（24px）：`10-30 · 4 会话 · 3 项目 · 1.2M token · 最忙 14:00`；
 * 默认只列最近 5 天，余下按「再显示 5 天」增量展开（90 天档不一次铺满）。
 * 点击展开当天会话列表（≤160px，id + 时长 + tokens）；展开状态住在组件内部
 * （design §4：不上提），日期倒序由 storyLog 定死。
 *
 * 展开行的账全部来自 `dayReviewOf`（日历「一日回望」同一份账）——本组件
 * 不重算「当天有哪些会话 / 每段多少 token」，只做排版，且喂给 `dayReviewOf`
 * 的也是同一份窗口化 `inputs`。空窗（无记录）走 Panel 空态，不冒充
 * 「今天什么都没干」。
 */

/** 每次增量展开的天数：默认 5 天，90 天窗口靠按钮逐段展开。 */
const PAGE_DAYS = 5;

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

export function StoryLogPanel({
  inputs,
  days
}: {
  /** 已按页面时间范围裁剪过的会话（与 KPI / 会话形状同一份窗口化输入）。 */
  inputs: readonly UsageSessionInput[];
  /** 页面当前区间（天）：写进脚注，并在档位切换时把展开量收回 5 天。 */
  days: number;
}) {
  const allDays = useMemo(() => storyLog(inputs), [inputs]);
  const [openDate, setOpenDate] = useState<string | null>(null);
  // 「再显示 5 天」的增量只对当前区间有效：档位一换，窗口里就是另一批日行，
  // 展开量必须回到 5。这里把区间一起存进快照，渲染时比较——不用 effect
  // 二次 setState（也不会被 30 秒 tick 换掉 `inputs` 引用时误重置）。
  const [expansion, setExpansion] = useState({ range: days, extra: 0 });
  const extra = expansion.range === days ? expansion.extra : 0;
  const visibleCount = Math.min(PAGE_DAYS + extra, allDays.length);
  const visibleDays = allDays.slice(0, visibleCount);
  const remaining = allDays.length - visibleCount;

  const openDay = allDays.length === 0 ? null : allDays.find((day) => day.date === openDate) ?? null;
  // 展开区的账：dayReviewOf 吃**同一份窗口化** inputs + 该日本地零点（与
  // 日历下钻同一条路径）。openDay 是 openDate 的派生值，依赖收在
  // [inputs, openDayStart] 上。
  // 所有 hooks 必须在任何 early return 之前调用（Rules of Hooks）：空窗路径
  // 返回早退但 hooks 数量不能漂移，否则跨渲染顺序崩坏。
  const openDayStart = openDay ? dayStartOf(new Date(openDay.date + "T00:00:00").getTime()) : null;
  const review = useMemo(
    () => (openDayStart === null ? null : dayReviewOf(inputs, openDayStart)),
    [inputs, openDayStart]
  );

  if (allDays.length === 0) {
    return (
      <Panel title="工作日志" ariaLabel="工作日志">
        <p className={styles.empty}>这个窗口没有可讲的日志——先扫描一次，或把区间拉长。</p>
      </Panel>
    );
  }

  return (
    <Panel title="工作日志" ariaLabel="工作日志">
      <div className={styles.days} data-probe="story-log">
        {visibleDays.map((day) => {
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
                {/* 整行是按钮，但之前没有任何可展开的视觉线索，只靠脚注
                    说明。行尾 chevron：收起时朝右，展开时转 90° 朝下。
                    aria-expanded 已在按钮上，图标本身不重复朗读。 */}
                <span
                  className={styles.chevron}
                  data-probe="story-chevron"
                  data-expanded={isOpen ? "true" : "false"}
                  aria-hidden="true"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
                  </svg>
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
      {/* 90 天档不一次铺满：默认 5 天，每次再追加 5 天，按钮写清还剩多少天。 */}
      {remaining > 0 ? (
        <button
          type="button"
          className={styles.more}
          data-probe="story-more"
          onClick={() => setExpansion({ range: days, extra: extra + PAGE_DAYS })}
        >
          {remaining > PAGE_DAYS
            ? `再显示 ${PAGE_DAYS} 天（还剩 ${remaining} 天）`
            : `再显示剩余 ${remaining} 天`}
        </button>
      ) : null}
      <p className={styles.footnote}>
        只统计当前时间范围（近 {days} 天）内的开工日；会话归属开工那天。
        默认列出最近 {PAGE_DAYS} 天，可继续展开。展开行与日历「一日回望」同一份账。
      </p>
    </Panel>
  );
}
