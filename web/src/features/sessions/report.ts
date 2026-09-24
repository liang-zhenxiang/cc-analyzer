import type { Bridges } from "../../api/types";
import type { SessionRecord, ParsedSession } from "./types";
import type { ParsedSessionGraph } from "./types";
import type { RecordFilter, TimeRange } from "./filters";
import { computeDurationBreakdown } from "./duration";
import { durationBreakdownOptionsFromGraph } from "./sessionGraph";
import { tokensOf } from "./logRows";
import type { DurationNode } from "./durationTree";
import type { LogRow } from "./logRows";
import { probeClaudeCli } from "./cliProbe";
import { getThresholds } from "../settings/thresholds";
import {
  assemblePrompt,
  bucketSection,
  defaultWindow,
  errorSection,
  evidenceSection,
  fileMapSection,
  drilldownSection,
  distributionSection,
  mainFileSection,
  nodeSection,
  overviewSection,
  parallelismSection,
  outputFormatSection,
  qualitySection,
  roleSection,
  scopeSection,
  subagentFilesSection,
  sessionOptions,
  slowestToolsSection,
  subagentSection,
  truncateText,
  workflowSection,
  type PromptSection
} from "./reportPrompt";
import { formatDateTime, formatDuration } from "../../lib/format";

export type ReportMode = "whole" | "filtered" | "timeblock" | "node";

export type ReportInput = {
  session: ParsedSession;
  records: SessionRecord[];
  mode: ReportMode;
  filter: RecordFilter;
  timeRange?: TimeRange | null;
  graph?: ParsedSessionGraph;
  node?: DurationNode | null;
  /** Visible log rows, used for the filtered distribution table. */
  rows?: LogRow[];
};

export type ReportResult = {
  text: string;
  claudeId?: string;
  costUsd?: number;
  durationMs?: number;
};

function reportTable(records: SessionRecord[]): string[] {
  const limit = getThresholds().detailRows;
  const truncated = records.length > limit;
  const shown = truncated
    ? [...records].sort((a, b) => b.durationMs - a.durationMs).slice(0, limit)
    : records;
  const lines = [
    `## 记录表（共 ${records.length} 条${truncated ? `，按耗时降序取前 ${limit} 条；其余 ${records.length - limit} 条未列出` : "，全部列出"}）`,
    "| 记录ID | 时间 | 类型 | 摘要 | 耗时 | 输入tok | 输出tok | 状态 |",
    "|---|---|---|---|---|---|---|---|",
    ...shown.map(
      (record) => {
        const tokens = tokensOf(record);
        return `| ${record.fullId.slice(0, 12)} | ${formatDateTime(record.timestamp)} | ${record.toolName ?? record.kind} | ${truncateText(record.text, 200)
          .replace(/\|/g, "\\|")
          .replace(/\r?\n/g, " ")} | ${formatDuration(record.durationMs)} | ${tokens?.input ?? ""} | ${tokens?.output ?? ""} | ${record.isError ? "失败" : "正常"} |`;
      }
    )
  ];
  return lines;
}

export function buildWholeSessionReport(
  session: ParsedSession,
  graph?: ParsedSessionGraph
): string {
  const breakdown = computeDurationBreakdown(
    session.records,
    session.startedAt,
    session.endedAt,
    {
      isSubagent: session.isSubagent,
      turns: session.turns,
      ...(graph ? durationBreakdownOptionsFromGraph(graph) : {})
    }
  );
  return [
    `- 会话 ID: ${session.sessionId}`,
    `- 时间: ${formatDateTime(session.startedAt)} → ${formatDateTime(session.endedAt)}`,
    `- 总耗时: ${formatDuration(breakdown.total)}`,
    `- 等用户: ${formatDuration(breakdown.waitUser)}`,
    `- 直接工具: ${formatDuration(breakdown.direct)}`,
    `- 子 agent: ${formatDuration(breakdown.delegated)}`,
    `- workflow: ${formatDuration(breakdown.workflow)}`,
    `- 模型思考: ${formatDuration(breakdown.compute)}`,
    "",
    ...reportTable(session.records)
  ].join("\n");
}

export function buildFilteredReport(session: ParsedSession, records: SessionRecord[]): string {
  const breakdown = computeDurationBreakdown(records, session.startedAt, session.endedAt);
  return [
    `- 说明: 本报告只覆盖筛选后的 ${records.length} 条记录。`,
    `- 整会话总耗时: ${formatDuration(computeDurationBreakdown(session.records, session.startedAt, session.endedAt).total)}`,
    `- 筛选记录跨度: ${formatDuration(Math.max(0, (records.at(-1)?.timestamp ?? 0) - (records[0]?.timestamp ?? 0)))}`,
    `- 筛选记录耗时合计: ${formatDuration(breakdown.total)}`,
    "",
    ...reportTable(records)
  ].join("\n");
}

