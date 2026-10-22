import {
  PRICING_AS_OF,
  classRate,
  pricingFamilyFor,
  type ModelFamily
} from "../usage/pricingSnapshot";
import type { RecordKind, SessionRecord, SessionUsage } from "./types";

/**
 * 会话账单（Round BB，design-round-bb-cost-ledger.md）的纯逻辑层。
 *
 * 这个模块只回答一个问题：**这次会话的估算成本，按四个计费科目、按模型、
 * 按最贵的那几次调用，分别是多少。** 没有 React、没有 `Date.now()`、没有
 * I/O——输入全部由调用方传入，输出是一个可以逐位复算的对象。
 *
 * 三条不能被抹平的读数，本模块刻意分开：
 *
 * - **四类计数器永远分开。** `input` / `output` / `cacheWrite` / `cacheRead`
 *   的单价差一个数量级（Sonnet：3 / 15 / 3.75 / 0.3，每百万 token），所以
 *   「token 总量」与「花了多少钱」是两个形状完全不同的东西。任何「先求和再乘
 *   一个均价」的做法都会同时错掉每一行——那是本模块存在的原因。
 * - **不知道就是 `null`，不是 0。** 未收录的模型没有单价，它的金额是「不知道」；
 *   写成 `$0.00` 会让一次真实的支出从账单上消失。`totalUsd` 同理：一次可定价
 *   调用都没有时是 `null`，不是「花了 0 元」。
 * - **未定价的 token 不进收据。** 收据要能被读者用「量 × 单价」复算出来；
 *   把算不出钱的 token 混进 `classes[].tokens`，那张表就会出现「有量、无金额」
 *   的行，合计对不上账。它们只出现在 `models[].tokens` 与 `unpricedTokens`
 *   里，并额外用 `unpricedCalls` / `unpricedModels` 明说「有 N 次调用没计入」。
 *
 * 性能：单趟 O(n) 扫描、O(模型数 + 5) 额外空间（最贵调用榜只留 5 条，不为
 * 一万条记录建一个全量数组）。调用方用 `useMemo` 按 `parsed` 记忆即可。
 */

/** 四个计费科目。`cacheWrite` = `cache_creation_input_tokens`。 */
export type LedgerClassKey = "input" | "output" | "cacheWrite" | "cacheRead";

export type LedgerClassLine = {
  key: LedgerClassKey;
  /** 只统计**可定价**调用的 token；未定价调用的量不进这里（见 unpriced* 字段）。 */
  tokens: number;
  usd: number;
  /** usd / pricedTotalUsd；pricedTotalUsd 为 0 时是 0。 */
  share: number;
};

export type LedgerModelLine = {
  model: string;
  /** null = 定价未知。 */
  family: ModelFamily | null;
  /** 带 usage 的调用数。 */
  calls: number;
  tokens: Record<LedgerClassKey, number>;
  /** 该模型没有任何可定价调用时为 null（不是 0）。 */
  usd: number | null;
  /**
   * 该模型里定价未知的调用数（只数带 usage 的）。
   *
   * 与 `CostLedger.unpricedCalls` **不是同一个量**：全局那个还包含
   * 「缺 usage 的调用」，而缺 usage 的调用归不到任何模型行（没读数就
   * 没模型归属）。所以 `Σ models[].unpricedCalls ≤ unpricedCalls`，
   * 有缺 usage 的调用时严格小于。界面不要把两个数并排当同一个指标。
   */
  unpricedCalls: number;
};

export type LedgerCallLine = {
  recordId: string;
  timestamp: number;
  kind: RecordKind;
  model: string;
  tokens: Record<LedgerClassKey, number>;
  /** 只收可定价的调用。 */
  usd: number;
};

