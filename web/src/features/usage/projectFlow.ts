import { formatProjectPath } from "../../lib/format";
import { niceAxisMax } from "./charts/chartPrimitives";
import { labWindow } from "./constellation";
import { usageTokens } from "./projectArena";
import {
  addLocalDays,
  dayStartOf,
  formatDayLabel,
  type UsageSessionInput
} from "./usageAggregations";

/**
 * 项目流量河流图（Issue #388）的纯函数层：分桶、排名、尾部合计、统一刻度、
 * 单调三次曲线与 x 刻度抽稀。组件只拿这里的结果画图，不碰时钟、不做 I/O。
 *
 * 口径（与页面 KPI 同一套）：
 * - 分桶键是 `projectLabel`（编码目录名）；显示名走 `formatProjectPath`。
 *   两个不同目录恰好同名时仍是两条河——合并无关目录会算错账。
 * - 记录按**自己的本地日**落桶，不按会话起点；跨午夜的会话如实拆到两天。
 * - token = 输入 + 输出 + 缓存写入 + 缓存读取四类之和（与页面 KPI 同口径）。
 * - 窗口内总量为 0 的项目不参与排名、不画河道。
 *
 * 日序列一律用 `addLocalDays` 逐日推进，**不能用 `+86_400_000`**：DST 那天
 * 只有 23 或 25 小时，按毫秒加会让后面的日键整体偏移一小时。
 */

export type FlowLane = {
  /** `projectLabel`；尾部合计固定为 `__other__`。 */
  key: string;
  /** `formatProjectPath` 的 basename；尾部为「其他 N 个项目」。 */
  name: string;
  /** 左栏用的短名；尾部为「其他 N 个」。 */
  shortName: string;
  /** 尾部合计（≥2 个项目被合并）。恰好第 7 名的单个项目为 false。 */
  isOther: boolean;
  /** 1–6 的 `--chart-N` 序号；null = 不进色板（尾部，或恰好第 7 名）。 */
  tone: 1 | 2 | 3 | 4 | 5 | 6 | null;
  total: number;
  /** `days` 的下标；并列峰值取**最早**的一天。 */
  peakDay: number;
  peakValue: number;
  /** `values > 0` 的天数。 */
  activeDays: number;
  /** 与 `days` 对齐；0 是真实观测值，不是缺失。 */
  values: number[];
};

export type FlowEmptyReason =
  | "no-sessions"
  | "no-tokens"
  | "single-day"
  | "single-project";

export type ProjectFlow = {
  /** 窗口内每个本地日零点，长度 = 请求的 `days`。 */
  days: number[];
  /** 按窗口总量降序，最多 7 条。 */
  lanes: FlowLane[];
  /** `niceAxisMax(所有绘制河道的单日最大值，含尾部合计)`。 */
  max: number;
  rawMax: number;
  windowTokens: number;
  /** 与 `days` 对齐，用于「占当天」。 */
  dayTotals: number[];
  /** `dayTotals > 0` 的天数。 */
  recordedDays: number;
  /** 窗口内有 token 的项目数（不是河道数）。 */
  projectCount: number;
  emptyReason: FlowEmptyReason | null;
};

// ---------------------------------------------------------------------------
// 几何常量（§1.3）——这是 TS 里的「形」，不是 CSS 间距，不随字号缩放。
// ---------------------------------------------------------------------------

/** 第一条河道顶部到 SVG 顶。 */
export const FLOW_PLOT_TOP = 8;
/** 单条河道高度（峰顶到基线的满格）。 */
export const FLOW_LANE_HEIGHT = 36;
/** 河道间距；几何常量写死 8，对应 `--sp-2`。 */
export const FLOW_LANE_GAP = 8;
/** 一条河道占的纵向步长（含缝）。 */
export const FLOW_LANE_PITCH = FLOW_LANE_HEIGHT + FLOW_LANE_GAP;
/** y 刻度列宽；右对齐于 x=56。 */
export const FLOW_Y_AXIS_WIDTH = 64;
/** 选中竖条 x（2px，居中于河道中线）。 */
export const FLOW_SELECT_BAR_X = 66;
/** 左栏色块 x（8×8）。 */
export const FLOW_SWATCH_X = 72;
/** 项目名起点；右界 184。 */
export const FLOW_NAME_X = 86;
export const FLOW_NAME_RIGHT = 184;
/** 绘图区左边界。 */
export const FLOW_PLOT_LEFT = 192;
/** 右留白（最后一个 x 标签不裁切）。 */
export const FLOW_PLOT_RIGHT = 24;
/** x 标签基线距最后一条基线。 */
export const FLOW_AXIS_LABEL_DY = 14;
/** SVG 底留白。 */
export const FLOW_BOTTOM = 6;
/** x 标签最小水平间距（100% 字号）。 */
export const FLOW_MIN_TICK_GAP = 56;
/** 首帧 / jsdom 的兜底容器宽度。 */
export const FLOW_FALLBACK_WIDTH = 960;
/** 绘图宽下限，避免负宽度。 */
export const FLOW_MIN_PLOT_WIDTH = 120;
/** x 标签占的高度（基线 14 + 文字下缘与底留白 14）。 */
export const FLOW_AXIS_LABEL_ROOM = 28;
/** x 刻度候选步长（天）；取满足密度条件的最小值。 */
export const FLOW_TICK_STEPS: readonly number[] = [1, 2, 3, 7, 14, 30];

