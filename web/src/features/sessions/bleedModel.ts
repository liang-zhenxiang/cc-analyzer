import { PRICING_AS_OF, estimateCost, type CostEstimate } from "../usage/pricingSnapshot";
import { compactionAnchors, contextSeriesOf } from "./contextSeries";
import { droppedByEvent } from "./droppedMessages";
import { tokenTotalsOf, type TokenTotals } from "./tokenTotals";
import type { CompactEvent, ParsedSession, SessionRecord } from "./types";

/**
 * 上下文出血点归因（Round X，design-round-x-context-bleed.md §3）。
 *
 * 这个模块只做一件事：把「这次会话的上下文被什么撑大的」翻译成一份可核对的
 * 清单。它**不发明新指标**——每个数字要么是日志里读出来的，要么明确标注为
 * 「本实现无法从日志得出」。口径继承 `tokenTotals.ts`：四类计数器永远分开，
 * `total` 只做分母，不展示。
 */

/**
 * 一笔出血的类别。这是「归因」的枚举，不是新的 token 计数器。
 */
export type BleedKind =
  /** 被压缩丢掉的内容（日志事实：DroppedBucket 的按记录求和）。 */
  | "compaction"
  /** 工具调用占用的上下文（本实现只能给出调用次数，见 `BleedEvidence`）。 */
  | "toolOutput"
  /** 缓存重写的体积（cacheCreation 显著高于该会话中位数的时刻）。 */
  | "cacheRewrite";

/**
 * 一条条目的**证据等级**——这个读数到底有多少是日志事实。
 *
 * `logged`：token 体积直接读自记录的 `usage`，可逐条核对。
 * `countOnly`：只有**次数**是事实。解析器产出的 `kind === "tool"` 记录
 *   （`parseJsonl.ts:566-581`）**不带 `usage`**，工具的 token 量在日志里
 *   根本不存在，所以这一类只报次数，token 栏一律为 0 并由界面说明原因。
 *
 * 加这个字段是为了让「无法得知」有地方落，而不是被迫渲染成一个会被读成
 * 「不占空间」的 0。
 */
export type BleedEvidence = "logged" | "countOnly";

/** 一笔出血。金额字段与 token 字段分离，因为两者证据等级不同。 */
export type BleedItem = {
  kind: BleedKind;
  /** 人类可读的标题，例如「Read · 12 次调用」。 */
  label: string;
  /** 日志事实：这一类占用的 token 体积（四类分开，不求和）。 */
  totals: TokenTotals;
  /** 这笔出血的证据：涉及哪些记录（用于「点进去看」）。 */
  recordIds: string[];
  /** 折算金额。null 表示「全部定价未知」，0 是合法的「就是 0 美元」。 */
  usd: number | null;
  /** 未计入金额的调用数（定价未知）。0 表示全部计入。 */
  unpricedCalls: number;
  /** 这个读数的证据等级；`countOnly` 时 `totals` 全 0 不代表「不占空间」。 */
  evidence: BleedEvidence;
};

export type BleedReport = {
  items: BleedItem[];
  /** 会话的压缩边界总数。0 → 页面走空态。 */
  compactionCount: number;
  /** 是否含估算金额（provenance 语言，与全站一致）。 */
  hasEstimate: boolean;
  /** 定价快照日期，用于 ProvenanceBadge 的 detail。 */
  pricingAsOf: string;
};

/** 工具类条目的保留条数；其余合并为一项（§3.3-B）。 */
export const TOOL_OUTPUT_TOP_N = 6;

/** 工具名为空/缺失时的归入名（§3.3-B：不丢弃）。 */
export const UNNAMED_TOOL_LABEL = "未标注工具";

/** `countOnly` 条目在界面上的解释语，与 `evidence` 的注释说同一件事。 */
export const COUNT_ONLY_NOTE = "本实现无法从日志得出这些调用的 token 量";

function emptyTotals(): TokenTotals {
  return {
    input: 0,
    cacheCreation: 0,
    cacheCreationFiveMinute: 0,
    cacheCreationOneHour: 0,
    cacheRead: 0,
    output: 0,
    total: 0
  };
}

/** 非有限值（NaN / Infinity）降级为 0——求和里混进一个 Infinity 就毁掉整条。 */
function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 输入可能是 undefined/null（调用方的数据还没到位），缺数据不该抛。 */
function listOf<T>(value: readonly T[] | null | undefined): readonly T[] {
  return Array.isArray(value) ? value : [];
}

/**
 * 按 `model` 给一组记录定价（§3.3-D）。
 *
 * 每个模型分别调用 `estimateCost`——它的签名吃 `UsageTotals`（四类计数器的
 * 子集），`TokenTotals` 结构上兼容，直接传即可，两边不复制一份求和逻辑。
 * `estimateCost` 对未知 family 返回 `{ unknownModel: true }`，**绝不定价为 0**。
 *
 * 返回 `usd = null` 表示「一个组都定不了价」——这是「不知道」，与「就是 0
 * 美元」不同，不能让未知冒充零。
 */
