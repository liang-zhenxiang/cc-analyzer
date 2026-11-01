import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BriefingItem } from "./dailyBriefing";
import { BriefingStrip } from "./BriefingStrip";

function item(patch: Partial<BriefingItem> & Pick<BriefingItem, "id" | "kind">): BriefingItem {
  return {
    rank: 1,
    headline: "用量陡增：环比 +120%",
    target: "usage",
    ...patch
  };
}

describe("BriefingStrip", () => {
  it("renders nothing when the model has nothing worth saying", () => {
    const { container } = render(<BriefingStrip items={[]} onNavigate={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders up to three items in rank order with tag prefixes and navigation targets", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const items: BriefingItem[] = [
      item({ id: "errors", kind: "errors", rank: 2, headline: "错误聚集：共 12 条", target: "errors" }),
      item({ id: "budget", kind: "budget", rank: 1, headline: "限额预计用到 96%", target: "usage" }),
      item({ id: "quiet", kind: "quiet", rank: 3, headline: "已连续 4 天零消息", target: "milestones" })
    ];

    render(<BriefingStrip items={items} onNavigate={onNavigate} />);

    const strip = screen.getByRole("region", { name: "今天值得注意的三件事" });
    const rows = within(strip).getAllByRole("button");
    expect(rows.map((row) => row.textContent)).toEqual([
      "警报 预算限额预计用到 96%",
      "警报 错误错误聚集：共 12 条",
      "注意 安静已连续 4 天零消息"
    ]);

    await user.click(rows[0]);
    expect(onNavigate).toHaveBeenCalledWith("usage");
    await user.click(rows[1]);
    expect(onNavigate).toHaveBeenLastCalledWith("errors");
    await user.click(rows[2]);
    expect(onNavigate).toHaveBeenLastCalledWith("milestones");
  });

  it("keeps a neutral item prefix-free and puts the numeric detail in the tooltip", () => {
    render(
      <BriefingStrip
        items={[
          item({
            id: "spike",
            kind: "spike",
            headline: "用量陡增：环比 +120%",
            detail: "昨日 2.4M tok，前日 1.0M tok"
          })
        ]}
        onNavigate={vi.fn()}
      />
    );

    const row = screen.getByRole("button");
    expect(row.textContent).toBe("昨日用量陡增：环比 +120%");
    expect(row.getAttribute("title")).toBe("用量陡增：环比 +120%（昨日 2.4M tok，前日 1.0M tok）");
    // 只有一条时按 1 列排，不留两份空位。
    expect(screen.getByRole("region").getAttribute("data-count")).toBe("1");
  });

  it("shows as many items as the model returned, without padding", () => {
    render(
      <BriefingStrip
        items={[
          item({ id: "anomaly", kind: "anomaly", rank: 1, headline: "01-02 用量异常（+3.4σ）" }),
          item({ id: "drop", kind: "drop", rank: 2, headline: "用量陡降：环比 −60%" })
        ]}
        onNavigate={vi.fn()}
      />
    );

    const strip = screen.getByRole("region");
    expect(strip.getAttribute("data-count")).toBe("2");
    expect(within(strip).getAllByRole("button")).toHaveLength(2);
    expect(within(strip).queryByText(/错误/)).toBeNull();
  });
});
