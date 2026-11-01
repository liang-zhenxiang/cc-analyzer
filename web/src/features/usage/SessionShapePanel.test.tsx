import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { SessionShapePanel } from "./SessionShapePanel";

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;

let seq = 0;
function record(at: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...patch
  };
}

function input(records: SessionRecord[]): UsageSessionInput {
  return { projectLabel: "p", records };
}

function renderPanel(inputs: readonly UsageSessionInput[]) {
  return render(<SessionShapePanel inputs={inputs} />);
}

/** 四段会话：1 小时 / 20 分钟 / 5 分钟，加一段只有一条记录的。 */
const durationInputs: UsageSessionInput[] = [
  input([record(NOW - 5 * HOUR), record(NOW - 4 * HOUR)]),
  input([record(NOW - 3 * HOUR), record(NOW - 3 * HOUR + 20 * MIN)]),
  input([record(NOW - 2 * HOUR), record(NOW - 2 * HOUR + 5 * MIN)]),
  input([record(NOW - HOUR)])
];

describe("SessionShapePanel（会话形状卡）", () => {
  it("时长档：五桶、中位跨度、单记录会话单独说明", () => {
    renderPanel(durationInputs);

    const shape = document.querySelector('[data-probe="session-shape"]');
    expect(shape?.getAttribute("data-shape")).toBe("duration");
    expect(document.querySelectorAll('[data-probe="shape-bar"]')).toHaveLength(5);

    const readout = document.querySelector('[data-probe="shape-readout"]');
    expect(readout?.textContent).toBe("中位跨度 20m0s，4 个会话");
    expect(
      screen.getByText(/另有 1 个会话只有一条记录，计入「不足 5 分钟」。/)
    ).toBeInTheDocument();

    // 桶计数：<5 分钟 1（单记录那段）、5–15 分钟 1、15–60 分钟 1、1–4 小时 1。
    const counts = [...document.querySelectorAll('[data-probe="shape-bar"]')].map(
      (bar) => bar.querySelectorAll("span")[1]?.textContent
    );
    expect(counts).toEqual(["1", "1", "1", "1", "0"]);
  });

  it("间隔档：六桶与「N 对相邻会话」读数", async () => {
    const user = userEvent.setup();
    renderPanel(durationInputs);

    await user.click(screen.getByRole("tab", { name: "间隔" }));

    expect(document.querySelectorAll('[data-probe="shape-bar"]')).toHaveLength(6);
    // 四个会话的开始时刻：5h/3h/2h/1h 前 → 间隔 2h、1h、1h（三对）。
    expect(document.querySelector('[data-probe="shape-readout"]')?.textContent).toBe(
      "中位间隔 1h0m0s，3 对相邻会话"
    );
  });

  it("切换档：三桶与换过模型的占比", async () => {
    const user = userEvent.setup();
    const inputs: UsageSessionInput[] = [
      input([
        record(NOW - HOUR, { model: "m-a", usage: { inputTokens: 10 } }),
        record(NOW - HOUR + MIN, { model: "m-b", usage: { inputTokens: 10 } })
      ]),
      input([record(NOW - 2 * HOUR, { model: "m-a", usage: { inputTokens: 10 } })]),
      input([record(NOW - 3 * HOUR, { model: "m-c", usage: { inputTokens: 10 } })])
    ];
    renderPanel(inputs);

    await user.click(screen.getByRole("tab", { name: "切换" }));

    expect(document.querySelectorAll('[data-probe="shape-bar"]')).toHaveLength(3);
    expect(document.querySelector('[data-probe="shape-readout"]')?.textContent).toBe(
      "33% 的会话换过模型"
    );
    expect(screen.getByText(/换回旧模型也算/)).toBeInTheDocument();
  });

  it("配方档：只列出现 ≥2 次的组合，并说明无工具会话", async () => {
    const user = userEvent.setup();
    const bashRead = [record(NOW - HOUR, { toolName: "Bash" }), record(NOW - HOUR, { toolName: "Read" })];
    const inputs: UsageSessionInput[] = [
      input(bashRead),
      input([
        record(NOW - 2 * HOUR, { toolName: "Read" }),
        record(NOW - 2 * HOUR, { toolName: "Bash" })
      ]),
      input([record(NOW - 3 * HOUR, { toolName: "Edit" })]),
      input([record(NOW - 4 * HOUR)])
    ];
    renderPanel(inputs);

    await user.click(screen.getByRole("tab", { name: "配方" }));

    expect(document.querySelector('[data-probe="shape-bars"]')).toBeNull();
    expect(screen.getByText("Bash · Read")).toBeInTheDocument();
    expect(screen.queryByText("Edit")).toBeNull();
    expect(document.querySelector('[data-probe="shape-readout"]')?.textContent).toBe(
      "1 种配方重复出现"
    );
    expect(screen.getByText(/1 个会话没有调用工具。/)).toBeInTheDocument();
  });

  it("样本不足时整卡写一句诚实的话，不画空柱", () => {
    renderPanel([input([record(NOW - HOUR)])]);

    expect(screen.getByText("只有 1 个会话，看不出分布")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-probe="shape-bar"]')).toHaveLength(0);
    expect(document.querySelector('[data-probe="shape-readout"]')).toBeNull();
  });
});
