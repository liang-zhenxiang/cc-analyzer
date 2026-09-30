import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import styles from "./EmptyState.module.css";

/**
 * 「这里没有东西」的统一画法，三档尺寸：
 *
 * - `page`：整块主区空着时用（品牌标记 + 20px 主文案 + 具体指引）
 * - `panel`：面板内部空着时用
 * - `inline`：表格体或行内的一行提示
 *
 * 尺寸之外不要再加变体——早先全应用有 7 种各不相同的空状态画法，
 * 用户每次都要重新认一遍「这是空的还是在加载」。
 */
export function EmptyState({
  title,
  description,
  action,
  size = "panel"
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  size?: "page" | "panel" | "inline";
}) {
  if (size === "inline") {
    return <p className={styles.inline}>{title}</p>;
  }

  return (
    <div className={`${styles.container} ${styles[size]}`}>
      {size === "page" ? (
        <BrandMark size={32} className={styles.brand} />
      ) : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}