/** 第 `index` 条河道的顶部 y（从 0 起）。 */
export function flowLaneTop(index: number): number {
  return FLOW_PLOT_TOP + FLOW_LANE_PITCH * index;
}

/** 第 `index` 条河道的基线 y。 */
export function flowLaneBaseline(index: number): number {
  return FLOW_LANE_PITCH * (index + 1);
}

/** 第 `index` 条河道左栏项目名的文字基线。 */
export function flowNameBaseline(index: number): number {
  return flowLaneTop(index) + 22;
}

/** 第 `index` 条河道 8×8 色块的 y。 */
export function flowSwatchY(index: number): number {
  return flowLaneTop(index) + 14;
}

/** 第 `index` 条河道 2px 选中竖条的 y。 */
export function flowSelectBarY(index: number): number {
  return flowLaneTop(index) + 8;
}

/** y 刻度「满格」标签的 y（只在第一条河上画）。 */
export function flowYMaxLabelY(): number {
  return flowLaneTop(0) + 12;
}

/** y 刻度「0」标签的 y（只在第一条河上画）。 */
export function flowYZeroLabelY(): number {
  return flowLaneBaseline(0) - 4;
}

/** x 标签基线的 y：最后一条基线 + 14。 */
export function flowXLabelBaselineY(laneCount: number): number {
  return FLOW_LANE_PITCH * Math.max(0, laneCount) + FLOW_AXIS_LABEL_DY;
}

/**
 * 指针 x → 最近的日 band 下标（§4.1）：`floor((x - PLOT_LEFT) / slot)`，
 * clamp 到 `[0, dayCount - 1]`。日序而不是时间戳，DST 不影响命中。
 */
export function flowDayAtX(x: number, slot: number, dayCount: number): number {
  if (!(slot > 0) || dayCount <= 0) return 0;
  return Math.min(
    dayCount - 1,
    Math.max(0, Math.floor((x - FLOW_PLOT_LEFT) / slot))
  );
}

/** 河道数决定图高：`44 × rows + 28`（7 行 = 336）。 */
export function flowChartHeight(laneCount: number): number {
  return FLOW_LANE_PITCH * Math.max(0, laneCount) + FLOW_AXIS_LABEL_ROOM;
}

/** 实测容器宽 → 绘图宽；首帧 / 零宽走兜底，并做 120px 下限保护。 */
export function flowPlotWidth(containerWidth: number): number {
  const width =
    Number.isFinite(containerWidth) && containerWidth > 0
      ? containerWidth
      : FLOW_FALLBACK_WIDTH;
  return Math.max(FLOW_MIN_PLOT_WIDTH, width - FLOW_PLOT_LEFT - FLOW_PLOT_RIGHT);
}

/** 每天占的宽度；按本地日序等分，不按毫秒。 */
export function flowSlot(plotWidth: number, dayCount: number): number {
  return plotWidth / Math.max(1, dayCount);
}

/** 第 `index` 天 band 的中心（首末各留半个槽，河道不贴边框）。 */
export function flowX(index: number, slot: number, x0: number = FLOW_PLOT_LEFT): number {
  return x0 + (index + 0.5) * slot;
}

/** 值 → y；统一刻度，最后 clamp 到 `[laneTop, baseline]`。 */
export function flowY(
  value: number,
  max: number,
  laneTop: number,
  baseline: number
): number {
  const scale = max > 0 ? FLOW_LANE_HEIGHT / max : 0;
  const raw = baseline - Math.max(0, value) * scale;
  return Math.min(baseline, Math.max(laneTop, raw));
}

// ---------------------------------------------------------------------------
// 单调三次 Hermite（Fritsch–Carlson）
// ---------------------------------------------------------------------------

