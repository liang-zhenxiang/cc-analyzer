import { formatProjectPath } from "../../lib/format";
import { sessionTitle, type SessionMeta } from "../sessions/metadataCache";
import type { SessionUsage } from "../sessions/types";
import { labWindow } from "./constellation";
import { estimateCost } from "./pricingSnapshot";
import {
  totalsSum,
  UNKNOWN_MODEL_LABEL,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 成本树图（Issue #359）的纯逻辑层：布局算法 + 数据聚合。只算数、不碰 DOM，
 * 界面（SVG、悬浮层、键盘/读屏等价表）由 `CostTreemapPanel` 负责。
 *
 * 面积口径与页面其它成本读数一致：逐会话、逐模型走 `pricingSnapshot.estimateCost`
 * ——全项目唯一计价口径，不拿「平均模型价」折算。
 */

// ---------------------------------------------------------------------------
// 布局
// ---------------------------------------------------------------------------

export type TreemapInput = { key: string; value: number };

export type TreemapRect = { key: string; x: number; y: number; w: number; h: number };

/**
 * Squarified treemap（Bruls/Huizing/van Wijk）：每一步往当前行里加元素，直到
 * 宽高比变差为止，再把整行铺在剩余矩形较短的一边上。与「slice-and-dice」
 * 相比，它刻意牺牲一点顺序感来换接近正方形的矩形——树图里细长的条几乎无法
 * 阅读，也无法放标签，这正是本函数存在的理由。
 *
 * 边界决定：
 * - **值 ≤ 0 或非有限值的元素被过滤掉**，不返回矩形。树图的面积不能为负；
 *   把它们当 0 面积矩形返回，只会给界面留下一批「不可见但仍要参与标签/焦点」
 *   的节点。调用方需要计数时应在调用前自行过滤（聚合层会给出排除数）。
 * - 过滤后若没有正面积元素，或 `width`/`height` 不为正（含 NaN/Infinity），
 *   返回空数组——没有画布就没有布局。
 * - 剩余元素**总是填满整块画布**：面积按 `value / Σvalue` 精确分割，行末与
 *   最后一行直接吃到边界，避免浮点误差留下发丝缝。
 *
 * 返回顺序是面积降序（布局顺序），不是入参顺序；调用方用 `key` 关联回原数据。
 */
export function layoutTreemap(
  items: readonly TreemapInput[],
  width: number,
  height: number
): TreemapRect[] {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [];
  }

  const usable = items.filter((item) => Number.isFinite(item.value) && item.value > 0);
  if (usable.length === 0) return [];

  const totalValue = usable.reduce((sum, item) => sum + item.value, 0);
  if (!(totalValue > 0)) return [];

  // 降序是 squarified 的前提：先铺大块，小块才有机会被塞进合适的行。
  // 并列时按键排序，保证同一输入每次得到同一布局（快照测试/重渲染稳定）。
  const sorted = [...usable].sort(
    (a, b) => b.value - a.value || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
  const areaPerValue = (width * height) / totalValue;

  const rects: TreemapRect[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let index = 0;

  while (index < sorted.length) {
    const shortSide = Math.min(w, h);
    let end = index + 1;
    let rowSum = sorted[index].value * areaPerValue;
    let rowMin = rowSum;
    let rowMax = rowSum;
    let worst = worstAspect(rowMin, rowMax, rowSum, shortSide);

    // 贪心加行：只要新元素让整行的最差宽高比不变差，就继续加。
    while (end < sorted.length) {
      const area = sorted[end].value * areaPerValue;
      const nextSum = rowSum + area;
      const nextMin = Math.min(rowMin, area);
      const nextMax = Math.max(rowMax, area);
      const nextWorst = worstAspect(nextMin, nextMax, nextSum, shortSide);
      if (nextWorst > worst) break;
      rowSum = nextSum;
      rowMin = nextMin;
      rowMax = nextMax;
      worst = nextWorst;
      end += 1;
    }

    const lastRow = end === sorted.length;

    if (w >= h) {
      // 剩余区域偏宽：在左侧立一列，沿高度堆叠。
      const thickness = lastRow ? w : Math.min(w, rowSum / h);
      let cursor = y;
      for (let k = index; k < end; k += 1) {
        const area = sorted[k].value * areaPerValue;
        const size =
          k === end - 1
            ? Math.max(0, y + h - cursor)
            : Math.min(h, area / thickness);
        rects.push({ key: sorted[k].key, x, y: cursor, w: thickness, h: size });
        cursor = Math.min(y + h, cursor + size);
      }
      x += thickness;
      w = Math.max(0, w - thickness);
    } else {
      // 剩余区域偏高：在顶部铺一行，沿宽度排列。
      const thickness = lastRow ? h : Math.min(h, rowSum / w);
      let cursor = x;
      for (let k = index; k < end; k += 1) {
        const area = sorted[k].value * areaPerValue;
        const size =
          k === end - 1
            ? Math.max(0, x + w - cursor)
            : Math.min(w, area / thickness);
        rects.push({ key: sorted[k].key, x: cursor, y, w: size, h: thickness });
        cursor = Math.min(x + w, cursor + size);
      }
      y += thickness;
      h = Math.max(0, h - thickness);
    }

    index = end;
  }

  return rects;
}

/**
 * 一行元素在长度 `side` 的短边上的最差宽高比（≥ 1）。行面积为 `sum`，
 * 最宽/最窄元素面积为 `max`/`min`——标准 squarified 的停止判据。
 */
function worstAspect(min: number, max: number, sum: number, side: number): number {
  if (!(sum > 0) || !(min > 0) || !(side > 0)) return Number.POSITIVE_INFINITY;
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * max) / sum2, sum2 / (side2 * min));
}

