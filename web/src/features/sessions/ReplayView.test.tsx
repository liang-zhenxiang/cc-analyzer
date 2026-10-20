import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompactEvent, ParsedSession, SessionRecord, SessionUsage } from "./types";
import { ReplayView } from "./ReplayView";

/** A fixed wall clock so the axis labels are readable assertions, not "now". */
const T0 = new Date(2026, 0, 1, 10, 42, 0).getTime();
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

function userRecord(id: string, at: number, text: string): SessionRecord {
  return recordOf({ id, fullId: id, kind: "user", timestamp: at, text });
}

function toolRecord(
  id: string,
  at: number,
  spec: { command: string; isError?: boolean; durationMs?: number }
): SessionRecord {
  return recordOf({
    id,
    fullId: id,
    kind: "tool",
    timestamp: at,
    durationMs: spec.durationMs ?? 0,
    isError: spec.isError ?? false,
    toolName: "Bash",
    toolInput: { command: spec.command }
  });
}

function assistantRecord(
  id: string,
  at: number,
  spec: { model?: string; usage?: SessionUsage; text?: string }
): SessionRecord {
  return recordOf({
    id,
    fullId: id,
    kind: "assistant",
    timestamp: at,
    model: spec.model ?? SONNET,
    usage: spec.usage,
    text: spec.text ?? ""
  });
}

function parsedOf(
  records: SessionRecord[],
  compactEvents: CompactEvent[] = []
): ParsedSession {
  const timestamps = records.map((record) => record.timestamp);
  const start = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const end = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  return {
    sessionId: "session-replay",
    path: "/tmp/session-replay.jsonl",
    startedAt: start,
    endedAt: end,
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    compactEvents,
    sidechainMessages: []
  };
}

/**
 * 10:42:00 user → 10:42:20 failing Bash → 10:42:30 model call → 10:43:00 model call.
 * Total: 4 events, $0.60, prompt 150,000, output 10,000, peak context 100,000.
 */
function standardParsed(): ParsedSession {
  return parsedOf([
    userRecord("u1", T0, "帮我把重放的舞台搭起来"),
    toolRecord("t1", T0 + 20_000, {
      command: "npm test",
      isError: true,
      durationMs: 2500
    }),
    assistantRecord("a1", T0 + 30_000, {
      usage: { inputTokens: 100_000, outputTokens: 10_000 },
      text: "先把舞台拆成三块。"
    }),
    assistantRecord("a2", T0 + 60_000, {
      usage: { inputTokens: 50_000, outputTokens: 0 },
      text: "然后接上传送带。"
    })
  ]);
}

function stageCard(): HTMLElement {
  return screen.getByLabelText("重放舞台");
}

function readText(label: string): string {
  const labelNode = within(stageCard()).getByText(label);
  return (labelNode.parentElement?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function lane(): HTMLElement {
  return screen.getByRole("slider", { name: "重放进度" });
}

function mockLaneWidth(width: number): void {
  const element = lane();
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: 48,
    width,
    height: 48,
    toJSON: () => ({})
  } as DOMRect);
}

