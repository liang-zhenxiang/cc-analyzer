import { useMemo } from "react";
import { Panel } from "../../components/Panel";
import { formatModelId, formatTokenCount } from "../../lib/format";
import { annualReportOf, type AnnualReport } from "./annualReport";
import type { UsageSessionInput } from "./usageAggregations";
import styles from "./AnnualReportPanel.module.css";

/**
 * 用量年报（E4，规格 design-round-ee-batch3 §2.3）。
 *
 * 组件只吃 `AnnualReport`：年份过滤、各项之最、三处并列裁决全部由纯函数
 * `annualReportOf` 定死（同输入必同输出），这里只排版。**不在这里补算任何一个
 * 数字**——年报的每一个读数都该能在纯逻辑的测试里被钉住。
 *
 * 六张卡：总量（含起止日与活跃天数）/ 消息 / 最活跃的月份 / 主力模型 /
 * 最长连击 / 最贵的一周。规格 §2.3 原本还画「十二个月的形状」与「一年中的
 * 分布小格」，但 `AnnualReport` 不带逐月与逐日序列——为画那两根图在视图里
 * 重扫一遍全量记录，等于把口径复制成两份，两边迟早对不上。年报在这台机器上
 * 是「一段叙事」，不是又一张图。
 *
 * 年度切换：规格没有定义多年浏览，所以只呈现数据所在的那一年（`annualReportOf`
 * 缺省取最新记录的本地年）。真要多年对比，第一件事是把逐月序列搬进纯逻辑层。
 */
export function AnnualReportPanel({ inputs }: { inputs: readonly UsageSessionInput[] }) {
  const report = useMemo(() => annualReportOf(inputs), [inputs]);

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
    </div>
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
