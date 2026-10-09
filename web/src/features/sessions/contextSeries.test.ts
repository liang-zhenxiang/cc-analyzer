import { describe, expect, it } from "vitest";
import { parseJsonlText } from "./parseJsonl";
import { compactionAnchors, contextSeriesOf } from "./contextSeries";
import type { CompactEvent, ContextSample } from "./types";

import compactFixture from "../../../tests/fixtures/compact-session.jsonl?raw";

function parsedFixture() {
  const session = parseJsonlText(compactFixture, "/tmp/compact-session.jsonl");
  return { session, samples: contextSeriesOf(session.records) };
}

describe("contextSeriesOf", () => {
  it("collects one sample per assistant record with usage, ascending by time", () => {
    const { samples } = parsedFixture();

    expect(samples).toHaveLength(120);
    expect(samples[0]).toMatchObject({ uuid: "cs-asst-000", model: "claude-sonnet-4-5" });
    expect(samples.at(-1)?.uuid).toBe("cs-asst-119");
    const timestamps = samples.map((sample) => sample.timestamp);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });

  it("derives contextTokens from the three prompt counters", () => {
    const { samples } = parsedFixture();

    // Turn 0: input 900 + cache read 2000 + cache creation 2500.
    expect(samples[0]).toMatchObject({ contextTokens: 5400, outputTokens: 240 });
    // Turn 49, the cliff edge of the first compaction.
    expect(samples[49]).toMatchObject({ uuid: "cs-asst-049", contextTokens: 167492 });
  });

  it("skips assistant records without usage", () => {
    const session = parseJsonlText(
      [
        JSON.stringify({
          type: "assistant",
          uuid: "with-usage",
          timestamp: "2026-01-02T03:04:05.000Z",
          message: { id: "m1", model: "claude", content: [{ type: "text", text: "a" }], usage: { input_tokens: 10 } }
        }),
        JSON.stringify({
          type: "assistant",
          uuid: "without-usage",
          timestamp: "2026-01-02T03:04:06.000Z",
          message: { id: "m2", model: "claude", content: [{ type: "text", text: "b" }] }
        }),
        JSON.stringify({
          type: "user",
          uuid: "a-user",
          timestamp: "2026-01-02T03:04:07.000Z",
          message: { content: "hello" }
        })
      ].join("\n"),
      "/tmp/no-usage.jsonl"
    );

    const samples = contextSeriesOf(session.records);
    expect(samples.map((sample) => sample.uuid)).toEqual(["with-usage"]);
    // Missing counters are zeros, so contextTokens is still a number.
    expect(samples[0]).toMatchObject({ contextTokens: 10, outputTokens: 0, model: "claude" });
  });
});

describe("compactionAnchors", () => {
  it("anchors each cliff at the logical parent's sample", () => {
    const { session, samples } = parsedFixture();
    const events = session.compactEvents ?? [];

    const anchors = compactionAnchors(samples, events);
    expect(anchors).toEqual([
      { eventId: "cs-boundary-001", beforeIndex: 49, afterIndex: 50 },
      { eventId: "cs-boundary-002", beforeIndex: 89, afterIndex: 90 }
    ]);

    // The anchor must be the sample the boundary's logicalParentUuid names —
    // the boundary's own parentUuid is null, so any other attachment point
    // would misplace the cliff.
    for (const anchor of anchors) {
      const event = events.find((candidate) => candidate.id === anchor.eventId);
      const parentIndex = samples.findIndex((sample) => sample.uuid === event?.logicalParentUuid);
      expect(anchor.beforeIndex).toBe(parentIndex);
    }
  });

  it("keeps at least a 10x drop across every compaction cliff", () => {
    const { session, samples } = parsedFixture();

    const anchors = compactionAnchors(samples, session.compactEvents ?? []);
    expect(anchors).toHaveLength(2);
    for (const { beforeIndex, afterIndex } of anchors) {
      const before = samples[beforeIndex].contextTokens;
      const after = samples[afterIndex].contextTokens;
      // Guards against a wrong field name flattening the curve: a real
      // compaction cliff is an order-of-magnitude drop, not a dip.
      expect(before / after).toBeGreaterThanOrEqual(10);
      expect(before).toBeGreaterThan(100_000);
      expect(after).toBeLessThan(20_000);
    }
  });

  it("falls back to the boundary timestamp when the parent is not a sample", () => {
    const samples: ContextSample[] = [
      { uuid: "a", timestamp: 1_000, contextTokens: 50_000, outputTokens: 10, model: "m" },
      { uuid: "b", timestamp: 2_000, contextTokens: 60_000, outputTokens: 10, model: "m" },
      { uuid: "c", timestamp: 9_000, contextTokens: 5_000, outputTokens: 10, model: "m" }
    ];
    const events: CompactEvent[] = [
      {
        // Points at a user message — not in the sample series.
        id: "boundary-user-parent",
        timestamp: 4_000,
        trigger: "auto",
        preTokens: 60_000,
        postTokens: 5_000,
        droppedTokens: 55_000,
        durationMs: 1_000,
        survivedUuids: [],
        summaryText: null,
        summaryUuid: null,
        logicalParentUuid: "the-user-message"
      }
    ];

    expect(compactionAnchors(samples, events)).toEqual([
      { eventId: "boundary-user-parent", beforeIndex: 1, afterIndex: 2 }
    ]);
  });

  it("returns -1 when the compaction precedes every sample", () => {
    const samples: ContextSample[] = [
      { uuid: "a", timestamp: 2_000, contextTokens: 5_000, outputTokens: 10, model: "m" }
    ];
    const events: CompactEvent[] = [
      {
        id: "early-boundary",
        timestamp: 1_000,
        trigger: "auto",
        preTokens: null,
        postTokens: null,
        droppedTokens: null,
        durationMs: null,
        survivedUuids: [],
        summaryText: null,
        summaryUuid: null,
        logicalParentUuid: null
      }
    ];

    expect(compactionAnchors(samples, events)).toEqual([
      { eventId: "early-boundary", beforeIndex: -1, afterIndex: 0 }
    ]);
    expect(compactionAnchors(samples, [])).toEqual([]);
  });
});