// ---------------------------------------------------------------------------
// 数据聚合
// ---------------------------------------------------------------------------

export type TreemapMode = "cost" | "token";

export type TreemapSession = {
  id: string;
  title: string;
  /** 当前模式下的面积值：`cost` 模式是美元，`token` 模式是四类 token 之和。 */
  value: number;
  /** 该会话的估算成本；含未定价模型时为 `null`（不是部分求和）。 */
  usd: number | null;
  /** 窗口内 token 最多的模型 id；没有带模型 id 的用量时为 `null`。 */
  model: string | null;
};

export type TreemapProject = {
  /** 显示名：`cwd` 的 basename（缺失时退回项目 label）。不是分组键。 */
  project: string;
  value: number;
  sessions: TreemapSession[];
};

export type CostTreemap = {
  projects: TreemapProject[];
  /** `cost` 模式下因使用未收录定价模型而被排除的会话数，供脚注使用。 */
  excludedUnpriced: number;
  /** 树图实际包含的面积总和（与 `projects` 的 value 之和相等）。 */
  total: number;
};

function totalsOf(usage: SessionUsage): UsageTotals {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
}

function addTotals(target: UsageTotals, source: UsageTotals): void {
  target.input += source.input;
  target.output += source.output;
  target.cacheCreation += source.cacheCreation;
  target.cacheRead += source.cacheRead;
}

/**
 * 把一个会话的价格算成「有 / 无」两态，而不是部分和。
 *
 * 沿用项目卡的立场：只要窗口内有一条用量记录使用的是未收录定价的模型，
 * 整个会话的美元值就是 `null`（「定价未知」）。部分求和看起来像完整读数，
 * 实际上是悄悄缩水的数字——树图的面积会因此给出错误的占比，比空着更糟。
 */
function priceSession(
  byModel: ReadonlyMap<string, UsageTotals>
): { usd: number | null; unpriced: boolean } {
  let usd = 0;
  let unpriced = false;
  for (const [model, totals] of byModel) {
    const estimate = estimateCost(totals, model);
    if ("unknownModel" in estimate) unpriced = true;
    else usd += estimate.usd;
  }
  return { usd: unpriced ? null : usd, unpriced };
}

/**
 * 项目 → 会话的两级成本树图数据。
 *
 * 窗口口径与其它面板相同：`labWindow`（本地自然日、含今天、只看落在窗口里的
 * 记录）。会话只有在窗口内存在带用量的记录时才可能进入树图——窗口外的记录
 * 既不贡献 token 也不贡献成本。
 *
 * 边界决定：
 * - `cost` 模式**只含已定价会话**；含未定价模型的会话整条排除并计入
 *   `excludedUnpriced`（脚注「N 个会话未计入」），绝不用 token 折算成钱。
 *   只有 token 为零的未定价会话不计入该数：它本来就没有面积，排除它的原因
 *   不是定价。
 * - `token` 模式全部计入，未定价会话仍然给出（此时 `usd === null`）。
 * - **值为 0 的会话被丢弃**（token 模式无用量、cost 模式金额为 0）。零面积
 *   矩形在树图里不可见却仍会被界面拿去排版/挂焦点，返回它只会制造幽灵节点；
 *   聚合层直接不返回，`total` 也不会因此改变（它们本来就贡献 0）。
 * - **分组键是 `projectLabel`（编码目录名），显示名用 `cwd` 的 basename**。
 *   两个不同目录恰好同名时仍然是两个项目——把无关目录的钱合并会算错账；
 *   读者看到同名项目时，tooltip 里的会话标题仍能区分。
 */
