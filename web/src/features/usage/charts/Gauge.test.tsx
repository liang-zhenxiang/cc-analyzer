import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Gauge } from "./Gauge";

describe("Gauge（计费窗口仪表）", () => {
  it("渲染读数与可访问名，进度弧按比例画弧长", () => {
    const { container } = render(
      <Gauge progress={0.5} centerValue="45.0K" centerLabel="已消耗" ariaLabel="当前窗口已消耗 45% 限额" />
    );
    expect(screen.getByRole("img", { name: "当前窗口已消耗 45% 限额" })).toBeInTheDocument();
    expect(screen.getByText("45.0K")).toBeInTheDocument();
    expect(screen.getByText("已消耗")).toBeInTheDocument();
    const circles = container.querySelectorAll("circle");
    // 第二个圆是进度弧：50% 进度 → dasharray 首值 = 周长的一半
    const arc = circles[1];
    const dash = Number(arc.getAttribute("stroke-dasharray")?.split(" ")[0]);
    const circumference = Number(arc.getAttribute("stroke-dasharray")?.split(" ")[1]);
    expect(dash).toBeCloseTo(circumference / 2, 0);
  });

  it("progress 为 null（未选计划）→ 进度弧透明，只留底环与读数", () => {
    const { container } = render(
      <Gauge progress={null} centerValue="12K" centerLabel="已消耗" ariaLabel="当前窗口消耗" />
    );
    const arc = container.querySelectorAll("circle")[1];
    expect(arc.getAttribute("class")).toContain("inert");
    expect(screen.getByText("12K")).toBeInTheDocument();
  });

  it("progress 超界被钳制到 1", () => {
    const { container } = render(
      <Gauge progress={1.7} centerValue="99K" centerLabel="已消耗" ariaLabel="当前窗口" />
    );
    const arc = container.querySelectorAll("circle")[1];
    const [dash, circumference] = arc
      .getAttribute("stroke-dasharray")!
      .split(" ")
      .map(Number);
    expect(dash).toBe(circumference);
  });
});
