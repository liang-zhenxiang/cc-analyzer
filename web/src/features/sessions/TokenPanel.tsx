import { useMemo } from "react";
import type { SessionRecord } from "./types";
import { shareOf, tokenTotalsOf, type TokenTotals } from "./tokenTotals";
import { costProvenanceOf } from "./costProvenance";
import { formatTokenCount } from "../../lib/format";
import styles from "./TokenPanel.module.css";

type TokenRow = {
  key: string;
  label: string;
  /** The log field the number was read from — the answer to "where did this come from". */
  field: string;
  value: number;
  /** Share of the four counters; null on the TTL split, which is a subset of one row. */
  share: number | null;
  split: boolean;
};

function tokenRow(
  key: string,
  label: string,
  field: string,
  value: number,
  totals: TokenTotals,
  split = false
): TokenRow {
  return { key, label, field, value, share: split ? null : shareOf(value, totals), split };
}

/**
 * Session-level token counts, read from the log and shown one counter at a time.
 *
 * This panel exists because the four counters answer a different question each
 * — `cache_read` and `cache_creation` differ from `input` by more than their
 * price, and a merged "input" hides which one a session actually spent. Every
 * number carries the field it came from, and the one thing the app cannot
 * compute (a cost) says so instead of showing a zero.
 */
export function TokenPanel({
  records,
  isSubagent = false
}: {
  records: readonly SessionRecord[];
  isSubagent?: boolean;
}) {
  const totals = useMemo(() => tokenTotalsOf(records), [records]);
  const cost = costProvenanceOf(totals);

  // The TTL split is a second-level detail: Claude Code only reports it on the
  // calls that actually wrote a cache, so two permanent rows would be noise on
  // most sessions. When it is there, it is shown.
  const rows: TokenRow[] = [
    tokenRow("input", "输入", "usage.input_tokens", totals.input, totals),
    tokenRow(
      "cacheCreation",
      "缓存写入",
      "usage.cache_creation_input_tokens",
      totals.cacheCreation,
      totals
    ),
    ...(totals.cacheCreation > 0
      ? [
          tokenRow(
            "cacheCreationFiveMinute",
            "5 分钟 TTL",
            "usage.cache_creation.ephemeral_5m_input_tokens",
            totals.cacheCreationFiveMinute,
            totals,
            true
          ),
          tokenRow(
            "cacheCreationOneHour",
            "1 小时 TTL",
            "usage.cache_creation.ephemeral_1h_input_tokens",
            totals.cacheCreationOneHour,
            totals,
            true
          )
        ]
      : []),
    tokenRow("cacheRead", "缓存读取", "usage.cache_read_input_tokens", totals.cacheRead, totals),
    tokenRow("output", "输出", "usage.output_tokens", totals.output, totals)
  ];

  return (
    <section className={styles.panel} aria-label="Token 计数">
      <header>
        <h2>Token 计数</h2>
        <span className={styles.source}>来源：日志 message.usage（读取，非估算）</span>
        <span className={styles.unknown}>
          {cost.label} · {cost.reason}
        </span>
      </header>
      <table>
        <thead>
          <tr>
            <th scope="col">计数</th>
            <th scope="col">日志字段</th>
            <th scope="col">token</th>
            <th scope="col" title="各计数占四类合计的比例；合计本身没有语义，不单独展示">
              占比
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.split ? styles.split : undefined}>
              <th scope="row">{row.label}</th>
              <td className={styles.field}>
                <code>{row.field}</code>
              </td>
              <td className={styles.value} title={row.value.toLocaleString("en-US")}>
                {formatTokenCount(row.value)}
              </td>
              <td className={styles.share}>{row.share === null ? "" : `${row.share.toFixed(1)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* 两句拼进同一个表达式：JSX 会在两个兄弟节点之间插入空白，
          中文句号后面就会凭空多出一个空格。 */}
      <p className={styles.scope}>
        {isSubagent
          ? "口径：本子 agent 会话的全部记录。"
          : "口径：本会话主线程；子 agent 会话的用量不计入。"}
        {"数字直接读自日志，未做任何估算。"}
      </p>
    </section>
  );
}
