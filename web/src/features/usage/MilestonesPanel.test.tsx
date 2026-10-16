import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  firstsOf,
  recordsOf,
  tiersOf,
  type HistoryFacts,
  type MilestoneReport,
  type MilestoneSessionFact
} from "./milestones";
import { MilestonesPanel } from "./MilestonesPanel";

/**
 * 里程碑组件（Issue #214，规格 design-round-y §5–§7 与 §15.2 的裁决）。
 *
 * 组件只吃 `MilestoneReport`——所以这里直接摆报告，不经过扫描：报告形状就是
 * 契约，两态、缺席、空态都能在一个 `render` 里摆出来，不必为了「未达成」去造
 * 一份巨大的夹具。页面级集成（分段项、空态让位、下钻握手）由
 * `UsageOverviewPage.test.tsx` 负责。
 */

/** 2026-05-31（本地日）。 */
const DAY = new Date(2026, 4, 31).getTime();

function sessionFact(
  path: string,
  title: string,
  overrides: Partial<MilestoneSessionFact> = {}
): MilestoneSessionFact {
  return {
    key: `path:${path}`,
    ref: { path, title, projectLabel: "-repo-demo" },
    dayStart: DAY,
    firstAt: DAY,
    lastAt: DAY + 3_600_000,
    durationMs: 3_600_000,
    tokens: 1_000_000,
    messages: 2,
    compactions: 1,
    ...overrides
  };
}

function factsOf(overrides: Partial<HistoryFacts> = {}): HistoryFacts {
  return {
    tokens: 0,
    sessionCount: 1,
    messages: 0,
    compactions: 0,
    projects: [],
    models: [],
    tools: [],
    days: [],
    earliestSession: null,
    firstCompaction: null,
    firstSubagent: null,
    firstSkill: null,
    firstMcp: null,
    tokenRecord: null,
    durationRecord: null,
    compactionRecord: null,
    ...overrides
  };
}

function reportOf(facts: HistoryFacts): MilestoneReport {
  return {
    generatedAt: DAY,
    empty: false,
    facts,
    tiers: tiersOf(facts),
    firsts: firstsOf(facts),
    records: recordsOf(facts)
  };
}

/** 三组全在场的一份报告：5 枚首次 + 7 枚阶梯 + 3 枚记录 = 15 枚。 */
function fullFacts(): HistoryFacts {
  const a = sessionFact("/sessions/a.jsonl", "会话 A");
  const b = sessionFact("/sessions/b.jsonl", "会话 B", { tokens: 5_000_000, compactions: 2 });
  return factsOf({
    tokens: 12_400_000,
    sessionCount: 2,
    messages: 40,
    compactions: 2,
    projects: ["-repo-demo"],
    models: ["claude-sonnet-4-5"],
    tools: ["builtin:Bash", "skill:commit"],
    days: [DAY],
    earliestSession: a,
    firstCompaction: { at: DAY, session: a },
    // 三个工具类的「首次」带着那一刻调用自己的名字（§5.2 的证据行读数）。
    firstSubagent: { at: DAY, detail: "explore", session: a },
    firstSkill: { at: DAY, detail: "commit", session: a },
    firstMcp: { at: DAY, detail: "demo/query", session: b },
    tokenRecord: b,
    durationRecord: a,
    compactionRecord: b
  });
}

function cardOf(key: string): HTMLElement {
  const card = document.querySelector(`[data-milestone="${key}"]`);
  expect(card, `缺 ${key} 这一枚`).not.toBeNull();
  return card as HTMLElement;
}

function probeOf(scope: HTMLElement, probe: string): HTMLElement | null {
  return scope.querySelector(`[data-probe="${probe}"]`);
}

