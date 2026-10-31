import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { toolCensus, type ToolCallFact, type CensusBucket } from "./toolCensus";
import { toolCalendar } from "./toolCalendar";
import { ToolCensusPanel, mergeTopSessions } from "./ToolCensusPanel";

/**
 * 组件直挂（页面级集成由 UsageOverviewPage.test 与 e2e 负责）：折尾、双口径
 * 读数、下钻、空态与无障碍标注。census 全部经 toolCensus 从合成事实聚合——
 * 组件测试与聚合层共用同一口径，不手造第三套数字。
 */

const NOW = Date.parse("2026-10-03T12:00:00.000Z");

function metaOf(path: string, prompt: string): SessionMeta {
  return { path, projectLabel: "-repo-demo", mtimeMs: 1, sizeBytes: 1, hasRecords: true, userPrompt: prompt };
}

function inputOf(session: SessionMeta, facts: ToolCallFact[]) {
  return { records: [], projectLabel: session.projectLabel, session, toolCalls: facts };
}

function fact(key: ToolCallFact["key"], sidechain = false): ToolCallFact {
  return { key, timestamp: NOW - 3_600_000, sidechain };
}

const bash = (n: number, sidechain = false) => Array.from({ length: n }, () => fact({ kind: "builtin", toolName: "Bash" }, sidechain));

/** 两会话：A 出 Bash 3主+1子 与 Read 2；B 出 Bash 2、Read 1 与 4 个一次性内置工具。 */
function twoSessionCensus() {
  const a = metaOf("/a", "会话A");
  const b = metaOf("/b", "会话B");
  return toolCensus(
    [
      inputOf(a, [
        ...bash(3),
        ...bash(1, true),
        ...Array.from({ length: 2 }, () => fact({ kind: "builtin", toolName: "Read" }))
      ]),
      inputOf(b, [
        ...bash(2),
        fact({ kind: "builtin", toolName: "Read" }),
        fact({ kind: "builtin", toolName: "Edit" }),
        fact({ kind: "builtin", toolName: "Write" }),
        fact({ kind: "builtin", toolName: "Grep" }),
        fact({ kind: "builtin", toolName: "Glob" }),
        fact({ kind: "builtin", toolName: "WebSearch" }),
        fact({ kind: "skill", skillName: "git-commit" }),
        fact({ kind: "skill", skillName: "git-commit" }),
        fact({ kind: "mcp", server: "demo", toolName: "query" }),
        fact({ kind: "mcp", server: "demo", toolName: "docs" }),
        fact({ kind: "mcp", server: "broken", toolName: "mcp__broken" }),
        fact({ kind: "subagent", subagentType: "trellis-implement" })
      ])
    ],
    30,
    NOW
  );
}

