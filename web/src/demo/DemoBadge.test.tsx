import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { DemoBadge } from "./DemoBadge";
import { DEMO_EXIT_EVENT } from "./demoMode";

afterEach(() => {
  vi.restoreAllMocks();
});

test("徽章常驻显示演示标记，并提供可访问的退出入口", () => {
  render(<DemoBadge />);

  expect(screen.getByText("演示数据 · 不会读取你的会话")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "退出演示" })).toBeInTheDocument();
  expect(document.querySelector('[data-probe="demo-badge"]')).not.toBeNull();
});

test("点击退出按钮只派发事件，由 App 统一改写持久化状态", () => {
  const onExit = vi.fn();
  window.addEventListener(DEMO_EXIT_EVENT, onExit);

  render(<DemoBadge />);
  fireEvent.click(screen.getByRole("button", { name: "退出演示" }));

  expect(onExit).toHaveBeenCalledTimes(1);
  window.removeEventListener(DEMO_EXIT_EVENT, onExit);
});
