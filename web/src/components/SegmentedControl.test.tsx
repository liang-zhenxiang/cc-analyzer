import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedControl } from "./SegmentedControl";

/** 受控测试壳：把选中态收在本地，模拟真实调用点（value + onChange）。 */
function Harness({ disabled = [] as string[] }) {
  const [value, setValue] = useState("a");
  return (
    <SegmentedControl
      items={[
        { value: "a", label: "甲" },
        { value: "b", label: "乙", disabled: disabled.includes("b") },
        { value: "c", label: "丙" }
      ]}
      value={value}
      onChange={setValue}
      ariaLabel="测试分组"
    />
  );
}

test("renders a tablist and marks the selected tab", () => {
  render(<Harness />);

  expect(screen.getByRole("tablist", { name: "测试分组" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "甲", selected: true })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "乙", selected: false })).toBeInTheDocument();
});

test("keeps a roving tabindex: only the selected tab is reachable by Tab", () => {
  render(<Harness />);

  expect(screen.getByRole("tab", { name: "甲" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("tab", { name: "乙" })).toHaveAttribute("tabindex", "-1");
  expect(screen.getByRole("tab", { name: "丙" })).toHaveAttribute("tabindex", "-1");
});

test("activates on click", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  await user.click(screen.getByRole("tab", { name: "丙" }));
  expect(screen.getByRole("tab", { name: "丙", selected: true })).toBeInTheDocument();
});

test("arrow keys move focus and selection, wrapping around", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  screen.getByRole("tab", { name: "甲" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "乙", selected: true })).toHaveFocus();

  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "甲", selected: true })).toHaveFocus();

  // 环绕：首项 ← 末项
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "丙", selected: true })).toHaveFocus();
});

test("Home and End jump to the first and last tab", async () => {
  const user = userEvent.setup();
  render(<Harness />);

  screen.getByRole("tab", { name: "乙" }).focus();
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "丙", selected: true })).toHaveFocus();

  await user.keyboard("{Home}");
  expect(screen.getByRole("tab", { name: "甲", selected: true })).toHaveFocus();
});

test("skips disabled tabs while moving with arrow keys", async () => {
  const user = userEvent.setup();
  render(<Harness disabled={["b"]} />);

  screen.getByRole("tab", { name: "甲" }).focus();
  // 「乙」被禁用，方向键直接落到「丙」。
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "丙", selected: true })).toHaveFocus();
});
