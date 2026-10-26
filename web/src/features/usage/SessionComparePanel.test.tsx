import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { SessionComparePanel } from "./SessionComparePanel";

const NOW = new Date(2026, 0, 15, 12, 0).getTime();

function recordOf(id: string, timestamp: number, usage?: SessionUsage): SessionRecord {
  return {
    id,
    fullId: id,
    kind: usage ? "assistant" : "user",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...(usage ? { usage, model: "claude-sonnet-4-5-20250929" } : {})
  };
}

function inputOf(label: string, tokens: { input: number; output: number }, minutes: number): UsageSessionInput {
  return {
    projectLabel: label,
    records: [
      recordOf(`${label}-u`, NOW - minutes * 60_000),
      recordOf(`${label}-a`, NOW, {
        inputTokens: tokens.input,
        outputTokens: tokens.output
      })
    ]
  };
}

const INPUTS: UsageSessionInput[] = [
  inputOf("alpha", { input: 1_000_000, output: 100_000 }, 60),
  inputOf("beta", { input: 200_000, output: 20_000 }, 30),
  inputOf("gamma", { input: 50_000, output: 0 }, 10)
];

describe("SessionComparePanel（D1 会话对比）", () => {
  it("默认比较 token 最多的两段会话，五项读数逐字落表", () => {
    render(<SessionComparePanel inputs={INPUTS} />);

    expect(screen.getByRole("region", { name: "会话对比" })).toBeInTheDocument();
    const selectA = screen.getByRole("combobox", { name: "会话 A" }) as HTMLSelectElement;
    const selectB = screen.getByRole("combobox", { name: "会话 B" }) as HTMLSelectElement;
    expect(selectA.value).toBe("0");
    expect(selectB.value).toBe("1");
    expect(within(selectA).getByRole("option", { name: "alpha · 1.1M tok" })).toBeInTheDocument();

    // 五行的标签与数值都在（左右各一份）。
    expect(screen.getAllByText("消息")).toHaveLength(2);
    expect(screen.getAllByText("输入 tokens")).toHaveLength(2);
    expect(screen.getAllByText("1.0M")).toHaveLength(1);
    expect(screen.getAllByText("200,000")).toHaveLength(1);
    expect(screen.getAllByText("100,000")).toHaveLength(1);
    expect(screen.getAllByText("60 分")).toHaveLength(1);

    // 差值最大的一维独占一句，且方向由原始读数决定。
    expect(screen.getByText(/tokens差得最多：A 比另一侧多 400%。/)).toBeInTheDocument();
  });

  it("换掉右侧会话后，读数跟着换（不是把两侧写成同一份）", async () => {
    const user = userEvent.setup();
    render(<SessionComparePanel inputs={INPUTS} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "会话 B" }), "2");

    expect(screen.queryByText("200,000")).not.toBeInTheDocument();
    expect(screen.getByText("50,000")).toBeInTheDocument();
    expect(screen.getByText(/tokens差得最多/)).toBeInTheDocument();
  });

  it("同一段会话不能自己跟自己比：对面已选的那一项被禁用", async () => {
    const user = userEvent.setup();
    render(<SessionComparePanel inputs={INPUTS} />);

    await user.selectOptions(screen.getByRole("combobox", { name: "会话 A" }), "2");
    const selectB = screen.getByRole("combobox", { name: "会话 B" });
    expect(within(selectB).getByRole("option", { name: "gamma · 50,000 tok" })).toBeDisabled();
  });

  it("只有一个会话时如实说没有对手，不画空表", () => {
    render(<SessionComparePanel inputs={[INPUTS[0]]} />);

    expect(screen.getByText("本窗口只有 1 个会话，没有对手可比")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
