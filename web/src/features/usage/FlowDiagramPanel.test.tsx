import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  type ProjectModelCross,
  type RangeAggregate,
  type UsageSlice,
  type UsageTotals
} from "./usageAggregations";
import { buildFlowDiagram } from "./flowDiagram";
import { FlowDiagramPanel } from "./FlowDiagramPanel";

/**
 * 组件直挂：三层节点、连线、<title> 读数、空态与悬停路径高亮。夹具经
 * `buildFlowDiagram` 生成，与逻辑层共用同一套数字，不在组件测试里手造图。
 */

function totals(
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): UsageTotals {
  return { input, output, cacheCreation, cacheRead };
}

function rangeOf(
  topProjects: UsageSlice[],
  topModels: UsageSlice[],
  cross?: ProjectModelCross
): RangeAggregate {
  return {
    sessionCount: 0,
    messages: 0,
    totals: totals(0, 0, 0, 0),
    daily: new Map(),
    models: new Map(),
    projects: new Map(),
    hourly: [],
    dailySeries: [],
    topProjects,
    topModels,
    kpi: { sessions: 0, messages: 0, tokens: 0 },
    ...(cross ? { cross } : {})
  };
}

function diagramFixture() {
  const cross: ProjectModelCross = new Map([
    ["-repo-alpha", new Map([["claude-sonnet-4-5-20250929", totals(100, 20, 30, 400)]])],
    ["-repo-beta", new Map([["claude-haiku-4-5-20251001", totals(50, 0, 0, 0)]])]
  ]);
  const range = rangeOf(
    [
      { label: "-repo-alpha", value: 550 },
      { label: "-repo-beta", value: 50 }
    ],
    [
      { label: "claude-sonnet-4-5-20250929", value: 550 },
      { label: "claude-haiku-4-5-20251001", value: 50 }
    ],
    cross
  );
  return buildFlowDiagram(
    range,
    new Map([
      ["-repo-alpha", "/Users/tester/work/cc-analyzer"],
      ["-repo-beta", "/Users/tester/work/beta"]
    ])
  );
}

function linksOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-flow-link]"));
}

function activeLinksOf(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-flow-link-active="true"]'));
}

describe("FlowDiagramPanel", () => {
  it("renders the panel title and one descriptive image for the flow", () => {
    const container = render(<FlowDiagramPanel diagram={diagramFixture()} />).container;
    expect(screen.getByRole("heading", { name: "Token 流向" })).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Token 从 2 个项目流向 2 个模型和 4 类计数器" })
    ).toBeInTheDocument();
    expect(container.querySelector('[data-probe="flow-root"]')).not.toBeNull();
  });

  it("labels projects, models and counters with their token values", () => {
    render(<FlowDiagramPanel diagram={diagramFixture()} />);

    expect(screen.getByText("cc-analyzer")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    // Middle-column labels print the display name and the total in one run.
    expect(screen.getByText("Sonnet 4.5 550")).toBeInTheDocument();
    expect(screen.getByText("Haiku 4.5 50")).toBeInTheDocument();
    expect(screen.getByText("输入")).toBeInTheDocument();
    expect(screen.getByText("输出")).toBeInTheDocument();
    expect(screen.getByText("缓存写入")).toBeInTheDocument();
    expect(screen.getByText("缓存读取")).toBeInTheDocument();
    // Alpha's project bar reads 550; the counter column reads the four states.
    expect(screen.getAllByText("550")).toHaveLength(1);
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("400")).toBeInTheDocument();
  });

  it("draws one ribbon per real link and titles each with its two ends and tokens", () => {
    const container = render(<FlowDiagramPanel diagram={diagramFixture()} />).container;
    const links = linksOf(container);
    // 2 project → model + 4 sonnet counters + 1 haiku counter = 7
    expect(links).toHaveLength(7);
    const projectModel = links.find((link) =>
      (link.getAttribute("data-flow-link") ?? "").startsWith("pm:")
    );
    expect(projectModel?.querySelector("title")?.textContent).toBe(
      "cc-analyzer → Sonnet 4.5：550 tok"
    );
    const modelCategory = links.find((link) =>
      (link.getAttribute("data-flow-link") ?? "").startsWith("mc:")
    );
    expect(modelCategory?.querySelector("title")?.textContent).toBe(
      "Sonnet 4.5 → 输入：100 tok"
    );
    expect(container.querySelectorAll("[data-flow-node]")).toHaveLength(8);
  });

  it("highlights the whole path when a project → model ribbon is hovered", () => {
    const container = render(<FlowDiagramPanel diagram={diagramFixture()} />).container;
    const hit = Array.from(container.querySelectorAll<HTMLElement>("[data-flow-hit]")).find(
      (element) => (element.getAttribute("data-flow-hit") ?? "").startsWith("pm:")
    );
    expect(hit).toBeDefined();
    fireEvent.mouseEnter(hit as HTMLElement);

    // The hovered project→model ribbon plus the four counters that model feeds.
    expect(activeLinksOf(container)).toHaveLength(5);
    const active = activeLinksOf(container)
      .map((link) => link.getAttribute("data-flow-link") ?? "")
      .sort();
    expect(active.some((id) => id.startsWith("pm:"))).toBe(true);
    expect(active.filter((id) => id.startsWith("mc:"))).toHaveLength(4);

    fireEvent.mouseLeave(hit as HTMLElement);
    expect(activeLinksOf(container)).toHaveLength(0);
  });

  it("highlights the project side when a model → counter ribbon is hovered", () => {
    const container = render(<FlowDiagramPanel diagram={diagramFixture()} />).container;
    const hits = Array.from(container.querySelectorAll<HTMLElement>("[data-flow-hit]"));
    const haikuInput = hits.find((element) =>
      (element.getAttribute("data-flow-hit") ?? "").startsWith("mc:claude-haiku")
    );
    expect(haikuInput).toBeDefined();
    fireEvent.mouseEnter(haikuInput as HTMLElement);

    const active = activeLinksOf(container)
      .map((link) => link.getAttribute("data-flow-link") ?? "")
      .sort();
    expect(active).toEqual(["mc:claude-haiku-4-5-20251001::input", "pm:-repo-beta::claude-haiku-4-5-20251001"]);
  });

  it("falls back to an empty state when there is no token flow", () => {
    const diagram = buildFlowDiagram(rangeOf([], [], new Map()), new Map());
    const container = render(<FlowDiagramPanel diagram={diagram} />).container;
    expect(screen.getByText("所选范围内暂无消耗流向")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Token 从/ })).toBeNull();
    expect(container.querySelector('[data-probe="flow-root"]')).not.toBeNull();
  });
});
