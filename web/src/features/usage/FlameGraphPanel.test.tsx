import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { classifyToolUse, type ToolCallFact } from "./toolCensus";
import type { UsageSessionInput } from "./usageAggregations";
import { FlameGraphPanel } from "./FlameGraphPanel";

const NOW = new Date(2026, 9, 15, 18, 0).getTime();
const MIN = 60_000;

function metaOf(path: string, title: string): SessionMeta {
  return {
    path,
    mtimeMs: NOW,
    sizeBytes: 1,
    projectLabel: "-work",
    hasRecords: true,
    aiTitle: title
  };
}

function fact(name: string, at: number, durationMs?: number): ToolCallFact {
  const result: ToolCallFact = {
    key: classifyToolUse(name, undefined),
    timestamp: at,
    sidechain: false
  };
  if (durationMs !== undefined) result.durationMs = durationMs;
  return result;
}

function sessionOf(meta: SessionMeta, facts: ToolCallFact[]): UsageSessionInput {
  return {
    projectLabel: meta.projectLabel,
    session: meta,
    records: [],
    toolCalls: facts
  };
}

const ALPHA = metaOf("/p/alpha.jsonl", "会话 A");

describe("FlameGraphPanel（F3 工具火焰）", () => {
  it("一行一会话：摘要、未配对计数、图例与下钻都在", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(
      <FlameGraphPanel
        inputs={[
          sessionOf(ALPHA, [
            fact("Bash", NOW - 5 * MIN, 750_000),
            fact("Read", NOW - 3 * MIN, 30_000),
            fact("Edit", NOW - MIN)
          ])
        ]}
        days={7}
        now={NOW}
        onOpenSession={onOpenSession}
      />
    );

    const row = screen.getByRole("button", { name: /会话 A/ });
    expect(row.getAttribute("aria-label")).toContain("工具耗时 13m0s");
    expect(row.getAttribute("aria-label")).toContain("1 次耗时未知");
    expect(row.textContent).toContain("?1");

    const summary = screen.getByRole("img", { name: /工具火焰/ });
    expect(summary.getAttribute("aria-label")).toContain("另有 1 次调用耗时未知");

    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Read")).toBeInTheDocument();
    // 未配对的 Edit 不进入条长，但仍在图例里（它确实被调用过）。
    expect(screen.getByText("Edit")).toBeInTheDocument();

    await user.click(row);
    expect(onOpenSession).toHaveBeenCalledWith(ALPHA);
  });

  it("没有工具调用：给空态，不画坐标系", () => {
    render(<FlameGraphPanel inputs={[]} days={7} now={NOW} />);

    expect(screen.getByText("所选范围内没有工具调用")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /工具火焰/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("全部未配对：降级为按次数，并说明降级原因", () => {
    render(
      <FlameGraphPanel
        inputs={[
          sessionOf(ALPHA, [fact("Bash", NOW - 2 * MIN), fact("Read", NOW - MIN)])
        ]}
        days={7}
        now={NOW}
      />
    );

    expect(screen.getByText("按次数（耗时缺失）")).toBeInTheDocument();
    expect(screen.getByText("调用次数")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /会话 A/ });
    expect(row.getAttribute("aria-label")).toBe("会话 A：2 次工具调用，Bash 最多");
    expect(screen.getByText(/条长改为调用次数/)).toBeInTheDocument();
  });

  it("超过 12 行时截断，并在脚注里报出没画出的会话数", () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      sessionOf(
        metaOf(`/p/s${index}.jsonl`, `会话 ${index}`),
        [fact("Bash", NOW - MIN, (index + 1) * 1000)]
      )
    );
    render(<FlameGraphPanel inputs={many} days={7} now={NOW} />);

    expect(screen.getAllByRole("button", { name: /^会话 \d+：/ })).toHaveLength(12);
    expect(screen.getByText(/另有 1 个会话未画出，按条长排在后面。/)).toBeInTheDocument();
  });
});
