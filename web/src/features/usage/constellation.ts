import { formatModelId, formatProjectPath, formatTokenCount } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import type { SessionUsage } from "../sessions/types";
import { pricingFamilyFor } from "./pricingSnapshot";
import {
  UNKNOWN_MODEL_LABEL,
  addLocalDays,
  dayStartOf,
  formatDayLabel,
  type UsageSessionInput
} from "./usageAggregations";

/**
 * 会话星系（F1）：项目是水平泳道、时间从左往右流，一颗星 = 一个会话。
 *
 * 口径（与页面 KPI 同一套）：
 * - 会话起点 = 窗口内**第一条**记录的 timestamp（不取 mtime，也不取 meta 时间）；
 * - token = 窗口内记录四类计数器之和（`totalsSum` 的口径）；
 * - 颜色 = 该会话 token 最多的模型；没有任何 usage 的会话画空心环。
 *
 * 颜色身份只给 token 排名前 6 的**已定价**模型，第 7 名及以后与未知模型一律
 * 中性 `--text-faint`。页面其余图用 `index % 6` 循环，这张散点里不能沿用：
 * 两个模型撞色会被读成同一个模型（见设计规格 §2.1）。
 *
 * 布局是确定性的：桶排序 + 字典序兜底，同一份输入永远得到同一张图；重叠星
 * 不加抖动（抖动会伪造时间），靠 1px 卡片底描边分隔。
 */

/** viewBox 尺寸与绘图区留白；131 = 左栏泳道名，右/上/下留出刻度。 */
export const CONSTELLATION_WIDTH = 960;
export const CONSTELLATION_HEIGHT = 300;
export const CONSTELLATION_PLOT_LEFT = 132;
export const CONSTELLATION_PLOT_RIGHT = 16;
export const CONSTELLATION_PLOT_TOP = 20;
export const CONSTELLATION_PLOT_BOTTOM = 24;
/** 同小时连线的上限：再多就把散点织成蜘蛛网。 */
export const CONSTELLATION_MAX_LINKS = 60;
export const CONSTELLATION_MIN_RADIUS = 2.2;
export const CONSTELLATION_MAX_RADIUS = 9.2;
const OTHER_LANE_KEY = "__other__";

/**
 * 窗口边界与 `aggregateRange` 同一公式：最近 `days` 个本地自然日（含今天），
 * 起点是第 `days-1` 天前的本地零点。`endTs` 是**明天零点**（开区间），
 * 让横轴覆盖完整的今天而不是被当前时刻截断。
 *
 * 共享文件本轮不可改，所以这个函数在这里导出；星系的另外两个纯函数模块
 * 直接复用它，避免出现第二份窗口边界。
 */
export type LabWindow = { startTs: number; endTs: number; windowDays: number };

export function labWindow(days: number, now: number): LabWindow {
  const windowDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 1;
  const todayStart = dayStartOf(now);
  return {
    startTs: addLocalDays(todayStart, -(windowDays - 1)),
    endTs: addLocalDays(todayStart, 1),
    windowDays
  };
}

export type ConstellationSession = {
  /** `path:` + 会话路径；手造输入没有元数据时为 `anonymous:` + 序号。 */
  id: string;
  title: string;
  projectLabel: string;
  projectName: string;
  /** 窗口内第一条记录的时间。 */
  start: number;
  /** 窗口内四类计数器之和；0 表示这段窗口里没有用量读数。 */
  tokens: number;
  /** token 最多的模型 id；没有 usage 时为 null。 */
  model: string | null;
  modelLabel: string | null;
  /** 1–6 的 `--chart-N` 序号；null = 第 7 名以后 / 未知模型 / 没有用量。 */
  tone: number | null;
  lane: number;
  x: number;
  y: number;
  r: number;
  hollow: boolean;
  session?: SessionMeta;
};

export type ConstellationLane = {
  key: string;
  /** 泳道名（可能被折成「其他 N 个项目」）。 */
  label: string;
  /** 悬停/读屏用的全名；折叠泳道列出被并入的项目数。 */
  fullLabel: string;
  count: number;
  y: number;
  isOther: boolean;
};

export type ConstellationModel = { model: string; label: string; tone: number };

export type ConstellationLink = { id: string; from: string; to: string; lane: number };

export type ConstellationTick = { ts: number; label: string };

export type Constellation = {
  sessions: ConstellationSession[];
  lanes: ConstellationLane[];
  /** 图例：token 排名前 6 的已定价模型，顺序即 `--chart-1..6`。 */
  models: ConstellationModel[];
  /** 有星但不在图例里的已定价模型数（第 7 名以后 / 未知模型）。 */
  otherModelCount: number;
  links: ConstellationLink[];
  /** 因 60 段上限没画出的同小时连线数。 */
  hiddenLinks: number;
  /** 被折进「其他」泳道的项目数。 */
  hiddenProjects: number;
  ticks: ConstellationTick[];
  /** 窗口内最重的 5 个会话（DOM 清单，键盘/读屏的等价物）。 */
  heaviest: ConstellationSession[];
  totalTokens: number;
  maxTokens: number;
  noUsageCount: number;
  sessionCount: number;
  projectCount: number;
  windowStart: number;
  windowEnd: number;
  windowDays: number;
  windowLabel: string;
  /** `role="img"` 的一句话摘要。 */
  summary: string;
};