export function buildTimeBlockReport(
  session: ParsedSession,
  records: SessionRecord[],
  timeRange: TimeRange,
  graph?: ParsedSessionGraph
): string {
  const breakdown = computeDurationBreakdown(
    session.records,
    timeRange.start,
    timeRange.end,
    {
      isSubagent: session.isSubagent,
      turns: session.turns,
      ...(graph ? durationBreakdownOptionsFromGraph(graph) : {})
    }
  );
  return [
    `- 会话 ID: ${session.sessionId}`,
    `- 选区: ${formatDateTime(timeRange.start)} → ${formatDateTime(timeRange.end)}`,
    `- 选区总耗时: ${formatDuration(breakdown.total)}`,
    `- 等用户: ${formatDuration(breakdown.waitUser)}`,
    `- 本地工具: ${formatDuration(breakdown.localTool)}`,
    `- 模型思考: ${formatDuration(breakdown.compute)}`,
    "",
    ...reportTable(records)
  ].join("\n");
}

const MODE_TITLES: Record<ReportMode, string> = {
  whole: "整会话分析",
  filtered: "筛选后记录分析",
  timeblock: "时间块分析",
  node: "节点分析"
};

function detailSection(input: ReportInput): PromptSection {
  const { session, records, graph } = input;
  if (input.mode === "whole") {
    return {
      id: "detail",
      title: "记录明细",
      body: buildWholeSessionReport(session, graph),
      priority: 30
    };
  }
  if (input.mode === "filtered") {
    return {
      id: "detail",
      title: "记录明细",
      body: buildFilteredReport(session, records),
      priority: 30
    };
  }
  const range = input.timeRange ?? input.filter.timeRange ?? defaultWindow(session, null);
  return {
    id: "detail",
    title: "记录明细",
    body: buildTimeBlockReport(session, records, range, graph),
    priority: 30
  };
}

export function buildReport(input: ReportInput): string {
  const { session, records, graph } = input;
  const selection =
    input.mode === "timeblock" || input.mode === "node"
      ? input.timeRange ?? input.filter.timeRange
      : input.filter.timeRange;
  const window = defaultWindow(session, selection);
  const options = sessionOptions(session, graph);
  const breakdown = computeDurationBreakdown(session.records, window.start, window.end, options);

  const sections: PromptSection[] = [];
  if (input.mode === "node" && input.node) sections.push(nodeSection(input.node));
  sections.push(overviewSection(session, breakdown, graph));
  if (input.rows) sections.push(distributionSection(input.rows));
  sections.push(bucketSection(session, window, options));
  sections.push(slowestToolsSection(records));
  sections.push(errorSection(records));
  sections.push(subagentSection(graph));
  sections.push(workflowSection(graph));
  sections.push(parallelismSection(session, window, options));
  sections.push(fileMapSection(records));
  sections.push(evidenceSection(session, graph));
  sections.push(mainFileSection(session));
  sections.push(subagentFilesSection(graph));
  sections.push(drilldownSection(graph));
  sections.push(detailSection(input));

  return [
    `# 角色`,
    "",
    roleSection(input.mode).body,
    "",
    `# 口径（先看这条，再看数据）`,
    "",
    scopeSection(input.mode).body,
    "",
    `# 输出格式（严格遵守）`,
    "",
    outputFormatSection().body,
    "",
    `# 质量硬约束`,
    "",
    qualitySection().body,
    "",
    "# 待分析数据",
    "",
    `- 报告模式: ${MODE_TITLES[input.mode]}`,
    `- 统计窗口: ${formatDateTime(window.start)} → ${formatDateTime(window.end)}`,
    "",
    assemblePrompt(sections),
    ""
  ].join("\n");
}

export function reportSignature(
  session: ParsedSession,
  mode: ReportMode,
  filter: RecordFilter,
  graph?: ParsedSessionGraph | null
): string {
  return JSON.stringify({
    sessionId: session.sessionId,
    mode,
    search: filter.search,
    kinds: [...filter.kinds].sort(),
    statuses: [...filter.statuses].sort(),
    durationMode: filter.durationMode,
    min: filter.minDurationMs,
    max: filter.maxDurationMs,
    range: filter.timeRange,
    // 图解析完成后会替换 parsed，但 sessionId/过滤器不变；把图派生区间数纳入
    // 签名，才能让「图加载前生成的报告」被判定为过期。
    graphIntervals: graphIntervalRecordCount(graph)
  });
}

function graphIntervalRecordCount(graph?: ParsedSessionGraph | null): number {
  if (!graph) return 0;
  let count = 0;
  for (const session of graph.sessions) {
    for (const record of session.records) {
      if (record.childSession || record.workflowRun) count += 1;
    }
  }
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

type StreamLine =
  | { type: "session"; sessionId: string }
  | { type: "text"; text: string; fromDelta: boolean }
  | {
      type: "result";
      sessionId?: string;
      result?: string;
      isError: boolean;
      error?: string;
      subtype?: string;
      costUsd?: number;
      durationMs?: number;
    }
  | { type: "other" };

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block) || block.type !== "text") return "";
      return optionalString(block.text) ?? "";
    })
    .join("");
}

