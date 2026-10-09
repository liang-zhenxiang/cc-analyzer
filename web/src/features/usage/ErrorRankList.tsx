import styles from "./ErrorRankList.module.css";

/**
 * 「按工具失败」与「按项目失败密度」共用的行布局（design §3.3 / §3.4）：
 * 标签｜条｜主读数｜（率/密度外的）第二读数。条长由调用方归一化（0..1），
 * 组件只负责呈现与选中态——工具变体单段，项目变体两段堆叠（工具 / API
 * 两通道，2px 表面缝），「其他」折尾行换中性台阶色。
 *
 * 行是真 `<button>`：click = toggle 过滤事件列表（aria-pressed），选中态是
 * 底色 + 左缘竖条双信号——焦点可见性永不依赖颜色单信号。
 */
export type ErrorRankRow = {
  /** 行的唯一身份（选中态比较用）；折尾行是合成标签。 */
  key: string;
  /** 行标签（「其他 N 类」这类合成标签也在这里）。 */
  label: string;
  /** 过滤身份：点击行要过滤的集合（工具名 / 项目标签）；折尾行是折尾集合。 */
  ids: readonly string[];
  /** title 全文口径（率的分母在悬停时也要说得清）。 */
  hint: string;
  /** 主读数（次数 / 密度），归一化条长（0..1）由调用方算好。 */
  value: number;
  valueLabel: string;
  /** 行尾第二读数（失败率）；折尾行不给——混合桶的率无意义，宁缺毋假。 */
  secondaryLabel?: string;
  /** 项目变体的两段堆叠（各自 0..1）；工具变体不给 → 单段。 */
  segments?: { tool: number; api: number };
  /** 折尾容器：中性台阶色，不涂通道色。 */
  tail?: boolean;
};

export function ErrorRankList({
  rows,
  ariaLabel,
  selectedKey,
  onSelect
}: {
  rows: ErrorRankRow[];
  /** 列表自身 landmark（面板标题已有 region，这里给列表语义）。 */
  ariaLabel: string;
  /** 当前过滤选中的行（kind 匹配本面板时才传，否则 null）。 */
  selectedKey: string | null;
  onSelect: (row: ErrorRankRow) => void;
}) {
  if (rows.length === 0) return null;
  const dual = rows.some((row) => row.secondaryLabel !== undefined);

  return (
    <ul className={styles.list} aria-label={ariaLabel}>
      {rows.map((row) => {
        const selected = selectedKey === row.key;
        const rowClass = [
          styles.row,
          dual ? styles.dual : styles.single,
          row.tail ? styles.tail : "",
          selected ? styles.selected : ""
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <li key={row.key}>
            <button
              type="button"
              className={rowClass}
              title={row.hint}
              aria-pressed={selected}
              onClick={() => onSelect(row)}
            >
              <span className={styles.label} title={row.hint}>
                {row.label}
              </span>
              <span className={styles.track} aria-hidden="true">
                {row.segments ? (
                  <>
                    <span
                      className={`${styles.segment} ${styles.segmentTool}`}
                      style={{ width: `${Math.max(0, Math.min(1, row.segments.tool)) * 100}%` }}
                    />
                    <span
                      className={`${styles.segment} ${styles.segmentApi}`}
                      style={{ width: `${Math.max(0, Math.min(1, row.segments.api)) * 100}%` }}
                    />
                  </>
                ) : (
                  <span
                    className={styles.bar}
                    style={{ width: `${Math.max(0, Math.min(1, row.value)) * 100}%` }}
                  />
                )}
              </span>
              <span className={styles.value}>{row.valueLabel}</span>
              {dual ? (
                <span className={styles.secondary}>{row.secondaryLabel ?? "—"}</span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