describe("ToolCensusPanel", () => {
  it("四栏齐全：体首行双读数、主榜 dual 读数、栏头类数与合计、脚注在场", () => {
    render(<ToolCensusPanel census={twoSessionCensus()} days={30} sessionsInWindow={2} />);

    // 体首行：共 20 次（主链 19 · 子 agent 1）→ 5.0%。
    expect(screen.getByText("共 20 次调用 · 主链 19 · 子 agent 占 5.0%")).toBeVisible();

    // 主榜 Bash 行：次数 6、会话 2（双读数并列）；title 带主链对照。
    const bashRow = screen.getByRole("button", { name: /^Bash/ });
    expect(within(bashRow).getByText("6")).toBeVisible();
    expect(within(bashRow).getByText("2 会话")).toBeVisible();
    expect(bashRow).toHaveAttribute("title", "Bash：6 次（主链 5 · 子 agent 1）· 2 个会话");

    // 栏头：桶身份（左）+ 类数与合计（右），分两个 span 渲染。
    expect(screen.getByText("内置工具", { exact: true })).toBeVisible();
    expect(screen.getByText("7 类 · 14 次")).toBeVisible();
    expect(screen.getByText("skill", { exact: true })).toBeVisible();
    expect(screen.getByText("1 个 · 2 次")).toBeVisible();
    expect(screen.getByText("子 agent", { exact: true })).toBeVisible();
    expect(screen.getByText("1 类 · 1 次")).toBeVisible();
    expect(screen.getByText("MCP", { exact: true })).toBeVisible();
    expect(screen.getByText("2 个服务器 · 3 次")).toBeVisible();

    // 四栏列表的 landmark 语义（e2e 与读屏靠它定位）。
    for (const label of ["内置工具调用排行", "skill 调用排行", "子 agent 调用排行", "MCP 服务器"]) {
      expect(screen.getByRole("list", { name: label })).toBeVisible();
    }
    expect(screen.getByText(/调用次数含子 agent 记录/)).toBeVisible();
  });

  it("折尾行收长尾：会话列不给读数（宁缺毋假），仍可点下钻", async () => {
    const user = userEvent.setup();
    render(<ToolCensusPanel census={twoSessionCensus()} days={30} sessionsInWindow={2} />);

    // 7 类内置 → Top-6 + 折尾行（Write 1 次入尾）。
    const tail = screen.getByRole("button", { name: /^其他 1 类/ });
    expect(within(tail).getByText("—")).toBeVisible();
    expect(tail).toHaveAttribute("title", "其余 1 类合计 1 次（主链 1 · 子 agent 0）");

    await user.click(tail);
    expect(tail).toHaveAttribute("aria-pressed", "true");
    // 折尾下钻 = 合并集合的会话榜（Write 只在会话 B）。
    expect(screen.getByText("使用「其他 1 类」最多的会话 · 共 1 个")).toBeVisible();
    expect(screen.getByText("会话B")).toBeVisible();
    expect(screen.queryByText("会话A")).not.toBeInTheDocument();
  });

  it("点桶行开下钻（Top-5 会话 + × 清除），再点同行取消；点会话行回调 onOpenSession", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(
      <ToolCensusPanel
        census={twoSessionCensus()}
        days={30}
        sessionsInWindow={2}
        onOpenSession={onOpenSession}
      />
    );

    const bashRow = screen.getByRole("button", { name: /^Bash/ });
    await user.click(bashRow);
    expect(bashRow).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("使用「Bash」最多的会话 · 共 2 个")).toBeVisible();

    const sessions = screen.getByRole("list", { name: "使用Bash最多的会话" });
    const rows = within(sessions).getAllByRole("button");
    expect(rows).toHaveLength(2);
    // Top 顺序按贡献：会话A（4 次，含子链）在前。
    expect(within(rows[0]).getByText("会话A")).toBeVisible();
    expect(within(rows[0]).getByText("4 次")).toBeVisible();

    await user.click(rows[0]);
    expect(onOpenSession).toHaveBeenCalledWith(expect.objectContaining({ path: "/a" }));

    // × 清除：下钻区离场、行回到未选中。
    await user.click(screen.getByRole("button", { name: "× 清除" }));
    expect(screen.queryByRole("list", { name: "使用Bash最多的会话" })).not.toBeInTheDocument();
    expect(bashRow).toHaveAttribute("aria-pressed", "false");

    // 再点同一行也是取消（toggle 语义）。
    await user.click(bashRow);
    expect(screen.getByRole("list", { name: "使用Bash最多的会话" })).toBeInTheDocument();
    await user.click(bashRow);
    expect(screen.queryByRole("list", { name: "使用Bash最多的会话" })).not.toBeInTheDocument();
  });

  it("MCP 行 title 带工具明细；缺 onOpenSession 时下钻会话行静态渲染", async () => {
    const user = userEvent.setup();
    render(<ToolCensusPanel census={twoSessionCensus()} days={30} sessionsInWindow={2} />);

    const demoRow = screen.getByRole("button", { name: /demo/ });
    expect(within(demoRow).getByText("2 次 · 2 个工具")).toBeVisible();
    expect(demoRow).toHaveAttribute(
      "title",
      "demo：2 次（主链 2 · 子 agent 0）· 2 个工具（docs 1 次 · query 1 次）· 1 个会话"
    );

    await user.click(demoRow);
    const sessions = screen.getByRole("list", { name: "使用demo最多的会话" });
    // 无 onOpenSession：行仍列出，只是不可点（CompactionStatsPanel 先例）。
    expect(within(sessions).queryByRole("button")).not.toBeInTheDocument();
    expect(within(sessions).getByText("会话B")).toBeVisible();
  });

  it("桶空态：栏保留 + 一行事实（不画 0 条）；全空态：四栏不渲染，体首行不渲染", () => {
    const onlyBash = toolCensus(
      [inputOf(metaOf("/a", "会话A"), bash(2))],
      30,
      NOW
    );
    const { rerender } = render(<ToolCensusPanel census={onlyBash} days={30} sessionsInWindow={1} />);
    expect(screen.getByText("本区间没有 skill 调用")).toBeVisible();
    expect(screen.getByText("本区间没有子 agent 调用")).toBeVisible();
    expect(screen.getByText("本区间没有 MCP 调用")).toBeVisible();
    expect(screen.getByText("共 2 次调用 · 主链 2 · 子 agent 占 0.0%")).toBeVisible();

    rerender(
      <ToolCensusPanel census={toolCensus([], 30, NOW)} days={30} sessionsInWindow={5} />
    );
    expect(screen.getByText("近 30 天检查了 5 个会话，没有工具调用记录")).toBeVisible();
    expect(screen.queryByText(/共 \d+ 次调用/)).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "内置工具调用排行" })).not.toBeInTheDocument();
  });
});

