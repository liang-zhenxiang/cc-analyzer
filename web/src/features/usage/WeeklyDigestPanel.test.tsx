import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SessionRecord } from "../sessions/types";
import type { UsageSessionInput } from "./usageAggregations";
import { WeeklyDigestPanel } from "./WeeklyDigestPanel";

/** 2026-10-19 是周一：本周 = 10/19 起，上周 = 10/12 起。 */
const NOW = new Date(2026, 9, 21, 12, 0, 0).getTime();
const at = (month: number, day: number, hour = 9): number =>
  new Date(2026, month - 1, day, hour, 0, 0).getTime();

function recordOf(timestamp: number, model = "claude-sonnet-4-5", inputTokens = 1_000_000): SessionRecord {
  return {
    id: `r-${timestamp}`,
    fullId: `f-${timestamp}`,
    kind: "assistant",
    timestamp,
    durationMs: 0,
    text: "",
    isError: false,
    model,
    usage: { inputTokens },
    raw: {}
  } as unknown as SessionRecord;
}

function inputOf(...records: SessionRecord[]): UsageSessionInput {
  return { records, projectLabel: "-repo-demo" };
}

function rowOf(label: string): HTMLElement {
  const row = screen.getByRole("row", { name: new RegExp(`^${label}`) });
  return row;
}

function renderPanel(inputs: readonly UsageSessionInput[], now = NOW) {
  return render(<WeeklyDigestPanel inputs={inputs} now={now} />);
}

describe("WeeklyDigestPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("reads four metrics as this week / last week / change", () => {
    renderPanel([
      inputOf(
        recordOf(at(10, 20), "claude-sonnet-4-5", 3_000_000),
        recordOf(at(10, 13), "claude-sonnet-4-5", 2_000_000)
      )
    ]);

    const tokens = rowOf("Tokens");
    // 3M 对 2M，$9 对 $6：token 与金额都是 +50%。
    expect(within(tokens).getByText("3.0M")).toBeTruthy();
    expect(within(tokens).getByText("2.0M")).toBeTruthy();
    expect(within(tokens).getByText("▲ +50%")).toBeTruthy();

    const usd = rowOf("估算成本");
    expect(within(usd).getByText("$9.00")).toBeTruthy();
    expect(within(usd).getByText("$6.00")).toBeTruthy();
    expect(within(usd).getByText("▲ +50%")).toBeTruthy();
  });

  it("colours a rise as bad news and a fall as good news", () => {
    renderPanel([
      inputOf(
        recordOf(at(10, 20), "claude-sonnet-4-5", 1_000_000),
        recordOf(at(10, 13), "claude-sonnet-4-5", 2_000_000)
      )
    ]);

    // 消耗降了 50% —— 对用户是好消息，用 success 色（不是 danger）。
    const delta = within(rowOf("Tokens")).getByText("▼ -50%");
    expect(delta.getAttribute("data-tone")).toBe("down");
    expect(delta.getAttribute("aria-label")).toContain("减少");
  });

  it("writes an em dash instead of a percentage when last week has no baseline", () => {
    renderPanel([inputOf(recordOf(at(10, 20)))]);
    const row = rowOf("Tokens");
    expect(within(row).getByText("—")).toBeTruthy();
    expect(within(row).getByText("0")).toBeTruthy();
  });

  it("says there is nothing to compare when both weeks are empty", () => {
    renderPanel([]);
    expect(screen.getByText("还没有可对比的周")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("copies the four rows as plain text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderPanel([
      inputOf(
        recordOf(at(10, 20), "claude-sonnet-4-5", 1_000_000),
        recordOf(at(10, 13), "claude-sonnet-4-5", 2_000_000)
      )
    ]);

    await userEvent.click(screen.getByRole("button", { name: "复制战报" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text.split("\n")).toHaveLength(5);
    expect(text.split("\n")[0]).toBe("周战报（10/19 起，本地自然周）");
    expect(text).toContain("Tokens：本周 1.0M · 上周 2.0M · ▼ -50%");
    expect(text).toContain("估算成本：本周 $3.00 · 上周 $6.00 · ▼ -50%");
    expect(await screen.findByText("已复制到剪贴板")).toBeTruthy();
  });

  it("falls back to a visible alert when the clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true
    });

    renderPanel([inputOf(recordOf(at(10, 20)))]);
    await userEvent.click(screen.getByRole("button", { name: "复制战报" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "复制失败：剪贴板不可用，请手动选中读数复制"
    );
  });

  it("states the week definition instead of leaving it to be guessed", () => {
    renderPanel([inputOf(recordOf(at(10, 20)))]);
    expect(screen.getByText("按本地自然周（周一起始）")).toBeTruthy();
  });
});