describe("MilestonesPanel", () => {
  it("窗口声明行走页底小字，逐字写明清真口径（全历史 / 含归档）", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    const scope = document.querySelector('[data-probe="milestones-scope"]');
    expect(scope).not.toBeNull();
    expect(scope!.textContent).toContain("全部已扫描的会话");
    expect(scope!.textContent).toContain("含本地归档");
    expect(scope!.textContent).toContain("不含 Claude Code 已清理且未归档的会话");
  });

  it("两态各一例：一档都没跨过 → unreached；跨过至少一档 → reached", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    // 累计 token 12.4M：跨过 1M 与 10M 两档。
    expect(cardOf("tier-tokens")).toHaveAttribute("data-state", "reached");
    // 累计消息 40 条：第一档是 100，一档都没跨过。
    expect(cardOf("tier-messages")).toHaveAttribute("data-state", "unreached");
  });

  it("0 档下取不到填充元素（不是宽度 0），已达档的填充带 2px 地板", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    // 未达成：整个填充元素不渲染——画一点点进度比不画更糟。
    expect(probeOf(cardOf("tier-messages"), "milestone-fill")).toBeNull();
    // 但轨道仍在（剩余段就是那条有色底），档位读数也在。
    expect(probeOf(cardOf("tier-messages"), "milestone-track")).not.toBeNull();
    expect(within(cardOf("tier-messages")).getByText("0/4 档")).toBeInTheDocument();

    const fill = probeOf(cardOf("tier-tokens"), "milestone-fill");
    expect(fill).not.toBeNull();
    // 正好踩在门槛上时宽 0 会读成「没进度」——2px 是几何地板。
    expect((fill as HTMLElement).style.width).toContain("max(2px");
  });

  it("未达成项的当前值与达成项同字号 / 同字重 / 同一个 --text（不降权）", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    const reachedValue = probeOf(cardOf("tier-tokens"), "milestone-value") as HTMLElement;
    const unreachedValue = probeOf(cardOf("tier-messages"), "milestone-value") as HTMLElement;

    // 同一个 class = 同一套字号 / 字重 / 颜色令牌；「事实降一档」是剪影的第一步。
    expect(unreachedValue.className).toBe(reachedValue.className);
    expect(unreachedValue.className).not.toBe("");
    expect(reachedValue.textContent).toBe("12.4M");
    // 假读数（0 / ?? / —）一律不许出现在值槽上。
    expect(unreachedValue.textContent).toBe("40");
  });

  it("已达最高档：距离行写「已到最高档」，轨道不再冒充 progressbar", () => {
    render(<MilestonesPanel report={reportOf(factsOf({ tokens: 2_000_000_000 }))} />);

    const card = cardOf("tier-tokens");
    expect(within(card).getByText("已到最高档")).toBeInTheDocument();
    // min === max 的进度条是一个假控件，语义交给距离行。
    const track = probeOf(card, "milestone-track") as HTMLElement;
    expect(track.getAttribute("role")).toBeNull();
    expect(track).toHaveAttribute("aria-hidden", "true");
    // 已达最高档仍然有填充（满条），它属于「有那点墨」的一侧。
    expect(probeOf(card, "milestone-fill")).not.toBeNull();
    expect(within(card).getByText("4/4 档")).toBeInTheDocument();
  });

  it("阶梯进度条用真值语义：区间 = 本档 / 下一档，0 档从 0 起", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    const reached = probeOf(cardOf("tier-tokens"), "milestone-track") as HTMLElement;
    expect(reached).toHaveAttribute("role", "progressbar");
    expect(reached).toHaveAttribute("aria-valuemin", "10000000");
    expect(reached).toHaveAttribute("aria-valuemax", "100000000");
    expect(reached).toHaveAttribute("aria-valuenow", "12400000");
    expect(reached.getAttribute("aria-valuetext")).toContain("距 100.0M 还差 87.6M");

    const unreached = probeOf(cardOf("tier-messages"), "milestone-track") as HTMLElement;
    expect(unreached).toHaveAttribute("aria-valuemin", "0");
    expect(unreached).toHaveAttribute("aria-valuemax", "100");
    expect(unreached).toHaveAttribute("aria-valuenow", "40");
  });

  it("距离行是「还差 N 到 M」，不给单位词（单位由口径行承担）", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    const distance = probeOf(cardOf("tier-tokens"), "milestone-distance") as HTMLElement;
    expect(distance.textContent).toBe("还差 87.6M 到 100.0M");
    expect(distance.textContent).not.toContain("token");
    // 计数类走 en-US 分组，不套 token 的缩写尺。
    expect(probeOf(cardOf("tier-messages"), "milestone-distance")!.textContent).toBe(
      "还差 60 到 100"
    );
  });

  it("副读数分两种口径：阶梯给档位（7 枚）、记录给日期（3 枚）", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    expect(document.querySelectorAll('[data-probe="milestone-subread"][data-kind="tier"]')).toHaveLength(
      7
    );
    expect(document.querySelectorAll('[data-probe="milestone-subread"][data-kind="date"]')).toHaveLength(
      3
    );
    // 记录类的日期是副读数，不是值槽。
    expect(within(cardOf("record-session-tokens")).getByText("2026-05-31")).toBeInTheDocument();
    expect(within(cardOf("record-session-tokens")).getByText("5.0M")).toBeInTheDocument();
  });

  it("三组都渲染、每枚一枚口径行、每张面板一条脚注", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} />);

    expect(document.querySelectorAll('[data-probe="milestones-group"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-probe="milestone-card"]')).toHaveLength(15);
    expect(document.querySelectorAll('[data-probe="milestone-note"]')).toHaveLength(15);
    expect(document.querySelectorAll('[data-probe="milestones-fallback"]')).toHaveLength(3);
    expect(screen.getByText(/只列出本机日志里真实发生过的第一次/)).toBeInTheDocument();
    expect(screen.getByText(/档位是写死的常量/)).toBeInTheDocument();
    expect(screen.getByText(/并列时取更早达成的那一个/)).toBeInTheDocument();
  });

  it("首次类的值是一律带年的日期，没有目标名时才退回会话标题", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} onOpenSession={vi.fn()} />);

    const card = cardOf("first-session");
    expect(probeOf(card, "milestone-value")!.textContent).toBe("2026-05-31");
    expect(card.textContent).toContain("会话日志的首条记录");
    expect(probeOf(card, "milestone-evidence")!.textContent).toContain("会话 A");
  });

  it("工具类首次的证据行渲染那一刻的目标名（skill 名 / server 工具 / 子 agent 类型）", () => {
    render(<MilestonesPanel report={reportOf(fullFacts())} onOpenSession={vi.fn()} />);

    const evidenceText = (key: string) => probeOf(cardOf(key), "milestone-evidence")!.textContent ?? "";
    expect(evidenceText("first-skill")).toBe("◆commit");
    expect(evidenceText("first-mcp")).toBe("◆demo/query");
    expect(evidenceText("first-subagent")).toBe("◆explore");
    // 目标名在场时**不**再写会话标题——五行写同一句正是 Issue #214 的缺陷。
    expect(evidenceText("first-skill")).not.toContain("会话 A");
    expect(evidenceText("first-mcp")).not.toContain("会话 B");
    // 会话与压缩没有「目标名」这一回事，照旧退回会话标题。
    expect(evidenceText("first-session")).toBe("◆会话 A");
    expect(evidenceText("first-compaction")).toBe("◆会话 A");
  });

  it("首次类缺枚时卡片数减少，而不是长出未达成卡", () => {
    // 只有第一次会话与第一次压缩——缺席的三枚不占位、也不给「未达成」形态。
    const a = sessionFact("/sessions/a.jsonl", "会话 A");
    render(
      <MilestonesPanel
        report={reportOf(
          factsOf({ earliestSession: a, firstCompaction: { at: DAY, session: a } })
        )}
      />
    );

    expect(document.querySelectorAll('[data-group="firsts"] [data-probe="milestone-card"]')).toHaveLength(
      2
    );
    expect(document.querySelector('[data-milestone="first-skill"]')).toBeNull();
    expect(document.querySelector('[data-milestone="first-mcp"]')).toBeNull();
    expect(
      document.querySelectorAll('[data-group="firsts"] [data-state="unreached"]')
    ).toHaveLength(0);
  });

  it("组内缺席给一行原因（顿号列名 + 「这几枚不列」）", () => {
    const a = sessionFact("/sessions/a.jsonl", "会话 A");
    render(<MilestonesPanel report={reportOf(factsOf({ earliestSession: a }))} />);

    const gap = document.querySelector('[data-probe="milestones-gap-note"]');
    expect(gap).not.toBeNull();
    expect(gap!.textContent).toBe(
      "本机日志里没有 压缩、子 agent、skill、MCP 工具的调用记录，这四枚不列。"
    );
  });

  it("整组缺席不渲染空货架：没有这张面板，改由页尾一条事实行承担", () => {
    // 有会话、但一条有效记录都没有 → 首次与记录都算不出来，阶梯照算（全 0）。
    render(
      <MilestonesPanel
        report={reportOf(factsOf({ sessionCount: 3, messages: 0 }))}
      />
    );

    expect(document.querySelector('[data-group="firsts"]')).toBeNull();
    expect(document.querySelector('[data-group="records"]')).toBeNull();
    expect(document.querySelector('[data-group="tiers"]')).not.toBeNull();

    const tails = [...document.querySelectorAll('[data-probe="milestones-gap-note"]')].map(
      (node) => node.textContent
    );
    expect(tails).toEqual([
      "本机日志里没有会话 / 压缩 / 子 agent / skill / MCP 工具记录，首次里程碑暂无可列的事实。",
      "本机日志里没有最多 Token / 最长时长 / 最多压缩次数记录，单会话记录暂无可列的事实。"
    ]);
  });

  it("空报告：一条事实行，三张 Panel 一张都不渲染", () => {
    render(
      <MilestonesPanel
        report={{ generatedAt: DAY, empty: true, facts: factsOf(), tiers: [], firsts: [], records: [] }}
      />
    );

    expect(document.querySelector('[data-probe="milestones-empty"]')).not.toBeNull();
    expect(screen.getByText("还没有可以回顾的里程碑")).toBeInTheDocument();
    expect(screen.getByText(/本机 ~\/.claude\/projects 下没有会话记录/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-probe="milestone-card"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-probe="milestones-group"]')).toHaveLength(0);
  });

  it("点入口把会话 path 交回页面（不是标题、不是 index）", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(<MilestonesPanel report={reportOf(fullFacts())} onOpenSession={onOpenSession} />);

    // 会话 B 是 MCP 那枚的目标会话（证据行写的是调用名，不是会话标题），所以按卡片
    // 作用域取那一枚。
    await user.click(
      within(cardOf("first-mcp")).getByRole("button", { name: "打开会话：demo/query" })
    );

    expect(onOpenSession).toHaveBeenCalledTimes(1);
    const path = onOpenSession.mock.calls[0][0];
    expect(path).toBe("/sessions/b.jsonl");
  });

  it("没有会话元数据（path 为空）时退到「那一天」；两个回调都没有时是不可点的行", () => {
    const orphan = sessionFact("", "无元数据会话");
    const report = reportOf(factsOf({ earliestSession: orphan, firstCompaction: { at: DAY, session: orphan } }));

    const onOpenDay = vi.fn();
    const { unmount } = render(<MilestonesPanel report={report} onOpenDay={onOpenDay} />);
    const entry = document.querySelector('[data-probe="milestone-entry"]') as HTMLElement;
    expect(entry).not.toBeNull();
    entry.click();
    expect(onOpenDay).toHaveBeenCalledWith(DAY);
    unmount();

    // 交不出任何目标时渲染成 <span>，而不是 disabled 按钮。
    render(<MilestonesPanel report={report} />);
    expect(document.querySelector('[data-probe="milestone-entry"]')).toBeNull();
    expect(document.querySelectorAll('[data-probe="milestone-evidence"]').length).toBeGreaterThan(0);
  });

  it("记录类的日期自成一个「那一天」入口；没有 onOpenDay 时仍是纯读数", async () => {
    const user = userEvent.setup();
    const onOpenDay = vi.fn();
    // 证据行优先打开会话，所以有会话元数据时「那一天」只剩日期这一个落点——
    // 这条用例钉住它真的可点（否则下钻在生产里是死代码）。
    const { unmount } = render(
      <MilestonesPanel report={reportOf(fullFacts())} onOpenDay={onOpenDay} />
    );
    const dateLink = cardOf("record-session-tokens").querySelector(
      '[data-probe="milestone-subread"][data-kind="date"]'
    ) as HTMLButtonElement;
    expect(dateLink.tagName).toBe("BUTTON");
    expect(dateLink).toHaveAttribute("aria-label", "打开 2026年5月31日 的一日回望");
    await user.click(dateLink);
    expect(onOpenDay).toHaveBeenCalledWith(DAY);
    unmount();

    // 单测直挂（没有 onOpenDay）：仍是不可点的读数，不是点了没反馈的空按钮。
    render(<MilestonesPanel report={reportOf(fullFacts())} />);
    const readout = cardOf("record-session-tokens").querySelector(
      '[data-probe="milestone-subread"][data-kind="date"]'
    ) as HTMLElement;
    expect(readout.tagName).toBe("SPAN");
  });
});
