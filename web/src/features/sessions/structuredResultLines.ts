import type { SessionRecord } from "./types";
import { formatDuration } from "../../lib/format";
import { safeStringify } from "../../lib/json";

export function formatInputValue(value: unknown): string {
  if (value == null) return "（无输入）";
  if (typeof value === "string") return value;
  return safeStringify(value, 2);
}

export function structuredResultLines(record: SessionRecord): string[] {
  const structured = record.structuredResult;
  if (!structured) return [];
  switch (structured.toolName) {
    case "Bash":
      return [
        structured.interrupted ? "已中断" : "",
        structured.timedOutAfterMs == null
          ? ""
          : `超时上限 ${formatDuration(structured.timedOutAfterMs)}`,
        structured.stdout.length > 0 ? `stdout ${structured.stdout.length} 字符` : "",
        structured.stderr.length > 0 ? `stderr ${structured.stderr.length} 字符` : ""
      ].filter(Boolean);
    case "Edit":
      return [
        structured.replaceAll ? "替换全部匹配" : "替换首个匹配",
        `文件 ${structured.filePath}`
      ];
    case "Write":
      return [structured.created ? "新建文件" : "覆盖写入", `文件 ${structured.filePath}`];
    case "Read":
      return [`文件 ${structured.filePath}`];
    case "Grep":
      return [
        structured.mode ? `模式 ${structured.mode}` : "",
        `命中文件 ${structured.numFiles}`,
        structured.numLines == null ? "" : `命中行 ${structured.numLines}`,
        structured.totalLines == null ? "" : `扫描总行数 ${structured.totalLines}`
      ].filter(Boolean);
    case "Glob":
      return [
        `命中文件 ${structured.numFiles}`,
        structured.totalMatches == null ? "" : `匹配项 ${structured.totalMatches}`,
        structured.durationMs == null ? "" : `工具自报耗时 ${formatDuration(structured.durationMs)}`
      ].filter(Boolean);
    case "Agent":
      return [
        structured.isAsync ? "异步子 agent" : "",
        `agentId ${structured.agentId}`,
        structured.totalDurationMs == null
          ? ""
          : `自报耗时 ${formatDuration(structured.totalDurationMs)}`,
        structured.totalTokens == null ? "" : `token ${structured.totalTokens}`,
        structured.totalToolUseCount == null ? "" : `工具调用 ${structured.totalToolUseCount} 次`,
        structured.resolvedModel ? `实际模型 ${structured.resolvedModel}` : ""
      ].filter(Boolean);
    case "Workflow":
      return [`runId ${structured.runId}`, `状态 ${structured.status}`];
    default:
      return [];
  }
}
