import type { SessionRecord, ParsedSession } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 跨会话工具普查（N3，design.md §1）。四桶分口径 + 两个计数口径并列：
 * 实测 41.3% 的 tool_use 在内联 sidechain 行（只算主链会低估近一半），所以
 * `callsMain`（主链）与 `callsWithSidechain`（含子 agent）都必须进契约。
 *
 * 提取（extractToolCalls）与聚合（toolCensus）分开，与压缩统计 / 错误聚合
 * （compactionStats / errorStats）同一模式：提取随渐进扫描逐会话跑一次，
 * 聚合随区间控件反复跑。
 *
 * 跨文件口径（研究报告缺口 4，本机实测独立子会话文件为 0）：内联 sidechain
 * 并入所在会话；独立子会话文件（childSessionPath 链接形态）按普通会话各算
 * 一次——两种形态不在同一份数据里共存，无重叠。
 */

/** 分桶标识：先命中先归（研究报告 §2 的可编码规则，逐字实现）。 */
export type ToolBucketKey =
  | { kind: "builtin"; toolName: string }
  | { kind: "skill"; skillName: string }
  | { kind: "mcp"; server: string; toolName: string }
  | { kind: "subagent"; subagentType: string };

/** 字段缺省时的兜底名（与 subagentType 的 "(unknown)" 同一约定）。 */
const UNKNOWN_LABEL = "(unknown)";

/**
 * 一次 tool_use 的分桶判定。判定顺序**先命中先归**（与研究报告 §2 逐字一致）：
 * mcp__ 前缀 → Agent/Task → Skill → 内置。`input` 是 `unknown`（磁盘边界），
 * 安全取值：对象且字段为 string 才认，任何形态都不 throw。
 */
export function classifyToolUse(name: string, input: unknown): ToolBucketKey {
  // 实测 mcp__<server>__<tool> 的 split("__") 恒 3 段（server 可含单下划线）；
  // 段数 <3 的畸形名整个名字当工具名，server ��仅有的一段（缺则兜底）。
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    const server = parts[1] && parts[1].length > 0 ? parts[1] : UNKNOWN_LABEL;
    const toolName = parts.length >= 3 ? parts.slice(2).join("__") : name;
    return { kind: "mcp", server, toolName };
  }
  // Task 是旧名/别名（本机 0 次）；parseJsonl 的 toolCategory 同款两认。
  if (name === "Agent" || name === "Task") {
    return { kind: "subagent", subagentType: stringField(input, "subagent_type") ?? UNKNOWN_LABEL };
  }
  if (name === "Skill") {
    return { kind: "skill", skillName: stringField(input, "skill") ?? UNKNOWN_LABEL };
  }
  return { kind: "builtin", toolName: name };
}