function clickLaneAt(fraction: number, width = 3000): void {
  mockLaneWidth(width);
  fireEvent.pointerDown(lane(), {
    clientX: fraction * width,
    button: 0,
    pointerId: 1,
    pointerType: "mouse"
  });
  fireEvent.pointerUp(lane(), { pointerId: 1, pointerType: "mouse" });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, "visibilityState");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ReplayView — honest states", () => {
  it("states there is nothing to replay when the session has no records", () => {
    render(<ReplayView parsed={parsedOf([])} />);

    expect(screen.getByText("这次会话没有可播放的记录")).toBeInTheDocument();
    expect(screen.getByText("日志里没有任何能定位到时刻的记录。")).toBeInTheDocument();
    expect(screen.queryByLabelText("会话胶片")).not.toBeInTheDocument();
  });

  it("says a single record has no span and disables the transport", () => {
    render(<ReplayView parsed={parsedOf([userRecord("u1", T0, "唯一一条")])} />);

    expect(screen.getByText("只有 1 条记录，没有时间跨度可播放。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "跳到开头" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一事件" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "跳过停顿" })).toBeDisabled();
  });

  it("keeps every record visible for a zero-span session and steps without playing", () => {
    render(
      <ReplayView
        parsed={parsedOf([
          userRecord("u1", T0, "第一条"),
          userRecord("u2", T0, "第二条")
        ])}
      />
    );

    expect(
      screen.getByText("2 条记录都在同一时刻（10:42:00），没有时间跨度可播放。")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "播放" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一事件" })).toBeEnabled();
    expect(screen.getByText("第 2 / 2 条")).toBeInTheDocument();
    expect(screen.getByText("同刻 2 / 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上一事件" }));

    expect(screen.getByText("第 1 / 2 条")).toBeInTheDocument();
    expect(screen.getByText("同刻 1 / 2")).toBeInTheDocument();
    expect(readText("消息")).toBe("消息 1");
  });

  it("prints 定价未知 and the unknown-pricing note when the model is not in the price table", () => {
    render(
      <ReplayView
        parsed={parsedOf([
          userRecord("u1", T0, "问一句"),
          assistantRecord("a1", T0 + 10_000, {
            model: "kimi-k2",
            usage: { inputTokens: 1_000, outputTokens: 100 },
            text: "答一句"
          })
        ])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "跳到结尾" }));

    expect(readText("成本")).toBe("成本 定价未知");
    expect(within(stageCard()).getByText("未收录该模型定价")).toBeInTheDocument();
    expect(readText("prompt")).toBe("prompt 1,000");
    expect(readText("output")).toBe("output 100");
  });
});

describe("ReplayView — readings and the stage", () => {
  it("shows the frame the head is standing on with exact totals", () => {
    render(<ReplayView parsed={standardParsed()} />);

    expect(readText("消息")).toBe("消息 1");
    expect(readText("prompt")).toBe("prompt —");
    expect(readText("成本")).toBe("成本 —");
    expect(
      within(stageCard()).getByText("本段没有可核对的上下文读数")
    ).toBeInTheDocument();

    // Half of a 60 s film is exactly 10:42:30 — the second model call.
    clickLaneAt(0.5);

    expect(lane()).toHaveAttribute("aria-valuenow", "50");
    expect(
      lane().getAttribute("aria-valuetext")
    ).toBe("10:42:30，第 3 / 4 条，LLM，先把舞台拆成三块。");
    expect(within(stageCard()).getByText("第 3 / 4 条")).toBeInTheDocument();
    expect(within(stageCard()).getByText("10:42:30")).toBeInTheDocument();
    expect(readText("消息")).toBe("消息 3");
    expect(readText("工具")).toBe("工具 1");
    expect(readText("错误")).toBe("错误 1");
    expect(readText("压缩")).toBe("压缩 0");
    expect(readText("prompt")).toBe("prompt 100,000");
    expect(readText("output")).toBe("output 10,000");
    expect(readText("成本")).toBe("成本 $0.45");
    expect(within(stageCard()).getByText("100,000 / 峰值 100,000")).toBeInTheDocument();
  });

  it("renders a pause between two events instead of inventing one", () => {
    render(<ReplayView parsed={standardParsed()} />);

    clickLaneAt(0.75);

    expect(within(stageCard()).getByText("停顿 30 秒")).toBeInTheDocument();
    expect(
      within(stageCard()).getByText(
        "上一条 · 10:42:30 · LLM · claude-sonnet-4-5-20250929 · 先把舞台拆成三块。"
      )
    ).toBeInTheDocument();
    expect(
      within(stageCard()).getByText(
        "下一条 · 10:43:00 · LLM · claude-sonnet-4-5-20250929 · 然后接上传送带。"
      )
    ).toBeInTheDocument();
    expect(within(stageCard()).getByText("这两条之间没有任何记录。")).toBeInTheDocument();
    expect(lane()).toHaveAttribute(
      "aria-valuetext",
      "10:42:45，停顿中（10:42:30 至 10:43:00，30 秒）"
    );
    // No event card while standing between events.
    expect(stageCard().querySelector("article")).toBeNull();
  });

  it("shows the end-of-film line with the wall clock", () => {
    render(<ReplayView parsed={standardParsed()} />);

    fireEvent.click(screen.getByRole("button", { name: "跳到结尾" }));

    expect(within(stageCard()).getByText("重放结束 · 共 4 条 · 墙钟 1m0s")).toBeInTheDocument();
    expect(readText("成本")).toBe("成本 $0.60");
    expect(readText("prompt")).toBe("prompt 150,000");
    expect(readText("output")).toBe("output 10,000");
    expect(lane()).toHaveAttribute("aria-valuenow", "100");
  });
});

