import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 峰值时刻（D9）：一天里哪一分钟烧的 token 最多。
 *
 * 口径：
 *   - 只吃记录自带的 `usage`，token 数 = 四类计数器之和（input + output +
 *     cacheCreation + cacheRead，与 totalsSum 一致）。
 *   - 按**墙钟分钟**分桶：`floor(timestamp / 60_000) * 60_000`，与本地时区
 *     无关（UTC 的分钟边界与任何时区偏移都是整分钟，跨时区结果一致）。
 *   - usage 缺失、或四类计数全为 0 的记录**不贡献分钟**：0 token 的分钟不是
 *     消耗分钟，不该让 `distinctMinutes` 虚高，也不该被当成「并列最快的一分钟」。
 *   - 并列取更早的分钟；`runnerUp` 是第二高的**另一个**分钟（值允许与冠军相同）。
 *
 * 空输入/全零输入返回 `minuteStart: null`——「没有峰值」比编一个 0 点更诚实。
 */

export type PeakMinute = {
  /** 墙钟分钟起点（对齐 60_000 的整数）。 */
  minuteStart: number;
  /** 该分钟内的 token 合计。 */
  tokens: number;
};

export type PeakMinuteReport = {
  /** 冠军分钟的起点；没有任何 token 时为 null。 */
  minuteStart: number | null;
  /** 冠军分钟的 token 数；没有时为 0。 */
  tokens: number;
  /** 第二高的分钟（另一个分钟）；只有一分钟有消耗时为 null。 */
  runnerUp: PeakMinute | null;
  /** 有任何 token 的分钟数（distinct 分钟，不是记录数）。 */
  distinctMinutes: number;
};

/** 单条记录的 token 合计（四类计数器之和；缺失按 0）。 */
export function recordTokens(record: SessionRecord): number {
  const usage = record.usage;
  if (!usage) return 0;
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

/**
 * 计算峰值分钟。纯函数：不读时钟，输入即统计范围。
 */
export function peakMinute(sessions: readonly UsageSessionInput[]): PeakMinuteReport {
  const byMinute = new Map<number, number>();

  for (const session of sessions) {
    for (const record of session.records) {
      const tokens = recordTokens(record);
      if (tokens <= 0) continue;
      const minuteStart = Math.floor(record.timestamp / 60_000) * 60_000;
      byMinute.set(minuteStart, (byMinute.get(minuteStart) ?? 0) + tokens);
    }
  }

  const minutes: PeakMinute[] = [...byMinute]
    .map(([minuteStart, tokens]) => ({ minuteStart, tokens }))
    .sort((a, b) => b.tokens - a.tokens || a.minuteStart - b.minuteStart);

  const champion = minutes[0];
  if (!champion) {
    return { minuteStart: null, tokens: 0, runnerUp: null, distinctMinutes: 0 };
  }

  return {
    minuteStart: champion.minuteStart,
    tokens: champion.tokens,
    runnerUp: minutes[1] ?? null,
    distinctMinutes: minutes.length
  };
}
