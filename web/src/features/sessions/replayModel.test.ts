import { describe, expect, it } from "vitest";
import type { LogRow, LogRowStatus, LogTokens } from "./logRows";
import type { CompactEvent, ContextSample, SessionRecord, SessionUsage } from "./types";
import {
  REPLAY_WARP_LEAD_MS,
  REPLAY_WARP_RATE,
  buildReplayFilm,
  frameAt,
  progressAt,
  realMsAt
} from "./replayModel";

/** A fixed wall clock so nothing depends on "now". */
const T0 = 1_700_000_000_000;
const SONNET = "claude-sonnet-4-5-20250929";

function recordOf(overrides: Partial<SessionRecord> & { timestamp: number }): SessionRecord {
  return {
    id: "record",
    fullId: "record",
    kind: "assistant",
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...overrides
  };
}

type RowSpec = Partial<Omit<LogRow, "id" | "timestamp">>;

function rowOf(spec: { id: string; at: number } & RowSpec): LogRow {
  const { id, at, ...rest } = spec;
  return {
    id,
    kind: "llm",
    label: "LLM",
    action: "",
    summary: "",
    timestamp: at,
    durationMs: 0,
    status: "ok",
    tokens: null,
    mergedWith: null,
    turn: null,
    invokedTools: [],
    records: [],
    ...rest
  };
}

/** One model call, optionally with a usage reading. Tokens mirror that usage. */
function assistantRow(
  id: string,
  at: number,
  spec: {
    model?: string;
    usage?: SessionUsage;
    durationMs?: number;
    status?: LogRowStatus;
    summary?: string;
  } = {}
): LogRow {
  const usage = spec.usage;
  const prompt = usage
    ? (usage.inputTokens ?? 0) +
      (usage.cacheCreationTokens ?? 0) +
      (usage.cacheReadTokens ?? 0)
    : 0;
  const output = usage?.outputTokens ?? 0;
  const record = usage
    ? recordOf({
        fullId: `${id}-record`,
        kind: "assistant",
        timestamp: at,
        durationMs: spec.durationMs ?? 0,
        model: spec.model,
        usage
      })
    : null;
  return rowOf({
    id,
    at,
    kind: "llm",
    label: "LLM",
    durationMs: spec.durationMs ?? 0,
    status: spec.status ?? "ok",
    summary: spec.summary ?? "",
    tokens: usage && prompt + output > 0 ? { prompt, output } : null,
    records: record ? [record] : []
  });
}

function tokenRow(id: string, at: number, tokens: LogTokens): LogRow {
  return rowOf({
    id,
    at,
    kind: "llm",
    label: "LLM",
    tokens,
    records: [
      recordOf({
        fullId: `${id}-record`,
        kind: "assistant",
        timestamp: at,
        model: SONNET,
        usage: { inputTokens: tokens.prompt, outputTokens: tokens.output }
      })
    ]
  });
}

function compactRow(
  id: string,
  at: number,
  durationMs: number | null,
  summary = "1,000 → 100 tok"
): LogRow {
  const event: CompactEvent = {
    id,
    timestamp: at,
    trigger: "auto",
    preTokens: 1_000,
    postTokens: 100,
    droppedTokens: 900,
    durationMs,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null
  };
  const boundary = recordOf({
    fullId: `${id}-boundary`,
    kind: "system",
    timestamp: at,
    compactEvent: event
  });
  return rowOf({
    id,
    at,
    kind: "compact",
    label: "压缩",
    status: "na",
    durationMs: durationMs ?? 0,
    summary,
    compact: { event, ordinal: 1, summaryRecord: null, survivors: [], record: boundary }
  });
}

function zeroTotals() {
  return {
    events: 0,
    tools: 0,
    errors: 0,
    compactions: 0,
    tokensPrompt: 0,
    tokensOutput: 0,
    costUsd: null,
    costUnknownEvents: 0,
    eventsWithoutUsage: 0
  };
}

function sample(uuid: string, timestamp: number, contextTokens: number): ContextSample {
  return { uuid, timestamp, contextTokens, outputTokens: 0, model: null };
}

function eventById(film: ReturnType<typeof buildReplayFilm>, id: string) {
  const event = film.events.find((candidate) => candidate.id === id);
  if (!event) throw new Error(`missing event ${id}`);
  return event;
}

