import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { AccentPicker } from "./AccentPicker";
import { ACCENT_PRESETS } from "./accent";

/** 默认档文案由 ACCENT_PRESETS 决定：测试不再维护第二份文案真相。 */
const blueLabel = ACCENT_PRESETS[0]!.label;

test("六个色块都在同一个 group 里，色块是装饰、名称承担可访问文本", () => {
  render(<AccentPicker value="blue" onChange={() => undefined} />);

  const group = screen.getByRole("group", { name: "强调色" });
  expect(within(group).getAllByRole("button")).toHaveLength(6);
  // 预设与渲染必须同源：漏一套或多一套都会在这里红。
  expect(ACCENT_PRESETS).toHaveLength(6);
  for (const preset of ACCENT_PRESETS) {
    expect(within(group).getByRole("button", { name: preset.label })).toBeInTheDocument();
  }
  // 可访问名里不得混入色值：色块只是眼睛的速览，读屏只听名称。
  expect(group.textContent).not.toMatch(/#[0-9a-f]{6}/i);
  expect(group.querySelectorAll('[aria-hidden="true"]')).toHaveLength(6);
});

test("选中项用 aria-pressed 表达，换值后跟着换", () => {
  const { rerender } = render(<AccentPicker value="rose" onChange={() => undefined} />);

  expect(screen.getByRole("button", { name: "玫红" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: blueLabel })).toHaveAttribute("aria-pressed", "false");

  rerender(<AccentPicker value="teal" onChange={() => undefined} />);
  expect(screen.getByRole("button", { name: "青绿" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "玫红" })).toHaveAttribute("aria-pressed", "false");
});

test("点击色块回调该套 id，且不自行改选中态（受控组件）", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AccentPicker value="blue" onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "琥珀" }));

  expect(onChange).toHaveBeenCalledWith("amber");
  // 父层没回写 value 时，选中态仍停在 blue：组件不持有第二份真相。
  expect(screen.getByRole("button", { name: blueLabel })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "琥珀" })).toHaveAttribute("aria-pressed", "false");
});

test("键盘可达：Tab 逐项进入，Space 与 Enter 都能选中当前项", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<AccentPicker value="blue" onChange={onChange} />);

  await user.tab();
  expect(screen.getByRole("button", { name: blueLabel })).toHaveFocus();

  await user.tab();
  const teal = screen.getByRole("button", { name: "青绿" });
  expect(teal).toHaveFocus();

  await user.keyboard(" ");
  expect(onChange).toHaveBeenLastCalledWith("teal");

  await user.keyboard("{Enter}");
  expect(onChange).toHaveBeenLastCalledWith("teal");
  expect(onChange).toHaveBeenCalledTimes(2);
});
