import { useMemo } from "react";
import { Panel } from "../../components/Panel";
import { formatModelId, formatTokenCount } from "../../lib/format";
import { annualReportOf, type AnnualReport } from "./annualReport";
import { buildMonthlyReport, type MonthCard } from "./monthlyReport";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./AnnualReportPanel.module.css";

/**
 * 用量年报（E4，规格 design-round-ee-batch3 §2.3 + Round GG G4 逐月区）。
 *
 * 组件只吃 `AnnualReport` 与 `MonthlyReport`：年份过滤、各项之最、并列裁决、
 * 逐月窗口全部由纯函数定死（同输入必同输出），这里只排版。**不在这里补算
 * 任何一个数字**——年报的每一个读数都该能在纯逻辑的测试里被钉住。
 *
 * 六张卡：总量（含起止日与活跃天数）/ 消息 / 最活跃的月份 / 主力模型 /
 * 最长连击 / 最贵的一周。六卡之后是 G4「逐月」区：12 张迷你卡横滚
 * （月名 / token / 活跃日 / 主力模型缩写），partial 月弱化但不禁用——
 * 半月数据是事实不是缺陷，弱化只是提醒「这格不满」。点月卡上抛
 * `onDrillMonth(year, month)`，由页面跳到用量档并选中该月最活跃的一天。
 *
 * 年度切换：规格没有定义多年浏览，所以只呈现数据所在的那一年（`annualReportOf`
 * 缺省取最新记录的本地年）。真要多年对比，第一件事是把逐月序列搬进纯逻辑层。
 */
export function AnnualReportPanel({
  inputs,
  onDrillMonth,
  now
}: {
  inputs: readonly UsageSessionInput[];
  /** 点逐月迷你卡：页面把它翻译成「切用量档 + 选中该月最活跃日」。 */
  onDrillMonth?: (year: number, month: number) => void;
  /** 「现在」锚点（测试注入夹具时间；缺省取真实当下）。 */
  now?: number;
}) {
  const report = useMemo(() => annualReportOf(inputs), [inputs]);
  // 逐月窗口与年报同一年：年报说「第 2026 年」，月份条就不能混进 2025 的尾巴
  // 月——六张卡是 2026 的账，逐月区必须是同一本账，否则读者对不上总数。
  const months = useMemo(
    () => (report ? buildMonthlyReport(inputs, now ?? Date.now()).months.filter((m) => m.year === report.year) : []),
    [inputs, now, report]
  );

  if (!report) {
    return (
      <Panel title="用量年报" ariaLabel="用量年报">
        <p className={styles.emptyFact}>这一年没有记录</p>
        <p className={styles.emptyHint}>
          先在「会话」档扫描一次日志目录——年报按本机日志现算，没有扫描过就没有可统计的会话。
        </p>
      </Panel>
    );
  }

  return (
    <div className={styles.report} data-probe="year-report">
      <p className={styles.scope}>
        全部已扫描会话纳入统计 · 第 {report.year} 年 · 口径：四类 token 之和，按本机日志现算
      </p>
      <div className={styles.cards}>
        <HeadlineCard report={report} />
        <Panel title="消息" ariaLabel={`第 ${report.year} 年消息数`}>
          <p className={styles.figure}>{report.totalMessages.toLocaleString("en-US")}</p>
          <p className={styles.note}>用户与助手消息，不含压缩摘要行</p>
        </Panel>
        <Panel title="最活跃的月份" ariaLabel={`第 ${report.year} 年最活跃的月份`}>
          {report.topMonth ? (
            <>
              <p className={styles.figure}>
                {report.topMonth.month} 月
                <span className={styles.figureUnit}>{formatTokenCount(report.topMonth.tokens)}</span>
              </p>
              <p className={styles.note}>{shareText(report.topMonth.tokens, report.totalTokens)}</p>
            </>
          ) : (
            <p className={styles.note}>全年没有 token 读数——记录只有消息，没有用量</p>
          )}
        </Panel>
        <Panel title="主力模型" ariaLabel={`第 ${report.year} 年主力模型`}>
          {report.topModel ? (
            <>
              <p className={styles.figure}>{formatModelId(report.topModel.model)}</p>
              <p className={styles.note}>
                {formatTokenCount(report.topModel.tokens)} ·{" "}
                {shareText(report.topModel.tokens, report.totalTokens)}
              </p>
            </>
          ) : (
            <p className={styles.note}>没有可归因的模型——记录里没有模型名或没有用量</p>
          )}
        </Panel>
        <Panel title="最长连击" ariaLabel={`第 ${report.year} 年最长连击`}>
          <p className={styles.figure}>
            {report.longestStreakDays}
            <span className={styles.figureUnit}>天</span>
          </p>
          <p className={styles.note}>连续活跃的最长一段（本地自然日，跨周未中断）</p>
        </Panel>
        <Panel title="最贵的一周" ariaLabel={`第 ${report.year} 年最贵的一周`}>
          {report.costliestWeek ? (
            <>
              <p className={styles.figure}>
                {formatTokenCount(report.costliestWeek.tokens)}
                <span className={styles.figureUnit}>tokens</span>
              </p>
              <p className={styles.note}>{report.costliestWeek.weekStartLabel} 起的一周</p>
            </>
          ) : (
            <p className={styles.note}>没有能归到自然周的用量</p>
          )}
          {/* 诚实口径：这张卡的名字沿用了规格的「最贵」，但手里只有 token 量。
              写清「按 token 排名」比印一个没有金额的「最贵」更不容易被读成账单。 */}
          <p className={styles.footnote}>
            按 token 量排名，不是金额
            {report.peakDay ? ` · 单日峰值 ${report.peakDay.date}` : ""}
          </p>
        </Panel>
      </div>
      <MonthStrip months={months} onDrillMonth={onDrillMonth} />
    </div>
  );
}

