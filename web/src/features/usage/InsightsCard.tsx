import { Fragment, useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import {
  previousRange,
  rangeLabel,
  statsForRange,
  type CompareRange,
  type RangeStats
} from "./compareRanges";
import {
  COMPACTION_BASE_SESSIONS,
  formatInsightCompaction,
  formatInsightMinutes,
  formatInsightTokens,
  type Insight,
  type InsightKind
} from "./insights";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";
import styles from "./InsightsCard.module.css";

/**
 * 「值得注意的变化」（Issue #383）的卡片层。
 *
 * 卡片只做三件事：把模型层给出的句子摆成一行、按需要展开两段的原始读数、
 * 在没有任何洞察时陈述空态。阈值、排序、文案与样本下限都不在这里——它们
 * 全部来自 `insights.ts`，页面改区间只会重新调用 `buildInsights`。
 *
 * 三条硬规则写死在结构里：
 * 1. **中性行没有箭头**：方向已经写在句子的「从 21% 升到 58%」里，再加五枚
 *    箭头等于五个警报。只有错误率（`direction === "up-bad"`）在句首带 ▲/▼，
 *    且**只有箭头着色**（升 `--danger`、降 `--success`），数字仍用正文色。
 * 2. **依据区同一时刻只开一条**（手风琴）：五条同时展开会多出约 715px，把
 *    KPI 顶出首屏。依据区内没有可聚焦元素，Escape 收起时焦点留在行上。
 * 3. **行高由行高令牌派生**（`min-height: calc(--sp-1 * 2 + --lh-base)`），
 *    不写固定高度：130% 字号下行盒会跟着 `--font-scale` 长高，固定 height
 *    会把文字裁掉。
 */

/** 数字片段：等宽 + 等宽数字，**不额外着色**（颜色会冒充「好/坏」判断）。 */
const NUMBER_TOKEN = /^(\d[\d,.]*(?:[%KMB])?)$/;

function renderSentence(text: string) {
  return text
    .split(/(\d[\d,.]*(?:[%KMB])?)/)
    .filter((part) => part !== "")
    .map((part, index) =>
      NUMBER_TOKEN.test(part) ? (
        <span key={index} className={styles.number}>
          {part}
        </span>
      ) : (
        <Fragment key={index}>{part}</Fragment>
      )
    );
}

/** U+2212：真减号，不用连字符——它们是两个字符，负号不该靠字体去猜。 */
const MINUS = "−";

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 依据区「当前 / 上一个」两列读数，单位随 kind 走。 */
function formatReading(kind: InsightKind, value: number): string {
  switch (kind) {
    case "model":
    case "project":
    case "errorRate":
      // 句子四舍五入到整数；依据区是原始读数，多一位小数才看得出「差在哪」。
      return `${value.toFixed(1)}%`;
    case "sessionLength":
      return formatInsightMinutes(value);
    case "dailyTokens":
      return formatInsightTokens(value);
    case "compaction":
      return `${formatInsightCompaction(value)} 次`;
  }
}

/**
 * 依据区「变化」行。单位按 kind 分三档（差一个数量级，不能混）：
 * - 占比 / 失败率：**百分点**（58.2% − 21.4% = +36.8 个百分点）；
 * - 会话时长 / 日均 token：**相对变化 %**；
 * - 压缩频率：**次/会话**——证据读数按「每 10 个会话」展示，差值要除回去。
 */
function formatChange(insight: Insight): string {
  const { before, after } = insight.evidence[0];
  const sign = after >= before ? "+" : MINUS;
  switch (insight.kind) {
    case "model":
    case "project":
    case "errorRate":
      return `${sign}${Math.abs(after - before).toFixed(1)} 个百分点`;
    case "sessionLength":
    case "dailyTokens": {
      const pct = before > 0 ? Math.abs((after - before) / before) * 100 : 0;
      return `${sign}${pct.toFixed(1)}%`;
    }
    case "compaction":
      return `${sign}${trimDecimal(
        Math.abs(after - before) / COMPACTION_BASE_SESSIONS
      )} 次/会话`;
  }
}

/**
 * 一个窗口的样本量（只用于依据区展示，不参与任何判定）。
 *
 * 判定已经在 `buildInsights` 里完成；这里重算的只是「两段各自的样本」这一
 * 事实，口径必须与逻辑层逐字一致：会话 / 活跃天走 `statsForRange`，工具调用
 * 走 `errorExtract.days` 的 `toolCalls`（与 `insights.ts` 的 `toolWindowOf`
 * 同一个提取通道）。
 */
function windowBoundsOf(range: CompareRange, now: number): { start: number; end: number } {
  const days = Number.isFinite(range.days) ? Math.max(1, Math.floor(range.days)) : 1;
  const start = dayStartOf(range.startDay);
  const end = addLocalDays(start, days);
  return { start, end: Math.min(end, addLocalDays(dayStartOf(now), 1)) };
}

function toolCallsIn(inputs: readonly UsageSessionInput[], bounds: { start: number; end: number }): number {
  let calls = 0;
  for (const input of inputs) {
    const extract = input.errorExtract;
    if (!extract) continue;
    for (const [dayStart, facts] of extract.days) {
      if (dayStart < bounds.start || dayStart >= bounds.end) continue;
      for (const count of facts.toolCalls.values()) calls += count;
    }
  }
  return calls;
}

type Samples = { current: string; previous: string };

function sampleOf(
  kind: InsightKind,
  current: RangeStats,
  previous: RangeStats,
  toolCalls: { current: number; previous: number }
): Samples {
  switch (kind) {
    case "model":
    case "project":
      // 占比的分母是两段的 token 总量；两段都非零是产出该条的前提。
      return {
        current: `${formatTokenCount(current.tokens)} token`,
        previous: `${formatTokenCount(previous.tokens)} token`
      };
    case "errorRate":
      return {
        current: `${toolCalls.current} 次调用`,
        previous: `${toolCalls.previous} 次调用`
      };
    case "compaction":
    case "sessionLength":
      return {
        current: `${current.sessions} 个会话`,
        previous: `${previous.sessions} 个会话`
      };
    case "dailyTokens":
      return {
        current: `${current.activeDays} 个活跃日`,
        previous: `${previous.activeDays} 个活跃日`
      };
  }
}

export function InsightsCard({
  insights,
  inputs,
  days,
  now
}: {
  insights: readonly Insight[];
  /** 依据区的样本量需要原始输入；判定本身已在 `buildInsights` 完成。 */
  inputs: readonly UsageSessionInput[];
  days: number;
  /** 与 `buildInsights` 同一个 now：两段区间的标签与样本量必须同源。 */
  now: number;
}) {
  // 同一时刻只有一条展开：`kind` 在每条规则里唯一，不需要另造 id。
  const [openKind, setOpenKind] = useState<InsightKind | null>(null);

  const currentRange = useMemo<CompareRange>(
    () => ({ startDay: addLocalDays(dayStartOf(now), -(days - 1)), days }),
    [days, now]
  );
  const previous = useMemo(() => previousRange(currentRange), [currentRange]);

  // 样本量只服务展开区；清单一空时连锁定两次窗口遍历都省掉。
  const samples = useMemo(() => {
    if (insights.length === 0) return null;
    const currentStats = statsForRange(inputs, currentRange, now);
    const previousStats = statsForRange(inputs, previous, now);
    const toolCalls = {
      current: toolCallsIn(inputs, windowBoundsOf(currentRange, now)),
      previous: toolCallsIn(inputs, windowBoundsOf(previous, now))
    };
    return { currentStats, previousStats, toolCalls };
  }, [insights.length, inputs, currentRange, previous, now]);

  // 区间变了（7/30/90）但展开着的那条规则还在时，继续展开是合理的；规则消失
  // 后 openKind 指向一条不存在的行，不会渲染任何东西，也无需清状态。
  const close = () => setOpenKind(null);

  return (
    <Panel title="值得注意的变化" ariaLabel="值得注意的变化">
      {insights.length === 0 ? (
        <div data-probe="insights-empty">
          <p className={styles.emptyTitle}>最近没有达到阈值的变化</p>
          <p className={styles.emptyHint}>
            与上一个 {days} 天相比，没有指标同时满足变化幅度与样本量要求。
          </p>
        </div>
      ) : (
        <ul className={styles.rows} data-probe="insights-list" onKeyDown={(event) => {
          // 依据区没有可聚焦元素，焦点始终在行按钮上；Escape 在这里冒泡到
          // 容器即可收起，不移动焦点。
          if (event.key === "Escape" && openKind !== null) {
            event.preventDefault();
            close();
          }
        }}>
          {insights.map((insight) => {
            const open = openKind === insight.kind;
            const { before, after } = insight.evidence[0];
            const arrow =
              insight.direction === "up-bad" ? (after > before ? "▲" : "▼") : null;
            const evidenceId = `insight-evidence-${insight.kind}`;
            const sample =
              samples === null
                ? null
                : sampleOf(insight.kind, samples.currentStats, samples.previousStats, samples.toolCalls);

            return (
              <li key={insight.kind} className={styles.item} data-kind={insight.kind}>
                <button
                  type="button"
                  className={styles.row}
                  data-probe="insight-row"
                  aria-expanded={open}
                  aria-controls={open ? evidenceId : undefined}
                  onClick={() => setOpenKind(open ? null : insight.kind)}
                >
                  <span className={styles.sentence} data-probe="insight-sentence">
                    {arrow === null ? null : (
                      <>
                        <span
                          className={arrow === "▲" ? styles.arrowUp : styles.arrowDown}
                          data-probe="insight-arrow"
                          aria-hidden="true"
                        >
                          {arrow}
                        </span>{" "}
                      </>
                    )}
                    {renderSentence(insight.text)}
                  </span>
                  <span
                    className={styles.range}
                    title={`当前 ${rangeLabel(currentRange)}；上一个 ${rangeLabel(previous)}`}
                  >
                    近 {days} 天 vs 上一个 {days} 天
                  </span>
                  <span className={styles.chevron} aria-hidden="true" />
                </button>

                {open ? (
                  <div className={styles.evidence} id={evidenceId} data-probe="insight-evidence">
                    <table className={styles.table}>
                      <caption className={styles.srOnly}>
                        {`${insight.text}的依据：当前区间与上一个等长区间的原始读数。`}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col" className={styles.metricHead}>
                            指标
                          </th>
                          <th scope="col">当前</th>
                          <th scope="col">上一个</th>
                        </tr>
                      </thead>
                      <tbody>
                        {insight.evidence.map((row) => (
                          <tr key={row.label}>
                            <th scope="row" className={styles.metric}>
                              {row.label}
                            </th>
                            <td className={styles.value}>
                              {formatReading(insight.kind, row.after)}
                            </td>
                            <td className={styles.valueMuted}>
                              {formatReading(insight.kind, row.before)}
                            </td>
                          </tr>
                        ))}
                        <tr data-probe="insight-change">
                          <th scope="row" className={styles.metric}>
                            变化
                          </th>
                          <td className={styles.value} colSpan={2}>
                            {formatChange(insight)}
                          </td>
                        </tr>
                        <tr data-probe="insight-sample">
                          <th scope="row" className={styles.metric}>
                            样本量
                          </th>
                          <td className={styles.value}>{sample?.current ?? "—"}</td>
                          <td className={styles.valueMuted}>{sample?.previous ?? "—"}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* 空态不整卡消失：Panel 头与口径脚注照旧，只把行换成两句事实。 */}
      <p className={styles.footnote}>
        与上一个等长区间比较；只列出达到阈值的项，未达阈值的不会出现。全部数字可从上方的区间控件复算。
      </p>
    </Panel>
  );
}
