import type { SessionRecord, SessionUsage } from "../sessions/types";
import {
  formatDuration,
  formatModelId,
  formatProjectPath,
  formatTokenCount
} from "../../lib/format";
import {
  addLocalDays,
  dayStartOf,
  type UsageSessionInput
} from "./usageAggregations";
import { classifyToolUse, toolCensus, type ToolCallFact } from "./toolCensus";
import { compactionStats } from "./compactionStats";
import { contextQuantiles } from "./contextQuantiles";
import { errorSignature } from "./errorArchive";

/**
 * 数据故事 Chronicle（Issue #313）：把窗口内的本地日志写成一篇有章节的短文。
 *
 * 这一层只做「读数据 → 拼文章」，零 I/O、零 `Date.now()`（时钟由参数传入），
 * 因此同一份输入永远得到同一篇故事。每个数字都必须能在现有面板里复算：
 * token / 会话 / 工具 / 错误 / 压缩全部复用既有聚合的权威口径，不另起炉灶。
 *
 * 时间窗与 `aggregateRange` / `toolCensus` / `compactionStats` 完全一致：
 * 最近 `days` 个**本地日**（含今天），记录按时间戳下界裁剪。会话跨窗口边缘时
 * 只讲窗口内的那一段。
 *
 * 章节取舍：数据不足以支撑的整章省略（无工具调用、没有可计时的会话等），
 * 省略后按实际输出顺序重排 1-based 编号——读者不应该看到「第 5 章」跳号。
 * 少于 3 章时整篇为空态：两章撑不起「一篇故事」的阅读节奏。
 */

export type ChronicleChart =
  | { kind: "sparkline"; values: number[] }
  | { kind: "bars"; values: number[]; labels: string[] };

export type ChronicleChapter = {
  id: string;
  /** 1-based，按实际输出顺序重排（省略章节后不留空号）。 */
  index: number;
  /** 「第 2 章 · 最忙的一天」。 */
  kicker: string;
  title: string;
  /** 已格式化的大数字（如 "302,500"）。 */
  stat: string;
  /** 「token」「分钟」「次」「个」。 */
  statUnit: string;
  /** 一句具体事实，必须含数字 / 日期 / 名称。 */
  body: string;
  /** 口径说明。 */
  footnote?: string;
  chart?: ChronicleChart;
};

export type Chronicle = {
  chapters: ChronicleChapter[];
  summary: string;
  empty: boolean;
};

/** 迷你柱图最多画最近 14 天：再多就不是「一眼看过」而是第二张趋势图了。 */
const MAX_CHART_DAYS = 14;

/** 错误签名在正文里的上限（码点）。错误面板的签名是 60 字，故事里再收紧。 */
const ERROR_SIGNATURE_MAX_CHARS = 40;

/** 章节草稿：`label` 是 kicker 的后半句，编号在最终排序时才拼。 */
type ChapterDraft = {
  id: string;
  label: string;
  title: string;
  stat: string;
  statUnit: string;
  body: string;
  footnote?: string;
  chart?: ChronicleChart;
};

type WindowedSession = { input: UsageSessionInput; records: SessionRecord[] };

type WindowStats = {
  windowDays: number;
  startTs: number;
  todayStart: number;
  /** 窗口内至少有一条记录的会话（顺序沿用输入顺序，供并列时稳定取舍）。 */
  sessions: WindowedSession[];
  projects: Set<string>;
  totalTokens: number;
  /** 至少有一条记录的本地日（含只有 user 消息、没有 token 读数的日子）。 */
  activeDays: Set<number>;
  /** 窗口内的记录总数（主链；sidechain 落在 errorExtract 的逐日分母里）。 */
  recordCount: number;
  dailyTokens: Map<number, number>;
  /** 每个本地日有哪些会话在活动（按 `sessions` 下标）。 */
  dailySessions: Map<number, Set<number>>;
};

type BusiestDay = { dayStart: number; tokens: number; sessions: number };

type ErrorFact = { timestamp: number; preview: string };

