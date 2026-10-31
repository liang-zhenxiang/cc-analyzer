/**
 * 两份用量快照的差值对照（Round GG G10）。
 *
 * 输入是 designer 实现的 `usageSnapshotJson.ts` 导出的 JSON（schema
 * `"cca.usage.snapshot"`、version `1`、6 个指标 + 区间 + 导出时间）。页面拿到
 * 的两份文件来自不同时间，甚至不同版本，所以这里分两层处理：
 *
 * 1. **认不认这份文件**——`schema` 与可解析的 `version` 是硬门槛。缺 schema、
 *    错 schema（比如用户选了一份会话日志或别的 JSON）必须显式拒收并给出原因：
 *    宽容通过会让界面画出一张全是「—」的表，看上去像「两份快照没有差异」，
 *    实际是「这根本不是快照」。这是本轮唯一拒绝的情况。
 * 2. **认了之后字段缺失**——`range` / `totals` 里的单个字段缺失或类型不对，
 *    按 `null` 处理，两侧 `null` 的行照常出现在表里（界面印「—」）。
 *
 * 版本号数值不同时仍然对比，只把 `meta.versionMismatch` 置真，由界面提示
 * 「两份快照来自不同版本，缺失的字段按空值处理」——阻止对比是替用户做决定。
 *
 * ## 行顺序
 *
 * 固定为 {@link SNAPSHOT_METRICS} 的顺序，且与导出 JSON 的字段顺序一致：
 * 两次导出的文件 diff 起来，行序不该是噪音。
 *
 * ## 成本为什么不在对比行里
 *
 * v1 快照不导出成本（定价快照会过期，导出的成本数字会被当成「当时的真实
 * 账单」）。`estimatedCostUsd` 仍保留在类型与解析里，只为了读得动更早的、
 * 手写或实验性的文件；它不参与 {@link SNAPSHOT_METRICS}。
 */

export const USAGE_SNAPSHOT_SCHEMA = "cca.usage.snapshot";

/** designer 当前导出的格式版本。解析不要求等于它，只要求可解析。 */
export const USAGE_SNAPSHOT_SCHEMA_VERSION = 1;

export type UsageSnapshotTotals = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  messages: number | null;
  sessions: number | null;
  /** v1 不导出；保留只为读得动更早的文件。不参与对比表。 */
  estimatedCostUsd: number | null;
};

export type UsageSnapshotRange = {
  days: number | null;
  start: number | null;
  end: number | null;
};

export type UsageSnapshot = {
  /** 解析成功时必为 {@link USAGE_SNAPSHOT_SCHEMA}——由 {@link parseUsageSnapshot} 保证。 */
  schema: typeof USAGE_SNAPSHOT_SCHEMA;
  schemaVersion: number;
  /** 导出/生成时刻（ms）。 */
  generatedAt: number | null;
  range: UsageSnapshotRange;
  totals: UsageSnapshotTotals;
};

export type UsageSnapshotParseResult =
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; reason: string };

/** 参与对比的指标，顺序即表格行序（也是导出 JSON 的字段序）。 */
export const SNAPSHOT_METRICS: ReadonlyArray<{ key: keyof UsageSnapshotTotals; label: string }> = [
  { key: "inputTokens", label: "输入 tokens" },
  { key: "outputTokens", label: "输出 tokens" },
  { key: "cacheCreationTokens", label: "缓存写入 tokens" },
  { key: "cacheReadTokens", label: "缓存读取 tokens" },
  { key: "messages", label: "消息数" },
  { key: "sessions", label: "会话数" }
];

export type SnapshotCompareRow = {
  metric: string;
  a: number | null;
  b: number | null;
  /** b - a；任一侧为 `null` 时也是 `null`。 */
  delta: number | null;
  /** delta / a；a 为 `null`、0 或 b 缺失时为 `null`（界面印「—」）。 */
  deltaPct: number | null;
};

export type SnapshotCompareMeta = {
  aGeneratedAt: number | null;
  bGeneratedAt: number | null;
  aRange: UsageSnapshotRange;
  bRange: UsageSnapshotRange;
  /** 两份快照的 version 数值不同时为真（不阻止对比）。 */
  versionMismatch: boolean;
};

export type SnapshotComparison = {
  rows: SnapshotCompareRow[];
  meta: SnapshotCompareMeta;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * 解析一份快照 JSON。
 *
 * 只认有限的 `number`：字符串数字（`"123"`）按缺失处理而不是替用户转换——
 * 转换会把「导出时就已经坏了」的文件伪装成正常，差值看上去可信，实际不可信。
 * `range` / `totals` 字段缺失或类型不对时置 `null`；但 `schema` 与 `version`
 * 是身份门槛，不满足即拒收并返回人话原因。
 */
export function parseUsageSnapshot(value: unknown): UsageSnapshotParseResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, reason: "不是 JSON 对象" };
  }

  const root = value as Record<string, unknown>;
  if (root.schema === undefined) {
    return { ok: false, reason: `schema 字段缺失（期望 "${USAGE_SNAPSHOT_SCHEMA}"）` };
  }
  if (root.schema !== USAGE_SNAPSHOT_SCHEMA) {
    return {
      ok: false,
      reason: `schema 是 ${JSON.stringify(root.schema)}，期望 "${USAGE_SNAPSHOT_SCHEMA}"`
    };
  }

  const version = numberOrNull(root.version);
  if (version === null) {
    return { ok: false, reason: "version 缺失或不是有限数字" };
  }

  const totals = recordOf(root.totals);
  const range = recordOf(root.range);
  const pick = (key: keyof UsageSnapshotTotals) => numberOrNull(totals[key]);

  return {
    ok: true,
    snapshot: {
      schema: USAGE_SNAPSHOT_SCHEMA,
      schemaVersion: version,
      generatedAt: numberOrNull(root.generatedAt),
      range: {
        days: numberOrNull(range.days),
        start: numberOrNull(range.start),
        end: numberOrNull(range.end)
      },
      totals: {
        inputTokens: pick("inputTokens"),
        outputTokens: pick("outputTokens"),
        cacheCreationTokens: pick("cacheCreationTokens"),
        cacheReadTokens: pick("cacheReadTokens"),
        messages: pick("messages"),
        sessions: pick("sessions"),
        estimatedCostUsd: pick("estimatedCostUsd")
      }
    }
  };
}

/** 对比两份快照：行序固定，差值 = b - a，百分比以 a 为分母。 */
export function compareUsageSnapshots(a: UsageSnapshot, b: UsageSnapshot): SnapshotComparison {
  const rows = SNAPSHOT_METRICS.map(({ key, label }) => {
    const left = a.totals[key];
    const right = b.totals[key];
    const delta = left === null || right === null ? null : right - left;
    const deltaPct = left === null || left === 0 || delta === null ? null : delta / left;
    return { metric: label, a: left, b: right, delta, deltaPct };
  });

  return {
    rows,
    meta: {
      aGeneratedAt: a.generatedAt,
      bGeneratedAt: b.generatedAt,
      aRange: a.range,
      bRange: b.range,
      versionMismatch: a.schemaVersion !== b.schemaVersion
    }
  };
}
