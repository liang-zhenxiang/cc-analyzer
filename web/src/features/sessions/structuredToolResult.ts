import type { StructuredToolResult } from "./types";

function optionalString(value: Record<string, unknown>, key: string): string {
  return typeof value[key] === "string" ? (value[key] as string) : "";
}

function optionalNumber(value: Record<string, unknown>, key: string): number | null {
  return typeof value[key] === "number" && Number.isFinite(value[key]) ? (value[key] as number) : null;
}

function optionalBoolean(value: Record<string, unknown>, key: string): boolean {
  return value[key] === true;
}

export function extractStructuredToolResult(
  toolName: string | undefined,
  toolUseResult: unknown
): StructuredToolResult | null {
  if (!toolName || !toolUseResult || typeof toolUseResult !== "object" || Array.isArray(toolUseResult)) {
    return null;
  }

  const result = toolUseResult as Record<string, unknown>;
  switch (toolName) {
    case "Bash":
      return {
        toolName,
        stdout: optionalString(result, "stdout"),
        stderr: optionalString(result, "stderr"),
        interrupted: optionalBoolean(result, "interrupted"),
        timedOutAfterMs: optionalNumber(result, "timedOutAfterMs")
      };
    case "Edit":
      return {
        toolName,
        filePath: optionalString(result, "filePath"),
        oldString: optionalString(result, "oldString"),
        newString: optionalString(result, "newString"),
        replaceAll: optionalBoolean(result, "replaceAll"),
        structuredPatch: result.structuredPatch ?? null
      };
    case "Write":
      return {
        toolName,
        filePath: optionalString(result, "filePath"),
        created: result.type === "create"
      };
    case "Read": {
      const file = result.file;
      const filePath =
        file && typeof file === "object" && !Array.isArray(file)
          ? optionalString(file as Record<string, unknown>, "filePath")
          : optionalString(result, "file");
      return { toolName, filePath };
    }
    case "Grep":
      return {
        toolName,
        mode: optionalString(result, "mode"),
        numFiles: optionalNumber(result, "numFiles") ?? 0,
        numLines: optionalNumber(result, "numLines"),
        totalLines: optionalNumber(result, "totalLines")
      };
    case "Glob":
      return {
        toolName,
        numFiles: optionalNumber(result, "numFiles") ?? 0,
        totalMatches: optionalNumber(result, "totalMatches"),
        durationMs: optionalNumber(result, "durationMs")
      };
    case "Agent":
      return {
        toolName,
        agentId: optionalString(result, "agentId"),
        agentType: optionalString(result, "agentType"),
        totalDurationMs: optionalNumber(result, "totalDurationMs"),
        totalTokens: optionalNumber(result, "totalTokens"),
        totalToolUseCount: optionalNumber(result, "totalToolUseCount"),
        isAsync: optionalBoolean(result, "isAsync"),
        description: optionalString(result, "description"),
        resolvedModel: optionalString(result, "resolvedModel")
      };
    case "Workflow":
      return {
        toolName,
        runId: optionalString(result, "runId"),
        taskId: optionalString(result, "taskId"),
        workflowName: optionalString(result, "workflowName"),
        scriptPath: optionalString(result, "scriptPath"),
        status: optionalString(result, "status")
      };
    default:
      return null;
  }
}
