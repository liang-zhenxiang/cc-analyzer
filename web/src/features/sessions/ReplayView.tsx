import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { Button, IconButton } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { SegmentedControl, type SegmentedItem } from "../../components/SegmentedControl";
import { formatClock, formatDuration, formatTokenCount, formatUsd } from "../../lib/format";
import { contextSeriesOf } from "./contextSeries";
import { buildLogRows, ROW_KIND_LABELS, type LogRow } from "./logRows";
import {
  buildReplayFilm,
  frameAt,
  progressAt,
  realMsAt,
  type ReplayEvent,
  type ReplayFilm,
  type ReplayKind,
  type ReplayMark,
  type ReplayMode,
  type ReplayTotals
} from "./replayModel";
import type { ParsedSession } from "./types";
import { useReplayClock } from "./useReplayClock";
import styles from "./ReplayView.module.css";

/** Both the lane and the clock use this mode; mixing them would break the inverse. */
const PLAYBACK_MODE: ReplayMode = "real";

/**
 * The film is always watched in "compressed" wall-clock terms: the length
 * control says how many seconds of *playback* the whole session gets. The
 * model's compressed mode is deliberately not used here — the reader chooses
 * 30/60/120 s, which is the same idea with a user-controlled total.
 */
const FILM_SECONDS = ["30", "60", "120"] as const;
type FilmSeconds = (typeof FILM_SECONDS)[number];
const DEFAULT_FILM_SECONDS: FilmSeconds = "60";

const SKIP_PAUSE_MS = 60_000;
const DENSITY_BIN_PX = 10;
/** jsdom reports 0 for clientWidth; the first paint still has to draw a lane. */
const FALLBACK_LANE_WIDTH = 1074;

const KIND_ORDER: ReplayKind[] = [
  "user",
  "llm",
  "tool",
  "subagent",
  "workflow",
  "wait",
  "compact"
];

/** Same mapping as LogView: a kind keeps its colour everywhere in the app. */
const KIND_COLOR: Record<ReplayKind, string> = {
  user: "var(--cat-user)",
  llm: "var(--cat-compute)",
  tool: "var(--cat-direct)",
  subagent: "var(--cat-delegated)",
  workflow: "var(--cat-workflow)",
  wait: "var(--cat-wait)",
  compact: "var(--text-tertiary)"
};

type KindCounts = Record<ReplayKind, number>;

function emptyKindCounts(): KindCounts {
  return {
    user: 0,
    llm: 0,
    tool: 0,
    subagent: 0,
    workflow: 0,
    wait: 0,
    compact: 0
  };
}

function countKinds(events: readonly ReplayEvent[]): KindCounts {
  const counts = emptyKindCounts();
  for (const event of events) counts[event.kind] += 1;
  return counts;
}

