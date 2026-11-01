import { useMemo } from "react";
import { Panel } from "../../components/Panel";
import { formatDuration } from "../../lib/format";
import { rhythmOf, type ConversationRhythm } from "../usage/conversationRhythm";
import type { ParsedSession } from "./types";
import styles from "./RhythmPanel.module.css";

/**
 * H4 对话节奏谱（Round HH §4.4）：挂在重放档底部。
 *
 * 「过程」的另一种读法：重放胶片带讲「发生了什么」，这块讲「我隔多久
 * 提问一次」。同一个时间轴，两层聚合——所以它不配开第 9 个 tab，跟在
 * 重放后面就是它的位置。
 *
 * 数据全走 conversationRhythm 模型层（中位/90 分位/最长/爆发数/标签），
 * 界面只补一件事：六档对数分桶的柱状展示（§4.4 拍板「分桶是纯展示层
 * 的事，不改模型」）。
 *
 * 诚实性：间隔是「两次提问之间的墙钟」，不是思考时长——脚注写死这句，
 * 防止被读成效率指标。样本不足（< MIN_RHYTHM_MESSAGES）不画空图，退成
 * 一句实话。
 */

/** 六档对数分桶（§4.4 逐字档名）；桶界是 [min, max) 左闭右开。 */
const BUCKETS: ReadonlyArray<{ key: string; label: string; minMs: number; maxMs: number }> = [
  { key: "lt-1m", label: "< 1 分", minMs: 0, maxMs: 60_000 },
  { key: "1-5m", label: "1–5 分", minMs: 60_000, maxMs: 5 * 60_000 },
  { key: "5-30m", label: "5–30 分", minMs: 5 * 60_000, maxMs: 30 * 60_000 },
  { key: "30m-2h", label: "30 分–2 时", minMs: 30 * 60_000, maxMs: 2 * 3_600_000 },
  { key: "2-8h", label: "2–8 时", minMs: 2 * 3_600_000, maxMs: 8 * 3_600_000 },
  { key: "gt-8h", label: "> 8 时", minMs: 8 * 3_600_000, maxMs: Number.POSITIVE_INFINITY }
];

/** 六档计数：rhythm.gaps 现算（纯展示分桶，不动模型层）。 */
function bucketCounts(rhythm: ConversationRhythm): number[] {
  const counts = BUCKETS.map(() => 0);
  for (const gap of rhythm.gaps) {
    for (let index = 0; index < BUCKETS.length; index += 1) {
      const bucket = BUCKETS[index];
      if (gap.gapMs >= bucket.minMs && gap.gapMs < bucket.maxMs) {
        counts[index] += 1;
        break;
      }
    }
  }
  return counts;
}

export function RhythmPanel({ parsed }: { parsed: ParsedSession }) {
  const rhythm = useMemo(() => {
    const userTimestamps = parsed.records
      .filter((record) => record.kind === "user")
      .map((record) => record.timestamp);
    return rhythmOf(userTimestamps);
  }, [parsed]);

  // 样本不足：不画空图、不给标签——「只有 2 次提问」说的是实话，
  // 一排零柱说的是谎（它会让人以为「分布很均匀」）。
  if (!rhythm) {
    const asked = parsed.records.filter((record) => record.kind === "user").length;
    return (
      <Panel title="对话节奏">
        <p className={styles.few} data-probe="rhythm-few">
          {asked === 0
            ? "这个会话没有用户消息"
            : `只有 ${asked} 次提问，还看不出节奏`}
        </p>
      </Panel>
    );
  }

  const counts = bucketCounts(rhythm);
  const max = Math.max(...counts, 1);
  const summary = `提问间隔分布：中位间隔 ${formatDuration(rhythm.medianMs)}，最快与最慢之间 ${formatDuration(rhythm.longestMs)}，共 ${rhythm.gaps.length} 次间隔`;

  return (
    <Panel title="对话节奏">
      <p className={styles.tagline} data-probe="rhythm-label">
        {rhythm.label}
      </p>
      <div className={styles.rhythm} data-probe="rhythm" role="img" aria-label={summary}>
        {BUCKETS.map((bucket, index) => (
          <div
            key={bucket.key}
            className={styles.rhythmCol}
            data-probe="rhythm-bar"
            data-bucket={bucket.key}
          >
            {/* 柱高按档内计数 / 最大档取百分比；零档给 2% 的可见桩（零柱 */}
            {/* 完全消失会让「这一档没有」与「数据缺失」同形）。 */}
            <span
              className={styles.rhythmBar}
              style={{ height: `${Math.max((counts[index] / max) * 100, counts[index] === 0 ? 2 : 0)}%` }}
              aria-hidden="true"
            />
            <span className={styles.rhythmCount}>{counts[index]}</span>
            <span className={styles.rhythmLabel}>{bucket.label}</span>
          </div>
        ))}
      </div>
      <p className={styles.readout} data-probe="rhythm-readout">
        中位间隔 {formatDuration(rhythm.medianMs)}
        {" · "}90 分位 {formatDuration(rhythm.p90Ms)}
        {" · "}最长 {formatDuration(rhythm.longestMs)}
        {" · "}其中 {rhythm.bursts} 次在一分钟内
      </p>
      <p className={styles.note}>间隔是两次提问之间的墙钟，不是思考时长。</p>
    </Panel>
  );
}
