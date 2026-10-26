import { formatProjectPath } from "../../lib/format";
import { estimateCost } from "./pricingSnapshot";
import {
  addUsage,
  emptyTotals,
  usageTokens,
  windowDayStarts
} from "./projectArena";
import {
  dayStartOf,
  totalsSum,
  UNKNOWN_MODEL_LABEL,
  type UsageSessionInput,
  type UsageTotals
} from "./usageAggregations";

/**
 * 项目卡片的纯逻辑（Round CC / F6）。
 *
 * 窗口口径与 `aggregateRange` 相同（本地日、含今天、只看落在窗口里的记录），
 * 但每张卡还要一条固定的「近 14 天」走势——它与 7/30/90 区间**正交**：区间
 * 回答「这段窗口里用了多少」，走势回答「最近两周的节奏」，两个问题不该共用
 * 一个分母。卡上因此只给走势一个无刻度的小图，不给它套区间里的小时数。
 */

export const CARD_LIMIT = 8;
export const SPARKLINE_DAYS = 14;

export type ProjectCard = {
  /** Encoded project directory name — the stable key and what actions act on. */
  label: string;
  /** Last path segment of the real cwd when known, else the label as-is. */
  displayName: string;
  path?: string;
  sessions: number;
  tokens: number;
  messages: number;
  /** `null` when the project used a model with no pricing snapshot entry. */
  usd: number | null;
  /** Newest in-window record timestamp. */
  lastActive: number;
  /** Tokens per local day for the last 14 days, oldest first. */
  sparkline: number[];
};

type ProjectAccumulator = {
  label: string;
  path?: string;
  sessions: number;
  messages: number;
  totals: UsageTotals;
  models: Map<string, UsageTotals>;
  lastActive: number;
  sparkline: number[];
};

/**
 * Prices one project's in-window usage.
 *
 * A partial sum would be a number that looks complete but is not — this
 * dashboard already refuses that at the page level with a footnote, and a card
 * has no room for the footnote. So one unpriced model turns the whole card's
 * cost into `null` (「定价未知」) instead of a quietly short total.
 */
function costOfProject(models: ReadonlyMap<string, UsageTotals>): number | null {
  let usd = 0;
  let unpriced = false;
  for (const [model, totals] of models) {
    const estimate = estimateCost(totals, model);
    if ("unknownModel" in estimate) unpriced = true;
    else usd += estimate.usd;
  }
  return unpriced ? null : usd;
}

/**
 * One card per project that had activity in the window, biggest first.
 *
 * A project drops out when none of its records fall inside the window — the
 * same inclusion rule `aggregateRange` uses for its project buckets, so the
 * cards and 「按项目分布」 can never disagree about which projects exist.
 */
export function buildProjectCards(
  inputs: readonly UsageSessionInput[],
  days: number,
  limit: number = CARD_LIMIT,
  now: number = Date.now()
): ProjectCard[] {
  const dayStarts = windowDayStarts(days, now);
  const startTs = dayStarts[0] ?? 0;
  const sparkStarts = windowDayStarts(SPARKLINE_DAYS, now);
  const sparkStart = sparkStarts[0] ?? 0;
  const sparkIndexOf = new Map(sparkStarts.map((dayStart, index) => [dayStart, index]));

  const byLabel = new Map<string, ProjectAccumulator>();
  // A project with no in-window record is not a card at all — it must not be
  // revived by older sparkline days. Decide membership first; then the second
  // pass may still fold a *different* session's older records into that
  // project's sparkline, because the sparkline is honestly "最近 14 天" and the
  // 14-day window can start before the selected range.
  const activeLabels = new Set<string>();
  for (const input of inputs) {
    if (input.records.some((record) => record.timestamp >= startTs)) {
      activeLabels.add(input.projectLabel);
    }
  }

  for (const input of inputs) {
    const records = input.records;
    if (!activeLabels.has(input.projectLabel)) continue;

    let entry = byLabel.get(input.projectLabel);
    if (!entry) {
      entry = {
        label: input.projectLabel,
        path: input.projectPath,
        sessions: 0,
        messages: 0,
        totals: emptyTotals(),
        models: new Map(),
        lastActive: 0,
        sparkline: sparkStarts.map(() => 0)
      };
      byLabel.set(input.projectLabel, entry);
    } else if (!entry.path && input.projectPath) {
      // First real cwd wins, exactly like the page's projectPaths map.
      entry.path = input.projectPath;
    }
    if (records.some((record) => record.timestamp >= startTs)) entry.sessions += 1;

    for (const record of records) {
      if (record.timestamp < startTs) continue;
      if (record.timestamp > entry.lastActive) entry.lastActive = record.timestamp;

      // Messages count conversation activity only: a compact summary is a
      // continuation artifact, not something the user typed.
      if (
        (record.kind === "user" || record.kind === "assistant") &&
        record.compactSummary !== true
      ) {
        entry.messages += 1;
      }

      const usage = record.usage;
      if (!usage) continue;
      addUsage(entry.totals, usage);
      const model = record.model ?? UNKNOWN_MODEL_LABEL;
      let bucket = entry.models.get(model);
      if (!bucket) {
        bucket = emptyTotals();
        entry.models.set(model, bucket);
      }
      addUsage(bucket, usage);
    }

    for (const record of records) {
      if (record.timestamp < sparkStart) continue;
      const usage = record.usage;
      if (!usage) continue;
      const index = sparkIndexOf.get(dayStartOf(record.timestamp));
      if (index === undefined) continue;
      entry.sparkline[index] += usageTokens(usage);
    }
  }

  return [...byLabel.values()]
    .map((entry): ProjectCard => {
      const card: ProjectCard = {
        label: entry.label,
        displayName: formatProjectPath(entry.label, entry.path),
        sessions: entry.sessions,
        tokens: totalsSum(entry.totals),
        messages: entry.messages,
        usd: costOfProject(entry.models),
        lastActive: entry.lastActive,
        sparkline: entry.sparkline
      };
      if (entry.path) card.path = entry.path;
      return card;
    })
    .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label))
    .slice(0, Math.max(0, Math.floor(limit)));
}