describe("ReplayView — playback and the film", () => {
  it("toggles play/pause and stops advancing while paused", () => {
    vi.useFakeTimers();
    render(<ReplayView parsed={standardParsed()} />);

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("播放中，暂停后会播报当前位置");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(lane()).toHaveAttribute("aria-valuenow", "50");

    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(lane()).toHaveAttribute("aria-valuenow", "50");
  });

  it("pauses playback when the document is hidden", () => {
    vi.useFakeTimers();
    render(<ReplayView parsed={standardParsed()} />);

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden"
    });
    fireEvent(document, new Event("visibilitychange"));

    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(lane()).toHaveAttribute("aria-valuenow", "0");
  });

  it("never autoplays, even when reduced motion is requested", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    render(<ReplayView parsed={standardParsed()} />);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "0");
    expect(readText("消息")).toBe("消息 1");
  });

  it("jumps the head to a mark instead of restarting the film", () => {
    render(<ReplayView parsed={standardParsed()} />);

    const mark = screen.getByRole("button", { name: "首次失败 · 工具 · npm test" });
    mark.focus();
    fireEvent.click(mark);
    expect(document.activeElement).toBe(mark);

    expect(lane()).toHaveAttribute("aria-valuenow", "33");
    expect(within(stageCard()).getByText("第 2 / 4 条")).toBeInTheDocument();
    expect(within(stageCard()).getByText("10:42:20")).toBeInTheDocument();
    expect(readText("错误")).toBe("错误 1");
    expect(readText("成本")).toBe("成本 —");
  });

  it("seeks when the film is clicked and follows a drag", () => {
    render(<ReplayView parsed={standardParsed()} />);

    clickLaneAt(0.5);
    expect(within(stageCard()).getByText("第 3 / 4 条")).toBeInTheDocument();

    mockLaneWidth(3000);
    fireEvent.pointerDown(lane(), {
      clientX: 1500,
      button: 0,
      pointerId: 2,
      pointerType: "mouse"
    });
    fireEvent.pointerMove(lane(), { clientX: 2250, pointerId: 2, pointerType: "mouse" });
    fireEvent.pointerUp(lane(), { pointerId: 2, pointerType: "mouse" });

    expect(within(stageCard()).getByText("停顿 30 秒")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "75");
  });

  it("skips pauses of at least a minute and says the axis is no longer isochronous", () => {
    vi.useFakeTimers();
    render(
      <ReplayView
        parsed={parsedOf([
          userRecord("u1", T0, "开始"),
          assistantRecord("a1", T0 + 120_000, {
            usage: { inputTokens: 1_000, outputTokens: 100 },
            text: "两分钟后"
          }),
          assistantRecord("a2", T0 + 130_000, {
            usage: { inputTokens: 1_000, outputTokens: 100 },
            text: "再十秒"
          })
        ])}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "跳过停顿" }));
    expect(screen.getByText("空档已跳过，时间轴不再等速")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    act(() => {
      vi.advanceTimersByTime(40);
    });

    // The first tick inside the two-minute hole lands on its end: 10:44:00.
    expect(within(stageCard()).getByText("10:44:00")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "92");
  });

  it("aggregates dense logs into one glyph or bar per 10 px, not one node per event", () => {
    const records: SessionRecord[] = [];
    for (let index = 0; index < 5_000; index += 1) {
      records.push(userRecord(`u${index}`, T0 + index * 10, `消息 ${index}`));
    }
    const { container } = render(<ReplayView parsed={parsedOf(records)} />);

    const bins = container.querySelectorAll("[data-bin]");
    expect(bins).toHaveLength(107);
    expect(bins[0].getAttribute("data-density")).toBe("16");
    expect(container.querySelectorAll("*").length).toBeLessThan(400);

    expect(within(stageCard()).getByText("第 1 / 5000 条")).toBeInTheDocument();

    // Every 10 px block holds ~47 events; clicking block 50 lands on that
    // block's first event (t = 23,360 ms → event 2337), not on the event under
    // the exact pixel (that would be 2360).
    mockLaneWidth(1074);
    fireEvent.pointerDown(lane(), {
      clientX: 507,
      button: 0,
      pointerId: 3,
      pointerType: "mouse"
    });
    expect(within(stageCard()).getByText("第 2337 / 5000 条")).toBeInTheDocument();
  });
});

