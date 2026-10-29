import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { CostSandboxPanel } from "./CostSandboxPanel";
import type { UsageSessionInput } from "./usageAggregations";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const SONNET = "claude-sonnet-4-5-20250929";
const HAIKU = "claude-haiku-4-5-20250929";

let seq = 0;

function usage(
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): SessionUsage {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: cacheCreation,
    cacheReadTokens: cacheRead
  };
}

function record(model: string, value: SessionUsage): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: NOW - 3_600_000,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    model,
    usage: value
  };
}

function inputsOf(records: SessionRecord[]): UsageSessionInput[] {
  return [{ records, projectLabel: "-repo-demo" }];
}

function readouts(container: HTMLElement) {
  return container.querySelector('[data-probe="sandbox-readout"]') as HTMLElement;
}

/** 1M 写缓存（Sonnet）+ 一个零用量 Haiku：缓存与换模两杆都有可见效果。 */
const CACHE_SONNET = inputsOf([
  record(SONNET, usage(0, 0, 1_000_000, 0)),
  record(HAIKU, usage(0, 0, 0, 0))
]);

describe("CostSandboxPanel", () => {
  it("渲染三根滑杆的初始假设与瀑布摘要；只有一根杠杆时差值标 0", () => {
    const { container } = render(
      <CostSandboxPanel inputs={inputsOf([record(SONNET, usage(1_000_000, 0, 0, 0))])} days={30} now={NOW} />
    );

    // 当前 $3.00；初始接管 25%（窗口里只有 Sonnet，最便宜的就是它）→ 假设仍 $3.00。
    expect(readouts(container).textContent).toContain("$3.00");
    expect(screen.getAllByText("假设推演 · 不写回设置")[0]).toBeVisible();
    expect(screen.getAllByText("现状").length).toBeGreaterThan(0);

    const cacheSlider = screen.getByRole("slider", { name: "目标缓存命中率" });
    const takeoverSlider = screen.getByRole("slider", { name: "便宜模型接管比例" });
    const outputSlider = screen.getByRole("slider", { name: "输出削减比例" });
    expect(cacheSlider).toHaveValue("20");
    expect(takeoverSlider).toHaveValue("25");
    expect(outputSlider).toHaveValue("15");

    expect(screen.getByRole("img", { name: /成本沙盘：当前 \$3\.00/ })).toBeVisible();
  });

  it("推动缓存滑杆后假设读数实时变化；重置回到初始假设（不是归零）", () => {
    const { container } = render(<CostSandboxPanel inputs={CACHE_SONNET} days={30} now={NOW} />);
    // 初始：缓存 20% + 接管 25% → $2.55。
    expect(readouts(container).textContent).toContain("$2.55");

    const cacheSlider = screen.getByRole("slider", { name: "目标缓存命中率" });
    fireEvent.change(cacheSlider, { target: { value: "50" } });
    expect(cacheSlider).toHaveValue("50");
    // 50% 命中 → 0.75 × $2.025 + 0.25 × $0.675 = $1.6875。
    expect(readouts(container).textContent).toContain("$1.69");

    fireEvent.click(screen.getByRole("button", { name: "重置" }));
    expect(readouts(container).textContent).toContain("$2.55");
    expect(screen.getByRole("slider", { name: "目标缓存命中率" })).toHaveValue("20");
  });

  it("0 / 100 边界：接管 0% 不动，100% 全部按最便宜模型折算", () => {
    const { container } = render(
      <CostSandboxPanel
        inputs={inputsOf([
          record(SONNET, usage(1_000_000, 0, 0, 0)),
          record(HAIKU, usage(0, 0, 0, 0))
        ])}
        days={30}
        now={NOW}
      />
    );
    const takeover = screen.getByRole("slider", { name: "便宜模型接管比例" });
    fireEvent.change(takeover, { target: { value: "0" } });
    // 缓存命中率初始 20% 但这份记录没有可缓存 token，所以仍是 $3.00。
    expect(readouts(container).textContent).toContain("$3.00");

    fireEvent.change(takeover, { target: { value: "100" } });
    expect(readouts(container).textContent).toContain("$1.00");
  });

  it("输出削减上限 50%：$15 → $7.50", () => {
    const { container } = render(
      <CostSandboxPanel
        inputs={inputsOf([record(SONNET, usage(0, 1_000_000, 0, 0))])}
        days={30}
        now={NOW}
      />
    );
    const output = screen.getByRole("slider", { name: "输出削减比例" });
    expect(output).toHaveAttribute("max", "50");
    fireEvent.change(output, { target: { value: "50" } });
    expect(readouts(container).textContent).toContain("$7.50");
  });

  it("当前命中率已在上限：缓存滑杆禁用并标「已在上限」", () => {
    render(
      <CostSandboxPanel
        inputs={inputsOf([record(SONNET, usage(0, 0, 10_000, 990_000))])}
        days={30}
        now={NOW}
      />
    );
    const cacheSlider = screen.getByRole("slider", { name: "目标缓存命中率" });
    expect(cacheSlider).toBeDisabled();
    expect(cacheSlider).toHaveValue("95");
    expect(screen.getAllByText("已在上限").length).toBeGreaterThan(0);
  });

  it("没有可定价用量：不渲染滑杆，空态说明原因并报未定价次数", () => {
    const { container } = render(
      <CostSandboxPanel
        inputs={inputsOf([record("vendor-unknown-model", usage(1_000_000, 0, 0, 0))])}
        days={30}
        now={NOW}
      />
    );
    expect(screen.getByText("所选范围内没有可建模的消耗")).toBeVisible();
    expect(screen.queryAllByRole("slider")).toHaveLength(0);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.getByText(/有 1 次调用因模型未定价无法建模/)
    ).toBeVisible();
    expect(container.querySelector('[data-probe="lab-sandbox"]')).not.toBeNull();
  });

  it("部分未定价：照常建模，但脚注报出未参与建模的次数", () => {
    render(
      <CostSandboxPanel
        inputs={inputsOf([
          record(SONNET, usage(1_000_000, 0, 0, 0)),
          record("vendor-unknown-model", usage(1_000_000, 0, 0, 0))
        ])}
        days={30}
        now={NOW}
      />
    );
    expect(screen.getByText(/另有 1 次调用因模型未定价不参与建模/)).toBeVisible();
  });

  it("瀑布图五根柱都有标签；差值为 0 的柱标 0", () => {
    const { container } = render(
      <CostSandboxPanel
        inputs={inputsOf([record(SONNET, usage(1_000_000, 0, 0, 0))])}
        days={30}
        now={NOW}
      />
    );
    for (const key of ["current", "cache", "swap", "output", "final"]) {
      expect(container.querySelector(`[data-probe="sandbox-bar-${key}"]`)).not.toBeNull();
    }
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("假设成本")).toBeVisible();
  });
});
