import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { workHabits } from "./workHabits";
import { WorkHabitsPanel } from "./WorkHabitsPanel";

const NOW = new Date(2026, 0, 15, 18, 0).getTime();

function messageAt(id: string, timestamp: number): SessionRecord {
  return {
    id,
    fullId: id,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "ok",
    isError: false,
    raw: {},
    usage: { inputTokens: 1000, outputTokens: 100 }
  };
}

const INPUTS: UsageSessionInput[] = [
  {
    projectLabel: "-work-alpha",
    records: [
      messageAt("d1-9", new Date(2026, 0, 14, 9, 10).getTime()),
      messageAt("d1-10", new Date(2026, 0, 14, 10, 5).getTime()),
      messageAt("d2-9", new Date(2026, 0, 15, 9, 20).getTime()),
      messageAt("d2-10", new Date(2026, 0, 15, 10, 15).getTime())
    ]
  }
];

function cellOf(label: string): HTMLElement {
  const labelNode = screen.getByText(label);
  const cell = labelNode.parentElement;
  expect(cell).not.toBeNull();
  return cell as HTMLElement;
}

describe("WorkHabitsPanel（D8 工作习惯）", () => {
  it("四格读数与模型层逐字一致（昼夜型 / 连击 / 最长会话 / 峰值小时）", () => {
    const habits = workHabits(INPUTS, NOW);
    render(<WorkHabitsPanel inputs={INPUTS} now={NOW} />);

    expect(screen.getByRole("region", { name: "工作习惯" })).toBeInTheDocument();
    expect(screen.getByText("昼夜型")).toBeInTheDocument();
    expect(cellOf("昼夜型")).toHaveTextContent(habits.chronoType);
    expect(cellOf("连击")).toHaveTextContent(`${habits.currentStreak} 天`);
    expect(cellOf("最长会话")).toHaveTextContent(
      `${Math.round(habits.longestSessionMinutes)} 分`
    );
    expect(cellOf("峰值小时")).toHaveTextContent(
      `${String(habits.peakHour ?? 0).padStart(2, "0")}:00`
    );
    expect(cellOf("峰值小时")).toHaveTextContent(
      `${Math.round(habits.peakHourShare * 100)}% 的消息落在这一小时`
    );
  });

  it("没有消息时说「本窗口没有消息」，不画四个 0", () => {
    render(<WorkHabitsPanel inputs={[{ projectLabel: "-empty", records: [] }]} now={NOW} />);

    expect(screen.getByText("本窗口没有消息")).toBeInTheDocument();
    expect(screen.queryByText("连击")).not.toBeInTheDocument();
  });

  it("连击为 0 时脚注写「今天和昨天都没有记录」，不冒充连续", () => {
    const stale: UsageSessionInput[] = [
      {
        projectLabel: "-old",
        records: [messageAt("old-1", new Date(2025, 11, 1, 9, 0).getTime())]
      }
    ];
    render(<WorkHabitsPanel inputs={stale} now={NOW} />);

    expect(cellOf("连击")).toHaveTextContent("0 天");
    expect(cellOf("连击")).toHaveTextContent("今天和昨天都没有记录");
  });
});
