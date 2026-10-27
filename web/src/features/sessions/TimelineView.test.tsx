import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CompactEvent, ParsedSession, SessionRecord, SessionUsage } from "./types";
import { TimelineView } from "./TimelineView";

/** 固定墙钟：轴刻度与 aria-valuetext 都变成可读断言，而不是「现在」。 */
const T0 = new Date(2026, 0, 1, 10, 42, 0).getTime();
const MINUTE = 60_000;
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

function assistantRecord(id: string, at: number, usage?: SessionUsage): SessionRecord {
  return recordOf({
    id,
    fullId: id,
    kind: "assistant",
    timestamp: at,
    model: SONNET,
    usage
  });
}

function userRecord(id: string, at: number, text: string): SessionRecord {
  return recordOf({ id, fullId: id, kind: "user", timestamp: at, text });
}

function parsedOf(
  records: SessionRecord[],
  compactEvents: CompactEvent[] = []
): ParsedSession {
  const timestamps = records.map((record) => record.timestamp);
  const start = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const end = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  return {
    sessionId: "session-timeline",
    path: "/tmp/session-timeline.jsonl",
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

/** 三段水位：78k → 120k → 60k，跨 20 分钟。 */
function threeSamples(): SessionRecord[] {
  return [
    assistantRecord("a1", T0 + 10 * MINUTE, {
      inputTokens: 50_000,
      cacheReadTokens: 20_000,
      cacheCreationTokens: 8_000
    }),
    assistantRecord("a2", T0 + 20 * MINUTE, {
      inputTokens: 90_000,
      cacheReadTokens: 30_000
    }),
    assistantRecord("a3", T0 + 30 * MINUTE, { inputTokens: 60_000 })
  ];
}

function slider(): HTMLElement {
  return screen.getByRole("slider", { name: "会话时间轴" });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TimelineView · 轴与读数（E3）", () => {
  it("开口在末尾：默认停在会话终点，读数行给出时刻、条数与上下文水位", () => {
    render(<TimelineView parsed={parsedOf(threeSamples())} onLocateInLog={vi.fn()} />);

    const track = slider();
    expect(track).toHaveAttribute("aria-valuenow", "100");
    // aria-valuetext 是**时刻字符串**（规格 §9：读屏用户听到的不是「100」）。
    expect(track.getAttribute("aria-valuetext")).toMatch(/^11:12:00 · 第 \d+ 条记录$/);

    // 底部读数行：`时刻 · 第 N 条记录 · 上下文 当前 / 峰值`。
    expect(screen.getByText(/上下文 60,000 \/ 120,000/)).toBeInTheDocument();
  });

  it("刻度行写起 / 中 / 末三个时刻", () => {
    const { container } = render(
      <TimelineView parsed={parsedOf(threeSamples())} onLocateInLog={vi.fn()} />
    );
    const ticks = container.querySelectorAll("div");
    const labels = Array.from(ticks)
      .flatMap((node) => Array.from(node.children))
      .map((node) => node.textContent ?? "")
      .filter((text) => /^\d{2}:\d{2}:\d{2}$/.test(text));
    expect(labels).toEqual(
      expect.arrayContaining(["10:52:00", "11:02:00", "11:12:00"])
    );
  });

  it("手柄骑在水位折线上，位置跟着时刻走", () => {
    const { container } = render(
      <TimelineView parsed={parsedOf(threeSamples())} onLocateInLog={vi.fn()} />
    );
    const handle = container.querySelector('[data-probe="timeline-handle"]');
    expect(handle).not.toBeNull();
    expect(container.querySelector('[data-probe="timeline-track"]')).toBe(slider());
  });
});

describe("TimelineView · 键盘与拖动（E3）", () => {
  it("←/→ 每次 1% 跨度，Home/End 跳到两端", async () => {
    const user = userEvent.setup();
    render(<TimelineView parsed={parsedOf(threeSamples())} onLocateInLog={vi.fn()} />);
    const track = slider();
    track.focus();

    await user.keyboard("{ArrowLeft}");
    expect(track).toHaveAttribute("aria-valuenow", "99");

    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(track).toHaveAttribute("aria-valuenow", "97");

    await user.keyboard("{ArrowRight}");
    expect(track).toHaveAttribute("aria-valuenow", "98");

    await user.keyboard("{Home}");
    expect(track).toHaveAttribute("aria-valuenow", "0");

    await user.keyboard("{End}");
    expect(track).toHaveAttribute("aria-valuenow", "100");
  });

  it("Space 没有绑定：按空格不动位置（重放才是播放/暂停）", async () => {
    const user = userEvent.setup();
    render(<TimelineView parsed={parsedOf(threeSamples())} onLocateInLog={vi.fn()} />);
    const track = slider();
    track.focus();

    await user.keyboard("{ArrowLeft}");
    const before = track.getAttribute("aria-valuenow");
    await user.keyboard(" ");
    expect(track.getAttribute("aria-valuenow")).toBe(before);
  });

  it("拖动把指针位置换成时刻：从 100% 拖到 25% 后读数一起变", () => {
    const { container } = render(
      <TimelineView parsed={parsedOf(threeSamples())} onLocateInLog={vi.fn()} />
    );
    const track = slider();
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 200,
      top: 0,
      height: 120,
      right: 200,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect);

    fireEvent.pointerDown(track, { clientX: 50 });
    expect(track).toHaveAttribute("aria-valuenow", "25");
    // 25% 处：10:52 + 5 分钟 = 10:57。
    expect(slider().getAttribute("aria-valuetext")).toContain("10:57:00");

    // 拖到中点：50% 处应是 11:02。
    fireEvent.pointerMove(track, { clientX: 100 });
    expect(track).toHaveAttribute("aria-valuenow", "50");
    expect(slider().getAttribute("aria-valuetext")).toContain("11:02:00");

    fireEvent.pointerUp(track, { clientX: 100 });
    // 松手后继续移动不再改变读数。
    fireEvent.pointerMove(track, { clientX: 180 });
    expect(slider()).toHaveAttribute("aria-valuenow", "50");
    expect(container.querySelectorAll('[data-probe="timeline-handle"]')).toHaveLength(1);
  });
});