function priceRecords(records: readonly SessionRecord[]): {
  usd: number | null;
  unpricedCalls: number;
  pricedCalls: number;
} {
  const byModel = new Map<string, SessionRecord[]>();
  for (const record of records) {
    // 没有 model 的记录同样要计数为「未定价」，不能静默漏掉。
    const key = typeof record.model === "string" && record.model.length > 0 ? record.model : "";
    const group = byModel.get(key);
    if (group) group.push(record);
    else byModel.set(key, [record]);
  }

  let usd = 0;
  let pricedCalls = 0;
  let unpricedCalls = 0;
  for (const [model, group] of byModel) {
    const estimate: CostEstimate = estimateCost(tokenTotalsOf(group), model);
    if ("unknownModel" in estimate) {
      unpricedCalls += group.length;
      continue;
    }
    // 定价快照是有限常量，但求和仍要挡住非有限值——一个 Infinity 会污染整笔。
    usd += finiteOrZero(estimate.usd);
    pricedCalls += group.length;
  }

  // 一次都没能定价 → 金额是「不知道」，不是 0。
  return { usd: pricedCalls === 0 ? null : usd, unpricedCalls, pricedCalls };
}

/** 中位数；空集合返回 null（不是 0——0 会与「中位数真的是 0」混淆）。 */
function medianOf(values: readonly number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (finite.length === 0) return null;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 === 1
    ? finite[middle]
    : (finite[middle - 1] + finite[middle]) / 2;
}

/**
 * A 类：对每个压缩边界，取「这个边界丢出了哪些消息」并汇总其 token。
 *
 * 调用形态照抄 `ContextView.tsx:65-71` 既有调用点（`compactionAnchors` →
 * `droppedByEvent`），不自己重组输入。
 *
 * 与 `CompactEvent.droppedTokens` 的关系：那是**上下文窗口体积**的累计值
 * （`cumulativeDroppedTokens`，相邻差恰为 `pre − post`），而这里是**四条
 * 计费计数器之和**——被 `cacheRead` 主导（同一段历史每轮都重读一遍），
 * 实测两者相差 20~24 倍且恒定。两者单位不同，**不可直接比对**，所以
 * `label` 里不并排这两个数（把不同单位的数放一起会把读者引向错误的比较）。
 */
function compactionItems(parsed: ParsedSession, events: readonly CompactEvent[]): BleedItem[] {
  if (events.length === 0) return [];

  const samples = contextSeriesOf(listOf(parsed.records));
  const anchors = compactionAnchors(samples, events);
  const buckets = droppedByEvent(
    listOf(parsed.records),
    listOf(parsed.sidechainMessages),
    events,
    samples,
    anchors
  );

  return events.map((event, index) => {
    const bucket = buckets.get(event.id);
    const records = listOf(bucket?.records);
    const totals = tokenTotalsOf(records);
    const priced = priceRecords(records);
    return {
      kind: "compaction" as const,
      label: `压缩 #${index + 1} · 丢掉 ${records.length} 条消息`,
      totals,
      recordIds: records.map((record) => record.fullId),
      usd: priced.usd,
      unpricedCalls: priced.unpricedCalls,
      evidence: "logged" as const
    };
  });
}

/**
 * B 类：按 `toolName` 分组统计工具调用（§3.3-B，经主会话裁决修订）。
 *
 * **为什么 token 栏全是 0**：解析器产出的 `kind === "tool"` 记录不带 `usage`
 * （`parseJsonl.ts:566-581`），`usage` 挂在承载它的 assistant 记录上
 * （`parseJsonl.ts:514`），且一条 assistant 可以带 N 个 tool_use。所以
 * 「这些调用花了多少 token」**无法从日志得出**，`tokenTotalsOf` 对它们恒为 0。
 *
 * 三处由此产生的口径：
 * - `evidence = "countOnly"`：只有次数是事实。
 * - 排序按**调用次数**降序（次数相同按工具名）。按 `totals.total` 降序是假排序
 *   ——全为 0 时它退化成「首次出现顺序」，却伪装成有意义的排序。
 * - `usd` 一律 `null`、`unpricedCalls` = 该组记录数：没有可定价的 token 量，
 *   「不知道」才是事实。**绝不允许出现 $0.00**。
 *
 * 不做按 assistant 记录 1/N 分摊：日志里没有这个数字的任何依据，它属于
 * 「发明新指标」（§2.2 禁止）。
 */
