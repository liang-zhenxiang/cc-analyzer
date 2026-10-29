import { formatModelId, formatProjectPath } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import type { SessionUsage } from "../sessions/types";
import { labWindow } from "./constellation";
import { estimateCost } from "./pricingSnapshot";
import {
  UNKNOWN_MODEL_LABEL,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 最贵时刻名人堂（F5）：所选窗口内、跨会话的全部已定价调用，按单次估算成本
 * 降序取前 10。
 *
 * 「一次调用」= 一条带 `usage` 的主链记录（子 agent 的账单不在 `records` 里，
 * 与页面成本读数同一口径）。无定价模型的调用**不参与排名**，单独报数——
 * 未知不是 0，不能混进榜尾装作便宜。
 *
 * 排名规则写死：成本降序 → 时间升序 → 标题 → 输入序号。并列按时间先后，
 * 不提示「并列」，因为规则本身是确定的。
 */

export const HALL_PODIUM_SIZE = 3;
export const HALL_DEFAULT_LIMIT = 10;

export type HallEntry = {
  /** 输入序号 + 记录序号，同一份输入永远得到同一个 key。 */
  id: string;
  /** 1-based 名次（榜单里显示的是这个数，不是数组下标）。 */
  rank: number;
  usd: number;
  timestamp: number;
  /** 原始模型 id（title / 排错用）；展示用 `modelLabel`。 */
  model: string;
  modelLabel: string;
  projectLabel: string;
  projectName: string;
  title: string;
  session?: SessionMeta;
};

export type HallOfFame = {
  /** 前 `limit` 名（默认 10）。 */
  entries: HallEntry[];
  /** 前三名；不足 3 次可定价调用时为空。 */
  podium: HallEntry[];
  /** 领奖台之后的榜单；没有领奖台时就是完整 entries。 */
  runnersUp: HallEntry[];
  hasPodium: boolean;
  /** 已定价调用总数（含未进入前 N 的）。 */
  pricedCalls: number;
  /** 无定价模型、未参与排名的调用数。 */
  unpricedCalls: number;
  /** 因 limit 未展示的已定价调用数。 */
  hiddenCalls: number;
  windowStart: number;
  windowEnd: number;
  windowDays: number;
  windowLabel: string;
};

export type HallOfFameOptions = {
  /** 展示条数上限；130% 字号降到 7，默认 10。 */
  limit?: number;
};

type Candidate = Omit<HallEntry, "rank">;

function usageTotals(usage: SessionUsage): UsageTotals {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheCreation: usage.cacheCreationTokens ?? 0,
    cacheRead: usage.cacheReadTokens ?? 0
  };
}

export function buildHallOfFame(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number,
  options: HallOfFameOptions = {}
): HallOfFame {
  const { startTs, endTs, windowDays } = labWindow(days, now);
  const requested = options.limit ?? HALL_DEFAULT_LIMIT;
  const limit = Math.min(
    HALL_DEFAULT_LIMIT,
    Math.max(1, Math.floor(Number.isFinite(requested) ? requested : HALL_DEFAULT_LIMIT))
  );

  const candidates: Candidate[] = [];
  let unpricedCalls = 0;

  inputs.forEach((source, inputIndex) => {
    const projectPath = source.projectPath ?? source.session?.cwd;
    const projectName = formatProjectPath(source.projectLabel, projectPath);
    const title = source.session ? sessionTitle(source.session) : projectName;

    source.records.forEach((record, recordIndex) => {
      if (record.timestamp < startTs || record.timestamp >= endTs) return;
      const usage = record.usage;
      if (!usage) return;
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      const estimate = estimateCost(usageTotals(usage), model);
      if ("unknownModel" in estimate) {
        unpricedCalls += 1;
        return;
      }
      candidates.push({
        id: `${inputIndex}:${recordIndex}`,
        usd: estimate.usd,
        timestamp: record.timestamp,
        model,
        modelLabel: formatModelId(model),
        projectLabel: source.projectLabel,
        projectName,
        title,
        session: source.session
      });
    });
  });

  candidates.sort(
    (a, b) =>
      b.usd - a.usd ||
      a.timestamp - b.timestamp ||
      a.title.localeCompare(b.title) ||
      a.id.localeCompare(b.id)
  );

  const entries: HallEntry[] = candidates
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const podium = entries.length >= HALL_PODIUM_SIZE ? entries.slice(0, HALL_PODIUM_SIZE) : [];
  const runnersUp = entries.slice(podium.length);

  return {
    entries,
    podium,
    runnersUp,
    hasPodium: podium.length > 0,
    pricedCalls: candidates.length,
    unpricedCalls,
    hiddenCalls: Math.max(0, candidates.length - entries.length),
    windowStart: startTs,
    windowEnd: endTs,
    windowDays,
    windowLabel: `近 ${windowDays} 天`
  };
}
