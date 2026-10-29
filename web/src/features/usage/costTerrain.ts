import { formatUsd } from "../../lib/format";
import type { SessionUsage } from "../sessions/types";
import { WEEKDAY_LABELS } from "./charts/chartPrimitives";
import { labWindow } from "./constellation";
import { estimateCost } from "./pricingSnapshot";
import { levelOfCost } from "./usageCalendar";
import { UNKNOWN_MODEL_LABEL, type UsageSessionInput, type UsageTotals } from "./usageAggregations";

/**
 * 成本地形（F2）：周一至周日 × 24 小时的估算成本矩阵。
 *
 * 口径与页面成本读数一致：逐条 `record.usage` 用该记录的模型走 `estimateCost`
 * （唯一计价口径）；未定价模型的记录**整格不计**，只把那一格标成「含未定价」，
 * 绝不补 0、也不把未知摊到别的格子。一格 = 一个（星期, 小时）组合，可能由
 * 窗口内多个自然日叠加而成。
 *
 * 色阶只用 `--cal-1..4`：这套令牌的语义就是「时间格里的成本强度」，与消耗
 * 日历同一维度。等高线只画相邻格跨过 p50/p80/p95 的边界短线段，不做双线性
 * 插值——插值会在地图上画出日志里不存在的成本。
 */

export const TERRAIN_WIDTH = 720;
export const TERRAIN_HEIGHT = 300;
export const TERRAIN_LEFT = 40;
export const TERRAIN_TOP = 20;
export const TERRAIN_RIGHT = 16;
export const TERRAIN_BOTTOM = 44;
/** 格间缝：卡片面从缝里透出来做分隔（等高线不能糊成一块渐变）。 */
export const TERRAIN_GAP = 2;

const HOURS = 24;
const DAYS = 7;
const PLOT_WIDTH = TERRAIN_WIDTH - TERRAIN_LEFT - TERRAIN_RIGHT;
const PLOT_HEIGHT = TERRAIN_HEIGHT - TERRAIN_TOP - TERRAIN_BOTTOM;
const SLOT_WIDTH = PLOT_WIDTH / HOURS;
const SLOT_HEIGHT = PLOT_HEIGHT / DAYS;
const CELL_WIDTH = SLOT_WIDTH - TERRAIN_GAP;
const CELL_HEIGHT = SLOT_HEIGHT - TERRAIN_GAP;

export type TerrainLevel = 0 | 1 | 2 | 3 | 4;

export type TerrainCell = {
  /** 0 = 周一 … 6 = 周日（与 `WEEKDAY_LABELS` 同序，不是 `getDay()`）。 */
  weekday: number;
  hour: number;
  costUsd: number;
  /** 本格含未定价模型：成本是部分已知，不是 0。 */
  hasUnknown: boolean;
  level: TerrainLevel;
  /** 本格占窗口总成本的比例（0..1；总成本为 0 时是 0，不是 NaN）。 */
  share: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TerrainSegment = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type TerrainContourKey = "p50" | "p80" | "p95";

export type TerrainContour = {
  key: TerrainContourKey;
  value: number;
  segments: TerrainSegment[];
  /** 一段也画不出时为 null；最多 3 个标签（每个阈值一个）。 */
  label: { x: number; y: number; anchor: "start" | "middle" } | null;
};

export type TerrainHourTick = { hour: number; x: number };

export type CostTerrain = {
  /** rows[weekday][hour]，三角形颜色/几何都与 cells 是同一批对象。 */
  rows: TerrainCell[][];
  cells: TerrainCell[];
  contours: TerrainContour[];
  hourTicks: TerrainHourTick[];
  peak: TerrainCell | null;
  totalUsd: number;
  /** 有成本的格数（costUsd > 0）。 */
  pricedCells: number;
  /** 含未定价模型的格数——脚注与摘要里的「N 个小时」。 */
  unknownCells: number;
  quartiles: { q1: number; q2: number; q3: number } | null;
  windowStart: number;
  windowEnd: number;
  windowDays: number;
  windowLabel: string;
  /** `role="img"` 的一句话摘要。 */
  summary: string;
};

export type CostTerrainOptions = {
  /** 小时刻度步长；130% 字号用 6，默认 3。 */
  hourTickStep?: number;
};

function usageTotals(usage: SessionUsage): UsageTotals {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
}

/** Type 7 线性插值分位（与消耗日历的四分位算法一致）。 */
function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = p * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (rank - low) * (sorted[high] - sorted[low]);
}

function crosses(a: number, b: number, threshold: number): boolean {
  return (a < threshold && b >= threshold) || (b < threshold && a >= threshold);
}

