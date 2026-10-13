import type { SessionRecord } from "../sessions/types";
import {
  OTHER_LABEL,
  aggregateSession,
  dayStartOf,
  totalsSum,
  type UsageSessionInput
} from "./usageAggregations";
import {
  countsAsMessage,
  daySessionsOf,
  sessionKeyOf,
  type CalendarSessionRow
} from "./usageCalendar";

/**
 * 「一日回望」（Issue #192，Round V 第二棒）：日历下钻展开区的纯数据层。
 *
 * 三条口径（维护者认领评论是契约权威）：
 * ① 时间区间 = 该会话当天**首条 / 末条**「计数记录」的时刻；跨午夜**按记录时间切**，
 *    只算落在当天的那一段，并在该行标 `crossDay`；
 * ② 逐小时分桶按**本地时区**的 clock hour 分 24 桶，桶值 = 该小时内的计数记录条数，
 *    `Σ hourly === messages`；
 * ③ 日摘要的 tokens / costUsd / sessions 与 V1 的 `daySessionsOf` **同一份账**——
 *    本模块不重算「当天有哪些会话 / 当天消耗多少 / 成本怎么算」，只新增
 *    「每段的区间、逐小时活动量、摘要」这三件事（结构守卫在 `dayReview.test.ts`）。
 *
 * 「计数记录」= `kind` 是 user / assistant 且不是压缩摘要；会话身份 = 有
 * `SessionMeta` 按 `path`、否则按输入位置分行。这两条口径**直接复用**
 * `usageCalendar.ts` 导出的 `countsAsMessage` / `sessionKeyOf`，全站只有这一个
 * 权威位置；`dayReview.test.ts` 另有一条「与 `buildUsageCalendar` 的当天格子逐字段
 * 对账」的守卫，作为口径一致性的第二道保险。
 */

/** 一条会话的「当天段」。start/end 都落在同一天内（跨午夜按记录时间切）。 */
export type DaySessionSpan = {
  /** SessionMeta.path；无元数据为空串（照 daySessionsOf，行照列但不可点）。 */
  path: string;
  title: string;
  projectLabel: string;
  projectPath?: string;
  /** 当天首条 / 末条「计数记录」的时刻（ms，epoch）。 */
  start: number;
  end: number;
  /** end − start；零跨度（单条记录）时为 0。 */
  durationMs: number;
  /** 该会话在**当天之外**还有计数记录 —— 这一行是被切开的那一段。 */
  crossDay: boolean;
  /** 24 桶：该 clock hour 内的计数记录条数（本地时区，索引 0–23）。 */
  hourly: number[];
  /** 当天该会话的计数记录条数（= Σ hourly）。 */
  messages: number;
  /** 以下五项逐字来自 daySessionsOf 的行，不许重算。 */
  tokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
  share: number;
};

/** 当天摘要。tokens / costUsd / sessions 与 daySessionsOf 同一份账。 */
export type DaySummary = {
  dayStart: number;
  tokens: number;
  costUsd: number;
  hasUnknownCost: boolean;
  sessions: number;
  messages: number;
  /** 首条 / 末条计数记录的时刻；当天无会话时为 null（防御态）。 */
  firstAt: number | null;
  lastAt: number | null;
  /** 活跃跨度 = lastAt − firstAt（ms）。 */
  spanMs: number;
  /** 最常用模型：token 降序，并列按 id 字典序；当天无 token 时为 null。 */
  topModel: { id: string; tokens: number } | null;
  /** 涉及项目数（按 projectLabel 去重）。 */
  projects: number;
};

/** 项目色档：1..5 = 前五名，6 = 「其他」。 */
export type DayProjectEntry = {
  label: string;
  path?: string;
  tokens: number;
  /** 1..6；6 同时表示折尾组。 */
  color: number;
  /** 折尾组：合并了几个项目（非折尾为 0）。 */
  folded: number;
};

export type DayReview = {
  summary: DaySummary;
  /** 起点升序（并列按终点、标题、路径）。 */
  rows: DaySessionSpan[];
  /** 色键（≥2 个项目时才非空；单项目日为空数组）。 */
  key: DayProjectEntry[];
  /** path → 色档；便于行渲染直接取。 */
  colorOf: Map<string, number>;
};

export const DAY_DENSITY_LEVELS = [4, 8, 12] as const; // px，三档块高
export const DAY_PROJECT_COLOR_CAP = 5; // 前五名占 1..5，其余并入 6

/** 一天 24 个 clock hour 桶（本地时区）。 */
const DAY_HOURS = 24;

/**
 * `daySessionsOf` 的 top 上界。**不能传 `Infinity`**：它用 `Number.isFinite` 判定，
 * 非有限值会被当成缺省 5（规格 §3.2 的 `top: Number.POSITIVE_INFINITY` 因此不成立，
 * 会只拿到 5 行）。`MAX_SAFE_INTEGER` 走 `Math.floor` 后仍是自身，`slice` 等于全取。
 */
