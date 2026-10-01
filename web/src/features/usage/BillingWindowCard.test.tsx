import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { SessionRecord } from "../sessions/types";
import { BillingWindowCard } from "./BillingWindowCard";
import { setPlan } from "./planLimits";
import type { UsageSessionInput } from "./usageAggregations";

const T0 = new Date(2026, 9, 2, 9, 0, 0).getTime();
const HOUR = 3_600_000;

function record(at: number, input = 10_000): SessionRecord {
  return {
    id: `r-${at}`,
    kind: "assistant",
    timestamp: at,
    usage: { inputTokens: input, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  } as unknown as SessionRecord;
}

function inputsOf(records: SessionRecord[]): UsageSessionInput[] {
  return [{ records, projectLabel: "-repo-demo" }];
}

describe("BillingWindowCard", () => {
  afterEach(() => {
    cleanup();
    setPlan({ id: "none", limitTokens: null });
  });

  it("无任何会话 → 整卡不渲染", () => {
    const { container } = render(<BillingWindowCard inputs={[]} now={T0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("读出窗口开启时刻与关闭倒计时，读数标注读自日志", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0), record(T0 + HOUR)])} now={T0 + 2 * HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getByText("09:00")).toBeInTheDocument();
    // 5h 窗口已过 2h → 还剩 3 小时
    expect(within(card).getByText("3 时 0 分")).toBeInTheDocument();
    expect(within(card).getAllByText("读自日志").length).toBeGreaterThan(0);
  });

  it("未选计划：只有消耗没有百分比，提示去设置选择", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getByText("未选计划")).toBeInTheDocument();
    expect(within(card).getByText(/未选择订阅计划/)).toBeInTheDocument();
  });

  it("选了计划：仪表读出限额百分比的可访问名与估算口径说明", () => {
    setPlan({ id: "pro", limitTokens: 19_000 });
    render(<BillingWindowCard inputs={inputsOf([record(T0, 19_000)])} now={T0 + HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(screen.getByRole("img", { name: /已用 100%/ })).toBeInTheDocument();
    expect(within(card).getByText(/社区整理的估算值/)).toBeInTheDocument();
  });

  it("样本不足时速度与预测都说样本不足，不编数字", () => {
    setPlan({ id: "pro", limitTokens: 19_000 });
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + 10 * 60_000} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getAllByText("样本不足")).toHaveLength(2);
  });

  it("样本充足时给出推算徽章与预计到达的具体时刻", () => {
    setPlan({ id: "pro", limitTokens: 38_000 });
    // 2h 消耗 19k → 9.5k/h，剩 19k → 再过 2h 到限额
    render(<BillingWindowCard inputs={inputsOf([record(T0, 19_000)])} now={T0 + 2 * HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getAllByText("按消耗速度推算").length).toBeGreaterThanOrEqual(2);
    // T0+2h 起再 2h → 13:00（同日）
    expect(within(card).getByText("10-02 13:00")).toBeInTheDocument();
  });
});
