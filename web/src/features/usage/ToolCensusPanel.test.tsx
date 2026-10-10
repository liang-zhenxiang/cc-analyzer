import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { toolCensus, type ToolCallFact, type CensusBucket } from "./toolCensus";
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
