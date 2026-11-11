import { ACCENT_PRESETS, type AccentId } from "./accent";
import styles from "./AccentPicker.module.css";

/**
 * 强调色选择器：六个圆形色块 + 名称。
 *
 * 每个选项是**原生 `<button>`**，键盘的 Tab / Enter / Space 由浏览器负责——
 * 这里不手写 `onKeyDown`，因为原生按钮已经会把这些键翻译成 click，再补一份
 * 反而会让一次按键触发两遍。选中态只写 `aria-pressed`，样式从属性选择器来：
 * 视觉状态与可访问状态同源，不会出现「看起来选中、读屏说未选中」。
 *
 * 色块本身是装饰（`aria-hidden`）：填色是给眼睛的速览，可访问名由名称承担，
 * 否则读屏会念出一串十六进制。
 */
export function AccentPicker({
  value,
  onChange
}: {
  value: AccentId;
  onChange: (id: AccentId) => void;
}) {
  return (
    <div role="group" aria-label="强调色" className={styles.group}>
      {ACCENT_PRESETS.map((preset) => {
        const selected = preset.id === value;
        return (
          <button
            key={preset.id}
            type="button"
            className={styles.option}
            aria-pressed={selected}
            onClick={() => onChange(preset.id)}
          >
            <span
              className={styles.swatch}
              style={{ background: preset.swatch }}
              aria-hidden="true"
            />
            <span className={styles.name}>{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
