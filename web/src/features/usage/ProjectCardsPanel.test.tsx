import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionRecord, SessionUsage } from "../sessions/types";
import { ProjectCardsPanel } from "./ProjectCardsPanel";
import type { UsageSessionInput } from "./usageAggregations";

/**
 * F6 项目卡片：每张卡一段读数 + 一条 14 天走势。断言的是卡片上真正写出来的
 * 数字与文案（token、成本、会话/消息、相对时间），不是「渲染了 3 个 div」。
 */

const NOW = new Date(2026, 0, 15, 18, 0).getTime();
const ALPHA = "-work-alpha";
const BETA = "-work-beta";
const ZETA = "-work-zeta";

function at(dayOffset: number, hour = 10): number {
  return new Date(2026, 0, 15 + dayOffset, hour).getTime();
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

function usageOf(input: number, output = 0): SessionUsage {
  return { inputTokens: input, outputTokens: output };
}

function inputOf(label: string, records: SessionRecord[], projectPath?: string): UsageSessionInput {
  const input: UsageSessionInput = { projectLabel: label, records };
  if (projectPath) input.projectPath = projectPath;
  return input;
}

function inputs(): UsageSessionInput[] {
  return [
    inputOf(
      ALPHA,
      [
        recordOf("a-user", at(0), { kind: "user" }),
        recordOf("a-llm", at(0) + 600_000, {
          model: "claude-sonnet-4-5-20250929",
          usage: usageOf(1_000_000, 100_000)
        })
      ],
      "/work/alpha"
    ),
    inputOf(
      BETA,
      [
        recordOf("b-llm", at(0), {
          model: "claude-sonnet-4-5-20250929",
          usage: usageOf(300_000)
        })
      ],
      "/work/beta"
    ),
    inputOf(ZETA, [
      recordOf("z-llm", at(0), { model: "gemini-3-pro", usage: usageOf(10_000) })
    ])
  ];
}

function cardOf(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${name}：`) });
}

describe("ProjectCardsPanel", () => {
  it("renders one card per project with the exact readings", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} now={NOW} />);
    expect(screen.getByRole("region", { name: "项目卡片" })).toBeInTheDocument();
    expect(document.querySelectorAll('[data-probe="card-item"]')).toHaveLength(3);

    const alpha = within(cardOf("alpha"));
    expect(alpha.getByText("alpha")).toBeInTheDocument();
    expect(alpha.getByText("1.1M")).toBeInTheDocument();
    expect(alpha.getByText("$4.50")).toBeInTheDocument();
    expect(alpha.getByText("1 个会话 · 2 条消息")).toBeInTheDocument();
    expect(alpha.getByText("最近活跃 7小时前")).toBeInTheDocument();

    const beta = within(cardOf("beta"));
    expect(beta.getByText("300,000")).toBeInTheDocument();
    expect(beta.getByText("$0.90")).toBeInTheDocument();
    expect(beta.getByText("1 个会话 · 1 条消息")).toBeInTheDocument();
  });

  it("writes 定价未知 instead of a fake $0.00 for an unpriced model", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} now={NOW} />);
    const zeta = within(cardOf("work-zeta"));
    expect(zeta.getByText("定价未知")).toBeInTheDocument();
    expect(zeta.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("draws a 14-point sparkline per card", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} now={NOW} />);
    const alpha = cardOf("alpha");
    const polyline = alpha.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")?.split(" ")).toHaveLength(14);
    expect(alpha.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("calls back with the encoded label and explains that the view does not exist yet", async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    render(
      <ProjectCardsPanel
        inputs={inputs()}
        days={30}
        onOpenProject={onOpenProject}
        now={NOW}
      />
    );
    const alpha = cardOf("alpha");
    expect(alpha).toHaveAttribute("title", "项目筛选视图将在后续版本提供");
    await user.click(alpha);
    expect(onOpenProject).toHaveBeenCalledWith(ALPHA);
  });

  it("limits the number of cards", () => {
    render(<ProjectCardsPanel inputs={inputs()} days={30} limit={1} now={NOW} />);
    expect(document.querySelectorAll('[data-probe="card-item"]')).toHaveLength(1);
    expect(cardOf("alpha")).toBeInTheDocument();
  });

  it("states an empty range in one line", () => {
    render(<ProjectCardsPanel inputs={[]} days={30} now={NOW} />);
    expect(screen.getByText("近 30 天里还没有可展示的项目。")).toBeInTheDocument();
    expect(document.querySelector('[data-probe="cards-root"]')).not.toBeInTheDocument();
  });
});