export type CostLedger = {
  /** 固定四个，顺序 input/output/cacheWrite/cacheRead，含 0 行。 */
  classes: LedgerClassLine[];
  /** 可定价的按 usd 降序，未知 family 的排最后。 */
  models: LedgerModelLine[];
  /** 一次可定价调用都没有时为 null。 */
  totalUsd: number | null;
  pricedCalls: number;
  /**
   * 算不进账的模型调用：**缺 usage + 缺 model / 未收录 family 合并成一个数**。
   *
   * 它的含义就是「没有可用的 token 读数、或定价未知的模型调用」，不是
   * 其中单独哪一种。界面只在收据脚注报这一个总数（「另有 N 次调用未
   * 计入」），逐模型的分项在 `models[].unpricedCalls` 里各报各的。
   */
  unpricedCalls: number;
  /** 未定价调用的四类 token 之和。 */
  unpricedTokens: number;
  /** 去重、按出现顺序。 */
  unpricedModels: string[];
  /** 缓存经济学：**全部按可定价调用计算**，与 `classes` 同一批记录。 */
  cache: {
    /** === classes[cacheRead].tokens（不变量，测试钉死）。 */
    readTokens: number;
    /** === classes[input].tokens（不变量，测试钉死）。 */
    inputTokens: number;
    /** read/(read+input)，分母 0 → null。 */
    hitRate: number | null;
    /** Σ 逐模型 readTokens × (input 单价 − cacheRead 单价) / 1M。 */
    savedUsd: number;
  };
  /** 按 usd 降序、并列按 timestamp 升序，最多 5 条。 */
  topCalls: LedgerCallLine[];
  span: { start: number; end: number };
  /** 直接透传 `PRICING_AS_OF`。 */
  pricingAsOf: string;
};

/**
 * 四个科目的固定顺序——账单的行序就是它，不随数据变化。
 *
 * **导出给界面用**：四行的顺序是账单语义的一部分（收据从上往下就是输入 →
 * 输出 → 缓存写入 → 缓存读取），界面照这个常量渲染，不要自己再排一遍，
 * 也不要按「有金额的行在前」之类的规则重排。
 */
export const LEDGER_CLASS_ORDER: readonly LedgerClassKey[] = [
  "input",
  "output",
  "cacheWrite",
  "cacheRead"
];

/** 最贵调用榜的容量。 */
export const TOP_CALLS_LIMIT = 5;

/** 缺 `model` 时的模型名。PRD 口径 3 原文，界面直接显示这一串。 */
export const MISSING_MODEL_LABEL = "（未记录模型）";

/** 单价是「每百万 token」，token 量要除这个数才落到美元。 */
const TOKENS_PER_PRICE_UNIT = 1_000_000;

/** 内部累加器：与对外的 `LedgerModelLine` 只差「usd 什么时候才算 null」。 */
type ModelAccumulator = {
  model: string;
  family: ModelFamily | null;
  /** 首次出现序号，用于排序并列时保持日志顺序。 */
  order: number;
  calls: number;
  tokens: Record<LedgerClassKey, number>;
  usd: number;
  pricedCalls: number;
  unpricedCalls: number;
};

function emptyClasses(): Record<LedgerClassKey, number> {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
}

/** 非有限值（NaN / Infinity）降级为 0——求和里混进一个就毁掉整张账单。 */
function finiteOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 把一条 `usage` 摊成四个科目。
 *
 * 缺计数器按 0 算（`types.ts:20-25`：Claude Code 在「这次没写缓存」时整段省略
 * `cache_creation_input_tokens`，省略是零，不是未知）；`cache_creation` 落到
 * `cacheWrite` 科目，与 `pricingSnapshot` 的四类单价一一对应。
 */
function tokensOf(usage: SessionUsage): Record<LedgerClassKey, number> {
  return {
    input: finiteOrZero(usage.inputTokens),
    output: finiteOrZero(usage.outputTokens),
    cacheWrite: finiteOrZero(usage.cacheCreationTokens),
    cacheRead: finiteOrZero(usage.cacheReadTokens)
  };
}

/** 缺 `model` 的记录用一个可见的占位名成组——丢弃它就等于丢掉一笔真实支出。 */
function modelLabelOf(model: string | undefined): string {
  return typeof model === "string" && model.length > 0 ? model : MISSING_MODEL_LABEL;
}

