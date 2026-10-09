import { describe, expect, it } from "vitest";
import { parseJsonlText } from "./parseJsonl";
import { compactionAnchors, contextSeriesOf } from "./contextSeries";
import { droppedByEvent } from "./droppedMessages";

import compactFixture from "../../../tests/fixtures/compact-session.jsonl?raw";

function parsedFixture() {
  const session = parseJsonlText(compactFixture, "/tmp/compact-session.jsonl");
  const samples = contextSeriesOf(session.records);
  const anchors = compactionAnchors(samples, session.compactEvents ?? []);
  return { session, samples, anchors };
}

function bucketsOf(session: ReturnType<typeof parseJsonlText>, samples: ReturnType<typeof contextSeriesOf>, anchors: ReturnType<typeof compactionAnchors>) {
  return droppedByEvent(session.records, session.sidechainMessages, session.compactEvents ?? [], samples, anchors);
}

describe("droppedByEvent（口径：边界前全部消息 − 幸存清单，首次丢弃去重）", () => {
  it("lists every pre-boundary message except the survivors", () => {
    const { session, samples, anchors } = parsedFixture();
    const buckets = bucketsOf(session, samples, anchors);

    // 边界 1 之前有 100 条消息（cs-user-000..cs-asst-049），幸存 6 条。
    const first = buckets.get("cs-boundary-001");
    expect(first).toBeDefined();
    expect(first?.contextCount).toBe(100);
    expect(first?.records).toHaveLength(94);
    expect(first?.survivors.map((record) => record.fullId)).toEqual([
      "cs-user-047",
      "cs-asst-047",
      "cs-user-048",
      "cs-asst-048",
      "cs-user-049",
      "cs-asst-049"
    ]);
    expect(first?.records.map((record) => record.fullId)).toContain("cs-user-000");
    expect(first?.records.map((record) => record.fullId)).not.toContain("cs-asst-049");
  });

  it("cuts by conversation order, not the boundary write timestamp", () => {
    const { session, samples, anchors } = parsedFixture();
    const buckets = bucketsOf(session, samples, anchors);

    // cs-user-050 / cs-asst-050 是压缩后的首批消息，但时间戳早于边界写盘时刻
    // （共享夹具刻意保留的真实写盘偏斜）。按对话顺序切割，它们不属于边界 1
    // 的「被丢出」清单。
    const firstIds = buckets.get("cs-boundary-001")?.records.map((record) => record.fullId);
    expect(firstIds).not.toContain("cs-user-050");
    expect(firstIds).not.toContain("cs-asst-050");
    // 它们进入边界 2 的上下文，最终在边界 2 被丢出。
    const secondIds = buckets.get("cs-boundary-002")?.records.map((record) => record.fullId);
    expect(secondIds).toContain("cs-user-050");
  });

  it("carries only the surviving context into the next boundary (first-drop dedup)", () => {
    const { session, samples, anchors } = parsedFixture();
    const buckets = bucketsOf(session, samples, anchors);

    // 边界 2 的上下文 = 边界 1 的 6 名幸存者 + 两界之间的 80 条新消息。
    const second = buckets.get("cs-boundary-002");
    expect(second?.contextCount).toBe(86);
    expect(second?.records).toHaveLength(82);

    // 在边界 1 已丢的消息不许在边界 2 再列一遍。
    const firstIds = new Set(buckets.get("cs-boundary-001")?.records.map((r) => r.fullId));
    for (const record of second?.records ?? []) {
      expect(firstIds.has(record.fullId)).toBe(false);
    }
    // 边界 1 的幸存者若未活过边界 2，则落在边界 2 的清单里。
    expect(second?.records.map((record) => record.fullId)).toContain("cs-asst-049");
  });

  it("never lists the compact-summary pseudo user message", () => {
    const { session, samples, anchors } = parsedFixture();
    const buckets = bucketsOf(session, samples, anchors);

    const listed = [...buckets.values()].flatMap((bucket) =>
      bucket.records.map((record) => record.fullId)
    );
    // 摘要消息（isCompactSummary）不是用户发言，不进清单（数据约束 #3）。
    expect(listed).not.toContain("cs-summary-001");
    expect(listed).not.toContain("cs-summary-002");
  });

  it("includes sidechain messages — they leave the context too", () => {
    const sidechainLine = JSON.stringify({
      sessionId: "compact-session",
      timestamp: "2026-03-01T09:10:00.000Z",
      uuid: "cs-side-000",
      parentUuid: "cs-asst-015",
      isSidechain: true,
      type: "assistant",
      message: {
        id: "cs-side-msg-000",
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "侧链里的一步。" }]
      }
    });
    const reparsed = parseJsonlText(`${compactFixture}\n${sidechainLine}`, "/tmp/compact-session.jsonl");
    const samples = contextSeriesOf(reparsed.records);
    const anchors = compactionAnchors(samples, reparsed.compactEvents ?? []);

    const buckets = droppedByEvent(
      reparsed.records,
      reparsed.sidechainMessages,
      reparsed.compactEvents ?? [],
      samples,
      anchors
    );
    expect(reparsed.compactEvents).toHaveLength(2);
    expect(buckets.get("cs-boundary-001")?.records.map((record) => record.fullId)).toContain(
      "cs-side-000"
    );
  });
});
