import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Heatmap } from "./Heatmap";

function emptyCounts(): number[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
}

describe("Heatmap", () => {
  it("renders 7x24 cells with weekday rows and thinned hour labels", () => {
    const counts = emptyCounts();
    counts[4][14] = 5;

    render(<Heatmap counts={counts} ariaLabel="活跃时段热力图" />);

    const svg = screen.getByRole("img", { name: "活跃时段热力图" });
    expect(svg.querySelectorAll("rect")).toHaveLength(7 * 24);
    // Monday-first rows: 一 first, 日 last.
    expect(svg.textContent).toContain("一");
    expect(svg.textContent).toContain("日");
    // The hour axis thins to every 4th hour (tooltips still cover all 24).
    const hourLabels = Array.from(svg.children)
      .filter((element) => element.tagName === "text")
      .map((element) => element.textContent);
    expect(hourLabels).toEqual(["0", "4", "8", "12", "16", "20"]);
  });

  it("titles each cell with weekday, hour and message count", () => {
    const counts = emptyCounts();
    counts[4][14] = 5;

    render(<Heatmap counts={counts} ariaLabel="活跃时段热力图" />);

    const titles = Array.from(screen.getByRole("img", { name: "活跃时段热力图" }).querySelectorAll("title")).map(
      (title) => title.textContent
    );
    expect(titles).toContain("四 14时：5 条消息");
    expect(titles).toContain("一 0时：0 条消息");
  });

  it("scales cell opacity by the count ladder", () => {
    const counts = emptyCounts();
    counts[1][9] = 2; // getDay() 1 = Monday 09:00, half of the max
    counts[3][20] = 4; // getDay() 3 = Wednesday 20:00, the max itself

    render(<Heatmap counts={counts} ariaLabel="活跃时段热力图" />);

    const cells = Array.from(screen.getByRole("img", { name: "活跃时段热力图" }).querySelectorAll("rect"));
    const monday = cells.find((cell) => cell.querySelector("title")?.textContent === "一 9时：2 条消息")!;
    const wednesday = cells.find((cell) => cell.querySelector("title")?.textContent === "三 20时：4 条消息")!;
    expect(Number.parseFloat(monday.getAttribute("fill-opacity") ?? "0")).toBeLessThan(
      Number.parseFloat(wednesday.getAttribute("fill-opacity") ?? "0")
    );
  });

  it("shows empty-state copy when nothing was counted", () => {
    render(<Heatmap counts={emptyCounts()} ariaLabel="活跃时段热力图" emptyText="还没有活跃时段" />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("还没有活跃时段")).toBeInTheDocument();
  });

  it("渲染四档色阶图例，档位与格子同一套阶梯", () => {
    const counts = emptyCounts();
    counts[1][9] = 1;
    counts[1][10] = 4;

    const { container } = render(<Heatmap counts={counts} ariaLabel="活跃时段热力图" />);

    const legend = container.querySelector("[data-heat-legend]");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toBe("少多");
    const opacities = Array.from(legend!.querySelectorAll("[aria-hidden='true']")).map((cell) =>
      Number.parseFloat((cell as HTMLElement).style.opacity)
    );
    // 四档，且自浅到深单调——没有刻度的热力图读不出「多热算热」。
    expect(opacities).toHaveLength(4);
    for (let index = 1; index < opacities.length; index += 1) {
      expect(opacities[index]).toBeGreaterThan(opacities[index - 1]);
    }
    // 图例与格子上限同一档（最热的那一格）。
    const hottest = Array.from(
      screen.getByRole("img", { name: "活跃时段热力图" }).querySelectorAll("rect")
    )
      .map((cell) => Number.parseFloat(cell.getAttribute("fill-opacity") ?? "0"))
      .reduce((highest, value) => Math.max(highest, value), 0);
    expect(hottest).toBe(opacities[opacities.length - 1]);
  });

  it("空格子只有填充，没有描边", () => {
    // 描边在 CSS Module 里，jsdom 不解析样式表——按仓库既有做法直接读样式文件。
    const css = readFileSync(resolve(process.cwd(), "src/features/usage/charts/Heatmap.module.css"), "utf8");
    const rule = /\.emptyCell\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).not.toMatch(/stroke/);
  });
});