/**
 * 榜单排序键：金额降序，并列按时间升序（口径 7）。
 *
 * 刻意用「严格更靠前」而不是返回比较数：调用榜是逐个插入的小数组，
 * 「并列」必须由插入规则决定，而不是依赖排序算法是否稳定。
 */
function ranksBefore(candidate: LedgerCallLine, than: LedgerCallLine): boolean {
  if (candidate.usd !== than.usd) return candidate.usd > than.usd;
  return candidate.timestamp < than.timestamp;
}

/**
 * 把一次调用放进「最贵的五次」榜。
 *
 * 榜最多 5 条，插入位置线性扫描（5 次比较），所以整体仍是 O(n)——不为
 * 一万条记录建一个全量候选数组再排序。
 *
 * 并列处理：金额与时间都相同的两条调用，**先出现在日志里的排在前面**
 * （循环在「对方不比我更靠前」时继续往后走，等号会走到已有条目之后），
 * 于是第 6 条同龄调用被长度截断挡在榜外。跨轮次稳定的顺序来自日志本身。
 */
function insertTopCall(kept: LedgerCallLine[], call: LedgerCallLine): void {
  let index = 0;
  while (index < kept.length && !ranksBefore(call, kept[index])) index += 1;
  if (index >= TOP_CALLS_LIMIT) return;
  kept.splice(index, 0, call);
  if (kept.length > TOP_CALLS_LIMIT) kept.pop();
}

/**
 * 模型行的排序（口径 3 的后半句）：可定价的按金额降序排前面，未知 family 的
 * 一律排最后。并列时按首次出现顺序，让同一份日志每次渲染顺序一致。
 *
 * 未知模型排最后不是审美问题：它们的金额是 null，混在金额行中间会让读者
 * 以为「这个模型花了很少」，而事实是「不知道它花了多少」。
 */
function compareModelAccumulators(a: ModelAccumulator, b: ModelAccumulator): number {
  const aPriced = a.family !== null;
  const bPriced = b.family !== null;
  if (aPriced !== bPriced) return aPriced ? -1 : 1;
  if (aPriced && bPriced && b.usd !== a.usd) return b.usd - a.usd;
  return a.order - b.order;
}

/**
 * 构建一次会话的账单（PRD R2 的唯一入口）。
 *
 * 任何输入缺失都不抛异常：缺 usage / 缺 model / 未收录 family 都返回结构
 * 完整的对象（四个 0 行 / null / 空数组）。所有数值保证有限。
 */
