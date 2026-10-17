import { Button } from "../../components/Button";
import { Icon } from "../../components/Icon";
import styles from "./PulsePage.module.css";

/**
 * 浮窗态下替换整条顶栏的细头（design-round-w §7.3）。
 *
 * 这是无边框窗口里**唯一**一条拖动通道，所以 `data-tauri-drag-region`
 * 必须写成 `"deep"`——Tauri 2.12 的裸属性是 self-only 语义，只有 `"deep"`
 * 才让子元素（把手、标题）上的点击冒泡成拖动（§13 修正一）。退出按钮是
 * `<button>`，天然不被拖动脚本接管，所以点得动。
 */
export function PulseFloatHeader({ onExit }: { onExit: () => void }) {
  return (
    <header
      className={styles.floatHead}
      data-probe="pulse-float-head"
      data-tauri-drag-region="deep"
    >
      <span className={styles.floatGrip} aria-hidden="true" />
      <span className={styles.floatTitle}>实时脉搏</span>
      <Button
        type="button"
        variant="secondary"
        className={styles.floatExit}
        data-probe="pulse-float-exit"
        onClick={onExit}
      >
        <Icon name="close" size={14} />
        退出浮窗
      </Button>
    </header>
  );
}
