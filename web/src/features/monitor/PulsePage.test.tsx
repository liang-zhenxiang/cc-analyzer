import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatClock } from "../../lib/format";
import { parseJsonlText } from "../sessions/parseJsonl";
import type { SessionMeta } from "../sessions/metadataCache";
import type { CompactEvent, SessionRecord, SessionUsage } from "../sessions/types";
import type { UsageSessionInput } from "../usage/usageAggregations";
import { setPlan } from "../usage/planLimits";
import { PulsePage } from "./PulsePage";
import { sessionRows, type SessionRowInput } from "./pulseModel";
import { usePulseFeed, type PulseFeedResult, type PulseSnapshot } from "./usePulseFeed";

import noneFixture from "../../../tests/fixtures/pulse-compact-none.jsonl?raw";
import sixFixture from "../../../tests/fixtures/pulse-compact-six.jsonl?raw";
import threeFixture from "../../../tests/fixtures/pulse-compact-three.jsonl?raw";
import twoFixture from "../../../tests/fixtures/pulse-compact-two.jsonl?raw";

/**
 * PulsePage 的渲染契约。数据层（`usePulseFeed` 的调度 + `pulseModel` 的纯函数）
 * 已有自己的测试，所以这里把 feed 换成受控桩——组件的职责就是**把算好的结果
 * 摆对**，用真文件去驱动只会让「三档边界」「60 根柱」这些断言依赖时钟。
 */
vi.mock("./usePulseFeed", () => ({ usePulseFeed: vi.fn() }));

const NOW = new Date(2026, 9, 15, 12, 0, 0, 0).getTime();

const pulsePageCss = readFileSync(
  resolve(process.cwd(), "src/features/monitor/PulsePage.module.css"),
  "utf8"
);

function usage(inputTokens: number, outputTokens = 0): SessionUsage {
  return { inputTokens, outputTokens };
}

