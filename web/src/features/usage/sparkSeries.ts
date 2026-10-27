/**
 * E10 Sparkline：把一串数（通常是每天/每次的 token 量）算成 SVG 折线坐标。
 * 它只做坐标映射，不画、不依赖 DOM——组件层负责 <polyline> 与样式。
 *
 * 口径：
 *   - x 从首点贴左到末点贴右，等距分布；单点时居中（width / 2）。
 *   - y 轴翻转：最大值在上（strokeWidth / 2），最小值在下（height −
 *     strokeWidth / 2）。内缩半个描边宽度，否则线宽会让笔画被 viewBox
 *     裁掉一半——「贴边」看的是描边的外缘，不是圆心。
 *   - max === min（含单点/全等值）时 flat 为 true，所有 y 落在中线
 *     height / 2：一条水平线，而不是除零。
 *   - 空数组返回空 points、min/max 为 0、flat 为 true；min/max 报告的是
 *     **数据**的极值（不因内缩而改变）。
 */

export type SparkPoint = {
  x: number;
  y: number;
};

export type SparkSeries = {
  /** SVG 坐标点，按输入顺序。 */
  points: SparkPoint[];
  /** 数据最小值。 */
  min: number;
  /** 数据最大值。 */
  max: number;
  /** max === min：界面应画中线而不是折线。 */
  flat: boolean;
};

export type SparkOptions = {
  width?: number;
  height?: number;
  strokeWidth?: number;
};

export const DEFAULT_SPARK_WIDTH = 56;
export const DEFAULT_SPARK_HEIGHT = 16;
export const DEFAULT_SPARK_STROKE = 1.5;

/**
 * 计算折线坐标。纯函数：不读 DOM、不读时钟；数值须为有限数
 * （调用方负责把「未知」挡在外面，而不是传 NaN 进来）。
 */
export function sparkSeries(
  values: readonly number[],
  options: SparkOptions = {}
): SparkSeries {
  const width = Number.isFinite(options.width) && options.width! > 0 ? options.width! : DEFAULT_SPARK_WIDTH;
  const height = Number.isFinite(options.height) && options.height! > 0 ? options.height! : DEFAULT_SPARK_HEIGHT;
  const strokeWidth =
    Number.isFinite(options.strokeWidth) && options.strokeWidth! >= 0
      ? options.strokeWidth!
      : DEFAULT_SPARK_STROKE;

  if (values.length === 0) {
    return { points: [], min: 0, max: 0, flat: true };
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const flat = max === min;

  // 内缩半个描边，让线宽不越出 viewBox；宽高不足时退化为 0 内缩。
  const padX = Math.min(strokeWidth / 2, width / 2);
  const padY = Math.min(strokeWidth / 2, height / 2);
  const innerWidth = width - 2 * padX;
  const innerHeight = height - 2 * padY;

  const middleY = height / 2;
  const xAt = (index: number): number =>
    values.length === 1 ? width / 2 : padX + (innerWidth * index) / (values.length - 1);
  const yAt = (value: number): number => {
    if (flat) return middleY;
    const ratio = (value - min) / (max - min);
    return padY + (1 - ratio) * innerHeight;
  };

  const points = values.map((value, index) => ({ x: xAt(index), y: yAt(value) }));

  return { points, min, max, flat };
}
