import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import { parseJsonlText } from "../sessions/parseJsonl";
import type { UsageSessionInput } from "./usageAggregations";
import {
  extractErrorEvents,
  mergeErrorStats,
  type ErrorStats
} from "./errorStats";
import { ErrorOverviewSection } from "./ErrorOverviewSection";

/**
 * 「错误」档的组件用例：渲染三切面、折尾、切面过滤与下钻回调、空态与
 * 口径脚注——期望值全部由夹具计算（夹具形状见 errorStats.test.ts 的注释：
 * API 3 / 工具 4 / Bash 3 错 4 调用 / 事件 7 条，两个自然日）。
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const errorFixture = readFileSync(
  path.join(here, "../../../tests/fixtures/error-session.jsonl"),
  "utf8"
);
const FIXTURE_PATH = "/home/tester/.claude/projects/-repo-error-demo/error-session.jsonl";
const FIXTURE_NOW = Date.parse("2026-10-03T12:30:00.000Z");

const meta: SessionMeta = {
  path: FIXTURE_PATH,
  projectLabel: "-repo-error-demo",
  mtimeMs: 1,
  sizeBytes: 1,
  hasRecords: true
};

function fixtureStats(): ErrorStats {
  const parsed = parseJsonlText(errorFixture, FIXTURE_PATH);
  const input: UsageSessionInput = {
    records: parsed.records,
    projectLabel: meta.projectLabel,
    errorExtract: extractErrorEvents(parsed, meta)
  };
  return mergeErrorStats([input], 7, FIXTURE_NOW);
}

function renderSection(stats: ErrorStats, onRevealRecord?: (path: string, recordId: string | null) => void) {
  return render(
    <ErrorOverviewSection
      stats={stats}
      days={7}
      sessionsInWindow={1}
      projectPaths={new Map([["-repo-error-demo", "/repo/error-demo"]])}
      onRevealRecord={onRevealRecord}
    />
  );
}

/**
 * KPI 数值断言的作用域：趋势图例里也有「工具错误 / API 错误」，先圈进 KPI 行
 * 的瓦片再找标签与数字。
 */
function kpiTile(label: string): HTMLElement {
  const row = document.querySelector("div[class*='kpiRow']") as HTMLElement;
  return within(row).getByText(label, { exact: true }).parentElement!;
}

