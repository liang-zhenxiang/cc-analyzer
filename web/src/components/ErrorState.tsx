import { useState } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import styles from "./ErrorState.module.css";

/**
 * 「出错了」的统一画法，三档尺寸对应三种位置：
 *
 * - `page`：整块主区出错（用量总览、实时监控）——垂直居中，正文限宽
 * - `panel`：面板内部出错——内容自身高度，不撑满
 * - `inline`：窄列里的告警条（会话列表侧栏）——左对齐
 *
 * 尺寸之外不再加变体，理由与 `EmptyState` 相同：早先全应用有三种互不相同的
 * 错误画法，同一次故障在三个页面长得像三个产品。
 *
 * 两条硬规则写在这里，而不是指望每个调用点自觉：
 *
 * 1. `title` / `hint` 是给使用者读的——说清**什么失败了**与**下一步做什么**。
 *    写给维护者的话（异常原文、内部文件名、夹具说明）一律进 `detail`。
 * 2. `detail` **默认不进 DOM**：原始错误串常带 `/Users/...` 这类绝对路径，
 *    而用户路径视同敏感数据。折叠起来仍然在页面源码里，这与「不在页面里」
 *    是两回事——只有用户主动展开「详情」，它才被挂上去。
 */
export function ErrorState({
  title,
  hint,
  detail,
  onRetry,
  size = "panel"
}: {
  title: string;
  hint: string;
  detail?: string;
  onRetry?: () => void;
  size?: "page" | "panel" | "inline";
}) {
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div role="alert" className={`${styles.container} ${styles[size]}`}>
      <strong className={styles.title}>{title}</strong>
      <p className={styles.hint}>{hint}</p>
      {onRetry ? (
        // 走共享 Button：全站按钮只有一个来源（v0.11.0 立此规矩）。
        <Button type="button" variant="primary" onClick={onRetry}>
          <Icon name="refresh" size={14} />
          重试
        </Button>
      ) : null}
      {detail ? (
        <details className={styles.details} open={detailOpen}>
          <summary
            className={styles.summary}
            onClick={(event) => {
              // 受控展开：默认行为由 React 的状态接管。jsdom 不实现
              // summary 的默认激活行为，交给默认行为等于这条路径没有测试。
              event.preventDefault();
              setDetailOpen((open) => !open);
            }}
          >
            详情
          </summary>
          {detailOpen ? <pre className={styles.detail}>{detail}</pre> : null}
        </details>
      ) : null}
    </div>
  );
}