describe("mergeTopSessions", () => {
  const slice = (label: string, path: string, calls: number): CensusBucket["topSessions"][number] => ({
    session: { ...metaOf(path, label), path },
    label,
    calls
  });

  it("同会话跨桶求和后取 Top-5；会话数是去重数", () => {
    const buckets: CensusBucket[] = [
      {
        key: { kind: "builtin", toolName: "Write" },
        label: "Write",
        callsMain: 2,
        callsWithSidechain: 2,
        sessions: 2,
        topSessions: [slice("会话A", "/a", 2), slice("会话B", "/b", 1)],
        tools: []
      },
      {
        key: { kind: "builtin", toolName: "Grep" },
        label: "Grep",
        callsMain: 1,
        callsWithSidechain: 3,
        sessions: 2,
        topSessions: [slice("会话A", "/a", 3), slice("会话C", "/c", 1)],
        tools: []
      }
    ];
    const merged = mergeTopSessions(buckets);
    expect(merged.sessions).toBe(3);
    expect(merged.top.map((item) => [item.label, item.calls])).toEqual([
      ["会话A", 5],
      ["会话B", 1],
      ["会话C", 1]
    ]);
    // 同数按 label 稳定排序。
    expect(merged.top[1].label.localeCompare(merged.top[2].label)).toBeLessThan(0);
  });

  it("超过 5 个会话时只留前 5；空输入给空结果", () => {
    const buckets: CensusBucket[] = [
      {
        key: { kind: "skill", skillName: "x" },
        label: "x",
        callsMain: 0,
        callsWithSidechain: 6,
        sessions: 6,
        topSessions: [1, 2, 3, 4, 5, 6].map((n) => slice(`会话${n}`, `/p${n}`, 1)),
        tools: []
      }
    ];
    expect(mergeTopSessions(buckets).top).toHaveLength(5);
    expect(mergeTopSessions([])).toEqual({ sessions: 0, top: [] });
  });
});

