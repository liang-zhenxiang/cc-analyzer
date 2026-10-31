import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { formatTokenCount } from "../../lib/format";
import type { UsageSessionInput } from "./usageAggregations";
import { sessionTitle } from "../sessions/metadataCache";
import {
  compareSessions,
  type SessionCompareDiff,
  type SessionCompareResult,
  type SessionCompareSide
} from "./sessionCompare";
import { aggregateSession, totalsSum } from "./usageAggregations";
import { topKSimilar } from "./sessionSimilarity";
import styles from "./SessionComparePanel.module.css";

/**
 * 「会话对比」（D1 + Round GG G9 相似会话）：并排看两段会话的五项读数，
 * 并推荐「与会话 A 最像的三个会话」。
 *
 * 模型层只给四维差值（tokens / messages / durationMinutes / records）、两侧的
 * 原始读数与加权 Jaccard 相似度；摘要句与推荐排版由这一层拼——纯展示，
 * 不做第二次统计。
 */

const ROWS: ReadonlyArray<{ label: string; value: (side: SessionCompareSide) => string }> = [
  { label: "消息", value: (side) => side.messages.toLocaleString("en-US") },
  { label: "记录", value: (side) => side.records.toLocaleString("en-US") },
  {
    label: "时长",
    value: (side) =>
      side.durationMinutes <= 0 ? "—" : `${Math.round(side.durationMinutes)} 分`
  },
  { label: "输入 tokens", value: (side) => formatTokenCount(side.tokens.input) },
  { label: "输出 tokens", value: (side) => formatTokenCount(side.tokens.output) }
];

const FIELD_LABEL: Record<SessionCompareDiff["field"], string> = {
  tokens: "tokens",
  messages: "消息数",
  durationMinutes: "时长",
  records: "记录数"
};

/** 相似度低于此值只当参考，不当结论（诚实角标的门槛）。 */
const SIMILARITY_WEAK_THRESHOLD = 0.3;

function sideValue(side: SessionCompareSide, field: SessionCompareDiff["field"]): number {
  if (field === "tokens") return totalsSum(side.tokens);
  return side[field];
}

function sessionLabel(input: UsageSessionInput): string {
  return input.session ? sessionTitle(input.session) : input.projectLabel;
}

/** The sentence under the table: one dimension, whichever differs most. */
function summaryOf(result: SessionCompareResult, aTokens: number, bTokens: number): string {
  if (aTokens === 0 && bTokens === 0) return "这两个会话没有 token 读数";
  const ranked = result.diffs
    .filter((diff) => diff.ratio !== null && Number.isFinite(diff.ratio))
    .sort((left, right) => (right.ratio ?? 0) - (left.ratio ?? 0));
  const top = ranked[0];
  if (!top || (top.ratio ?? 0) === 0) return "两侧在这四个维度上没有明显差异。";
  // `ratio` 只有大小没有方向（小 / 大 都对不上），谁更大要回原始读数取。
  const larger = sideValue(result.a, top.field) >= sideValue(result.b, top.field) ? "A" : "B";
  return `${FIELD_LABEL[top.field]}差得最多：${larger} 比另一侧多 ${Math.round((top.ratio ?? 0) * 100)}%。`;
}

