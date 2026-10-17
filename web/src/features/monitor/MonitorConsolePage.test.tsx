import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "../../lib/format";
import type { SessionMeta } from "../sessions/metadataCache";
import type { CompactEvent, SessionRecord, SessionUsage } from "../sessions/types";
import { setPlan } from "../usage/planLimits";
import type { UsageSessionInput } from "../usage/usageAggregations";
import { MonitorConsolePage } from "./MonitorConsolePage";
import { sessionRows } from "./pulseModel";
import { usePulseFeed, type PulseFeedResult, type PulseSnapshot } from "./usePulseFeed";

vi.mock("./usePulseFeed", () => ({ usePulseFeed: vi.fn() }));

const NOW = new Date(2026, 9, 17, 12, 30, 0, 0).getTime();
const MINUTE = 60_000;
const SESSION_A = "/repo/alpha/alpha-session.jsonl";
const SESSION_B = "/repo/beta/beta-session.jsonl";

const consoleCss = readFileSync(
  resolve(process.cwd(), "src/features/monitor/MonitorConsolePage.module.css"),
  "utf8"
);

function usage(
  inputTokens: number,
  outputTokens = 0,
  cacheCreationTokens = 0,
  cacheReadTokens = 0
): SessionUsage {
  return {
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens
  };
}