function parseStreamJsonLine(line: string): StreamLine {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { type: "other" };
  }
  if (!isRecord(value)) return { type: "other" };

  const sessionId = optionalString(value.session_id);
  if (value.type === "system" && sessionId) {
    return { type: "session", sessionId };
  }

  if (value.type === "stream_event" && isRecord(value.event)) {
    const event = value.event;
    if (event.type !== "content_block_delta" || !isRecord(event.delta)) {
      return { type: "other" };
    }
    const delta = event.delta;
    if (delta.type !== "text_delta") return { type: "other" };
    const text = optionalString(delta.text);
    return text ? { type: "text", text, fromDelta: true } : { type: "other" };
  }

  if (value.type === "assistant") {
    const message = isRecord(value.message) ? value.message : {};
    const text = textFromMessageContent(message.content);
    return text ? { type: "text", text, fromDelta: false } : { type: "other" };
  }

  if (value.type === "result") {
    const subtype = optionalString(value.subtype);
    return {
      type: "result",
      sessionId,
      result: optionalString(value.result),
      isError: value.is_error === true || subtype?.startsWith("error") === true,
      error: optionalString(value.error),
      subtype,
      costUsd: typeof value.total_cost_usd === "number" ? value.total_cost_usd : undefined,
      durationMs: typeof value.duration_ms === "number" ? value.duration_ms : undefined
    };
  }

  return { type: "other" };
}

export async function generateReport(
  input: ReportInput,
  bridges: Bridges,
  onLine: (line: string) => void,
  signal?: AbortSignal
): Promise<ReportResult> {
  if (signal?.aborted) throw new ReportCancelledError();
  const report = buildReport(input);
  const cli = await probeClaudeCli(bridges);
  if (cli.status === "missing") throw new Error(cli.message);
  const supportsStream = cli.hasStreamJson;
  const args = supportsStream
    ? ["-p", "--verbose", "--include-partial-messages", "--output-format", "stream-json"]
    : ["-p"];
  const plainLines: string[] = [];
  let streamedText = "";
  let assistantText = "";
  let receivedDelta = false;
  let resultText: string | undefined;
  let resultError: string | undefined;
  let claudeId: string | undefined;
  let costUsd: number | undefined;
  let durationMs: number | undefined;
  let streamId: string | null = null;
  const cancel = () => {
    if (streamId) void bridges.proc.cancelLines?.(streamId);
  };
  signal?.addEventListener("abort", cancel);

  try {
    const result = await bridges.proc.runLines(
      "claude",
      args,
      `以下是本地整理好的会话数据与统计口径，请据此生成中文分析报告。\n\n${report}`,
      10 * 60 * 1000,
      input.mode,
      (line) => {
      if (!supportsStream) {
        plainLines.push(line);
        onLine(line);
        return;
      }

      const parsed = parseStreamJsonLine(line);
      if (parsed.type === "session") {
        claudeId ??= parsed.sessionId;
        return;
      }

      if (parsed.type === "text") {
        if (parsed.fromDelta) {
          receivedDelta = true;
          streamedText += parsed.text;
        } else {
          if (receivedDelta) return;
          assistantText += parsed.text;
        }
        onLine(parsed.text);
        return;
      }

      if (parsed.type === "result") {
        if (parsed.sessionId) claudeId = parsed.sessionId;
        if (parsed.costUsd != null) costUsd = parsed.costUsd;
        if (parsed.durationMs != null) durationMs = parsed.durationMs;
        if (parsed.isError) {
          resultError = parsed.error ?? parsed.result ?? parsed.subtype ?? "未知错误";
          return;
        }
        resultText = parsed.result;
        if (parsed.result && !receivedDelta && !assistantText) onLine(parsed.result);
      }
      },
      (id) => {
        streamId = id;
        if (signal?.aborted) cancel();
      }
    );

    if (signal?.aborted) throw new ReportCancelledError();
    if (resultError) throw new Error(`Claude 分析失败: ${resultError}`);
    if (!result.ok && result.error) {
      if (result.error === "分析已取消") throw new ReportCancelledError();
      if (result.error.includes("启动命令失败")) {
        throw new Error(`${result.error}（请确认 claude CLI 已安装且在 PATH 中）`);
      }
      throw new Error(result.error);
    }
    const text = supportsStream
      ? resultText ?? (receivedDelta ? streamedText : assistantText)
      : plainLines.join("\n");
    return { text, claudeId, costUsd, durationMs };
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export class ReportCancelledError extends Error {
  constructor() {
    super("分析已取消");
    this.name = "ReportCancelledError";
  }
}
