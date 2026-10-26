import type { UsageSessionInput } from "./usageAggregations";
import { addLocalDays, aggregateSession, dayStartOf, totalsSum } from "./usageAggregations";
import type { ErrorSessionFacts } from "./errorStats";
import type { ToolCallFact } from "./toolCensus";
import { censusKeyId } from "./toolCensus";

/**
 * 指纹雷达（D4）：一个项目（会话集合）在六个轴上的画像。六轴口径：
 *
 * - tokenIntensity = 总 tokens ÷ 活跃日（本地日，records 去重日键）——衡量
 *   「干活的日均强度」；
 * - messageDensity = messages ÷ 覆盖的小时格数（hourly 7×24 里非零格计数）
 *   ——分母是「出现过消息的 (星期, 小时) 组合数」，不是墙钟小时：一个每天
 *   10 点干活的项目密度高，一个 24 小时摊开的项目密度低；
 * - errorRate = errors ÷ messages（errors 来自 errorExtract 的事件数，含
 *   api 与 tool 两通道；messages 与 aggregateSession 同口径）；
 * - toolDiversity = distinct censusKeyId 数（toolCalls 事实里去重桶身份）；
 * - contextDepth = 单记录 cacheRead 最大值——上下文深度的代理指标；
 * - persistence = longestStreak（本地日连续活跃天数）。
 *
 * normalized 0..1 按全项目分位：调用方传入 sessions 数组（同一批会话，含
 * 本项目）时先算每轴 min/max 再线性归一；只有单项目（或未传）时全 0.5。
 * 极值并列时（max === min）该轴也取 0.5——所有项目一样好/差时没有排位可言。
 * errorExtract 缺省时 errorRate 的 normalized 恒 0.5 且 label 注「无错误数据」
 * （raw 仍按 0 报，分母不可知时不编数字）。
 */

export type RadarAxis =
  | "tokenIntensity"
  | "messageDensity"
  | "errorRate"
  | "toolDiversity"
  | "contextDepth"
  | "persistence";

/** projectRadar 的输入：UsageSessionInput 加两个可选提取物（与面板同通道）。 */
export type RadarSessionInput = UsageSessionInput & {
  errorExtract?: ErrorSessionFacts;
  toolCalls?: readonly ToolCallFact[];
};

export type RadarPoint = { axis: RadarAxis; raw: number; normalized: number; label: string };

const AXIS_LABELS: Record<RadarAxis, string> = {
  tokenIntensity: "token 强度",
  messageDensity: "消息密度",
  errorRate: "错误率",
  toolDiversity: "工具多样性",
  contextDepth: "上下文深度",
  persistence: "连续性"
};

/** 轴顺序即雷达图顶点顺序，导出供测试与视图共用。 */
export const RADAR_AXES: readonly RadarAxis[] = [
  "tokenIntensity",
  "messageDensity",
  "errorRate",
  "toolDiversity",
  "contextDepth",
  "persistence"
];

/** 一个会话（或一组会话）折成六轴原始值。无错误数据时 errors 记 0。 */
function rawAxes(session: RadarSessionInput): Record<RadarAxis, number> {
  const aggregate = aggregateSession(session.records);

  // 活跃日：records 时间戳的本地日去重（与 daily bucket 同一键）。
  const activeDays = new Set(session.records.map((record) => dayStartOf(record.timestamp)));
  const tokenIntensity = activeDays.size > 0 ? totalsSum(aggregate.totals) / activeDays.size : 0;

  // 覆盖小时格：hourly 7×24 的非零格数。aggregateSession 的 hourly 只数
  // user/assistant 消息（口径与看板热力图一致），分母与分子同域。
  let coveredCells = 0;
  for (const day of aggregate.hourly) {
    for (const count of day) {
      if (count > 0) coveredCells += 1;
    }
  }
  const messageDensity = coveredCells > 0 ? aggregate.messages / coveredCells : 0;

  const errors = session.errorExtract ? session.errorExtract.events.length : 0;
  const errorRate = aggregate.messages > 0 ? errors / aggregate.messages : 0;

  const toolDiversity = session.toolCalls
    ? new Set(session.toolCalls.map((fact) => censusKeyId(fact.key))).size
    : 0;

  let contextDepth = 0;
  for (const record of session.records) {
    const cacheRead = record.usage?.cacheReadTokens ?? 0;
    if (cacheRead > contextDepth) contextDepth = cacheRead;
  }

  // longestStreak：升序本地日键上的最长连续段（连续性按 addLocalDays 日历日
  // 判定，与 calendarInsights 的连胜扫描同一思想）。
  const dayKeys = [...activeDays].sort((a, b) => a - b);
  let persistence = 0;
  let run = 0;
  let prev: number | null = null;
  for (const day of dayKeys) {
    run = prev !== null && addLocalDays(prev, 1) === day ? run + 1 : 1;
    prev = day;
    if (run > persistence) persistence = run;
  }

  return {
    tokenIntensity,
    messageDensity,
    errorRate,
    toolDiversity,
    contextDepth,
    persistence
  };
}

/**
 * 六轴画像。`peers` 缺省（或只含本项目一个会话）时 normalized 全 0.5；
 * 传入同批会话时按每轴 min/max 归一（max === min 的轴取 0.5）。
 * `session` 与 `peers` 里的元素共享同一批 records 时结果一致（去重无必要：
 * 极值归一下多算一次自身不改 min/max）。
 */
export function projectRadar(
  session: RadarSessionInput,
  peers?: readonly RadarSessionInput[]
): RadarPoint[] {
  const raw = rawAxes(session);

  // 单项目（或未传 peers）→ 全 0.5，六轴口径里写死的规则。
  const cohort = peers && peers.length > 0 ? peers : [session];
  const hasPeers = cohort.length > 1;

  const peerRaw = cohort.map(rawAxes);
  const normalizedOf = (axis: RadarAxis): number => {
    if (!hasPeers) return 0.5;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const axes of peerRaw) {
      if (axes[axis] < min) min = axes[axis];
      if (axes[axis] > max) max = axes[axis];
    }
    if (max === min) return 0.5;
    return (raw[axis] - min) / (max - min);
  };

  const noErrorData = !session.errorExtract;

  return RADAR_AXES.map((axis) => ({
    axis,
    raw: raw[axis],
    normalized:
      axis === "errorRate" && noErrorData
        ? 0.5
        : clamp01(normalizedOf(axis)),
    label:
      axis === "errorRate" && noErrorData
        ? `${AXIS_LABELS[axis]}（无错误数据）`
        : AXIS_LABELS[axis]
  }));
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