function stringField(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** 一条工具调用事实：readSession 一趟产出，之后只与窗口聚合打交道。 */
export type ToolCallFact = {
  key: ToolBucketKey;
  timestamp: number;
  /** 内联 sidechain 行分流出来的调用（主链记录恒 false）。 */
  sidechain: boolean;
  /**
   * 子 agent 派发调用（Agent/Task）结构化回报的 totalToolUseCount——挂在
   * 对应的事实上随聚合下传，供 `agentReportedTotal` 对账（研究报告建议的
   * 交叉验证：它应与 sidechain 事实数对得上）。缺省 = 无结构化回报。
   */
  agentToolUseCount?: number;
};

/**
 * 从一个已解析会话提取工具调用事实（含 sidechainMessages——只吃 records 会
 * 静默丢四成调用）。未配对的 tool_use 也算：调用确实发起过，与错误聚合的
 * 分母口径一致。
 */
export function extractToolCalls(parsed: ParsedSession): ToolCallFact[] {
  const facts: ToolCallFact[] = [];
  const consume = (record: SessionRecord) => {
    if (record.kind !== "tool" || !record.toolName) return;
    const fact: ToolCallFact = {
      key: classifyToolUse(record.toolName, record.toolInput),
      timestamp: record.timestamp,
      sidechain: record.isSidechain === true
    };
    const structured = record.structuredResult;
    if (structured && structured.toolName === "Agent" && structured.totalToolUseCount != null) {
      fact.agentToolUseCount = structured.totalToolUseCount;
    }
    facts.push(fact);
  };
  for (const record of parsed.records) consume(record);
  for (const record of parsed.sidechainMessages) consume(record);
  return facts;
}

/** 下钻切片：一个会话对该桶的贡献。 */
export type CensusSessionSlice = {
  /** 扫描的 SessionMeta（下钻行重开会话用）；手造测试输入时为 null。 */
  session: SessionMeta | null;
  /** 展示名（sessionTitle 解析后的同款名字，与压缩面板的 topSessions 同源）。 */
  label: string;
  calls: number;
};

/** 一个桶的统计（两个口径并列——只算主链会严重低估）。 */
export type CensusBucket = {
  key: ToolBucketKey;
  /** 展示名（skill 名 / MCP server / 工具名 / subagent 类型）。 */
  label: string;
  callsMain: number;
  callsWithSidechain: number;
  /** 涉及会话数（含子链口径）。 */
  sessions: number;
  /** 下钻 Top-5 会话（按该桶调用数降序）——聚合口径落聚合层被单测锁住。 */
  topSessions: CensusSessionSlice[];
  /** MCP 桶按 server 聚合后的行内工具明细（按次数降序）；非 MCP 桶为空。 */
  tools: { toolName: string; calls: number }[];
};

export type ToolCensus = {
  /** 全部桶混排（按 callsWithSidechain 降序，同数按 label 稳定排序）；视图按 kind 分栏。 */
  buckets: CensusBucket[];
  totalCalls: { main: number; withSidechain: number };
  /** Agent 结构化回报的 totalToolUseCount 合计（抽样对账：应与 sidechain 事实数同量级）。 */
  agentReportedTotal: number;
};

/** 桶的稳定身份（选中态比较与 Map 键）。 */
export function censusKeyId(key: ToolBucketKey): string {
  switch (key.kind) {
    case "builtin":
      return `builtin:${key.toolName}`;
    case "skill":
      return `skill:${key.skillName}`;
    case "subagent":
      return `subagent:${key.subagentType}`;
    case "mcp":
      // MCP 按 server 聚合（裁决 ② 方案 A），桶级身份就是 server。
      return `mcp:${key.server}`;
  }
}

type BucketAcc = {
  key: ToolBucketKey;
  label: string;
  callsMain: number;
  callsWithSidechain: number;
  /** 会话路径 → 该会话贡献（含 meta 与展示名，最后截 Top-5）。 */
  sessionAcc: Map<string, CensusSessionSlice>;
  /** MCP 桶的 server 内工具明细（按含子链口径计数）。 */
  tools: Map<string, number>;
};

function labelOf(key: ToolBucketKey): string {
  switch (key.kind) {
    case "builtin":
      return key.toolName;
    case "skill":
      return key.skillName;
    case "subagent":
      return key.subagentType;
    case "mcp":
      return key.server;
  }
}

/**
 * 窗口化聚合（与 aggregateRange / compactionStats 同一口径的本地日时间窗）：
 * 只吃 `toolCalls` 事实，没有该字段的输入（手造测试数据）���普查不可见。
 */
export function toolCensus(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number = Date.now()
): ToolCensus {
  const windowDays = Math.max(1, Math.floor(days));
  const startTs = addLocalDays(dayStartOf(now), -(windowDays - 1));

  const buckets = new Map<string, BucketAcc>();
  let totalMain = 0;
  let totalWithSidechain = 0;
  let agentReportedTotal = 0;

  inputs.forEach((input, index) => {
    const facts = input.toolCalls;
    if (!facts) return;

    // 会话条目的稳定键：meta 的 path 优先；手造输入（无 meta）退回输入下标，
    // 同项目的两个手造会话才不会并成一条切片。
    const sessionKey = input.session?.path ?? `input-${index}`;
    const sliceBase = {
      session: input.session ?? null,
      label: input.session ? sessionTitle(input.session) : input.projectLabel
    };
    // 该会话对各桶的贡献（含子链口径），一个桶一条切片。
    const perBucket = new Map<string, number>();

    for (const fact of facts) {
      if (fact.timestamp < startTs) continue;
      const id = censusKeyId(fact.key);
      let bucket = buckets.get(id);
      if (!bucket) {
        // MCP 桶按 server 聚合：桶 key 的 toolName 不再承载身份（明细进 tools）。
        const key: ToolBucketKey =
          fact.key.kind === "mcp" ? { kind: "mcp", server: fact.key.server, toolName: "" } : fact.key;
        bucket = { key, label: labelOf(key), callsMain: 0, callsWithSidechain: 0, sessionAcc: new Map(), tools: new Map() };
        buckets.set(id, bucket);
      }
      bucket.callsWithSidechain += 1;
      if (!fact.sidechain) bucket.callsMain += 1;
      if (fact.key.kind === "mcp") {
        bucket.tools.set(fact.key.toolName, (bucket.tools.get(fact.key.toolName) ?? 0) + 1);
      }
      if (fact.agentToolUseCount != null) agentReportedTotal += fact.agentToolUseCount;
      perBucket.set(id, (perBucket.get(id) ?? 0) + 1);
      totalWithSidechain += 1;
      if (!fact.sidechain) totalMain += 1;
    }

    for (const [id, calls] of perBucket) {
      buckets.get(id)?.sessionAcc.set(sessionKey, { ...sliceBase, calls });
    }
  });

  const result: CensusBucket[] = [...buckets.values()].map((acc) => ({
    key: acc.key,
    label: acc.label,
    callsMain: acc.callsMain,
    callsWithSidechain: acc.callsWithSidechain,
    sessions: acc.sessionAcc.size,
    topSessions: [...acc.sessionAcc.values()]
      .sort((a, b) => b.calls - a.calls || a.label.localeCompare(b.label))
      .slice(0, 5),
    tools: [...acc.tools]
      .map(([toolName, calls]) => ({ toolName, calls }))
      .sort((a, b) => b.calls - a.calls || a.toolName.localeCompare(b.toolName))
  }));

  result.sort((a, b) => b.callsWithSidechain - a.callsWithSidechain || a.label.localeCompare(b.label));

  return {
    buckets: result,
    totalCalls: { main: totalMain, withSidechain: totalWithSidechain },
    agentReportedTotal
  };
}
