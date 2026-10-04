import { describe, expect, it } from "vitest";
import fixture from "../../../tests/fixtures/session-metadata.jsonl?raw";
import ideFixture from "../../../tests/fixtures/session-ide-noise.jsonl?raw";
import { extractSessionMetadata } from "./metadataScanner";

function line(value: unknown) {
  return JSON.stringify(value);
}

describe("extractSessionMetadata", () => {
  it("extracts titles by priority", () => {
    const head = [
      line({ cwd: "/repo", sessionId: "session-1", gitBranch: "main" }),
      line({ type: "ai-title", aiTitle: "AI title" }),
      line({ type: "agent-name", agentName: "Agent name" }),
      line({ type: "custom-title", customTitle: "Custom title" }),
      line({ type: "assistant" })
    ].join("\n");

    expect(extractSessionMetadata(head, "repo-demo")).toEqual({
      sessionId: "session-1",
      cwd: "/repo",
      gitBranch: "main",
      projectLabel: "repo-demo",
      customTitle: "Custom title",
      agentName: "Agent name",
      aiTitle: "AI title",
      userPrompt: undefined,
      hasRecords: true
    });
  });

  it("extracts the first real user prompt and skips metadata", () => {
    const head = [
      line({ type: "system" }),
      line({ type: "user", isMeta: true, message: { content: "ignored" } }),
      line({ type: "user", message: { content: [{ type: "text", text: "Fix the login bug" }] } })
    ].join("\n");

    const metadata = extractSessionMetadata(head, "repo-demo");
    expect(metadata.userPrompt).toBe("Fix the login bug");
    expect(metadata.hasRecords).toBe(false);
  });

  it("extracts useful text after command tags from the fixture", () => {
    const metadata = extractSessionMetadata(fixture, "repo-demo");

    expect(metadata.userPrompt).toBe("Fix the login bug");
  });

  it("strips the IDE-injected tags so the title is the user's own words", () => {
    // 用 IDE 的人首条消息前会挂 <ide_opened_file>；不清掉的话标题就是这一整段标签。
    const metadata = extractSessionMetadata(ideFixture, "repo-ide");

    expect(metadata.userPrompt).toBe("重构这个函数，去掉重复分支");
  });

  it("strips system-reminder noise around the first prompt", () => {
    const head = line({
      type: "user",
      message: {
        content: "<system-reminder>context</system-reminder>\n\n修复登录 bug"
      }
    });

    expect(extractSessionMetadata(head, "repo-demo").userPrompt).toBe("修复登录 bug");
  });

  it("ignores a command-only prompt", () => {
    const head = [
      line({ type: "user", message: { content: "<command-name>compact</command-name>" } })
    ].join("\n");

    expect(extractSessionMetadata(head, "repo-demo").userPrompt).toBeUndefined();
  });

  it("processes target events at the 500 valid-event boundary", () => {
    const target = line({ type: "custom-title", customTitle: "Target title" });
    const atBoundary = Array.from({ length: 499 }, () => line({ type: "assistant" })).join("\n");
    const afterBoundary = Array.from({ length: 500 }, () => line({ type: "assistant" })).join("\n");

    expect(extractSessionMetadata(`${atBoundary}\n${target}`, "repo-demo").customTitle).toBe(
      "Target title"
    );
    expect(extractSessionMetadata(`${afterBoundary}\n${target}`, "repo-demo").customTitle).toBeUndefined();
  });

  it("tolerates malformed lines", () => {
    const head = "{broken}\n" + line({ cwd: "/repo", type: "assistant" });
    expect(extractSessionMetadata(head, "repo-demo").cwd).toBe("/repo");
  });
});