const ALL_SESSIONS = Number.MAX_SAFE_INTEGER;

/** 密度档：1–2 / 3–5 / ≥6 条记录 → 1 / 2 / 3；无记录 0（不渲染块）。 */
export function densityLevelOf(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  return 3;
}

/** 当天 h 点的 epoch：走日历分量，不写 dayStart + h * 3_600_000（DST 会漂）。 */
export function clockAt(dayStart: number, hour: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour).getTime();
}

/** ts 落在 [dayStart, dayEnd) 的比例（0..1）。分母是**本地日长**，不是固定 24 小时。 */
export function dayFractionOf(ts: number, dayStart: number, dayEnd: number): number {
  return (ts - dayStart) / (dayEnd - dayStart);
}

/** 分组中间态：一条会话当天的区间、逐小时计数与跨天事实。 */
type DayTally = {
  key: string;
  input: UsageSessionInput;
  path: string;
  start: number;
  end: number;
  messages: number;
  hourly: number[];
  crossDay: boolean;
};

export function dayReviewOf(
  inputs: readonly UsageSessionInput[],
  dayStart: number
): DayReview {
  const tallies = new Map<string, DayTally>();

  inputs.forEach((source, index) => {
    const key = sessionKeyOf(source, index);
    for (const record of source.records) {
      if (!countsAsMessage(record)) continue;
      const onDay = dayStartOf(record.timestamp) === dayStart;
      let tally = tallies.get(key);
      if (!tally) {
        // 分组按会话身份建，**不按天**：别的天那一段要先被看见，才能标出 crossDay。
        // 只有当天一条记录都没有的分组会在建行时被丢掉（它不属于这一天）。
        tally = {
          key,
          input: source,
          path: source.session?.path ?? "",
          // 区间只由**当天**记录决定；第一条当天记录到达时再落笔（别的天的记录
          // 只负责把 crossDay 点亮，不能把区间拽到昨天）。
          start: 0,
          end: 0,
          messages: 0,
          hourly: new Array<number>(DAY_HOURS).fill(0),
          crossDay: false
        };
        tallies.set(key, tally);
      }
      if (!onDay) {
        tally.crossDay = true;
        continue;
      }
      if (tally.messages === 0) {
        tally.start = record.timestamp;
        tally.end = record.timestamp;
      }
      tally.messages += 1;
      tally.hourly[new Date(record.timestamp).getHours()] += 1;
      if (record.timestamp < tally.start) tally.start = record.timestamp;
      if (record.timestamp > tally.end) tally.end = record.timestamp;
    }
  });

  // 账本唯一来源：V1 的 daySessionsOf。tokens / costUsd / hasUnknownCost / share
  // 全部逐字取自它的行，本模块一行成本数学都不写。
  const base = daySessionsOf(inputs, dayStart, { top: ALL_SESSIONS });
  const ledger = new Map<string, CalendarSessionRow>();
  const rowByPath = new Map<string, CalendarSessionRow>();
  for (const row of base.rows) {
    if (row.path !== "") rowByPath.set(row.path, row);
  }

  const anonymousKeys: string[] = [];
  const anonymousInputs: UsageSessionInput[] = [];
  for (const tally of tallies.values()) {
    if (tally.messages === 0) continue; // 当天没有计数记录：这一天的行里没有它
    if (tally.path === "") {
      anonymousKeys.push(tally.key);
      anonymousInputs.push(tally.input);
      continue;
    }
    const row = rowByPath.get(tally.path);
    if (row) ledger.set(tally.key, row);
  }

  if (anonymousKeys.length > 0) {
    // 无 SessionMeta 的输入没有 path 可以对账（只出现在测试夹具里，真实扫描必定
    // 带 session）。对每个匿名输入单独问一次 daySessionsOf 取它自己的读数，再按
    // V1 的同一条排序（token 降序 → 标题 → 路径）与整天的行表对齐；两边的值来自
    // 同一个函数，所以配对是确定的。
    const anonymousRows = base.rows.filter((row) => row.path === "");
    const ranked = anonymousInputs
      .map((input, position) => ({
        key: anonymousKeys[position],
        own: daySessionsOf([input], dayStart, { top: 1 }).rows[0]
      }))
      .sort((a, b) => b.own.tokens - a.own.tokens || a.own.title.localeCompare(b.own.title));
    ranked.forEach(({ key }, position) => {
      const row = anonymousRows[position];
      if (row) ledger.set(key, row);
    });
  }

  const rows: DaySessionSpan[] = [];
  for (const tally of tallies.values()) {
    if (tally.messages === 0) continue;
    const row = ledger.get(tally.key);
    if (!row) continue; // 防御：tallies 与 base.rows 是同一批会话，正常不可达
    rows.push({
      path: row.path,
      title: row.title,
      projectLabel: row.projectLabel,
      projectPath: row.projectPath,
      start: tally.start,
      end: tally.end,
      durationMs: tally.end - tally.start,
      crossDay: tally.crossDay,
      hourly: tally.hourly,
      messages: tally.messages,
      tokens: row.tokens,
      costUsd: row.costUsd,
      hasUnknownCost: row.hasUnknownCost,
      share: row.share
    });
  }
  rows.sort(
    (a, b) =>
      a.start - b.start ||
      a.end - b.end ||
      a.title.localeCompare(b.title) ||
      a.path.localeCompare(b.path)
  );

  // 摘要：tokens 用 daySessionsOf 的当日总量，其余与行表同一份账（求和 / 计数）。
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  let costUsd = 0;
  let messages = 0;
  let hasUnknownCost = false;
  for (const row of rows) {
    costUsd += row.costUsd;
    messages += row.messages;
    if (row.hasUnknownCost) hasUnknownCost = true;
    if (firstAt === null || row.start < firstAt) firstAt = row.start;
    if (lastAt === null || row.end > lastAt) lastAt = row.end;
  }

  const dayRecords: SessionRecord[] = [];
  for (const source of inputs) {
    for (const record of source.records) {
      if (!countsAsMessage(record)) continue;
      if (dayStartOf(record.timestamp) !== dayStart) continue;
      dayRecords.push(record);
    }
  }
  // 模型口径与用量页一致（记录自带的 model，缺失按 UNKNOWN_MODEL_LABEL —— 这条
  // 兜底住在 aggregateSession 里），复用页面自己的聚合——不重造第二套模型分桶。
  let topModel: { id: string; tokens: number } | null = null;
  for (const [id, bucket] of aggregateSession(dayRecords).models) {
    const tokens = totalsSum(bucket);
    const beats =
      topModel === null ||
      tokens > topModel.tokens ||
      (tokens === topModel.tokens && id.localeCompare(topModel.id) < 0);
    if (beats) topModel = { id, tokens };
  }
  if (topModel !== null && topModel.tokens <= 0) topModel = null;

  const { key, colorOf } = projectColorsOf(rows);

  return {
    summary: {
      dayStart,
      tokens: base.dayTokens,
      costUsd,
      hasUnknownCost,
      sessions: base.sessions,
      messages,
      firstAt,
      lastAt,
      spanMs: firstAt === null || lastAt === null ? 0 : lastAt - firstAt,
      topModel,
      projects: new Set(rows.map((row) => row.projectLabel)).size
    },
    rows,
    key,
    colorOf
  };
}

