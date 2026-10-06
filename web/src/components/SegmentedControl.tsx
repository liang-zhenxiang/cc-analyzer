import { useRef, type KeyboardEvent, type ReactNode } from "react";
import styles from "./SegmentedControl.module.css";

export type SegmentedItem<T extends string> = {
  value: T;
  /** ReportPanel 需要「节点分析：<label>」这种动态文案，所以是 ReactNode。 */
  label: ReactNode;
  disabled?: boolean;
  /** disabled 时解释原因（如「先在树视图选择一个节点」）。 */
  title?: string;
};

/**
 * 分段控件：凹陷的槽 + 抬起的滑块，六个调用点唯一的一种画法。
 *
 * 一致性以前靠注释维系（「与顶栏同一种画法」），而注释不是约束——它已经漏过一次
 * （用量页两处时间/类别 tab 各自复制了一段逐字相同的 CSS）。抽成一个组件后，
 * 「同一个概念不学两遍」从约定变成编译期事实。
 *
 * 键盘：roving tabindex（Tab 一次进、一次出整组）+ 方向键移动，**自动激活**
 * （选中随焦点走）。这与 macOS 原生分段控件、以及 ARIA APG 对低成本 tablist 的
 * 默认建议一致；六个调用点里五个是纯本地状态，切换成本为零。
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  variant = "default",
  className,
  role = "tablist"
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  variant?: "default" | "wide" | "equal";
  /** 只用于外层定位（如顶栏的 grid 居中），**不得**覆盖控件内部样式。 */
  className?: string;
  /**
   * 控件的语义角色。默认 `"tablist"`——同一容器里的视图切换（顶栏、用量页等六个
   * 旧调用点）用这个；「在一组值里选一个」的场景传 `"radiogroup"`，此时每项是
   * `role="radio"` + `aria-checked`，而不是 `aria-selected`（APG 里的正解）。
   * 两种角色的键盘模型一致（roving tabindex + 方向键自动激活），所以这里只换语义。
   */
  role?: "tablist" | "radiogroup";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 焦点定位要按当前角色取项：radiogroup 里没有 `[role="tab"]`，
  // 写死 tab 会让方向键在 radiogroup 模式下找不到可聚焦项而失灵。
  const itemRole = role === "radiogroup" ? "radio" : "tab";

  function focusAt(index: number) {
    const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
      `[role="${itemRole}"]`
    );
    buttons?.[index]?.focus();
  }

  /** 环绕地走一步，跳过 disabled；全部禁用时留在原地。 */
  function step(from: number, direction: 1 | -1): number {
    const count = items.length;
    let index = from;
    for (let hop = 0; hop < count; hop += 1) {
      index = (index + direction + count) % count;
      if (!items[index].disabled) return index;
    }
    return from;
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = items.findIndex((item) => item.value === value);
    let next: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = step(current, 1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = step(current, -1);
        break;
      case "Home":
        next = items.findIndex((item) => !item.disabled);
        break;
      case "End":
        next = items.reduce((last, item, index) => (item.disabled ? last : index), -1);
        break;
      default:
        return;
    }
    // 命中方向键一律阻止页面滚动。
    event.preventDefault();
    if (next < 0 || next === current) return;
    onChange(items[next].value);
    focusAt(next);
  }

  return (
    <div
      ref={containerRef}
      role={role}
      aria-label={ariaLabel}
      className={[styles.root, styles[variant], className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => {
        // 选中态只走一套属性，二者不同时输出（见 §4.1）。
        const selection =
          role === "radiogroup"
            ? { role: "radio" as const, "aria-checked": item.value === value }
            : { role: "tab" as const, "aria-selected": item.value === value };
        return (
          <button
            key={item.value}
            type="button"
            {...selection}
            disabled={item.disabled}
            title={item.title}
            tabIndex={item.value === value ? 0 : -1}
            className={styles.item}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
