import type { SessionRecord } from "../sessions/types";
import { censusKeyId } from "./toolCensus";
import { sessionTitle } from "../sessions/metadataCache";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * 会话相似度（G9）：为 target 会话在 pool 里找最像的 K 个——四维 Jaccard
 * 加权：项目(1) / 工具集(2) / 模型(1) / 时长桶(1)，总权重 5。
 *
 * 为什么用 Jaccard 而不是距离：四维全是**集合或分桶**属性，「像不像」
 * 天然是交集/并集之比；距离需要数值化（比如 token 差），会把「大项目
 * vs 小项目」错当成「不相似」。时长本可以算距离，但分桶（<15min /
 * 15–60min / 1–4h / >4h）后同一桶内「都干了半小时左右」与「都干了三
 * 小时」都是「时长同量级」，这正是推荐想要的粒度。
 *
 * 权重 2 给工具集：四个维度里工具集是最「做事方式」的信号（同样的活
 * 往往用同样的工具组合），项目名其次，模型/时长只是背景。
 *
 * 会话身份（排除自身）：meta.path 优先（真实扫描输入），手造输入退回
 * 下标拼的 key——同一份 pool 里 target 与候选的身份各自稳定即可。
 *
 * score = 0 的候选照常返回（排最后）——显示不显示是界面的决定，数据层
 * 不替界面做「0 分 = 不存在」的裁剪（0 分会话对「为什么没有相似的」
 * 这句话也是有用的证据）。
 */

/** 时长桶边界（分钟，左闭右开语义的描述见 bucketOf）。 */
export const DURATION_BUCKETS = {
  short: 15,
  medium: 60,
  long: 240
} as const;

export type DurationBucket = "short" | "medium" | "long" | "marathon";

/** <15min → short；15–60 → medium；60–240 → long；>4h(240min) → marathon。 */
export function durationBucketOf(minutes: number): DurationBucket {
  if (minutes < DURATION_BUCKETS.short) return "short";
  if (minutes < DURATION_BUCKETS.medium) return "medium";
  if (minutes < DURATION_BUCKETS.long) return "long";
  return "marathon";
}

/** 四维权重：项目 1 / 工具集 2 / 模型 1 / 时长桶 1，合计 5。 */
const WEIGHTS = { project: 1, tools: 2, models: 1, duration: 1 } as const;
const TOTAL_WEIGHT =
  WEIGHTS.project + WEIGHTS.tools + WEIGHTS.models + WEIGHTS.duration;

/** 一个会话折成四维比较用的中间形状。 */
type Facets = {
  project: string;
  tools: Set<string>;
  models: Set<string>;
  duration: DurationBucket;
  /** 推荐行的展示名（sessionTitle 同款优先级）。 */
  label: string;
  /** 自身排除用的稳定身份。 */
  identity: string;
};

/** 首末 timestamp 差（分钟）；与 workHabits.longestSessionMinutes 同墙钟口径。 */
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

function facetsOf(session: UsageSessionInput, identity: string): Facets {
  const tools = new Set<string>();
  for (const fact of session.toolCalls ?? []) {
    tools.add(censusKeyId(fact.key));
  }
  const models = new Set<string>();
  for (const record of session.records) {
    if (!record.usage) continue;
    models.add(record.model ?? "未知模型");
  }
  return {
    project: session.projectLabel,
    tools,
    models,
    duration: durationBucketOf(durationMinutesOf(session.records)),
    label: session.session ? sessionTitle(session.session) : session.projectLabel,
    identity
  };
}

/** Jaccard：|A∩B| / |A∪B|；两边都空集时 0（没有证据说「像」）。 */
function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** 推荐一行：会话、加权得分、人话理由。 */
export type SimilarSession = {
  session: UsageSessionInput;
  /** 0–1 加权 Jaccard（÷ 总权重 5）。 */
  score: number;
  /** 人话理由，按贡献从大到小排；全空时只有一句「无共同维度」。 */
  reasons: string[];
};

/** target 与 pool 里的会话两两算分，取前 K。 */
export function topKSimilar(
  target: UsageSessionInput,
  pool: readonly UsageSessionInput[],
  k: number = 3
): SimilarSession[] {
  const targetIdentity = target.session?.path ?? "target";
  const targetFacets = facetsOf(target, targetIdentity);

  const results: SimilarSession[] = [];
  pool.forEach((session, index) => {
    const identity = session.session?.path ?? `pool-${index}`;
    if (identity === targetIdentity) return; // pool 里与 target 同 id 的排除

    const facets = facetsOf(session, identity);
    const parts: Array<{ weight: number; value: number; reason: string | null }> = [];

    const projectScore = targetFacets.project === facets.project ? 1 : 0;
    parts.push({
      weight: WEIGHTS.project,
      value: projectScore,
      reason: projectScore > 0 ? "同项目" : null
    });

    const toolJaccard = jaccard(targetFacets.tools, facets.tools);
    let sharedTools = 0;
    for (const tool of targetFacets.tools) {
      if (facets.tools.has(tool)) sharedTools += 1;
    }
    parts.push({
      weight: WEIGHTS.tools,
      value: toolJaccard,
      // 交集为 0 时不给理由（权重维度贡献 0，说了反而像凑数）。
      reason: sharedTools > 0 ? `用了 ${sharedTools} 个相同工具` : null
    });

    const modelJaccard = jaccard(targetFacets.models, facets.models);
    let sharedModels = 0;
    for (const model of targetFacets.models) {
      if (facets.models.has(model)) sharedModels += 1;
    }
    parts.push({
      weight: WEIGHTS.models,
      value: modelJaccard,
      reason: sharedModels > 0 ? `同模型（${sharedModels} 个）` : null
    });

    const durationScore = targetFacets.duration === facets.duration ? 1 : 0;
    parts.push({
      weight: WEIGHTS.duration,
      value: durationScore,
      reason: durationScore > 0 ? "时长同量级" : null
    });

    const score = parts.reduce((sum, part) => sum + part.weight * part.value, 0) / TOTAL_WEIGHT;

    const reasons = parts
      .filter((part) => part.reason !== null)
      .sort((a, b) => b.weight * b.value - a.weight * a.value)
      .map((part) => part.reason as string);

    results.push({
      session,
      score,
      reasons: reasons.length > 0 ? reasons : ["无共同维度"]
    });
  });

  // score 降序；并列按会话身份字典序（同输入同输出的稳定序）。
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aId = a.session.session?.path ?? "";
    const bId = b.session.session?.path ?? "";
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  });

  return results.slice(0, Math.max(0, k));
}