/**
 * G4 逐月区：12 张 88px 迷你卡横滚。
 *
 * 卡片可点（下钻该月）；「可点」不因 partial 而消失——半月也能下钻看那半截，
 * 禁用了反而让人误以为「这个月还没统计」。空月（窗口内但无记录）同理可点：
 * 下钻落到月内最活跃日，没有活跃日时页面自己兜底（不动日历选区）。
 * 月卡按模型层给出的 (year, month) 升序排列，与读日历的方向一致。
 */
function MonthStrip({
  months,
  onDrillMonth
}: {
  months: MonthCard[];
  onDrillMonth?: (year: number, month: number) => void;
}) {
  if (months.length === 0) return null;
  return (
    <section role="list" className={styles.monthStrip} data-probe="annual-months" aria-label="逐月用量">
      {months.map((card) => (
        <div
          key={`${card.year}-${card.month}`}
          role="listitem"
          className={styles.monthItem}
        >
        <button
          type="button"
          className={card.partial ? styles.monthCardPartial : styles.monthCard}
          aria-label={`${card.year} 年 ${card.month} 月 · ${formatTokenCount(card.tokens)}`}
          onClick={() => onDrillMonth?.(card.year, card.month)}
        >
          <span className={styles.monthName}>{card.month} 月</span>
          <span className={styles.monthTokens}>{formatTokenCount(card.tokens)}</span>
          <span className={styles.monthMeta}>{card.activeDays} 天</span>
          <span className={styles.monthMeta}>{card.topModel ? formatModelId(card.topModel) : "—"}</span>
        </button>
        </div>
      ))}
    </section>
  );
}

/**
 * 卡 1：一年一句话。
 *
 * 标题就是诚实口径的落点（§2.3 的硬约束）：数据从年中开始时不写「2026 年报」，
 * 而写「数据从 2026-03-12 开始（已记录 128 天）」——否则读者会以为这一年的
 * 年报只统计到这么点，其实是本机日志从那天才有。
 */
function HeadlineCard({ report }: { report: AnnualReport }) {
  const title = report.dataStartsMidYear
    ? `数据从 ${isoDay(report.year, report.firstDay)} 开始（已记录 ${report.activeDays} 天）`
    : `${report.year} 年报`;

  return (
    <Panel title={title} ariaLabel={`第 ${report.year} 年总量`}>
      <p className={styles.headline}>
        {formatTokenCount(report.totalTokens)}
        <span className={styles.figureUnit}>tokens</span>
      </p>
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>起止</dt>
          <dd>
            {isoDay(report.year, report.firstDay)} → {isoDay(report.year, report.lastDay)}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>总 token</dt>
          <dd>{report.totalTokens.toLocaleString("en-US")}</dd>
        </div>
        <div className={styles.fact}>
          <dt>活跃天数</dt>
          <dd>{report.activeDays} 天</dd>
        </div>
      </dl>
    </Panel>
  );
}

/** `"3/12"` + 年 → `"2026-03-12"`（纯函数层给的是 M/D，不补零）。 */
function isoDay(year: number, monthDay: string): string {
  const [month, day] = monthDay.split("/");
  return `${year}-${String(Number(month)).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
}

/** 「占全年 42.1%」；全年为 0 时不编一个百分比。 */
function shareText(tokens: number, total: number): string {
  if (!Number.isFinite(total) || total <= 0) return "占全年 —";
  return `占全年 ${((tokens / total) * 100).toFixed(1)}%`;
}
