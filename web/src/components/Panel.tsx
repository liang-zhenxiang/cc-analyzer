import type { ReactNode } from "react";
import styles from "./Panel.module.css";

export function Panel({
  title,
  actions,
  children
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <h2>{title}</h2>
        {actions}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
