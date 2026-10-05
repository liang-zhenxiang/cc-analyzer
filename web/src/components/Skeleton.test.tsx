import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Skeleton, SkeletonBar } from "./Skeleton";

test("list skeleton is a labelled status with one title+meta bar per row", () => {
  const { container } = render(<Skeleton variant="list" rows={3} label="正在加载会话列表" />);

  expect(screen.getByRole("status", { name: "正在加载会话列表" })).toBeInTheDocument();
  // 每行两条（标题位 + 元信息位）。
  expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(6);
});

test("table skeleton renders one bar per row", () => {
  const { container } = render(<Skeleton variant="table" rows={8} label="正在解析会话" />);

  expect(screen.getByRole("status", { name: "正在解析会话" })).toBeInTheDocument();
  expect(container.querySelectorAll("[aria-hidden='true']")).toHaveLength(8);
});

test("SkeletonBar is a single aria-hidden bar", () => {
  const { container } = render(<SkeletonBar width="value" />);

  const bar = container.firstElementChild as HTMLElement;
  expect(bar).toHaveAttribute("aria-hidden", "true");
});

/**
 * design §B.2 的关键性质：动画只负责「变暗」这一段，条的基色本身静止可见，
 * 且不设 fill-mode——所以 prefers-reduced-motion 归零动画后，留下的是稳定实心条
 * 而不是空白。这条不变量只能在 CSS 上守（jsdom 不做动画），故读样式表断言。
 */
test("skeleton bars stay visible, not animation-lit, under reduced motion", () => {
  const css = readFileSync(resolve(process.cwd(), "src/components/Skeleton.module.css"), "utf8");
  const rule = /\.bar\s*\{([^}]*)\}/s.exec(css);
  expect(rule, "缺少 .bar 规则").not.toBeNull();
  expect(rule![1]).toContain("background: var(--bg-hover)");
  expect(rule![1]).not.toMatch(/animation-fill-mode/);
  expect(rule![1]).toContain("animation: cca-breathe var(--dur-pulse)");
});

test("骨架带 data-probe-pending，真机取图据此等到内容就绪", () => {
  // 真机取证会在截图前等这个标记消失：它一旦被改名或漏加，用量总览就会
  // 偶发拍到「还在扫描」的那一帧（Issue #118）。
  const { container } = render(<Skeleton variant="table" rows={2} label="正在解析会话" />);
  expect(container.querySelector("[data-probe-pending]")).toBeTruthy();
  expect(screen.getByRole("status", { name: "正在解析会话" })).toHaveAttribute(
    "data-probe-pending"
  );

  const bar = render(<SkeletonBar width="mid" />);
  expect(bar.container.querySelector("[data-probe-pending]")).toBeTruthy();
});
