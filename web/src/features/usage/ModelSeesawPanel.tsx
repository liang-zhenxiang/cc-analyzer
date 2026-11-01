import { useMemo, useState } from "react";
import { formatModelId, formatTokenCount } from "../../lib/format";
import type { UsageSessionInput } from "./usageAggregations";
import { modelSeesaw } from "./modelSeesaw";
import styles from "./ModelSeesawPanel.module.css";

/**
 * 模型跷跷板（H6，§4.6）：两个模型的逐月 token 对照——「谁在涨、谁在退」。
 *
 * - 候选 = 窗口内出现过的模型（字典序展示），默认 token 最多的两个
 *   （占比图的第一二名，进来就有可看的对比）；
 * - 条宽共用同一刻度（全窗口两侧最大值）：两根条可以直接比长短，
 *   各自归一会把「此消彼长」抹平；
 * - 单模型独占月照样渲染另一侧 0——迁移形状恰恰是单侧归零的月；
 * - overlapMonths 是样本量脚注（两模型同月都有用量的月数），
 *   不是渲染门槛。
 */

/** 候选模型：value 是原始 id（进 modelSeesaw 精确匹配），label 缩短显示。 */
type ModelOption = { value: string; label: string };

export function ModelSeesawPanel({
  sessions,
  months,
  now
}: {
  sessions: readonly UsageSessionInput[];
  /** 窗口覆盖的自然月数（含空月）；<2 时调用方不再渲染本面板——
      传进来只为让「渲染门槛」显式化，组件内不重复判定。 */
  months: number;
  /** 注入「现在」（月窗口末月兜底）；缺省由模型层取 Date.now()。 */
  now?: number;
}) {
  void months;
  // 候选从 range 的窗口化数据来不了（组件只拿 sessions），这里按四计数
  // 现算：与 aggregateRange 的 models bucket 同判定（只数带 usage 的记录）。
  const options = useMemo<ModelOption[]>(() => {
    const totals = new Map<string, number>();
    for (const input of sessions) {
      for (const record of input.records) {
        if (!record.usage || !record.model) continue;
        const usage = record.usage;
        const tokens =
          (usage.inputTokens ?? 0) +
          (usage.outputTokens ?? 0) +
          (usage.cacheCreationTokens ?? 0) +
          (usage.cacheReadTokens ?? 0);
        totals.set(record.model, (totals.get(record.model) ?? 0) + tokens);
      }
    }
    return [...totals.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value]) => ({ value, label: formatModelId(value) }));
  }, [sessions]);

  // 默认选 token 最多的两个（并列取字典序靠前的——排序键 (value) 已稳定）。
  const defaults = useMemo(() => {
    const ranked = [...options].sort(
      (a, b) => totalOf(sessions, b.value) - totalOf(sessions, a.value)
    );
    return { a: ranked[0]?.value ?? "", b: ranked[1]?.value ?? "" };
  }, [options, sessions]);

  const [modelA, setModelA] = useState<string>(defaults.a);
  const [modelB, setModelB] = useState<string>(defaults.b);
  // 候选随窗口变化重置选择：旧选择可能已不在候选里，硬保留会画出空条。
  const known = new Set(options.map((option) => option.value));
  const safeA = known.has(modelA) ? modelA : defaults.a;
  const safeB = known.has(modelB) ? modelB : defaults.b;

  const seesaw = useMemo(
    () => (now === undefined ? modelSeesaw(sessions, safeA, safeB) : modelSeesaw(sessions, safeA, safeB, now)),
    [sessions, safeA, safeB, now]
  );

  // 共刻度：全窗口（两侧、全部月）的最大单月值——同一分母出百分比。
  const scaleMax = useMemo(
    () =>
      seesaw.months.reduce(
        (max, month) => Math.max(max, month.tokensA, month.tokensB),
        0
      ),
    [seesaw]
  );

  if (options.length < 2) {
    // 诚实句（§4.6）：一根条不成画，说清「为什么没有」。
    return <p className={styles.empty}>窗口内不足两个模型，无法对比</p>;
  }
  if (safeA === safeB) {
    // 与自身比较：不画两根等长条冒充对比。
    return (
      <div className={styles.wrap}>
        {picker("a", safeA, setModelA)}
        {picker("b", safeB, setModelB)}
        <p className={styles.empty}>两个选择是同一个模型，与自身比较没有意义</p>
      </div>
    );
  }

  function picker(which: "a" | "b", value: string, onChange: (next: string) => void) {
    return (
      <label className={styles.picker}>
        <span className={styles.pickerLabel}>{which === "a" ? "模型 A" : "模型 B"}</span>
        <select
          className={styles.select}
          value={value}
          data-probe={which === "a" ? "seesaw-a" : "seesaw-b"}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value} title={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className={styles.wrap} data-probe="model-seesaw">
      <div className={styles.seesawHead}>
        {picker("a", safeA, setModelA)}
        {picker("b", safeB, setModelB)}
      </div>
      {seesaw.months.length === 0 ? (
        <p className={styles.empty}>所选范围内这两个模型都没有用量记录</p>
      ) : (
        <div className={styles.rows}>
          {seesaw.months.map((month) => {
            const key = `${month.year}-${month.month}`;
            const aPct = scaleMax > 0 ? (month.tokensA / scaleMax) * 100 : 0;
            const bPct = scaleMax > 0 ? (month.tokensB / scaleMax) * 100 : 0;
            return (
              <div key={key} className={styles.seesawRow} data-probe="seesaw-row" data-month={key}>
                <span className={styles.seesawMonth}>{`${month.year}-${month.month}`}</span>
                <span className={styles.bars} aria-hidden="true">
                  <span className={`${styles.bar} ${styles.barA}`} style={{ width: `${aPct}%` }} />
                  <span className={`${styles.bar} ${styles.barB}`} style={{ width: `${bPct}%` }} />
                </span>
                <span className={styles.seesawValue}>
                  {`${formatTokenCount(month.tokensA)} / ${formatTokenCount(month.tokensB)}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className={styles.note}>
        按月的 token 合计；两根条共用同一刻度，长度可直接比。
        {` 两模型同月都有用量的月数：${seesaw.overlapMonths}`}
      </p>
    </div>
  );
}

/** 窗口内某模型的总 token（默认候选用；与 options 同判定）。 */
function totalOf(sessions: readonly UsageSessionInput[], model: string): number {
  let sum = 0;
  for (const input of sessions) {
    for (const record of input.records) {
      if (record.model !== model || !record.usage) continue;
      const usage = record.usage;
      sum +=
        (usage.inputTokens ?? 0) +
        (usage.outputTokens ?? 0) +
        (usage.cacheCreationTokens ?? 0) +
        (usage.cacheReadTokens ?? 0);
    }
  }
  return sum;
}
