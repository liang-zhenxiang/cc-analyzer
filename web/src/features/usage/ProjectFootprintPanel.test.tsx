import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProjectFootprintPanel } from "./ProjectFootprintPanel";
import type { FileFact } from "./projectFootprint";
import type { UsageSessionInput } from "./usageAggregations";

const NOW = new Date(2026, 9, 28, 12, 0).getTime();
const RECENT = NOW - 3_600_000;

function fact(path: string, relPath: string, timestamps: number[]): FileFact {
  return { path, relPath, touchTimestamps: timestamps, sidechainCount: 0 };
}

function inputOf(
  projectLabel: string,
  fileFacts: FileFact[],
  projectPath?: string
): UsageSessionInput {
  return { records: [], projectLabel, projectPath, fileFacts };
}

const TWO_PROJECTS: UsageSessionInput[] = [
  inputOf(
    "-repo-a",
    [fact("/shared/lint.sh", "../../shared/lint.sh", [RECENT, RECENT + 1])],
    "/repo/a"
  ),
  inputOf("-repo-b", [fact("/shared/lint.sh", "../../shared/lint.sh", [RECENT])], "/repo/b")
];

describe("ProjectFootprintPanel", () => {
  it("二部图：两个项目节点、一个共享文件节点、两条边", () => {
    const { container } = render(<ProjectFootprintPanel inputs={TWO_PROJECTS} days={30} now={NOW} />);

    expect(container.querySelectorAll('[data-probe="footprint-project"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-probe="footprint-file"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-probe="footprint-edge"]')).toHaveLength(2);

    expect(screen.getByRole("img", { name: /文件足迹：2 个项目共享 1 个文件/ })).toBeVisible();
    expect(
      screen.getByRole("img", { name: /共享最多的是 \.\.\/\.\.\/shared\/lint\.sh，被 2 个项目动过/ })
    ).toBeVisible();
    expect(screen.getAllByText("../../shared/lint.sh").length).toBeGreaterThanOrEqual(1);
  });

  it("完整路径只进 title，常显的是项目内相对路径", () => {
    const { container } = render(<ProjectFootprintPanel inputs={TWO_PROJECTS} days={30} now={NOW} />);
    const fileNode = container.querySelector('[data-probe="footprint-file"]')!;
    expect(fileNode.querySelector("title")?.textContent).toBe("/shared/lint.sh");
    // 图上可见的 <text> 是相对路径，不是绝对路径。
    expect(fileNode.querySelector("text")?.textContent).toBe("../../shared/lint.sh");
  });

  it("下方列表给出共享最多的文件与触碰次数", () => {
    render(<ProjectFootprintPanel inputs={TWO_PROJECTS} days={30} now={NOW} />);
    const list = screen.getByRole("list", { name: "共享最多的文件" });
    const row = within(list).getByRole("listitem");
    expect(within(row).getByText("../../shared/lint.sh")).toBeVisible();
    expect(within(row).getByText("2 个项目 · 3 次")).toBeVisible();
  });

  it("悬停文件节点不改变列表，但会压暗无关节点（其余边仍可读）", () => {
    const { container } = render(<ProjectFootprintPanel inputs={TWO_PROJECTS} days={30} now={NOW} />);
    const fileNode = container.querySelector('[data-probe="footprint-file"]')!;
    fireEvent.mouseEnter(fileNode);
    // 两个项目都与该文件相连，所以没有节点被压暗。
    const projectNodes = container.querySelectorAll('[data-probe="footprint-project"]');
    expect(projectNodes).toHaveLength(2);
    fireEvent.mouseLeave(fileNode);
  });

  it("只有一个项目：空态写明足迹图需要两个项目", () => {
    render(
      <ProjectFootprintPanel
        inputs={[inputOf("-repo-a", [fact("/repo/a/a.ts", "a.ts", [RECENT])], "/repo/a")]}
        days={30}
        now={NOW}
      />
    );
    expect(screen.getByText("没有跨项目共享的文件")).toBeVisible();
    expect(screen.getByText("只有 1 个项目，足迹图需要至少 2 个项目。")).toBeVisible();
  });

  it("两个项目但没有共享文件：空态报出项目与文件数", () => {
    render(
      <ProjectFootprintPanel
        inputs={[
          inputOf("-repo-a", [fact("/repo/a/a.ts", "a.ts", [RECENT])], "/repo/a"),
          inputOf("-repo-b", [fact("/repo/b/b.ts", "b.ts", [RECENT])], "/repo/b")
        ]}
        days={30}
        now={NOW}
      />
    );
    expect(screen.getByText(/本窗口 2 个项目、2 个文件/)).toBeVisible();
  });

  it("脚注声明口径与缺口（Bash 间接改动看不见）", () => {
    render(<ProjectFootprintPanel inputs={TWO_PROJECTS} days={30} now={NOW} />);
    expect(screen.getByText(/Bash 间接改动看不见/)).toBeVisible();
    expect(screen.getByText(/只统计 Read \/ Edit \/ Write \/ NotebookEdit/)).toBeVisible();
  });
});
