/**
 * E1 趋势通道：把「每天多少 token」摊成一条可读的趋势，并回答两个问题——
 * 最近在涨还是在跌（最小二乘斜率），以及照这个速度再走 7 天大概落在哪。
 *
 * 口径：
 *   - ma7 是**含当天的前 7 天均值**（trailing window）。窗口不满 7 天
 *     （索引 < 6）给 null：样本不够就不画线，不用 3 天均值冒充 7 天。
 *   - slopePerDay 只对 ma7 的**有效段**做最小二乘；有效点 < 7（即原始数据
 *     < 13 天）给 null——7 个点才够挡住两三天的噪声，少于这个数不硬报斜率。
 *   - direction 的平稳阈值是「日均值 × 2%」：斜率相对数据本身太小时，
 *     报「上升」只是在描述抖动。日均值为 0 时阈值也是 0，此时只能靠斜率
 *     是否为 0 判断平稳。
 *   - forecast7 从最后一个有效 ma7 按斜率线性外推 7 天，**负数 clamp 到 0**
 *     （token 不会为负）；没有斜率时 7 个值全为 null，但日期照常给出——
 *     「不知道值」和「不知道哪天」是两件事。
 *   - 日期按 `YYYY-MM-DD` 解析（UTC 日号，避开本地时区与夏令时）；解析不了
 *     的日期在预测里退化为 `${原日期}+${n}`，不 throw。
 */

export type TrendDirection = "上升" | "下降" | "平稳" | "样本不足";

/** 趋势通道的输入行：日期标签 + 当天 token 总量（调用方负责补零成连续的天）。 */
export type TrendDay = {
  date: string;
  tokens: number;
};

export type ForecastPoint = {
  date: string;
  /** 外推值；斜率为 null 时为 null（不知道，而不是 0）。 */
  value: number | null;
};

export type TrendChannel = {
  /** 与输入等长；前 6 个为 null。 */
  ma7: Array<number | null>;
  /** 每个数据点的斜率；有效点 < 7 时为 null。 */
  slopePerDay: number | null;
  /** 从最后一天往后 7 天；输入为空时为 []。 */
  forecast7: ForecastPoint[];
  direction: TrendDirection;
};

/** 移动平均窗口（天）。 */
export const MA_WINDOW = 7;
/** 平稳判定：|斜率| < 日均值 × 该比例。 */
export const FLAT_THRESHOLD_RATIO = 0.02;

const DAY_MS = 86_400_000;
const DATE_LABEL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` → UTC 日序号；非法/不存在的日期返回 null（不做自动进位）。 */
function dayNumberOf(label: string): number | null {
  const match = DATE_LABEL.exec(label);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(timestamp)) return null;
  const check = new Date(timestamp);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp / DAY_MS;
}

function labelOfDayNumber(day: number): string {
  const date = new Date(day * DAY_MS);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dateOfMonth = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${dateOfMonth}`;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * 最小二乘斜率。x 用数据点下标（daily 已按天补齐，等距）。
 * 调用方保证 points.length >= 2。
 */
function leastSquaresSlope(points: ReadonlyArray<readonly [number, number]>): number {
  const xMean = mean(points.map(([x]) => x));
  const yMean = mean(points.map(([, y]) => y));
  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of points) {
    numerator += (x - xMean) * (y - yMean);
    denominator += (x - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * 构建趋势通道。纯函数：不读时钟、不读写 localStorage，输入即全部。
 *
 * `tokens` 非有限值的条目视为**无法读数**：它不参与 ma7（该窗口为 null），
 * 也不会让斜率悄悄按 0 计算。
 */
export function buildTrendChannel(daily: readonly TrendDay[]): TrendChannel {
  const tokens: Array<number | null> = daily.map((point) =>
    Number.isFinite(point.tokens) ? point.tokens : null
  );

  const ma7: Array<number | null> = tokens.map((_, index) => {
    if (index < MA_WINDOW - 1) return null;
    const window = tokens.slice(index - MA_WINDOW + 1, index + 1);
    if (window.some((value) => value === null)) return null;
    return mean(window as number[]);
  });

  const valid = ma7
    .map((value, index) => ({ index, value }))
    .filter((entry): entry is { index: number; value: number } => entry.value !== null);

  const slopePerDay =
    valid.length >= MA_WINDOW
      ? leastSquaresSlope(valid.map((entry) => [entry.index, entry.value] as const))
      : null;

  const finiteTokens = tokens.filter((value): value is number => value !== null);
  const dailyMean = finiteTokens.length > 0 ? mean(finiteTokens) : 0;
  const flatThreshold = dailyMean * FLAT_THRESHOLD_RATIO;

  let direction: TrendDirection;
  if (slopePerDay === null) {
    direction = "样本不足";
  } else if (slopePerDay === 0 || Math.abs(slopePerDay) < flatThreshold) {
    direction = "平稳";
  } else {
    direction = slopePerDay > 0 ? "上升" : "下降";
  }

  const last = daily[daily.length - 1];
  const anchor = valid[valid.length - 1];
  const forecast7: ForecastPoint[] = [];
  if (last) {
    const lastDay = dayNumberOf(last.date);
    for (let offset = 1; offset <= 7; offset += 1) {
      const date =
        lastDay === null
          ? `${last.date}+${offset}`
          : labelOfDayNumber(lastDay + offset);
      const value =
        anchor && slopePerDay !== null
          ? Math.max(0, anchor.value + slopePerDay * offset)
          : null;
      forecast7.push({ date, value });
    }
  }

  return { ma7, slopePerDay, forecast7, direction };
}