function toolOutputItems(records: readonly SessionRecord[]): BleedItem[] {
  const byTool = new Map<string, SessionRecord[]>();
  for (const record of listOf(records)) {
    if (record.kind !== "tool") continue;
    const name =
      typeof record.toolName === "string" && record.toolName.length > 0
        ? record.toolName
        : UNNAMED_TOOL_LABEL;
    const group = byTool.get(name);
    if (group) group.push(record);
    else byTool.set(name, [record]);
  }
  if (byTool.size === 0) return [];

  const groups = [...byTool.entries()].sort(
    ([nameA, a], [nameB, b]) => b.length - a.length || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0)
  );

  const head = groups.slice(0, TOOL_OUTPUT_TOP_N);
  const tail = groups.slice(TOOL_OUTPUT_TOP_N);

  const items: BleedItem[] = head.map(([name, group]) => ({
    kind: "toolOutput" as const,
    label: `${name} · ${group.length} 次调用`,
    totals: emptyTotals(),
    recordIds: group.map((record) => record.fullId),
    // 没有 usage → 没有可定价的 token 量。null 是「不知道」，不是「0 美元」。
    usd: null,
    unpricedCalls: group.length,
    evidence: "countOnly" as const
  }));

  if (tail.length > 0) {
    const restRecords = tail.flatMap(([, group]) => group);
    items.push({
      kind: "toolOutput" as const,
      // K 是真实类数，不是「若干」。
      label: `剩余工具 · ${tail.length} 类`,
      totals: emptyTotals(),
      recordIds: restRecords.map((record) => record.fullId),
      usd: null,
      unpricedCalls: restRecords.length,
      evidence: "countOnly" as const
    });
  }

  return items;
}

/**
 * C 类：找出「缓存重写显著」的调用（§3.3-C）。
 *
 * 判据：该记录的 `usage.cacheCreationTokens` 存在且 **>** 该会话 `cacheCreation`
 * 中位数的 2 倍。中位数为 0（或没有样本）→ **不产出此类**——中位数 0 意味着
 * 典型调用根本没写缓存，此时「2 倍于 0」不是信号，除以 0 更不行。
 */
function cacheRewriteItems(records: readonly SessionRecord[]): BleedItem[] {
  const pool = listOf(records).filter((record) => record.usage !== undefined);
  const median = medianOf(
    pool.map((record) => finiteOrZero(record.usage?.cacheCreationTokens))
  );
  // 中位数为 0 或无样本 → 不产出。`> 0` 同时挡住了 null 与 0。
  if (median === null || median <= 0) return [];

  const threshold = median * 2;
  const heavy = pool.filter(
    (record) => (record.usage?.cacheCreationTokens ?? 0) > threshold
  );
  if (heavy.length === 0) return [];

  const totals = tokenTotalsOf(heavy);
  const priced = priceRecords(heavy);
  return [
    {
      kind: "cacheRewrite" as const,
      label: `缓存重写 · ${heavy.length} 次调用`,
      totals,
      recordIds: heavy.map((record) => record.fullId),
      usd: priced.usd,
      unpricedCalls: priced.unpricedCalls,
      evidence: "logged" as const
    }
  ];
}

/**
 * 会话的出血点清单（§3.2 的唯一入口）。
 *
 * 任何输入缺失都不抛异常：缺 usage / 缺 model / 缺 samples / 缺 sidechain 都
 * 返回结构完整的对象（空数组 / null / 0）。所有数值保证有限。
 */
export function buildBleedReport(parsed: ParsedSession): BleedReport {
  const records = listOf(parsed?.records);
  const events = listOf(parsed?.compactEvents);

  const items: BleedItem[] = [
    ...compactionItems(parsed, events),
    ...toolOutputItems(records),
    ...cacheRewriteItems(records)
  ];

  return {
    items,
    compactionCount: events.length,
    // 「是否含估算金额」：有被定价的条目即为真。与 `evidence` 是两回事。
    hasEstimate: items.some((item) => item.usd !== null),
    pricingAsOf: PRICING_AS_OF
  };
}

/**
 * 一句话结论（§3.3-E）。纯字符串拼装，任何分支都不产出空串或 "undefined"。
 */
export function bleedHeadline(report: BleedReport): string {
  const count = report?.compactionCount ?? 0;
  if (!Number.isFinite(count) || count <= 0) return "本会话没有发生压缩";

  const items = listOf(report?.items);
  if (items.length === 0) {
    // 有压缩事件但清单为空：说事实，不编一个数字。
    return `${count} 次压缩，但没有可归因的出血点`;
  }

  const dropped = items
    .filter((item) => item.kind === "compaction")
    .reduce((sum, item) => sum + item.recordIds.length, 0);
  if (dropped <= 0) {
    return `${count} 次压缩，但没有丢掉任何消息`;
  }
  return `${count} 次压缩丢掉了 ${dropped} 条消息`;
}
