import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { formatShortStamp, formatTokenCount, formatUsd } from "../../lib/format";
import type { UsageSessionInput } from "./usageAggregations";
import { ProvenanceBadge } from "./ProvenanceBadge";
import { peakMinute } from "./peakMinute";
import {
  buildWeeklyDigest,
  isEmptyDigest,
  weekStartOf,
  type DigestFigure,
  type WeeklyDigest
} from "./weeklyDigest";
import styles from "./WeeklyDigestPanel.module.css";

/**
 * 「周战报」（Round CC F3）：本周 vs 上周四行读数 + 一键复制。
 *
 * 两条界面口径必须留在这一层（模型层只给数）：
 * - **涨=红、跌=绿**。这里比的是花钱与消耗：涨了对用户是坏事，跌了才是好事。
 *   照搬「绿色=好」的通用配色，会在用户最该警觉的一格画上最安心的颜色。
 * - **变化为 null 写「—」**，不写「0%」也不写「+100%」：上周还没有基线时，
 *   任何百分比都是编的（`weeklyDigest.deltaOf` 已经把这种情况返回 null）。
 */

type RowKey = keyof DigestFigure;

const ROWS: ReadonlyArray<{ key: RowKey; label: string; format: (figure: DigestFigure) => string }> = [
  { key: "tokens", label: "Tokens", format: (figure) => formatTokenCount(figure.tokens) },
  {
    key: "usd",
    label: "估算成本",
    // 未收录定价的模型让整周金额未知：`—` 比 `$0.00` 诚实。
    format: (figure) => (figure.usd === null ? "—" : formatUsd(figure.usd))
  },
  {
    key: "sessions",
    label: "会话数",
    format: (figure) => figure.sessions.toLocaleString("en-US")
  },
  {
    key: "messages",
    label: "消息数",
    format: (figure) => figure.messages.toLocaleString("en-US")
  }
];

function deltaText(delta: number | null): { text: string; tone: "up" | "down" | "flat" | "none" } {
  if (delta === null || !Number.isFinite(delta)) return { text: "—", tone: "none" };
  const rounded = Math.round(delta);
  if (rounded === 0) return { text: "0%", tone: "flat" };
  return rounded > 0
    ? { text: `▲ +${rounded}%`, tone: "up" }
    : { text: `▼ ${rounded}%`, tone: "down" };
}

/** 剪贴板正文：四行读数拼成纯文本，粘到哪里都还能读（表格/等宽字体都一样）。 */
function digestText(digest: WeeklyDigest, weekStart: number): string {
  const start = new Date(weekStart);
  const head = `周战报（${start.getMonth() + 1}/${start.getDate()} 起，本地自然周）`;
  const lines = ROWS.map((row) => {
    const delta = deltaText(digest.deltas[row.key]);
    const thisValue = row.format(digest.thisWeek);
    const lastValue = row.format(digest.lastWeek);
    return `${row.label}：本周 ${thisValue} · 上周 ${lastValue} · ${delta.text}`;
  });
  return [head, ...lines].join("\n");
}

export function WeeklyDigestPanel({
  inputs,
  now
}: {
  inputs: readonly UsageSessionInput[];
  /** 页面那份读数时钟——「本周」由它决定，组件自己不取时间。 */
  now: number;
}) {
  const digest = useMemo(() => buildWeeklyDigest(inputs, now), [inputs, now]);
  const peak = useMemo(() => peakMinute(inputs), [inputs]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const empty = isEmptyDigest(digest);
  const weekStart = weekStartOf(now);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(digestText(digest, weekStart));
      setCopyState("copied");
    } catch {
      // 剪贴板 API 在无权限 / 非安全上下文 / 老 WebView 里会直接抛错。
      // 降级成一条可读的提示，而不是静默失败（用户会以为已经复制了）。
      setCopyState("failed");
    }
  };

  return (
    <section className={styles.root} data-probe="digest-root">
      <Panel
        title="周战报"
        ariaLabel="周战报"
        actions={<ProvenanceBadge provenance="estimated" detail="成本按定价快照估算" />}
      >
        {empty ? (
          <p className={styles.emptyFact}>还没有可对比的周</p>
        ) : (
          <>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col" className={styles.metricHead}>
                    <span className={styles.srOnly}>读数</span>
                  </th>
                  <th scope="col">本周</th>
                  <th scope="col">上周</th>
                  <th scope="col">变化</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => {
                  const delta = deltaText(digest.deltas[row.key]);
                  return (
                    <tr key={row.key} data-probe="digest-row">
                      <th scope="row" className={styles.metric}>
                        {row.label}
                      </th>
                      <td className={styles.value}>{row.format(digest.thisWeek)}</td>
                      <td className={`${styles.value} ${styles.valueMuted}`}>
                        {row.format(digest.lastWeek)}
                      </td>
                      <td
                        className={`${styles.delta} ${styles[`delta_${delta.tone}`]}`}
                        data-tone={delta.tone}
                        aria-label={
                          delta.tone === "up"
                            ? `较上周增加 ${delta.text.replace(/[^0-9]/g, "")}%`
                            : delta.tone === "down"
                              ? `较上周减少 ${delta.text.replace(/[^0-9]/g, "")}%`
                              : undefined
                        }
                      >
                        {delta.text}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className={styles.footer}>
              <button
                type="button"
                className={styles.copyButton}
                data-probe="digest-copy"
                onClick={onCopy}
              >
                复制战报
              </button>
              {copyState === "copied" ? (
                <span className={styles.copyOk} role="status">
                  已复制到剪贴板
                </span>
              ) : null}
              {copyState === "failed" ? (
                <span className={styles.copyFailed} role="alert">
                  复制失败：剪贴板不可用，请手动选中读数复制
                </span>
              ) : null}
            </div>
          </>
        )}
        {/* 峰值时刻（D9）：一行、不占第二块。没有分钟级读数时整行不画。 */}
        {peak.minuteStart === null ? null : (
          <p className={styles.peak} data-probe="peak-minute">
            <span className={styles.peakLabel}>峰值时刻</span>
            <span className={styles.peakTime}>{formatShortStamp(peak.minuteStart)}</span>
            <span className={styles.peakNote}>
              {formatTokenCount(peak.tokens)} tok
              {peak.runnerUp
                ? ` · 次高 ${formatTokenCount(peak.runnerUp.tokens)} tok（${formatShortStamp(peak.runnerUp.minuteStart)}）`
                : " · 窗口内只有这 1 分钟有消耗"}
            </span>
          </p>
        )}
        {/* 口径常显：读者要能把「周」对到自己的日历上，而不是猜这个 7 天从哪天起。 */}
        <p className={styles.footnote}>按本地自然周（周一起始）</p>
      </Panel>
    </section>
  );
}