function record(
  timestamp: number,
  tokens?: SessionUsage,
  overrides: Partial<SessionRecord> = {}
): SessionRecord {
  return {
    id: `record-${timestamp}`,
    fullId: `full-${timestamp}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    usage: tokens,
    raw: {},
    ...overrides
  };
}

function compact(
  timestamp: number,
  trigger: string,
  preTokens: number | null
): CompactEvent {
  return {
    id: `compact-${timestamp}`,
    timestamp,
    trigger,
    preTokens,
    postTokens: null,
    droppedTokens: null,
    durationMs: null,
    survivedUuids: [],
    summaryText: null,
    summaryUuid: null,
    logicalParentUuid: null
  };
}

function meta(path: string, projectLabel: string, title: string): SessionMeta {
  return {
    path,
    projectLabel,
    customTitle: title,
    mtimeMs: NOW - MINUTE,
    sizeBytes: 1_024,
    hasRecords: true,
    metadataStatus: "complete"
  };
}

function snapshotOf(
  inputs: UsageSessionInput[],
  now = NOW
): PulseSnapshot {
  const rows = sessionRows(
    inputs.map((input) => ({
      session: input.session!,
      records: input.records,
      title: input.session!.customTitle
    })),
    now
  );
  return {
    now,
    inputs,
    rows,
    latest: null,
    changed: true,
    durationMs: 0
  };
}

function consoleSnapshot(): PulseSnapshot {
  const alpha = meta(SESSION_A, "alpha", "Alpha session");
  const beta = meta(SESSION_B, "beta", "Beta session");
  return snapshotOf([
    {
      projectLabel: "alpha",
      projectPath: "/repo/alpha",
      session: alpha,
      records: [
        record(NOW - 3 * 60 * MINUTE, usage(500)),
        record(NOW - 60 * MINUTE, usage(1_000, 250)),
        record(NOW - 50 * MINUTE, undefined, {
          isError: true,
          toolName: "Bash",
          text:
            "Exit code 2 at /Users/tester/private/secret/file.ts ~ token-7f3a"
        })
      ]
    },
    {
      projectLabel: "beta",
      projectPath: "/repo/beta",
      session: beta,
      compactEvents: [compact(NOW - 45 * MINUTE, "auto", 128_000)],
      records: [
        record(NOW - 2.5 * 60 * MINUTE, usage(2_000)),
        record(NOW - 20 * MINUTE, undefined, {
          isError: true,
          toolName: "Edit",
          toolResult:
            "Tool output line one /Users/tester/private/secret/other.ts ~ marker-9c2d\nsecond line"
        })
      ]
    }
  ]);
}

function mockFeed(result: Partial<PulseFeedResult>): void {
  vi.mocked(usePulseFeed).mockReturnValue({
    snapshot: null,
    loading: false,
    error: null,
    stale: null,
    ...result
  });
}

function probe(name: string): Element | null {
  return document.querySelector(`[data-probe="${name}"]`);
}

function probes(name: string): Element[] {
  return [...document.querySelectorAll(`[data-probe="${name}"]`)];
}

beforeEach(() => {
  vi.mocked(usePulseFeed).mockReset();
  setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
  document.documentElement.style.removeProperty("--font-scale");
});

describe("MonitorConsolePage 四态", () => {
  it("加载态只画内容形状，不显示假 0", () => {
    mockFeed({ snapshot: null, loading: true });
    render(<MonitorConsolePage />);

    expect(probe("monitor-console-page")?.getAttribute("data-state")).toBe("loading");
    expect(probe("monitor-console-skeleton")?.hasAttribute("data-probe-pending")).toBe(true);
    expect(probes("monitor-console-readout")).toHaveLength(0);
    expect(screen.queryByText("暂无活动窗口")).not.toBeInTheDocument();
  });

  it("错误态给整页错误与原异常折叠入口，重试会重挂载 feed", () => {
    mockFeed({ snapshot: null, error: "读取失败 /Users/tester/secret" });
    render(<MonitorConsolePage />);

    expect(probe("monitor-console-page")?.getAttribute("data-state")).toBe("error");
    expect(probe("monitor-console-error")).not.toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("读取本地日志失败");
    expect(screen.getByRole("alert").innerHTML).not.toContain("/Users/");

    const before = vi.mocked(usePulseFeed).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(vi.mocked(usePulseFeed).mock.calls.length).toBeGreaterThan(before);
  });

  it("空态是一条事实行，不渲染读数带或三张面板", () => {
    mockFeed({ snapshot: snapshotOf([]) });
    render(<MonitorConsolePage />);

    expect(probe("monitor-console-page")?.getAttribute("data-state")).toBe("empty");
    expect(probe("monitor-console-empty")).not.toBeNull();
    expect(screen.getByText("本机还没有会话日志")).toBeInTheDocument();
    expect(probes("monitor-console-readout")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "24 小时活动" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "项目热度" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "事件流" })).not.toBeInTheDocument();
  });

  it("过期态保留旧读数、小时图与事件，只把状态行标红", () => {
    mockFeed({
      snapshot: consoleSnapshot(),
      stale: { at: NOW + MINUTE, reason: "boom" }
    });
    render(<MonitorConsolePage />);

    expect(probe("monitor-console-page")?.getAttribute("data-state")).toBe("stale");
    const refresh = probe("monitor-console-refresh")!;
    expect(refresh.getAttribute("data-stale")).toBe("true");
    expect(refresh.textContent).toContain(`上次更新 ${formatClock(NOW, true)}`);
    expect(refresh.textContent).toContain("本次读取失败");
    expect(probes("monitor-console-readout")).toHaveLength(4);
    expect(probes("monitor-console-hour-slot")).toHaveLength(24);
    expect(probes("monitor-console-event-row").length).toBeGreaterThan(0);
  });
});

describe("MonitorConsolePage 今天与 24 小时", () => {
  it("四枚读数与同一份计费窗口数学逐位一致", () => {
    mockFeed({ snapshot: consoleSnapshot() });
    render(<MonitorConsolePage />);

    expect(probe("monitor-console-page")?.getAttribute("data-state")).toBe("fresh");
    const readouts = probes("monitor-console-readout");
    expect(readouts).toHaveLength(4);
    expect(readouts.map((item) => item.getAttribute("data-readout"))).toEqual([
      "window",
      "today",
      "active-sessions",
      "today-compactions"
    ]);
    expect(screen.getByText("本窗口已用").closest("div")).toHaveTextContent("3,750");
    expect(screen.getByText("今天").closest("div")).toHaveTextContent("3,750");
    expect(screen.getByText("活跃会话").closest("div")).toHaveTextContent("2");
    expect(screen.getByText("今天压缩").closest("div")).toHaveTextContent("1");
  });

  it("没有活动窗口时读数说事实，不编造 0/hour", () => {
    const future = meta("/repo/future/session.jsonl", "future", "Future session");
    mockFeed({
      snapshot: snapshotOf([
        {
          projectLabel: "future",
          projectPath: "/repo/future",
          session: future,
          records: [record(NOW + MINUTE, usage(1_000))]
        }
      ])
    });
    render(<MonitorConsolePage />);

    const windowReadout = document.querySelector('[data-readout="window"]')!;
    expect(windowReadout).toHaveTextContent("暂无活动窗口");
    expect(windowReadout).toHaveTextContent("最近 5 小时没有计费窗口");
  });

  it("小时三态：过去零值是短桩，当前恰一根斜纹柱，未来没有填充", () => {
    mockFeed({ snapshot: consoleSnapshot() });
    render(<MonitorConsolePage />);

    const chart = probe("monitor-console-hours")!;
    expect(chart).toHaveAttribute("role", "img");
    expect(chart.getAttribute("aria-label")).toContain("当前 12 点进行中");
    const slots = probes("monitor-console-hour-slot");
    expect(slots).toHaveLength(24);
    expect(
      slots.every(
        (slot) =>
          slot.querySelector('[data-probe="monitor-console-hour"]')?.getAttribute("aria-hidden") ===
          "true"
      )
    ).toBe(true);
    expect(probes("monitor-console-hour")).toHaveLength(24);
    expect(probes("monitor-console-hour").every((bar) => bar.hasAttribute("data-phase"))).toBe(true);
    expect(slots.filter((slot) => slot.getAttribute("data-state") === "current")).toHaveLength(1);
    expect(slots.filter((slot) => slot.getAttribute("data-partial") === "true")).toHaveLength(1);

    const pastZero = slots.find(
      (slot) =>
        slot.getAttribute("data-state") === "past" &&
        slot.getAttribute("data-zero") === "true"
    )!;
    expect(
      pastZero.querySelector('[data-probe="monitor-console-hour-fill"]')
    ).not.toBeNull();

    const current = slots.find((slot) => slot.getAttribute("data-state") === "current")!;
    expect(current.querySelector('[data-probe="monitor-console-hour-fill"]')).toHaveAttribute(
      "data-partial",
      "true"
    );

    for (const future of slots.filter((slot) => slot.getAttribute("data-state") === "future")) {
      expect(future.getAttribute("data-zero")).toBe("false");
      expect(future.querySelector('[data-probe="monitor-console-hour-fill"]')).toBeNull();
    }
  });
});

describe("MonitorConsolePage 项目与事件筛选", () => {
  it("项目行点击筛选，再点取消；可叠加事件类型筛选", () => {
    mockFeed({ snapshot: consoleSnapshot() });
    render(<MonitorConsolePage />);

    const projectRows = probes("monitor-console-project-row");
    const alpha = projectRows.find((row) => row.getAttribute("data-project") === "alpha")!;
    fireEvent.click(alpha);
    expect(alpha.getAttribute("data-selected")).toBe("true");
    expect(probes("monitor-console-event-row")).toHaveLength(2);
    expect(screen.getByText("项目：alpha")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "错误" }));
    expect(probes("monitor-console-event-row")).toHaveLength(1);

    fireEvent.click(alpha);
    expect(alpha.getAttribute("data-selected")).toBe("false");
    expect(probes("monitor-console-event-row")).toHaveLength(2);
  });

  it("类型筛选四项分别作用于已算好的全局最近事件", () => {
    mockFeed({ snapshot: consoleSnapshot() });
    render(<MonitorConsolePage />);

    expect(probes("monitor-console-event-row")).toHaveLength(5);
    fireEvent.click(screen.getByRole("radio", { name: "压缩" }));
    expect(probes("monitor-console-event-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "错误" }));
    expect(probes("monitor-console-event-row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "会话开始" }));
    expect(probes("monitor-console-event-row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("radio", { name: "全部" }));
    expect(probes("monitor-console-event-row")).toHaveLength(5);
  });

  it("清除按钮同时结束项目筛选，保留事件类型筛选", () => {
    mockFeed({ snapshot: consoleSnapshot() });
    render(<MonitorConsolePage />);

    const alpha = probes("monitor-console-project-row").find(
      (row) => row.getAttribute("data-project") === "alpha"
    )!;
    fireEvent.click(alpha);
    fireEvent.click(screen.getByRole("button", { name: "清除" }));

    expect(alpha.getAttribute("data-selected")).toBe("false");
    expect(screen.queryByText("项目：alpha")).not.toBeInTheDocument();
    expect(probes("monitor-console-event-row")).toHaveLength(5);
  });

  it("事件行把会话 path 交回，并让完整脱敏预览进入 title 与 aria-label", () => {
    const onOpenSession = vi.fn();
    mockFeed({ snapshot: consoleSnapshot() });
    render(<MonitorConsolePage onOpenSession={onOpenSession} />);

    const errors = probes("monitor-console-event-row").filter(
      (row) => row.getAttribute("data-kind") === "error"
    );
    const alphaError = errors.find((row) => row.textContent?.includes("Bash"))!;
    expect(alphaError.getAttribute("title")).toContain("token-7f3a");
    expect(alphaError.getAttribute("aria-label")).toContain("token-7f3a");
    expect(alphaError.getAttribute("title")).not.toContain("/Users/");
    expect(alphaError.getAttribute("aria-label")).not.toContain("/Users/");

    fireEvent.click(alphaError);
    expect(onOpenSession).toHaveBeenCalledWith(SESSION_A);
  });

  it("事件行固定五槽，三类字形带类型语义且装饰字形不朗读", () => {
    mockFeed({ snapshot: consoleSnapshot() });
    render(<MonitorConsolePage />);

    const rows = probes("monitor-console-event-row");
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.querySelectorAll("[data-slot]")).toHaveLength(5);
      expect(row.querySelector('[data-slot="glyph"]')).toHaveAttribute("aria-hidden", "true");
    }
    expect(rows.find((row) => row.getAttribute("data-kind") === "compaction")).toHaveTextContent("⇣");
    expect(rows.find((row) => row.getAttribute("data-kind") === "error")).toHaveTextContent("!");
    expect(rows.find((row) => row.getAttribute("data-kind") === "session")).toHaveTextContent("＋");
  });
});

describe("MonitorConsolePage 窄窗与 130%", () => {
  it("130% 下根节点仍是不溢出的纵向容器，board 在窄窗单列", () => {
    document.documentElement.style.setProperty("--font-scale", "1.3");
    mockFeed({ snapshot: consoleSnapshot() });
    render(
      <div style={{ width: "800px" }}>
        <MonitorConsolePage />
      </div>
    );

    const page = probe("monitor-console-page") as HTMLElement;
    Object.defineProperty(page, "clientWidth", { configurable: true, value: 800 });
    Object.defineProperty(page, "scrollWidth", { configurable: true, value: 800 });
    expect(page.scrollWidth).toBeLessThanOrEqual(page.clientWidth);

    expect(consoleCss).toMatch(/\.consolePage\s*\{[^}]*min-width:\s*0/s);
    expect(consoleCss).toMatch(/\.consoleInner\s*\{[^}]*min-width:\s*0/s);
    expect(consoleCss).toMatch(/\.board\s*\{[^}]*min-width:\s*0/s);
    expect(consoleCss).toMatch(/\.eventRow\s*\{[^}]*minmax\(0,\s*7em\)/s);
    expect(consoleCss).toMatch(/@media\s*\(min-width:\s*1180px\)[^{]*\{[^}]*grid-template-columns/s);
  });
});
