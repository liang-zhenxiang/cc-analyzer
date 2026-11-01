import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";
import { emptyGuideSteps } from "../features/sessions/emptyGuide";
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
 *
 * H10（Round HH §4.10）：`page` 档新增可选 `guide`——三步引导
 * （选择目录 → 等待扫描 → 打开用量总览），只在「整块没有数据」的
 * 空态用；`panel`/`inline` 档不认这个参数（「这一块没有」与
 * 「你还没开始」是两件事）。状态推进由 emptyGuide 模型层算，
 * 这里只按 done/current/todo 上视觉。
 */
export function EmptyState({
  title,
  description,
  action,
  guide,
  size = "panel"
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /** 三步引导输入（H10）：仅 `page` 档渲染，输入口径见 emptyGuide.ts。 */
  guide?: { hasDirectory: boolean; scanComplete: boolean; sessionCount: number };
  size?: "page" | "panel" | "inline";
}) {
  if (size === "inline") {
    return <p className={styles.inline}>{title}</p>;
  }

  // 引导只在 page 档存在；其余档位传了也不渲染（防误用）。
  const guideSteps = size === "page" && guide ? emptyGuideSteps(guide).steps : null;

  return (
    <div className={`${styles.container} ${styles[size]}`}>
      {size === "page" ? (
        <BrandMark size={32} className={styles.brand} />
      ) : null}
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {guideSteps ? (
        <ol className={styles.steps} data-probe="empty-steps">
          {guideSteps.map((step, index) => (
            <li
              key={step.id}
              className={styles[`step-${step.state}`] as string | undefined}
              data-probe="guide-step"
              data-step-index={index + 1}
              data-state={step.state}
            >
              {/* done 打勾、current 高亮序号、todo 弱化——三态视觉由 CSS 承担。 */}
              <span className={styles.stepMark} aria-hidden="true">
                {step.state === "done" ? "✓" : index + 1}
              </span>
              <span className={styles.stepText}>
                <span className={styles.stepTitle}>{step.title}</span>
                <span className={styles.stepDetail}>{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {action}
    </div>
  );
}