export function SessionComparePanel({ inputs }: { inputs: readonly UsageSessionInput[] }) {
  const ranked = useMemo(() => {
    return inputs
      .map((input) => ({ input, tokens: totalsSum(aggregateSession(input.records).totals) }))
      .sort((left, right) => right.tokens - left.tokens || left.input.projectLabel.localeCompare(right.input.projectLabel))
      .slice(0, 12);
  }, [inputs]);

  const [indexA, setIndexA] = useState(0);
  const [indexB, setIndexB] = useState(1);
  // The range can change under us (7 → 30 days): keep the indices inside.
  const safeA = Math.min(indexA, Math.max(0, ranked.length - 1));
  const safeB = Math.min(Math.max(indexB, ranked.length > 1 ? 1 : 0), Math.max(0, ranked.length - 1));

  // G9 相似会话：锚点是当前选中的会话 A，池子是同一份窗口 inputs。
  // 排除自身由 topKSimilar 按 session.path 身份完成（无 path 时回退池内下标）。
  const similar = useMemo(
    () => (ranked.length > 0 ? topKSimilar(ranked[safeA].input, inputs, 3) : []),
    [inputs, ranked, safeA]
  );

  if (ranked.length < 2) {
    return (
      <Panel title="会话对比" ariaLabel="会话对比">
        <p className={styles.empty}>本窗口只有 1 个会话，没有对手可比</p>
      </Panel>
    );
  }

  const a = ranked[safeA];
  const b = ranked[safeB];
  const result = compareSessions(a.input, b.input);
  const aTokens = totalsSum(result.a.tokens);
  const bTokens = totalsSum(result.b.tokens);

  const select = (
    which: "a" | "b",
    value: number,
    onChange: (next: number) => void,
    label: string
  ) => (
    <label className={styles.picker}>
      <span className={styles.pickerLabel}>{label}</span>
      <select
        className={styles.select}
        value={value}
        data-probe={which === "a" ? "compare-a" : "compare-b"}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {ranked.map((entry, index) => (
          // 同一段会话不能自己比自己：对面的选项是不可选的。
          <option key={entry.input.session?.path ?? `${entry.input.projectLabel}-${index}`} value={index} disabled={index === (which === "a" ? safeB : safeA)}>
            {sessionLabel(entry.input)} · {formatTokenCount(entry.tokens)} tok
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Panel
      title="会话对比"
      ariaLabel="会话对比"
      actions={<span className={styles.scope}>token 总量前两名</span>}
    >
      <div className={styles.pickers}>
        {select("a", safeA, setIndexA, "会话 A")}
        <span className={styles.versus} aria-hidden="true">
          对比
        </span>
        {select("b", safeB, setIndexB, "会话 B")}
      </div>
      <div className={styles.pairs}>
        {[result.a, result.b].map((side, index) => (
          <div className={styles.side} key={index === 0 ? "a" : "b"}>
            {ROWS.map((row) => (
              <div className={styles.pair} key={row.label}>
                <span className={styles.pairLabel}>{row.label}</span>
                <span className={styles.pairValue}>{row.value(side)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className={styles.summary} data-probe="compare-summary">
        {summaryOf(result, aTokens, bTokens)}
      </p>
      <p className={styles.footnote}>
        只比较已读到的记录；时长取首尾记录之差，不把窗口外的等待算进来。
      </p>
      <SimilarSessions similar={similar} anchorLabel={sessionLabel(a.input)} />
    </Panel>
  );
}

/**
 * G9 相似会话：topKSimilar 的三条推荐。
 *
 * 诚实口径：score < 0.3 的推荐**不隐藏**，挂「相似度低，仅供参考」角标——
 * 「找不到像的」本身就是一条有用信息，悄悄删掉它会让人以为推荐是全量的。
 * 全部低于门槛（或池子干净到一条都没有）时整区让位给一句实话
 * 「没有足够相似的会话」——满屏 20% 的角标不是推荐，是噪声。
 */
function SimilarSessions({
  similar,
  anchorLabel
}: {
  similar: ReturnType<typeof topKSimilar>;
  anchorLabel: string;
}) {
  const hasStrong = similar.some((item) => item.score >= SIMILARITY_WEAK_THRESHOLD);
  if (similar.length === 0 || !hasStrong) {
    return (
      <section className={styles.similar} data-probe="compare-similar">
        <h3 className={styles.similarTitle}>相似会话</h3>
        <p className={styles.similarEmpty}>没有足够相似的会话</p>
      </section>
    );
  }

  return (
    <section className={styles.similar} data-probe="compare-similar">
      <h3 className={styles.similarTitle}>相似会话 · 与「{anchorLabel}」最像</h3>
      <ul className={styles.similarList}>
        {similar.map((item) => {
          const weak = item.score < SIMILARITY_WEAK_THRESHOLD;
          return (
            <li key={item.session.session?.path ?? sessionLabel(item.session)} className={styles.similarItem}>
              <span className={styles.similarScore}>{Math.round(item.score * 100)}%</span>
              <span className={styles.similarBody}>
                <span className={styles.similarLabel}>{sessionLabel(item.session)}</span>
                {/* 理由串接：模型层已按贡献降序，这里只负责顿号连接。 */}
                <span className={styles.similarReasons}>{item.reasons.join("；") || "无共同维度"}</span>
              </span>
              {weak ? (
                <span className={styles.similarWeakBadge} title="相似度低于 30%，只当线索不当结论">
                  相似度低，仅供参考
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