/**
 * 每天一个切线（值/天），用 Fritsch–Carlson 限幅：
 * - 局部极值（相邻斜率异号或为 0）处切线归零；
 * - 其余点取相邻斜率的算术平均，再按 `α² + β² ≤ 9` 收紧。
 *
 * 这保证任意一段曲线都落在两端点之间——「高—0—高」不会在 0 两侧画出负面积，
 * 尖峰也不会被拉得比真实值更高。
 */
export function monotoneTangents(values: readonly number[]): number[] {
  const points = values.map((value) =>
    Number.isFinite(value) ? Math.max(0, value) : 0
  );
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  const secants: number[] = [];
  for (let i = 0; i < n - 1; i += 1) secants.push(points[i + 1] - points[i]);

  const tangents = new Array<number>(n).fill(0);
  tangents[0] = secants[0];
  tangents[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    const before = secants[i - 1];
    const after = secants[i];
    if (before * after <= 0) {
      tangents[i] = 0;
    } else {
      tangents[i] = (before + after) / 2;
    }
  }

  for (let i = 0; i < n - 1; i += 1) {
    const secant = secants[i];
    if (secant === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = tangents[i] / secant;
    const beta = tangents[i + 1] / secant;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const tau = 3 / Math.sqrt(magnitude);
      tangents[i] = tau * alpha * secant;
      tangents[i + 1] = tau * beta * secant;
    }
  }

  return tangents;
}

/**
 * 一段曲线：两端点 + 端点的 y 切线（`dy/dt`，整段 t∈[0,1]）。
 * 路径与控制点、测试采样共用同一个结构，避免「画的和验的不是一条线」。
 */
export type FlowCurveSegment = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  m0: number;
  m1: number;
};

/** 在一段曲线上取 t（0..1）处的点；端点就是真实的日点读数。 */
export function sampleFlowSegment(
  segment: FlowCurveSegment,
  t: number
): { x: number; y: number } {
  const u = Math.min(1, Math.max(0, t));
  const u2 = u * u;
  const u3 = u2 * u;
  const y =
    (2 * u3 - 3 * u2 + 1) * segment.y0 +
    (u3 - 2 * u2 + u) * segment.m0 +
    (-2 * u3 + 3 * u2) * segment.y1 +
    (u3 - u2) * segment.m1;
  return { x: segment.x0 + (segment.x1 - segment.x0) * u, y };
}

