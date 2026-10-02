import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type UIEvent
} from "react";
import styles from "./ScrollArea.module.css";

/** 滑块的最小比例：内容再宽也留得下可抓的一截，不至于细成一根线。 */
const MIN_THUMB_RATIO = 0.08;

/**
 * 滚动容器，底部带一条常驻的横向滚动提示。
 *
 * 原生滚动条在 macOS 上是「覆盖式」的：静止时不占位、不可见。于是内容一旦
 * 横向超出容器被裁到边缘，看上去就像表格坏了——而不是「这里还能向右滚」。
 * 这个容器在真的横向溢出时，于底部渲染一条占据布局空间的细滚动条（非覆盖式、
 * 静止可见），不溢出时什么都不渲染；纵向滚动仍交给原生滚动条。
 */
export function ScrollArea({
  scrollerRef,
  className,
  onScroll,
  children
}: {
  /** 调用方自己的滚动容器 ref（虚拟化需要读 scrollTop / 主动设置它）。 */
  scrollerRef?: RefObject<HTMLDivElement>;
  /** 追加到滚动元素上的类（滚动容器自己的样式）。 */
  className?: string;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = scrollerRef ?? ownRef;
  const [hint, setHint] = useState<{ left: number; width: number } | null>(null);

  const sync = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const overflow = element.scrollWidth - element.clientWidth;
    if (overflow <= 1) {
      // 只在状态真的变化时 setState，避免「每次渲染都写 state」引发的循环。
      setHint((prev) => (prev === null ? prev : null));
      return;
    }
    const ratio = Math.min(1, element.clientWidth / element.scrollWidth);
    const width = Math.max(ratio, MIN_THUMB_RATIO) * element.clientWidth;
    const maxLeft = Math.max(0, element.clientWidth - width);
    const left = Math.max(0, Math.min(maxLeft, (element.scrollLeft / overflow) * maxLeft));
    setHint((prev) =>
      prev && Math.abs(prev.left - left) < 0.5 && Math.abs(prev.width - width) < 0.5
        ? prev
        : { left, width }
    );
  }, [ref]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    sync();
    // 同时观察容器与内容：容器保持自身尺寸时，行数 / 列宽的变化只体现在内容
    // 的盒子上。**刻意不用「每次渲染后同步一次」**——那样的 setState-in-render
    // 会踩 React 的更新深度上限（error #185），尤其在详情面板开合这种布局跳变时。
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    const content = element.firstElementChild;
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [ref, sync]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      sync();
      onScroll?.(event);
    },
    [sync, onScroll]
  );

  return (
    <div className={styles.wrap}>
      <div
        ref={ref}
        className={[styles.scroller, className].filter(Boolean).join(" ")}
        onScroll={handleScroll}
      >
        {children}
      </div>
      {hint ? (
        // 纯视觉提示：滚动容器本身已可到达，屏幕阅读器不需要再听一条滚动条。
        <div className={styles.track} data-scroll-hint aria-hidden="true">
          <div className={styles.thumb} style={{ left: hint.left, width: hint.width }} />
        </div>
      ) : null}
    </div>
  );
}
