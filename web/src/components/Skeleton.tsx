import styles from "./Skeleton.module.css";

type WidthTier = "short" | "mid" | "wide" | "value";
type HeightTier = "xs" | "sm" | "base" | "md";

const WIDTH_CLASS: Record<WidthTier, string> = {
  short: styles.short,
  mid: styles.mid,
  wide: styles.wide,
  value: styles.value
};

// "md" 空串：.bar 的默认高度就是 --lh-md，读数位用它。
const HEIGHT_CLASS: Record<HeightTier, string> = {
  xs: styles.heightXs,
  sm: styles.heightSm,
  base: styles.heightBase,
  md: ""
};

/**
 * 一根灰条。**唯一**的骨架条实现——`SkeletonBar` 与 `Skeleton` 都复用它，
 * 免得「同一个加载态」长出第二套画法。`aria-hidden`：形状不必朗读。
 */
function Bar({ width, height }: { width: WidthTier; height: HeightTier }) {
  return (
    <span
      className={[styles.bar, WIDTH_CLASS[width], HEIGHT_CLASS[height]].filter(Boolean).join(" ")}
      aria-hidden="true"
      /* 真机取证用它判断「这个视图还在取数」：取图前若还有 `data-probe-pending`，
         应用会先等到它消失再截图（否则会拍到还没算完的那一帧）。 */
      data-probe-pending
    />
  );
}

/** 单个骨架条，用来替代一个文本读数位（如会话头的「总耗时 …」）。 */
export function SkeletonBar({ width = "mid" }: { width?: WidthTier }) {
  return <Bar width={width} height="md" />;
}

/**
 * 块级骨架：把「正在取数」画成内容的形状。
 *
 * - `list`：会话列表的剪影，每行一条标题位 + 一条元信息位。
 * - `table`：数据表的剪影，每行一条通栏条。
 *
 * 容器是 `role="status"`（屏幕阅读器读到 `label`），内部的条不朗读。
 */
export function Skeleton({
  variant,
  rows,
  label
}: {
  variant: "list" | "table";
  rows: number;
  label: string;
}) {
  return (
    <div role="status" aria-label={label} data-probe-pending>
      {Array.from({ length: rows }, (_, index) =>
        variant === "list" ? (
          <div key={index} className={styles.listRow}>
            <Bar width="mid" height="base" />
            <Bar width="short" height="xs" />
          </div>
        ) : (
          <div key={index} className={styles.tableRow}>
            <Bar width="wide" height="sm" />
          </div>
        )
      )}
    </div>
  );
}
