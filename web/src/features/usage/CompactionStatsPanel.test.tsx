import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CompactionStatsPanel } from "./CompactionStatsPanel";
import { compactionStats, type CompactionStats } from "./compactionStats";
import type { UsageSessionInput } from "./usageAggregations";
import type { SessionRecord } from "../sessions/types";

const NOW = new Date(2026, 9, 9, 12, 0, 0).getTime();
const HOURS = 3_600_000;

const record: SessionRecord = {
  id: "r1",
  fullId: "r1",
  kind: "assistant",
  timestamp: NOW - HOURS,
  durationMs: 0,
  text: "",
  isError: false,
  raw: {}
};

const meta = {
  projectLabel: "compact-demo",
  customTitle: "上下文压缩取证",
  hasRecords: true,
  path: "/Users/e2e/.claude/projects/-repo-compact-demo/compact-session.jsonl",
  mtimeMs: 0,
  sizeBytes: 0
};

const inputs: UsageSessionInput[] = [
  {
    records: [record],
    projectLabel: "compact-demo",
    session: meta,
    compactEvents: [
      {
        id: "b1",
        timestamp: NOW - 2 * HOURS,
        trigger: "auto",
        preTokens: 167_400,
        postTokens: 11_200,
        droppedTokens: 156_200,
        durationMs: 37_455,
        survivedUuids: [],
        summaryText: null,
        summaryUuid: null,
        logicalParentUuid: null
      },
      {
        id: "b2",
        timestamp: NOW - 1 * HOURS,
        trigger: "manual",
        preTokens: 156_200,
        postTokens: 9_600,
        droppedTokens: 302_800,
        durationMs: 41_200,
        survivedUuids: [],
        summaryText: null,
        summaryUuid: null,
        logicalParentUuid: null
      }
    ]
  }
];

const stats: CompactionStats = compactionStats(inputs, 30, NOW);

describe("CompactionStatsPanel", () => {
  it("renders the readings, the trigger legend and the clickable top row", () => {
    const onOpenSession = vi.fn();
    render(
      <CompactionStatsPanel stats={stats} days={30} onOpenSession={onOpenSession} />
    );

    const panel = screen.getByRole("region", { name: "压缩（上下文重置）" });
    expect(within(panel).getByText("压缩次数").nextElementSibling).toHaveTextContent("2");
    // 累计丢弃 = Σ(pre − post) = 156,200 + 146,600 = 302,800。
    expect(panel.textContent).toContain("302,800 tok");
    expect(panel.textContent).toContain("1 个");
    // 触发方式是文字 + 双项图例（自动 1 / 手动 1）。
    expect(screen.getByRole("img", { name: "压缩触发方式分布" })).toBeInTheDocument();
    expect(panel.textContent).toContain("自动 1");
    expect(panel.textContent).toContain("手动 1");

    const top = screen.getByRole("list", { name: "丢弃最多的会话" });
    expect(within(top).getByText("上下文压缩取证")).toBeInTheDocument();
    expect(within(top).getByText("2 次 · 302,800")).toBeInTheDocument();
  });

  it("opens the session when a top row is clicked", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(
      <CompactionStatsPanel stats={stats} days={30} onOpenSession={onOpenSession} />
    );

    await user.click(screen.getByRole("button", { name: /上下文压缩取证/ }));
    expect(onOpenSession).toHaveBeenCalledWith(meta);
  });

  it("keeps the panel but writes one inline line for a zero window", () => {
    render(<CompactionStatsPanel stats={compactionStats([], 30, NOW)} days={30} />);

    const panel = screen.getByRole("region", { name: "压缩（上下文重置）" });
    expect(panel).toHaveTextContent("近 30 天没有压缩记录——没有会话触发过上下文重置。");
    // 0 次时不画空图：既没有堆叠条也没有 KPI 读数。
    expect(screen.queryByRole("img", { name: "压缩触发方式分布" })).toBeNull();
    expect(panel.textContent).not.toContain("压缩次数");
  });
});