/** D2 健康视图：直接挂在既有面板上，事实带耗时与错误标记。 */
describe("ToolCensusPanel 健康视图（D2）", () => {
  function callOf(
    toolName: string,
    durationMs: number,
    isError = false
  ): ToolCallFact {
    return {
      key: { kind: "builtin", toolName },
      timestamp: NOW,
      sidechain: false,
      durationMs,
      isError
    };
  }

  const FACTS: ToolCallFact[] = [
    callOf("Bash", 100),
    callOf("Bash", 300, true),
    callOf("Bash", 200),
    callOf("Read", 50)
  ];

  it("健康页按失败率排序，>20% 标 ▲，样本不足写明次数", async () => {
    const user = userEvent.setup();
    const session = metaOf("/health", "健康");
    render(
      <ToolCensusPanel
        census={toolCensus([inputOf(session, FACTS)], 30, NOW)}
        days={30}
        sessionsInWindow={1}
        toolFacts={FACTS}
      />
    );

    await user.click(screen.getByRole("tab", { name: "健康" }));

    const bashRow = screen.getByRole("row", { name: /^Bash/ });
    expect(within(bashRow).getByRole("cell", { name: "3" })).toBeInTheDocument();
    expect(within(bashRow).getByRole("cell", { name: /33\.3% ▲/ })).toBeInTheDocument();
    expect(bashRow).toHaveTextContent("200 ms");

    const readRow = screen.getByRole("row", { name: /^Read/ });
    expect(readRow).toHaveTextContent("样本不足（1 次）");
    expect(readRow).toHaveTextContent("50 ms");
    expect(screen.getByText("未配对的调用不参与耗时统计；失败率只在有结果可判的调用上计算。")).toBeInTheDocument();
  });

  it("没有工具调用时，健康页也不画空表", async () => {
    const user = userEvent.setup();
    render(
      <ToolCensusPanel
        census={toolCensus([], 30, NOW)}
        days={30}
        sessionsInWindow={3}
        toolFacts={[]}
      />
    );

    await user.click(screen.getByRole("tab", { name: "健康" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/没有工具调用记录/)).toBeInTheDocument();
  });
});

/** G6 按月视图：直接挂面板第三标签，行数据经 toolCalendar 聚合（与真实
 *  页面同一入口，不手造 ToolCalendarRow——组件测试与模型层共用同一口径）。 */
describe("ToolCensusPanel 按月视图（G6）", () => {
  /** 30 天 × 每天 1ms 精度：月槽按本地时区落位。NOW=2026-10-03（本地 10 月），
   *  事实落 7/9/10 三个月（用整月边界的实际落点，不假设 30 天=1 月）。 */
  const DAY = 86_400_000;
  const JULY = Date.parse("2026-07-15T12:00:00.000Z");
  const SEPT = Date.parse("2026-09-15T12:00:00.000Z");
  const factsAcrossMonths: ToolCallFact[] = [
    // 7 月：Bash 3 + Read 1。
    { key: { kind: "builtin", toolName: "Bash" }, timestamp: JULY, sidechain: false },
    { key: { kind: "builtin", toolName: "Bash" }, timestamp: JULY + 1, sidechain: false },
    { key: { kind: "builtin", toolName: "Bash" }, timestamp: JULY + 2, sidechain: false },
    { key: { kind: "builtin", toolName: "Read" }, timestamp: JULY, sidechain: false },
    // 9 月：Bash 2。
    { key: { kind: "builtin", toolName: "Bash" }, timestamp: SEPT, sidechain: false },
    { key: { kind: "builtin", toolName: "Bash" }, timestamp: SEPT + 1, sidechain: false },
    // 10 月（当月）：Bash 1。
    { key: { kind: "builtin", toolName: "Bash" }, timestamp: NOW - DAY, sidechain: false }
  ];

  it("正常：切「按月」出表，行按总量降序、合计列与趋势列齐全，caption 在场", async () => {
    const user = userEvent.setup();
    const session = metaOf("/m", "月历");
    const inputs = [inputOf(session, factsAcrossMonths)];
    render(
      <ToolCensusPanel
        census={toolCensus(inputs, 30, NOW)}
        days={30}
        sessionsInWindow={1}
        calendarRows={toolCalendar(inputs, NOW)}
      />
    );

    await user.click(screen.getByRole("tab", { name: "按月" }));

    // srOnly caption（读屏 landmark）。
    expect(screen.getByText("工具月历：每个工具各月的调用次数")).toBeInTheDocument();
    const table = screen.getByRole("table");
    // 行序：Bash 总 6 > Read 总 1。
    const rows = within(table).getAllByRole("row");
    expect(rows.length).toBe(3); // thead + 2 工具行
    expect(within(rows[1]).getByRole("rowheader", { name: "Bash" })).toBeInTheDocument();
    expect(within(rows[2]).getByRole("rowheader", { name: "Read" })).toBeInTheDocument();
    // 合计列。
    expect(within(rows[1]).getByText("6")).toBeInTheDocument();
    expect(within(rows[2]).getByText("1")).toBeInTheDocument();
    // 趋势列：4 个月 < 9 →「—」。
    expect(within(rows[1]).getByText("—")).toBeInTheDocument();
    // 条的悬停读数（title 模板 `3 月 N 次`）。
    expect(within(rows[1]).getByTitle("7 月 3 次")).toBeInTheDocument();
    expect(within(rows[1]).getByTitle("9 月 2 次")).toBeInTheDocument();
    expect(within(rows[1]).getByTitle("10 月 1 次")).toBeInTheDocument();
  });

  it("归一与空槽：条高按工具自身最大月归一，0 次月留 1px 底槽不画条", async () => {
    const user = userEvent.setup();
    const session = metaOf("/m", "月历");
    const inputs = [inputOf(session, factsAcrossMonths)];
    render(
      <ToolCensusPanel
        census={toolCensus(inputs, 30, NOW)}
        days={30}
        sessionsInWindow={1}
        calendarRows={toolCalendar(inputs, NOW)}
      />
    );
    await user.click(screen.getByRole("tab", { name: "按月" }));

    const bashRow = screen.getByRole("row", { name: /^Bash/ });
    // Bash：7 月 3（自身 max）→ 24px 满高；9 月 2 → 2/3×24=16；10 月 1 → 8；
    // 8 月 0 → 空槽（title 在但不是条，无 height 内联样式）。
    const bars = within(bashRow).getAllByTitle(/月 \d+ 次/);
    const height = (n: number) => bars.find((el) => el.getAttribute("title") === `${n} 月 ${["3", "0", "2", "1"][n - 7]} 次`);
    expect(height(7)).toHaveStyle({ height: "24px" });
    expect(height(9)).toHaveStyle({ height: "16px" });
    expect(height(10)).toHaveStyle({ height: "8px" });
    // 空槽：title 在但没有任何内联高度（0 高条不画）。
    expect(height(8)).not.toHaveAttribute("style");
    // 条区 role=img 的 aria 读数。
    expect(
      screen.getByRole("img", { name: /Bash：逐月调用 6 次，趋势—/ })
    ).toBeInTheDocument();
  });

  it("趋势判据：前 6 月均值 vs 后 3 月均值，>30% 升/降、不足 9 个月给「—」", async () => {
    const user = userEvent.setup();
    const session = metaOf("/t", "趋势");
    // 12 个月窗口（2025-11 → 2026-10）：Bash 前 6 月各 1、后 3 月各 3。
    const facts: ToolCallFact[] = [];
    for (let back = 11; back >= 0; back -= 1) {
      // 每月 15 号 12:00 放事实（避开月边界）：back=0 → 2026-10，back=11 →
      // 2025-11（Date 构造器自己处理负月份溢出）。近 3 月放 3 条、此前 1 条。
      const ts = new Date(2026, 9 - back, 15, 12).getTime();
      const count = back <= 2 ? 3 : 1;
      for (let n = 0; n < count; n += 1) {
        facts.push({ key: { kind: "builtin", toolName: "Bash" }, timestamp: ts + n, sidechain: false });
      }
    }
    const inputs = [inputOf(session, facts)];
    render(
      <ToolCensusPanel
        census={toolCensus(inputs, 30, NOW)}
        days={30}
        sessionsInWindow={1}
        calendarRows={toolCalendar(inputs, NOW)}
      />
    );
    await user.click(screen.getByRole("tab", { name: "按月" }));

    // 近 3 月均值 3 vs 前段 ~1：升。趋势列文本在场（「近 3 月 ↑」）。
    const bashRow = screen.getByRole("row", { name: /^Bash/ });
    expect(within(bashRow).getByText("近 3 月 ↑")).toBeInTheDocument();
    // 脚注（判据公开给用户）。
    expect(screen.getByText(/自身最忙的月份归一/)).toBeInTheDocument();
  });

  it("空态：没有 calendarRows 时「按月」不画表；aria 语义齐全", async () => {
    const user = userEvent.setup();
    render(
      <ToolCensusPanel
        census={toolCensus([], 30, NOW)}
        days={30}
        sessionsInWindow={4}
        calendarRows={[]}
      />
    );
    await user.click(screen.getByRole("tab", { name: "按月" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/没有工具调用记录/)).toBeInTheDocument();

    // SegmentedControl 第三项的 tab 语义（读屏可切换）。
    expect(screen.getByRole("tab", { name: "按月" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "调用次数" })).toHaveAttribute("aria-selected", "false");
  });
});
