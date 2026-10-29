import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 提示词节奏（F10）的数据层：每个用户提示一个点，横轴是「距上一条用户
 * 消息的间隔」（对数），纵轴是「提示字数」（对数，Unicode 码点数）。
 *
 * 口径写死在这里：
 *
 * - **用户消息** = `kind === "user"` 且不是压缩摘要 / 系统注入 / 中断标记。
 *   它们不是用户说的话，混进「说话节奏」会伪造样本。
 * - **字数用码点**（`Array.from(text).length`），不是 UTF-16 单元——emoji
 *   在后者里算 2 个字符。
 * - **0 字不计入**；间隔 < 5 秒、> 24 小时或字数 > 1 万的点不画，只计数。
 *   首条用户消息没有「上一条」，同样只计数。
 * - 项目按样本数取前 6 上色，第 7 名及以后统一中性色——散点里两个项目
 *   撞色会被读成同一个项目。
 *
 * 间隔是**全局**的：跨会话、跨项目按时间排序后取相邻两条用户消息之差，
 * 这才是「这个人隔多久说一句」。
 */

export const RHYTHM_MIN_INTERVAL_MS = 5_000;
export const RHYTHM_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const RHYTHM_MAX_CHARS = 10_000;
/** 低于这个样本量，散点读不出形状（视图给空态）。 */
export const RHYTHM_MIN_SAMPLES = 8;

export type RhythmSkipped = {
  /** 首条消息没有上一条，无间隔。 */
  noPrevious: number;
  /** 0 字的消息。 */
  empty: number;
  /** 间隔 < 5 秒。 */
  tooShort: number;
  /** 间隔 > 24 小时。 */
  tooLong: number;
  /** 字数 > 1 万。 */
  tooBig: number;
};

export type RhythmProject = {
  label: string;
  /** 0–5 对应 `--chart-1..6`；`null` 是「其他」。 */
  colorIndex: number | null;
  messages: number;
};

export type RhythmPoint = {
  projectLabel: string;
  colorIndex: number | null;
  at: number;
  intervalMs: number;
  chars: number;
  /** 对数轴上的归一化位置，0–1。 */
  x: number;
  /** 同上，0–1（0 在底部）。 */
  y: number;
};

export type RhythmData = {
  points: RhythmPoint[];
  /** 窗口内符合条件的用户消息条数（含未画出的点）。 */
  sampleCount: number;
  plottedCount: number;
  projects: RhythmProject[];
  medianIntervalMs: number | null;
  medianChars: number | null;
  medianX: number | null;
  medianY: number | null;
  skipped: RhythmSkipped;
};

type UserMessage = {
  at: number;
  chars: number;
  projectLabel: string;
  /** 稳定排序的兜底序号（同一毫秒两条消息时仍可复现）。 */
  order: number;
};

/** 与 aggregateRange / toolCensus 同一份窗口边界。 */
function windowStartOf(days: number, now: number): number {
  return addLocalDays(dayStartOf(now), -(Math.max(1, Math.floor(days)) - 1));
}

/** 用户真正说出的话；压缩摘要 / 系统注入 / 中断标记都不是。 */
function isSpokenUserMessage(record: UsageSessionInput["records"][number]): boolean {
  return (
    record.kind === "user" &&
    record.compactSummary !== true &&
    record.isSynthetic !== true &&
    record.isInterrupt !== true
  );
}

/** 对数轴的归一化位置；域外值夹到端点（过滤后不会出现，防御手造输入）。 */
export function logPosition(value: number, min: number, max: number): number {
  if (!(value > min)) return 0;
  if (value >= max) return 1;
  return (Math.log(value) - Math.log(min)) / (Math.log(max) - Math.log(min));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildPromptRhythm(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number
): RhythmData {
  const startTs = windowStartOf(days, now);
  const messages: UserMessage[] = [];
  let order = 0;

  for (const input of inputs) {
    for (const record of input.records) {
      if (record.timestamp < startTs) continue;
      if (!isSpokenUserMessage(record)) continue;
      messages.push({
        at: record.timestamp,
        chars: Array.from(record.text).length,
        projectLabel: input.projectLabel,
        order
      });
      order += 1;
    }
  }

  messages.sort((a, b) => a.at - b.at || a.order - b.order);

  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message.projectLabel, (counts.get(message.projectLabel) ?? 0) + 1);
  }
  const rankedProjects = [...counts.entries()]
    .map(([label, value]) => ({ label, messages: value }))
    .sort((a, b) => b.messages - a.messages || a.label.localeCompare(b.label));
  const projects: RhythmProject[] = rankedProjects.map((project, index) => ({
    label: project.label,
    messages: project.messages,
    colorIndex: index < 6 ? index : null
  }));
  const colorByProject = new Map(projects.map((project) => [project.label, project.colorIndex]));

  const skipped: RhythmSkipped = {
    noPrevious: 0,
    empty: 0,
    tooShort: 0,
    tooLong: 0,
    tooBig: 0
  };
  const points: RhythmPoint[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (index === 0) {
      skipped.noPrevious += 1;
      continue;
    }
    if (message.chars === 0) {
      skipped.empty += 1;
      continue;
    }
    const intervalMs = message.at - messages[index - 1].at;
    if (intervalMs < RHYTHM_MIN_INTERVAL_MS) {
      skipped.tooShort += 1;
      continue;
    }
    if (intervalMs > RHYTHM_MAX_INTERVAL_MS) {
      skipped.tooLong += 1;
      continue;
    }
    if (message.chars > RHYTHM_MAX_CHARS) {
      skipped.tooBig += 1;
      continue;
    }
    points.push({
      projectLabel: message.projectLabel,
      colorIndex: colorByProject.get(message.projectLabel) ?? null,
      at: message.at,
      intervalMs,
      chars: message.chars,
      x: logPosition(intervalMs, RHYTHM_MIN_INTERVAL_MS, RHYTHM_MAX_INTERVAL_MS),
      y: logPosition(message.chars, 1, RHYTHM_MAX_CHARS)
    });
  }

  const medianIntervalMs = median(points.map((point) => point.intervalMs));
  const medianChars = median(points.map((point) => point.chars));

  return {
    points,
    sampleCount: messages.length,
    plottedCount: points.length,
    projects,
    medianIntervalMs,
    medianChars,
    medianX:
      medianIntervalMs === null
        ? null
        : logPosition(medianIntervalMs, RHYTHM_MIN_INTERVAL_MS, RHYTHM_MAX_INTERVAL_MS),
    medianY:
      medianChars === null ? null : logPosition(medianChars, 1, RHYTHM_MAX_CHARS),
    skipped
  };
}

/** 「42 秒 / 10 分 / 2 小时 14 分 / 1 天」——中位读数与脚注共用。 */
export function formatRhythmInterval(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 秒";
  if (ms < 60_000) return `${Math.round(ms / 1000)} 秒`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} 分`;
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  if (hours >= 24) return `${Math.round(hours / 24)} 天`;
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

/** 「180 字 / 1.2k 字」。 */
export function formatRhythmChars(chars: number): string {
  if (!Number.isFinite(chars) || chars <= 0) return "0 字";
  if (chars < 1000) return `${Math.round(chars)} 字`;
  return `${(chars / 1000).toFixed(1)}k 字`;
}
