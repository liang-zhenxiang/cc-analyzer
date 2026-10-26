import { useMemo } from "react";
import { formatModelId, formatUsd } from "../../lib/format";
import type { UsageSessionInput } from "./usageAggregations";
import { modelShiftBreakdown, SHIFT_TARGETS, type ModelShiftRow } from "./modelShiftPricing";
import styles from "./ModelSwapTable.module.css";

/**
 * 「换模对照」（D3）：同一批 token 换成别的计价族要花多少钱。
 *
 * 模型层按**源模型**分行（每行带它自己的 actual/shifted），这里把它们加成
 * 一行「实际」和三行「全部换成 X」——加法在视图层做，因为模型层故意不做
 * 跨模型汇总（未知价行不能悄悄少算）。
 */

const FAMILY_LABEL: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

type ShiftTotal = { family: string; model: string; usd: number | null };

function sumOrNull(values: Array<number | null>): number | null {
  if (values.length === 0) return null;
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function ModelSwapTable({ sessions }: { sessions: readonly UsageSessionInput[] }) {
  const rows = useMemo(() => modelShiftBreakdown(sessions), [sessions]);

  if (rows.length === 0) {
    return <p className={styles.empty}>本窗口没有可定价的调用，换模无从比较</p>;
  }

  const actual = sumOrNull(rows.map((row) => row.actualUsd));
  const unpricedRecords = rows
    .filter((row) => row.actualUsd === null)
    .reduce((sum, row) => sum + row.records, 0);
  const totals: ShiftTotal[] = SHIFT_TARGETS.map((target) => ({
    family: target.family,
    model: target.model,
    usd: sumOrNull(
      rows.map((row: ModelShiftRow) => row.shiftedUsd.find((item) => item.to === target.model)?.usd ?? null)
    )
  }));

  const ratioOf = (usd: number | null): string => {
    if (usd === null || actual === null || actual <= 0) return "—";
    const ratio = usd / actual;
    if (!Number.isFinite(ratio)) return "—";
    return `×${ratio.toFixed(1)}`;
  };

  return (
    <div className={styles.wrap} data-probe="model-swap">
      <table className={styles.table}>
        <caption className={styles.srOnly}>
          换模对照：同一批 token 按三种计价族折算的成本，最后一列是与实际花费的倍率
        </caption>
        <thead>
          <tr>
            <th scope="col">计价族</th>
            <th scope="col">同量 token 的成本</th>
            <th scope="col">相对实际</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.actualRow}>
            <th scope="row">实际（按各会话模型）</th>
            <td className={styles.money}>{actual === null ? "—" : formatUsd(actual)}</td>
            <td className={styles.ratio}>—</td>
          </tr>
          {totals.map((total) => (
            <tr key={total.family}>
              <th scope="row">全部换成 {FAMILY_LABEL[total.family] ?? total.family}</th>
              <td className={styles.money}>{total.usd === null ? "—" : formatUsd(total.usd)}</td>
              <td className={styles.ratio}>{ratioOf(total.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.footnote}>
        按定价快照 2026-10-01 折算，不是账单；未知价 token 未计入。
        {unpricedRecords > 0
          ? `其中 ${unpricedRecords.toLocaleString("en-US")} 条记录没有可用的定价。`
          : ""}
      </p>
      <p className={styles.source}>
        源模型 {rows.length} 个：
        {rows
          .map((row) => `${formatModelId(row.from)}${row.actualUsd === null ? "（未计价）" : ""}`)
          .join("、")}
      </p>
    </div>
  );
}