/**
 * 项目色档（规格 §3.4）：单项目日全部色档 1 且色键为空；≥2 个项目按当日 token
 * 降序（并列按 label 字典序），前 5 名占 1..5，其后并入色档 6（折尾行 `其他`）。
 */
function projectColorsOf(rows: readonly DaySessionSpan[]): {
  key: DayProjectEntry[];
  colorOf: Map<string, number>;
} {
  const tokensByLabel = new Map<string, number>();
  const pathByLabel = new Map<string, string>();
  for (const row of rows) {
    tokensByLabel.set(row.projectLabel, (tokensByLabel.get(row.projectLabel) ?? 0) + row.tokens);
    if (row.projectPath && !pathByLabel.has(row.projectLabel)) {
      pathByLabel.set(row.projectLabel, row.projectPath);
    }
  }

  const colorByLabel = new Map<string, number>();
  const key: DayProjectEntry[] = [];
  const labels = [...tokensByLabel.keys()];
  if (labels.length === 1) {
    colorByLabel.set(labels[0], 1);
  } else if (labels.length >= 2) {
    const ranked = labels
      .map((label) => ({ label, tokens: tokensByLabel.get(label) ?? 0 }))
      .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
    ranked.slice(0, DAY_PROJECT_COLOR_CAP).forEach((entry, position) => {
      const color = position + 1;
      colorByLabel.set(entry.label, color);
      key.push({
        label: entry.label,
        ...(pathByLabel.has(entry.label) ? { path: pathByLabel.get(entry.label) } : {}),
        tokens: entry.tokens,
        color,
        folded: 0
      });
    });
    const tail = ranked.slice(DAY_PROJECT_COLOR_CAP);
    if (tail.length > 0) {
      for (const entry of tail) colorByLabel.set(entry.label, DAY_PROJECT_COLOR_CAP + 1);
      key.push({
        label: OTHER_LABEL,
        tokens: tail.reduce((sum, entry) => sum + entry.tokens, 0),
        color: DAY_PROJECT_COLOR_CAP + 1,
        folded: tail.length
      });
    }
  }

  // 行取色：path 是唯一键。无元数据的行 path 是空串，此时后写的档位覆盖前面的
  // ——这类行只出现在测试夹具里，真实扫描必定带 session。
  const colorOf = new Map<string, number>();
  for (const row of rows) {
    colorOf.set(row.path, colorByLabel.get(row.projectLabel) ?? 1);
  }
  return { key, colorOf };
}
