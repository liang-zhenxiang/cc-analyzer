import { useState } from "react";
import { EQUIVALENTS, equivalentsFor } from "./tokenEquivalents";
import styles from "./EquivalentsToggle.module.css";

/**
 * 「换算成日常事物」（D10）：KPI 脚注尾巴上的折叠区。
 *
 * 四条换算全部来自模型层（含每条的依据），这一层只负责「展开/收起」与排版；
 * 数值为 0 时也照列「不足 1 杯咖啡」——空着会被读成「没有这项」。
 */
export function EquivalentsToggle({ tokens }: { tokens: number }) {
  const [open, setOpen] = useState(false);
  const rows = equivalentsFor(tokens);
  const disabled = !(tokens > 0);

  return (
    <span className={styles.wrap}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls="kpi-equivalents"
        disabled={disabled}
        title={disabled ? "本窗口没有 token 可换算" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        换算成日常事物 <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && !disabled ? (
        <ul id="kpi-equivalents" className={styles.list} data-probe="equivalents">
          {rows.map((row) => (
            <li className={styles.row} key={row.id}>
              <span className={styles.count}>{row.count < 1 ? "不足 1" : row.formatted}</span>{" "}
              <span className={styles.body}>
                <span className={styles.label}>{row.label}</span>
                <span className={styles.note}>
                  {EQUIVALENTS.find((seed) => seed.id === row.id)?.note ?? ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </span>
  );
}
