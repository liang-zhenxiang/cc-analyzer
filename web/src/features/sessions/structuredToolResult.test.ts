import { describe, expect, it } from "vitest";
import { extractStructuredToolResult } from "./structuredToolResult";

describe("extractStructuredToolResult", () => {
  it("extracts Bash execution metadata", () => {
    expect(
      extractStructuredToolResult("Bash", {
        stdout: "done",
        stderr: "",
        interrupted: false,
        timedOutAfterMs: 1200
      })
    ).toEqual({
      toolName: "Bash",
      stdout: "done",
      stderr: "",
      interrupted: false,
      timedOutAfterMs: 1200
    });
  });

  it("extracts Edit, Write, Read, Grep, Glob, Agent, and Workflow fields", () => {
    expect(
      extractStructuredToolResult("Edit", {
        filePath: "/repo/app.ts",
        oldString: "a",
        newString: "b",
        replaceAll: true,
        structuredPatch: [{ patch: true }]
      })
    ).toEqual({
      toolName: "Edit",
      filePath: "/repo/app.ts",
      oldString: "a",
      newString: "b",
      replaceAll: true,
      structuredPatch: [{ patch: true }]
    });

    expect(extractStructuredToolResult("Write", { type: "create", filePath: "/repo/new.ts" })).toEqual({
      toolName: "Write",
      filePath: "/repo/new.ts",
      created: true
    });
    expect(extractStructuredToolResult("Read", { file: { filePath: "/repo/app.ts" } })).toEqual({
      toolName: "Read",
      filePath: "/repo/app.ts"
    });
    expect(
      extractStructuredToolResult("Grep", { mode: "content", numFiles: 2, numLines: 5, totalLines: 8 })
    ).toEqual({ toolName: "Grep", mode: "content", numFiles: 2, numLines: 5, totalLines: 8 });
    expect(extractStructuredToolResult("Glob", { numFiles: 3, totalMatches: 9, durationMs: 4 })).toEqual({
      toolName: "Glob",
      numFiles: 3,
      totalMatches: 9,
      durationMs: 4
    });
    expect(
      extractStructuredToolResult("Agent", {
        agentId: "agent-1",
        agentType: "code",
        totalDurationMs: 10,
        totalTokens: 20,
        totalToolUseCount: 3,
        isAsync: true,
        description: "Run checks",
        resolvedModel: "claude"
      })
    ).toEqual({
      toolName: "Agent",
      agentId: "agent-1",
      agentType: "code",
      totalDurationMs: 10,
      totalTokens: 20,
      totalToolUseCount: 3,
      isAsync: true,
      description: "Run checks",
      resolvedModel: "claude"
    });
    expect(
      extractStructuredToolResult("Workflow", {
        runId: "run-1",
        taskId: "task-1",
        workflowName: "Release",
        scriptPath: "/repo/run.json",
        status: "completed"
      })
    ).toEqual({
      toolName: "Workflow",
      runId: "run-1",
      taskId: "task-1",
      workflowName: "Release",
      scriptPath: "/repo/run.json",
      status: "completed"
    });
  });

  it("returns null for unknown tools or invalid input", () => {
    expect(extractStructuredToolResult("Unknown", { value: 1 })).toBeNull();
    expect(extractStructuredToolResult("Bash", null)).toBeNull();
    expect(extractStructuredToolResult("Bash", "not-object")).toBeNull();
  });
});
