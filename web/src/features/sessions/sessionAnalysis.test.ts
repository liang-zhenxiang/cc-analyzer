import { describe, expect, it } from "vitest";
import { parseJsonlText } from "./parseJsonl";
import { computeDurationBreakdown } from "./duration";
import { buildTimeBlockReport } from "./report";
import subagent from "../../../tests/fixtures/session-subagent.jsonl?raw";
import errors from "../../../tests/fixtures/session-errors.jsonl?raw";

describe("session analysis flow", () => {
  it("parses subagent records and aggregates delegated time", () => {
    const session = parseJsonlText(subagent, "/tmp/subagent.jsonl");
    const delegated = session.records.filter((record) => record.toolCategory === "delegated");

    expect(delegated).toHaveLength(1);
    expect(delegated[0]).toMatchObject({
      fullId: "parent-agent",
      durationMs: 2000,
      childSessionId: "child-session-1",
      childSessionPath: "/tmp/child-session-1.jsonl"
    });
    const breakdown = computeDurationBreakdown(session.records, session.startedAt, session.endedAt);
    expect(breakdown.delegated).toBeGreaterThan(0);
  });

  it("preserves errors for filtering and reporting", () => {
    const session = parseJsonlText(errors, "/tmp/errors.jsonl");
    expect(session.records.filter((record) => record.isError)).toHaveLength(2);
  });

  it("keeps report and folder actions behind bridges", async () => {
    const session = parseJsonlText(subagent, "/tmp/subagent.jsonl");
    const delegated = session.records.find((record) => record.toolCategory === "delegated");
    expect(delegated?.childSessionPath).toBeTypeOf("string");
    expect(
      buildTimeBlockReport(session, session.records, {
        start: session.startedAt,
        end: session.endedAt
      })
    ).toContain("- 选区:");
  });
});
