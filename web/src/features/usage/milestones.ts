import { basename, sessionDirectory } from "../../lib/path";
import { sessionTitle, type SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { censusKeyId, type ToolBucketKey } from "./toolCensus";
import { countsAsMessage, sessionKeyOf } from "./usageCalendar";
import {
  dayStartOf,
  totalsSum,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 里程碑的纯逻辑层（Issue #214，design.md §3）。三层清单——首次 / 累计阶梯 /
 * 单会话记录——全部由一次遍历折出的全历史事实投影而来：
 *
 * ```
 * inputs -> historyFactsOf -> HistoryFacts -> tiersOf / firstsOf / recordsOf
 * ```
 *
 * 三条口径纪律（design §3.3 / §3.4 / §3.5）：
 * 1. 不自带第二套数学——token 走 `totalsSum`、消息走 `countsAsMessage`、
 *    天走 `dayStartOf`、会话身份走 `sessionKeyOf`，本模块只做投影与极值挑选。
 * 2. 并列取时间更早的那个——记录类问的是「第一次达到」，与
 *    `calendarInsightsOf` 的「并列取最近段」相反（那条问的是「最近一次」）。
 * 3. 畸形输入不当 0——非有限的 token 计数器不进累加，非有限的时间戳整条
 *    记录跳过；当 0 会把单会话极小值与「首次」都算错。
 *
 * `now` 显式传入而不读全局时钟：报告带上 `generatedAt`，其余事实全是历史的。
 */

/** 会话定位：界面据此点开那个会话。手造输入无元数据时 `path` 为空串（不可点）。 */
export type MilestoneSessionRef = {
  path: string;
  /** `sessionTitle` 口径的标题，落回「项目标签 · 会话 id 前 8 位」。 */
  title: string;
  projectLabel: string;
  projectPath?: string;
};

/** 单个会话折出的事实。 */
export type MilestoneSessionFact = {
  /** `sessionKeyOf` 的身份键——重复路径的输入已按它合并。 */
  key: string;
  ref: MilestoneSessionRef;
  /** 首条有效记录所在本地日；一条有效记录都没有时为 null。 */
  dayStart: number | null;
  /** 首条 / 末条有效记录的时刻（ms）；无有效记录时为 null。 */
  firstAt: number | null;
  lastAt: number | null;
  /** 活跃跨度 = lastAt − firstAt（与 `dayReviewOf` 的区间同口径）。 */
  durationMs: number;
  tokens: number;
  messages: number;
  compactions: number;
};

/**
 * 一次「首次」的原料：时刻 + 那一刻的目标名（工具类才有）+ 落在哪个会话。
 *
 * `detail` 必须是**首个那次调用自己的名字**（Issue #214 的验收缺陷：此前只留了
 * 时刻，界面只能退回会话标题，五行首次因此写成同一句）。判定口径在
 * `historyFactsOf` 里——`earlierMoment` 把时刻与名字一起留下，于是「更早的那次赢」
 * 赢的是完整的一对，而不是「时间来自 A、名字来自 B」。
 */
export type MilestoneFirstFact = {
  at: number;
  /** skill 名 / `server/tool` / 子 agent 类型；会话与压缩不带。 */
  detail?: string;
  session: MilestoneSessionFact;
};

/**
 * 全历史事实。这里只放事实，不放任何达成与否的判断——档次判定是 `tiersOf`
 * 的活，两者分开才好在测试里各自钉死。
 */
export type HistoryFacts = {
  /** 全部会话合并后的四类 token 之和（`totalsSum` 口径）。 */
  tokens: number;
  /** 去重后的会话数（`sessionKeyOf` 合并重复路径）。 */
  sessionCount: number;
  /** `countsAsMessage` 口径的消息条数。 */
  messages: number;
  compactions: number;
  /** 项目标签集合（升序去重）。 */
  projects: string[];
  /** 用过模型 id 的集合（升序去重；按有 usage 的记录收集，与 `aggregateSession` 同口径）。 */
  models: string[];
  /** 工具种类集合（升序去重；`censusKeyId` 的身份，与工具普查的桶数一致）。 */
  tools: string[];
  /** 有记录的天（升序去重的本地天键）。 */
  days: number[];
  /** 最早的会话（首条记录时刻最小；并列取路径字典序更小者）。 */
  earliestSession: MilestoneSessionFact | null;
  firstCompaction: MilestoneFirstFact | null;
  firstSubagent: MilestoneFirstFact | null;
  firstSkill: MilestoneFirstFact | null;
  firstMcp: MilestoneFirstFact | null;
  /** 单会话极值（值 > 0 才成立；并列取时间更早的会话）。 */
  tokenRecord: MilestoneSessionFact | null;
  durationRecord: MilestoneSessionFact | null;
  compactionRecord: MilestoneSessionFact | null;
};

export type MilestoneMetric =
  | "tokens"
  | "sessions"
  | "messages"
  | "projects"
  | "models"
  | "compactions"
  | "tools";

/** 一档阶梯的常量定义。 */
export type MilestoneTierSpec = {
  metric: MilestoneMetric;
  label: string;
  unit: string;
  /** 升序阈值。写死、逐条可读、逐条可测——「多少算里程碑」是产品决定。 */
  tiers: readonly number[];
};

/**
 * 档位表（design §3.3 逐条照抄）。常量而非算出来的：改档位是一次产品决定，
 * 必须能在 diff 里一眼读到，也必须能被测试逐条钉住。
 */
export const MILESTONE_TIER_TABLE: readonly MilestoneTierSpec[] = [
  {
    metric: "tokens",
    label: "累计 token",
    unit: "token",
    tiers: [1_000_000, 10_000_000, 100_000_000, 1_000_000_000]
  },
  { metric: "sessions", label: "累计会话数", unit: "个", tiers: [1, 10, 100, 1000] },
  { metric: "messages", label: "累计消息数", unit: "条", tiers: [100, 1_000, 10_000, 100_000] },
  { metric: "projects", label: "涉及项目数", unit: "个", tiers: [1, 5, 10, 25] },
  { metric: "models", label: "用过模型数", unit: "个", tiers: [1, 3, 5] },
  { metric: "compactions", label: "累计压缩次数", unit: "次", tiers: [1, 10, 100] },
  { metric: "tools", label: "工具种类数", unit: "种", tiers: [1, 5, 15] }
];

/** 一枚阶梯：当前值 + 已达档 + 下一档 + 到下一档的距离。 */
export type MilestoneTier = MilestoneTierSpec & {
  current: number;
  /** 已达成档的最高下标；一档未达为 −1。 */
  reachedIndex: number;
  /** 下一档阈值；已达最高档为 null。 */
  next: number | null;
  /** 到下一档的距离；已达最高档为 null（不是 0，也不是负数）。 */
  distanceToNext: number | null;
};

export type MilestoneFirstKind = "session" | "compaction" | "subagent" | "skill" | "mcp";

/** 一枚「首次」里程碑：那一刻 + 那天 + 可点开的目标会话。 */
export type MilestoneFirst = {
  kind: MilestoneFirstKind;
  label: string;
  /** 那一刻（ms）。 */
  at: number;
  /** 那天（本地天键），供「一日回望」下钻。 */
  dayStart: number;
  /**
   * 那一刻的目标名（§5.2 的证据行）：skill 名 / `server/tool` / 子 agent 类型。
   * 会话与压缩没有「目标名」，缺席时界面退回会话标题。
   */
  detail?: string;
  session: MilestoneSessionRef;
};

export type MilestoneRecordKind = "tokens" | "duration" | "compactions";

/** 一枚单会话记录：值 + 是哪个会话 + 会话日期（首条记录那天）。 */
export type MilestoneRecord = {
  kind: MilestoneRecordKind;
  label: string;
  value: number;
  session: MilestoneSessionRef;
  dayStart: number;
};

export type MilestoneReport = {
  /** 取报告那一刻（`milestonesOf` 的 `now`）——事实本身全是历史的。 */
  generatedAt: number;
  /** 一个会话都没有（`inputs` 为空，或没有任何可识别的会话键）。 */
  empty: boolean;
  facts: HistoryFacts;
  tiers: MilestoneTier[];
  firsts: MilestoneFirst[];
  records: MilestoneRecord[];
};

/** 展示名：`sessionTitle` 的口径，退回「项目标签 · 会话 id 前 8 位」。 */
function fallbackSessionTitle(session: SessionMeta): string {
  // 已补全的元数据里有真标题就直接用；活跃会话必然 pending，拿不到真标题也
  // 没关系——id 从文件名取，Claude Code 的会话文件名就是 <sessionId>.jsonl。
  const known = sessionTitle(session);
  if (known !== session.projectLabel) return known;

  const id = session.sessionId ?? basename(sessionDirectory(session.path));
  const prefix = id.trim().slice(0, 8);
  return prefix ? `${session.projectLabel} · ${prefix}` : session.projectLabel;
}

function refOf(source: UsageSessionInput): MilestoneSessionRef {
  const session = source.session;
  return {
    path: session?.path ?? "",
    title: session ? fallbackSessionTitle(session) : source.projectLabel,
    projectLabel: source.projectLabel,
    projectPath: source.projectPath ?? session?.cwd
  };
}

/** 一个声明过的计数值：缺省是 0（`SessionUsage` 的约定），畸形（非有限 / 负）返回 null。 */
function declaredCount(value: number | undefined): number | null {
  if (value === undefined) return 0;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 一条记录贡献的 token 四元组。没有 `usage` 是没有 token（不是 0），返回 null；
 * 任一计数器畸形同样返回 null——不当成 0 参与累加。
 */
function tokensOfRecord(record: SessionRecord): UsageTotals | null {
  const usage: SessionUsage | undefined = record.usage;
  if (!usage) return null;
  const input = declaredCount(usage.inputTokens);
  const output = declaredCount(usage.outputTokens);
  const cacheCreation = declaredCount(usage.cacheCreationTokens);
  const cacheRead = declaredCount(usage.cacheReadTokens);
  if (input === null || output === null || cacheCreation === null || cacheRead === null) {
    return null;
  }
  return { input, output, cacheCreation, cacheRead };
}

function addTotals(target: UsageTotals, source: UsageTotals): void {
  target.input += source.input;
  target.output += source.output;
  target.cacheCreation += source.cacheCreation;
  target.cacheRead += source.cacheRead;
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/** 「首次」的中间态：时刻与目标名是一对，必须同生同灭。 */
type FirstMoment = { at: number; detail: string | null };

/** 遍历中的逐会话中间态（事实的累加器，不是最终契约）。 */
type SessionTally = {
  key: string;
  ref: MilestoneSessionRef;
  firstAt: number | null;
  lastAt: number | null;
  totals: UsageTotals;
  messages: number;
  compactions: number;
  firstCompaction: FirstMoment | null;
  firstSubagent: FirstMoment | null;
  firstSkill: FirstMoment | null;
  firstMcp: FirstMoment | null;
};

function earlier(candidate: number, current: number | null): number {
  return current === null || candidate < current ? candidate : current;
}

/** 更早的一刻赢，连同那一刻的名字一起赢（不是只挑时刻、名字另算）。 */
function earlierMoment(candidate: FirstMoment, current: FirstMoment | null): FirstMoment {
  return current === null || candidate.at < current.at ? candidate : current;
}

/**
 * 工具调用事实在证据行上显示的名字（§5.2）：skill 名、`server/tool`、子 agent 类型。
 * 这是**展示名**不是身份——身份仍由 `censusKeyId` 归一（同一 server 的多个 tool
 * 仍是同一个桶，但这里要写清是哪一次调用）。
 */
function toolDetailOf(key: ToolBucketKey): string | null {
  switch (key.kind) {
    case "skill":
      return key.skillName;
    case "mcp":
      return `${key.server}/${key.toolName}`;
    case "subagent":
      return key.subagentType;
    case "builtin":
      return null;
  }
}

/**
 * 一次遍历折出全部事实。记录只走一遍：token / 消息 / 天 / 极值在同一次循环里
 * 累积；压缩事件与工具事实是同一条输入上的并列数组，各走一遍它们自己的列表。
 */
export function historyFactsOf(inputs: readonly UsageSessionInput[]): HistoryFacts {
  const tallies = new Map<string, SessionTally>();
  const projects = new Set<string>();
  const models = new Set<string>();
  const tools = new Set<string>();
  const days = new Set<number>();
  const totals = emptyTotals();
  let messages = 0;
  let compactions = 0;

  inputs.forEach((source, index) => {
    const key = sessionKeyOf(source, index);
    let tally = tallies.get(key);
    if (!tally) {
      tally = {
        key,
        ref: refOf(source),
        firstAt: null,
        lastAt: null,
        totals: emptyTotals(),
        messages: 0,
        compactions: 0,
        firstCompaction: null,
        firstSubagent: null,
        firstSkill: null,
        firstMcp: null
      };
      tallies.set(key, tally);
    }
    if (source.projectLabel) projects.add(source.projectLabel);

    for (const record of source.records) {
      // 时间戳非有限：整条记录跳过。它归不了日，进不了「首次」，也无法定位。
      if (!Number.isFinite(record.timestamp)) continue;

      tally.firstAt = earlier(record.timestamp, tally.firstAt);
      tally.lastAt =
        tally.lastAt === null || record.timestamp > tally.lastAt ? record.timestamp : tally.lastAt;
      days.add(dayStartOf(record.timestamp));

      if (countsAsMessage(record)) {
        tally.messages += 1;
        messages += 1;
      }

      const recordTokens = tokensOfRecord(record);
      if (recordTokens) {
        addTotals(tally.totals, recordTokens);
        addTotals(totals, recordTokens);
        // 与 `aggregateSession` 同口径：模型按有 usage 的记录收集。
        if (record.model) models.add(record.model);
      }
    }

    for (const event of source.compactEvents ?? []) {
      if (!Number.isFinite(event.timestamp)) continue;
      tally.compactions += 1;
      compactions += 1;
      tally.firstCompaction = earlierMoment(
        { at: event.timestamp, detail: null },
        tally.firstCompaction
      );
    }

    for (const fact of source.toolCalls ?? []) {
      if (!Number.isFinite(fact.timestamp)) continue;
      tools.add(censusKeyId(fact.key));
      const moment: FirstMoment = { at: fact.timestamp, detail: toolDetailOf(fact.key) };
      switch (fact.key.kind) {
        case "subagent":
          tally.firstSubagent = earlierMoment(moment, tally.firstSubagent);
          break;
        case "skill":
          tally.firstSkill = earlierMoment(moment, tally.firstSkill);
          break;
        case "mcp":
          tally.firstMcp = earlierMoment(moment, tally.firstMcp);
          break;
        case "builtin":
          break;
      }
    }
  });

  const sessions: MilestoneSessionFact[] = [...tallies.values()].map((tally) => ({
    key: tally.key,
    ref: tally.ref,
    dayStart: tally.firstAt === null ? null : dayStartOf(tally.firstAt),
    firstAt: tally.firstAt,
    lastAt: tally.lastAt,
    durationMs:
      tally.firstAt === null || tally.lastAt === null
        ? 0
        : Math.max(0, tally.lastAt - tally.firstAt),
    tokens: totalsSum(tally.totals),
    messages: tally.messages,
    compactions: tally.compactions
  }));
  const byKey = new Map(sessions.map((session) => [session.key, session]));

  // 时间升序（无时刻的排最后），并列按路径字典序——极值与「最早」都吃这份顺序，
  // 「并列取更早」因此落在排序后的第一个赢家上，不依赖输入数组的顺序。
  const ordered = [...sessions].sort(
    (a, b) =>
      (a.firstAt ?? Number.POSITIVE_INFINITY) - (b.firstAt ?? Number.POSITIVE_INFINITY) ||
      a.key.localeCompare(b.key)
  );

  // 「首次」原料：跨会话取最早的那一刻；并列按会话键稳定裁决。
  const firstOf = (pick: (tally: SessionTally) => FirstMoment | null): MilestoneFirstFact | null => {
    let best: { moment: FirstMoment; key: string } | null = null;
    for (const tally of tallies.values()) {
      const moment = pick(tally);
      if (moment === null) continue;
      if (
        best === null ||
        moment.at < best.moment.at ||
        (moment.at === best.moment.at && tally.key < best.key)
      ) {
        best = { moment, key: tally.key };
      }
    }
    if (best === null) return null;
    const session = byKey.get(best.key);
    return session
      ? { at: best.moment.at, detail: best.moment.detail ?? undefined, session }
      : null;
  };

  // 单会话极值。值 <= 0 不成记录（全 0 的「最多 token」不是事实，是空货架）；
  // 升序遍历 + 严格 > 于是并列时保留时间更早的那个（design §3.4）。
  const extremeOf = (
    value: (session: MilestoneSessionFact) => number
  ): MilestoneSessionFact | null => {
    let best: MilestoneSessionFact | null = null;
    let bestValue = 0;
    for (const session of ordered) {
      const candidate = value(session);
      if (candidate <= 0) continue;
      if (best === null || candidate > bestValue) {
        best = session;
        bestValue = candidate;
      }
    }
    return best;
  };

  return {
    tokens: totalsSum(totals),
    sessionCount: sessions.length,
    messages,
    compactions,
    projects: [...projects].sort(),
    models: [...models].sort(),
    tools: [...tools].sort(),
    days: [...days].sort((a, b) => a - b),
    earliestSession: ordered.length > 0 && ordered[0].firstAt !== null ? ordered[0] : null,
    firstCompaction: firstOf((tally) => tally.firstCompaction),
    firstSubagent: firstOf((tally) => tally.firstSubagent),
    firstSkill: firstOf((tally) => tally.firstSkill),
    firstMcp: firstOf((tally) => tally.firstMcp),
    tokenRecord: extremeOf((session) => session.tokens),
    durationRecord: extremeOf((session) => session.durationMs),
    compactionRecord: extremeOf((session) => session.compactions)
  };
}

/** 事实键到当前值的映射（阶梯取值的单一来源）。 */
const CURRENT_VALUE_OF: Record<MilestoneMetric, (facts: HistoryFacts) => number> = {
  tokens: (facts) => facts.tokens,
  sessions: (facts) => facts.sessionCount,
  messages: (facts) => facts.messages,
  projects: (facts) => facts.projects.length,
  models: (facts) => facts.models.length,
  compactions: (facts) => facts.compactions,
  tools: (facts) => facts.tools.length
};

/**
 * 用写死的档位表判定「已达档」与「下一档距离」。正好等于阈值算达成（闭区间）；
 * 已达最高档时 `next` 与 `distanceToNext` 都是 null。
 */
export function tiersOf(facts: HistoryFacts): MilestoneTier[] {
  return MILESTONE_TIER_TABLE.map((spec) => {
    const current = CURRENT_VALUE_OF[spec.metric](facts);
    let reachedIndex = -1;
    for (let index = 0; index < spec.tiers.length; index += 1) {
      if (current >= spec.tiers[index]) reachedIndex = index;
      else break;
    }
    const next = reachedIndex + 1 < spec.tiers.length ? spec.tiers[reachedIndex + 1] : null;
    return {
      metric: spec.metric,
      label: spec.label,
      unit: spec.unit,
      tiers: spec.tiers,
      current,
      reachedIndex,
      next,
      distanceToNext: next === null ? null : next - current
    };
  });
}

const FIRST_LABELS: Record<MilestoneFirstKind, string> = {
  session: "第一次会话",
  compaction: "第一次压缩",
  subagent: "第一次用子 agent",
  skill: "第一次用 skill",
  mcp: "第一次用 MCP 工具"
};

function firstEntry(
  kind: MilestoneFirstKind,
  first: MilestoneFirstFact | null
): MilestoneFirst | null {
  if (!first) return null;
  return {
    kind,
    label: FIRST_LABELS[kind],
    at: first.at,
    dayStart: dayStartOf(first.at),
    detail: first.detail,
    session: first.session.ref
  };
}

/**
 * 首次类清单。原料不存在就不产出这枚——「你还没用过 skill」与「离达成还差多少」
 * 是两件事，后者是阶梯的事。顺序照 R3.1：会话 -> 压缩 -> 子 agent -> skill -> MCP。
 */
export function firstsOf(facts: HistoryFacts): MilestoneFirst[] {
  const earliest = facts.earliestSession;
  const firstSession: MilestoneFirstFact | null =
    earliest && earliest.firstAt !== null ? { at: earliest.firstAt, session: earliest } : null;
  const entries = [
    firstEntry("session", firstSession),
    firstEntry("compaction", facts.firstCompaction),
    firstEntry("subagent", facts.firstSubagent),
    firstEntry("skill", facts.firstSkill),
    firstEntry("mcp", facts.firstMcp)
  ];
  return entries.filter((entry): entry is MilestoneFirst => entry !== null);
}

const RECORD_LABELS: Record<MilestoneRecordKind, string> = {
  tokens: "单会话最多 token",
  duration: "单会话最长时长",
  compactions: "单会话最多压缩次数"
};

function recordEntry(
  kind: MilestoneRecordKind,
  session: MilestoneSessionFact | null,
  valueOf: (session: MilestoneSessionFact) => number
): MilestoneRecord | null {
  if (!session || session.dayStart === null) return null;
  return {
    kind,
    label: RECORD_LABELS[kind],
    value: valueOf(session),
    session: session.ref,
    dayStart: session.dayStart
  };
}

/** 单会话记录清单：值 + 会话定位（path / 标题回退 / 日期）。无正值的极值缺席。 */
export function recordsOf(facts: HistoryFacts): MilestoneRecord[] {
  const entries = [
    recordEntry("tokens", facts.tokenRecord, (session) => session.tokens),
    recordEntry("duration", facts.durationRecord, (session) => session.durationMs),
    recordEntry("compactions", facts.compactionRecord, (session) => session.compactions)
  ];
  return entries.filter((entry): entry is MilestoneRecord => entry !== null);
}

/**
 * 组装三层 + 空态判定。一个会话都没有时三层都是空数组，但 `facts` 仍是完整的
 * 零值事实，调用方可以直接读它渲染空态那一行。
 */
export function milestonesOf(inputs: readonly UsageSessionInput[], now: number): MilestoneReport {
  const facts = historyFactsOf(inputs);
  const empty = facts.sessionCount === 0;
  return {
    generatedAt: now,
    empty,
    facts,
    tiers: empty ? [] : tiersOf(facts),
    firsts: empty ? [] : firstsOf(facts),
    records: empty ? [] : recordsOf(facts)
  };
}
