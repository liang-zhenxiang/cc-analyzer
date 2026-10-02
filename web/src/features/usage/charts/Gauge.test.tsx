import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Gauge } from "./Gauge";

const gaugeCss = readFileSync(resolve(process.cwd(), "src/features/usage/charts/Gauge.module.css"), "utf8");
const primitiveCss = readFileSync(resolve(process.cwd(), "src/features/usage/charts/chartPrimitives.module.css"), "utf8");

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

  it("用仪表自己的尺寸类，不复用铺满宽度的通用图表规则", () => {
    // 回归防线：正方形仪表若挂回 chartPrimitives 的 `.chart`（`width: 100%`），
    // 作为 flex item 时会被解析成容器宽度并被等比放大——README 首图那个
    // 撑满整屏的巨环就是这么来的。
    render(<Gauge progress={0.5} centerValue="45K" centerLabel="已消耗" ariaLabel="当前窗口" />);
    const classAttr = screen.getByRole("img", { name: "当前窗口" }).getAttribute("class") ?? "";
    expect(classAttr).toContain("gauge");
    expect(classAttr).not.toContain("chart");
  });
});

describe("Gauge 尺寸约束（读 CSS，防通用规则被误改）", () => {
  it("仪表尺寸来自 --gauge-size，且不随容器拉伸", () => {
    expect(gaugeCss).toMatch(/\.gauge\s*\{[^}]*width:\s*var\(--gauge-size\)/s);
    expect(gaugeCss).toMatch(/\.gauge\s*\{[^}]*height:\s*var\(--gauge-size\)/s);
    expect(gaugeCss).toMatch(/\.gauge\s*\{[^}]*flex:\s*0 0 auto/s);
  });

  it("通用图表规则仍是 width:100%——柱状 / 热力 / 堆叠 / 横向条的行为不许被波及", () => {
    expect(primitiveCss).toMatch(/\.chart\s*\{[^}]*width:\s*100%/s);
  });
});