describe("buildReplayFilm", () => {
  it("spans the earliest to latest record timestamp, not the row timestamps", () => {
    const rows = [
      rowOf({ id: "user", at: T0 + 1_000, kind: "user", label: "用户", status: "na" }),
      assistantRow("llm", T0 + 4_000, { model: SONNET, usage: { inputTokens: 10 } })
    ];
    const records = [
      recordOf({ fullId: "user-record", kind: "user", timestamp: T0 }),
      recordOf({ fullId: "llm-record", kind: "assistant", timestamp: T0 + 10_000 })
    ];

    const film = buildReplayFilm(rows, records);

    expect(film.start).toBe(T0);
    expect(film.end).toBe(T0 + 10_000);
    expect(film.events.map((event) => event.id)).toEqual(["user", "llm"]);
  });

  it("falls back to the event timestamps when no records are supplied", () => {
    const film = buildReplayFilm(
      [
        rowOf({ id: "late", at: T0 + 2_000, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "early", at: T0, kind: "user", label: "用户", status: "na" })
      ],
      []
    );

    expect(film.start).toBe(T0);
    expect(film.end).toBe(T0 + 2_000);
    expect(film.events.map((event) => event.id)).toEqual(["early", "late"]);
  });

  it("keeps a compact boundary recorded after the last message on the film", () => {
    // Compact boundaries are log records the parser consumes, so they are not
    // in `records`; a records-only span would end before the final one.
    const records = [
      recordOf({ fullId: "user-record", kind: "user", timestamp: T0 }),
      recordOf({ fullId: "assistant-record", kind: "assistant", timestamp: T0 + 10_000 })
    ];
    const film = buildReplayFilm([compactRow("boundary", T0 + 20_000, null)], records);

    expect(film.start).toBe(T0);
    expect(film.end).toBe(T0 + 20_000);
    const frame = frameAt(film, film.end, [], "real");
    expect(frame.progress).toBe(1);
    expect(frame.current?.id).toBe("boundary");
    expect(frame.passed.compactions).toBe(1);
  });

  it("keeps prompt and output tokens apart and counts model calls with no usage", () => {
    const film = buildReplayFilm(
      [
        assistantRow("a1", T0, { model: SONNET, usage: { inputTokens: 100, outputTokens: 10 } }),
        assistantRow("a2", T0 + 1_000, {
          model: SONNET,
          usage: { inputTokens: 200, cacheCreationTokens: 30, cacheReadTokens: 40, outputTokens: 20 }
        }),
        assistantRow("a3", T0 + 2_000),
        rowOf({ id: "tool", at: T0 + 3_000, kind: "tool", label: "工具" }),
        rowOf({ id: "user", at: T0 + 4_000, kind: "user", label: "用户", status: "na" })
      ],
      []
    );

    expect(film.totals.events).toBe(5);
    expect(film.totals.tokensPrompt).toBe(100 + 270);
    expect(film.totals.tokensOutput).toBe(30);
    // Only the model call without usage is a *missing* reading; user/tool
    // events never had one to miss.
    expect(film.totals.eventsWithoutUsage).toBe(1);
    expect(film.events.map((event) => event.id)).toEqual(["a1", "a2", "a3", "tool", "user"]);
  });

  it("treats an all-zero usage object as a measured reading, not a missing one", () => {
    const film = buildReplayFilm(
      [assistantRow("zero", T0, { model: SONNET, usage: {} })],
      []
    );

    const event = eventById(film, "zero");
    expect(event.tokensPrompt).toBe(0);
    expect(event.tokensOutput).toBe(0);
    expect(event.costUsd).toBe(0);
    expect(film.totals.costUsd).toBe(0);
    expect(film.totals.costUnknownEvents).toBe(0);
    expect(film.totals.eventsWithoutUsage).toBe(0);
  });

  it("prices all four counters with the shared estimator", () => {
    const film = buildReplayFilm(
      [
        assistantRow("priced", T0, {
          model: SONNET,
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
            cacheCreationTokens: 1_000_000,
            cacheReadTokens: 1_000_000
          }
        })
      ],
      []
    );

    // sonnet: 3 + 15 + 3.75 + 0.3 USD per MTok
    expect(eventById(film, "priced").costUsd).toBeCloseTo(22.05, 10);
    expect(film.totals.costUsd).toBeCloseTo(22.05, 10);
    expect(film.totals.costUnknownEvents).toBe(0);
  });

  it("sums only priced events and counts the unpriced ones", () => {
    const film = buildReplayFilm(
      [
        assistantRow("priced", T0, { model: SONNET, usage: { inputTokens: 1_000_000 } }),
        assistantRow("unpriced", T0 + 1_000, {
          model: "gpt-4o",
          usage: { inputTokens: 1_000_000 }
        }),
        assistantRow("unread", T0 + 2_000)
      ],
      []
    );

    expect(eventById(film, "priced").costUsd).toBeCloseTo(3, 10);
    expect(eventById(film, "unpriced").costUsd).toBeNull();
    expect(eventById(film, "unread").costUsd).toBeNull();
    expect(film.totals.costUsd).toBeCloseTo(3, 10);
    expect(film.totals.costUnknownEvents).toBe(1);
    expect(film.totals.eventsWithoutUsage).toBe(1);
  });

  it("reports a null cost total when not one event could be priced", () => {
    const film = buildReplayFilm(
      [
        assistantRow("u1", T0, { model: "gpt-4o", usage: { inputTokens: 1_000 } }),
        assistantRow("u2", T0 + 1_000, { usage: { inputTokens: 2_000 } })
      ],
      []
    );

    expect(film.totals.costUsd).toBeNull();
    expect(film.totals.costUnknownEvents).toBe(2);
  });

  it("marks the busiest 60-second window with both endpoints included", () => {
    const film = buildReplayFilm(
      [
        tokenRow("a", T0, { prompt: 100, output: 0 }),
        tokenRow("b", T0 + 60_000, { prompt: 100, output: 0 }),
        tokenRow("c", T0 + 60_001, { prompt: 0, output: 0 })
      ],
      []
    );

    const mark = film.marks.find((candidate) => candidate.kind === "costliest-minute");
    expect(mark?.at).toBe(T0);
    expect(mark?.detail).toBe("200 tok · 2 个事件");
  });

  it("prefers the earlier window when two windows tie", () => {
    const film = buildReplayFilm(
      [
        tokenRow("a", T0, { prompt: 100, output: 0 }),
        tokenRow("b", T0 + 70_000, { prompt: 100, output: 0 })
      ],
      []
    );

    const mark = film.marks.find((candidate) => candidate.kind === "costliest-minute");
    expect(mark?.at).toBe(T0);
    expect(mark?.detail).toBe("100 tok · 1 个事件");
  });

  it("omits the costliest minute when no window has a positive token reading", () => {
    const film = buildReplayFilm(
      [
        assistantRow("a", T0, { model: SONNET, usage: {} }),
        assistantRow("b", T0 + 5_000, { model: SONNET, usage: {} })
      ],
      []
    );

    expect(film.marks.some((mark) => mark.kind === "costliest-minute")).toBe(false);
  });

  it("marks the largest adjacent-timestamp gap and prefers the earlier tie", () => {
    const film = buildReplayFilm(
      [
        rowOf({ id: "a", at: T0, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "b", at: T0 + 60_000, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "c", at: T0 + 120_000, kind: "user", label: "用户", status: "na" })
      ],
      []
    );

    const mark = film.marks.find((candidate) => candidate.kind === "longest-gap");
    expect(mark?.at).toBe(T0);
    expect(mark?.detail).toBe("1m0s");
  });

  it("produces no longest-gap mark for a single event or for simultaneous events", () => {
    const single = buildReplayFilm(
      [rowOf({ id: "only", at: T0, kind: "user", label: "用户", status: "na" })],
      []
    );
    const simultaneous = buildReplayFilm(
      [
        rowOf({ id: "a", at: T0, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "b", at: T0, kind: "user", label: "用户", status: "na" })
      ],
      []
    );

    expect(single.marks.some((mark) => mark.kind === "longest-gap")).toBe(false);
    expect(simultaneous.marks.some((mark) => mark.kind === "longest-gap")).toBe(false);
  });

  it("orders marks by time and breaks ties start → compact → error → other", () => {
    const film = buildReplayFilm(
      [
        rowOf({ id: "user", at: T0, kind: "user", label: "用户", status: "na" }),
        compactRow("compact", T0 + 130_000, 1_000),
        assistantRow("error", T0 + 130_000, {
          model: SONNET,
          usage: { inputTokens: 1_000_000 },
          status: "error",
          summary: "429"
        })
      ],
      []
    );

    const atError = film.marks
      .filter((mark) => mark.at === T0 + 130_000)
      .map((mark) => mark.kind);
    expect(atError).toEqual(["compact", "first-error", "costliest-minute"]);

    const times = film.marks.map((mark) => mark.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const ids = film.marks.map((mark) => mark.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("marks every compaction and keeps compact behind start at one instant", () => {
    const film = buildReplayFilm(
      [compactRow("c1", T0 + 5_000, 1_000), compactRow("c2", T0 + 15_000, null)],
      []
    );

    expect(film.marks.slice(0, 3).map((mark) => mark.kind)).toEqual([
      "start",
      "compact",
      "longest-gap"
    ]);
    const compacts = film.marks.filter((mark) => mark.kind === "compact");
    expect(compacts.map((mark) => ({ at: mark.at, label: mark.label }))).toEqual([
      { at: T0 + 5_000, label: "压缩 #1" },
      { at: T0 + 15_000, label: "压缩 #2" }
    ]);
    expect(compacts[0].detail).toBe("1,000 → 100 tok");
  });

  it("marks the first failure once, even when later events fail too", () => {
    const film = buildReplayFilm(
      [
        assistantRow("ok", T0, { model: SONNET, usage: { inputTokens: 10 } }),
        assistantRow("err1", T0 + 3_000, {
          model: SONNET,
          usage: { inputTokens: 10 },
          status: "error",
          summary: "429 Too Many Requests"
        }),
        assistantRow("err2", T0 + 9_000, {
          model: SONNET,
          usage: { inputTokens: 10 },
          status: "error",
          summary: "500"
        })
      ],
      []
    );

    const marks = film.marks.filter((mark) => mark.kind === "first-error");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      at: T0 + 3_000,
      label: "首次失败",
      detail: "LLM · 429 Too Many Requests"
    });
  });

  it("counts tool-family events, errors and compactions", () => {
    const film = buildReplayFilm(
      [
        rowOf({ id: "tool", at: T0, kind: "tool", label: "工具" }),
        rowOf({ id: "subagent", at: T0 + 1, kind: "subagent", label: "子 agent" }),
        rowOf({ id: "workflow", at: T0 + 2, kind: "workflow", label: "workflow" }),
        rowOf({ id: "wait", at: T0 + 3, kind: "wait", label: "等用户" }),
        compactRow("compact", T0 + 4, 1_000),
        rowOf({ id: "user", at: T0 + 5, kind: "user", label: "用户", status: "na" }),
        assistantRow("error", T0 + 6, {
          model: SONNET,
          usage: { inputTokens: 1 },
          status: "error"
        })
      ],
      []
    );

    expect(film.totals.events).toBe(7);
    expect(film.totals.tools).toBe(3);
    expect(film.totals.errors).toBe(1);
    expect(film.totals.compactions).toBe(1);
  });

  it("keeps measured durations, refuses to invent them, and recovers compact durations", () => {
    const film = buildReplayFilm(
      [
        rowOf({ id: "user", at: T0, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "tool", at: T0 + 1_000, kind: "tool", label: "工具", durationMs: 0 }),
        assistantRow("llm", T0 + 2_000, {
          model: SONNET,
          usage: { inputTokens: 1 },
          durationMs: 1_500
        }),
        compactRow("compact-known", T0 + 3_000, 2_000),
        compactRow("compact-unknown", T0 + 4_000, null),
        rowOf({
          id: "gap",
          at: T0 + 5_000,
          kind: "wait",
          label: "等用户",
          status: "na",
          summary: "等待用户输入（轮间间隙）",
          durationMs: 60_000,
          gap: { start: T0 + 5_000, end: T0 + 65_000 }
        })
      ],
      []
    );

    expect(eventById(film, "user").durationMs).toBeNull();
    expect(eventById(film, "tool").durationMs).toBe(0);
    expect(eventById(film, "llm").durationMs).toBe(1_500);
    expect(eventById(film, "compact-known").durationMs).toBe(2_000);
    expect(eventById(film, "compact-unknown").durationMs).toBeNull();
    expect(eventById(film, "gap").durationMs).toBe(60_000);
  });

  it("flattens ANSI and newlines out of the event detail", () => {
    const film = buildReplayFilm(
      [
        rowOf({
          id: "a",
          at: T0,
          kind: "tool",
          label: "工具",
          summary: "\u001b[31m读取失败\u001b[0m\n第二行   结束"
        })
      ],
      []
    );

    expect(eventById(film, "a").detail).toBe("读取失败 第二行 结束");
  });

  it("keeps the log's row order for events at the same instant", () => {
    const film = buildReplayFilm(
      [
        rowOf({ id: "c", at: T0, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "a", at: T0, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "b", at: T0, kind: "user", label: "用户", status: "na" })
      ],
      []
    );

    expect(film.events.map((event) => event.id)).toEqual(["c", "a", "b"]);
  });

  it("returns an empty zero film for empty inputs", () => {
    const film = buildReplayFilm([], []);

    expect(film.start).toBe(0);
    expect(film.end).toBe(0);
    expect(film.events).toEqual([]);
    expect(film.marks).toEqual([]);
    expect(film.cumulative).toEqual([]);
    expect(film.totals).toEqual(zeroTotals());
  });

  it("handles a zero-span film where every event sits at one instant", () => {
    const records = [recordOf({ fullId: "only-record", kind: "user", timestamp: T0 })];
    const film = buildReplayFilm(
      [
        assistantRow("a", T0, { model: SONNET, usage: {} }),
        assistantRow("b", T0, { model: SONNET, usage: {} })
      ],
      records
    );

    expect(film.start).toBe(T0);
    expect(film.end).toBe(T0);
    expect(progressAt(film, T0, "real")).toBe(0);
    expect(progressAt(film, T0 + 500_000, "compressed")).toBe(0);
    expect(realMsAt(film, 0.4, "real")).toBe(T0);
    expect(realMsAt(film, 0.4, "compressed")).toBe(T0);

    const frame = frameAt(film, T0, [sample("s", T0, 42)], "real");
    expect(frame.progress).toBe(0);
    expect(frame.at).toBe(T0);
    expect(frame.current?.id).toBe("b");
    expect(frame.gap).toBeNull();
    expect(frame.passed.events).toBe(2);
    expect(frame.context).toEqual({ tokens: 42, at: T0 });
  });

  it("handles a single-event film without inventing a pause", () => {
    const film = buildReplayFilm(
      [assistantRow("only", T0, { model: SONNET, usage: { inputTokens: 100 } })],
      []
    );

    expect(film.start).toBe(T0);
    expect(film.end).toBe(T0);
    expect(film.marks.map((mark) => mark.kind)).toEqual(["start", "costliest-minute"]);
    expect(film.marks.some((mark) => mark.kind === "longest-gap")).toBe(false);

    const frame = frameAt(film, T0, [], "real");
    expect(frame.current?.id).toBe("only");
    expect(frame.gap).toBeNull();
    expect(frame.passed.events).toBe(1);
    expect(frame.passed.costUsd).toBeCloseTo(100 / 1_000_000 * 3, 12);
  });
});

describe("progressAt / realMsAt", () => {
  const span = 290_000;
  const film = buildReplayFilm(
    [
      rowOf({ id: "start", at: T0, kind: "user", label: "用户", status: "na" }),
      rowOf({ id: "end", at: T0 + span, kind: "user", label: "用户", status: "na" })
    ],
    []
  );

  it("maps real time linearly and clamps to the film", () => {
    expect(progressAt(film, T0, "real")).toBe(0);
    expect(progressAt(film, T0 + span / 2, "real")).toBe(0.5);
    expect(progressAt(film, T0 + span, "real")).toBe(1);
    expect(progressAt(film, T0 - 5_000, "real")).toBe(0);
    expect(progressAt(film, T0 + span + 5_000, "real")).toBe(1);

    expect(realMsAt(film, 0, "real")).toBe(T0);
    expect(realMsAt(film, 0.5, "real")).toBe(T0 + span / 2);
    expect(realMsAt(film, 1, "real")).toBe(T0 + span);
    expect(realMsAt(film, -0.5, "real")).toBe(T0);
    expect(realMsAt(film, 1.5, "real")).toBe(T0 + span);
  });

  it("plays the first 90 seconds at 1× and the rest at 2%", () => {
    // 290 s of wall clock → 90 s + 200 s × 0.02 = 94 s of film.
    const compressedSpan =
      REPLAY_WARP_LEAD_MS + (span - REPLAY_WARP_LEAD_MS) * REPLAY_WARP_RATE;
    expect(compressedSpan).toBe(94_000);

    expect(progressAt(film, T0 + REPLAY_WARP_LEAD_MS, "compressed")).toBeCloseTo(
      REPLAY_WARP_LEAD_MS / compressedSpan,
      12
    );
    expect(realMsAt(film, 0.5, "compressed")).toBe(T0 + 47_000);
    expect(realMsAt(film, 0.96, "compressed")).toBe(T0 + 102_000);
    expect(progressAt(film, T0 + 102_000, "compressed")).toBeCloseTo(0.96, 12);
    expect(realMsAt(film, 1, "compressed")).toBe(T0 + span);
    expect(realMsAt(film, 0, "compressed")).toBe(T0);

    const early = realMsAt(film, 0.4, "compressed");
    const middle = realMsAt(film, 0.6, "compressed");
    const late = realMsAt(film, 0.8, "compressed");
    expect(early).toBe(T0 + 37_600);
    expect(middle).toBe(T0 + 56_400);
    expect(late).toBe(T0 + 75_200);
    expect(early).toBeLessThan(middle);
    expect(middle).toBeLessThan(late);
  });

  it("treats a NaN clock as the film start instead of leaking NaN", () => {
    expect(progressAt(film, Number.NaN, "real")).toBe(0);
    expect(progressAt(film, Number.NaN, "compressed")).toBe(0);
    expect(realMsAt(film, Number.NaN, "real")).toBe(T0);
    expect(realMsAt(film, Number.NaN, "compressed")).toBe(T0);

    const frame = frameAt(film, Number.NaN, [], "real");
    expect(frame.at).toBe(T0);
    expect(frame.progress).toBe(0);
    expect(frame.current?.id).toBe("start");
  });

  it("is an exact inverse of itself in both time bases", () => {
    const points = [0, 0.013, 0.25, 0.5, 0.9, 0.9574, 0.96, 0.999, 1];
    for (const mode of ["real", "compressed"] as const) {
      for (const point of points) {
        const realMs = realMsAt(film, point, mode);
        // Epoch-scale timestamps cost about 4e-4 ms of float resolution, so the
        // round trip is exact to well under a millisecond, not to the bit.
        expect(Math.abs(realMsAt(film, progressAt(film, realMs, mode), mode) - realMs)).toBeLessThan(1);
        expect(progressAt(film, realMsAt(film, point, mode), mode)).toBeCloseTo(point, 7);
      }
    }
  });
});

describe("frameAt", () => {
  function honestyFilm() {
    return buildReplayFilm(
      [
        assistantRow("a", T0, { model: SONNET, usage: { inputTokens: 10 } }),
        assistantRow("b", T0 + 10_000, { model: SONNET, usage: { inputTokens: 20 } })
      ],
      []
    );
  }

  it("keeps the head on the event that happened and names the pause", () => {
    const film = honestyFilm();
    const samples = [sample("s1", T0 + 500, 1_000), sample("s2", T0 + 5_000, 2_000)];

    const onA = frameAt(film, T0, samples, "real");
    expect(onA.at).toBe(T0);
    expect(onA.current?.id).toBe("a");
    expect(onA.gap).toBeNull();
    expect(onA.passed.events).toBe(1);
    // The first sample is in the future; the head must not show it.
    expect(onA.context).toBeNull();

    const pause = frameAt(film, T0 + 5_000, samples, "real");
    expect(pause.current?.id).toBe("a");
    expect(pause.gap).toEqual({ start: T0, end: T0 + 10_000 });
    expect(pause.passed.events).toBe(1);
    expect(pause.context).toEqual({ tokens: 2_000, at: T0 + 5_000 });

    const onB = frameAt(film, T0 + 10_000, samples, "real");
    expect(onB.current?.id).toBe("b");
    expect(onB.gap).toBeNull();
    expect(onB.passed.events).toBe(2);
    expect(onB.context).toEqual({ tokens: 2_000, at: T0 + 5_000 });

    const afterEnd = frameAt(film, T0 + 99_000, samples, "real");
    expect(afterEnd.at).toBe(T0 + 10_000);
    expect(afterEnd.passed.events).toBe(2);
  });

  it("before the first event reports an empty frame rather than the nearest one", () => {
    const records = [
      recordOf({ fullId: "user-record", kind: "user", timestamp: T0 }),
      recordOf({ fullId: "llm-record", kind: "assistant", timestamp: T0 + 5_000 })
    ];
    const film = buildReplayFilm(
      [assistantRow("a", T0 + 5_000, { model: SONNET, usage: { inputTokens: 10 } })],
      records
    );

    expect(film.start).toBe(T0);
    expect(film.end).toBe(T0 + 5_000);
    const frame = frameAt(film, T0, [], "real");
    expect(frame.at).toBe(T0);
    expect(frame.progress).toBe(0);
    expect(frame.current).toBeNull();
    expect(frame.gap).toBeNull();
    expect(frame.passed).toEqual(zeroTotals());
  });

  it("accumulates only the events the head has passed, priced or not", () => {
    const records = [
      recordOf({ fullId: "user-record", kind: "user", timestamp: T0 }),
      recordOf({ fullId: "first-record", kind: "assistant", timestamp: T0 + 5_000 }),
      recordOf({ fullId: "second-record", kind: "assistant", timestamp: T0 + 15_000 })
    ];
    const film = buildReplayFilm(
      [
        assistantRow("first", T0 + 5_000, {
          model: SONNET,
          usage: { inputTokens: 1_000_000 }
        }),
        assistantRow("second", T0 + 15_000, {
          model: "gpt-4o",
          usage: { inputTokens: 1_000_000 }
        })
      ],
      records
    );

    const before = frameAt(film, T0, [], "real");
    expect(before.passed).toEqual(zeroTotals());

    const afterFirst = frameAt(film, T0 + 5_000, [], "real");
    expect(afterFirst.passed.events).toBe(1);
    expect(afterFirst.passed.costUsd).toBeCloseTo(3, 10);
    expect(afterFirst.passed.costUnknownEvents).toBe(0);

    const afterSecond = frameAt(film, T0 + 15_000, [], "real");
    expect(afterSecond.passed.events).toBe(2);
    expect(afterSecond.passed.costUsd).toBeCloseTo(3, 10);
    expect(afterSecond.passed.costUnknownEvents).toBe(1);
  });

  it("reports progress on the requested time base", () => {
    const film = buildReplayFilm(
      [
        rowOf({ id: "start", at: T0, kind: "user", label: "用户", status: "na" }),
        rowOf({ id: "end", at: T0 + 290_000, kind: "user", label: "用户", status: "na" })
      ],
      []
    );
    const realAt = realMsAt(film, 0.96, "compressed");

    expect(frameAt(film, realAt, [], "compressed").progress).toBeCloseTo(0.96, 12);
    expect(frameAt(film, realAt, [], "real").progress).toBeCloseTo(102 / 290, 12);
  });

  it("locates the head in a 10,000-event film without drifting", () => {
    const rows = Array.from({ length: 10_000 }, (_, index) =>
      assistantRow(`e${index}`, T0 + index * 1_000, {
        model: SONNET,
        usage: { inputTokens: 1 }
      })
    );
    const film = buildReplayFilm(rows, []);
    const samples = Array.from({ length: 10_000 }, (_, index) =>
      sample(`s${index}`, T0 + index * 1_000, index)
    );

    expect(film.events).toHaveLength(10_000);
    expect(film.totals.events).toBe(10_000);
    expect(film.totals.tokensPrompt).toBe(10_000);

    const middle = frameAt(film, T0 + 5_000_400, samples, "real");
    expect(middle.current?.id).toBe("e5000");
    expect(middle.gap).toEqual({ start: T0 + 5_000_000, end: T0 + 5_001_000 });
    expect(middle.passed.events).toBe(5_001);
    expect(middle.passed.tokensPrompt).toBe(5_001);
    expect(middle.context).toEqual({ tokens: 5_000, at: T0 + 5_000_000 });
    expect(middle.progress).toBeCloseTo(5_000_400 / 9_999_000, 12);

    const nearEnd = frameAt(film, T0 + 9_998_500, samples, "real");
    expect(nearEnd.current?.id).toBe("e9998");
    expect(nearEnd.passed.events).toBe(9_999);
    expect(nearEnd.gap).toEqual({ start: T0 + 9_998_000, end: T0 + 9_999_000 });

    const end = frameAt(film, T0 + 9_999_000, samples, "real");
    expect(end.current?.id).toBe("e9999");
    expect(end.gap).toBeNull();
    expect(end.passed.events).toBe(10_000);
    expect(end.progress).toBe(1);
  });
});
