import { Skeleton } from "../components/Skeleton";
import styles from "./RouteFallback.module.css";

/**
 * 路由级懒加载的占位。
 *
 * 形状对齐三个主页面共有的骨架：一行页头控件 + 一列内容。`min-height: 100%`
 * 让占位撑满 `.content`，否则首屏没有滚动条、页面到达时突然冒出来，滚动条
 * 会横向挪动一次布局。
 *
 * `list` 用于会话分析 / 实时监控（列表与卡片），`table` 用于用量总览
 * （面板通栏）。两者都复用 Skeleton 唯一的画法，不另造第二套加载态。
 */
export function RouteFallback({ variant }: { variant: "list" | "table" }) {
  return (
    <div className={styles.page} data-probe-pending>
      <div className={styles.header} aria-hidden="true">
        <span className={styles.pill} />
        <span className={styles.pill} />
      </div>
      <div className={styles.body}>
        <Skeleton variant={variant} rows={8} label="正在加载页面" />
      </div>
    </div>
  );
}
