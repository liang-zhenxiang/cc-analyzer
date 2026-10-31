import type { SessionFacts } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { censusKeyId } from "./toolCensus";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 会话筛选（G2）：条件栏背后的纯过滤层。六个条件全部 AND 组合，
 * undefined / 空数组 = 该条件不筛。
 *
 * 口径全部复用既有权威来源，不自建第二套：
 *   - 上下文峰值（minContextPeak）：会话内 records 的 max(contextTokens)，
 *     contextTokens = input + cacheCreation + cacheRead（contextSeriesOf 同源
 *     的「整份提示词」口径）。会话没有任何带 usage 的记录时峰值为 0——
 *     一个没有读数的会话过不了任何 >0 的阈值，这是「筛出真读过大上下文
 *     的会话」想要的语义。
 *   - 工具匹配（toolKey）：censusKeyId 的字符串身份（`builtin:Bash`、
 *     `mcp:<server>`…）。一个会话命中 = 它的 toolCalls 事实里存在该桶的
 *     调用。手造输入没有 toolCalls 字段时对工具条件恒不命中（没有事实
 *     就没有证据，toolCensus 同款语义）。
 *   - 时长（minDurationMin）：首末记录 timestamp 差（墙钟跨度，与
 *     workHabits.longestSessionMinutes / sessionGantt 同口径；不看
 *     durationMs——那不含等待，问的是「会话开了多久」）。
 *   - 项目/模型/错误是直白的集合/布尔判定：projects/models 传入数组任一
 *     命中即过（OR within, AND across——条件栏的多选语义）；hasError 按
 *     records 里是否存在 isError 的记录（或 errorExtract 有事件）。
 *
 * `queryOptions` 从数据推导条件栏的下拉数据源：项目/模型/工具各按
 * **会话数**降序（工具按「用到它的会话数」，与桶的 sessions 字段同思
 * 路），并列按标签字典序——排序口径与 topSlices 的「值降序 + label
 * 字典序」同族，保证同输入同输出。
 */

/** 条件栏的六个条件，全部可选；AND 组合。 */
export type SessionQuery = {
  /** 命中任一即过；空数组/undefined = 不筛。 */
  projects?: string[];
  /** 命中任一即过；模型取 usage 记录的 model 字段（缺省归「未知模型」）。 */
  models?: string[];
  /** censusKeyId 形状的桶身份。 */
  toolKey?: string;
  /** true = 只要有错误；false = 必须无错误；undefined = 不筛。 */
  hasError?: boolean;
  /** 上下文峰值 ≥ 此值（token 数）。 */
  minContextPeak?: number;
  /** 首末记录间隔 ≥ 此值（分钟）。 */
  minDurationMin?: number;
};

/** 一次带计数的下拉选项。count 是「选它会留下多少个会话」的基数。 */
export type QueryOption = { label: string; count: number };

export type QueryOptions = {
  projects: QueryOption[];
  models: QueryOption[];
  tools: QueryOption[];
};

export const UNKNOWN_MODEL_LABEL = "未知模型";

/** 上下文峰值：带 usage 记录的 max(input + cacheCreation + cacheRead)。 */
function contextPeakOf(records: readonly SessionRecord[]): number {
  let peak = 0;
  for (const record of records) {
    const usage: SessionUsage | undefined = record.usage;
    if (!usage) continue;
    const context =
      (usage.inputTokens ?? 0) +
      (usage.cacheCreationTokens ?? 0) +
      (usage.cacheReadTokens ?? 0);
    if (context > peak) peak = context;
  }
  return peak;
}

/** 首末 timestamp 差（分钟，浮点）；records 少于 2 条为 0。 */
function durationMinutesOf(records: readonly SessionRecord[]): number {
  if (records.length === 0) return 0;
  let first = records[0].timestamp;
  let last = records[0].timestamp;
  for (const record of records) {
    if (record.timestamp < first) first = record.timestamp;
    if (record.timestamp > last) last = record.timestamp;
  }
  return (last - first) / 60_000;
}

/** 会话有没有错误：主链记录 isError，或 errorExtract 提取到事件（含 sidechain）。 */
function hasErrorOf(session: UsageSessionInput): boolean {
  if (session.errorExtract && session.errorExtract.events.length > 0) return true;
  return session.records.some((record) => record.isError);
}

/** 会话用过的模型集合（带 usage 记录的 model，缺省归「未知模型」）。 */
function modelsOf(session: UsageSessionInput): Set<string> {
  const models = new Set<string>();
  for (const record of session.records) {
    if (!record.usage) continue;
    models.add(record.model ?? UNKNOWN_MODEL_LABEL);
  }
  return models;
}

/** 会话碰过的工具桶身份集合（censusKeyId）。 */
function toolKeysOf(session: UsageSessionInput): Set<string> {
  const keys = new Set<string>();
  for (const fact of session.toolCalls ?? []) {
    keys.add(censusKeyId(fact.key));
  }
  return keys;
}