describe("ReplayView — keyboard", () => {
  function root(): HTMLElement {
    const node = document.querySelector("[data-probe='replay-root']");
    if (!(node instanceof HTMLElement)) throw new Error("replay root missing");
    return node;
  }

  it("steps events with ←/→ and jumps with Home/End", () => {
    render(<ReplayView parsed={standardParsed()} />);

    expect(within(stageCard()).getByText("第 1 / 4 条")).toBeInTheDocument();

    fireEvent.keyDown(root(), { key: "ArrowRight" });
    expect(within(stageCard()).getByText("第 2 / 4 条")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "33");

    fireEvent.keyDown(root(), { key: "ArrowRight" });
    expect(within(stageCard()).getByText("第 3 / 4 条")).toBeInTheDocument();

    fireEvent.keyDown(root(), { key: "ArrowLeft" });
    expect(within(stageCard()).getByText("第 2 / 4 条")).toBeInTheDocument();

    fireEvent.keyDown(root(), { key: "End" });
    expect(within(stageCard()).getByText("第 4 / 4 条")).toBeInTheDocument();
    expect(within(stageCard()).getByText("重放结束 · 共 4 条 · 墙钟 1m0s")).toBeInTheDocument();

    fireEvent.keyDown(root(), { key: "Home" });
    expect(within(stageCard()).getByText("第 1 / 4 条")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "0");
  });

  it("plays with Space and does not double-fire when a button already has focus", () => {
    vi.useFakeTimers();
    render(<ReplayView parsed={standardParsed()} />);

    const play = screen.getByRole("button", { name: "播放" });
    fireEvent.keyDown(play, { key: " " });

    // A focused button turns Space into a click on its own; the container must
    // stay out of the way, otherwise Space looks like it did nothing.
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "0");

    fireEvent.keyDown(root(), { key: " " });
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(lane()).toHaveAttribute("aria-valuenow", "50");

    fireEvent.keyDown(root(), { key: " " });
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
  });

  // Defect A (browser repro, /repo/errors): after Home the head sits before the
  // first event, and a time-based 「next」 stepped onto the last event of the
  // first instant — the first event card could never be reached.
  it("steps onto the first event from before it, even when two events share an instant", () => {
    render(
      <ReplayView
        parsed={parsedOf([
          // A filtered compact summary keeps `film.start` before the first row
          // without producing an event of its own, exactly like a real log.
          recordOf({
            id: "c1",
            fullId: "c1",
            kind: "user",
            timestamp: T0,
            text: "压缩摘要",
            compactSummary: true
          }),
          userRecord("u1", T0 + 10_000, "第一条"),
          toolRecord("t1", T0 + 10_000, { command: "ls" }),
          assistantRecord("a1", T0 + 40_000, { text: "收尾" })
        ])}
      />
    );

    fireEvent.keyDown(root(), { key: "Home" });
    expect(lane()).toHaveAttribute("aria-valuenow", "0");
    expect(within(stageCard()).getByText("还没有事件")).toBeInTheDocument();
    expect(within(stageCard()).getByText("播放头在第一个事件之前。")).toBeInTheDocument();

    fireEvent.keyDown(root(), { key: "ArrowRight" });
    expect(within(stageCard()).getByText("第 1 / 3 条")).toBeInTheDocument();
    expect(within(stageCard()).getByText("同刻 1 / 2")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "25");
    expect(lane().getAttribute("aria-valuetext")).toContain("第 1 / 3 条");

    fireEvent.keyDown(root(), { key: "ArrowRight" });
    expect(within(stageCard()).getByText("第 2 / 3 条")).toBeInTheDocument();
    expect(within(stageCard()).getByText("同刻 2 / 2")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "25");

    // The pair is a stable round trip: back to 「before the first event」 and in
    // again, without ever skipping the first card.
    fireEvent.keyDown(root(), { key: "ArrowLeft" });
    expect(within(stageCard()).getByText("第 1 / 3 条")).toBeInTheDocument();
    fireEvent.keyDown(root(), { key: "ArrowLeft" });
    expect(within(stageCard()).getByText("还没有事件")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "0");
    fireEvent.keyDown(root(), { key: "ArrowRight" });
    expect(within(stageCard()).getByText("第 1 / 3 条")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "25");
  });

  // Defect B (browser repro, /repo/demo): the last two events share the film's
  // final timestamp, so 「previous」 by time kept re-landing on the same instant
  // and 「同刻 1 / 2」 was unreachable.
  it("walks back through events that share the film's final instant", () => {
    render(
      <ReplayView
        parsed={parsedOf([
          userRecord("u1", T0, "开始"),
          assistantRecord("a1", T0 + 20_000, { text: "中间" }),
          toolRecord("t1", T0 + 60_000, { command: "npm test", durationMs: 1000 }),
          toolRecord("t2", T0 + 60_000, { command: "npm lint" })
        ])}
      />
    );

    fireEvent.keyDown(root(), { key: "End" });
    expect(within(stageCard()).getByText("第 4 / 4 条")).toBeInTheDocument();
    expect(within(stageCard()).getByText("同刻 2 / 2")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "100");

    fireEvent.keyDown(root(), { key: "ArrowLeft" });
    expect(within(stageCard()).getByText("第 3 / 4 条")).toBeInTheDocument();
    expect(within(stageCard()).getByText("同刻 1 / 2")).toBeInTheDocument();
    // Same instant, so the head must not move while the card changes.
    expect(lane()).toHaveAttribute("aria-valuenow", "100");

    fireEvent.keyDown(root(), { key: "ArrowLeft" });
    expect(within(stageCard()).getByText("第 2 / 4 条")).toBeInTheDocument();
    expect(within(stageCard()).queryByText("同刻 1 / 2")).not.toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "33");
  });

  it("steps by time while playing and by event index once paused", () => {
    vi.useFakeTimers();
    render(<ReplayView parsed={standardParsed()} />);

    fireEvent.keyDown(root(), { key: " " });
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(within(stageCard()).getByText("停顿 30 秒")).toBeInTheDocument();

    // Mid-playback a step still follows the clock: it lands on the event that
    // opened the pause, not on a remembered index.
    fireEvent.keyDown(root(), { key: "ArrowLeft" });
    expect(lane()).toHaveAttribute("aria-valuenow", "50");
    expect(within(stageCard()).getByText("第 3 / 4 条")).toBeInTheDocument();

    // The clock was not interrupted by the step.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(lane()).toHaveAttribute("aria-valuenow", "67");

    fireEvent.keyDown(root(), { key: " " });
    expect(screen.getByRole("button", { name: "播放" })).toBeInTheDocument();
    fireEvent.keyDown(root(), { key: "ArrowRight" });
    expect(within(stageCard()).getByText("第 4 / 4 条")).toBeInTheDocument();
    expect(lane()).toHaveAttribute("aria-valuenow", "100");
  });

  it("nudges the head by 1% with Shift+←/→ on the lane", () => {
    render(<ReplayView parsed={standardParsed()} />);

    fireEvent.keyDown(lane(), { key: "ArrowRight", shiftKey: true });
    expect(lane()).toHaveAttribute("aria-valuenow", "1");

    fireEvent.keyDown(lane(), { key: "ArrowRight", shiftKey: true });
    expect(lane()).toHaveAttribute("aria-valuenow", "2");
  });
});
