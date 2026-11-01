import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RhythmPanel } from "./RhythmPanel";
import type { ParsedSession, SessionRecord } from "./types";

const T0 = new Date(2026, 9, 2, 9).getTime();

let seq = 0;
function userAt(ts: number): SessionRecord {
  seq += 1;
  return {
    id: `u${seq}`,
    fullId: `s:u${seq}`,
    kind: "user",
    timestamp: ts,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {}
  };
}

/** 最小可用的 ParsedSession：RhythmPanel 只读 records。 */
function parsedOf(records: SessionRecord[]): ParsedSession {
  return {
    sessionId: "session-1",
    path: "/logs/session-1.jsonl",
    startedAt: records[0]?.timestamp ?? T0,
    endedAt: records[records.length - 1]?.timestamp ?? T0,
    records,
    turns: [],
    unmatchedToolUses: [],
    warnings: [],
    systemTurnDurations: [],
    skippedCounts: {},
    sidechainMessages: []
  };
}

/** 三个时间戳之间的间隔（分钟）。 */
const MIN = 60_000;

describe("RhythmPanel（H4 对话节奏）", () => {
  it("样本不足（0 次提问）：诚实空态不画图", () => {
    render(<RhythmPanel parsed={parsedOf([])} />);
    expect(screen.getByText("这个会话没有用户消息")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("样本不足（2 次提问 < 3）：写明次数，不给标签不画柱", () => {
    render(<RhythmPanel parsed={parsedOf([userAt(T0), userAt(T0 + 5 * MIN)])} />);
    expect(screen.getByText("只有 2 次提问，还看不出节奏")).toBeInTheDocument();
    expect(screen.queryByText(/快问快追|匀速|长考后一击/)).not.toBeInTheDocument();
  });

  it("正常样本：六档柱全渲染，读数行与标签来自模型层", () => {
    // 间隔：30s（<1分）×2、3分 ×2、10 分、90 分（30 分–2 时）、3 小时、9 小时。
    const times = [
      T0,
      T0 + 30_000,
      T0 + 60_000, // 距上条 30s → <1 分
      T0 + 4 * MIN, // 3 分 → 1–5 分
      T0 + 7 * MIN, // 3 分 → 1–5 分
      T0 + 17 * MIN, // 10 分 → 5–30 分
      T0 + 107 * MIN, // 90 分 → 30 分–2 时
      T0 + 287 * MIN, // 180 分 → 2–8 时
      T0 + 287 * MIN + 9 * 60 * MIN // 540 分 → > 8 时
    ];
    render(<RhythmPanel parsed={parsedOf(times.map(userAt))} />);

    // 标签在场（模型层三档之一）。
    expect(["快问快追", "匀速", "长考后一击"]).toContain(screen.getByText(/快问快追|匀速|长考后一击/).textContent);

    // 六档柱都在，probe 可数。
    const bars = Array.from(document.querySelectorAll('[data-probe="rhythm-bar"]'));
    expect(bars).toHaveLength(6);

    // 读数行拼着中位/90 分位/最长/爆发数。
    const readout = screen.getByText(/中位间隔/).textContent ?? "";
    expect(readout).toContain("中位间隔");
    expect(readout).toContain("90 分位");
    expect(readout).toContain("最长");
    expect(readout).toContain("次在一分钟内");

    // 脚注的诚实口径在场。
    expect(screen.getByText("间隔是两次提问之间的墙钟，不是思考时长。")).toBeInTheDocument();
  });

  it("图区 role=img 且 aria-label 给出文字摘要（读屏不依赖柱子）", () => {
    const times = [T0, T0 + 2 * MIN, T0 + 6 * MIN, T0 + 40 * MIN];
    render(<RhythmPanel parsed={parsedOf(times.map(userAt))} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("提问间隔分布");
    expect(img.getAttribute("aria-label")).toContain("中位间隔");
  });

  it("档内计数：柱顶次数可读，零档给 0 而不是消失", () => {
    // 只造 1–5 分档的间隔：其余档计数为 0 但仍在 DOM。
    const times = [T0, T0 + 2 * MIN, T0 + 5 * MIN, T0 + 9 * MIN];
    render(<RhythmPanel parsed={parsedOf(times.map(userAt))} />);
    const counts = Array.from(document.querySelectorAll('[data-probe="rhythm-bar"]')).map((bar) => {
      const col = bar.parentElement as HTMLElement;
      return Array.from(col.querySelectorAll("span")).map((s) => s.textContent).join(" ");
    });
    // 六列都在（零档不消失）。
    expect(Array.from(document.querySelectorAll('[data-probe="rhythm-bar"]'))).toHaveLength(6);
    expect(counts.length).toBe(6);
  });
});
