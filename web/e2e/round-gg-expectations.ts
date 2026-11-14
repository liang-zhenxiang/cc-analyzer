import { formatTokenCount, formatUsd } from "../src/lib/format";
import { contextQuantiles } from "../src/features/usage/contextQuantiles";
import { projectSeasons, type ProjectSeasonRow } from "../src/features/usage/projectSeasons";
import { buildProjectCards } from "../src/features/usage/projectCards";
import { storyLog, type StoryDay } from "../src/features/usage/storyLog";
import {
  addLocalDays,
  dayStartOf,
  type UsageSessionInput
} from "../src/features/usage/usageAggregations";
import type { SessionRecord, SessionUsage } from "../src/features/sessions/types";

/**
 * Round GG e2e 的期望值——**一律从夹具 records + 运行时刻现算**，不写死任何
 * 「窗口里恰好有几条」的数字。
 *
 * 为什么必须现算：UI 的默认窗口是「最近 30 个本地日」（`startTs =
 * dayStartOf(now) - (days - 1)`，见 `UsageOverviewPage.tsx` / `usageAggregations.ts`）。
 * 夹具里 alpha/beta 的 Q4 会话钉在 **10-15**，于是同一份夹具在 11-13 运行
 * 时 Q4 还在窗内、11-14 起就滑到窗外——日历少一天、卡片少一个会话、上下文
 * 峰值从 330k 掉到 240k。写死 `toHaveCount(4)` / `1.1M` / `330k` 只是把新的
 * 日期钉死，换到 12 月、1 月、4 月还会再红一次（Issue #331）。
 *
 * 这里的函数直接调用**界面同一条**纯函数链（`storyLog` / `buildProjectCards`
 * / `projectSeasons` / `contextQuantiles`），而不是在 spec 里再手写一份过滤
 * 逻辑：三段重复的窗口过滤正是下一次漂移的来源。
 */

/** 夹具 JSONL 记录的松散形状（`roundGGRecords()` 的逐条 JSON）。 */
export type GgFixtureRecord = {
  type?: string;
  sessionId?: string;
  cwd?: string;
  uuid?: string;
  timestamp?: string;
  isCompactSummary?: boolean;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: string | Array<{ type?: string; is_error?: boolean; content?: unknown }>;
  };
};

/** snake_case 的夹具用量 → 聚合函数认的 camelCase。缺省的计数不补 0。 */
function usageOf(record: GgFixtureRecord): SessionUsage | undefined {
  const usage = record.message?.usage;
  if (!usage) return undefined;
  const converted: SessionUsage = {};
  if (typeof usage.input_tokens === "number") converted.inputTokens = usage.input_tokens;
  if (typeof usage.output_tokens === "number") converted.outputTokens = usage.output_tokens;
  if (typeof usage.cache_creation_input_tokens === "number") {
    converted.cacheCreationTokens = usage.cache_creation_input_tokens;
  }
  if (typeof usage.cache_read_input_tokens === "number") {
    converted.cacheReadTokens = usage.cache_read_input_tokens;
  }
  return Object.keys(converted).length > 0 ? converted : undefined;
}

/** 解析器只把「纯 tool_result」的 user 行喂给 tool 记录，不产出消息记录。 */
function isToolResultOnly(record: GgFixtureRecord): boolean {
  const content = record.message?.content;
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => block.type === "tool_result");
}

/**
 * 夹具 records → `UsageSessionInput[]`，按 sessionId 分组。
 *
 * 语义对齐 `parseJsonl`：system 行（压缩边界）被消费成事件、不进 records；
 * 纯 tool_result 的 user 行合并进 tool 记录；assistant 的 usage 原样保留。
 * 分组后每个会话的 `projectLabel` 与扫描层一致（cwd 的 `/` 换成 `-`），
 * 卡片与季节条才能按同一个 key 对对。
 */