export type ConstellationOptions = {
  /** 泳道数上限；窄窗 / 130% 字号降到 5，默认 8。 */
  maxLanes?: number;
};

function usageTokens(usage: SessionUsage): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

/** 本地整点起点：比较「同一小时」必须用本地时区，不能用 UTC 整点。 */
function localHourStart(ts: number): number {
  const date = new Date(ts);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

/** 横轴刻度跟窗口长度收敛：7 天逐日、30 天每周一、90 天每月 1 日。 */
function buildTicks(startTs: number, endTs: number, windowDays: number): ConstellationTick[] {
  const ticks: ConstellationTick[] = [];
  if (windowDays <= 7) {
    for (let cursor = startTs; cursor < endTs; cursor = addLocalDays(cursor, 1)) {
      ticks.push({ ts: cursor, label: formatDayLabel(cursor) });
    }
    return ticks;
  }
  if (windowDays <= 30) {
    const weekday = (new Date(startTs).getDay() + 6) % 7;
    let cursor = addLocalDays(startTs, (7 - weekday) % 7);
    for (; cursor < endTs; cursor = addLocalDays(cursor, 7)) {
      ticks.push({ ts: cursor, label: formatDayLabel(cursor) });
    }
    return ticks;
  }
  const first = new Date(startTs);
  const firstOfMonth = new Date(first.getFullYear(), first.getMonth(), 1);
  let cursor = dayStartOf(firstOfMonth.getTime());
  if (cursor < startTs) {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    cursor = dayStartOf(next.getTime());
  }
  while (cursor < endTs) {
    ticks.push({ ts: cursor, label: `${new Date(cursor).getMonth() + 1}月` });
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + 1);
    cursor = dayStartOf(next.getTime());
  }
  return ticks;
}

type RawSession = {
  id: string;
  title: string;
  projectLabel: string;
  projectName: string;
  start: number;
  tokens: number;
  model: string | null;
  session?: SessionMeta;
};

