import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { ModelSwapTable } from "./ModelSwapTable";

const NOW = new Date(2026, 0, 15, 12, 0).getTime();

function recordOf(id: string, model: string, usage: SessionUsage): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp: NOW,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    model,
    usage
  };
}

const INPUTS: UsageSessionInput[] = [
  {
    projectLabel: "-work",
    records: [
      recordOf("s", "claude-sonnet-4-5-20250929", { inputTokens: 1_000_000, outputTokens: 0 }),
      recordOf("o", "claude-opus-4-1-20250805", { inputTokens: 1_000_000, outputTokens: 0 })
    ]
  }
];

describe("ModelSwapTable（D3 换模对照）", () => {
  it("实际一行 + 三族各一行，倍率按同量 token 折算", () => {
    render(<ModelSwapTable sessions={INPUTS} />);

    const headers = screen.getAllByRole("rowheader").map((node) => node.textContent);
    expect(headers).toEqual([
      "实际（按各会话模型）",
      "全部换成 Opus",
      "全部换成 Sonnet",
      "全部换成 Haiku"
    ]);
    // 100 万 sonnet 输入 = $3.00，100 万 opus 输入 = $15.00。
    expect(screen.getByText("$18.00")).toBeInTheDocument();
    // 200 万 opus = $30.00，是实际的 1.7 倍。
    expect(screen.getByText("$30.00")).toBeInTheDocument();
    expect(screen.getByText("×1.7")).toBeInTheDocument();
    // 200 万 haiku = $2.00，是实际的 0.1 倍。
    expect(screen.getByText("$2.00")).toBeInTheDocument();
    expect(screen.getByText("×0.1")).toBeInTheDocument();
    expect(screen.getByText(/按定价快照 2026-10-01 折算，不是账单；未知价 token 未计入。/)).toBeInTheDocument();
    expect(screen.getByText(/源模型 2 个：Sonnet 4.5、Opus 4.1/)).toBeInTheDocument();
  });

  it("全部无法定价时给出空态，而不是四行 —", () => {
    render(<ModelSwapTable sessions={[]} />);

    expect(screen.getByText("本窗口没有可定价的调用，换模无从比较")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
