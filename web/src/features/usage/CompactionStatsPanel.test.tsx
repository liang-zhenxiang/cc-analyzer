import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CompactionStatsPanel } from "./CompactionStatsPanel";
import { compactionStats, type CompactionStats } from "./compactionStats";
import { contextQuantiles } from "./contextQuantiles";
import { cacheHealthOf, type CacheWeek } from "./cacheHealth";
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

/** G7 会话上下文峰值分位行：quantiles 由页面 memo 算好传入（组件是哑组件），
 *  这里直接用已验收的 contextQuantiles 从带 usage 的输入算真值再断言。 */
describe("CompactionStatsPanel 分位行（G7）", () => {
  /** 带 usage 的 assistant 记录：上下文峰值 = input + cacheCreation + cacheRead
   *  （SessionUsage 是解析后的 camelCase 形状，不是原始 JSONL 字段名）。 */
  function usageRecord(id: string, timestamp: number, input: number, cacheRead: number): SessionRecord {
    return {
      ...record,
      id,
      fullId: id,
      timestamp,
      usage: { inputTokens: input, cacheCreationTokens: 0, cacheReadTokens: cacheRead, outputTokens: 0 }
    };
  }

  it("缺省 quantiles 不渲染分位行（向后兼容）", () => {
    render(<CompactionStatsPanel stats={stats} days={30} />);
    expect(screen.queryByLabelText("会话上下文峰值分位数")).toBeNull();
    expect(screen.queryByText("样本不足")).toBeNull();
  });

  it("count 0：一行事实文字，不印五个 0", () => {
    render(
      <CompactionStatsPanel
        stats={stats}
        days={30}
        quantiles={{ p50: null, p75: null, p90: null, p99: null, max: null, count: 0 }}
      />
    );
    expect(screen.getByText("本窗口的会话没有上下文读数")).toBeInTheDocument();
    expect(screen.queryByLabelText("会话上下文峰值分位数")).toBeNull();
  });

  it("count 1（模型层 <2 全 null）：显示「样本不足」", () => {
    render(
      <CompactionStatsPanel
        stats={stats}
        days={30}
        quantiles={{ p50: null, p75: null, p90: null, p99: null, max: null, count: 1 }}
      />
    );
    expect(screen.getByText("样本不足")).toBeInTheDocument();
    expect(screen.queryByLabelText("会话上下文峰值分位数")).toBeNull();
  });

  it("≥2：五个读数按 P50/P75/P90/P99/最大 顺序渲染，k 缩写与 data 锚点齐全", () => {
    // 手造真分位（页面 memo 的产出物）：42_100 → 42.1k，131_000 → 131k，
    // 196_880 → 196.9k，999 → 999，2_400_000 → 2.4M（formatTokenCount）。
    render(
      <CompactionStatsPanel
        stats={stats}
        days={30}
        quantiles={{ p50: 42_100, p75: 131_000, p90: 196_880, p99: 999, max: 2_400_000, count: 37 }}
      />
    );

    const row = screen.getByLabelText("会话上下文峰值分位数");
    expect(within(row).getByText("会话上下文峰值")).toBeInTheDocument();
    // 键面顺序固定。
    const keys = ["P50", "P75", "P90", "P99", "最大"];
    const values = ["42.1k", "131k", "196.9k", "999", "2.4M"];
    for (let i = 0; i < keys.length; i += 1) {
      const cell = within(row).getByText(keys[i]).closest("span[data-probe='ctx-q']") as HTMLElement | null;
      expect(cell).not.toBeNull();
      expect(cell).toHaveAttribute("data-q", ["p50", "p75", "p90", "p99", "max"][i]);
      expect(within(cell as HTMLElement).getByText(values[i])).toBeInTheDocument();
    }
  });

  it("真数据对账：contextQuantiles 产出直挂面板，P50 = 中位峰值", () => {
    // 三个会话各一条带 usage 记录：峰值为 100 / 200 / 300 → nearest-rank
    // p50 = 200、p75 = 300、p90 = 300、p99 = 300、max = 300。
    const withUsage: UsageSessionInput[] = [0, 1, 2].map((n) => ({
      records: [usageRecord(`u${n}`, NOW - (n + 1) * HOURS, 100 * (n + 1), 0)],
      projectLabel: "compact-demo"
    }));
    const quantiles = contextQuantiles(withUsage);
    render(<CompactionStatsPanel stats={stats} days={30} quantiles={quantiles} />);

    const row = screen.getByLabelText("会话上下文峰值分位数");
    expect(within(row).getByText("200")).toBeInTheDocument(); // P50
    expect(within(row).getAllByText("300")).toHaveLength(4); // P75/P90/P99/最大
  });

  describe("H7 缓存命中率", () => {
    const WEEK = 7 * 24 * HOURS;
    const week = (index: number, cacheReadTokens: number, inputTokens: number): CacheWeek => ({
      weekStart: NOW - (4 - index) * WEEK,
      cacheReadTokens,
      inputTokens
    });

    it("四周年化：本周命中率、方向词、sparkline 与脚注都在", () => {
      const health = cacheHealthOf([
        week(0, 100, 900),
        week(1, 200, 800),
        week(2, 300, 700),
        week(3, 450, 550)
      ]);
      render(<CompactionStatsPanel stats={stats} days={30} cacheHealth={health} />);

      const section = document.querySelector('[data-probe="cache-hit"]');
      expect(section).not.toBeNull();
      expect(
        section!.querySelector('[data-probe="cache-hit-value"]')?.textContent
      ).toBe("45.0%");
      expect(screen.getByText("在变好")).toBeInTheDocument();
      expect(document.querySelector('[data-probe="cache-sparkline"]')).not.toBeNull();
      expect(
        screen.getByText("按周：缓存读取 ÷（输入 + 缓存写入 + 缓存读取）")
      ).toBeInTheDocument();
    });

    it("不足 3 个非 null 周：只印数值与「样本不足」，不画线", () => {
      const health = cacheHealthOf([
        week(2, 200, 800),
        week(3, 300, 700)
      ]);
      render(<CompactionStatsPanel stats={stats} days={30} cacheHealth={health} />);

      expect(
        document.querySelector('[data-probe="cache-hit-value"]')?.textContent
      ).toBe("30.0%");
      expect(screen.getByText("样本不足")).toBeInTheDocument();
      expect(document.querySelector('[data-probe="cache-sparkline"]')).toBeNull();
    });

    it("最后一周没有读数：印「—」而不回退到更早的周", () => {
      const health = cacheHealthOf([
        week(0, 100, 900),
        week(1, 200, 800),
        week(2, 300, 700),
        week(3, 0, 0)
      ]);
      render(<CompactionStatsPanel stats={stats} days={30} cacheHealth={health} />);

      expect(
        document.querySelector('[data-probe="cache-hit-value"]')?.textContent
      ).toBe("—");
      // 前三周有读数：线照画（3 个非 null 周达标），但数字停在「—」——
      // 「当前」不能回退成「上次有数据的时候」，也不说「没有输入读数」。
      expect(screen.queryByText("本窗口没有输入读数")).toBeNull();
      expect(document.querySelector('[data-probe="cache-sparkline"]')).not.toBeNull();
    });

    it("整窗没有可读的输入：说「本窗口没有输入读数」，不印 0.0%", () => {
      const health = cacheHealthOf([week(3, 0, 0)]);
      render(<CompactionStatsPanel stats={stats} days={30} cacheHealth={health} />);

      expect(
        document.querySelector('[data-probe="cache-hit-value"]')?.textContent
      ).toBe("—");
      expect(screen.getByText("本窗口没有输入读数")).toBeInTheDocument();
      expect(screen.queryByText("0.0%")).toBeNull();
    });

    it("缺省 cacheHealth 不渲染该 section（旧快照不破）", () => {
      render(<CompactionStatsPanel stats={stats} days={30} />);
      expect(document.querySelector('[data-probe="cache-hit"]')).toBeNull();
    });
  });
});