function record(timestamp: number, tokens?: SessionUsage): SessionRecord {
  return {
    id: `r-${timestamp}`,
    fullId: `full-${timestamp}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    usage: tokens
  } as unknown as SessionRecord;
}

function sessionMeta(path: string, mtimeMs: number): SessionMeta {
  return {
    path,
    projectLabel: "-repo-demo",
    mtimeMs,
    sizeBytes: 1024,
    hasRecords: true,
    metadataStatus: "pending"
  };
}

type FixtureSession = {
  mtimeMs: number;
  records: SessionRecord[];
  title?: string;
  compactEvents?: CompactEvent[];
  path?: string;
};

/** 用真 `sessionRows` 组一份快照：行的排序 / 年龄 / 新近度仍是模型的输出。 */
function buildSnapshot(now: number, fixtures: FixtureSession[]): PulseSnapshot {
  const inputs: UsageSessionInput[] = [];
  const rowInputs: SessionRowInput[] = [];
  let latest: PulseSnapshot["latest"] = null;
  fixtures.forEach((fixture, index) => {
    const session = sessionMeta(
      fixture.path ?? `/home/tester/.claude/projects/-repo-demo/s-${index}.jsonl`,
      fixture.mtimeMs
    );
    inputs.push({
      records: fixture.records,
      projectLabel: session.projectLabel,
      projectPath: session.cwd,
      session
    });
    rowInputs.push({ session, records: fixture.records, title: fixture.title ?? `会话 ${index}` });
    if (latest === null && fixture.records.length > 0) {
      latest = { session, records: fixture.records, compactEvents: fixture.compactEvents ?? [] };
    }
  });
  return { now, inputs, rows: sessionRows(rowInputs, now), latest, changed: true, durationMs: 0 };
}

function oneSession(records: SessionRecord[], title = "实时会话"): PulseSnapshot {
  return buildSnapshot(NOW, [{ mtimeMs: NOW - 10_000, records, title }]);
}

function fixtureSnapshot(fixture: string, path: string): PulseSnapshot {
  const parsed = parseJsonlText(fixture, path);
  return buildSnapshot(NOW, [
    {
      mtimeMs: NOW - 10_000,
      records: parsed.records,
      compactEvents: parsed.compactEvents ?? []
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

function probes(name: string): NodeListOf<Element> {
  return document.querySelectorAll(`[data-probe="${name}"]`);
}

/** 行标题所在那条 li 的 data-recency；标题是唯一不随年龄取整抖动的事实。 */
function recencyFor(title: string): string | null {
  for (const item of document.querySelectorAll('[data-probe="pulse-session-row"]')) {
    if (item.textContent?.includes(title)) return item.getAttribute("data-recency");
  }
  return null;
}

function predictionReadout(): Element {
  return document.querySelector('[data-readout="prediction"]')!;
}

beforeEach(() => {
  vi.mocked(usePulseFeed).mockReset();
  // 计划是模块单例（`getPlan` 会缓存），每个用例显式落回「未设预算」。
  setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
});

afterEach(() => {
  vi.mocked(usePulseFeed).mockReset();
});

describe("PulsePage 四态", () => {
  it("加载态：三块骨架都在场且容器带 data-probe-pending，状态行说正在读取", () => {
    mockFeed({ snapshot: null, loading: true });
    render(<PulsePage />);

    expect(probe("pulse-page")?.getAttribute("data-state")).toBe("loading");
    expect(probe("pulse-skeleton")?.hasAttribute("data-probe-pending")).toBe(true);
    expect(probe("pulse-page")?.querySelectorAll("[data-probe-pending]").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("正在读取本地日志…")).toBeInTheDocument();
    // 只保留一个 live region：Skeleton 的 role=status。
    expect(screen.getByRole("status", { name: "正在读取活跃会话" })).toBeInTheDocument();
  });

  it("错误态：整页错误态 + 重试；原始异常串默认不进 DOM", () => {
    mockFeed({ snapshot: null, error: "读取失败 /Users/tester/secret" });
    render(<PulsePage />);

    expect(probe("pulse-page")?.getAttribute("data-state")).toBe("error");
    expect(probe("pulse-error")).not.toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("读取本地日志失败");
    expect(alert.innerHTML).not.toContain("/Users/");

    const before = vi.mocked(usePulseFeed).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    // 重试 = 重挂载 → feed 重新开拍。
    expect(vi.mocked(usePulseFeed).mock.calls.length).toBeGreaterThan(before);
  });

  it("空态：整页空态，页头仍在场", () => {
    mockFeed({ snapshot: buildSnapshot(NOW, []) });
    render(<PulsePage />);

    expect(probe("pulse-page")?.getAttribute("data-state")).toBe("empty");
    expect(probe("pulse-empty")).not.toBeNull();
    expect(screen.getByText("本机还没有会话日志")).toBeInTheDocument();
    expect(probe("pulse-head")).not.toBeNull();
  });

  it("过期态：一个旧读数都不清空，状态行变红并给重试", () => {
    const snapshot = oneSession([record(NOW - 10_000, usage(1_000))]);
    mockFeed({ snapshot, stale: { at: NOW + 5_000, reason: "boom" } });
    render(<PulsePage />);

    expect(probe("pulse-page")?.getAttribute("data-state")).toBe("stale");
    const stateLine = probe("pulse-refresh-state")!;
    expect(stateLine.getAttribute("data-stale")).toBe("true");
    // 时间是上一次成功那一拍（snapshot.now），不是失败时刻。
    expect(stateLine.textContent).toContain(`上次更新 ${formatClock(NOW, true)}`);
    expect(stateLine.textContent).toContain("本次读取失败");
    // 旧读数仍在：5 个读数 + 会话面板 + 曲线。
    expect(probes("pulse-window-readout").length).toBe(5);
    expect(probe("pulse-sessions")).not.toBeNull();
    expect(probe("pulse-rate-curve")).not.toBeNull();
  });
});

describe("PulsePage 活跃会话", () => {
  it("新近度三档在 120s / 900s 边界两侧各一例", () => {
    mockFeed({
      snapshot: buildSnapshot(NOW, [
        { mtimeMs: NOW - 120_000, records: [], title: "恰逢 120 秒" },
        { mtimeMs: NOW - 120_001, records: [], title: "刚过 120 秒" },
        { mtimeMs: NOW - 900_000, records: [], title: "恰逢 900 秒" },
        { mtimeMs: NOW - 900_001, records: [], title: "刚过 900 秒" }
      ])
    });
    render(<PulsePage />);

    expect(recencyFor("恰逢 120 秒")).toBe("live");
    expect(recencyFor("刚过 120 秒")).toBe("recent");
    expect(recencyFor("恰逢 900 秒")).toBe("recent");
    expect(recencyFor("刚过 900 秒")).toBe("idle");
    expect(probes("pulse-session-tick").length).toBe(4);
    // 页面可见时只有 live 一档挂心跳。
    expect(probes("pulse-session-tick")[0].getAttribute("data-beat")).toBe("true");
  });

  it("行内文案说「多久前有新记录」，不给「正在运行」的断言", () => {
    mockFeed({
      snapshot: buildSnapshot(NOW, [
        { mtimeMs: NOW - 12_000, records: [], title: "刚写的会话" }
      ])
    });
    render(<PulsePage />);
    expect(screen.getByText("12 秒前有新记录")).toBeInTheDocument();
    expect(
      screen.getByText("只陈述「多久前有新记录」，不代表会话正在运行。")
    ).toBeInTheDocument();
  });

  it("字形高度是 12 / 8 / 4（改为别的值这条会红）", () => {
    const height = (tier: string) =>
      new RegExp(`\\.sessionItem\\[data-recency="${tier}"\\] \\.sessionTick\\s*\\{[^}]*height:\\s*(\\d+)px`).exec(
        pulsePageCss
      )?.[1];
    expect(height("live")).toBe("12");
    expect(height("recent")).toBe("8");
    expect(height("idle")).toBe("4");
  });

  it("点会话行把 path 交回给 onOpenSession", () => {
    const onOpenSession = vi.fn();
    mockFeed({ snapshot: oneSession([record(NOW - 10_000, usage(1_000))], "可打开的会话") });
    render(<PulsePage onOpenSession={onOpenSession} />);

    fireEvent.click(screen.getByRole("button", { name: /可打开的会话/ }));
    expect(onOpenSession).toHaveBeenCalledWith(
      "/home/tester/.claude/projects/-repo-demo/s-0.jsonl"
    );
  });
});

describe("PulsePage 曲线与读数", () => {
  it("速率曲线 60 根柱、恰好 1 根未完成（R3）", () => {
    mockFeed({ snapshot: oneSession([record(NOW - 10_000, usage(5_000))]) });
    render(<PulsePage />);

    expect(probes("pulse-rate-bar").length).toBe(60);
    expect(
      document.querySelectorAll('[data-probe="pulse-rate-bar"][data-partial="true"]').length
    ).toBe(1);
    expect(probe("pulse-rate-curve")?.getAttribute("data-bucket-count")).toBe("60");
  });

  it("5 小时窗口恒有 5 个读数，键序列逐字可断言（R4）", () => {
    mockFeed({ snapshot: oneSession([record(NOW - 10_000, usage(1_000))]) });
    render(<PulsePage />);

    const keys = [...probes("pulse-window-readout")].map((node) =>
      node.getAttribute("data-readout")
    );
    expect(keys).toEqual(["used", "closes", "avg-rate", "recent-rate", "prediction"]);
  });

  it("参考带：0 次自动压缩 → 不画带，只留「样本不足」文案", () => {
    mockFeed({ snapshot: fixtureSnapshot(noneFixture, "/tmp/pulse-none.jsonl") });
    render(<PulsePage />);
    expect(probe("pulse-context-band")).toBeNull();
    expect(probe("pulse-context-note")?.textContent).toContain("参考带样本不足");
    expect(probe("pulse-context-note")?.textContent).toContain("n=0");
  });

  it("参考带：2 次自动压缩 → 仍不画带，文案说样本不足（n=2）", () => {
    mockFeed({ snapshot: fixtureSnapshot(twoFixture, "/tmp/pulse-two.jsonl") });
    render(<PulsePage />);
    expect(probe("pulse-context-band")).toBeNull();
    expect(probe("pulse-context-note")?.textContent).toContain("参考带样本不足");
    expect(probe("pulse-context-note")?.textContent).toContain("n=2");
  });

  it("参考带：3 次自动压缩 → 画带，文案给区间与「最近 3 次」", () => {
    mockFeed({ snapshot: fixtureSnapshot(threeFixture, "/tmp/pulse-three.jsonl") });
    render(<PulsePage />);
    expect(probe("pulse-context-band")).not.toBeNull();
    const note = probe("pulse-context-note")!.textContent!;
    expect(note).toContain("自动压缩前体量");
    expect(note).toContain("最近 3 次");
  });

  it("参考带：6 次自动压缩 → 只取最近 5 次", () => {
    mockFeed({ snapshot: fixtureSnapshot(sixFixture, "/tmp/pulse-six.jsonl") });
    render(<PulsePage />);
    expect(probe("pulse-context-band")).not.toBeNull();
    expect(probe("pulse-context-note")?.textContent).toContain("最近 5 次");
  });
});

describe("PulsePage 5 小时读数", () => {
  it("两种退化：没有分母 vs 样本不够——同版式、不同文案", () => {
    const records = [record(NOW - 10_000, usage(1_000))];

    // 未设预算：plan = none → predictLimitReach 返回 noLimit。
    setPlan({ id: "none", limitTokens: null, weeklyLimitTokens: null });
    mockFeed({ snapshot: oneSession(records) });
    const noLimit = render(<PulsePage />);
    const noLimitValue = predictionReadout().querySelector("b")!;
    expect(noLimitValue.textContent).toBe("未设预算");
    expect(predictionReadout().textContent).toContain(
      "在「设置 → 阈值设置」填入 5 小时预算后可预测"
    );
    noLimit.unmount();

    // 设了预算但窗口开启不足 30 分钟 → insufficientSample。
    setPlan({ id: "custom", limitTokens: 1_000_000, weeklyLimitTokens: null });
    mockFeed({ snapshot: oneSession(records) });
    render(<PulsePage />);
    const insufficientValue = predictionReadout().querySelector("b")!;
    expect(insufficientValue.textContent).toBe("样本不足");
    expect(predictionReadout().textContent).toContain("窗口开启不足 30 分钟");
    // 同版式：两个占位共用同一个 CSS module 类。
    expect(insufficientValue.className).toBe(noLimitValue.className);
  });

  it("预测触顶：早于窗口关闭用 --warning，晚于窗口关闭不用", () => {
    const records = [record(NOW - 3_600_000, usage(100_000))];

    // 速率 10 万/时、额度 20 万 → 1 小时后触顶，早于窗口关闭（+4 小时）。
    setPlan({ id: "custom", limitTokens: 200_000, weeklyLimitTokens: null });
    mockFeed({ snapshot: oneSession(records) });
    const early = render(<PulsePage />);
    expect(predictionReadout().getAttribute("data-warning")).toBe("true");
    early.unmount();

    // 同一个块、额度 1000 万 → 触顶落在窗口关闭之后，读数回到普通墨色。
    setPlan({ id: "custom", limitTokens: 10_000_000, weeklyLimitTokens: null });
    mockFeed({ snapshot: oneSession(records) });
    render(<PulsePage />);
    const readout = predictionReadout();
    expect(readout.getAttribute("data-warning")).toBe("false");
    // 标签在两个分支里逐字不变：语义由文字承载，颜色只是加强。
    expect(readout.textContent).toContain("预测触顶");
  });
});

describe("PulsePage 浮窗紧凑档", () => {
  it("compact：去掉「悬浮」与 pulse-head 锚点，只留刷新状态行", () => {
    mockFeed({ snapshot: oneSession([record(NOW - 10_000, usage(1_000))]) });
    render(<PulsePage compact />);

    expect(probe("pulse-head")).toBeNull();
    expect(screen.queryByRole("button", { name: "悬浮" })).toBeNull();
    expect(probe("pulse-refresh-state")).not.toBeNull();
    // 面板一个都不少：浮窗不是「数据少」的版本。
    expect(probe("pulse-window-card")).not.toBeNull();
    expect(probe("pulse-sessions")).not.toBeNull();
    expect(probe("pulse-context-curve")).not.toBeNull();
  });

  it("非 compact：页头在场且「悬浮」按钮可触发 onEnterFloat", () => {
    const onEnterFloat = vi.fn();
    mockFeed({ snapshot: oneSession([record(NOW - 10_000, usage(1_000))]) });
    render(<PulsePage onEnterFloat={onEnterFloat} />);

    expect(probe("pulse-head")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "悬浮" }));
    expect(onEnterFloat).toHaveBeenCalledTimes(1);
  });
});