/** 过滤态描述行（data-error-filter 探针锚点）；文案断言走 textContent。 */
function filterDescription(): string {
  return (document.querySelector("[data-error-filter]")?.textContent ?? "").trim();
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorOverviewSection", () => {
  it("KPI 行、三个切面与口径脚注在场，数字来自夹具", () => {
    renderSection(fixtureStats());

    expect(screen.getByRole("region", { name: "跨会话错误分析" })).toBeInTheDocument();
    expect(within(kpiTile("API 错误")).getByText("3")).toBeInTheDocument();
    expect(within(kpiTile("工具错误")).getByText("4")).toBeInTheDocument();
    expect(within(kpiTile("最常见失败工具")).getByText("Bash")).toBeInTheDocument();
    expect(within(kpiTile("最常见失败工具")).getByText("3 次")).toBeInTheDocument();
    expect(within(kpiTile("异常日")).getByText("0 天")).toBeInTheDocument();

    // 三个切面 + 下钻列表都渲染；趋势柱 7 根（窗口 7 天零填充）。
    for (const title of ["每日错误率", "按工具失败", "按项目失败密度", "错误事件"]) {
      expect(screen.getByRole("region", { name: title })).toBeInTheDocument();
    }
    const trend = document.querySelector("[data-error-trend]");
    expect(trend?.querySelectorAll("rect[data-bar]")).toHaveLength(7);

    // 口径常显在 KPI 脚注：三个分母 + 含子 agent + 不含「等用户输入」。
    const footnote = screen.getByText(/失败 = 工具结果被标记为错误/);
    expect(footnote.textContent).toContain("每千条模型消息");
    expect(footnote.textContent).toContain("该工具总调用次数");
    expect(footnote.textContent).toContain("该项目记录总数");
    expect(footnote.textContent).toContain("含子 agent 记录");
  });

  it("按工具切面行过滤事件列表；再点一次取消，清除按钮可用", async () => {
    const user = userEvent.setup();
    renderSection(fixtureStats());

    expect(screen.getByText(/全部 7 条 · 时间倒序/)).toBeInTheDocument();

    const bashRow = screen.getByRole("button", { name: /^Bash/ });
    await user.click(bashRow);
    expect(bashRow).toHaveAttribute("aria-pressed", "true");
    expect(filterDescription()).toBe("Bash · 3 条 · 时间倒序");

    const clear = screen.getByRole("button", { name: "× 清除过滤" });
    await user.click(clear);
    expect(screen.getByText(/全部 7 条 · 时间倒序/)).toBeInTheDocument();

    // 单选语义：再点同一行 = 取消，不叠加。
    await user.click(bashRow);
    expect(filterDescription()).toBe("Bash · 3 条 · 时间倒序");
    await user.click(bashRow);
    expect(screen.getByText(/全部 7 条 · 时间倒序/)).toBeInTheDocument();
  });

  it("超过 5 类工具折进「其他 N 类」：不给率读数，过滤覆盖折尾集合", async () => {
    const user = userEvent.setup();
    const base = fixtureStats();
    // 7 类工具（Bash 7 次 + 六类各 1 次）→ Top-5 + 其他 2 类；折尾两类的
    // 事件也补进 events，过滤断言才不是对着空集自说自话。byTool 必须按契约
    // 给定排序（次数降序、同名按名字）——组件信任 stats 的顺序，不再排。
    const tailEvent = (toolName: string) => ({
      ...base.events[0],
      kind: "tool" as const,
      toolName,
      recordId: `tail-${toolName}`
    });
    const stats: ErrorStats = {
      ...base,
      byTool: [
        { toolName: "Bash", errors: 7, calls: 10, rate: 0.7 },
        ...["Edit", "Glob", "Grep", "Read", "WebFetch", "Write"].map((toolName) => ({
          toolName,
          errors: 1,
          calls: 2,
          rate: 0.5
        }))
      ],
      events: [...base.events, tailEvent("WebFetch"), tailEvent("Write")],
      total: { api: base.total.api, tool: base.total.tool + 2 }
    };
    renderSection(stats);

    const tail = screen.getByRole("button", { name: /其他 2 类/ });
    expect(tail).toBeInTheDocument();
    // 折尾行的 title 说明混合桶不给失败率（信息在文字读数，不在率列）。
    expect(tail).toHaveAttribute("title", expect.stringContaining("混合桶不给失败率"));

    await user.click(tail);
    expect(filterDescription()).toBe("其他 2 类 · 2 条 · 时间倒序");
  });

  it("事件行点击把路径与记录 id 交回；sidechain 行落会话并带徽标", async () => {
    const user = userEvent.setup();
    const onRevealRecord = vi.fn();
    renderSection(fixtureStats(), onRevealRecord);

    // 主链事件：preview 可寻（Edit 失败的固定文案头）。
    await user.click(screen.getByRole("button", { name: /String to replace not found/ }));
    expect(onRevealRecord).toHaveBeenCalledWith(FIXTURE_PATH, "err-edit-1");

    // sidechain 事件：recordId=null 落到会话本身，行内带「子 agent」徽标
    // （正则锚到徽标：/Exit code 1/ 会误伤「Exit code 127」的行）。
    const sidechainRow = screen.getByRole("button", { name: /Exit code 1子 agent/ });
    expect(sidechainRow.textContent).toContain("子 agent");
    // 徽标自己的 title 说明「暂不能定位到行」；行按钮的 title 是 preview 全文。
    expect(
      within(sidechainRow).getByTitle("子 agent 记录暂不能定位到日志行——点击落到所在会话")
    ).toBeInTheDocument();
    await user.click(sidechainRow);
    expect(onRevealRecord).toHaveBeenCalledWith(FIXTURE_PATH, null);
  });

  it("空区间：KPI 全 0、事实行在场，切面面板不画", () => {
    const emptyStats = mergeErrorStats([], 7, FIXTURE_NOW);
    renderSection({ ...emptyStats, toolCalls: 41 }, undefined);
    // toolCalls 手工抬高以证事实行读的是聚合层的分母数字，不是写死文案。

    expect(within(kpiTile("API 错误")).getByText("0")).toBeInTheDocument();
    expect(within(kpiTile("工具错误")).getByText("0")).toBeInTheDocument();
    expect(screen.getByText(/没有发现失败记录——0 是检查后的结果/)).toBeInTheDocument();
    expect(screen.getByText(/1 个会话的 0 条模型消息与 41 次工具调用/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "每日错误率" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "错误事件" })).not.toBeInTheDocument();
  });

  it("趋势图键盘：→ 聚焦首日，Enter 过滤该日；0 错误日给出过滤的诚实结果", async () => {
    const user = userEvent.setup();
    renderSection(fixtureStats());

    const chart = screen.getByRole("img", { name: /近 7 天错误率/ });
    chart.focus();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Enter}");
    // 首日是窗口里最早的零填充天：过滤结果为 0 条是诚实结果，不是空态组件。
    expect(await screen.findByText(/没有错误事件/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "× 清除过滤" })).toBeInTheDocument();
  });
});
