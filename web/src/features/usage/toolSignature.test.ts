import { describe, expect, it } from "vitest";
import { MAX_TOOL_SIGNATURES, toolSignaturesOf } from "./toolSignature";

describe("toolSignaturesOf", () => {
  it("returns null for empty input and for sessions with no tools at all", () => {
    expect(toolSignaturesOf([])).toBeNull();
    expect(toolSignaturesOf([{ tools: [] }, { tools: [] }])).toBeNull();
  });

  it("normalises tool order into one signature", () => {
    const result = toolSignaturesOf([
      { tools: ["Bash", "Read"] },
      { tools: ["Read", "Bash"] }
    ]);
    expect(result!.signatures).toEqual([
      { signature: "Bash · Read", tools: ["Bash", "Read"], count: 2, sessions: 2 }
    ]);
    expect(result!.noToolsCount).toBe(0);
  });

  it("dedupes tools inside a session and ignores empty names", () => {
    const result = toolSignaturesOf([{ tools: ["Bash", "Bash", "", "Read"] }]);
    expect(result!.signatures[0]!.tools).toEqual(["Bash", "Read"]);
    expect(result!.signatures[0]!.count).toBe(1);
  });

  it("sorts by count descending, then lexicographically", () => {
    const result = toolSignaturesOf([
      { tools: ["Bash"] },
      { tools: ["Bash"] },
      { tools: ["Bash"] },
      { tools: ["Read"] },
      { tools: ["Edit"] }
    ]);
    expect(result!.signatures.map((entry) => `${entry.signature}:${entry.count}`)).toEqual([
      "Bash:3",
      "Edit:1",
      "Read:1"
    ]);
  });

  it("keeps the top MAX_TOOL_SIGNATURES signatures", () => {
    const sessions = Array.from({ length: MAX_TOOL_SIGNATURES + 1 }, (_, index) => ({
      tools: [`Tool${index}`]
    }));
    const result = toolSignaturesOf(sessions);
    expect(result!.signatures).toHaveLength(MAX_TOOL_SIGNATURES);
    expect(result!.signatures[0]!.signature).toBe("Tool0");
    expect(result!.signatures.at(-1)!.signature).toBe("Tool7");
  });

  it("counts sessions without tools separately", () => {
    const result = toolSignaturesOf([
      { tools: [] },
      { tools: [] },
      { tools: ["Bash"] }
    ]);
    expect(result!.noToolsCount).toBe(2);
    expect(result!.signatures).toHaveLength(1);
    expect(result!.signatures[0]!.count).toBe(1);
  });
});
