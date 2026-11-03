import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ParsedSession, SessionRecord } from "./types";
import { axisClockFor, blockWidthShare, TimelineTrack } from "./TimelineTrack";

describe("blockWidthShare（块宽按时长映射）", () => {
  it("时长为轨道跨度的 10% → 10% 宽", () => {
    expect(blockWidthShare(1_000, 10_000)).toBeCloseTo(0.1);
  });

  it("6 秒与 30 毫秒在同一条 60 秒轨道上不再同宽", () => {
    const span = 60_000;
    expect(blockWidthShare(6_000, span)).toBeCloseTo(0.1);
    expect(blockWidthShare(30, span)).toBeCloseTo(0.0005);
  });

  it("超长记录封顶 15%——单条挂起不能吞掉整条轨道", () => {
    expect(blockWidthShare(120_000, 60_000)).toBe(0.15);
  });

  it("零时长或零跨度 → 0（由 CSS min-width 兜底可见性）", () => {
    expect(blockWidthShare(0, 10_000)).toBe(0);
    expect(blockWidthShare(1_000, 0)).toBe(0);
  });
});

/**
 * P1-5：8 秒会话的四个刻度若都写 HH:mm，全是同一个「18:00」，轴失去
 * 区分度。刻度间距不足 1 分钟时补秒；长会话保持 HH:mm。
 */
describe("axisClockFor（刻度精度随跨度选择）", () => {
  const T0 = new Date(2026, 0, 1, 18, 0, 0).getTime();

  it("短会话（8 秒）带秒", () => {
    const clock = axisClockFor(8_000);
    expect(clock(T0)).toBe("18:00:00");
    expect(clock(T0 + 8_000)).toBe("18:00:08");
  });

  it("刻度间距不足 1 分钟即补秒，即使总跨度超过 1 分钟", () => {
    // 90 秒 / 3 = 30 秒，四个刻度若只到分钟会重复。
    expect(axisClockFor(90_000)(T0 + 30_000)).toBe("18:00:30");
  });

  it("长会话（1 小时）保持 HH:mm，不引入秒级噪音", () => {
    const clock = axisClockFor(3_600_000);
    expect(clock(T0)).toBe("18:00");
    expect(clock(T0 + 3_600_000)).toBe("19:00");
  });
});

const SESSION_START = new Date(2026, 0, 1, 18, 0, 0).getTime();

function recordAt(id: string, timestamp: number): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {}
  };
}

function sessionOf(start: number, end: number): ParsedSession {
  return {
    sessionId: "session-timeline",
    path: "/tmp/session-timeline.jsonl",
    startedAt: start,
    endedAt: end,
    records: [recordAt("r1", start), recordAt("r2", end)],
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    compactEvents: [],
    sidechainMessages: []
  };
}

function axisTicks(session: ParsedSession): string[] {
  const { container } = render(
    <TimelineTrack
      session={session}
      selection={null}
      onSelect={vi.fn()}
      onReveal={vi.fn()}
    />
  );
  return [...container.querySelectorAll('[data-probe="axis-tick"]')].map(
    (tick) => tick.textContent ?? ""
  );
}

describe("TimelineTrack 轴刻度（短会话不再四个同字）", () => {
  it("8 秒会话：四个刻度都带秒且互不相同", () => {
    const ticks = axisTicks(sessionOf(SESSION_START, SESSION_START + 8_000));
    expect(ticks).toHaveLength(4);
    expect(ticks.every((tick) => /^\d{2}:\d{2}:\d{2}$/.test(tick))).toBe(true);
    expect(new Set(ticks).size).toBe(4);
  });

  it("1 小时会话：刻度仍用 HH:mm", () => {
    const ticks = axisTicks(sessionOf(SESSION_START, SESSION_START + 3_600_000));
    expect(ticks).toEqual(["18:00", "18:20", "18:40", "19:00"]);
  });
});

/**
 * 轴刻度的精度选择不能连带把悬停/选区读数降级：长会话里「这一刻是几点
 * 几秒」仍然有用，探针与选区 tooltip 始终 HH:mm:ss。
 */
describe("TimelineTrack 悬停/选区读数（始终到秒）", () => {
  function renderLongSession() {
    return render(
      <TimelineTrack
        session={sessionOf(SESSION_START, SESSION_START + 3_600_000)}
        selection={null}
        onSelect={vi.fn()}
        onReveal={vi.fn()}
      />
    );
  }

  it("长会话轴用分钟，悬停准线仍带秒", () => {
    const { container } = renderLongSession();
    const ticks = [...container.querySelectorAll('[data-probe="axis-tick"]')].map(
      (tick) => tick.textContent ?? ""
    );
    expect(ticks).toEqual(["18:00", "18:20", "18:40", "19:00"]);

    fireEvent.mouseMove(screen.getByRole("application", { name: "时间轨道" }), {
      clientX: 120
    });
    expect(container.querySelector('[data-probe="probe-bubble"]')?.textContent).toMatch(
      /^\d{2}:\d{2}:\d{2}$/
    );
    expect(container.querySelector('[data-probe="probe-bubble"]')?.textContent).toBe(
      "18:00:00"
    );
  });

  it("长会话选区预览的两端也带秒", () => {
    // jsdom 的 getBoundingClientRect 宽度为 0；固定成 1000px 才能把
    // clientX 映射成真实时刻，从而断言预览区间的完整文案。
    const rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 66,
      width: 1000,
      height: 66,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect);
    try {
      const { container } = renderLongSession();
      const track = screen.getByRole("application", { name: "时间轨道" });
      // 1 小时跨度：10% → 18:06:00，20% → 18:12:00。
      fireEvent.mouseDown(track, { button: 0, clientX: 100 });
      fireEvent.mouseMove(track, { clientX: 200 });
      expect(container.querySelector('[data-probe="probe-bubble"]')?.textContent).toBe(
        "18:06:00 – 18:12:00 · 6m0s"
      );
    } finally {
      rectSpy.mockRestore();
    }
  });
});
