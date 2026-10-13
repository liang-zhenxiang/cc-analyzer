import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import {
  UNKNOWN_MODEL_LABEL,
  addLocalDays,
  dayStartOf,
  totalsSum,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";
import { estimateCost, pricingFamilyFor } from "./pricingSnapshot";

/**
 * 消耗日历（Issue #187）：近 12 个月（滚动 365 天）的「一天一格」网格，
 * 色深 = 当日估算成本的四分位档。
 *
 * 不动 `UsageAggregate`：那套按天桶（`DayBucket`）没有模型维度，而成本必须按
 * 模型定价（`estimateCost` 的口径）——拿日合计乘「某均价」会破坏逐模型计价。
 * 所以本模块自己从 `inputs` 聚合，每天维护 `Map<model, UsageTotals>` 后逐模型
 * `estimateCost` 求和；`compactEvents` / `errorExtract` / `toolCalls` 是别的面板
 * 的私货，这里一概不碰。
 *
 * 记录口径与 `aggregateSession` 逐字相同：只数 `kind === "user" | "assistant"`
 * 且 `compactSummary !== true` 的记录；token 从记录自带的 `usage` 读（缺失为 0），
 * 模型从 `record.model` 读（缺失按 `UNKNOWN_MODEL_LABEL`）。
 */

/** 一天的日历事实。tokens = 四类计数器之和（totalsSum 口径）。 */
export type CalendarDayFacts = {
  dayStart: number;
  tokens: number;
  /** 已定价部分的估算成本（按 (day, model) 分桶后逐模型 estimateCost 求和）。 */
  costUsd: number;
  /** 当天存在 unknownModel 的 token（成本是部分已知，不是 0）。 */
  hasUnknownCost: boolean;
  /** user/assistant（非 compactSummary）记录条数，与 aggregateSession.messages 同口径。 */
  messages: number;
  /** 当天有上述记录的会话数（按会话去重，不是记录数）。 */
  sessions: number;
  /** 当天 token 最多的项目；并列取 label 字典序最小；当天无 token 为 null。 */
  topProject: { label: string; path?: string } | null;
};

export type CalendarCell =
  | { kind: "pad" }
  | ({ kind: "day" } & CalendarDayFacts & { level: 0 | 1 | 2 | 3 | 4 });

export type UsageCalendar = {
  /** 每列的周一 dayStart，升序；长度恒 53（窗口 365 天 = 52 整周 + 1 天）。 */
  weekStarts: number[];
  /** cells[weekIndex][rowIndex]，rowIndex 0=周一 … 6=周日（Monday-first）。 */
  cells: CalendarCell[][];
  /** 月份标签：weekIndex 列的列头文本；同月名出现两次时两个都带年号。 */
  monthMarks: Array<{ weekIndex: number; label: string }>;
  /** 非零成本天的四分位（Type 7）；无非零天时为 null（全图 0 档）。 */
  quartiles: { q1: number; q2: number; q3: number } | null;
};

function addUsage(target: UsageTotals, usage: SessionUsage): void {
  target.input += usage.inputTokens ?? 0;
  target.output += usage.outputTokens ?? 0;
  target.cacheCreation += usage.cacheCreationTokens ?? 0;
  target.cacheRead += usage.cacheReadTokens ?? 0;
}

/** 两个已聚合的 UsageTotals 相加（addUsage 吃记录的 usage，这里吃聚合账）。 */
function addTotals(target: UsageTotals, other: UsageTotals): void {
  target.input += other.input;
  target.output += other.output;
  target.cacheCreation += other.cacheCreation;
  target.cacheRead += other.cacheRead;
}

/** 一条 usage 的四类之和——日历格子的「热度」单位。 */
function usageTokens(usage: SessionUsage): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

/** 记录是否属于日历口径（与 aggregateSession 的过滤逐字相同）。 */
function countsAsMessage(record: SessionRecord): boolean {
  return (record.kind === "user" || record.kind === "assistant") && record.compactSummary !== true;
}

/**
 * 同一会话在多份输入里出现时的身份键（与 quotaAttribution 相同）：优先
 * `SessionMeta.path`（与「点击开会话」同一个键），无元数据按数组位置分行——
 * 它们是彼此独立的会话，不能因为缺元数据被合并，也不能因此漏账。
 */
function sessionKeyOf(source: UsageSessionInput, index: number): string {
  return source.session ? `path:${source.session.path}` : `anonymous:${index}`;
}

export function buildUsageCalendar(
  inputs: readonly UsageSessionInput[],
  now: number
): UsageCalendar {
  const todayStart = dayStartOf(now);
  // 窗口 = [todayStart − 364, todayStart]，共 365 个本地日（含今天）。起点与
  // 今天同星期（addLocalDays 走日历分量、weekday 不变）——对齐到周一后恒
  // 52 整周 + 首尾两个半列 = 53 列、371 格中 365 天格 + 6 pad。
  const windowStart = addLocalDays(todayStart, -364);

  type DayTally = {
    messages: number;
    sessions: Set<string>;
    models: Map<string, UsageTotals>;
    projects: Map<string, number>;
  };
  const days = new Map<number, DayTally>();

  inputs.forEach((source, index) => {
    const key = sessionKeyOf(source, index);
    for (const record of source.records) {
      if (!countsAsMessage(record)) continue;
      const dayStart = dayStartOf(record.timestamp);
      if (dayStart < windowStart || dayStart > todayStart) continue;

      let day = days.get(dayStart);
      if (!day) {
        day = { messages: 0, sessions: new Set(), models: new Map(), projects: new Map() };
        days.set(dayStart, day);
      }
      day.messages += 1;
      day.sessions.add(key);

      const usage = record.usage;
      if (!usage) continue;
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      let modelTotals = day.models.get(model);
      if (!modelTotals) {
        modelTotals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        day.models.set(model, modelTotals);
      }
      addUsage(modelTotals, usage);
      if (source.projectLabel) {
        day.projects.set(
          source.projectLabel,
          (day.projects.get(source.projectLabel) ?? 0) + usageTokens(usage)
        );
      }
    }
  });

  // 项目标签 → 本机工作目录：topProject 要能印真实目录名（formatProjectPath
  // 的口径）。首个路径胜出——同 label 的输入来自同一项目，任一路径都如实命名。
  const projectPathByLabel = new Map<string, string>();
  for (const input of inputs) {
    if (input.projectPath && input.projectLabel && !projectPathByLabel.has(input.projectLabel)) {
      projectPathByLabel.set(input.projectLabel, input.projectPath);
    }
  }

  // 一天的最终事实：成本逐模型折算；任何模型命中 unknownModel 就标「部分已知」
  // （token 不折为 0 价，与页面 KPI 的 cost.hasUnknown 同款处理）。
  const factsOf = (dayStart: number, day: DayTally | undefined): CalendarDayFacts => {
    let costUsd = 0;
    let hasUnknownCost = false;
    let tokens = 0;
    let topProject: { label: string; path?: string } | null = null;
    let topProjectTokens = 0;
    if (day) {
      for (const [model, totals] of day.models) {
        tokens += totalsSum(totals);
        const estimate = estimateCost(totals, model);
        if ("unknownModel" in estimate) {
          hasUnknownCost = true;
        } else {
          costUsd += estimate.usd;
        }
      }
      // 并列取 label 字典序最小：token 量级优先，真并列才比字典序。
      for (const [label, projectTokens] of day.projects) {
        if (projectTokens <= 0) continue;
        const beats =
          topProject === null ||
          projectTokens > topProjectTokens ||
          (projectTokens === topProjectTokens && label < topProject.label);
        if (beats) {
          topProject = { label, path: projectPathByLabel.get(label) };
          topProjectTokens = projectTokens;
        }
      }
    }
    return {
      dayStart,
      tokens,
      costUsd,
      hasUnknownCost,
      messages: day?.messages ?? 0,
      sessions: day?.sessions.size ?? 0,
      topProject
    };
  };

  const dayFacts = new Map<number, CalendarDayFacts>();
  for (let dayStart = windowStart; dayStart <= todayStart; dayStart = addLocalDays(dayStart, 1)) {
    dayFacts.set(dayStart, factsOf(dayStart, days.get(dayStart)));
  }

  const quartiles = quartilesOf([...dayFacts.values()].map((facts) => facts.costUsd));

  // 网格几何：首列周一 = 窗口起点回退到本周周一。周起始写死周一、不读 Intl
  // （chartPrimitives 的 WEEKDAY_LABELS / WEEKDAY_ROW_TO_DAY 是全站唯一星期序列），
  // 列对齐与标签不随运行环境 locale 漂移——e2e / 真机的「53 列 + 首行周一」
  // 断言因此可断。
  const offsetStart = (new Date(windowStart).getDay() + 6) % 7;
  const firstMonday = addLocalDays(windowStart, -offsetStart);

  const weekStarts: number[] = [];
  const cells: CalendarCell[][] = [];
  // 月份标签挂在每列第一个窗口内天所在列（首列是月中起点，其余列是周一）。
  const monthAnchors: Array<{ year: number; month: number }> = [];
  for (let week = 0; week < 53; week += 1) {
    const weekStart = addLocalDays(firstMonday, week * 7);
    weekStarts.push(weekStart);
    const column: CalendarCell[] = [];
    for (let row = 0; row < 7; row += 1) {
      const dayStart = addLocalDays(weekStart, row);
      if (dayStart < windowStart || dayStart > todayStart) {
        column.push({ kind: "pad" });
        continue;
      }
      const facts = dayFacts.get(dayStart)!;
      column.push({ kind: "day", ...facts, level: levelOfCost(facts.costUsd, quartiles) });
    }
    cells.push(column);
    const anchor = week === 0 ? addLocalDays(weekStart, offsetStart) : weekStart;
    const anchorDate = new Date(anchor);
    monthAnchors.push({ year: anchorDate.getFullYear(), month: anchorDate.getMonth() + 1 });
  }

  // 同一「月名」出现两次（只能是首月与末月，如 2025-10 与 2026-10）时两个
  // 标签都带年号：只给一个带，用户要自己推另一个的年份；「重复 ⇔ 都带」
  // 规则对称、没有例外分支。计数按**去重后的月序列**（同一月占多列是常态，
  // 按列数会误判人人都重复）。
  const distinctMonths: Array<{ year: number; month: number; weekIndex: number }> = [];
  let dedupeKey = "";
  monthAnchors.forEach(({ year, month }, weekIndex) => {
    const key = `${year}-${month}`;
    if (key === dedupeKey) return;
    dedupeKey = key;
    distinctMonths.push({ year, month, weekIndex });
  });
  const monthNameCounts = new Map<number, number>();
  for (const { month } of distinctMonths) {
    monthNameCounts.set(month, (monthNameCounts.get(month) ?? 0) + 1);
  }
  const monthMarks: UsageCalendar["monthMarks"] = distinctMonths.map(
    ({ year, month, weekIndex }) => ({
      weekIndex,
      label: (monthNameCounts.get(month) ?? 0) > 1 ? `${year}/${month}` : `${month}月`
    })
  );

  return { weekStarts, cells, monthMarks, quartiles };
}

/**
 * 非零成本天的四分位（Type 7 线性插值，与 Excel / R 默认一致）。严格 > 0：
 * 0 成本天不进分布（「色即成本」，无消耗不上色，也不稀释别人的档位）。
 */
function quartilesOf(values: number[]): { q1: number; q2: number; q3: number } | null {
  const positive = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (positive.length === 0) return null;
  const quantile = (p: number): number => {
    const rank = p * (positive.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return positive[lo] + (rank - lo) * (positive[hi] - positive[lo]);
  };
  return { q1: quantile(0.25), q2: quantile(0.5), q3: quantile(0.75) };
}

/** 四分位档位（独立导出便于单测）：cost ≤ 0 或 q 为 null → 0。 */
export function levelOfCost(
  cost: number,
  q: { q1: number; q2: number; q3: number } | null
): 0 | 1 | 2 | 3 | 4 {
  if (q === null || cost <= 0) return 0;
  if (cost <= q.q1) return 1;
  if (cost <= q.q2) return 2;
  if (cost <= q.q3) return 3;
  return 4;
}

/** 点击格子后的当天会话 Top 清单（按需调用，不进 buildUsageCalendar）。 */
export type CalendarSessionRow = {
  /** SessionMeta.path；无元数据输入为空串（行照列、不可点，同归因面板）。 */
  path: string;
  /** sessionTitle 的口径；无元数据退回 projectLabel（同 quotaAttribution）。 */
  title: string;
  projectLabel: string;
  projectPath?: string;
  /** 当天该会话 token（四类和）。 */
  tokens: number;
  /** 当天该会话估算成本（该会话当天记录按 (day, session, model) 折算）；
      展开区行的「$X · N tok」双数读数来自这里。 */
  costUsd: number;
  /** 该会话当天存在 unknownModel 的 token（行读数末尾追加「· 部分未知」）。 */
  hasUnknownCost: boolean;
  /** tokens / dayTokens（0..1）；分母为 0 时是 0，不是 NaN。 */
  share: number;
};

/** 逐会话折算当天成本与 token 的中间账。 */
type SessionTally = {
  path: string;
  title: string;
  projectLabel: string;
  projectPath?: string;
  models: Map<string, UsageTotals>;
};

function tallyTokens(tally: SessionTally): number {
  let tokens = 0;
  for (const totals of tally.models.values()) tokens += totalsSum(totals);
  return tokens;
}

function finalizeRow(tally: SessionTally, dayTokens: number): CalendarSessionRow {
  let costUsd = 0;
  let hasUnknownCost = false;
  for (const [model, totals] of tally.models) {
    const estimate = estimateCost(totals, model);
    if ("unknownModel" in estimate) {
      hasUnknownCost = true;
    } else {
      costUsd += estimate.usd;
    }
  }
  const tokens = tallyTokens(tally);
  return {
    path: tally.path,
    title: tally.title,
    projectLabel: tally.projectLabel,
    projectPath: tally.projectPath,
    tokens,
    costUsd,
    hasUnknownCost,
    share: dayTokens > 0 ? tokens / dayTokens : 0
  };
}

/* ---------------------------------------------------------------------------
 * 一日回望（Issue #192）：把展开区从「当天会话 Top 清单」升级为「日摘要 +
 * 24h 甘特式时间线 + 保留的清单」。数据层新增 `dayTimelineOf`，与
 * `daySessionsOf` / `buildUsageCalendar` 同一条记录口径（`countsAsMessage`）、
 * 同一个身份键（`sessionKeyOf`）、同一个成本折算路径（逐模型 `estimateCost`，
 * unknown 标 `hasUnknownCost` 不折 0）。三函数同天输出的恒等式由
 * `usageCalendar.test.ts` 的一致性 describe 钉住——升级是增量的，V1 的全部
 * 断言（53 列、档位、清单）原样保持。
 * ------------------------------------------------------------------------ */

/** 一日回望（Issue #192）：一天的时间形状。全部时刻为本地时间毫秒。 */
export type DayTimelineSession = {
  /** 与 CalendarSessionRow 同源的身份四件套。 */
  path: string;
  title: string;
  projectLabel: string;
  projectPath?: string;
  /** 当天首条 countsAsMessage 记录的时刻（跨午夜按记录归属切，同 daySessionsOf）。 */
  startTs: number;
  /** 当天末条 countsAsMessage 记录的时刻。 */
  endTs: number;
  /** endTs − startTs < 60_000 → 瞬时会话：时间线给最小可视宽（§4.5）。 */
  instant: boolean;
  /** 泳道号（0 起，贪心分配，§2.2）。 */
  lane: number;
  /** 恒 24 桶：该会话当天每小时 token 四类和（0 = 该小时无 usage 记录）。 */
  hourlyTokens: number[];
  /** 当天该会话 token / 成本（与 CalendarSessionRow 同一折算路径）。 */
  tokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
};

export type DayTimelineSummary = {
  costUsd: number;
  hasUnknownCost: boolean;
  tokens: number;
  /** 当天有 countsAsMessage 记录的会话数（=== sessions.length）。 */
  sessions: number;
  /** 当天 countsAsMessage 记录条数。 */
  messages: number;
  /** 当天首条 / 末条记录时刻；sessions === 0 时为 null（该天本就不会展开）。 */
  firstTs: number | null;
  lastTs: number | null;
  /** 当天 token 最多的模型 id（原样存，展示层 formatModelId）；并列按 id 字典序
      最小；无 token（含全无 usage）为 null。unknown 模型的 token 计入排名，
      命中时此值为 UNKNOWN_MODEL_LABEL——如实说「当天大头是未知模型」。 */
  topModel: string | null;
  /** 当天有记录的 distinct projectLabel 数（空串 label 不计，同 topProject 口径）。 */
  projects: number;
};

/** 项目 → 类别色槽位（§3.2）：当日 token Top5 各占一个彩槽，其余进 "other"。 */
export type DayProjectSlot = {
  label: string;
  path?: string;
  slot: 0 | 1 | 2 | 3 | 4 | "other";
  tokens: number;
  sessions: number;
};

export type DayTimeline = {
  summary: DayTimelineSummary;
  /** 按 startTs 升序；并列按 title 再按 path（与归因排序同一并列规则）。 */
  sessions: DayTimelineSession[];
  laneCount: number;
  /** 槽位序 0..4，"other" 恒在末位且只在存在第 6 个项目时出现。 */
  projectSlots: DayProjectSlot[];
};

/**
 * 瞬时会话的跨度阈值（毫秒）。全文件唯一的跨度常数：instant 判定
 * （endTs − startTs < 阈值）与泳道的 effectiveEnd（瞬时条占 1 分钟名义跨度）
 * 共用——不加后者，两个同刻的瞬时会话满足 `end <= start` 会落同一泳道同一
 * 位置，视觉完全叠死。
 */
const INSTANT_SPAN_MS = 60_000;

/** 逐模型桶折算成本（daySessionsOf 的 finalizeRow 同一折算路径，字段集不同）。 */
function costOfModels(models: Map<string, UsageTotals>): {
  costUsd: number;
  hasUnknownCost: boolean;
} {
  let costUsd = 0;
  let hasUnknownCost = false;
  for (const [model, totals] of models) {
    const estimate = estimateCost(totals, model);
    if ("unknownModel" in estimate) {
      hasUnknownCost = true;
    } else {
      costUsd += estimate.usd;
    }
  }
  return { costUsd, hasUnknownCost };
}

export function dayTimelineOf(
  inputs: readonly UsageSessionInput[],
  dayStart: number
): DayTimeline {
  type TimelineTally = {
    path: string;
    title: string;
    projectLabel: string;
    projectPath?: string;
    startTs: number;
    endTs: number;
    hourlyTokens: number[];
    models: Map<string, UsageTotals>;
  };

  const tallies = new Map<string, TimelineTally>();
  let messages = 0;
  // 项目账（与 buildUsageCalendar 的 day.projects 同构）：tokens 只累计有 usage
  // 的记录（排序口径），sessions 计当天有记录的会话（展示口径）——两个数字
  // 服务两个问题，不共用一份过滤。
  const projectTokens = new Map<string, number>();
  const projectSessions = new Map<string, number>();

  inputs.forEach((source, index) => {
    const session: SessionMeta | undefined = source.session;
    const key = sessionKeyOf(source, index);
    let tally: TimelineTally | undefined;

    for (const record of source.records) {
      if (!countsAsMessage(record)) continue;
      if (dayStartOf(record.timestamp) !== dayStart) continue;
      messages += 1;

      if (!tally) {
        tally = {
          path: session?.path ?? "",
          title: session ? sessionTitle(session) : source.projectLabel,
          projectLabel: source.projectLabel,
          projectPath: source.projectPath ?? session?.cwd,
          startTs: record.timestamp,
          endTs: record.timestamp,
          hourlyTokens: Array.from({ length: 24 }, () => 0),
          models: new Map()
        };
        tallies.set(key, tally);
        // 会话数按「当天有记录」计（空串 label 不进项目维度，同 topProject）。
        if (source.projectLabel) {
          projectSessions.set(
            source.projectLabel,
            (projectSessions.get(source.projectLabel) ?? 0) + 1
          );
        }
      }
      // 首末时刻取 min/max：记录顺序不保证升序（解析按行序，真实日志可乱序）。
      if (record.timestamp < tally.startTs) tally.startTs = record.timestamp;
      if (record.timestamp > tally.endTs) tally.endTs = record.timestamp;

      const usage = record.usage;
      if (!usage) continue;
      tally.hourlyTokens[new Date(record.timestamp).getHours()] += usageTokens(usage);
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      let modelTotals = tally.models.get(model);
      if (!modelTotals) {
        modelTotals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        tally.models.set(model, modelTotals);
      }
      addUsage(modelTotals, usage);
      if (source.projectLabel) {
        projectTokens.set(
          source.projectLabel,
          (projectTokens.get(source.projectLabel) ?? 0) + usageTokens(usage)
        );
      }
    }
  });

  // 排序（§2.1）：startTs 升序，并列按 title 再按 path——泳道贪心与 ←/→
  // 键盘导航共用这一条时间序。
  const ranked = [...tallies.values()];
  ranked.sort(
    (a, b) =>
      a.startTs - b.startTs || a.title.localeCompare(b.title) || a.path.localeCompare(b.path)
  );

  // 泳道贪心（区间图着色的经典最优）：按时间序扫描，落到「最早空出的」泳道。
  // effectiveEnd 给瞬时会话 1 分钟名义跨度，同刻的它们必然分泳道；副作用是
  // 背靠背的真会话（A 恰在 B 开始的同一毫秒结束）也分泳道——视觉上背靠背
  // 贴住，分泳道更可读，不是 bug。泳道不设数据层上限：折叠是布局层的事。
  const laneEnds: number[] = [];
  const sessions: DayTimelineSession[] = ranked.map((tally) => {
    const tokens = tallyTokensOf(tally);
    const { costUsd, hasUnknownCost } = costOfModels(tally.models);
    return {
      path: tally.path,
      title: tally.title,
      projectLabel: tally.projectLabel,
      projectPath: tally.projectPath,
      startTs: tally.startTs,
      endTs: tally.endTs,
      instant: tally.endTs - tally.startTs < INSTANT_SPAN_MS,
      lane: 0,
      hourlyTokens: tally.hourlyTokens,
      tokens,
      costUsd,
      hasUnknownCost
    };
  });
  sessions.forEach((session) => {
    const effectiveEnd = session.instant ? session.startTs + INSTANT_SPAN_MS : session.endTs;
    let lane = laneEnds.findIndex((end) => end <= session.startTs);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(effectiveEnd);
    } else {
      laneEnds[lane] = effectiveEnd;
    }
    session.lane = lane;
  });

  // summary：模型账从会话桶合并（estimateCost 线性，合并后求和与逐桶等价，
  // 与 buildUsageCalendar 的天 facts 逐字段对账由恒等式测试钉住）。
  const dayModels = new Map<string, UsageTotals>();
  for (const tally of ranked) {
    for (const [model, totals] of tally.models) {
      let merged = dayModels.get(model);
      if (!merged) {
        merged = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        dayModels.set(model, merged);
      }
      addTotals(merged, totals);
    }
  }
  const { costUsd, hasUnknownCost } = costOfModels(dayModels);
  let tokens = 0;
  for (const totals of dayModels.values()) tokens += totalsSum(totals);
  // topModel 排名：unknown 模型（定价快照认不出的 id）的 token 归并进
  // UNKNOWN_MODEL_LABEL 条目——否则「未知模型」永远到不了榜首，而那正是
  // 「当天大头是未知模型」最该被说出来的时刻。并列取字典序最小。
  const modelRankTokens = new Map<string, number>();
  for (const [model, totals] of dayModels) {
    const key = pricingFamilyFor(model) === null ? UNKNOWN_MODEL_LABEL : model;
    modelRankTokens.set(key, (modelRankTokens.get(key) ?? 0) + totalsSum(totals));
  }
  let topModel: string | null = null;
  let topModelTokens = 0;
  for (const [model, modelTokens] of modelRankTokens) {
    const beats =
      topModel === null ||
      modelTokens > topModelTokens ||
      (modelTokens === topModelTokens && model < topModel);
    if (beats) {
      topModel = model;
      topModelTokens = modelTokens;
    }
  }
  // 无 token（全无 usage）时 topModel 为 null：模型榜没有「垫底也上榜」。
  if (topModel !== null && topModelTokens <= 0) topModel = null;

  // 项目槽位（§3.2）：当日 token 降序 Top5 拿彩槽，第 6 个及以后折叠进
  // "other"（形状与读数保留——条照画、title 照报项目名，只有专属颜色折叠）。
  // 并列按 label 字典序（同 topProject）。分配按天重算，不做跨天稳定映射。
  const projectPathByLabel = new Map<string, string>();
  for (const input of inputs) {
    if (input.projectPath && input.projectLabel && !projectPathByLabel.has(input.projectLabel)) {
      projectPathByLabel.set(input.projectLabel, input.projectPath);
    }
  }
  const rankedProjects = [...projectTokens.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ label, tokens: value }))
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));

  const projectSlots: DayProjectSlot[] = rankedProjects.slice(0, 5).map((project, index) => ({
    label: project.label,
    path: projectPathByLabel.get(project.label),
    slot: index as 0 | 1 | 2 | 3 | 4,
    tokens: project.tokens,
    sessions: projectSessions.get(project.label) ?? 0
  }));
  const tail = rankedProjects.slice(5);
  if (tail.length > 0) {
    projectSlots.push({
      label: "",
      slot: "other",
      tokens: tail.reduce((sum, project) => sum + project.tokens, 0),
      sessions: tail.reduce(
        (sum, project) => sum + (projectSessions.get(project.label) ?? 0),
        0
      )
    });
  }

  const labels = new Set<string>();
  for (const tally of ranked) {
    if (tally.projectLabel) labels.add(tally.projectLabel);
  }

  // firstTs 排序后即首条；lastTs 必须真取 max——后开始的会话可能先结束
  // （恒等式 §2.4：firstTs === min(startTs)、lastTs === max(endTs)）。
  const lastTs = sessions.reduce<number | null>(
    (max, session) => (max === null || session.endTs > max ? session.endTs : max),
    null
  );

  return {
    summary: {
      costUsd,
      hasUnknownCost,
      tokens,
      sessions: sessions.length,
      messages,
      firstTs: sessions.length > 0 ? sessions[0].startTs : null,
      lastTs,
      topModel,
      projects: labels.size
    },
    sessions,
    laneCount: laneEnds.length,
    projectSlots
  };
}