export function buildCostLedger(records: readonly SessionRecord[]): CostLedger {
  // 调用方的 `parsed` 可能还没到位；缺数据不该让整页崩掉。
  const list: readonly SessionRecord[] = Array.isArray(records) ? records : [];

  const classTokens = emptyClasses();
  const classUsd = emptyClasses();
  const models = new Map<string, ModelAccumulator>();
  const unpricedModels: string[] = [];
  const unpricedSeen = new Set<string>();
  const topCalls: LedgerCallLine[] = [];

  let pricedCalls = 0;
  let unpricedCalls = 0;
  let unpricedTokens = 0;
  let totalUsd = 0;
  let order = 0;
  let spanStart = Number.POSITIVE_INFINITY;
  let spanEnd = Number.NEGATIVE_INFINITY;

  for (const record of list) {
    // 口径 2 的前半句：**枚举面是「全部 assistant 记录」**。这个过滤器写在
    // 读 `usage` 之前，所以口径 2 的两句话并不矛盾——它们说的是两件事：
    //   · 候选集 = 所有 assistant 调用（谁有资格成为一笔账单）；
    //   · 账单集 = 其中带 `usage` 的那些（谁能算出金额）。
    // 带 usage 的进收据与模型行；不带的（下面 `if (!usage)`）只进全局
    // unpricedCalls。缺 usage 不等于 0 美元，也不等于「没有这次调用」。
    //
    // 其余 kind 结构上就没有读数：解析器只在 assistant 分支挂 `usage`
    // （`parseJsonl.ts:514`），user / tool / wait / system 记录从来不会有，
    // 把它们算成「缺 usage」会把预期结构伪装成缺失数据
    // （`replayModel.ts:119-125` 用同一条口径）。
    if (!record || record.kind !== "assistant") continue;

    // 时间戳只用来排跨度与调用榜；非有限值（手工构造的夹具）按 0 处理，
    // 绝不把 NaN 带进比较，否则排序结果不确定。
    const timestamp = Number.isFinite(record.timestamp) ? record.timestamp : 0;

    const usage = record.usage;
    if (!usage) {
      // 口径 2 的后半句：有调用、无读数。这是「不知道花了多少」，不是
      // 「花了 0 元」：计入 unpricedCalls，但不产生任何 token 与金额（没有量
      // 可以记到科目上，也没有时间轴上的账单意义）。
      //
      // 注意全局 `unpricedCalls` 的语义是**两种原因合并的一个数**：「没有
      // 可用的 token 读数」+「定价未知的模型调用」。它既不是「缺 usage 的
      // 次数」单独一个，也不是「未知模型的次数」单独一个——界面只在收据脚注
      // 报这一个总数（「另有 N 次调用未计入」），逐模型的账在自己那行另报。
      unpricedCalls += 1;
      continue;
    }

    // 口径 9：跨度取带 usage 的调用的最早 / 最晚时间戳，与账单同一批记录
    // （也即口径 2 的「枚举面 = assistant 记录」）。若解析器将来给非
    // assistant 记录挂 `usage`，这里与口径 2 的过滤器要一起改，否则跨度会
    // 覆盖账单装不下的记录。
    if (timestamp < spanStart) spanStart = timestamp;
    if (timestamp > spanEnd) spanEnd = timestamp;

    const tokens = tokensOf(usage);

    // 口径 3：缺 model 视为未知模型（占位名可见、可计数，绝不静默丢弃）。
    const model = modelLabelOf(record.model);
    // `family` 是模型名的纯函数，所以同一次扫描里不需要第二遍归组。
    const family = pricingFamilyFor(model);

    let entry = models.get(model);
    if (!entry) {
      entry = {
        model,
        family,
        order: order++,
        calls: 0,
        tokens: emptyClasses(),
        usd: 0,
        pricedCalls: 0,
        unpricedCalls: 0
      };
      models.set(model, entry);
    }
    entry.calls += 1;
    for (const key of LEDGER_CLASS_ORDER) entry.tokens[key] += tokens[key];

    if (!family) {
      // 口径 3：定价未知 → 该调用金额是 null（不是 0），不进 totalUsd、不进
      // classes[].usd。它的 token 只进 models[].tokens 与 unpricedTokens，
      // 不进 classes[].tokens——否则收据会变成「有量、算不出钱」，
      // 读者按「量 × 单价」复算时对不上。
      entry.unpricedCalls += 1;
      unpricedCalls += 1;
      unpricedTokens +=
        tokens.input + tokens.output + tokens.cacheWrite + tokens.cacheRead;
      if (!unpricedSeen.has(model)) {
        unpricedSeen.add(model);
        unpricedModels.push(model);
      }
      continue;
    }

    entry.pricedCalls += 1;
    pricedCalls += 1;

    // 口径 1：单价只从 `classRate` 取（它读 `MODEL_PRICING`）。本模块不抄
    // 价目表——第二张表一定会和 `PRICING_AS_OF` 漂移，而漂移的价目表比没有
    // 价目表更危险。
    let usd = 0;
    for (const key of LEDGER_CLASS_ORDER) {
      classTokens[key] += tokens[key];
      const amount = (tokens[key] / TOKENS_PER_PRICE_UNIT) * classRate(family, key);
      classUsd[key] += amount;
      usd += amount;
    }
    entry.usd += usd;
    // 口径 4：合计与逐类小计**各累一遍**（这里按调用求和，下面按科目求和），
    // 两条独立的加法路径给出同一个数才算闭合；只把合计写成「四类相加」等于
    // 把结论定义成前提。
    totalUsd += usd;

    // 口径 7：只收可定价调用。`recordId` 用 `fullId`——全站「定位到某条记录」
    // 的钥匙都是它（`TimelineTrack.tsx:148`、`SessionAnalyzerPage.tsx:495-510`）。
    insertTopCall(topCalls, {
      recordId: record.fullId || record.id,
      timestamp,
      kind: record.kind,
      model,
      tokens,
      usd
    });
  }

  // 口径 4/8：一次都没能定价 → 合计是「不知道」，不是 0。
  const pricedUsd = pricedCalls === 0 ? null : totalUsd;

  // 口径 5：占比以 totalUsd 为分母；合计为 null 或 0 时四行全 0（不做 0/0）。
  const shareDenominator = pricedUsd !== null && pricedUsd > 0 ? pricedUsd : 0;
  const classes: LedgerClassLine[] = LEDGER_CLASS_ORDER.map((key) => ({
    key,
    tokens: classTokens[key],
    usd: classUsd[key],
    share: shareDenominator > 0 ? classUsd[key] / shareDenominator : 0
  }));

  // 口径 3 的后半句：可定价按金额降序、未知排最后。
  const sortedModels = [...models.values()].sort(compareModelAccumulators);
  const modelLines: LedgerModelLine[] = sortedModels.map((entry) => ({
    model: entry.model,
    family: entry.family,
    calls: entry.calls,
    tokens: entry.tokens,
    // 该模型一次可定价调用都没有 → 金额未知。`$0.00` 会抹掉真实支出。
    usd: entry.pricedCalls === 0 ? null : entry.usd,
    unpricedCalls: entry.unpricedCalls
  }));

  // 口径 6：逐模型算「这些缓存读取如果走 input 单价会多花多少」。只算可定价
  // 模型——未知模型没有单价，也就没有「本来要花多少」。这不是账单，是反事实
  // 估算，界面必须写明「按同一模型的输入单价估算」。
  //
  // 整个 cache 块**按可定价调用计算**（lead 裁决）：`readTokens` /
  // `inputTokens` 也取自已定价调用，命中率因此与收据逐位对得上。这条不是
  // 物理纯度问题而是记账自洽问题——这一页是一本计价账，同一张卡里混两个
  // 分母，读者按卡面数字复算必然对不上；未知模型的量与调用数已经在收据脚注
  // 和模型组里如实出现，不需要在这里再摊一遍。
  // 不变量（`costLedger.test.ts` 钉死）：
  //   cache.readTokens === classes[cacheRead].tokens
  //   cache.inputTokens === classes[input].tokens
  let savedUsd = 0;
  for (const entry of sortedModels) {
    if (!entry.family) continue;
    const inputRate = classRate(entry.family, "input");
    const readRate = classRate(entry.family, "cacheRead");
    savedUsd +=
      (entry.tokens.cacheRead / TOKENS_PER_PRICE_UNIT) * (inputRate - readRate);
  }

  const readTokens = classTokens.cacheRead;
  const inputTokens = classTokens.input;
  const cacheReadDenominator = readTokens + inputTokens;

  // 口径 8：没有任何带 usage 的记录 → 这里自然全是空态（四行 0、undefined
  // 的 span 落到 0、hitRate 为 null），不需要另走一条分支。
  // 口径 9：没有带 usage 记录时 span 是 {start: 0, end: 0}。
  const span =
    spanStart <= spanEnd ? { start: spanStart, end: spanEnd } : { start: 0, end: 0 };

  return {
    classes,
    models: modelLines,
    totalUsd: pricedUsd,
    pricedCalls,
    unpricedCalls,
    unpricedTokens,
    unpricedModels,
    cache: {
      readTokens,
      inputTokens,
      hitRate: cacheReadDenominator > 0 ? readTokens / cacheReadDenominator : null,
      savedUsd
    },
    topCalls,
    span,
    // 口径 10：定价快照日期原样透传，界面每一处金额旁边都要出现它。
    pricingAsOf: PRICING_AS_OF
  };
}
