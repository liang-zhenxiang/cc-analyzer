import iconUrl from "../../../src-tauri/icons/icon.png";
import styles from "./BrandMark.module.css";

/**
 * 品牌标记：直接复用应用图标，不新增图片资产。
 *
 * 做成组件而不是把 import 抄两遍——顶栏和空状态要显示的是同一个标记，
 * 资产路径散在两处就会有一天只改了一处。
 */
export function BrandMark({ size, className }: { size: number; className?: string }) {
  return (
    <img
      className={[styles.mark, className].filter(Boolean).join(" ")}
      src={iconUrl}
      width={size}
      height={size}
      // 标记只是装饰，旁边的字标已经说明了这是什么。
      alt=""
      aria-hidden="true"
    />
  );
}