function usageSum(usage: SessionUsage): number {
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

/** 本地日 `MM-DD`（补零）。故事里不印年份——窗口最长也就一年出头。 */
function monthDayOf(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 按码点截断，不劈开代理对（emoji / 生僻字）。 */
function clipCodePoints(text: string, limit: number): string {
  const chars = Array.from(text);
  return chars.length <= limit ? text : chars.slice(0, limit).join("");
}

function isMessage(record: SessionRecord): boolean {
  // 与 aggregateSession.messages 同一判定：compact 摘要是续接产物，不是话。
  return (
    (record.kind === "user" || record.kind === "assistant") &&
    record.compactSummary !== true
  );
}

function collectWindow(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): WindowStats {
  const windowDays = Math.max(1, Math.floor(days));
  const todayStart = dayStartOf(now);
  const startTs = addLocalDays(todayStart, -(windowDays - 1));

  const sessions: WindowedSession[] = [];
  const projects = new Set<string>();
  const activeDays = new Set<number>();
  const dailyTokens = new Map<number, number>();
  const dailySessions = new Map<number, Set<number>>();
  let totalTokens = 0;
  let recordCount = 0;

  for (const input of inputs) {
    const records = input.records.filter((record) => record.timestamp >= startTs);
    if (records.length === 0) continue;

    const sessionIndex = sessions.length;
    sessions.push({ input, records });
    if (input.projectLabel) projects.add(input.projectLabel);

    for (const record of records) {
      recordCount += 1;
      const day = dayStartOf(record.timestamp);
      activeDays.add(day);

      let sessionsOfDay = dailySessions.get(day);
      if (!sessionsOfDay) {
        sessionsOfDay = new Set();
        dailySessions.set(day, sessionsOfDay);
      }
      sessionsOfDay.add(sessionIndex);

      if (!record.usage) continue;
      const tokens = usageSum(record.usage);
      totalTokens += tokens;
      dailyTokens.set(day, (dailyTokens.get(day) ?? 0) + tokens);
    }
  }

  return {
    windowDays,
    startTs,
    todayStart,
    sessions,
    projects,
    totalTokens,
    activeDays,
    recordCount,
    dailyTokens,
    dailySessions
  };
}

function openingChapter(stats: WindowStats): ChapterDraft | null {
  if (stats.sessions.length === 0) return null;

  const sessionCount = stats.sessions.length;
  const projectCount = stats.projects.size;
  const activeDayCount = stats.activeDays.size;
  const body =
    projectCount > 0
      ? `${projectCount} 个项目、${sessionCount} 个会话，落在 ${activeDayCount} 个活跃日里。`
      : `${sessionCount} 个会话，落在 ${activeDayCount} 个活跃日里。`;

  return {
    id: "opening",
    label: "起笔",
    title: `${stats.windowDays} 天里的 ${activeDayCount} 个活跃日`,
    stat: formatTokenCount(stats.totalTokens),
    statUnit: "token",
    body,
    footnote: `窗口 = 最近 ${stats.windowDays} 个本地日（含今天）；活跃日 = 至少有一条记录的日子。`
  };
}

/**
 * token 最高的本地日。并列取更早的一天：先到先得比「随机挑一个」诚实。
 * 只有真正消耗过 token 的日子才参与——全是 0 的窗口没有「最忙」可言。
 */
function busiestDayOf(stats: WindowStats): BusiestDay | null {
  let best: BusiestDay | null = null;
  for (const [dayStart, tokens] of stats.dailyTokens) {
    if (tokens <= 0) continue;
    if (
      !best ||
      tokens > best.tokens ||
      (tokens === best.tokens && dayStart < best.dayStart)
    ) {
      best = { dayStart, tokens, sessions: stats.dailySessions.get(dayStart)?.size ?? 0 };
    }
  }
  return best;
}

function daySeries(stats: WindowStats): Array<{ label: string; value: number }> {
  const series: Array<{ label: string; value: number }> = [];
  for (
    let day = stats.startTs;
    day <= stats.todayStart;
    day = addLocalDays(day, 1)
  ) {
    series.push({ label: monthDayOf(day), value: stats.dailyTokens.get(day) ?? 0 });
  }
  return series;
}

function busiestDayChapter(
  stats: WindowStats,
  busiest: BusiestDay | null
): ChapterDraft | null {
  if (!busiest) return null;

  const average =
    stats.activeDays.size > 0 ? stats.totalTokens / stats.activeDays.size : 0;
  const ratio = average > 0 ? busiest.tokens / average : 0;
  const comparison =
    stats.activeDays.size >= 2 && average > 0
      ? `是日均的 ${ratio.toFixed(1)} 倍`
      : "这是窗口里唯一有消耗的一天";

  const series = daySeries(stats).slice(-MAX_CHART_DAYS);

  return {
    id: "busiest-day",
    label: "最忙的一天",
    title: `${monthDayOf(busiest.dayStart)} 是这 ${stats.windowDays} 天里最重的一天`,
    stat: formatTokenCount(busiest.tokens),
    statUnit: "token",
    body: `${monthDayOf(busiest.dayStart)} 这天记入了 ${formatTokenCount(busiest.tokens)} token，来自 ${busiest.sessions} 个会话；${comparison}。`,
    footnote: `日均 = 窗口总 token ÷ ${Math.max(1, stats.activeDays.size)} 个活跃日；按本地日归属。`,
    chart: {
      kind: "bars",
      values: series.map((point) => point.value),
      labels: series.map((point) => point.label)
    }
  };
}

/**
 * 墙钟跨度最长的一次会话：首末记录的间隔（与 sessionDurations 同口径）。
 * 单记录 / 零跨度量不出「持续」，整章省略——0ms 的「最长」是假读数。
 */
function longestSessionChapter(stats: WindowStats): ChapterDraft | null {
  let best: { input: UsageSessionInput; records: SessionRecord[]; span: number; first: number } | null =
    null;

  for (const { input, records } of stats.sessions) {
    if (records.length < 2) continue;
    let first = records[0].timestamp;
    let last = records[0].timestamp;
    for (const record of records) {
      if (record.timestamp < first) first = record.timestamp;
      if (record.timestamp > last) last = record.timestamp;
    }
    const span = last - first;
    if (span <= 0) continue;
    if (
      !best ||
      span > best.span ||
      (span === best.span && first < best.first)
    ) {
      best = { input, records, span, first };
    }
  }

  if (!best) return null;

  const messages = best.records.filter(isMessage).length;
  // 项目名走 formatProjectPath 的展示口径（有 cwd 时取 basename），
  // 绝不把绝对路径写进故事。
  const project =
    formatProjectPath(best.input.projectLabel, best.input.projectPath) || "未命名项目";
  // 大数字要按量级换单位：2,895 分钟读不出来，2 天一秒就懂。与 P2-13
  // 「长时长按天/小时」同一规则；精确值留给正文的 formatDuration。
  const duration = durationStat(best.span);

  return {
    id: "longest-session",
    label: "最长的一次会话",
    title: `最长的一次会话在 ${project}`,
    stat: duration.stat,
    statUnit: duration.unit,
    body: `${project} 的这个会话从 ${monthDayOf(best.first)} 起跑了 ${formatDuration(best.span)}，里面有 ${messages} 条消息。`,
    footnote: "跨度 = 会话在窗口内首末记录的墙钟间隔，不是活跃时长。"
  };
}


/** 大数字的时长单位：天 / 小时 / 分钟 / 秒，每个量级只保留一位小数。 */
function durationStat(spanMs: number): { stat: string; unit: string } {
  const trim = (value: string) => (value.endsWith(".0") ? value.slice(0, -2) : value);
  const hours = spanMs / 3_600_000;
  if (hours >= 24) return { stat: trim((spanMs / 86_400_000).toFixed(1)), unit: "天" };
  if (hours >= 1) return { stat: trim(hours.toFixed(1)), unit: "小时" };
  const minutes = Math.round(spanMs / 60_000);
  if (minutes >= 1) return { stat: String(minutes), unit: "分钟" };
  return { stat: String(Math.round(spanMs / 1000)), unit: "秒" };
}

/** 一个会话的主模型：窗口内 usage token 最多的那个。 */
function dominantModelOf(
  records: readonly SessionRecord[]
): { model: string; tokens: number } | null {
  const byModel = new Map<string, number>();
  for (const record of records) {
    // 只认同时带 model 与 usage 的记录：没有 model 的 usage 记录证明不了
    // 是哪个模型，硬塞进「未知模型」会让迁徙故事出现一个虚构的起点。
    if (!record.model || !record.usage) continue;
    byModel.set(record.model, (byModel.get(record.model) ?? 0) + usageSum(record.usage));
  }

  let best: { model: string; tokens: number } | null = null;
  for (const [model, tokens] of byModel) {
    if (
      !best ||
      tokens > best.tokens ||
      (tokens === best.tokens && model.localeCompare(best.model) < 0)
    ) {
      best = { model, tokens };
    }
  }
  return best;
}

/** 窗口内的第几天（1-based，本地日历日；DST 安全，与 modelTimeline 同法）。 */
function dayIndexInWindow(ts: number, startTs: number): number {
  const target = dayStartOf(ts);
  let cursor = startTs;
  let index = 1;
  while (cursor < target) {
    cursor = addLocalDays(cursor, 1);
    index += 1;
  }
  return index;
}

function modelChapter(stats: WindowStats): ChapterDraft | null {
  const ordered: Array<{ first: number; model: string }> = [];
  for (const { records } of stats.sessions) {
    const dominant = dominantModelOf(records);
    if (!dominant) continue;
    let first = records[0].timestamp;
    for (const record of records) {
      if (record.timestamp < first) first = record.timestamp;
    }
    ordered.push({ first, model: dominant.model });
  }
  if (ordered.length === 0) return null;

  // 按会话在窗口内的首次记录时间排序（Array#sort 稳定，并列沿用输入顺序）。
  ordered.sort((a, b) => a.first - b.first);
  const firstModel = ordered[0].model;
  const lastModel = ordered[ordered.length - 1].model;

  // 去重模型数：窗口内所有「带 model 的 usage 记录」——比只看首尾会话
  // 更能说明「你到底用过几种模型」。
  const models = new Set<string>();
  for (const { records } of stats.sessions) {
    for (const record of records) {
      if (record.model && record.usage) models.add(record.model);
    }
  }
  const distinct = models.size;
  const firstLabel = formatModelId(firstModel);
  const lastLabel = formatModelId(lastModel);

  if (firstModel === lastModel) {
    const single = distinct === 1;
    return {
      id: "model-migration",
      label: "模型的迁徙",
      title: single ? "你只用了一种模型" : `你又回到了 ${lastLabel}`,
      stat: String(distinct),
      statUnit: "种模型",
      body: single
        ? `${ordered.length} 个有模型记录的会话全部落在 ${firstLabel} 上。`
        : `首尾两次的主模型都是 ${firstLabel}，窗口里还出现过 ${distinct - 1} 种其他模型。`,
      footnote: "每个会话取窗口内 usage token 最多的模型；只认带 model 字段的 usage 记录。"
    };
  }

  const switchSession = ordered.find((session) => session.model !== firstModel);
  if (!switchSession) return null;
  const switchDay = dayIndexInWindow(switchSession.first, stats.startTs);

  return {
    id: "model-migration",
    label: "模型的迁徙",
    title: `从 ${firstLabel} 迁到 ${lastLabel}`,
    stat: String(distinct),
    statUnit: "种模型",
    body: `切换发生在窗口第 ${switchDay} 天（${monthDayOf(switchSession.first)}）；窗口的最后一个会话以 ${lastLabel} 为主。`,
    footnote: "每个会话取窗口内 usage token 最多的模型；只认带 model 字段的 usage 记录。"
  };
}

/**
 * 手造输入（没有 toolCalls 事实）的兜底：从 records 的 tool 行推导。
 * 生产扫描一定带 `extractToolCalls` 的产物（含 sidechain），所以这条路径
 * 不会与普查口径在同一份数据里混用；它存在的意义是让纯模型能被不含
 * 解析器的夹具直接驱动。
 */
function deriveToolCalls(records: readonly SessionRecord[]): ToolCallFact[] {
  const facts: ToolCallFact[] = [];
  for (const record of records) {
    if (record.kind !== "tool" || !record.toolName) continue;
    facts.push({
      key: classifyToolUse(record.toolName, record.toolInput),
      timestamp: record.timestamp,
      sidechain: record.isSidechain === true
    });
  }
  return facts;
}

function toolChapter(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): ChapterDraft | null {
  const withFacts = inputs.map((input) =>
    input.toolCalls ? input : { ...input, toolCalls: deriveToolCalls(input.records) }
  );
  const census = toolCensus(withFacts, days, now);
  const total = census.totalCalls.withSidechain;
  const top = census.buckets[0];
  if (total === 0 || !top) return null;

  const calls = top.callsWithSidechain;
  const share = Math.round((calls / total) * 100);

  return {
    id: "tool-handprint",
    label: "工具的手印",
    title: `${top.label} 是你的手印`,
    stat: calls.toLocaleString("en-US"),
    statUnit: "次",
    body: `${top.label} 被调用了 ${calls.toLocaleString("en-US")} 次，占全部调用的 ${share}%，跨 ${top.sessions} 个会话。`,
    footnote: "调用数含子 agent（sidechain）行，与工具普查同口径。"
  };
}

/**
 * 窗口内的错误事件。有 `errorExtract` 时只吃它——错误面板的分子就是这个
 * 通道（含子 agent、排除「等用户输入」的拒绝），故事里的错误数必须能与
 * 那一页对上；没有提取结果的手造输入才退回 records 的 isError。
 */
function collectErrors(
  inputs: readonly UsageSessionInput[],
  startTs: number
): ErrorFact[] {
  const facts: ErrorFact[] = [];
  for (const input of inputs) {
    if (input.errorExtract) {
      for (const event of input.errorExtract.events) {
        if (event.timestamp >= startTs) {
          facts.push({ timestamp: event.timestamp, preview: event.preview });
        }
      }
      continue;
    }
    for (const record of input.records) {
      if (record.timestamp < startTs || !record.isError) continue;
      facts.push({ timestamp: record.timestamp, preview: record.toolResult ?? record.text });
    }
  }
  return facts;
}

function errorChapter(
  stats: WindowStats,
  inputs: readonly UsageSessionInput[]
): ChapterDraft | null {
  const facts = collectErrors(inputs, stats.startTs);
  if (stats.recordCount === 0 && facts.length === 0) return null;

  const count = facts.length;
  const stat = count.toLocaleString("en-US");
  const records = stats.recordCount.toLocaleString("en-US");

  if (count === 0) {
    return {
      id: "errors",
      label: "错误的痕迹",
      title: "没有留下错误",
      stat,
      statUnit: "条失败",
      body: `这个窗口的 ${records} 条记录里没有失败。`,
      footnote: "错误口径与错误面板同源（含子 agent 行）；N 为窗口内的主链记录数。"
    };
  }

  const signatures = new Map<string, { count: number; firstAt: number }>();
  for (const fact of facts) {
    const signature = errorSignature(fact.preview);
    const bucket = signatures.get(signature);
    if (bucket) bucket.count += 1;
    else signatures.set(signature, { count: 1, firstAt: fact.timestamp });
  }

  // 次数降序 → 首次出现升序 → 签名字典序：同样的错误集合永远得到同样的签署。
  const ranked = [...signatures]
    .map(([signature, bucket]) => ({ signature, ...bucket }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.firstAt - b.firstAt ||
        a.signature.localeCompare(b.signature)
    );
  const top = ranked[0];
  if (!top) return null;

  const short = clipCodePoints(top.signature, ERROR_SIGNATURE_MAX_CHARS);

  return {
    id: "errors",
    label: "错误的痕迹",
    title: `最常见的是「${short}」`,
    stat,
    statUnit: "条失败",
    // 有失败时不再拿主链记录数当分母：错误事件可能来自 sidechain（不在
    // records 里），两个域混在一句话里会算出一个对不上的比例。
    body: `窗口里留下了 ${stat} 条失败，其中 ${top.count.toLocaleString("en-US")} 条是同一个签名。`,
    footnote: `签名取错误首行、折叠路径与数字后截前 ${ERROR_SIGNATURE_MAX_CHARS} 字。`
  };
}

function compactionChapter(
  stats: WindowStats,
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): ChapterDraft | null {
  const compaction = compactionStats(inputs, days, now);
  if (stats.recordCount === 0 && compaction.count === 0) return null;

  if (compaction.count > 0) {
    let latest = Number.NEGATIVE_INFINITY;
    for (const input of inputs) {
      for (const event of input.compactEvents ?? []) {
        if (event.timestamp >= stats.startTs && event.timestamp > latest) {
          latest = event.timestamp;
        }
      }
    }

    const parts = [`窗口里压缩了 ${compaction.count.toLocaleString("en-US")} 次`];
    // 混合触发才值得分开说；全是 auto 或全是 manual 时这句话没有增量信息。
    if (compaction.autoCount > 0 && compaction.autoCount < compaction.count) {
      parts.push(`其中 ${compaction.autoCount.toLocaleString("en-US")} 次自动触发`);
    }
    if (Number.isFinite(latest)) parts.push(`最近一次在 ${monthDayOf(latest)}`);
    if (compaction.droppedTokens > 0) {
      parts.push(`前后腾出了 ${formatTokenCount(compaction.droppedTokens)} token`);
    }

    return {
      id: "compaction",
      label: "上下文的重置",
      title: `上下文重置了 ${compaction.count.toLocaleString("en-US")} 次`,
      stat: compaction.count.toLocaleString("en-US"),
      statUnit: "次",
      body: `${parts.join("，")}。`,
      footnote: "压缩口径与压缩面板同源；次数 = 窗口内的 compact 边界数。"
    };
  }

  // 零压缩：用上下文峰值 P90 作对照。样本不足 2 个会话时不给分位数——
  // 单会话没有「分布」（contextQuantiles 自己的规则，不在这里另设阈值）。
  const windowedInputs = stats.sessions.map(({ input, records }) => ({
    ...input,
    records
  }));
  const p90 = windowedInputs.length >= 2 ? contextQuantiles(windowedInputs).p90 : null;

  return {
    id: "compaction",
    label: "上下文的重置",
    title: "没有触发过上下文压缩",
    stat: "0",
    statUnit: "次",
    body:
      p90 === null
        ? "这个窗口没有触发过上下文压缩。"
        : `这个窗口没有触发过上下文压缩；上下文峰值 P90 是 ${formatTokenCount(p90)} token。`,
    footnote: "P90 用最近邻分位；样本不足 2 个会话时不给分位数。"
  };
}

function summaryOf(stats: WindowStats, busiest: BusiestDay | null): string {
  const head =
    stats.projects.size > 0
      ? `这 ${stats.windowDays} 天，你在 ${stats.projects.size} 个项目里留下了 ${stats.sessions.length} 个会话`
      : `这 ${stats.windowDays} 天，你留下了 ${stats.sessions.length} 个会话`;
  const tail = busiest ? `；最重的一天是 ${monthDayOf(busiest.dayStart)}` : "";
  return `${head}${tail}。`;
}

export function buildChronicle(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): Chronicle {
  const stats = collectWindow(inputs, days, now);
  const busiest = busiestDayOf(stats);

  const drafts: ChapterDraft[] = [];
  const push = (draft: ChapterDraft | null) => {
    if (draft) drafts.push(draft);
  };

  push(openingChapter(stats));
  push(busiestDayChapter(stats, busiest));
  push(longestSessionChapter(stats));
  push(modelChapter(stats));
  push(toolChapter(inputs, days, now));
  push(errorChapter(stats, inputs));
  push(compactionChapter(stats, inputs, days, now));

  // 两章撑不起一篇故事：空态由调用方渲染，模型层不编造填充章节。
  if (drafts.length < 3) {
    return { chapters: [], summary: "", empty: true };
  }

  const chapters: ChronicleChapter[] = drafts.map((draft, index) => ({
    id: draft.id,
    index: index + 1,
    kicker: `第 ${index + 1} 章 · ${draft.label}`,
    title: draft.title,
    stat: draft.stat,
    statUnit: draft.statUnit,
    body: draft.body,
    ...(draft.footnote ? { footnote: draft.footnote } : {}),
    ...(draft.chart ? { chart: draft.chart } : {})
  }));

  return { chapters, summary: summaryOf(stats, busiest), empty: false };
}

/**
 * 把故事渲染成可导出的 Markdown。
 *
 * 导出物会被带出本机，所以隐私边界必须在**生成侧**守住：这里只拼
 * `chronicle` 已经算好的字段（项目名是 basename、错误签名已归一），
 * 不二次读取 records，也就没有任何绝对路径与消息原文的入口。
 */
export function buildChronicleMarkdown(chronicle: Chronicle, days: number): string {
  const lines: string[] = [`# 数据故事 · 近 ${days} 天`, ""];
  for (const chapter of [...chronicle.chapters].sort((a, b) => a.index - b.index)) {
    lines.push(`## ${chapter.kicker}`, `### ${chapter.title}`, "");
    lines.push(`**${chapter.stat} ${chapter.statUnit}**`, "");
    lines.push(chapter.body, "");
    if (chapter.footnote) lines.push(`> ${chapter.footnote}`, "");
  }
  if (chronicle.summary.trim()) {
    lines.push("---", "", chronicle.summary, "");
  }
  return lines.join("\n");
}
