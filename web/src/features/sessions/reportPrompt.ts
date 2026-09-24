import type { ParsedSession, ParsedSessionGraph, SessionRecord } from "./types";
import type { LogRow } from "./logRows";
import type { DurationBreakdown, DurationBreakdownOptions } from "./duration";
import { computeDurationIntervals, unionIntervals } from "./duration";
import { durationBreakdownOptionsFromGraph } from "./sessionGraph";
import type { DurationNode } from "./durationTree";
import { durationWindow } from "./durationTree";
import type { TimeRange } from "./filters";
import { formatDateTime, formatDuration } from "../../lib/format";
import { safeStringify } from "../../lib/json";
import { getThresholds } from "../settings/thresholds";

export const TOOL_OUTPUT_LIMIT = 5 * 1024;
export const FILE_MAP_LIMIT = 20;
export const BUCKET_COUNT = 12;
export const DRILLDOWN_LIMIT = 5;

export type PromptSection = {
  id: string;
  title: string;
  body: string;
  /** Higher survives truncation longer. */
  priority: number;
};

export function sessionOptions(
  session: ParsedSession,
  graph?: ParsedSessionGraph
): DurationBreakdownOptions {
  return {
    isSubagent: session.isSubagent,
    turns: session.turns,
    ...(graph ? durationBreakdownOptionsFromGraph(graph) : {})
  };
}