export function buildCostTerrain(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  options: CostTerrainOptions = {}
): CostTerrain {
  const { startTs, endTs, windowDays } = labWindow(days, now);

  type Bucket = { costUsd: number; hasUnknown: boolean };
  const buckets: Bucket[][] = Array.from({ length: DAYS }, () =>
    Array.from({ length: HOURS }, () => ({ costUsd: 0, hasUnknown: false }))
  );

  for (const source of inputs) {
    for (const record of source.records) {
      if (record.timestamp < startTs || record.timestamp >= endTs) continue;
      const usage = record.usage;
      if (!usage) continue;
      const at = new Date(record.timestamp);
      const weekday = (at.getDay() + 6) % 7;
      const bucket = buckets[weekday][at.getHours()];
      const estimate = estimateCost(usageTotals(usage), record.model ?? UNKNOWN_MODEL_LABEL);
      if ("unknownModel" in estimate) {
        bucket.hasUnknown = true;
      } else {
        bucket.costUsd += estimate.usd;
      }
    }
  }

  const positive = buckets
    .flat()
    .map((bucket) => bucket.costUsd)
    .filter((cost) => cost > 0)
    .sort((a, b) => a - b);
  const totalUsd = positive.reduce((sum, cost) => sum + cost, 0);
  const quartiles =
    positive.length > 0
      ? {
          q1: quantile(positive, 0.25),
          q2: quantile(positive, 0.5),
          q3: quantile(positive, 0.75)
        }
      : null;

  const rows: TerrainCell[][] = buckets.map((row, weekday) =>
    row.map((bucket, hour) => ({
      weekday,
      hour,
      costUsd: bucket.costUsd,
      hasUnknown: bucket.hasUnknown,
      level: levelOfCost(bucket.costUsd, quartiles),
      share: totalUsd > 0 ? bucket.costUsd / totalUsd : 0,
      x: TERRAIN_LEFT + hour * SLOT_WIDTH + TERRAIN_GAP / 2,
      y: TERRAIN_TOP + weekday * SLOT_HEIGHT + TERRAIN_GAP / 2,
      width: CELL_WIDTH,
      height: CELL_HEIGHT
    }))
  );
  const cells = rows.flat();

  // 等高线：三个分位阈值，只连相邻格跨过阈值的边界中点。值相同时去重
  // （窗口里只有一两个有成本的格时 p50/p80/p95 会相等，三条重叠线没有意义）。
  const thresholds: Array<{ key: TerrainContourKey; value: number }> = [];
  if (positive.length > 0) {
    for (const [key, p] of [
      ["p50", 0.5],
      ["p80", 0.8],
      ["p95", 0.95]
    ] as const) {
      const value = quantile(positive, p);
      if (value <= 0) continue;
      if (thresholds.some((existing) => Math.abs(existing.value - value) < 1e-12)) continue;
      thresholds.push({ key, value });
    }
  }

  const contours: TerrainContour[] = thresholds.map(({ key, value }, contourIndex) => {
    const segments: TerrainSegment[] = [];
    for (let weekday = 0; weekday < DAYS; weekday += 1) {
      for (let hour = 0; hour < HOURS; hour += 1) {
        const cell = rows[weekday][hour];
        if (hour + 1 < HOURS) {
          const right = rows[weekday][hour + 1];
          if (crosses(cell.costUsd, right.costUsd, value)) {
            // 横邻格：边界是竖线，短段在缝的中点上下各伸出 4px。
            const x = TERRAIN_LEFT + (hour + 1) * SLOT_WIDTH;
            const y = TERRAIN_TOP + (weekday + 0.5) * SLOT_HEIGHT;
            segments.push({ id: `${key}:h:${weekday}-${hour}`, x1: x, y1: y - 4, x2: x, y2: y + 4 });
          }
        }
        if (weekday + 1 < DAYS) {
          const below = rows[weekday + 1][hour];
          if (crosses(cell.costUsd, below.costUsd, value)) {
            // 竖邻格：边界是横线，短段在缝的中点左右各伸出 4px。
            const x = TERRAIN_LEFT + (hour + 0.5) * SLOT_WIDTH;
            const y = TERRAIN_TOP + (weekday + 1) * SLOT_HEIGHT;
            segments.push({ id: `${key}:v:${weekday}-${hour}`, x1: x - 4, y1: y, x2: x + 4, y2: y });
          }
        }
      }
    }
    // 三个阈值常常共享同一条边界（两个相邻格之间只有一条缝），所以每个
    // 阈值依次挑不同的一段来标；只剩一段时按序号向下错开，避免三个标签叠字。
    const chosen = segments[Math.min(contourIndex, Math.max(0, segments.length - 1))];
    const stagger = segments.length > 1 ? 0 : contourIndex * 9;
    const label = chosen
      ? chosen.x1 === chosen.x2
        ? {
            x: chosen.x1 + 5,
            y: (chosen.y1 + chosen.y2) / 2 + stagger,
            anchor: "start" as const
          }
        : {
            x: (chosen.x1 + chosen.x2) / 2,
            y: chosen.y1 - 5 - stagger,
            anchor: "middle" as const
          }
      : null;
    return { key, value, segments, label };
  });

  let peak: TerrainCell | null = null;
  for (const cell of cells) {
    if (!peak || cell.costUsd > peak.costUsd) peak = cell;
  }
  if (peak && peak.costUsd <= 0) peak = null;

  const step = Number.isFinite(options.hourTickStep ?? 3)
    ? Math.min(12, Math.max(1, Math.floor(options.hourTickStep ?? 3)))
    : 3;
  const hourTicks: TerrainHourTick[] = [];
  for (let hour = 0; hour < HOURS; hour += step) {
    hourTicks.push({ hour, x: TERRAIN_LEFT + (hour + 0.5) * SLOT_WIDTH });
  }

  const pricedCells = cells.filter((cell) => cell.costUsd > 0).length;
  const unknownCells = cells.filter((cell) => cell.hasUnknown).length;
  const windowLabel = `近 ${windowDays} 天`;

  let summary: string;
  if (!peak) {
    summary = `成本地形：${windowLabel}没有可估算的成本。`;
  } else {
    const gap =
      unknownCells > 0
        ? `${unknownCells} 个小时因未定价模型未计入`
        : "没有未定价模型的小时";
    summary = `成本地形：${windowLabel}估算成本最集中在周${WEEKDAY_LABELS[peak.weekday]} ${peak.hour} 时，约 ${formatUsd(peak.costUsd)}；${gap}。`;
  }

  return {
    rows,
    cells,
    contours,
    hourTicks,
    peak,
    totalUsd,
    pricedCells,
    unknownCells,
    quartiles,
    windowStart: startTs,
    windowEnd: endTs,
    windowDays,
    windowLabel,
    summary
  };
}
