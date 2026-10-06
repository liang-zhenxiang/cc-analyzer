import type { ReactNode } from "react";
import styles from "./Panel.module.css";

/**
 * 卡片原语：全站**唯一**一种「面板」画法——一个 `--bg-subtle` 面 + 发丝边框
 * + 无独立底色的表头行。
 *
 * 该用它：结构是「标题 + 可选动作 + 内容体」的卡片（用量页四张卡、Token 计数）。
 * 不该用它的（别把它们当漏网之鱼，它们确实不同构）：
 * - `TreeView` / `LogView`：表格卡片，粘性表头沉到 `--bg-inset`，是「表头」的
 *   另一种约定；
 * - `ReportPanel`：表头是「标题 + 分段控件 + 按钮簇」，塞进 [h2][actions] 会打架；
 * - `RecordDetailPanel`：右栏 `<dl>` 形态，不是标题 + 内容体；
 * - `ThresholdsPanel`：脱离文档流的浮层（`--bg-elevated` + 阴影），属浮层语言。
 */
export function Panel({
  title,
  actions,
  children,
  ariaLabel,
  titleAs = "h2"
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  /** 传入即让 `<section>` 成为有名字的 landmark region（e2e 靠 region + name 定位）。 */
  ariaLabel?: string;
  /** 标题层级：Token 计数等在页面里是 h2 级；放进其它卡片内部的可能是 h3。 */
  titleAs?: "h2" | "h3";
}) {
  const Heading = titleAs;
  return (
    <section className={styles.panel} aria-label={ariaLabel}>
      <header className={styles.header}>
        <Heading>{title}</Heading>
        {actions}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
