import { PROVENANCE_LABELS, type Provenance } from "./provenance";
import styles from "./ProvenanceBadge.module.css";

/**
 * The confidence badge every dashboard figure carries. `detail` appends
 * context after the tier label (e.g. `快照日期 2026-10-01`); the accessible
 * name always spells out the full sentence so screen readers get the same
 * honesty the sighted user does.
 *
 * Since v0.14.0 it renders as a **dot**, not a filled pill: the same sentence
 * appeared five or six times per screen ("读自日志" on every logged figure), so
 * the page's loudest colour was spent on its least informative text. The tier
 * is still legible — colour separates the three confidence levels, `title`
 * shows the sentence on hover, and the words stay in the accessibility tree
 * (visually hidden), so nothing was silenced, only re-weighted.
 */
export function ProvenanceBadge({ provenance, detail }: { provenance: Provenance; detail?: string }) {
  const label = PROVENANCE_LABELS[provenance];
  const sentence = `${label}${detail ? `，${detail}` : ""}`;
  const accessibleName = `数据来源：${sentence}`;
  return (
    <span
      className={`${styles.badge} ${styles[provenance]}`}
      aria-label={accessibleName}
      title={accessibleName}
    >
      {/* 档位与 detail 分成两个节点：档位本身是一句话（「读自日志」「按定价快照估算」），
          按整句断言它的人不该因为多了一句限定就找不到它。 */}
      <span className={styles.srOnly}>{label}</span>
      {detail ? <span className={styles.srOnly}>{detail}</span> : null}
    </span>
  );
}