describe("TimelineView · 空态与数据不足（E3）", () => {
  it("零跨度：整块退化为一行诚实文案，不画轴", () => {
    const records = [userRecord("u1", T0, "只有这一条")];
    render(<TimelineView parsed={parsedOf(records)} onLocateInLog={vi.fn()} />);

    expect(screen.getByText("这条会话只有 1 条记录，没有时间跨度可拖动")).toBeInTheDocument();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("没有上下文读数时说事实，不画一条假的平线", () => {
    // 事件撑出跨度（否则会落进零跨度分支），但两条记录都不带 usage。
    const records = [userRecord("u1", T0, "早"), userRecord("u2", T0 + 20 * MINUTE, "晚")];
    const events: CompactEvent[] = [
      {
        id: "c1",
        timestamp: T0 + 5 * MINUTE,
        trigger: null,
        preTokens: null,
        postTokens: null,
        droppedTokens: null,
        durationMs: null,
        survivedUuids: [],
        summaryText: null,
        summaryUuid: null,
        logicalParentUuid: null
      },
      {
        id: "c2",
        timestamp: T0 + 15 * MINUTE,
        trigger: null,
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
    render(
      <TimelineView parsed={parsedOf(records, events)} onLocateInLog={vi.fn()} />
    );

    expect(screen.getByText("本段没有可核对的上下文读数")).toBeInTheDocument();
    // 轴仍然在：事件刻度还能跳，只是水位画不出来。
    expect(screen.queryByRole("slider")).not.toBeNull();
    expect(screen.getByText(/上下文 — \/ —/)).toBeInTheDocument();
  });
});

describe("TimelineView · 当时的记录（E3）", () => {
  it("只列手柄之前最近的 5 条，最新的排最前", () => {
    const records: SessionRecord[] = [];
    for (let index = 0; index < 9; index += 1) {
      records.push(
        assistantRecord(`a${index}`, T0 + index * MINUTE, { inputTokens: 10_000 + index })
      );
    }
    render(<TimelineView parsed={parsedOf(records)} onLocateInLog={vi.fn()} />);

    const section = screen.getByRole("heading", { name: "此前的记录" }).parentElement!;
    const rows = within(section).getAllByRole("button");
    expect(rows).toHaveLength(5);
    // 末尾开口 → 最新一条在列表顶端（10:50 起、逐分钟一条）。
    expect(rows[0].textContent).toContain("10:50:00");
    expect(rows[4].textContent).toContain("10:46:00");
  });

  it("点一条记录把手柄时刻之前的记录 id 交回日志视图", async () => {
    const user = userEvent.setup();
    const onLocateInLog = vi.fn();
    render(<TimelineView parsed={parsedOf(threeSamples())} onLocateInLog={onLocateInLog} />);

    const section = screen.getByRole("heading", { name: "此前的记录" }).parentElement!;
    const row = within(section).getByText("11:02:00").closest("button");
    expect(row).not.toBeNull();
    await user.click(row!);

    // 交回的是真实记录的 fullId——合成行没有它，也就不该是可点按钮。
    expect(onLocateInLog).toHaveBeenCalledWith("a2");
  });
});

/* ── 与「重放」的区隔（规格 §3.3 / R4）──────────────────────────
   注释先剥掉：这份 CSS 的说明文字本身就会提到「重放」「.playhead」这些词，
   不剥的话断言读的是注释，不是规则。 */
const timelineCss = readFileSync(
  resolve(process.cwd(), "src/features/sessions/TimelineView.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");
const timelineSource = readFileSync(
  resolve(process.cwd(), "src/features/sessions/TimelineView.tsx"),
  "utf8"
);
const replayCss = readFileSync(
  resolve(process.cwd(), "src/features/sessions/ReplayView.module.css"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("TimelineView · 与重放的区隔（R4）", () => {
  it("不复用重放的类名：没有 .film / .lane / .playhead", () => {
    for (const name of ["film", "lane", "playhead", "axis", "water", "reads"]) {
      expect(timelineCss).not.toMatch(new RegExp(`\\.${name}\\b`));
    }
    // 反向确认被禁的名字确实是重放在用的，否则这条守卫守的是空气。
    for (const name of ["film", "lane", "axis", "water", "reads"]) {
      expect(replayCss).toMatch(new RegExp(`\\.${name}\\b`));
    }
  });

  it("不用类别色：水位与刻度只走 --chart-1 / --text-*", () => {
    // 类型编码留给重放（§3.3 第 1 条）。时间轴上出现 --chart-2..6 / --danger
    // 就说明有人开始按事件类型上色了。
    expect(timelineCss).not.toMatch(/--chart-[2-6]\b/);
    expect(timelineCss).not.toMatch(/var\(--danger\)/);
    expect(timelineCss).not.toMatch(/var\(--warning\)/);
    expect(timelineCss).not.toMatch(/var\(--success\)/);
    expect(timelineCss).toMatch(/--chart-1/);
  });

  it("不复用 replayModel 的 frameAt：时间轴读的是水位快照，不是帧", () => {
    expect(timelineSource).not.toMatch(/from "\.\/replayModel"/);
    expect(timelineSource).not.toMatch(/frameAt/);
    // 唯一允许共享的是水位序列本身。
    expect(timelineSource).toMatch(/from "\.\/contextSeries"/);
  });

  it("轴高 168 由四段像素拼出，底部读数行不与重放共用 class", () => {
    expect(timelineCss).toMatch(/\.ruler\s*\{[^}]*height:\s*168px/);
    expect(timelineCss).toMatch(/\.waterline\s*\{[^}]*height:\s*96px/);
    expect(timelineCss).toMatch(/\.snapshot\s*\{/);
    // 重放的读数行叫 .reads / .read；时间轴不复用它们。
    expect(timelineCss).not.toMatch(/\.reads\b/);
    expect(timelineCss).not.toMatch(/\.read\b/);
    expect(replayCss).toMatch(/\.reads\b/);
  });

  it("手柄是 14×6 圆角矩形，不是重放的 4px 圆点", () => {
    expect(timelineCss).toMatch(/\.handle\s*\{[^}]*width:\s*14px[^}]*\}/);
    expect(timelineCss).toMatch(/\.handle\s*\{[^}]*height:\s*6px[^}]*\}/);
    expect(timelineCss).toMatch(/\.handle\s*\{[^}]*border-radius:\s*var\(--r-xs\)/);
  });
});
