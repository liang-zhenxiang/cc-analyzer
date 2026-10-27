import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { BridgesProvider } from "../../api/bridges";
import type { Bridges } from "../../api/types";
import { NotificationProvider } from "../../app/NotificationProvider";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { ProjectArenaPanel } from "./ProjectArenaPanel";
import type { UsageSessionInput, UsageSlice } from "./usageAggregations";

/**
 * F2 项目擂台：默认态仍是「按项目分布」的条形图，点「对比」把面板体换成
 * 左右镜像的擂台；数字断言的是具体读数（日均 / 峰值 / 主力模型），不是
 * 「画了点什么」。
 */

const NOW = new Date(2026, 0, 15, 18, 0).getTime();
const ALPHA = "-work-alpha";
const BETA = "-work-beta";
const GAMMA = "-work-gamma";

function at(dayOffset: number): number {
  return new Date(2026, 0, 15 + dayOffset, 12).getTime();
}

function recordOf(
  id: string,
  timestamp: number,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    ...overrides
  };
}

function usageOf(input: number): SessionUsage {
  return { inputTokens: input };
}

function inputOf(label: string, records: SessionRecord[], projectPath?: string): UsageSessionInput {
  const input: UsageSessionInput = { projectLabel: label, records };
  if (projectPath) input.projectPath = projectPath;
  return input;
}

const INPUTS: UsageSessionInput[] = [
  inputOf(
    ALPHA,
    [
      recordOf("a-today", at(0), {
        model: "claude-sonnet-4-5-20250929",
        usage: usageOf(1_000_000)
      }),
      recordOf("a-yesterday", at(-1), {
        model: "claude-sonnet-4-5-20250929",
        usage: usageOf(200_000)
      })
    ],
    "/work/alpha"
  ),
  inputOf(
    BETA,
    [
      recordOf("b-today", at(0), {
        model: "claude-opus-4-1-20250805",
        usage: usageOf(300_000)
      })
    ],
    "/work/beta"
  ),
  inputOf(
    GAMMA,
    [
      recordOf("g-today", at(0), {
        model: "claude-sonnet-4-5-20250929",
        usage: usageOf(50_000)
      })
    ],
    "/work/gamma"
  )
];

const DATA = [
  { label: "alpha", value: 1_200_000, hint: "/work/alpha" },
  { label: "beta", value: 300_000, hint: "/work/beta" },
  { label: "gamma", value: 50_000, hint: "/work/gamma" }
];

const PROJECTS: UsageSlice[] = [
  { label: ALPHA, value: 1_200_000 },
  { label: BETA, value: 300_000 },
  { label: GAMMA, value: 50_000 }
];

/**
 * 卡头从 Round EE 起有「导出 CSV」按钮（E5），渲染期就要取 bridges 与 toast：
 * 这里补一个只有 `dialog.saveText` 的最小桥，本文件其余断言与它无关。
 */
const csvBridges = {
  dialog: { saveText: vi.fn(async () => "/tmp/projects.csv") }
} as unknown as Bridges;

const wrapper = ({ children }: { children: ReactNode }) => (
  <NotificationProvider>
    <BridgesProvider bridges={csvBridges}>{children}</BridgesProvider>
  </NotificationProvider>
);

function renderPanel(
  overrides: Partial<{
    inputs: UsageSessionInput[];
    projects: UsageSlice[];
    data: { label: string; value: number; hint?: string }[];
  }> = {}
) {
  return render(
    <ProjectArenaPanel
      inputs={overrides.inputs ?? INPUTS}
      days={7}
      data={overrides.data ?? DATA}
      projects={overrides.projects ?? PROJECTS}
      now={NOW}
    />,
    { wrapper }
  );
}

function probe(name: string): HTMLElement {
  const node = document.querySelector(`[data-probe="${name}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`missing probe: ${name}`);
  return node;
}

describe("ProjectArenaPanel", () => {
  it("keeps the original per-project chart as the default view", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "按项目分布" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "按项目分布" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对比" })).toBeEnabled();
    expect(document.querySelector('[data-probe="arena-root"]')).not.toBeInTheDocument();
  });

  it("disables 对比 and explains why when fewer than two projects exist", () => {
    renderPanel({ projects: [PROJECTS[0]], data: [DATA[0]] });
    const compare = screen.getByRole("button", { name: "对比" });
    expect(compare).toBeDisabled();
    expect(compare).toHaveAttribute("title", "需要至少两个项目");
  });

  it("opens the arena with the top two projects and their exact readouts", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "对比" }));

    expect(probe("arena-root")).toBeInTheDocument();
    expect(screen.getByLabelText("左侧项目")).toHaveValue(ALPHA);
    expect(screen.getByLabelText("右侧项目")).toHaveValue(BETA);
    // The per-project chart is replaced, not stacked under the arena.
    expect(screen.queryByRole("img", { name: "按项目分布" })).not.toBeInTheDocument();

    const sideA = within(probe("arena-side-a"));
    expect(sideA.getByText("alpha")).toBeInTheDocument();
    expect(sideA.getByText("171,429")).toBeInTheDocument();
    expect(sideA.getByText("1.0M")).toBeInTheDocument();
    expect(sideA.getByText("Sonnet 4.5")).toBeInTheDocument();

    const sideB = within(probe("arena-side-b"));
    expect(sideB.getByText("beta")).toBeInTheDocument();
    expect(sideB.getByText("42,857")).toBeInTheDocument();
    expect(sideB.getByText("300,000")).toBeInTheDocument();
    expect(sideB.getByText("Opus 4.1")).toBeInTheDocument();

    // One A bar + one B bar per day of the window.
    expect(document.querySelectorAll('[data-probe="arena-bar"]')).toHaveLength(14);
  });

  it("re-reads the right side when the reader picks another project", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "对比" }));

    const right = screen.getByLabelText("右侧项目");
    expect(within(right).getByRole("option", { name: "gamma" })).toBeEnabled();
    expect(within(screen.getByLabelText("左侧项目")).getByRole("option", { name: "gamma" })).toBeEnabled();

    await user.selectOptions(right, GAMMA);

    const sideB = within(probe("arena-side-b"));
    expect(sideB.getByText("gamma")).toBeInTheDocument();
    expect(sideB.getByText("7,143")).toBeInTheDocument();
    expect(sideB.getByText("50,000")).toBeInTheDocument();
    // Each side disables whatever the other side currently holds.
    expect(within(right).getByRole("option", { name: "alpha" })).toBeDisabled();
    expect(within(right).getByRole("option", { name: "beta" })).toBeEnabled();
    expect(
      within(screen.getByLabelText("左侧项目")).getByRole("option", { name: "gamma" })
    ).toBeDisabled();
  });

  it("returns to the bar chart", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: "对比" }));
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("img", { name: "按项目分布" })).toBeInTheDocument();
    expect(document.querySelector('[data-probe="arena-root"]')).not.toBeInTheDocument();
  });

  it("labels an empty range honestly", () => {
    renderPanel({ inputs: [], projects: [], data: [] });
    expect(screen.getByText("所选范围内暂无项目消耗")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对比" })).toBeDisabled();
  });
});
