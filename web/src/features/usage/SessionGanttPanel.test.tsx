import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { SessionGanttPanel } from "./SessionGanttPanel";

const NOW = new Date(2026, 0, 15, 18, 0).getTime();

function metaOf(path: string, title: string, projectLabel: string): SessionMeta {
  return {
    path,
    mtimeMs: NOW,
    sizeBytes: 1,
    projectLabel,
    hasRecords: true,
    aiTitle: title
  };
}

function recordAt(id: string, timestamp: number): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    usage: { inputTokens: 1000, outputTokens: 10 }
  };
}

function sessionOf(meta: SessionMeta, startMinutesAgo: number, endMinutesAgo: number): UsageSessionInput {
  return {
    projectLabel: meta.projectLabel,
    session: meta,
    records: [
      recordAt(`${meta.path}-s`, NOW - startMinutesAgo * 60_000),
      recordAt(`${meta.path}-e`, NOW - endMinutesAgo * 60_000)
    ]
  };
}

const ALPHA = metaOf("/p/alpha.jsonl", "会话 A", "-work");
const BETA = metaOf("/p/beta.jsonl", "会话 B", "-work");

describe("SessionGanttPanel（D7 会话甘特）", () => {
  it("一行一会话，标签与重叠标记都在，点行打开对应会话", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(
      <SessionGanttPanel
        inputs={[sessionOf(ALPHA, 120, 30), sessionOf(BETA, 90, 60)]}
        days={7}
        now={NOW}
        onOpenSession={onOpenSession}
      />
    );

    const rows = screen.getAllByRole("button", { name: /会话 [AB]/ });
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByTitle("会话 A")).toHaveTextContent("会话 A");
    // 两段会话的时间区间重合：行尾有 ∥，脚注也说明。
    expect(rows[0].textContent).toContain("∥");
    expect(screen.getByText(/这些会话的时间区间有重合/)).toBeInTheDocument();

    await user.click(rows[0]);
    expect(onOpenSession).toHaveBeenCalledWith(ALPHA);
  });

  it("只有一个会话时明说「只有 1 个」，仍把那一行画出来", () => {
    render(<SessionGanttPanel inputs={[sessionOf(ALPHA, 60, 30)]} days={7} now={NOW} />);

    expect(screen.getByText("本窗口只有 1 个会话")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /会话 A/ })).toHaveLength(1);
    expect(screen.getByText("横轴按这些会话的实际起止时间画。")).toBeInTheDocument();
  });

  it("超过 12 行时截断，并在脚注里报出没画出的数量", () => {
    const many = Array.from({ length: 13 }, (_, index) =>
      sessionOf(
        metaOf(`/p/s${index}.jsonl`, `会话 ${index}`, "-work"),
        200 - index,
        190 - index
      )
    );
    render(<SessionGanttPanel inputs={many} days={30} now={NOW} />);

    expect(screen.getAllByRole("button", { name: /^会话 \d+：/ })).toHaveLength(12);
    expect(screen.getByText(/另有 1 个会话未画出，按开始时间排在后面。/)).toBeInTheDocument();
  });

  it("没有会话时给空态，不画空坐标系", () => {
    render(<SessionGanttPanel inputs={[]} days={7} now={NOW} />);

    expect(screen.getByText("本窗口还没有会话")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /会话/ })).not.toBeInTheDocument();
  });
});
