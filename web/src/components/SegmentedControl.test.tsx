import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

/**
 * Round U（Issue #73）高对比度档：选中滑块的分界用 **1px 内描边**画出来。
 *
 * 不用 `border` 是维护者裁决：`.item` 是内容自适应宽度，实线边框会把外框撑大 2px
 * （实测 Chromium 60×36 → 62×38、WebKit 58.55×36 → 60.55×38），与「高对比度只动
 * 颜色」的红线冲突；`inset 0 0 0 1px` 在两端跨档 delta = 0。
 *
 * 这是源码静态守卫——jsdom 不做布局，真实几何由 `web/e2e/high-contrast.spec.ts` 把关。
 */
test("高对比度只叠一条内描边，不用 border、不改尺寸", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/SegmentedControl.module.css"),
    "utf8"
  );
  // 注释里出现 `border` / `box-sizing` 这些词是解释，不参与判据。
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = /:global\(\[data-contrast="high"\]\)[^{]*\{([^{}]*)\}/.exec(css);
  expect(block, "SegmentedControl.module.css 里找不到高对比度选中态规则").not.toBeNull();

  const selector = block![0].slice(0, block![0].indexOf("{"));
  const body = block![1];

  // 选择器收窄到高对比度，且两条选中态都被覆盖（tablist 用 aria-selected，radiogroup 用 aria-checked）。
  expect(selector).toContain('[aria-selected="true"]');
  expect(selector).toContain('[aria-checked="true"]');

  // 画法是内描边 + 保留原有的 --shadow-sm，不是实线边框。
  expect(body).toMatch(
    /box-shadow:\s*var\(--shadow-sm\)\s*,\s*inset\s+0\s+0\s+0\s+1px\s+var\(--border-strong\)/
  );
  expect(body).not.toMatch(/(?:^|[;\s])border\s*:/);

  // 尺寸类属性一律不得出现——这条只换颜色边界。
  for (const property of ["padding", "width", "min-height"]) {
    expect(body, `高对比度规则里出现了尺寸属性 ${property}`).not.toMatch(
      new RegExp(`(?:^|[;\\s])${property}\\s*:`)
    );
  }
});