/** TimelineTally 的 token 合计（tallyTokens 的同构物；类型不共享所以另写一份）。 */
function tallyTokensOf(tally: { models: Map<string, UsageTotals> }): number {
  let tokens = 0;
  for (const totals of tally.models.values()) tokens += totalsSum(totals);
  return tokens;
}

export function daySessionsOf(
  inputs: readonly UsageSessionInput[],
  dayStart: number,
  options?: { top?: number }
): {
  rows: CalendarSessionRow[];
  remainder: { sessions: number; tokens: number; share: number } | null;
  sessions: number;
  dayTokens: number;
} {
  const top =
    options?.top === undefined || !Number.isFinite(options.top)
      ? 5
      : Math.max(0, Math.floor(options.top));

  const tallies = new Map<string, SessionTally>();
  inputs.forEach((source, index) => {
    const session: SessionMeta | undefined = source.session;
    const key = sessionKeyOf(source, index);
    let tally: SessionTally | undefined;

    for (const record of source.records) {
      if (!countsAsMessage(record)) continue;
      if (dayStartOf(record.timestamp) !== dayStart) continue;

      if (!tally) {
        tally = {
          path: session?.path ?? "",
          title: session ? sessionTitle(session) : source.projectLabel,
          projectLabel: source.projectLabel,
          projectPath: source.projectPath ?? session?.cwd,
          models: new Map()
        };
        tallies.set(key, tally);
      }
      const usage = record.usage;
      if (!usage) continue;
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      let modelTotals = tally.models.get(model);
      if (!modelTotals) {
        modelTotals = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
        tally.models.set(model, modelTotals);
      }
      addUsage(modelTotals, usage);
    }
  });

  // 占比分母唯一：当日全部会话的 token 总量（token 完备无缺失；成本有
  // unknown 破洞，不能当分母）。排序对齐归因面板：tokens 降序、并列按
  // 标题再按路径——token 先算一次再排（comparator 里反复折算会放大噪音）。
  const ranked = [...tallies.values()].map((tally) => ({ tally, tokens: tallyTokens(tally) }));
  ranked.sort(
    (a, b) =>
      b.tokens - a.tokens ||
      a.tally.title.localeCompare(b.tally.title) ||
      a.tally.path.localeCompare(b.tally.path)
  );
  const dayTokens = ranked.reduce((sum, item) => sum + item.tokens, 0);

  const rows = ranked.slice(0, top).map(({ tally }) => finalizeRow(tally, dayTokens));
  const tail = ranked.slice(top);
  const tailTokens = tail.reduce((sum, item) => sum + item.tokens, 0);
  return {
    rows,
    remainder:
      tail.length === 0
        ? null
        : {
            sessions: tail.length,
            tokens: tailTokens,
            share: dayTokens > 0 ? tailTokens / dayTokens : 0
          },
    sessions: ranked.length,
    dayTokens
  };
}
