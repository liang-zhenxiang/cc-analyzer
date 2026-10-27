import { addLocalDays, dayStartOf, type UsageSessionInput, type UsageTotals } from "./usageAggregations";

/**
 * 模型迁移时间线（E6）：每个模型在本机上的首末使用时间、覆盖会话数与
 * 总用量，外加「回归段」——同一模型两次使用间隔超过 14 天，说明用户离开
 * 过又回来，时间线上值得画一段虚线。
 *
 * 口径：
 * - 只看带 usage 的记录（有消耗才算「用了这个模型」；带 model 无 usage 的
 *   记录既贡献不了用量，也证明不了真实调用）；
 * - model 取 record.model ?? "未知模型"——桶身份稳定优先，不让 undefined
 *   键在 Map 里变成 "undefined" 字符串；
 * - first/last 跨多次使用取 min/max；
 * - 会话数 = 出现过该模型的会话个数（同一会话内的多次使用只记 1 个会话）；
 * - 回归段阈值：间隔 > 14 天（15 天及以上算回归，14 天整不算——「两周
 *   休整」仍属正常节奏，「两周以上」才像离开）。间隔按本地日历日逐日计数
 *   （addLocalDays），DST 日不等长，毫秒除法会漂移一天。
 */

/** 一个模型的使用区间。tokens 是四计数分项，视图可用 totalsSum 再求和。 */
export type ModelTimelineEntry = {
  model: string;
  /** 首次使用时间戳（min）。 */
  first: number;
  /** 末次使用时间戳（max）。 */
  last: number;
  /** 出现过该模型的会话个数。 */
  sessions: number;
  /** 该模型的四计数总量。 */
  tokens: UsageTotals;
};

/** 「离开又回来」段：from → to 间隔 > 14 天。 */
export type ModelGapFlag = {
  model: string;
  from: number;
  to: number;
};

/** 回归判定的日历日阈值：间隔天数 > GAP_DAYS 即回归。 */
export const GAP_DAYS = 14;

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

/**
 * 模型时间线 + 回归段。entries 升序按 first（并列按 model 字典序稳定排）；
 * gapFlags 升序按 (model, from)。sessions 空数组 → 两个输出都空。
 */
export function modelTimeline(
  sessions: readonly UsageSessionInput[]
): { entries: ModelTimelineEntry[]; gapFlags: ModelGapFlag[] } {
  const byModel = new Map<
    string,
    { first: number; last: number; sessionSet: Set<UsageSessionInput>; tokens: UsageTotals; useTimestamps: number[] }
  >();

  for (const session of sessions) {
    for (const record of session.records) {
      const recordUsage = record.usage;
      if (!recordUsage) continue;
      const model = record.model ?? "未知模型";
      let bucket = byModel.get(model);
      if (!bucket) {
        bucket = {
          first: record.timestamp,
          last: record.timestamp,
          sessionSet: new Set(),
          tokens: emptyTotals(),
          useTimestamps: []
        };
        byModel.set(model, bucket);
      }
      if (record.timestamp < bucket.first) bucket.first = record.timestamp;
      if (record.timestamp > bucket.last) bucket.last = record.timestamp;
      bucket.sessionSet.add(session);
      bucket.useTimestamps.push(record.timestamp);
      bucket.tokens.input += recordUsage.inputTokens ?? 0;
      bucket.tokens.output += recordUsage.outputTokens ?? 0;
      bucket.tokens.cacheCreation += recordUsage.cacheCreationTokens ?? 0;
      bucket.tokens.cacheRead += recordUsage.cacheReadTokens ?? 0;
    }
  }

  const entries: ModelTimelineEntry[] = [...byModel.entries()]
    .map(([model, bucket]) => ({
      model,
      first: bucket.first,
      last: bucket.last,
      sessions: bucket.sessionSet.size,
      tokens: bucket.tokens
    }))
    .sort((a, b) => a.first - b.first || a.model.localeCompare(b.model));

  const gapFlags: ModelGapFlag[] = [];
  for (const [model, bucket] of byModel) {
    const ordered = bucket.useTimestamps.sort((a, b) => a - b);
    for (let i = 1; i < ordered.length; i += 1) {
      const from = ordered[i - 1];
      const to = ordered[i];
      // 本地日历日差：逐日累加。11/1 23:59 → 11/15 00:01 是 14 天（不回归），
      // 11/1 → 11/16 是 15 天（回归）。
      let cursor = dayStartOf(from);
      const target = dayStartOf(to);
      let gapDays = 0;
      while (cursor < target) {
        cursor = addLocalDays(cursor, 1);
        gapDays += 1;
      }
      if (gapDays > GAP_DAYS) gapFlags.push({ model, from, to });
    }
  }
  gapFlags.sort((a, b) => a.model.localeCompare(b.model) || a.from - b.from);

  return { entries, gapFlags };
}
