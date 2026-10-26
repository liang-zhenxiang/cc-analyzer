import { censusKeyId, type ToolCallFact } from "./toolCensus";

/**
 * 工具健康（D2）：把工具普查的「调用事实」翻成可读的失败率与耗时画像。
 *
 * 数据从哪来：`ToolCallFact` 的 `durationMs` / `isError` 两个**可选**字段，
 * 由 `extractToolCalls` 在 tool_use 与 tool_result 配对时写入（见 toolCensus.ts
 * 模块头注释里的扩展点说明）。未配对的 tool_use 既有字段缺失——这里把它们
 * 当作「观测不到的调用」而不是成功调用：
 *
 *   - `calls`（失败率分母）= 有 `isError` 观测的调用数；
 *   - 耗时同理，缺失不按 0 记，直接从均值/p95 的样本里排除。
 *
 * 诚实性口径（与 limitForecast 的「样本不足不硬拗」同款）：
 *   - `calls < MIN_FAILURE_SAMPLE` 时 `failureRate = null`，界面不该印百分号；
 *   - 完全没有耗时样本时 `avgMs` / `p95Ms = null`，不是 0。
 *
 * p95 的口径：**最近一次观测往前 100 次**（按 timestamp 升序取尾部），再对
 * 这至多 100 个耗时做 nearest-rank（第 ceil(0.95·n) 个）。窗口只限制 p95，
 * 均值仍用全部已知样本——p95 回答「最近有多慢」，均值回答「平均有多慢」。
 */

/** 失败率的最小样本量：低于它只报调用数，不报百分比。 */
export const MIN_FAILURE_SAMPLE = 3;

/** p95 只看最近这么多次观测（按时间序）。 */
export const P95_SAMPLE_WINDOW = 100;

export type ToolHealthEntry = {
  /** 与 toolCensus 同一稳定身份（`builtin:Bash`、`mcp:<server>` 等）。 */
  key: string;
  /** 可判定结果的调用数（失败率分母）；未配对的 tool_use 不计入。 */
  calls: number;
  /** 其中报错的次数。 */
  failures: number;
  /** 失败率；样本不足（calls < 3）为 null。 */
  failureRate: number | null;
  /** 平均耗时（ms）；没有已知耗时样本时为 null。 */
  avgMs: number | null;
  /** 最近 100 次观测的 p95（ms）；没有已知耗时样本时为 null。 */
  p95Ms: number | null;
  /** 该工具最后一次**发起**的时刻（含未配对调用）。 */
  lastUsedAt: number;
};

export type ToolHealthReport = {
  /** 全部工具，按 key 码元字典序稳定排列（与 locale 无关，便于 UI 定序）。 */
  tools: ToolHealthEntry[];
  /**
   * 按风险排序的全部工具（界面自行取前 N）：失败率降序 → 调用数降序 →
   * key 码元字典序。失败率未知（null）排在有数据的工具之后——样本不足
   * 不能冒充「最健康」，也不能冒充「最危险」。
   */
  worst: ToolHealthEntry[];
};

type Acc = {
  key: string;
  calls: number;
  failures: number;
  /** 已知耗时样本，保留时间戳以便 p95 取最近 100 次。 */
  durations: Array<{ at: number; ms: number }>;
  lastUsedAt: number;
};

/** 码元字典序（code-unit），避免 localeCompare 随运行环境变化。 */
function compareKey(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function p95Of(durations: ReadonlyArray<{ at: number; ms: number }>): number | null {
  if (durations.length === 0) return null;
  // 按时间升序取尾部 100 个；同一时刻的样本保留原顺序（稳定排序不是必须，
  // 因为对「最近 100 次」而言同刻样本互换不影响集合）。
  const recent = [...durations]
    .sort((a, b) => a.at - b.at)
    .slice(-P95_SAMPLE_WINDOW)
    .map((sample) => sample.ms)
    .sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(0.95 * recent.length) - 1);
  return recent[rank];
}

function toEntry(acc: Acc): ToolHealthEntry {
  const failureRate = acc.calls >= MIN_FAILURE_SAMPLE ? acc.failures / acc.calls : null;
  const avgMs =
    acc.durations.length > 0
      ? acc.durations.reduce((sum, sample) => sum + sample.ms, 0) / acc.durations.length
      : null;
  return {
    key: acc.key,
    calls: acc.calls,
    failures: acc.failures,
    failureRate,
    avgMs,
    p95Ms: p95Of(acc.durations),
    lastUsedAt: acc.lastUsedAt
  };
}

function byRisk(a: ToolHealthEntry, b: ToolHealthEntry): number {
  // null 视为「未知」，排在有失败率数据的工具之后；两者都 null 时继续比调用数。
  const aRate = a.failureRate ?? -1;
  const bRate = b.failureRate ?? -1;
  if (bRate !== aRate) return bRate - aRate;
  if (b.calls !== a.calls) return b.calls - a.calls;
  return compareKey(a.key, b.key);
}

/**
 * 聚合工具调用事实。纯函数：不读时钟、不做窗口过滤——调用方传入的
 * 事实集合就是它要回答的那段区间。
 */
export function toolHealth(facts: readonly ToolCallFact[]): ToolHealthReport {
  const byKey = new Map<string, Acc>();

  for (const fact of facts) {
    const key = censusKeyId(fact.key);
    let acc = byKey.get(key);
    if (!acc) {
      acc = { key, calls: 0, failures: 0, durations: [], lastUsedAt: fact.timestamp };
      byKey.set(key, acc);
    }
    acc.lastUsedAt = Math.max(acc.lastUsedAt, fact.timestamp);

    if (typeof fact.isError === "boolean") {
      acc.calls += 1;
      if (fact.isError) acc.failures += 1;
    }

    const ms = fact.durationMs;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) {
      acc.durations.push({ at: fact.timestamp, ms });
    }
  }

  const tools = [...byKey.values()].map(toEntry).sort((a, b) => compareKey(a.key, b.key));
  const worst = [...tools].sort(byRisk);
  return { tools, worst };
}
