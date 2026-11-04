import { DEMO_EXIT_EVENT } from "./demoMode";
import styles from "./DemoBadge.module.css";

/**
 * 演示模式的常驻徽章。
 *
 * 为什么必须**持续可见**而不是一个可关掉的提示：演示数据看起来跟真实读数
 * 一模一样，用户一旦截屏或走开再回来，就需要一个不依赖记忆的标记告诉他
 * 「这些数字不是你」。同一行里给出出口，避免「进来了不知道怎么出去」。
 */
export function DemoBadge() {
  return (
    <div className={styles.badge} data-probe="demo-badge">
      <span className={styles.text} role="status" aria-live="polite">
        演示数据 · 不会读取你的会话
      </span>
      <button
        type="button"
        className={styles.exit}
        data-probe="demo-exit"
        onClick={() => window.dispatchEvent(new Event(DEMO_EXIT_EVENT))}
      >
        退出演示
      </button>
    </div>
  );
}