describe("WeeklyDigestPanel 峰值时刻（D9）", () => {
  it("把峰值分钟落在周战报末尾的一行里，并带上次高", () => {
    const inputs = [
      inputOf(recordOf(at(10, 21, 9)), recordOf(at(10, 21, 9))),
      inputOf(recordOf(at(10, 21, 10)))
    ];
    renderPanel(inputs);

    const row = screen.getByText("峰值时刻").closest('[data-probe="peak-minute"]') as HTMLElement;
    expect(row).not.toBeNull();
    // 同一分钟两笔 100 万：峰值 2,000,000 token；次高是 10 点那笔。
    expect(row).toHaveTextContent("2.0M token");
    expect(row).toHaveTextContent("次高 1.0M token（10-21 10:00）");
  });

  it("只有一分钟有消耗时，次高那半句换成说明", () => {
    renderPanel([inputOf(recordOf(at(10, 21, 9)))]);

    const row = screen.getByText("峰值时刻").closest('[data-probe="peak-minute"]') as HTMLElement;
    expect(row).toHaveTextContent("窗口内只有这 1 分钟有消耗");
  });
});

/**
 * Issue #339：`.table tbody th` 的 `text-align: right` 特异性 (0,1,2) 压过了
 * `.metric` 的 left，注释里写的「首列左对齐」从未生效——标签被推到面板中线。
 * 只改对齐不够：首列若仍是 38%，空白只是从左边挪到中间。
 * Issue #342 起改成「按内容收窄的紧凑表」：标签列 120px、数字列各 140px，
 * 不再追着 KPI 的列数做百分比对齐（KPI 从 4 列变 5 列时那套对齐会失效）。
 */
describe("周战报表格对齐（Issue #339 / #342）", () => {
  function digestCss(): string {
    return readFileSync(
      resolve(process.cwd(), "src/features/usage/WeeklyDigestPanel.module.css"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
  }

  it("行名单元格是 th.metric，数字单元格是 td.value", () => {
    renderPanel([inputOf(recordOf(at(10, 21, 9)))]);

    const labelCell = rowOf("Tokens").querySelector("th");
    expect(labelCell?.className).toContain("metric");
    expect(labelCell?.getAttribute("scope")).toBe("row");
    expect(rowOf("Tokens").querySelector("td")?.className).toContain("value");
  });

  it("tbody th 不再右对齐；只有 td 与 .metric 各自声明对齐", () => {
    const css = digestCss();
    const tbodyRule = /\.table tbody th,\s*\.table tbody td\s*\{([^}]*)\}/.exec(css);
    expect(tbodyRule).not.toBeNull();
    expect(tbodyRule![1]).not.toMatch(/text-align:\s*right/);

    const tdRule = /\.table tbody td\s*\{[^}]*text-align:\s*right/;
    expect(css).toMatch(tdRule);

    const metricRule = /\.metric\s*\{([^}]*)\}/.exec(css);
    expect(metricRule).not.toBeNull();
    expect(metricRule![1]).toMatch(/text-align:\s*left/);
  });

  it("内容宽度紧凑表：行名贴左、三个数字列等宽（Issue #342）", () => {
    const css = digestCss();
    const headRule = /\.metricHead\s*\{([^}]*)\}/.exec(css);
    expect(headRule).not.toBeNull();
    // 标签列固定 120px：标签到数值不再隔着面板的一大片空白。
    expect(headRule![1]).toMatch(/width:\s*120px/);
    expect(headRule![1]).not.toContain("25%");
    // 重复的 text-align 已收口：首格左对齐只保留高特异性那条。
    expect(headRule![1]).not.toContain("text-align");

    const theadHeadRule = /\.table thead th\.metricHead\s*\{([^}]*)\}/.exec(css);
    expect(theadHeadRule).not.toBeNull();
    expect(theadHeadRule![1]).toMatch(/text-align:\s*left/);

    // table-layout: fixed 只读第一行：数字列的 140px 必须钉在表头上。
    const numberHeadRule = /\.table thead th:not\(\.metricHead\)\s*\{([^}]*)\}/.exec(css);
    expect(numberHeadRule).not.toBeNull();
    expect(numberHeadRule![1]).toMatch(/width:\s*140px/);

    const tableRule = /\.table\s*\{([^}]*)\}/.exec(css);
    expect(tableRule).not.toBeNull();
    // 按内容收窄，不再撑满、也不再追着 KPI 的列数做百分比对齐。
    expect(tableRule![1]).toContain("width: auto");
    expect(tableRule![1]).not.toContain("width: 100%");
    expect(tableRule![1]).toContain("table-layout: fixed");
    // 不把整表右推：max-width / margin-left:auto 会把首列重新推离左缘。
    expect(tableRule![1]).not.toContain("max-width");
    expect(tableRule![1]).not.toContain("margin-left");
  });
});
