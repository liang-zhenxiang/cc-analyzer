import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { SessionRecord } from "../sessions/types";
import { BillingWindowCard } from "./BillingWindowCard";
import { setPlan } from "./planLimits";
import type { UsageSessionInput } from "./usageAggregations";

const T0 = new Date(2026, 9, 2, 9, 0, 0).getTime();
const HOUR = 3_600_000;
const DAY = 86_400_000;

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

/** 周层的断言作用域：卡内还有 5 小时层，读数不能裸查。 */
function weeklySection() {
  return screen.getByLabelText("周用量（滚动 7 天）");
}

describe("BillingWindowCard", () => {
  afterEach(() => {
    cleanup();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
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
    setPlan({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: null });
    render(<BillingWindowCard inputs={inputsOf([record(T0, 19_000)])} now={T0 + HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(screen.getByRole("img", { name: /已用 100%/ })).toBeInTheDocument();
    expect(within(card).getByText(/社区整理的估算值/)).toBeInTheDocument();
  });

  it("样本不足时速度与预测都说样本不足，不编数字", () => {
    setPlan({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: null });
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + 10 * 60_000} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getAllByText("样本不足")).toHaveLength(2);
  });

  it("样本充足时给出推算徽章与预计到达的具体时刻", () => {
    setPlan({ id: "pro", limitTokens: 38_000, weeklyLimitTokens: null });
    // 2h 消耗 19k → 9.5k/h，剩 19k → 再过 2h 到限额
    render(<BillingWindowCard inputs={inputsOf([record(T0, 19_000)])} now={T0 + 2 * HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    // 推算徽章（圆点；完整句子在可访问名上）共三枚：5h 层的速度与预测两枚，
    // 加上周层日均线的一枚（同为「按消耗速度推算」的口径，未设预算时周层没有别的）。
    expect(within(card).getAllByLabelText(/数据来源：按消耗速度推算/)).toHaveLength(3);
    // T0+2h 起再 2h → 13:00（同日）
    expect(within(card).getByText("10-02 13:00")).toBeInTheDocument();
  });
});

describe("BillingWindowCard · 滚动 7 天层", () => {
  afterEach(() => {
    cleanup();
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  });

  it("滚动 7 天读数与「不是官方重置窗口」的说明同时在场", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0), record(T0 + HOUR)])} now={T0 + 2 * HOUR} />);
    const weekly = weeklySection();
    expect(within(weekly).getByText("滚动 7 天", { exact: true })).toBeInTheDocument();
    // 两条记录都在 7 天窗内 → 20,000
    expect(within(weekly).getByText("20,000")).toBeInTheDocument();
    expect(within(weekly).getByText(/不是官方重置窗口/)).toBeInTheDocument();
  });

  it("两个限额层各有层名，5 小时层不因为新增周层而失语", () => {
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + HOUR} />);
    const card = screen.getByLabelText("计费窗口");
    expect(within(card).getByText("5 小时窗口", { exact: true })).toBeInTheDocument();
    expect(within(card).getByText("滚动 7 天", { exact: true })).toBeInTheDocument();
  });

  it("未设周预算：只显示消耗与对照信息，不渲染任何百分比字符串", () => {
    // 即使 5h 层选了计划，周层没预算也不给百分比——分母缺一档就少一档比率。
    setPlan({ id: "pro", limitTokens: 19_000, weeklyLimitTokens: null });
    render(<BillingWindowCard inputs={inputsOf([record(T0)])} now={T0 + HOUR} />);
    const weekly = weeklySection();
    expect(within(weekly).getByText(/未设周预算/)).toBeInTheDocument();
    expect(within(weekly).queryByText(/\d+\s*%/)).toBeNull();
    // 上一周期没有数据时如实说 0，不造一个 ±100% 的「趋势」。
    expect(within(weekly).getByText("上一周期 0")).toBeInTheDocument();
  });

  it("两边都有数据时给出较上一周期的百分比", () => {
    render(
      <BillingWindowCard inputs={inputsOf([record(T0 - 8 * DAY), record(T0)])} now={T0 + HOUR} />
    );
    const weekly = weeklySection();
    expect(within(weekly).getByText("较上一周期 0%")).toBeInTheDocument();
  });

  it("设了周预算：出现预算百分比、日均推算与推算徽章", () => {
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 100_000 });
    // 两个不同本地日 → activeDays 2，可推算；消耗 30k → 30%。
    render(
      <BillingWindowCard inputs={inputsOf([record(T0 - 3 * DAY), record(T0, 20_000)])} now={T0 + HOUR} />
    );
    const weekly = weeklySection();
    expect(within(weekly).getByText(/周预算已用 30%/)).toBeInTheDocument();
    expect(within(weekly).getByText(/按日均推算 .* 触达/)).toBeInTheDocument();
    expect(within(weekly).getAllByLabelText(/按近 7 天日均外推/)).toHaveLength(1);
  });

  it("活动日不足 → 推算位明说样本不足，不编日期", () => {
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 100_000 });
    // 全部记录都在同一个本地日 → activeDays 1。
    render(<BillingWindowCard inputs={inputsOf([record(T0), record(T0 + HOUR)])} now={T0 + 2 * HOUR} />);
    const weekly = weeklySection();
    expect(within(weekly).getByText("样本不足，不外推")).toBeInTheDocument();
    expect(within(weekly).queryByText(/按日均推算/)).toBeNull();
  });

  it("已超周预算 → 说已达预算，不给出过去的触达时刻", () => {
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: 15_000 });
    render(
      <BillingWindowCard inputs={inputsOf([record(T0 - 3 * DAY), record(T0)])} now={T0 + HOUR} />
    );
    const weekly = weeklySection();
    expect(within(weekly).getByText("已达预算")).toBeInTheDocument();
  });
});