export function buildConstellation(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  options: ConstellationOptions = {}
): Constellation {
  const { startTs, endTs, windowDays } = labWindow(days, now);
  const laneLimit = Math.max(2, Math.floor(options.maxLanes ?? 8));

  const modelTotals = new Map<string, number>();
  const projectTotals = new Map<
    string,
    { label: string; tokens: number; count: number; projectName: string }
  >();
  const rawSessions: RawSession[] = [];

  inputs.forEach((source, index) => {
    let start = Number.POSITIVE_INFINITY;
    let tokens = 0;
    const modelTokens = new Map<string, number>();

    for (const record of source.records) {
      if (record.timestamp < startTs || record.timestamp >= endTs) continue;
      if (record.timestamp < start) start = record.timestamp;
      const usage = record.usage;
      if (!usage) continue;
      const amount = usageTokens(usage);
      if (amount <= 0) continue;
      tokens += amount;
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      modelTokens.set(model, (modelTokens.get(model) ?? 0) + amount);
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + amount);
    }

    if (!Number.isFinite(start)) return;

    const projectPath = source.projectPath ?? source.session?.cwd;
    const projectName = formatProjectPath(source.projectLabel, projectPath);
    const dominant =
      [...modelTokens.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
      )[0]?.[0] ?? null;

    rawSessions.push({
      id: source.session ? `path:${source.session.path}` : `anonymous:${index}`,
      title: source.session ? sessionTitle(source.session) : projectName,
      projectLabel: source.projectLabel,
      projectName,
      start,
      tokens,
      model: dominant,
      session: source.session
    });

    let project = projectTotals.get(source.projectLabel);
    if (!project) {
      project = { label: source.projectLabel, tokens: 0, count: 0, projectName };
      projectTotals.set(source.projectLabel, project);
    }
    project.tokens += tokens;
    project.count += 1;
  });

  const projectEntries = [...projectTotals.values()].sort(
    (a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label)
  );

  let hiddenProjects = 0;
  const laneDefs: Array<{ key: string; label: string; fullLabel: string; count: number; isOther: boolean }> = [];
  const laneIndexByProject = new Map<string, number>();

  if (projectEntries.length <= laneLimit) {
    for (const project of projectEntries) {
      laneIndexByProject.set(project.label, laneDefs.length);
      laneDefs.push({
        key: project.label,
        label: project.projectName,
        fullLabel: project.projectName,
        count: project.count,
        isOther: false
      });
    }
  } else {
    const named = projectEntries.slice(0, laneLimit - 1);
    const folded = projectEntries.slice(laneLimit - 1);
    hiddenProjects = folded.length;
    named.forEach((project) => {
      laneIndexByProject.set(project.label, laneDefs.length);
      laneDefs.push({
        key: project.label,
        label: project.projectName,
        fullLabel: project.projectName,
        count: project.count,
        isOther: false
      });
    });
    const otherIndex = laneDefs.length;
    folded.forEach((project) => laneIndexByProject.set(project.label, otherIndex));
    laneDefs.push({
      key: OTHER_LANE_KEY,
      label: `其他 ${hiddenProjects} 个项目`,
      fullLabel: `其他 ${hiddenProjects} 个项目`,
      count: folded.reduce((sum, project) => sum + project.count, 0),
      isOther: true
    });
  }

  const laneHeight =
    (CONSTELLATION_HEIGHT - CONSTELLATION_PLOT_TOP - CONSTELLATION_PLOT_BOTTOM) /
    Math.max(1, laneDefs.length);
  const lanes: ConstellationLane[] = laneDefs.map((lane, index) => ({
    key: lane.key,
    label: lane.label,
    fullLabel: lane.fullLabel,
    count: lane.count,
    y: CONSTELLATION_PLOT_TOP + (index + 0.5) * laneHeight,
    isOther: lane.isOther
  }));

  const knownModels = [...modelTotals.entries()]
    .filter(([model]) => pricingFamilyFor(model) !== null)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const toneByModel = new Map(
    knownModels.slice(0, 6).map(([model], index) => [model, index + 1])
  );
  const models: ConstellationModel[] = knownModels
    .slice(0, 6)
    .map(([model], index) => ({ model, label: formatModelId(model), tone: index + 1 }));

  rawSessions.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));

  const maxTokens = rawSessions.reduce((max, session) => Math.max(max, session.tokens), 0);
  const plotWidth = CONSTELLATION_WIDTH - CONSTELLATION_PLOT_LEFT - CONSTELLATION_PLOT_RIGHT;
  const span = Math.max(1, endTs - startTs);

  const sessions: ConstellationSession[] = rawSessions.map((session) => {
    const lane = laneIndexByProject.get(session.projectLabel) ?? 0;
    const ratio = Math.min(1, Math.max(0, (session.start - startTs) / span));
    const hollow = session.tokens <= 0;
    return {
      ...session,
      modelLabel: session.model ? formatModelId(session.model) : null,
      tone: session.model ? toneByModel.get(session.model) ?? null : null,
      lane,
      x: CONSTELLATION_PLOT_LEFT + ratio * plotWidth,
      y: lanes[lane].y,
      r:
        hollow || maxTokens <= 0
          ? CONSTELLATION_MIN_RADIUS
          : CONSTELLATION_MIN_RADIUS +
            (CONSTELLATION_MAX_RADIUS - CONSTELLATION_MIN_RADIUS) *
              Math.sqrt(session.tokens / maxTokens),
      hollow
    };
  });

  // 同小时连线：同一泳道内按开始时间相邻、且落在同一个本地小时的两颗星。
  const links: ConstellationLink[] = [];
  let hiddenLinks = 0;
  const byLane = new Map<number, ConstellationSession[]>();
  for (const session of sessions) {
    const list = byLane.get(session.lane);
    if (list) list.push(session);
    else byLane.set(session.lane, [session]);
  }
  for (const [lane, list] of byLane) {
    for (let index = 1; index < list.length; index += 1) {
      const previous = list[index - 1];
      const current = list[index];
      if (localHourStart(previous.start) !== localHourStart(current.start)) continue;
      if (links.length >= CONSTELLATION_MAX_LINKS) {
        hiddenLinks += 1;
        continue;
      }
      links.push({
        id: `${previous.id}->${current.id}`,
        from: previous.id,
        to: current.id,
        lane
      });
    }
  }

  const otherModels = new Set<string>();
  for (const session of sessions) {
    if (session.tokens > 0 && session.model && session.tone === null) {
      otherModels.add(session.model);
    }
  }

  const heaviest = [...sessions]
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        a.start - b.start ||
        a.title.localeCompare(b.title)
    )
    .slice(0, 5);

  const noUsageCount = sessions.filter((session) => session.tokens <= 0).length;
  const totalTokens = sessions.reduce((sum, session) => sum + session.tokens, 0);
  const windowLabel = `近 ${windowDays} 天`;

  const firstHeavy = heaviest.find((session) => session.tokens > 0);
  let summary = `会话星系：${windowLabel} ${sessions.length} 个会话、${projectTotals.size} 个项目`;
  if (firstHeavy) {
    summary += `；最大的一颗是 ${firstHeavy.projectName} 的 ${firstHeavy.title}（${formatTokenCount(firstHeavy.tokens)} token）`;
  } else {
    summary += "；这些会话没有用量读数";
  }
  if (hiddenProjects > 0) {
    summary += `；另有 ${hiddenProjects} 个项目并入「其他」泳道`;
  }
  summary += "。";

  return {
    sessions,
    lanes,
    models,
    otherModelCount: otherModels.size,
    links,
    hiddenLinks,
    hiddenProjects,
    ticks: buildTicks(startTs, endTs, windowDays),
    heaviest,
    totalTokens,
    maxTokens,
    noUsageCount,
    sessionCount: sessions.length,
    projectCount: projectTotals.size,
    windowStart: startTs,
    windowEnd: endTs,
    windowDays,
    windowLabel,
    summary
  };
}