export type FlowLanePaths = {
  /** 顶边曲线：只画上沿，`fill: none`。 */
  line: string;
  /** 面积路径：上沿 → 最后一天落到基线 → 回到第一天 → 闭合。 */
  area: string;
  /** 逐日曲线段，供悬停取点与测试采样。 */
  segments: FlowCurveSegment[];
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * 生成一条河的顶边与面积路径。
 *
 * `slot` 是每天占的宽度。控制点与采样点都经过 `[laneTop, baseline]` 的
 * clamp——clamp 不是插值策略，只是浮点误差的最后一道保险。
 */
export function buildLanePaths(
  values: readonly number[],
  options: {
    laneTop: number;
    baseline: number;
    max: number;
    slot: number;
    x0?: number;
  }
): FlowLanePaths {
  const { laneTop, baseline, max, slot } = options;
  const x0 = options.x0 ?? FLOW_PLOT_LEFT;
  const count = values.length;
  if (count === 0 || !(slot > 0)) return { line: "", area: "", segments: [] };

  const points = values.map((value, index) => ({
    x: flowX(index, slot, x0),
    y: flowY(value, max, laneTop, baseline)
  }));

  const clampY = (y: number) => Math.min(baseline, Math.max(laneTop, y));

  if (count === 1) {
    const point = points[0];
    return {
      line: `M${round(point.x)},${round(point.y)}`,
      area: `M${round(point.x)},${round(baseline)}L${round(point.x)},${round(point.y)}Z`,
      segments: []
    };
  }

  // 切线在「值/天」空间算好，再按 y = baseline - v/max×LANE_H 的斜率换算成
  // y/天。单调性在仿射变换下不变，所以曲线仍落在两端点之间。
  const tangents = monotoneTangents(values);
  const yScale = max > 0 ? -FLOW_LANE_HEIGHT / max : 0;
  const segments: FlowCurveSegment[] = [];
  for (let index = 0; index < count - 1; index += 1) {
    segments.push({
      x0: points[index].x,
      y0: points[index].y,
      x1: points[index + 1].x,
      y1: points[index + 1].y,
      m0: tangents[index] * yScale,
      m1: tangents[index + 1] * yScale
    });
  }

  let line = `M${round(points[0].x)},${round(points[0].y)}`;
  for (const segment of segments) {
    const third = (segment.x1 - segment.x0) / 3;
    const c1x = segment.x0 + third;
    const c1y = clampY(segment.y0 + segment.m0 / 3);
    const c2x = segment.x1 - third;
    const c2y = clampY(segment.y1 - segment.m1 / 3);
    line += `C${round(c1x)},${round(c1y)} ${round(c2x)},${round(c2y)} ${round(segment.x1)},${round(segment.y1)}`;
  }

  const firstX = points[0].x;
  const lastX = points[count - 1].x;
  const area = `${line}L${round(lastX)},${round(baseline)}L${round(firstX)},${round(baseline)}Z`;

  return { line, area, segments };
}

// ---------------------------------------------------------------------------
// x 轴刻度抽稀（§3.5）
// ---------------------------------------------------------------------------

/**
 * 取满足密度条件的最小步长：标签数 ≤ 绘图宽 / (56 × fontScale)，且 ≤ 12。
 * 从最后一天往前锚定，保证右端永远有「今天」附近的日期。
 */
export function flowTickStep(dayCount: number, plotWidth: number, fontScale = 1): number {
  const days = Math.max(1, Math.floor(dayCount));
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const width = Number.isFinite(plotWidth) ? plotWidth : FLOW_MIN_PLOT_WIDTH;
  const capacity = Math.min(
    12,
    Math.max(1, Math.floor(width / (FLOW_MIN_TICK_GAP * scale)))
  );
  for (const step of FLOW_TICK_STEPS) {
    if (Math.ceil(days / step) <= capacity) return step;
  }
  return FLOW_TICK_STEPS[FLOW_TICK_STEPS.length - 1];
}

export type FlowTick = {
  /** `days` 的下标。 */
  index: number;
  dayStart: number;
  /** `formatDayLabel`（`11/3`）。 */
  label: string;
  /** band 中心。 */
  x: number;
};

/** 窗口的 x 标签；最后一天必有一个，其余按步长往前数。 */
export function buildFlowXTicks(
  days: readonly number[],
  plotWidth: number,
  fontScale = 1
): FlowTick[] {
  if (days.length === 0) return [];
  const step = flowTickStep(days.length, plotWidth, fontScale);
  const slot = flowSlot(plotWidth, days.length);
  const indices: number[] = [];
  for (let index = days.length - 1; index >= 0; index -= step) indices.push(index);
  indices.reverse();
  return indices.map((index) => ({
    index,
    dayStart: days[index],
    label: formatDayLabel(days[index]),
    x: flowX(index, slot)
  }));
}

// ---------------------------------------------------------------------------
// 分桶与排名
// ---------------------------------------------------------------------------

type ProjectBucket = {
  key: string;
  name: string;
  /** 是否已经拿到过真实 cwd（决定后续同名项目的 cwd 要不要覆盖显示名）。 */
  hasCwd: boolean;
  values: number[];
  total: number;
};

function summarize(values: number[]): {
  total: number;
  peakDay: number;
  peakValue: number;
  activeDays: number;
} {
  let total = 0;
  let peakDay = 0;
  let peakValue = 0;
  let activeDays = 0;
  values.forEach((value, index) => {
    total += value;
    if (value > 0) activeDays += 1;
    // 严格大于：并列峰值保留最早的一天。
    if (value > peakValue) {
      peakValue = value;
      peakDay = index;
    }
  });
  return { total, peakDay, peakValue, activeDays };
}

function laneFromValues(
  key: string,
  name: string,
  shortName: string,
  isOther: boolean,
  tone: FlowLane["tone"],
  values: number[]
): FlowLane {
  const { total, peakDay, peakValue, activeDays } = summarize(values);
  return {
    key,
    name,
    shortName,
    isOther,
    tone,
    total,
    peakDay,
    peakValue,
    activeDays,
    values
  };
}

const OTHER_LANE_KEY = "__other__";

/**
 * 排名：窗口总量降序 → 显示名字典序 → `projectLabel` 字典序。0 token 项目
 * 在调用前已排除。同一输入必须每次得到同一组颜色，所以排序键全部是数据本身。
 */
function compareProjects(
  a: ProjectBucket,
  b: ProjectBucket
): number {
  return (
    b.total - a.total ||
    a.name.localeCompare(b.name) ||
    a.key.localeCompare(b.key)
  );
}

/**
 * 摘要用「峰值最高的河」：并列时取排名靠前（总量更大）的一条——`lanes` 已按
 * 总量降序，所以严格大于才会替换。
 */
export function flowPeakLane(lanes: readonly FlowLane[]): FlowLane | null {
  let best: FlowLane | null = null;
  for (const lane of lanes) {
    if (!best || lane.peakValue > best.peakValue) best = lane;
  }
  return best;
}

/**
 * 构建河流图的数据模型。`now` 由调用方传入，函数内不读时钟。
 */
export function buildProjectFlow(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): ProjectFlow {
  const { startTs, endTs, windowDays } = labWindow(days, now);

  const dayStarts: number[] = [];
  for (let cursor = startTs; cursor < endTs; cursor = addLocalDays(cursor, 1)) {
    dayStarts.push(cursor);
  }
  // labWindow 已把 days 规整为 ≥1 的整数；正常情况下长度相等，这里兜住
  // 「for 循环因为某种边界少走一天」的意外，保证契约里的长度恒等。
  while (dayStarts.length < windowDays) {
    dayStarts.push(addLocalDays(dayStarts[dayStarts.length - 1], 1));
  }

  const indexOfDay = new Map(dayStarts.map((dayStart, index) => [dayStart, index]));
  const dayTotals = new Array<number>(dayStarts.length).fill(0);
  const buckets = new Map<string, ProjectBucket>();
  let sessionsInWindow = 0;

  for (const input of inputs) {
    const key = input.projectLabel;
    const cwd = input.projectPath ?? input.session?.cwd;
    let present = false;

    for (const record of input.records) {
      if (record.timestamp < startTs || record.timestamp >= endTs) continue;
      present = true;

      const index = indexOfDay.get(dayStartOf(record.timestamp));
      if (index === undefined) continue;

      if (!record.usage) continue;
      const tokens = usageTokens(record.usage);
      if (tokens <= 0) continue;

      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          key,
          name: formatProjectPath(key, cwd),
          hasCwd: Boolean(cwd),
          values: new Array<number>(dayStarts.length).fill(0),
          total: 0
        };
        buckets.set(key, bucket);
      } else if (!bucket.hasCwd && cwd) {
        // 同一项目的多个会话里，只要有一个带来了真实 cwd，用它显示真名。
        bucket.name = formatProjectPath(key, cwd);
        bucket.hasCwd = true;
      }

      bucket.values[index] += tokens;
      bucket.total += tokens;
      dayTotals[index] += tokens;
    }

    if (present) sessionsInWindow += 1;
  }

  const ranked = [...buckets.values()]
    .filter((bucket) => bucket.total > 0)
    .sort(compareProjects);

  const lanes: FlowLane[] = [];
  if (ranked.length > 7) {
    const named = ranked.slice(0, 6);
    named.forEach((bucket, index) => {
      lanes.push(
        laneFromValues(
          bucket.key,
          bucket.name,
          bucket.name,
          false,
          (index + 1) as 1 | 2 | 3 | 4 | 5 | 6,
          bucket.values
        )
      );
    });

    const folded = ranked.slice(6);
    const otherValues = new Array<number>(dayStarts.length).fill(0);
    for (const bucket of folded) {
      bucket.values.forEach((value, index) => {
        otherValues[index] += value;
      });
    }
    lanes.push(
      laneFromValues(
        OTHER_LANE_KEY,
        `其他 ${folded.length} 个项目`,
        `其他 ${folded.length} 个`,
        true,
        null,
        otherValues
      )
    );
  } else {
    ranked.forEach((bucket, index) => {
      lanes.push(
        laneFromValues(
          bucket.key,
          bucket.name,
          bucket.name,
          false,
          // 色板只有六档：第 7 名的单个项目仍是真实项目，但用中性色。
          index < 6 ? ((index + 1) as 1 | 2 | 3 | 4 | 5 | 6) : null,
          bucket.values
        )
      );
    });
  }

  const windowTokens = dayTotals.reduce((sum, value) => sum + value, 0);
  const recordedDays = dayTotals.filter((value) => value > 0).length;
  const projectCount = ranked.length;
  const rawMax = lanes.reduce(
    (max, lane) => lane.values.reduce((inner, value) => Math.max(inner, value), max),
    0
  );

  let emptyReason: FlowEmptyReason | null = null;
  if (sessionsInWindow === 0) emptyReason = "no-sessions";
  else if (windowTokens <= 0) emptyReason = "no-tokens";
  else if (recordedDays < 2) emptyReason = "single-day";
  else if (projectCount < 2) emptyReason = "single-project";

  return {
    days: dayStarts,
    lanes,
    max: niceAxisMax(rawMax),
    rawMax,
    windowTokens,
    dayTotals,
    recordedDays,
    projectCount,
    emptyReason
  };
}
