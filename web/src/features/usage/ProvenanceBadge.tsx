import { PROVENANCE_LABELS, type Provenance } from "./provenance";
import styles from "./ProvenanceBadge.module.css";

/**
 * The confidence badge every dashboard figure carries. `detail` appends
 * context after the tier label (e.g. `快照日期 2026-10-01`); the accessible
 * name always spells out the full sentence so screen readers get the same
 * honesty the sighted user does.
 */
export function ProvenanceBadge({ provenance, detail }: { provenance: Provenance; detail?: string }) {
  const label = PROVENANCE_LABELS[provenance];
  const accessibleName = `数据来源：${label}${detail ? `，${detail}` : ""}`;
  return (
    <span className={`${styles.badge} ${styles[provenance]}`} aria-label={accessibleName} title={accessibleName}>
      {label}
      {detail ? <span className={styles.detail}>{detail}</span> : null}
    </span>
  );
}
