import { formatProjectPath, formatTokenCount } from "../../lib/format";
import { basename } from "../../lib/path";
import type { SessionRecord } from "../sessions/types";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 时间胶囊（Issue #325）：从历史里挑出「去年的今天」这类值得回看的一天，
 * 把那天的事实折成一张卡片的数据模型。
 *
 * 纯函数：零 I/O、零 `Date.now()`（时钟由参数传入），同一份输入永远得到
 * 同一颗胶囊。所有数字都能在既有面板里复算：
 *   - tokens = 当天记录的四计数器之和（`totalsSum` 同口径）；
 *   - 会话数 = 当天至少有一条记录的输入数（不是记录数——一个会话可能在那天
 *     留下几十条记录，仍然只是「一个会话」）；
 *   - 最活跃项目 = 当天 token 最多的那个输入的项目名，走
 *     `formatProjectPath` 的展示口径（有 cwd 时取 basename），绝不输出绝对路径。
 *
 * 候选日按「回忆价值」从高到低排列：一年前的今天最有仪式感，其次是上个月
 * 的同一天，最后是 100 天前。取**第一个有记录**的候选，而不是把三个候选
 * 合成一段「以前也用过」的模糊叙述——胶囊讲的是具体的一天，不是区间统计。
 *
 * 日期算术全部走本地日历分量，不用 `86_400_000` 的毫秒往返：
 *   - 闰日 2/29 回退一年时落到 2/28（不溢出到 3/1）；
 *   - 上月没有 31 日时落到该月最后一天（5/31 → 4/30，不溢到 5/1）；
 *   - 100 天前用 `addLocalDays`（与热力图/年报同一 DST 安全写法）。
 */

export type TimeCapsule = {
  /** 被回看那天的本地零点（`dayStartOf` 同键）。 */
  dayStart: number;
  /** 「一年前的今天」「上个月的今天」「100 天前」。 */
  label: string;
  /** 当天有记录的输入数（一个会话算一次，与记录条数无关）。 */
  sessions: number;
  /** 当天记录的四计数器之和（缺省计数按 0）。 */
  tokens: number;
  /** 当天最活跃项目的 basename；当天没有任何项目标签时为 null。 */
  project: string | null;
  /** 一句由真实数据拼出的叙述，不含绝对路径与消息原文。 */
  sentence: string;
};

type DayCandidate = {
  dayStart: number;
  label: string;
};

/** 该年该月的最后一天（1-based 月份，0 = 一月）。 */
function lastDayOfMonth(year: number, month: number): number {
  // `new Date(y, m + 1, 0)` = 下个月的第 0 天 = 本月最后一天。
  return new Date(year, month + 1, 0).getDate();
}

/**
 * 构造目标年月的「同一天」，该月没有这一天时钳到月末。
 * 必须显式钳位：`new Date(2027, 1, 29)` 会静默溢出成 3 月 1 日，
 * 那是「今年 2 月的最后一天」而不是「去年的 2 月 29 日」。
 */
function clampedDay(year: number, month: number, day: number): number {
  const last = lastDayOfMonth(year, month);
  return new Date(year, month, Math.min(day, last)).getTime();
}

/** 三个候选日，按优先级排列（不判断是否有记录）。 */
function candidatesOf(now: number): DayCandidate[] {
  const date = new Date(now);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // 一月的「上个月」会退到去年的十二月。
  const previousMonthYear = month === 0 ? year - 1 : year;
  const previousMonth = month === 0 ? 11 : month - 1;

  return [
    { dayStart: clampedDay(year - 1, month, day), label: "一年前的今天" },
    { dayStart: clampedDay(previousMonthYear, previousMonth, day), label: "上个月的今天" },
    // 100 天前是「日历日回退 100 天」，不是「100 × 24 小时」：跨 DST 的
    // 毫秒减法会落在前一天的 23 点或后一天的 1 点，行囊里装错一天。
    { dayStart: addLocalDays(dayStartOf(now), -100), label: "100 天前" }
  ];
}

/** 本地日边界：[dayStart, 下一天本地零点)。DST 那天的实际时长不是 24 小时。 */
function dayEndOf(dayStart: number): number {
  return addLocalDays(dayStart, 1);
}

function hasRecordOn(records: readonly SessionRecord[], start: number, end: number): boolean {
  for (const record of records) {
    if (record.timestamp >= start && record.timestamp < end) return true;
  }
  return false;
}

function usageSum(record: SessionRecord): number {
  const usage = record.usage;
  if (!usage) return 0;
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

/** 当天最活跃项目：token 最多的输入；并列取展示名字典序靠前者。 */
type ProjectPick = { name: string; tokens: number };

type DayTotals = {
  sessions: number;
  tokens: number;
  project: ProjectPick | null;
  /** 当天出现过的项目标签数（非空标签去重），用于句子的「N 个项目里」。 */
  projectCount: number;
};

function totalsOn(
  inputs: readonly UsageSessionInput[],
  start: number,
  end: number
): DayTotals {
  let sessions = 0;
  let tokens = 0;
  let project: ProjectPick | null = null;
  const labels = new Set<string>();

  for (const input of inputs) {
    let inputTokens = 0;
    let sawRecord = false;
    for (const record of input.records) {
      if (record.timestamp < start || record.timestamp >= end) continue;
      sawRecord = true;
      inputTokens += usageSum(record);
    }
    // 有记录才算一个会话；只有 usage 的输入不成立（usage 一定挂在记录上），
    // 但没有 usage 的记录（用户消息、工具行）同样证明「那天开过这个会话」。
    if (!sawRecord) continue;
    sessions += 1;
    tokens += inputTokens;

    if (!input.projectLabel) continue;
    labels.add(input.projectLabel);

    const name = basename(formatProjectPath(input.projectLabel, input.projectPath));
    if (!name) continue;
    if (
      !project ||
      inputTokens > project.tokens ||
      (inputTokens === project.tokens && name.localeCompare(project.name) < 0)
    ) {
      project = { name, tokens: inputTokens };
    }
  }

  return { sessions, tokens, project, projectCount: labels.size };
}

function sentenceOf(totals: DayTotals): string {
  const tail = `留下了 ${totals.sessions} 个会话、${formatTokenCount(totals.tokens)} token。`;
  if (totals.projectCount >= 2) {
    return `那天你在 ${totals.projectCount} 个项目里${tail}`;
  }
  if (totals.project) {
    return `那天你在 ${totals.project.name} 里${tail}`;
  }
  // 日志里没有可展示的项目名（手造输入或标签为空）时不编一个「未命名项目」：
  // 少说一句比说错一个名字诚实。
  return `那天你${tail}`;
}

export function buildTimeCapsule(
  inputs: readonly UsageSessionInput[],
  now: number
): TimeCapsule | null {
  for (const candidate of candidatesOf(now)) {
    const end = dayEndOf(candidate.dayStart);
    // 先判断有没有记录再聚合：优先级是「第一个有记录的候选」，不是「第一个
    // 聚合出非零 token 的候选」——那天只有闲聊、没有 token 也仍然值得回看。
    const hasAny = inputs.some((input) => hasRecordOn(input.records, candidate.dayStart, end));
    if (!hasAny) continue;

    const totals = totalsOn(inputs, candidate.dayStart, end);
    return {
      dayStart: candidate.dayStart,
      label: candidate.label,
      sessions: totals.sessions,
      tokens: totals.tokens,
      project: totals.project?.name ?? null,
      sentence: sentenceOf(totals)
    };
  }

  return null;
}