export function toUsageInputs(records: readonly GgFixtureRecord[]): UsageSessionInput[] {
  const bySession = new Map<string, { cwd: string; records: SessionRecord[] }>();
  for (const record of records) {
    if (record.type !== "user" && record.type !== "assistant") continue;
    if (record.type === "user" && isToolResultOnly(record)) continue;
    const timestamp = record.timestamp ? Date.parse(record.timestamp) : Number.NaN;
    if (!Number.isFinite(timestamp)) continue;

    const sessionId = record.sessionId ?? record.cwd ?? "(unknown)";
    const cwd = record.cwd ?? "";
    let session = bySession.get(sessionId);
    if (!session) {
      session = { cwd, records: [] };
      bySession.set(sessionId, session);
    }

    const usage = usageOf(record);
    const model = record.message?.model;
    session.records.push({
      id: record.uuid ?? sessionId,
      fullId: record.uuid ?? sessionId,
      kind: record.type,
      timestamp,
      durationMs: 0,
      text: "",
      isError: false,
      ...(model ? { model } : {}),
      ...(usage ? { usage } : {}),
      ...(record.isCompactSummary === true ? { compactSummary: true } : {}),
      raw: record
    });
  }

  return [...bySession.values()].map(({ cwd, records: sessionRecords }) => ({
    records: sessionRecords,
    projectLabel: cwd.replace(/\//g, "-"),
    projectPath: cwd
  }));
}

/** 窗口起点：`dayStartOf(now) - (days - 1)` 个本地日，含今天。 */
export function roundGgWindowStart(now: number, days = 30): number {
  return addLocalDays(dayStartOf(now), -(Math.max(1, Math.floor(days)) - 1));
}

/** 与页面 `shapeInputs` / `contextQuantilesWindow` 同款：先按窗口截 records。 */
function windowedInputs(
  records: readonly GgFixtureRecord[],
  now: number,
  days: number
): UsageSessionInput[] {
  const startTs = roundGgWindowStart(now, days);
  return toUsageInputs(records).map((input) => ({
    ...input,
    records: input.records.filter((record) => record.timestamp >= startTs)
  }));
}

/**
 * G1 的日行序列。入参与 `StoryLogPanel` 一致：窗口化后的会话交给 `storyLog`，
 * 每个会话归属**首条窗口内记录**的本地日，输出按日期倒序。
 */
export function roundGgStoryDays(
  records: readonly GgFixtureRecord[],
  now: number,
  days = 30
): StoryDay[] {
  return storyLog(windowedInputs(records, now, days));
}

/** 与 `StoryLogPanel` 的同名排版：`2 会话 · 1 项目 · 595,400 token · 最忙 09:00`。 */
export function storyDayMetaText(day: StoryDay): string {
  const hour =
    day.busiestHour === null ? "无消息" : `最忙 ${String(day.busiestHour).padStart(2, "0")}:00`;
  return `${day.sessions} 会话 · ${day.projects.length} 项目 · ${formatTokenCount(
    day.tokens
  )} token · ${hour}`;
}

export type RoundGgProjectCard = {
  displayName: string;
  sessions: number;
  tokens: number;
  tokensText: string;
  usd: number | null;
  costText: string;
  /** `Q1 12%、Q2 30%、Q3 18%、Q4 40%`（卡片 aria-label 末尾的全量读数）。 */
  seasonAria: string;
  /** `Q1 12% · Q2 30% · Q3 18% · Q4 40%`（卡片可见文字）。 */
  seasonText: string;
};

/**
 * `ProjectCardsPanel` 的 `seasonOf` + `seasonAria` + `seasonText` 同口径：
 * 模型行的逐季 token 按 Q1–Q4 合并（跨年同季相加），分母仍是项目自身总量。
 */
function seasonSharesOf(
  rows: readonly ProjectSeasonRow[],
  project: string
): [number, number, number, number] | null {
  const row = rows.find((entry) => entry.project === project);
  if (!row) return null;
  const tokens = [0, 0, 0, 0];
  for (const cell of row.quarters) tokens[cell.q - 1] += cell.tokens;
  const total = tokens.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return null;
  const shares = tokens.map((value) => value / total);
  return [shares[0], shares[1], shares[2], shares[3]];
}

/**
 * G8 的项目卡片读数：会话数 / token / 成本走 `buildProjectCards`（窗口口径），
 * 季节性走 `projectSeasons`（全历史月几何）。`cwd` 是夹具里的真实目录，
 * 卡片 `path` 就是它。
 */
export function roundGgProjectCard(
  records: readonly GgFixtureRecord[],
  now: number,
  cwd: string,
  days = 30
): RoundGgProjectCard {
  const inputs = toUsageInputs(records);
  const card = buildProjectCards(inputs, days, 8, now).find((entry) => entry.path === cwd);
  if (!card) throw new Error(`夹具里没有 ${cwd} 在窗口内可展示的项目卡`);

  const shares = seasonSharesOf(projectSeasons(inputs, now), card.label);
  return {
    displayName: card.displayName,
    sessions: card.sessions,
    tokens: card.tokens,
    tokensText: formatTokenCount(card.tokens),
    usd: card.usd,
    costText: card.usd === null ? "定价未知" : formatUsd(card.usd),
    seasonAria: shares
      ? shares.map((share, index) => `Q${index + 1} ${Math.round(share * 100)}%`).join("、")
      : "",
    seasonText: shares
      ? shares
          .map((share, index) =>
            share > 0 ? `Q${index + 1} ${Math.round(share * 100)}%` : `Q${index + 1} 无记录`
          )
          .join(" · ")
      : ""
  };
}

/**
 * `CompactionStatsPanel` 的本地格式化（design §G7）：< 1k 原样、< 1M 一位小数
 * 的 k（尾 0 去掉）、≥ 1M 交给 `formatTokenCount`。组件没导出这个函数，
 * 期望值这边照抄同一套规则（改动组件时两处一起看）。
 */
function formatQuantile(value: number): string {
  if (value < 1000) return value.toLocaleString("en-US");
  if (value < 1_000_000) {
    const k = (value / 1000).toFixed(1);
    return `${k.endsWith(".0") ? k.slice(0, -2) : k}k`;
  }
  return formatTokenCount(value);
}

export type RoundGgQuantiles = {
  /** 参与统计的会话数（含窗口外、峰值为 0 的会话——与页面一致）。 */
  count: number;
  maxText: string;
  p90Text: string;
};

/**
 * G7 的上下文峰值分位。页面把**全部** inputs 按窗口截 records 后交给
 * `contextQuantiles`（窗口外会话以峰值 0 参与），这里复刻同一条路径。
 */
export function roundGgContextQuantiles(
  records: readonly GgFixtureRecord[],
  now: number,
  days = 30
): RoundGgQuantiles {
  const quantiles = contextQuantiles(windowedInputs(records, now, days));
  return {
    count: quantiles.count,
    maxText: quantiles.max === null ? "样本不足" : formatQuantile(quantiles.max),
    p90Text: quantiles.p90 === null ? "样本不足" : formatQuantile(quantiles.p90)
  };
}