export function buildCostTreemap(
  inputs: readonly UsageSessionInput[],
  mode: TreemapMode,
  days: number,
  now: number
): CostTreemap {
  const { startTs, endTs } = labWindow(days, now);

  const byLabel = new Map<
    string,
    { name: string; label: string; value: number; sessions: TreemapSession[] }
  >();
  let excludedUnpriced = 0;

  inputs.forEach((source, index) => {
    const projectPath = source.projectPath ?? source.session?.cwd;
    const projectName = formatProjectPath(source.projectLabel, projectPath);

    let tokens = 0;
    const byModel = new Map<string, UsageTotals>();
    const modelTokens = new Map<string, number>();

    for (const record of source.records) {
      if (record.timestamp < startTs || record.timestamp >= endTs) continue;
      const usage = record.usage;
      if (!usage) continue;

      const totals = totalsOf(usage);
      const amount = totalsSum(totals);
      tokens += amount;

      const pricingModel = record.model ?? UNKNOWN_MODEL_LABEL;
      const bucket = byModel.get(pricingModel);
      if (bucket) addTotals(bucket, totals);
      else byModel.set(pricingModel, totals);

      if (record.model) {
        modelTokens.set(record.model, (modelTokens.get(record.model) ?? 0) + amount);
      }
    }

    const { usd, unpriced } = priceSession(byModel);

    if (mode === "cost" && unpriced) {
      if (tokens > 0) excludedUnpriced += 1;
      return;
    }

    const value = mode === "cost" ? (usd ?? 0) : tokens;
    if (!(value > 0)) return;

    const model =
      [...modelTokens.entries()]
        .filter(([, amount]) => amount > 0)
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0] ??
      null;

    let project = byLabel.get(source.projectLabel);
    if (!project) {
      project = { name: projectName, label: source.projectLabel, value: 0, sessions: [] };
      byLabel.set(source.projectLabel, project);
    }

    const session: TreemapSession = {
      id: sessionIdentity(source.session, index),
      title: source.session ? sessionTitle(source.session) : projectName,
      value,
      usd,
      model
    };
    project.value += value;
    project.sessions.push(session);
  });

  const projects = [...byLabel.values()]
    .filter((project) => project.sessions.length > 0)
    .sort(
      (a, b) =>
        b.value - a.value ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
        (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)
    )
    .map((project) => ({
      project: project.name,
      value: project.value,
      sessions: project.sessions.sort(
        (a, b) => b.value - a.value || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
    }));

  const total = projects.reduce((sum, project) => sum + project.value, 0);

  return { projects, excludedUnpriced, total };
}

function sessionIdentity(session: SessionMeta | undefined, index: number): string {
  return session ? `path:${session.path}` : `anonymous:${index}`;
}

// ---------------------------------------------------------------------------
// 小面积会话折叠
// ---------------------------------------------------------------------------

export const TREEMAP_OTHER_ID = "treemap:other";

export type TreemapMerge = {
  /** 合并后的会话列表：未合并的保持原序，合并块追加在末尾。 */
  sessions: TreemapSession[];
  /** 被折进「其余 N 个」的会话数；0 表示没有合并。 */
  mergedCount: number;
  /** 合并块的面积值；没有合并时为 0。 */
  mergedValue: number;
};

/**
 * 把占比低于 `minShare` 的会话折成一个「其余 N 个」块，避免树图里出现
 * 无法阅读、也无法放标签的碎点。
 *
 * 阈值语义：`value / total < minShare`，**严格小于**——正好等于阈值的会话
 * 保留为独立块（边界可预测，测试也钉在这里）。`total` 不传时按入参求和，
 * 传了则用调用方给的面积分母（通常就是 `buildCostTreemap().total`）。
 *
 * 边界决定：只有 **2 个及以上**小块才折叠。只有一个低于阈值的会话时保留
 * 原样——「其余 1 个」比一个可辨识的小块更难读，也没有减少碎点数量。
 * 合并块只在全部成员都已定价时给出 `usd` 之和；有任一未定价就是 `null`。
 */
export function mergeTinySessions(
  sessions: readonly TreemapSession[],
  minShare: number,
  total?: number
): TreemapMerge {
  const denominator =
    total ?? sessions.reduce((sum, session) => sum + Math.max(0, session.value), 0);

  if (!(denominator > 0) || !(minShare > 0)) {
    return { sessions: [...sessions], mergedCount: 0, mergedValue: 0 };
  }

  const threshold = minShare * denominator;
  const kept: TreemapSession[] = [];
  const tiny: TreemapSession[] = [];

  for (const session of sessions) {
    if (session.value < threshold) tiny.push(session);
    else kept.push(session);
  }

  if (tiny.length < 2) {
    return { sessions: [...sessions], mergedCount: 0, mergedValue: 0 };
  }

  const mergedValue = tiny.reduce((sum, session) => sum + session.value, 0);
  const priced = tiny.every((session) => session.usd !== null);
  const merged: TreemapSession = {
    id: TREEMAP_OTHER_ID,
    title: `其余 ${tiny.length} 个`,
    value: mergedValue,
    usd: priced ? tiny.reduce((sum, session) => sum + (session.usd ?? 0), 0) : null,
    model: null
  };

  return {
    sessions: [...kept, merged],
    mergedCount: tiny.length,
    mergedValue
  };
}
