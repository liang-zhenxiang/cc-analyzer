import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EquivalentsToggle } from "./EquivalentsToggle";

describe("EquivalentsToggle（D10 日常事物换算）", () => {
  it("展开后四条换算逐条给出数值、单位与依据", async () => {
    const user = userEvent.setup();
    render(<EquivalentsToggle tokens={3_000_000} />);

    const toggle = screen.getByRole("button", { name: /换算成日常事物/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("2 杯咖啡");
    expect(rows[0]).toHaveTextContent("按一次深度推理≈150 万 token 估");
    expect(rows[1]).toHaveTextContent("25 本长篇小说");
    expect(rows[3]).toHaveTextContent("100 克 CO₂e（估算）");
  });

  it("不足一个单位时写「不足 1」，不写 0", async () => {
    const user = userEvent.setup();
    render(<EquivalentsToggle tokens={10} />);

    await user.click(screen.getByRole("button", { name: /换算成日常事物/ }));
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("不足 1 杯咖啡");
  });

  it("token 为 0 时禁用换算，并用 title 说明原因", () => {
    render(<EquivalentsToggle tokens={0} />);

    const toggle = screen.getByRole("button", { name: /换算成日常事物/ });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("title", "本窗口没有 token 可换算");
  });
});
