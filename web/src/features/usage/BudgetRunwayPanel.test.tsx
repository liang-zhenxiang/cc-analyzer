import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { addLocalDays } from "./usageAggregations";
import { BudgetRunwayPanel } from "./BudgetRunwayPanel";
import { weekStartOf } from "./weeklyDigest";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const MONDAY = weekStartOf(NOW);
const DAY_MS = 86_400_000;
let seq = 0;

function record(at: number, tokens: number): SessionRecord {
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
    model: "claude-sonnet-4-5-20250929",
    usage: { inputTokens: tokens, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }
  };
}

/** 周一、周二各 2000：活跃日 2、已用 4000。 */
const TWO_DAYS: UsageSessionInput[] = [
  {
    projectLabel: "-repo-demo",
    records: [
      record(MONDAY + 9 * 3_600_000, 2000),
      record(addLocalDays(MONDAY, 1) + 9 * 3_600_000, 2000)
    ]
  }
];

function readouts(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-probe="runway-readouts"]') as HTMLElement;
}

describe("BudgetRunwayPanel", () => {
  it("设了预算：四格读数、预算线、预测与超出文字都在", () => {
    const { container } = render(
      <BudgetRunwayPanel
        inputs={TWO_DAYS}
        days={30}
        now={NOW}
        plan={{ id: "max5", limitTokens: null, weeklyLimitTokens: 3000 }}
      />
    );

    const cells = readouts(container);
    expect(within(cells).getByText("已用")).toBeVisible();
    expect(within(cells).getByText("4,000")).toBeVisible();
    expect(within(cells).getByText("3,000")).toBeVisible();

    expect(screen.getByRole("img", { name: /预算跑道：本周已用 4,000；预算 3,000/ })).toBeVisible();
    expect(screen.getByText("已超出 1k")).toBeVisible();
    expect(screen.getByText("预算 3k")).toBeVisible();
    expect(screen.queryByText("未设周预算")).not.toBeInTheDocument();
  });

  it("未设预算：不画预算线、不给百分比，但实际线与预测线照画", () => {
    const { container } = render(
      <BudgetRunwayPanel inputs={TWO_DAYS} days={30} now={NOW} plan={undefined} />
    );

    expect(screen.getByText("未设周预算")).toBeVisible();
    expect(screen.getByText(/在「设置 → 计费窗口」里填写周预算/)).toBeVisible();
    expect(screen.queryByText(/^预算 /)).not.toBeInTheDocument();
    // 预测仍然存在：日均 2000，周日读数不是占位符。
    const cells = readouts(container);
    expect(within(cells).getByText("日均")).toBeVisible();
    expect(within(cells).getAllByText("—")).toHaveLength(1); // 只有「预算」一格是 —
    expect(screen.getByRole("img", { name: /按当前速度周日约/ })).toBeVisible();
  });

  it("本周没有任何消耗且未设预算：空态，不画图", () => {
    render(<BudgetRunwayPanel inputs={[]} days={30} now={NOW} plan={undefined} />);
    expect(screen.getByText("本周还没有消耗")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/自然周（周一起），与页头「近 N 天」无关/)).toBeVisible();
  });

  it("0 消耗但设了预算：画预算线，读数 0 / 预算，不推算速度", () => {
    const { container } = render(
      <BudgetRunwayPanel
        inputs={[]}
        days={30}
        now={NOW}
        plan={{ id: "custom", limitTokens: null, weeklyLimitTokens: 120_000 }}
      />
    );
    expect(screen.queryByText("本周还没有消耗")).not.toBeInTheDocument();
    const cells = readouts(container);
    expect(within(cells).getByText("0")).toBeVisible();
    expect(within(cells).getByText("120,000")).toBeVisible();
    expect(screen.getByText("本周还没有消耗，不推算速度。")).toBeVisible();
    expect(screen.getByRole("img", { name: /预算跑道：本周已用 0；预算 120,000/ })).toBeVisible();
  });

  it("活跃日不足 2 天：不画预测，状态行说明原因", () => {
    render(
      <BudgetRunwayPanel
        inputs={[
          {
            projectLabel: "-repo-demo",
            records: [record(MONDAY + 9 * 3_600_000, 1000)]
          }
        ]}
        days={30}
        now={NOW}
        plan={{ id: "custom", limitTokens: null, weeklyLimitTokens: 120_000 }}
      />
    );
    expect(screen.getByText(/活跃日不足 2 天，不推算落地速度/)).toBeVisible();
    expect(screen.getByRole("img", { name: /活跃日不足 2 天，不推算落地速度/ })).toBeVisible();
  });

  it("预测读数的数字与日均一起出现（不编造周日终点）", () => {
    const { container } = render(
      <BudgetRunwayPanel inputs={TWO_DAYS} days={30} now={NOW} plan={undefined} />
    );
    const expected = Math.round(4000 + 2000 * ((addLocalDays(MONDAY, 7) - NOW) / DAY_MS));
    const cells = readouts(container);
    expect(within(cells).getByText("预计周日")).toBeVisible();
    expect(
      within(cells).getByText(expected.toLocaleString("en-US"))
    ).toBeVisible();
  });

  it("状态行不在超预算时使用断定语（只给「超出」事实）", () => {
    render(
      <BudgetRunwayPanel
        inputs={TWO_DAYS}
        days={30}
        now={NOW}
        plan={{ id: "custom", limitTokens: null, weeklyLimitTokens: 3000 }}
      />
    );
    expect(screen.getByText("已超出 1k")).toBeVisible();
    expect(screen.queryByText(/错误/)).not.toBeInTheDocument();
  });
});