/** 92 秒 → 「1 分 32 秒」. Hours appear only when the pause actually has one. */
function formatPause(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (ms > 0 && totalSeconds === 0) return "不到 1 秒";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours} 小时 ${minutes} 分 ${seconds} 秒`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

function indexAtOrBefore(events: readonly ReplayEvent[], at: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (events[mid].at <= at) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * One 8 px mark per kind: shape carries the kind when the colour is lost
 * (grayscale, colour-blind, a screenshot printed in black and white).
 */
function KindShape({ kind, played }: { kind: ReplayKind; played: boolean }) {
  const hollow = !played;
  const fill = hollow ? "none" : "currentColor";
  const stroke = "currentColor";
  switch (kind) {
    case "user":
      return (
        <circle
          cx={4}
          cy={4}
          r={hollow ? 3.25 : 4}
          fill={fill}
          stroke={hollow ? stroke : "none"}
          strokeWidth={hollow ? 1.5 : 0}
        />
      );
    case "llm":
      return (
        <rect
          x={hollow ? 0.75 : 0}
          y={hollow ? 0.75 : 0}
          width={hollow ? 6.5 : 8}
          height={hollow ? 6.5 : 8}
          rx={1}
          fill={fill}
          stroke={hollow ? stroke : "none"}
          strokeWidth={hollow ? 1.5 : 0}
        />
      );
    case "tool":
      return (
        <rect
          x={hollow ? 3.25 : 2.5}
          y={hollow ? 0.75 : 0}
          width={hollow ? 1.5 : 3}
          height={hollow ? 6.5 : 8}
          rx={1}
          fill={fill}
          stroke={hollow ? stroke : "none"}
          strokeWidth={hollow ? 1.5 : 0}
        />
      );
    case "subagent":
      return (
        <>
          <circle
            cx={4}
            cy={2.3}
            r={hollow ? 1.25 : 2}
            fill={fill}
            stroke={hollow ? stroke : "none"}
            strokeWidth={hollow ? 1.5 : 0}
          />
          <circle
            cx={4}
            cy={5.7}
            r={hollow ? 1.25 : 2}
            fill={fill}
            stroke={hollow ? stroke : "none"}
            strokeWidth={hollow ? 1.5 : 0}
          />
        </>
      );
    case "workflow":
      return (
        <path
          d="M4 0.75 7.25 4 4 7.25 0.75 4Z"
          fill={hollow ? "none" : "currentColor"}
          stroke={stroke}
          strokeWidth={hollow ? 1.5 : 0.75}
        />
      );
    case "wait":
      return (
        <rect
          x={1}
          y={1}
          width={6}
          height={6}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        />
      );
    case "compact":
      return (
        <>
          <rect
            x={3.5}
            y={0}
            width={1}
            height={8}
            fill="none"
            stroke={stroke}
            strokeDasharray="2 2"
          />
          <rect x={0} y={0} width={8} height={2} fill={fill} stroke="none" />
        </>
      );
  }
}

/**
 * One 8 px mark per kind: shape carries the kind when the colour is lost
 * (grayscale, colour-blind, a screenshot printed in black and white).
 */
function KindGlyph({ kind, played = true }: { kind: ReplayKind; played?: boolean }) {
  return (
    <svg
      className={styles.glyph}
      width={8}
      height={8}
      viewBox="0 0 8 8"
      aria-hidden="true"
      focusable="false"
      style={{ color: KIND_COLOR[kind] }}
    >
      <KindShape kind={kind} played={played} />
    </svg>
  );
}

function Read({
  label,
  value,
  warning = false
}: {
  label: string;
  value: ReactNode;
  warning?: boolean;
}) {
  return (
    <span className={styles.read}>
      <span className={styles.readLabel}>{label}</span>{" "}
      <span className={warning ? styles.readValueWarning : styles.readValue}>{value}</span>
    </span>
  );
}

type DensityBin = {
  bin: number;
  count: number;
  kind: ReplayKind;
  error: boolean;
  firstAt: number;
  /** Only when the bin holds exactly one event, so it can keep its own shape. */
  event: ReplayEvent | null;
};

/**
 * Events collapse into one slot per 10 px of lane. Without this a 10k-row
 * session would mount 10k nodes every time the playhead moved; with it the
 * lane never exceeds ~`laneWidth / 10` glyphs or bars.
 */
function buildDensityBins(
  film: ReplayFilm,
  bins: number
): DensityBin[] {
  type Bucket = {
    count: number;
    kinds: KindCounts;
    error: boolean;
    firstAt: number;
    event: ReplayEvent | null;
  };
  const buckets = new Map<number, Bucket>();
  for (const event of film.events) {
    // Compaction is the cliff layer's job; a second glyph would double-count it.
    if (event.kind === "compact") continue;
    const position = progressAt(film, event.at, PLAYBACK_MODE);
    const bin = Math.min(bins - 1, Math.max(0, Math.floor(position * bins)));
    let bucket = buckets.get(bin);
    if (!bucket) {
      bucket = { count: 0, kinds: emptyKindCounts(), error: false, firstAt: event.at, event };
      buckets.set(bin, bucket);
    }
    bucket.count += 1;
    bucket.kinds[event.kind] += 1;
    bucket.error ||= event.isError;
    bucket.firstAt = Math.min(bucket.firstAt, event.at);
    if (bucket.count > 1) bucket.event = null;
  }

  const result: DensityBin[] = [];
  for (const [bin, bucket] of buckets) {
    let dominant: ReplayKind = "user";
    let best = -1;
    for (const kind of KIND_ORDER) {
      if (bucket.kinds[kind] > best) {
        best = bucket.kinds[kind];
        dominant = kind;
      }
    }
    result.push({
      bin,
      count: bucket.count,
      kind: dominant,
      error: bucket.error,
      firstAt: bucket.firstAt,
      event: bucket.count === 1 ? bucket.event : null
    });
  }
  return result.sort((a, b) => a.bin - b.bin);
}

/** Bar height by multiplicity: 2–3 → 4 px, 4–9 → 8, 10–29 → 12, ≥30 → 16. */
function densityHeight(count: number): number {
  if (count <= 3) return 4;
  if (count <= 9) return 8;
  if (count <= 29) return 12;
  return 16;
}

type SlotRange = { key: number; left: number; width: number };

/** Pause grooves between adjacent events, only when they are at least a pixel wide. */
function buildSlotRanges(film: ReplayFilm, laneWidth: number): SlotRange[] {
  const ranges: SlotRange[] = [];
  const width = laneWidth > 0 ? laneWidth : FALLBACK_LANE_WIDTH;
  for (let index = 0; index + 1 < film.events.length; index += 1) {
    const left = progressAt(film, film.events[index].at, PLAYBACK_MODE);
    const right = progressAt(film, film.events[index + 1].at, PLAYBACK_MODE);
    if ((right - left) * width < 1) continue;
    ranges.push({ key: index, left: left * 100, width: (right - left) * 100 });
  }
  return ranges;
}

/**
 * `true` → every tick that lands inside a pause of at least a minute is moved
 * to the pause's end. The lane map is untouched: the head jumps, the map's
 * positions do not move, and the speed reading stops being meaningful.
 */
function skipPauseResolver(
  film: ReplayFilm,
  enabled: boolean
): ((progress: number) => number) | undefined {
  if (!enabled) return undefined;
  const pauses: Array<{ start: number; end: number }> = [];
  for (let index = 0; index + 1 < film.events.length; index += 1) {
    const start = film.events[index].at;
    const end = film.events[index + 1].at;
    if (end - start >= SKIP_PAUSE_MS) pauses.push({ start, end });
  }
  if (pauses.length === 0) return undefined;
  return (progress: number) => {
    const at = realMsAt(film, progress, PLAYBACK_MODE);
    for (const pause of pauses) {
      if (at > pause.start && at < pause.end) return progressAt(film, pause.end, PLAYBACK_MODE);
    }
    return progress;
  };
}

function buildFilmSummary(film: ReplayFilm): string {
  const counts = countKinds(film.events);
  const kinds = KIND_ORDER.filter((kind) => counts[kind] > 0).map(
    (kind) => `${ROW_KIND_LABELS[kind]} ${counts[kind]}`
  );
  const pieces = [
    `本次会话墙钟 ${formatDuration(film.end - film.start)}，共 ${film.events.length} 条记录${
      kinds.length > 0 ? `：${kinds.join("，")}` : ""
    }。`
  ];
  const marks: string[] = [];
  for (const mark of film.marks) {
    if (mark.kind === "first-error") marks.push(`首次失败在 ${formatClock(mark.at, true)}`);
    else if (mark.kind === "costliest-minute") marks.push(`最烧一分钟在 ${formatClock(mark.at)}`);
    else if (mark.kind === "longest-gap") marks.push(`最长停顿 ${mark.detail}`);
    else if (mark.kind === "compact") marks.push(mark.label);
  }
  if (marks.length > 0) pieces.push(`${marks.join("；")}。`);
  pieces.push(`起点 ${formatClock(film.start, true)}，终点 ${formatClock(film.end, true)}。`);
  return pieces.join("");
}

function TransportIcon({ name, size = 16 }: { name: "start" | "prev" | "play" | "pause" | "next" | "end"; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "currentColor",
    "aria-hidden": true as const,
    focusable: "false" as const
  };
  switch (name) {
    case "start":
      return (
        <svg {...common}>
          <rect x="4" y="5" width="2" height="14" rx="1" />
          <path d="M20 5.6v12.8a1 1 0 0 1-1.53.85l-9.6-6.4a1 1 0 0 1 0-1.7l9.6-6.4A1 1 0 0 1 20 5.6Z" />
        </svg>
      );
    case "prev":
      return (
        <svg {...common}>
          <path d="M18 5.6v12.8a1 1 0 0 1-1.53.85l-9.6-6.4a1 1 0 0 1 0-1.7l9.6-6.4A1 1 0 0 1 18 5.6Z" />
        </svg>
      );
    case "play":
      return (
        <svg {...common}>
          <path d="M8 5.6v12.8a1 1 0 0 0 1.53.85l9.6-6.4a1 1 0 0 0 0-1.7l-9.6-6.4A1 1 0 0 0 8 5.6Z" />
        </svg>
      );
    case "pause":
      return (
        <svg {...common}>
          <rect x="6.5" y="5" width="4" height="14" rx="1" />
          <rect x="13.5" y="5" width="4" height="14" rx="1" />
        </svg>
      );
    case "next":
      return (
        <svg {...common}>
          <path d="M6 5.6v12.8a1 1 0 0 0 1.53.85l9.6-6.4a1 1 0 0 0 0-1.7l-9.6-6.4A1 1 0 0 0 6 5.6Z" />
        </svg>
      );
    case "end":
      return (
        <svg {...common}>
          <rect x="18" y="5" width="2" height="14" rx="1" />
          <path d="M4 5.6v12.8a1 1 0 0 0 1.53.85l9.6-6.4a1 1 0 0 0 0-1.7l-9.6-6.4A1 1 0 0 0 4 5.6Z" />
        </svg>
      );
  }
}

export function ReplayView({ parsed }: { parsed: ParsedSession }) {
  const rows = useMemo(
    () => buildLogRows(parsed.records, parsed.turns, parsed.compactEvents ?? []),
    [parsed]
  );
  const film = useMemo(() => buildReplayFilm(rows, parsed.records), [rows, parsed.records]);
  const rowById = useMemo(() => {
    const map = new Map<string, LogRow>();
    for (const row of rows) map.set(row.id, row);
    return map;
  }, [rows]);
  const samples = useMemo(() => contextSeriesOf(parsed.records), [parsed.records]);
  const peakContext = useMemo(
    () => samples.reduce((peak, sample) => Math.max(peak, sample.contextTokens), 0),
    [samples]
  );

  const [filmSeconds, setFilmSeconds] = useState<FilmSeconds>(DEFAULT_FILM_SECONDS);
  const [skipPauses, setSkipPauses] = useState(false);
  // The keyboard's step cursor: which event the reader asked to stand on.
  // Time alone cannot tell two events with the same timestamp apart, so a step
  // records the index explicitly; any free seek clears it and hands the stage
  // back to the clock.
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [laneWidth, setLaneWidth] = useState(FALLBACK_LANE_WIDTH);
  const laneRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const durationMs = Number(filmSeconds) * 1000;
  const resolveProgress = useMemo(
    () => skipPauseResolver(film, skipPauses),
    [film, skipPauses]
  );
  const clock = useReplayClock({ durationMs, resolveProgress });

  const span = film.end - film.start;
  const canPlay = film.events.length >= 2 && span > 0;
  const canStep = film.events.length >= 2;
  const zeroSpan = span === 0;

  // Progress is a float; the log's own clock is whole milliseconds. Rounding
  // keeps an event that was seeked to exactly from landing a hair before itself
  // and painting a 「停顿 0 秒」 frame.
  const realMs = Math.round(realMsAt(film, clock.progress, PLAYBACK_MODE));
  const frame = frameAt(film, realMs, samples, PLAYBACK_MODE);
  // While paused, a step cursor wins as long as the head still stands on that
  // event (±1 ms covers float noise from `progressAt`/`realMsAt`). Playback
  // never consults it: the film must run on the clock alone.
  const stepEvent = stepIndex !== null ? film.events[stepIndex] ?? null : null;
  const stepHolds =
    !clock.playing &&
    stepEvent !== null &&
    (zeroSpan || Math.abs(frame.at - stepEvent.at) <= 1);
  const stageIndex =
    stepIndex !== null && stepHolds ? stepIndex : indexAtOrBefore(film.events, frame.at);
  const stageEvent = stageIndex >= 0 ? film.events[stageIndex] : null;
  const passed: ReplayTotals =
    stageIndex >= 0 && film.cumulative[stageIndex]
      ? film.cumulative[stageIndex]
      : frame.passed;

  // A new session gets a fresh film; keeping the old progress would show a
  // different session's head position.
  const { seek: seekClock, pause: pauseClock } = clock;
  useEffect(() => {
    setStepIndex(null);
    pauseClock();
    seekClock(0);
  }, [film, pauseClock, seekClock]);

  // Playback must never inherit a step cursor: once the clock runs, it alone
  // decides which event is current.
  useEffect(() => {
    if (clock.playing) setStepIndex(null);
  }, [clock.playing]);

  // The lane is resized with the window; density bins follow its pixel width.
  useEffect(() => {
    const element = laneRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      if (width > 0) setLaneWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const binCount = Math.max(1, Math.floor(laneWidth / DENSITY_BIN_PX));
  const density = useMemo(() => buildDensityBins(film, binCount), [film, binCount]);
  const slots = useMemo(() => buildSlotRanges(film, laneWidth), [film, laneWidth]);
  const counts = useMemo(() => countKinds(film.events), [film.events]);
  const summary = useMemo(() => buildFilmSummary(film), [film]);

  const compactCliffs = useMemo(() => {
    if (peakContext <= 0) return [];
    const preTokensAt = new Map<number, number>();
    for (const compact of parsed.compactEvents ?? []) {
      if (compact.preTokens !== null) preTokensAt.set(compact.timestamp, compact.preTokens);
    }
    return film.events
      .filter((event) => event.kind === "compact")
      .map((event) => {
        const preTokens = preTokensAt.get(event.at);
        if (preTokens === undefined) return null;
        return { at: event.at, percent: clampPercent((preTokens / peakContext) * 100) };
      })
      .filter((cliff): cliff is { at: number; percent: number } => cliff !== null);
  }, [film.events, parsed.compactEvents, peakContext]);

  // Group marks that share an instant: at most two are drawn, the rest collapse
  // into 「+N」 so a noisy tick cannot bury the lane.
  const markGroups = useMemo(() => {
    const groups = new Map<number, ReplayMark[]>();
    for (const mark of film.marks) {
      if (mark.kind === "start") continue;
      const list = groups.get(mark.at);
      if (list) list.push(mark);
      else groups.set(mark.at, [mark]);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [film.marks]);

  // Stepping is by event index, never by timestamp: two events can share an
  // instant, and a time-based step would keep landing on the last of the tie.
  const stepTo = useCallback(
    (target: number) => {
      if (target < 0) {
        // One step before the first event is the same honest place as Home.
        setStepIndex(null);
        seekClock(0);
        return;
      }
      if (target >= film.events.length) return;
      // Mid-playback the clock stays the only source of truth, so a step must
      // not leave a cursor behind for the next pause to pick up.
      setStepIndex(clock.playing ? null : target);
      seekClock(progressAt(film, film.events[target].at, PLAYBACK_MODE));
    },
    [clock.playing, film.events, seekClock]
  );

  const goPrev = useCallback(() => {
    if (!canStep || stageIndex < 0) return;
    // A zero-span film has no "before the first instant" to stand on, so the
    // first event is where stepping back stops.
    if (zeroSpan) {
      stepTo(Math.max(0, stageIndex - 1));
      return;
    }
    // A head resting inside a pause stands on the pause's opening event;
    // stepping back from there should show that event, not skip it.
    const inPause = !stepHolds && frame.gap !== null;
    stepTo(inPause ? stageIndex : stageIndex - 1);
  }, [canStep, frame.gap, stageIndex, stepHolds, stepTo, zeroSpan]);

  const goNext = useCallback(() => {
    if (!canStep) return;
    stepTo(stageIndex + 1);
  }, [canStep, stageIndex, stepTo]);

  const goStart = useCallback(() => {
    setStepIndex(zeroSpan ? 0 : null);
    seekClock(0);
  }, [seekClock, zeroSpan]);

  const goEnd = useCallback(() => {
    // Landing on the last event by index keeps 「上一事件」 able to walk back
    // through events that share the film's final instant.
    setStepIndex(film.events.length > 0 ? film.events.length - 1 : null);
    seekClock(1);
  }, [film.events.length, seekClock]);

  const seekFromClientX = useCallback(
    (clientX: number, snapToBlock: boolean) => {
      const element = laneRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (!(rect.width > 0)) return;
      // A dense bin is one visual block for several events. Clicking the block
      // must land on its first event, not on whichever event happens to sit
      // under the exact pixel; dragging still follows the pointer.
      if (snapToBlock) {
        const blockRadius = Math.min(5, Math.max(3, rect.width / binCount / 2));
        const block = density.find((bin) => {
          const center = rect.left + ((bin.bin + 0.5) / binCount) * rect.width;
          return Math.abs(clientX - center) <= blockRadius;
        });
        if (block) {
          setStepIndex(null);
          seekClock(progressAt(film, block.event?.at ?? block.firstAt, PLAYBACK_MODE));
          return;
        }
      }
      const next = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      setStepIndex(null);
      seekClock(next);
    },
    [binCount, density, film, seekClock]
  );

  const onLanePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A mark is its own button; the lane must not steal its click or its focus.
    if (event.target instanceof HTMLElement && event.target.closest("button")) return;
    event.preventDefault();
    event.currentTarget.focus();
    draggingRef.current = true;
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    seekFromClientX(event.clientX, true);
  };

  const onLanePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    seekFromClientX(event.clientX, false);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onLaneKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
      // Unshifted arrows deliberately bubble to the view-level map.
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 0.01 : -0.01;
    setStepIndex(null);
    seekClock(clock.progress + step);
  };

  const toggleSkipPauses = () => {
    const next = !skipPauses;
    setSkipPauses(next);
    if (
      next &&
      !stepHolds &&
      frame.gap &&
      frame.gap.end - frame.gap.start >= SKIP_PAUSE_MS
    ) {
      setStepIndex(null);
      seekClock(progressAt(film, frame.gap.end, PLAYBACK_MODE));
    }
  };

  const onViewKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const tag = target?.tagName;
    const inField =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target?.isContentEditable === true;

    if (event.key === " " || event.key === "Spacebar") {
      // A focused button already turns Space into a click. Handling it here too
      // would run the action twice and look like "pressing space did nothing".
      if (inField || target?.closest("button, a, [role='tab'], [role='radio']")) return;
      event.preventDefault();
      clock.toggle();
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      if (event.shiftKey || inField) return;
      if (target?.closest("[role='tablist'], [role='radiogroup']")) return;
      event.preventDefault();
      if (event.key === "ArrowLeft") goPrev();
      else goNext();
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (inField || target?.closest("[role='tablist'], [role='radiogroup']")) return;
      event.preventDefault();
      if (event.key === "Home") goStart();
      else goEnd();
    }
  };

  const pauseText =
    frame.gap !== null && !stepHolds
      ? `停顿中（${formatClock(frame.gap.start, true)} 至 ${formatClock(
          frame.gap.end,
          true
        )}，${formatPause(frame.gap.end - frame.gap.start)}）`
      : "";

  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (clock.playing) {
      setAnnouncement("播放中，暂停后会播报当前位置");
      return;
    }
    if (!stageEvent) {
      setAnnouncement("播放头在第一个事件之前");
      return;
    }
    if (pauseText) {
      setAnnouncement(`${formatClock(stageEvent.at, true)}，${pauseText}`);
      return;
    }
    setAnnouncement(
      `${formatClock(stageEvent.at, true)} · ${stageEvent.label}${
        stageEvent.detail ? ` · ${stageEvent.detail}` : ""
      }`
    );
  }, [clock.playing, pauseText, stageEvent]);

  if (film.events.length === 0) {
    return (
      <div className={styles.replay} data-probe="replay-root" onKeyDown={onViewKeyDown}>
        <section className={styles.screen} aria-label="重放舞台">
          <div className={styles.stage}>
            <EmptyState
              size="panel"
              title="这次会话没有可播放的记录"
              description="日志里没有任何能定位到时刻的记录。"
            />
          </div>
        </section>
      </div>
    );
  }

  const headPercent = clampPercent(clock.progress * 100);
  const endOfFilm = clock.ended;

  const sameTick = (() => {
    if (!stageEvent) return null;
    let first = stageIndex;
    while (first > 0 && film.events[first - 1].at === stageEvent.at) first -= 1;
    let last = stageIndex;
    while (last + 1 < film.events.length && film.events[last + 1].at === stageEvent.at) last += 1;
    if (last === first) return null;
    return { position: stageIndex - first + 1, count: last - first + 1 };
  })();

  const stageNote = (() => {
    if (film.events.length === 1) return "只有 1 条记录，没有时间跨度可播放。";
    if (zeroSpan) {
      return `${film.events.length} 条记录都在同一时刻（${formatClock(
        film.start,
        true
      )}），没有时间跨度可播放。`;
    }
    if (film.events.every((event) => event.at === film.events[0].at)) {
      return `${film.events.length} 条记录都在 ${formatClock(
        film.events[0].at,
        true
      )}，其余时间没有事件。`;
    }
    return null;
  })();

  const cardAction = stageEvent ? rowById.get(stageEvent.rowId)?.action ?? "" : "";
  const cardLabel = stageEvent ? cardAction || stageEvent.label : "";
  const stageKind = stageEvent?.kind ?? null;

  const costText =
    passed.costUsd !== null
      ? formatUsd(passed.costUsd)
      : passed.costUnknownEvents > 0
        ? "定价未知"
        : "—";
  const costNote =
    passed.costUnknownEvents > 0
      ? passed.costUsd === null
        ? "未收录该模型定价"
        : `另有 ${passed.costUnknownEvents} 条事件未计价`
      : "";
  const tokensMissing = passed.tokensPrompt === 0 && passed.tokensOutput === 0;
  const tokenNote =
    passed.eventsWithoutUsage > 0 ? `${passed.eventsWithoutUsage} 个调用没有 token 读数` : "";

  const currentContext = frame.context?.tokens ?? null;
  const waterPercent =
    currentContext !== null && peakContext > 0
      ? clampPercent((currentContext / peakContext) * 100)
      : 0;

  const speed =
    canPlay && durationMs > 0 ? span / durationMs : null;
  const speedText =
    speed === null
      ? null
      : `约 ${speed >= 10 ? Math.round(speed) : speed.toFixed(1)}×，${filmSeconds} 秒看完`;

  // Both buttons follow the step cursor's unit (events, not instants).
  const canPrev = canStep && stageIndex >= 0;
  const canNext = canStep && stageIndex < film.events.length - 1;

  const filmSecondItems: SegmentedItem<FilmSeconds>[] = FILM_SECONDS.map((value) => ({
    value,
    label: `${value}s`,
    disabled: !canPlay,
    title: canPlay ? undefined : "这条会话没有时间跨度可播放"
  }));

  const valueText = (() => {
    if (frame.gap && !stepHolds) {
      return `${formatClock(frame.at, true)}，${pauseText}`;
    }
    if (!stageEvent) return `${formatClock(film.start, true)}，第一个事件之前`;
    return `${formatClock(stageEvent.at, true)}，第 ${stageIndex + 1} / ${
      film.events.length
    } 条，${stageEvent.label}${stageEvent.detail ? `，${stageEvent.detail}` : ""}`;
  })();

  return (
    <div className={styles.replay} data-probe="replay-root" onKeyDown={onViewKeyDown}>
      <section className={styles.screen} aria-label="重放舞台">
        <div className={styles.stage} data-probe="replay-stage">
          {frame.gap && !stepHolds && stageEvent ? (
            <div className={styles.pause}>
              <h3 className={styles.pauseTitle}>停顿 {formatPause(frame.gap.end - frame.gap.start)}</h3>
              <p className={styles.pauseRow}>
                上一条 · {formatClock(stageEvent.at, true)} · {stageEvent.label}
                {cardAction ? ` · ${cardAction}` : ""}
                {stageEvent.detail ? ` · ${stageEvent.detail}` : ""}
              </p>
              {(() => {
                const nextIndex = stageIndex + 1;
                const next = film.events[nextIndex];
                if (!next) return null;
                const nextAction = rowById.get(next.rowId)?.action ?? "";
                return (
                  <p className={styles.pauseRow}>
                    下一条 · {formatClock(next.at, true)} · {next.label}
                    {nextAction ? ` · ${nextAction}` : ""}
                    {next.detail ? ` · ${next.detail}` : ""}
                  </p>
                );
              })()}
              <p className={styles.pauseNote}>这两条之间没有任何记录。</p>
            </div>
          ) : stageEvent ? (
            <article
              className={styles.card}
              data-kind={stageKind ?? undefined}
              data-error={stageEvent.isError}
            >
              <div className={styles.cardHead}>
                <span className={styles.kindChip}>
                  <KindGlyph kind={stageEvent.kind} played />
                  {stageEvent.label}
                </span>
                <span className={styles.position}>
                  第 {stageIndex + 1} / {film.events.length} 条
                </span>
                {sameTick ? (
                  <span className={styles.sameTick}>
                    同刻 {sameTick.position} / {sameTick.count}
                  </span>
                ) : null}
              </div>
              <h3 className={styles.cardLabel}>{cardLabel}</h3>
              {stageEvent.detail ? <p className={styles.cardDetail}>{stageEvent.detail}</p> : null}
              <div className={styles.cardFoot}>
                <span>{formatClock(stageEvent.at, true)}</span>
                {stageEvent.durationMs !== null && stageEvent.durationMs > 0 ? (
                  <span>时长 {formatDuration(stageEvent.durationMs)}</span>
                ) : null}
              </div>
              {stageEvent.isError ? <p className={styles.errorLine}>失败</p> : null}
              {endOfFilm ? (
                <p className={styles.endNote}>
                  重放结束 · 共 {film.events.length} 条 · 墙钟 {formatDuration(span)}
                </p>
              ) : null}
            </article>
          ) : (
            <div className={styles.pause}>
              <h3 className={styles.pauseTitle}>还没有事件</h3>
              <p className={styles.pauseNote}>播放头在第一个事件之前。</p>
            </div>
          )}
          {stageNote ? <p className={styles.stageNote}>{stageNote}</p> : null}
        </div>

        <div className={styles.reads} data-probe="replay-reads">
          <div className={styles.readRow}>
            <span className={styles.groupLabel}>已播放</span>
            <Read label="消息" value={passed.events} />
            <Read label="工具" value={passed.tools} />
            <Read label="错误" value={passed.errors} />
            <Read label="压缩" value={passed.compactions} />
            <Read label="prompt" value={tokensMissing ? "—" : formatTokenCount(passed.tokensPrompt)} />
            <Read label="output" value={tokensMissing ? "—" : formatTokenCount(passed.tokensOutput)} />
            {tokenNote ? <span className={styles.tokenNote}>{tokenNote}</span> : null}
            <Read label="成本" value={costText} warning={passed.costUnknownEvents > 0} />
            {costNote ? <span className={styles.costNote}>{costNote}</span> : null}
          </div>

          <div className={styles.water}>
            <span className={styles.waterLabel}>上下文</span>
            <div
              className={styles.waterTrack}
              role="img"
              aria-label={
                currentContext === null
                  ? "本段没有可核对的上下文读数"
                  : `上下文 ${formatTokenCount(currentContext)}，峰值 ${formatTokenCount(
                      peakContext
                    )}`
              }
            >
              {currentContext !== null && peakContext > 0 ? (
                <span className={styles.waterFill} style={{ width: `${waterPercent}%` }} />
              ) : null}
              {compactCliffs.map((cliff, index) => (
                <span
                  key={`${cliff.at}:${index}`}
                  className={styles.waterCliff}
                  data-passed={cliff.at <= frame.at}
                  style={{ left: `${cliff.percent}%` }}
                />
              ))}
              {currentContext !== null && peakContext > 0 ? (
                <span className={styles.waterNotch} style={{ left: `${waterPercent}%` }} />
              ) : null}
              {currentContext === null ? (
                <span className={styles.waterEmpty}>本段没有可核对的上下文读数</span>
              ) : null}
            </div>
            <span className={styles.waterValue}>
              {currentContext === null ? "—" : formatTokenCount(currentContext)} / 峰值{" "}
              {peakContext > 0 ? formatTokenCount(peakContext) : "—"}
            </span>
          </div>
        </div>
      </section>

      <section className={styles.reel} aria-label="会话胶片">
        <div className={styles.film} data-probe="replay-film">
          <p className={styles.srOnly}>{summary}</p>
          <div className={styles.legend} aria-hidden="true">
            {KIND_ORDER.filter((kind) => counts[kind] > 0).map((kind) => (
              <span key={kind} className={styles.legendItem}>
                <KindGlyph kind={kind} />
                <span>{ROW_KIND_LABELS[kind]}</span>
                <span className={styles.legendCount}>{counts[kind]}</span>
              </span>
            ))}
          </div>

          <div
            ref={laneRef}
            className={styles.lane}
            role="slider"
            tabIndex={0}
            aria-label="重放进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(clock.progress * 100)}
            aria-valuetext={valueText}
            data-probe="replay-lane"
            onPointerDown={onLanePointerDown}
            onPointerMove={onLanePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onLaneKeyDown}
          >
            <div className={styles.dense} aria-hidden="true">
              {density.map((bin) => {
                const left = ((bin.bin + 0.5) / binCount) * 100;
                const played = bin.firstAt <= frame.at;
                if (bin.event) {
                  return (
                    <span
                      key={bin.bin}
                      data-bin={bin.bin}
                      className={styles.binGlyph}
                      style={{ left: `${left}%` }}
                    >
                      <KindGlyph kind={bin.event.kind} played={played} />
                    </span>
                  );
                }
                return (
                  <span
                    key={bin.bin}
                    data-bin={bin.bin}
                    data-density={densityHeight(bin.count)}
                    className={styles.binBar}
                    style={{
                      left: `${left}%`,
                      height: `${densityHeight(bin.count)}px`,
                      backgroundColor: played ? KIND_COLOR[bin.kind] : "transparent",
                      borderColor: KIND_COLOR[bin.kind]
                    }}
                  />
                );
              })}
            </div>

            <div className={styles.errorTicks} aria-hidden="true">
              {density
                .filter((bin) => bin.error)
                .map((bin) => (
                  <span
                    key={bin.bin}
                    data-error-bin={bin.bin}
                    className={styles.errorTick}
                    style={{ left: `${((bin.bin + 0.5) / binCount) * 100}%` }}
                  />
                ))}
            </div>

            <div className={styles.slots} aria-hidden="true">
              {slots.map((slot) => (
                <span
                  key={slot.key}
                  className={styles.slot}
                  style={{ left: `${slot.left}%`, width: `${slot.width}%` }}
                />
              ))}
            </div>

            <div className={styles.cliffs} aria-hidden="true">
              {compactCliffs.map((cliff, index) => (
                <span
                  key={`${cliff.at}:${index}`}
                  className={styles.cliff}
                  data-passed={cliff.at <= frame.at}
                  style={{
                    left: `${clampPercent(progressAt(film, cliff.at, PLAYBACK_MODE) * 100)}%`
                  }}
                />
              ))}
            </div>

            <div className={styles.marks}>
              {markGroups.flatMap(([at, marks]) => {
                const left = `${clampPercent(progressAt(film, at, PLAYBACK_MODE) * 100)}%`;
                const drawn = marks.length > 2 ? marks.slice(0, 2) : marks;
                const merged = marks.length - drawn.length;
                const nodes = drawn.map((mark) => (
                  <MarkButton
                    key={mark.id}
                    mark={mark}
                    left={left}
                    laneWidth={laneWidth}
                    film={film}
                    onSeek={(target) => {
                      setStepIndex(null);
                      seekClock(progressAt(film, target, PLAYBACK_MODE));
                    }}
                  />
                ));
                if (merged > 0) {
                  const labels = marks.slice(drawn.length).map((mark) => mark.label);
                  nodes.push(
                    <button
                      key={`merged:${at}`}
                      type="button"
                      className={`${styles.mark} ${styles.markMerged}`}
                      style={{ left }}
                      aria-label={`合并跃点：${labels.join("、")}`}
                      title={labels.join("、")}
                      onClick={() => {
                        setStepIndex(null);
                        seekClock(progressAt(film, at, PLAYBACK_MODE));
                      }}
                    >
                      <span className={styles.mergedText}>+{merged}</span>
                    </button>
                  );
                }
                return nodes;
              })}
            </div>

            <div
              className={styles.head}
              data-probe="replay-head"
              aria-hidden="true"
              style={{ left: `${Math.min(headPercent, 100 - (2 / Math.max(laneWidth, 1)) * 100)}%` }}
            />
          </div>

          <div className={styles.axis} aria-hidden="true">
            {zeroSpan ? (
              <span className={styles.axisSingle}>{formatClock(film.start, true)}</span>
            ) : (
              <>
                <span className={styles.axisStart}>{formatClock(film.start, true)}</span>
                <span className={styles.axisMid}>
                  {formatClock(film.start + span / 2, true)}
                </span>
                <span className={styles.axisEnd}>{formatClock(film.end, true)}</span>
              </>
            )}
          </div>
        </div>

        <div className={styles.transport} data-probe="replay-transport">
          <div className={styles.transportGroup}>
            <IconButton label="跳到开头" onClick={goStart} disabled={!canStep}>
              <TransportIcon name="start" />
            </IconButton>
            <IconButton label="上一事件" onClick={goPrev} disabled={!canPrev}>
              <TransportIcon name="prev" />
            </IconButton>
            <Button
              variant="primary"
              onClick={clock.toggle}
              disabled={!canPlay}
              aria-label={clock.playing ? "暂停" : "播放"}
            >
              <TransportIcon name={clock.playing ? "pause" : "play"} />
              {clock.playing ? "暂停" : "播放"}
            </Button>
            <IconButton label="下一事件" onClick={goNext} disabled={!canNext}>
              <TransportIcon name="next" />
            </IconButton>
            <IconButton label="跳到结尾" onClick={goEnd} disabled={!canStep}>
              <TransportIcon name="end" />
            </IconButton>
          </div>

          <div className={styles.transportGroup}>
            <span className={styles.transportLabel}>片长</span>
            <SegmentedControl
              items={filmSecondItems}
              value={filmSeconds}
              onChange={setFilmSeconds}
              ariaLabel="片长"
              role="radiogroup"
            />
          </div>

          <button
            type="button"
            className={styles.gapSwitch}
            aria-pressed={skipPauses}
            onClick={toggleSkipPauses}
            disabled={!canPlay}
            title="跳过停顿后播放头不再等速移动，倍速读数不适用"
          >
            跳过停顿
          </button>

          {speedText ? (
            <span className={skipPauses ? `${styles.speed} ${styles.speedWarning}` : styles.speed}>
              {skipPauses ? "空档已跳过，时间轴不再等速" : speedText}
            </span>
          ) : (
            <span className={styles.speed}>没有时间跨度</span>
          )}
        </div>
      </section>

      <p className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

function MarkButton({
  mark,
  left,
  laneWidth,
  film,
  onSeek
}: {
  mark: ReplayMark;
  left: string;
  laneWidth: number;
  film: ReplayFilm;
  onSeek: (at: number) => void;
}) {
  if (mark.kind === "start") return null;

  if (mark.kind === "costliest-minute") {
    const start = progressAt(film, mark.at, PLAYBACK_MODE);
    const end = progressAt(film, mark.at + 60_000, PLAYBACK_MODE);
    const width = Math.max(8, (end - start) * Math.max(laneWidth, 1));
    return (
      <button
        type="button"
        className={`${styles.mark} ${styles.markCostliest}`}
        style={{ left, width: `${width}px` }}
        aria-label={`${mark.label} · ${mark.detail}`}
        title={`${mark.label} · ${mark.detail}`}
        onClick={() => onSeek(mark.at)}
      >
        <span className={styles.markBand} />
      </button>
    );
  }

  if (mark.kind === "longest-gap") {
    const next = film.events.find((event) => event.at > mark.at);
    const end = next?.at ?? mark.at;
    const width = Math.max(
      12,
      (progressAt(film, end, PLAYBACK_MODE) - progressAt(film, mark.at, PLAYBACK_MODE)) *
        Math.max(laneWidth, 1)
    );
    return (
      <button
        type="button"
        className={`${styles.mark} ${styles.markGap}`}
        style={{ left, width: `${width}px` }}
        aria-label={`${mark.label} · ${mark.detail}`}
        title={`${mark.label} · ${mark.detail}`}
        onClick={() => onSeek(mark.at)}
      >
        <span className={styles.markGapLine} />
      </button>
    );
  }

  if (mark.kind === "compact") {
    return (
      <button
        type="button"
        className={`${styles.mark} ${styles.markCompact}`}
        style={{ left }}
        aria-label={`${mark.label} · ${mark.detail}`}
        title={`${mark.label} · ${mark.detail}`}
        onClick={() => onSeek(mark.at)}
      >
        <span className={styles.markCliffBar} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`${styles.mark} ${styles.markError}`}
      style={{ left }}
      aria-label={`${mark.label} · ${mark.detail}`}
      title={`${mark.label} · ${mark.detail}`}
      onClick={() => onSeek(mark.at)}
    >
      <span className={styles.markDiamond} />
    </button>
  );
}