export function truncateText(text: string, limit = TOOL_OUTPUT_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…（已截断，原始 ${text.length} 字符）`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function tokenTotal(record: SessionRecord): number {
  const usage = record.usage;
  if (!usage) return 0;
  return (
    (usage.inputTokens ?? 0) +
    (usage.outputTokens ?? 0) +
    (usage.cacheCreationTokens ?? 0) +
    (usage.cacheReadTokens ?? 0)
  );
}

export function summarizeSession(session: ParsedSession, graph?: ParsedSessionGraph) {
  const toolRecords = session.records.filter((record) => record.kind === "tool");
  const subagents = (graph?.sessions ?? []).filter(
    (item) => item.isSubagent && item.path !== session.path
  );
  return {
    turns: session.turns.length,
    records: session.records.length,
    tools: toolRecords.length,
    errors: session.records.filter((record) => record.isError).length,
    tokens: session.records.reduce((total, record) => total + tokenTotal(record), 0),
    subagents: subagents.length,
    workflows: Object.keys(graph?.workflowRuns ?? {}).length
  };
}

export function overviewSection(
  session: ParsedSession,
  breakdown: DurationBreakdown,
  graph?: ParsedSessionGraph
): PromptSection {
  const summary = summarizeSession(session, graph);
  return {
    id: "overview",
    title: "总览",
    priority: 100,
    body: [
      `- 会话 ID: ${session.sessionId}`,
      `- 会话文件: ${session.path}`,
      session.cwd ? `- 工作目录: ${session.cwd}` : "",
      `- 时间窗: ${formatDateTime(session.startedAt)} → ${formatDateTime(session.endedAt)}`,
      `- 总耗时: ${formatDuration(breakdown.total)}`,
      "",
      "| 分类 | 耗时 | 占比 |",
      "|---|---|---|",
      `| 等用户 | ${formatDuration(breakdown.waitUser)} | ${share(breakdown.waitUser, breakdown.total)} |`,
      `| 本地工具（去重） | ${formatDuration(breakdown.localTool)} | ${share(breakdown.localTool, breakdown.total)} |`,
      `| 直接工具 | ${formatDuration(breakdown.direct)} | ${share(breakdown.direct, breakdown.total)} |`,
      `| 子 agent | ${formatDuration(breakdown.delegated)} | ${share(breakdown.delegated, breakdown.total)} |`,
      `| workflow | ${formatDuration(breakdown.workflow)} | ${share(breakdown.workflow, breakdown.total)} |`,
      `| 模型思考 | ${formatDuration(breakdown.compute)} | ${share(breakdown.compute, breakdown.total)} |`,
      "",
      `- 轮次: ${summary.turns}`,
      `- 记录数: ${summary.records}`,
      `- 工具调用: ${summary.tools}`,
      `- 子 agent: ${summary.subagents}`,
      `- workflow: ${summary.workflows}`,
      `- token 合计: ${summary.tokens}`,
      `- 失败记录: ${summary.errors}`
    ].filter(Boolean).join("\n")
  };
}

function share(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

export function bucketSection(
  session: ParsedSession,
  window: TimeRange,
  options: DurationBreakdownOptions,
  count = BUCKET_COUNT
): PromptSection {
  const span = Math.max(1, window.end - window.start);
  const rows: string[] = ["| 区间 | 本地工具 | 等用户 | 模型 |", "|---|---|---|---|"];
  for (let index = 0; index < count; index += 1) {
    const start = window.start + (span * index) / count;
    const end = window.start + (span * (index + 1)) / count;
    const intervals = computeDurationIntervals(session.records, start, end, options);
    rows.push(
      `| ${formatDateTime(start)} | ${formatDuration(unionIntervals(intervals.localTool))} | ${formatDuration(unionIntervals(intervals.waitUser))} | ${formatDuration(unionIntervals(intervals.compute))} |`
    );
  }
  return { id: "buckets", title: "时序分桶", body: rows.join("\n"), priority: 55 };
}

export function slowestToolsSection(records: SessionRecord[]): PromptSection {
  const tools = records
    .filter((record) => record.kind === "tool")
    .sort((a, b) => b.durationMs - a.durationMs);
  const limit = getThresholds().slowTools;
  const shown = tools.slice(0, limit);
  const rest = tools.slice(limit);
  const restMs = rest.reduce((total, record) => total + record.durationMs, 0);
  const body = [
    "| 工具 | 摘要 | 耗时 | 状态 |",
    "|---|---|---|---|",
    ...shown.map(
      (record) =>
        `| ${record.toolName ?? record.kind} | ${escapeCell(record.text || record.fullId)} | ${formatDuration(record.durationMs)} | ${record.isError ? "失败" : "正常"} |`
    )
  ];
  if (rest.length > 0) {
    body.push("", `其余 ${rest.length} 个工具聚合耗时 ${formatDuration(restMs)}。`);
  }
  return { id: "slowest", title: "最慢工具", body: body.join("\n"), priority: 85 };
}

export function errorSection(records: SessionRecord[]): PromptSection {
  const failed = records.filter((record) => record.isError);
  const body =
    failed.length === 0
      ? "没有失败记录。"
      : [
          "| 时间 | 类型 | 摘要 |",
          "|---|---|---|",
          ...failed.map(
            (record) =>
              `| ${formatDateTime(record.timestamp)} | ${record.toolName ?? record.kind} | ${escapeCell(record.text || record.fullId)} |`
          )
        ].join("\n");
  return { id: "errors", title: "错误汇总", body, priority: 80 };
}

export function subagentSection(graph?: ParsedSessionGraph): PromptSection {
  const sessions = (graph?.sessions ?? []).filter((item) => item.isSubagent);
  if (sessions.length === 0) {
    return { id: "subagents", title: "子 agent 全量表", body: "没有子 agent。", priority: 70 };
  }
  const limit = getThresholds().subagents;
  const shown = sessions.slice(0, limit);
  const rest = sessions.slice(limit);
  const body = [
    "| 子会话 | 起止 | 时长 | 记录数 | 工具数 |",
    "|---|---|---|---|---|",
    ...shown.map((item) => {
      const duration = Math.max(0, item.endedAt - item.startedAt);
      const tools = item.records.filter((record) => record.kind === "tool").length;
      return `| ${item.sessionId} | ${formatDateTime(item.startedAt)} → ${formatDateTime(item.endedAt)} | ${formatDuration(duration)} | ${item.records.length} | ${tools} |`;
    })
  ];
  if (rest.length > 0) body.push("", `其余 ${rest.length} 个子 agent 已省略。`);
  return { id: "subagents", title: "子 agent 全量表", body: body.join("\n"), priority: 70 };
}

export function workflowSection(graph?: ParsedSessionGraph): PromptSection {
  const runs = Object.values(graph?.workflowRuns ?? {});
  if (runs.length === 0) {
    return { id: "workflows", title: "workflow 全量表", body: "没有 workflow。", priority: 65 };
  }
  const body = [
    "| runId | 名称 | 状态 | 运行时长 | 子 agent | token | 阶段 |",
    "|---|---|---|---|---|---|---|",
    ...runs.map(
      (run) =>
        `| ${run.runId} | ${escapeCell(run.workflowName || "—")} | ${run.status || "未知"} | ${formatDuration(run.durationMs)} | ${run.agentCount} | ${run.totalTokens ?? "—"} | ${escapeCell(run.phases.join(" → ") || "—")} |`
    )
  ];
  return { id: "workflows", title: "workflow 全量表", body: body.join("\n"), priority: 65 };
}

export function parallelismSection(
  session: ParsedSession,
  window: TimeRange,
  options: DurationBreakdownOptions
): PromptSection {
  const intervals = computeDurationIntervals(session.records, window.start, window.end, options);
  const tools = [...intervals.direct, ...intervals.delegated, ...intervals.workflow].sort(
    (a, b) => a.start - b.start
  );
  let maxConcurrent = 0;
  const groups: TimeRange[] = [];
  let active: TimeRange[] = [];
  for (const interval of tools) {
    active = active.filter((item) => item.end > interval.start);
    active.push(interval);
    maxConcurrent = Math.max(maxConcurrent, active.length);
    if (active.length > 1) {
      const start = Math.min(...active.map((item) => item.start));
      const end = Math.max(...active.map((item) => item.end));
      const last = groups.at(-1);
      if (last && start <= last.end) last.end = Math.max(last.end, end);
      else groups.push({ start, end });
    }
  }
  const body = [
    `- 最大并行度: ${maxConcurrent}`,
    `- 并行区间数: ${groups.length}`,
    ...groups
      .slice(0, 10)
      .map((group) => `- ${formatDateTime(group.start)} → ${formatDateTime(group.end)}（${formatDuration(group.end - group.start)}）`)
  ];
  return { id: "parallel", title: "并行度", body: body.join("\n"), priority: 60 };
}

export function fileMapSection(records: SessionRecord[]): PromptSection {
  const files = new Map<string, { count: number; durationMs: number; tools: Set<string> }>();
  const touch = (path: string, record: SessionRecord) => {
    const entry = files.get(path) ?? { count: 0, durationMs: 0, tools: new Set<string>() };
    entry.count += 1;
    entry.durationMs += record.durationMs;
    entry.tools.add(record.toolName ?? record.kind);
    files.set(path, entry);
  };
  for (const record of records) {
    const structured = record.structuredResult;
    if (structured && "filePath" in structured && structured.filePath) {
      touch(structured.filePath, record);
      continue;
    }
    const input = record.toolInput;
    if (input && typeof input === "object") {
      const value = input as Record<string, unknown>;
      const candidate = value.file_path ?? value.path ?? value.notebook_path;
      if (typeof candidate === "string" && candidate.length > 0) touch(candidate, record);
    }
  }
  const ordered = [...files.entries()].sort(
    (a, b) => b[1].durationMs - a[1].durationMs || b[1].count - a[1].count
  );
  if (ordered.length === 0) {
    return { id: "files", title: "文件地图", body: "没有可识别的文件操作。", priority: 45 };
  }
  const body = [
    "| 文件 | 次数 | 累计耗时 | 工具 |",
    "|---|---|---|---|",
    ...ordered
      .slice(0, FILE_MAP_LIMIT)
      .map(
        ([path, entry]) =>
          `| ${escapeCell(path)} | ${entry.count} | ${formatDuration(entry.durationMs)} | ${[...entry.tools].join("、")} |`
      )
  ];
  if (ordered.length > FILE_MAP_LIMIT) {
    body.push("", `其余 ${ordered.length - FILE_MAP_LIMIT} 个文件已省略。`);
  }
  return { id: "files", title: "文件地图", body: body.join("\n"), priority: 45 };
}

export function evidenceSection(
  session: ParsedSession,
  graph?: ParsedSessionGraph
): PromptSection {
  const body = [
    `- 主会话文件: ${session.path}`,
    `- 子会话目录: ${session.path.replace(/[\\/][^\\/]+$/, "")}/subagents`,
    `- 会话图: ${(graph?.sessions.length ?? 1)} 个会话，${graph?.warnings.length ?? 0} 条警告`,
    "- 需要复核耗时口径时，优先对照「时序分桶」与「最慢工具」两张表。",
    "- 结论请引用具体记录 ID 或子会话 ID，便于回溯原始 JSONL。"
  ];
  if (graph?.warnings.length) {
    body.push("", "解析警告：", ...graph.warnings.map((warning) => `- ${warning}`));
  }
  return { id: "evidence", title: "取证指引", body: body.join("\n"), priority: 40 };
}

const MODE_ROLE: Record<string, { role: string; scope: string }> = {
  whole: {
    role: "本次输入是**整场会话**的耗时分解、时序分桶与记录明细。",
    scope: "整会话"
  },
  timeblock: {
    role: "本次输入是**时间轨道上选出的一段区间**，只需要分析这一段里发生了什么。",
    scope: "时间选区"
  },
  node: {
    role: "本次输入是**树视图里选中的一个节点**（一次委派子 agent 或一次 workflow），只需要分析这个节点。",
    scope: "该节点"
  },
  filtered: {
    role: "本次输入是**用户在日志视图里筛出来的一张记录表**，用户关心的是这筛出来的这一批，不是整个会话。",
    scope: "筛选后"
  }
};

export function roleSection(mode: string): PromptSection {
  const { role } = MODE_ROLE[mode] ?? MODE_ROLE.filtered;
  return {
    id: "role",
    title: "角色",
    priority: 100,
    body: [
      `你是 Claude Code 会话记录分析专家。${role}`,
      "",
      "数据由本地引擎按区间补集算好并对过账，你的任务是解释与建议，不是重新统计。"
    ].join("\n")
  };
}

export function scopeSection(mode: string): PromptSection {
  const { scope } = MODE_ROLE[mode] ?? MODE_ROLE.filtered;
  return {
    id: "scope",
    title: "口径（先看这条，再看数据）",
    priority: 95,
    body: [
      `- 「记录明细」的条数与耗时合计 = **${scope}** 的口径。`,
      "- 「总览」的耗时分解 = 统计窗口内的口径；两个数不许混着说，引用时写明是哪一个。",
      "- 表中所有数字都是引擎算好并对过账的，**禁止自行从时间戳重算**耗时或占比。",
      "- 逐条记录的耗时**可以重叠**（并行子 agent / 后台 workflow），表内耗时求和不等于任何总数，不要拿它去和耗时分解对账。"
    ].join("\n")
  };
}

export function outputFormatSection(): PromptSection {
  return {
    id: "format",
    title: "输出格式（严格遵守）",
    priority: 90,
    body: [
      "### 概览",
      "这批数据是什么（多少条、覆盖哪段时间、哪几类）、合计耗时，一行说清。若筛的是错误记录，点明错误条数与类型分布。",
      "",
      "### 关键发现",
      "3–6 条，每条一行：**是什么 + 数字**。优先挑最慢的、失败的、重复出现的同一操作、耗时明显不成比例的小事；直接引用表中的耗时与状态，不要复述整行。",
      "",
      "### 慢因分析",
      "主因 + 次因，各一两句：说清是什么、为什么慢、影响多大（占比或时长即可）。看不出慢因就直说「未发现异常」，不要为凑字数硬找。",
      "",
      "### 优化建议",
      "针对已识别的具体问题给可操作改进点；没有问题就留空，不要写通用建议。",
      "",
      "### 取证",
      "需要看某一行完整入参/输出时，按「文件地图」Read 原始 transcript，用记录 ID（或 toolUseId 前缀）grep 定位，只读必要片段。"
    ].join("\n")
  };
}

export function qualitySection(): PromptSection {
  return {
    id: "quality",
    title: "质量硬约束",
    priority: 88,
    body: [
      "1. 数字直接引用所给数据；不同口径必须分别标注。",
      `2. 「记录明细」若标注了截断（如「按耗时降序取前 ${getThresholds().detailRows} 条」），概览里必须跟着说明你只看到最慢的那部分 —— 把没看到的数据当成看过是硬错误。`,
      "3. 记录为空时只说明筛选条件没匹配到任何记录，不要编造分析。",
      "4. 并行子 agent / 后台 workflow 的耗时会重叠，不要用逐条耗时求和去对账总量。",
      "5. 全文 markdown、中文、600 字内（表格不计入）。",
      "6. 不罗列全部记录 —— 只有进入「关键发现」的那些才值得展开。"
    ].join("\n")
  };
}

export function mainFileSection(session: ParsedSession): PromptSection {
  const root = session.path.replace(/[\\/][^\\/]+$/, "");
  return {
    id: "main-file",
    title: "文件地图 · 主文件",
    priority: 50,
    body: [
      `projectsRoot = ${root}`,
      "",
      `- ${session.path.replace(/^.*[\\/]/, "")}  （完整路径：${session.path}）`
    ].join("\n")
  };
}

export function subagentFilesSection(graph?: ParsedSessionGraph): PromptSection {
  const sessions = (graph?.sessions ?? []).filter((item) => item.isSubagent);
  if (sessions.length === 0) {
    return { id: "subagent-files", title: "文件地图 · 子 agent 文件", body: "没有子 agent 文件。", priority: 48 };
  }
  const ordered = [...sessions].sort(
    (a, b) => b.endedAt - b.startedAt - (a.endedAt - a.startedAt)
  );
  return {
    id: "subagent-files",
    title: "文件地图 · 子 agent 文件（按耗时降序，全量）",
    priority: 48,
    body: ordered
      .map((item) => {
        const duration = Math.max(0, item.endedAt - item.startedAt);
        return `- ${item.sessionId} ${formatDuration(duration)} → ${item.path}`;
      })
      .join("\n")
  };
}

export function drilldownSection(graph?: ParsedSessionGraph): PromptSection {
  const sessions = (graph?.sessions ?? []).filter((item) => item.isSubagent);
  if (sessions.length === 0) {
    return { id: "drilldown", title: "深挖线索", body: "没有可深挖的子 agent。", priority: 46 };
  }
  const ordered = [...sessions]
    .sort((a, b) => b.endedAt - b.startedAt - (a.endedAt - a.startedAt))
    .slice(0, DRILLDOWN_LIMIT);

  const lines = ordered.flatMap((item) => {
    const slowest = [...item.records]
      .filter((record) => record.kind === "tool")
      .sort((a, b) => b.durationMs - a.durationMs)[0];
    const files = new Map<string, number>();
    for (const record of item.records) {
      const path = recordFilePath(record);
      if (path) files.set(path, (files.get(path) ?? 0) + 1);
    }
    const repeated = [...files.entries()].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1])[0];
    return [
      `- ${item.sessionId} → ${item.path}`,
      slowest
        ? `    子内最慢: ${slowest.toolName ?? slowest.kind} ${formatDuration(slowest.durationMs)}`
        : "",
      repeated ? `    子内重复: ${repeated[0]} ×${repeated[1]}` : ""
    ].filter(Boolean);
  });

  return {
    id: "drilldown",
    title: `深挖线索（top ${DRILLDOWN_LIMIT} 慢子 agent）`,
    priority: 46,
    body: lines.join("\n")
  };
}

function recordFilePath(record: SessionRecord): string | undefined {
  const structured = record.structuredResult;
  if (structured && "filePath" in structured && structured.filePath) return structured.filePath;
  const input = record.toolInput;
  if (input && typeof input === "object") {
    const value = input as Record<string, unknown>;
    const candidate = value.file_path ?? value.path;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

/** Row-type distribution for the current filter, mirroring 筛选后分布. */
export function distributionSection(rows: LogRow[]): PromptSection {
  if (rows.length === 0) {
    return { id: "distribution", title: "筛选后分布", body: "当前筛选没有匹配到记录。", priority: 92 };
  }
  const byLabel = new Map<string, { count: number; durationMs: number }>();
  for (const row of rows) {
    const entry = byLabel.get(row.label) ?? { count: 0, durationMs: 0 };
    entry.count += 1;
    entry.durationMs += row.durationMs;
    byLabel.set(row.label, entry);
  }
  const ordered = [...byLabel.entries()].sort((a, b) => b[1].durationMs - a[1].durationMs);
  return {
    id: "distribution",
    title: "筛选后分布",
    priority: 92,
    body: [
      `共 ${rows.length} 条（按耗时合计降序）`,
      "",
      "| 类型 | 条数 | 耗时合计 |",
      "|---|---|---|",
      ...ordered.map(
        ([label, entry]) => `| ${label} | ${entry.count} | ${formatDuration(entry.durationMs)} |`
      )
    ].join("\n")
  };
}

export function nodeSection(node: DurationNode): PromptSection {
  const intervals = node.segments ?? [];
  const body = [
    `- 节点: ${node.label}`,
    `- 类型: ${node.kind}`,
    `- 耗时: ${formatDuration(node.durationMs)}`,
    `- 占会话: ${node.wallMs > 0 ? `${Math.round((node.durationMs / node.wallMs) * 100)}%` : "0%"}`,
    node.count == null ? "" : `- 调用数: ${node.count}`,
    node.record ? `- 记录 ID: ${node.record.fullId}` : "",
    node.record?.toolName ? `- 工具: ${node.record.toolName}` : "",
    node.childSession ? `- 子会话: ${node.childSession.sessionId}` : "",
    node.record?.workflowRun
      ? `- workflow: ${node.record.workflowRun.workflowName || node.record.workflowRun.runId}`
      : "",
    intervals.length > 0
      ? `- 区间: ${intervals.map((item) => `${formatDateTime(item.start)} → ${formatDateTime(item.end)}`).join("；")}`
      : ""
  ].filter(Boolean);
  if (node.record?.toolInput != null) {
    body.push("", "工具输入：", "```json", truncateText(safeStringify(node.record.toolInput, 2)), "```");
  }
  if (node.record?.toolResult) {
    body.push("", "工具输出：", "```", truncateText(node.record.toolResult), "```");
  }
  return { id: "node", title: "节点详情", body: body.join("\n"), priority: 100 };
}

export function assemblePrompt(
  sections: PromptSection[],
  limit = getThresholds().promptBytes
): string {
  const ordered = [...sections].sort((a, b) => b.priority - a.priority);
  const kept = new Set<string>();
  let used = 0;
  for (const section of ordered) {
    const size = section.title.length + section.body.length + 8;
    if (used + size > limit) continue;
    kept.add(section.id);
    used += size;
  }
  const dropped = sections.filter((section) => !kept.has(section.id));
  const parts: string[] = [];
  let index = 0;
  for (const section of sections) {
    if (!kept.has(section.id)) continue;
    index += 1;
    parts.push(`## ${index}. ${section.title}`, "", section.body, "");
  }
  if (dropped.length > 0) {
    parts.push(
      "## 截断说明",
      "",
      `报告超过 ${Math.round(limit / 1024)} KB 上限，已省略：${dropped.map((section) => section.title).join("、")}。`
    );
  }
  return parts.join("\n").trimEnd();
}

export function defaultWindow(
  session: ParsedSession,
  selection: TimeRange | null
): TimeRange {
  return durationWindow(session, selection);
}
