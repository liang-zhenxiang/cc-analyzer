import { useMemo, useState } from "react";
import { Panel } from "../../components/Panel";
import { SegmentedControl } from "../../components/SegmentedControl";
import { formatDuration } from "../../lib/format";
import { ProvenanceBadge } from "./ProvenanceBadge";
import type { UsageSessionInput } from "./usageAggregations";
import { sessionDurationsOf } from "./sessionDurations";
import { sessionGapHistogram } from "./sessionGaps";
import { modelSwitchHeatOf } from "./modelSwitchHeat";
import { toolSignaturesOf } from "./toolSignature";
import styles from "./SessionShapePanel.module.css";

/**
 * I1 / I3 / I9 / I10 会话形状卡：一个卡、四档视图（时长 / 间隔 / 切换 / 配方）。
 *
 * 由界面层把每个会话折成模型要的形状（模型只做分桶与统计）：
 *   - 时长：有 ≥2 条记录才量得出跨度（单记录会话传 null，模型会把它计入
 *     「不足 5 分钟」并单独记 unmeasurable——「量不出」不等于「0ms」）；
 *   - 间隔：每个会话的首条记录时刻，模型按相邻差分桶；
 *   - 切换：按时间序取「带 usage 的记录」的模型序列（相邻不同记一次）；
 *   - 配方：每个会话用过的工具集合（去重、排序由模型做）。
 */

type ShapeView = "duration" | "gap" | "switch" | "signature";

const SHAPE_ITEMS: Array<{ value: ShapeView; label: string }> = [
  { value: "duration", label: "时长" },
  { value: "gap", label: "间隔" },
  { value: "switch", label: "切换" },
  { value: "signature", label: "配方" }
];

type ShapeBucket = { id: string; label: string; count: number };

/** 柱高百分比：以本视图最大的桶为 100%，空桶留 0（不画假高度）。 */
function bucketPercents(buckets: readonly ShapeBucket[]): number[] {
  const max = buckets.reduce((value, bucket) => Math.max(value, bucket.count), 0);
  return buckets.map((bucket) => (max > 0 ? (bucket.count / max) * 100 : 0));
}

