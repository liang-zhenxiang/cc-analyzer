import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { PromptRhythmPanel } from "./PromptRhythmPanel";

const NOW = new Date(2026, 9, 15, 18, 0).getTime();
const BASE = new Date(2026, 9, 15, 9, 0).getTime();
const MIN = 60_000;
const SEC = 1000;

function record(timestamp: number, text: string, patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `r-${timestamp}-${text.length}`,
    fullId: `r-${timestamp}-${text.length}`,
    kind: "user",
    timestamp,
    durationMs: 0,
    text,
    isError: false,
    raw: {},
    ...patch
  };
}

function input(projectLabel: string, records: SessionRecord[]): UsageSessionInput {
  return { projectLabel, records };
}

/** 9 条消息，间隔 1 分钟，字数 10…90（第 1 条没有间隔）。 */
function nineMessages(): UsageSessionInput[] {
  return [
    input(
      "p",
      Array.from({ length: 9 }, (_, index) =>
        record(BASE + index * MIN, "x".repeat(10 * (index + 1)))
      )
    )
  ];
}

describe("PromptRhythmPanel（F10 提示词节奏）", () => {
  it("摘要、中位读数与点数都在，图例按项目给出计数", () => {
    const { container } = render(
      <PromptRhythmPanel inputs={nineMessages()} days={30} now={NOW} />
    );

    const chart = screen.getByRole("img", { name: /提示词节奏/ });
    expect(chart.getAttribute("aria-label")).toContain("9 条用户消息");
    expect(chart.getAttribute("aria-label")).toContain("画出 8 个点");
    expect(chart.getAttribute("aria-label")).toContain("中位 1 分 · 55 字");

    expect(container.querySelectorAll("[data-rhythm-point]")).toHaveLength(8);
    expect(screen.getByText("中位 1 分 · 55 字")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^p\s*9$/ })).toBeInTheDocument();
  });

  it("没有用户消息：给空态", () => {
    render(<PromptRhythmPanel inputs={[]} days={30} now={NOW} />);

    expect(screen.getByText("所选范围内没有可读的用户消息")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /提示词节奏/ })).not.toBeInTheDocument();
  });

  it("样本不足 8 条：说明有多少条消息，不画散点", () => {
    render(
      <PromptRhythmPanel
        inputs={[input("p", [record(BASE, "a"), record(BASE + MIN, "b"), record(BASE + 2 * MIN, "c")])]}
        days={30}
        now={NOW}
      />
    );

    expect(screen.getByText("样本太少（3 条用户消息），散点读不出节奏")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /提示词节奏/ })).not.toBeInTheDocument();
  });

  it("被过滤的点写进脚注（少于 5 秒）", () => {
    render(
      <PromptRhythmPanel
        inputs={[
          input("p", [
            record(BASE, "first"),
            record(BASE + 2 * SEC, "too-short"),
            record(BASE + 62 * SEC, "b"),
            record(BASE + 122 * SEC, "c"),
            record(BASE + 182 * SEC, "d"),
            record(BASE + 242 * SEC, "e"),
            record(BASE + 302 * SEC, "f"),
            record(BASE + 362 * SEC, "g"),
            record(BASE + 422 * SEC, "h")
          ])
        ]}
        days={30}
        now={NOW}
      />
    );

    expect(screen.getByText(/少于 5 秒 1 条/)).toBeInTheDocument();
    expect(screen.getByText(/首条消息 1 条没有间隔/)).toBeInTheDocument();
  });

  it("点图例可以隐藏该项目的点，再点恢复", async () => {
    const user = userEvent.setup();
    const records: SessionRecord[] = [];
    for (let index = 0; index < 10; index += 1) {
      records.push(record(BASE + index * MIN, `m${index}`, {}));
    }
    const inputs = [
      input("p1", records.filter((_, index) => index % 2 === 0)),
      input("p2", records.filter((_, index) => index % 2 === 1))
    ];
    const { container } = render(
      <PromptRhythmPanel inputs={inputs} days={30} now={NOW} />
    );

    // 10 条消息 → 9 个有间隔的点；p1 因首条无间隔少一个。
    expect(container.querySelectorAll("[data-rhythm-point]")).toHaveLength(9);

    const p1 = screen.getByRole("button", { name: /^p1/ });
    await user.click(p1);
    expect(p1).toHaveAttribute("aria-pressed", "false");
    expect(container.querySelectorAll("[data-rhythm-point]")).toHaveLength(5);

    await user.click(p1);
    expect(p1).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll("[data-rhythm-point]")).toHaveLength(9);
  });

  it("样本够多但点全部超出范围：解释为什么没有可画的点", () => {
    render(
      <PromptRhythmPanel
        inputs={[
          input(
            "p",
            Array.from({ length: 8 }, () => record(BASE, "same-instant"))
          )
        ]}
        days={30}
        now={NOW}
      />
    );

    expect(screen.getByText("所有用户消息都落在可画范围之外")).toBeInTheDocument();
  });
});
