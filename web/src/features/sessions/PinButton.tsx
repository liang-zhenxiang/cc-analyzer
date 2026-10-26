import styles from "./PinButton.module.css";

/**
 * F8 每行的置顶开关：一枚幽灵按钮，钉住后图钉实心并染成强调色。
 *
 * 文案只有动作本身（「置顶会话」/「取消置顶」），状态由 `aria-pressed` 说；
 * 视觉上实心图钉 + `--accent` 是非颜色的第二信号（灰度截图下也分得清）。
 * 焦点环沿用全局 `:focus-visible` 规则——这里只为「被聚焦时不再隐形」补
 * opacity，不新增环几何，因此 focusRing 门禁的计数不变。
 *
 * 按钮在会话行内部，所以点击必须 `stopPropagation`：置顶/取消置顶不能顺带
 * 打开会话。`data-probe="pin-toggle"` 是给真机探针的稳定锚点。
 */
export function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={pinned ? `${styles.pin} ${styles.pinned}` : styles.pin}
      aria-label={pinned ? "取消置顶" : "置顶会话"}
      aria-pressed={pinned}
      data-probe="pin-toggle"
      title={pinned ? "取消置顶" : "置顶会话"}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path className={styles.body} d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z" />
        <path className={styles.needle} d="M12 14v7" />
      </svg>
    </button>
  );
}