export function SessionShapePanel({ inputs }: { inputs: readonly UsageSessionInput[] }) {
  const [view, setView] = useState<ShapeView>("duration");

  const facts = useMemo(() => {
    const durations: Array<number | null> = [];
    const starts: Array<number | null> = [];
    const modelSequences: string[][] = [];
    const toolSets: string[][] = [];

    for (const input of inputs) {
      const records = [...input.records].sort((a, b) => a.timestamp - b.timestamp);
      if (records.length === 0) continue;

      const span =
        records.length >= 2
          ? (records[records.length - 1]!.timestamp ?? 0) - (records[0]!.timestamp ?? 0)
          : null;
      // 元信息里的 durationMs 若已算出（≥2 条记录）优先用它；否则用首末差。
      const duration =
        span === null ? null : (input.session?.facts?.durationMs ?? span);
      durations.push(Number.isFinite(duration) ? duration : null);
      starts.push(records[0]!.timestamp);

      const sequence = records.filter((record) => record.usage && record.model).map((record) => record.model!);
      if (sequence.length > 0) modelSequences.push(sequence);

      const tools = [...new Set(records.map((record) => record.toolName).filter((name): name is string => Boolean(name)))];
      toolSets.push(tools);
    }

    return { durations, starts, modelSequences, toolSets };
  }, [inputs]);

  const durationData = useMemo(() => sessionDurationsOf(facts.durations), [facts.durations]);
  const gapData = useMemo(() => sessionGapHistogram(facts.starts), [facts.starts]);
  const switchData = useMemo(
    () => modelSwitchHeatOf(facts.modelSequences.map((models) => ({ models }))),
    [facts.modelSequences]
  );
  const signatureData = useMemo(
    () => toolSignaturesOf(facts.toolSets.map((tools) => ({ tools }))),
    [facts.toolSets]
  );

  const repeated = (signatureData?.signatures ?? []).filter((item) => item.count >= 2).slice(0, 5);

  let buckets: readonly ShapeBucket[] = [];
  let readout = "";
  let note = "";
  let ariaLabel = "";
  let empty: string | null = null;

  if (view === "duration") {
    const data = durationData;
    // 模型在「一个可计时的会话都没有」时返回 null；此时仍要用输入会话数
    // 说清「只有 N 个会话」，而不是笼统的「样本不足」。
    const total = data?.buckets.reduce((sum, bucket) => sum + bucket.count, 0) ?? inputs.length;
    if (total === 0) {
      empty = "样本不足，画不出分布";
    } else if (total < 3) {
      empty = `只有 ${total} 个会话，看不出分布`;
    } else if (!data || data.medianMs === null) {
      empty = "样本不足，画不出分布";
    } else {
      buckets = data.buckets;
      readout = `中位跨度 ${formatDuration(data.medianMs)}，${total} 个会话`;
      note =
        "按首末记录差算，含等待。" +
        (data.unmeasurable > 0
          ? ` 另有 ${data.unmeasurable} 个会话只有一条记录，计入「不足 5 分钟」。`
          : "");
      ariaLabel = `时长分布：${readout}`;
    }
  } else if (view === "gap") {
    const data = gapData;
    const total = data?.buckets.reduce((sum, bucket) => sum + bucket.count, 0) ?? 0;
    if (!data || total === 0) {
      empty = "样本不足，画不出分布";
    } else if (total < 2 || data.medianMs === null) {
      empty = "样本不足，画不出分布";
    } else {
      buckets = data.buckets;
      readout = `中位间隔 ${formatDuration(data.medianMs)}，${total} 对相邻会话`;
      note =
        "按开始时刻排序取相邻差。" +
        (data.skipped > 0 ? ` ${data.skipped} 个会话缺开始时刻，未参与。` : "");
      ariaLabel = `间隔分布：${readout}`;
    }
  } else if (view === "switch") {
    const data = switchData;
    const total = data ? data.never + data.once + data.multi : 0;
    if (!data || total < 3) {
      empty = total > 0 ? `只有 ${total} 个会话，看不出切换` : "样本不足，画不出分布";
    } else {
      buckets = [
        { id: "never", label: "从不", count: data.never },
        { id: "once", label: "1 次", count: data.once },
        { id: "multi", label: "2 次及以上", count: data.multi }
      ];
      const percent = data.switchRate === null ? "—" : `${Math.round(data.switchRate * 100)}%`;
      readout = `${percent} 的会话换过模型`;
      note = "相邻两条带 usage 的记录模型不同记一次；换回旧模型也算（A→B→A 是 2 次）。";
      ariaLabel = `模型切换：${readout}`;
    }
  } else {
    const data = signatureData;
    if (!data || repeated.length === 0) {
      empty = "还没有重复出现的配方";
    } else {
      readout = `${repeated.length} 种配方重复出现`;
      note =
        "签名 = 工具集合排序后以「 · 」拼接。" +
        (data.noToolsCount > 0 ? ` ${data.noToolsCount} 个会话没有调用工具。` : "");
      ariaLabel = `工具配方：${repeated.map((item) => `${item.signature} ${item.count} 个会话`).join("；")}`;
    }
  }

  const percents = bucketPercents(buckets);

  return (
    <Panel
      title="会话形状"
      ariaLabel="会话形状"
      actions={
        <>
          <SegmentedControl
            items={SHAPE_ITEMS}
            value={view}
            onChange={(next) => setView(next)}
            ariaLabel="会话形状视图"
          />
          <ProvenanceBadge provenance="logged" />
        </>
      }
    >
      <div className={styles.shape} data-probe="session-shape" data-shape={view}>
        {empty ? (
          <p className={styles.empty}>{empty}</p>
        ) : view === "signature" ? (
          <ul className={styles.signatureList} aria-hidden="true">
            {repeated.map((item) => (
              <li key={item.signature} className={styles.signatureRow}>
                <span className={styles.signatureName}>{item.signature}</span>
                <span className={styles.signatureCount}>{`${item.count} 个会话`}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.bars} data-probe="shape-bars" role="img" aria-label={ariaLabel}>
            {buckets.map((bucket, index) => (
              <div key={bucket.id} className={styles.col} data-probe="shape-bar" data-bucket={bucket.id}>
                <span
                  className={styles.bar}
                  style={{ height: `${percents[index] ?? 0}%` }}
                  aria-hidden="true"
                />
                <span className={styles.count}>{bucket.count}</span>
                <span className={styles.label}>{bucket.label}</span>
              </div>
            ))}
          </div>
        )}
        {!empty ? (
          <p className={styles.readout} data-probe="shape-readout">
            {readout}
          </p>
        ) : null}
        {!empty && note ? <p className={styles.note}>{note}</p> : null}
      </div>
    </Panel>
  );
}