function matches(session: UsageSessionInput, query: SessionQuery): boolean {
  const { projects, models, toolKey, hasError, minContextPeak, minDurationMin } = query;

  if (projects && projects.length > 0 && !projects.includes(session.projectLabel)) {
    return false;
  }
  if (models && models.length > 0) {
    const sessionModels = modelsOf(session);
    const hit = models.some((model) => sessionModels.has(model));
    if (!hit) return false;
  }
  if (toolKey !== undefined && !toolKeysOf(session).has(toolKey)) {
    return false;
  }
  if (hasError !== undefined && hasErrorOf(session) !== hasError) {
    return false;
  }
  if (minContextPeak !== undefined && contextPeakOf(session.records) < minContextPeak) {
    return false;
  }
  if (minDurationMin !== undefined && durationMinutesOf(session.records) < minDurationMin) {
    return false;
  }
  return true;
}

/**
 * AND 组合过滤。返回新数组，输入顺序保留（会话列表的既有排序不被筛选
 * 改写）；不做任何排序——排序是列表层的事。
 */
export function querySessions(
  sessions: readonly UsageSessionInput[],
  query: SessionQuery
): UsageSessionInput[] {
  return sessions.filter((session) => matches(session, query));
}

/** 计数选项的公共排序：count 降序，并列 label 字典序。 */
function sortByCount(options: QueryOption[]): QueryOption[] {
  return options.sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
}

/**
 * 从数据推导条件栏的下拉数据源：每个选项带「选它会留下多少个会话」的
 * count（即包含该值的会话数）。工具选项的 label 是 censusKeyId，count 是
 * 用到该桶的会话数——与 census 桶的 sessions 字段同一思路。
 */
export function queryOptions(sessions: readonly UsageSessionInput[]): QueryOptions {
  const projects = new Map<string, number>();
  const models = new Map<string, number>();
  const tools = new Map<string, number>();

  for (const session of sessions) {
    projects.set(session.projectLabel, (projects.get(session.projectLabel) ?? 0) + 1);

    for (const model of modelsOf(session)) {
      models.set(model, (models.get(model) ?? 0) + 1);
    }
    // 一个桶在同会话多次出现只记一个会话（Set 去重）。
    for (const key of toolKeysOf(session)) {
      tools.set(key, (tools.get(key) ?? 0) + 1);
    }
  }

  const toOptions = (map: Map<string, number>): QueryOption[] =>
    sortByCount([...map].map(([label, count]) => ({ label, count })));

  return {
    projects: toOptions(projects),
    models: toOptions(models),
    tools: toOptions(tools)
  };
}

/**
 * 已建索引的一行（会话列表用）：只有事实，没有 records。
 *
 * 与 `UsageSessionInput` 的区别是**不重读日志**：`facts` 在建立索引那趟算好，
 * 会话列表的六条件过滤只消费它。两套入口必须给出同样的结论——改
 * `matches` 的任何一个条件，都要同步改 `matchesFacts`（有测试逐条对账）。
 */
export type SessionQueryRow = {
  projectLabel: string;
  facts: SessionFacts;
};

/** 六条件 AND 过滤（事实版）。语义与 {@link querySessions} 逐条相同。 */
export function matchesSessionFacts(row: SessionQueryRow, query: SessionQuery): boolean {
  const { facts, projectLabel } = row;
  if (query.projects && query.projects.length > 0 && !query.projects.includes(projectLabel)) {
    return false;
  }
  if (query.models && query.models.length > 0 && !query.models.some((model) => facts.models.includes(model))) {
    return false;
  }
  if (query.toolKey !== undefined && !facts.tools.includes(query.toolKey)) {
    return false;
  }
  if (query.hasError !== undefined && (facts.errors > 0) !== query.hasError) {
    return false;
  }
  if (query.minContextPeak !== undefined && facts.ctxPeak < query.minContextPeak) {
    return false;
  }
  if (query.minDurationMin !== undefined && facts.durationMs / 60_000 < query.minDurationMin) {
    return false;
  }
  return true;
}

/** 条件栏数据源（事实版）：与 {@link queryOptions} 同排序、同口径。 */
export function queryOptionsFromFacts(rows: readonly SessionQueryRow[]): QueryOptions {
  const projects = new Map<string, number>();
  const models = new Map<string, number>();
  const tools = new Map<string, number>();

  for (const row of rows) {
    projects.set(row.projectLabel, (projects.get(row.projectLabel) ?? 0) + 1);
    for (const model of row.facts.models) models.set(model, (models.get(model) ?? 0) + 1);
    for (const tool of row.facts.tools) tools.set(tool, (tools.get(tool) ?? 0) + 1);
  }

  const toOptions = (map: Map<string, number>): QueryOption[] =>
    sortByCount([...map].map(([label, count]) => ({ label, count })));

  return {
    projects: toOptions(projects),
    models: toOptions(models),
    tools: toOptions(tools)
  };
}
