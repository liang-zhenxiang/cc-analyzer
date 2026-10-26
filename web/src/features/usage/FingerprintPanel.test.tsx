import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { FingerprintPanel } from "./FingerprintPanel";

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

function sessionOf(label: string, tokens: number): UsageSessionInput {
  return {
    projectLabel: label,
    records: [
      recordOf(`${label}-u`, NOW - 3_600_000),
      recordOf(`${label}-a`, NOW, { inputTokens: tokens, outputTokens: 0 })
    ]
  };
}

describe("FingerprintPanel（D4 指纹雷达）", () => {
  it("六轴逐行落表，读屏句带上轴名与原始值", () => {
    render(<FingerprintPanel inputs={[sessionOf("alpha", 1_000_000), sessionOf("beta", 100_000)]} />);

    expect(screen.getByRole("region", { name: "指纹雷达" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(6);
    expect(within(rows[0]).getByRole("rowheader")).toHaveTextContent("token 强度");
    // 主体是 token 最多的那段会话：100 万 token / 当天 1 个活跃日。
    expect(within(rows[0]).getByRole("cell")).toHaveTextContent("1.0M/日");
    expect(screen.getByRole("img", { name: /指纹雷达：token 强度 1.0M\/日/ })).toBeInTheDocument();
  });

  it("没有错误采样时那一轴写 —，并在脚注里说明", () => {
    render(<FingerprintPanel inputs={[sessionOf("alpha", 1_000_000), sessionOf("beta", 100_000)]} />);

    const errorRow = screen
      .getAllByRole("row")
      .find((row) => row.textContent?.includes("错误率（无错误数据）"));
    expect(errorRow).toBeDefined();
    expect(within(errorRow as HTMLElement).getByRole("cell")).toHaveTextContent("—");
    expect(
      screen.getByText("六轴按本窗口全部会话的相对位置归一，不是人群百分位。标 — 的轴没有足够样本。")
    ).toBeInTheDocument();
  });

  it("没有会话时给空态，不画半个雷达", () => {
    render(<FingerprintPanel inputs={[]} />);

    expect(screen.getByText("本窗口还没有可画像的会话")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
