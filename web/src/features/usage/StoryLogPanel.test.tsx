import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { StoryLogPanel } from "./StoryLogPanel";

/** 三天数据：10/30 最忙 14 点，10/28 无消息（只有 tool 记录），10/27 常态。 */
const at = (day: number, hour = 10): number => new Date(2026, 9, day, hour, 0, 0).getTime();

let seq = 0;
function recordOf(timestamp: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    fullId: `s0:r-${seq}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    model: "claude-sonnet-4-5",
    usage: { inputTokens: 600_000 },
    raw: {},
    ...patch
  };
}

function inputOf(records: SessionRecord[], projectLabel = "-repo-demo"): UsageSessionInput {
  return { records, projectLabel };
}

function dayRow(dayLabel: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${dayLabel}`) });
}

function dayRows(): HTMLElement[] {
  return screen.getAllByRole("button").filter((el) => el.dataset.probe === "story-day");
}

/** 连续 N 天各一段会话：用来验证「默认 5 天 + 增量 5 天」。 */
function consecutiveSessions(count: number): UsageSessionInput[] {
  return Array.from({ length: count }, (_, index) =>
    inputOf([recordOf(at(index + 1, 10))], `-repo-${index}`)
  );
}

describe("StoryLogPanel", () => {
  afterEach(cleanup);

  it("空窗口：不冒充日志，给空态提示", () => {
    render(<StoryLogPanel inputs={[]} days={30} />);
    expect(screen.getByText(/这个窗口没有可讲的日志/)).toBeTruthy();
    // 空态下不渲染任何日行。
    expect(screen.queryByRole("button", { name: /10-/ })).toBeNull();
  });

  it("日期倒序：最新的一天排第一行", () => {
    render(
      <StoryLogPanel
        days={30}
        inputs={[
          inputOf([recordOf(at(27, 9))], "-alpha"),
          inputOf([recordOf(at(30, 14))], "-beta"),
          inputOf([recordOf(at(28, 11), { kind: "tool", usage: undefined })], "-gamma")
        ]}
      />
    );
    const rows = dayRows();
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toMatch(/^10-30/);
    expect(rows[1].textContent).toMatch(/^10-28/);
    expect(rows[2].textContent).toMatch(/^10-27/);
  });

  it("收起行读数：会话/项目/token/最忙小时都在一行里", () => {
    render(
      <StoryLogPanel
        days={30}
        inputs={[
          inputOf([recordOf(at(30, 14))], "-alpha"),
          inputOf([recordOf(at(30, 14))], "-beta"),
          inputOf([recordOf(at(30, 15))], "-alpha")
        ]}
      />
    );
    const row = dayRow("10-30");
    expect(row.textContent).toContain("3 会话");
    expect(row.textContent).toContain("2 项目");
    expect(row.textContent).toContain("1.8M");
    // 14 点两条消息、15 点一条 → 最忙 14:00。
    expect(row.textContent).toContain("最忙 14:00");
  });

  it("无消息日：最忙小时写「无消息」而不是猜 0 点", () => {
    render(
      <StoryLogPanel days={30} inputs={[inputOf([recordOf(at(28, 11), { kind: "tool" })])]} />
    );
    const row = dayRow("10-28");
    expect(row.textContent).toContain("无消息");
    expect(row.textContent).not.toContain("最忙");
  });

  it("点击展开：aria-expanded 翻转、当天会话清单出现；再点收起", async () => {
    const user = userEvent.setup();
    render(
      <StoryLogPanel
        days={30}
        inputs={[
          inputOf([recordOf(at(30, 9)), recordOf(at(30, 14))], "-alpha"),
          inputOf([recordOf(at(30, 16))], "-beta")
        ]}
      />
    );
    const row = dayRow("10-30");
    expect(row.getAttribute("aria-expanded")).toBe("false");

    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const detail = screen.getByRole("list", { name: "" });
    expect(detail.dataset.probe).toBe("story-detail");
    // 两个会话各一行（dayReviewOf 的 rows，与日历「一日回望」同一份账）。
    const items = within(detail).getAllByRole("listitem");
    expect(items).toHaveLength(2);

    await user.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("默认只列 5 天：余下按「再显示 5 天」增量展开，按钮写清剩余天数", async () => {
    const user = userEvent.setup();
    render(<StoryLogPanel days={30} inputs={consecutiveSessions(12)} />);

    // 12 天数据，首屏只铺 5 条；日期倒序：10-12 … 10-08。
    expect(dayRows()).toHaveLength(5);
    expect(dayRows()[0].textContent).toMatch(/^10-12/);
    expect(dayRows()[4].textContent).toMatch(/^10-08/);

    const more = screen.getByRole("button", { name: "再显示 5 天（还剩 7 天）" });
    await user.click(more);
    expect(dayRows()).toHaveLength(10);
    expect(dayRows()[9].textContent).toMatch(/^10-03/);

    // 只剩 2 天时不再承诺「5 天」，但仍说清还剩多少。
    await user.click(screen.getByRole("button", { name: "再显示剩余 2 天" }));
    expect(dayRows()).toHaveLength(12);
    expect(screen.queryByRole("button", { name: /再显示/ })).toBeNull();
  });

  it("切换区间后展开量收回 5 天（不把上一个档位的展开状态带过去）", async () => {
    const user = userEvent.setup();
    const inputs = consecutiveSessions(12);
    const { rerender } = render(<StoryLogPanel days={30} inputs={inputs} />);
    expect(dayRows()).toHaveLength(5);

    await user.click(screen.getByRole("button", { name: /再显示/ }));
    expect(dayRows()).toHaveLength(10);

    rerender(<StoryLogPanel days={90} inputs={inputs} />);
    expect(dayRows()).toHaveLength(5);
  });
});
