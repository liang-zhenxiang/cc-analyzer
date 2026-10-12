import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { addLocalDays } from "./usageAggregations";
import { UsageCalendarPanel } from "./UsageCalendarPanel";

/**
 * 组件直挂（页面级集成由 UsageOverviewPage.test 与 e2e 负责）：网格几何、
 * aria-label 三分支逐字、点击展开 / 收起、roving tabindex 键盘映射、图例与
 * 视觉纪律。`now` 注入固定时刻——「今天」因此是确定的 2026-10-12（周一）。
 */

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();
const TODAY = new Date(2026, 9, 12).getTime();

let seq = 0;

function record(at: number, patch: Partial<SessionRecord> = {}): SessionRecord {
  seq += 1;
  return {
    id: `r${seq}`,
    fullId: `r${seq}`,
    kind: "assistant",
    timestamp: at,
    durationMs: 0,
    text: "",
    isError: false,
    raw: {},
    usage: { inputTokens: 0 },
    ...patch
  };
}

function metaOf(path: string, title: string): SessionMeta {
  return {
    path,
    projectLabel: "-repo-cal",
    cwd: "/repo/cal",
    hasRecords: true,
    mtimeMs: 0,
    sizeBytes: 0,
    customTitle: title
  };
}

/** 一个会话一条助手记录，input 落 token（sonnet：$3/MTok）。 */
function sessionAt(path: string, title: string, dayStart: number, tokens: number) {
  return {
    records: [
      record(dayStart + 10 * 3_600_000, {
        model: "claude-sonnet-4-5",
        usage: { inputTokens: tokens }
      })
    ],
    projectLabel: "-repo-cal",
    projectPath: "/repo/cal",
    session: metaOf(path, title)
  };
}

/** 昨天 8 个会话按 token 阶梯（8,000 → 1,000）——Top 5 + 「其余 3 个会话」。 */
function ladderInputs() {
  return Array.from({ length: 8 }, (_, index) =>
    sessionAt(`/sessions/s${index}.jsonl`, `会话 ${index}`, addLocalDays(TODAY, -1), (8 - index) * 1_000)
  );
}

/** 三种 aria-label 分支 + 部分未知追加段的一次性布景。 */
function mixedInputs() {
  return [
    ...ladderInputs(),
    // 前天：只有 unknown 模型 → 「定价未知」分支。
    {
      records: [
        record(addLocalDays(TODAY, -2) + 11 * 3_600_000, {
          model: "gpt-unknown-9",
          usage: { inputTokens: 123 }
        })
      ],
      projectLabel: "-repo-cal",
      projectPath: "/repo/cal"
    },
    // 大前天：sonnet + unknown 混合 → 有消耗且末尾追加「部分会话未知价」。
    {
      records: [
        record(addLocalDays(TODAY, -3) + 9 * 3_600_000, {
          model: "claude-sonnet-4-5",
          usage: { inputTokens: 1_000_000 }
        }),
        record(addLocalDays(TODAY, -3) + 10 * 3_600_000, {
          model: "gpt-unknown-9",
          usage: { inputTokens: 500 }
        })
      ],
      projectLabel: "-repo-cal",
      projectPath: "/repo/cal"
    }
  ];
}

function calendarTable() {
  return screen.getByRole("table", { name: "消耗日历（近 12 个月）" });
}

/** 按 aria-label 找格子按钮（日期是每个格子唯一的名）。 */
function dayButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

const YESTERDAY_LABEL = "2026年10月11日 · 估算成本 $0.11 · 36,000 tok · 8 个会话 · cal";

describe("UsageCalendarPanel", () => {
  it("渲染 365 个天格、7 个星期行、12~13 个月份标签与 5 格图例", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const table = calendarTable();
    expect(table.querySelectorAll('[data-probe="calendar-day"]')).toHaveLength(365);
    // 1 个月份行 + 7 个星期行；星期行 rowheader 是 Monday-first 的「一 … 日」。
    expect(table.querySelectorAll("tr")).toHaveLength(8);
    const rowHeaders = Array.from(table.querySelectorAll('th[scope="row"]'))
      .slice(1)
      .map((header) => header.textContent);
    expect(rowHeaders).toEqual(["一", "二", "三", "四", "五", "六", "日"]);

    const monthMarks = table.querySelectorAll('th[scope="col"]');
    expect(monthMarks.length).toBeGreaterThanOrEqual(12);
    expect(monthMarks.length).toBeLessThanOrEqual(13);
    // 跨年窗口（2025-10 → 2026-10）：两个 10 月都带年号。
    const labels = Array.from(monthMarks).map((mark) => mark.textContent);
    expect(labels).toContain("2025/10");
    expect(labels).toContain("2026/10");
    expect(labels.filter((label) => label?.includes("/"))).toHaveLength(2);

    const legend = document.querySelector("[data-cal-legend]");
    expect(legend).not.toBeNull();
    expect(legend!.querySelectorAll("[data-legend-level]")).toHaveLength(5);
    expect(legend!.querySelector('[data-legend-level="0"]')).toHaveAttribute("title", "无消耗");
  });

  it("aria-label 三分支逐字一致（有消耗 / 定价未知 / 无消耗）+ 部分未知追加段", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    // 有消耗（昨天，8 会话合计 36,000 tok × $3/MTok = $0.108 → $0.11）。
    expect(dayButton(YESTERDAY_LABEL)).toHaveAttribute("title", YESTERDAY_LABEL);
    // 有记录无成本（全 unknown）：token 与会话照报，不装作没有活动。
    expect(dayButton("2026年10月10日 · 123 tok · 1 个会话 · 定价未知")).toBeInTheDocument();
    // 无记录（今天）。
    expect(dayButton("2026年10月12日 · 无消耗")).toBeInTheDocument();
    // cost > 0 且有 unknown token：末尾追加「部分会话未知价」。
    expect(
      dayButton("2026年10月9日 · 估算成本 $3.00 · 1.0M tok · 1 个会话 · cal · 部分会话未知价")
    ).toBeInTheDocument();
  });

  it("点击有会话的格子展开 Top 清单：双数读数、折尾、再点收起、空格无展开", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} onOpenSession={onOpenSession} />);

    const yesterday = dayButton(YESTERDAY_LABEL);
    expect(yesterday).toHaveAttribute("aria-expanded", "false");
    await user.click(yesterday);

    expect(yesterday).toHaveAttribute("aria-expanded", "true");
    const detail = document.querySelector("[data-calendar-sessions]") as HTMLElement;
    expect(detail).not.toBeNull();
    expect(
      screen.getByText("10月11日消耗 Top 会话 · 共 8 个")
    ).toBeVisible();
    // 行数 = min(5, 8)；行读数是「$X · N tok」双数。列表按自身的 aria 名圈定，
    // 「× 清除」是头部按钮，不数进行。
    const rows = within(screen.getByRole("list", { name: "10月11日消耗最多的会话" })).getAllByRole(
      "button"
    );
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent("$0.02 · 8,000 tok");
    expect(within(detail).getByText("其余 3 个会话")).toBeVisible();
    // 脚注写明分母口径。
    expect(within(detail).getByText("占比分母 = 当日 token 总量；成本为估算值。")).toBeVisible();

    // 再点同格收起。
    await user.click(yesterday);
    expect(yesterday).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[data-calendar-sessions]")).toBeNull();

    // 空格子（sessions === 0）不挂 aria-expanded，点击无展开、无报错。
    const today = dayButton("2026年10月12日 · 无消耗");
    expect(today).not.toHaveAttribute("aria-expanded");
    await user.click(today);
    expect(document.querySelector("[data-calendar-sessions]")).toBeNull();
  });

  it("会话数 ≤ 5 时不出现「其余」行；无元数据行照列但不可点", async () => {
    const user = userEvent.setup();
    const day = addLocalDays(TODAY, -1);
    const inputs = [
      ...Array.from({ length: 3 }, (_, index) =>
        sessionAt(`/sessions/t${index}.jsonl`, `会话 ${index}`, day, (3 - index) * 1_000)
      ),
      // 无元数据：行照列、不可点（path 空串）。
      {
        records: [
          record(day + 16 * 3_600_000, { model: "claude-sonnet-4-5", usage: { inputTokens: 100 } })
        ],
        projectLabel: "-repo-cal"
      }
    ];
    render(<UsageCalendarPanel inputs={inputs} now={NOW} />);

    await user.click(dayButton("2026年10月11日 · 估算成本 $0.02 · 6,100 tok · 4 个会话 · cal"));
    const rows = within(screen.getByRole("list", { name: "10月11日消耗最多的会话" })).getAllByRole(
      "button"
    );
    expect(rows).toHaveLength(4);
    expect(screen.queryByText(/其余 \d+ 个会话/)).toBeNull();
    expect(rows[3]).toBeDisabled();
  });

  it("键盘映射：方向键按天 / 按周移动、边界不动、Home/End 行首尾、Enter 展开、Escape 收起", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    // 聚焦 2026-10-05（周一，窗口中段）再导航——今天本身在窗口右下角，
    // 向右 / 向下都会越界，不适合做移动断言的起点。
    const monday = dayButton("2026年10月5日 · 无消耗");
    await user.click(monday);
    expect(document.activeElement).toBe(monday);

    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("aria-label", "2026年10月6日 · 无消耗");

    // 行首尾：10-06（周二）所在行是 [10-05 … 10-11]，行尾是昨天（有消耗分支）。
    await user.keyboard("{Home}");
    expect(document.activeElement).toHaveAttribute("aria-label", "2026年10月5日 · 无消耗");
    await user.keyboard("{End}");
    expect(document.activeElement).toHaveAttribute("aria-label", YESTERDAY_LABEL);

    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toHaveAttribute(
      "aria-label",
      "2026年10月10日 · 123 tok · 1 个会话 · 定价未知"
    );

    // ±7 越界不动：10-10 右移一周出窗（窗口末天是 10-12）。
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toHaveAttribute(
      "aria-label",
      "2026年10月10日 · 123 tok · 1 个会话 · 定价未知"
    );

    // 边界不动：窗口末天（今天）向下越界；窗口首天（2025-10-13）向上 / 左移越界。
    await user.click(dayButton("2026年10月12日 · 无消耗"));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("aria-label", "2026年10月12日 · 无消耗");
    const firstDay = dayButton("2025年10月13日 · 无消耗");
    await user.click(firstDay);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(firstDay);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(firstDay);

    // Enter 展开（昨天格有会话）→ Escape 收起，焦点留在格上。
    const yesterday = dayButton(YESTERDAY_LABEL);
    await user.click(yesterday);
    expect(yesterday).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Enter}");
    expect(yesterday).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(yesterday).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(yesterday).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(yesterday);
  });

  it("roving tabindex：整个网格恰一个 tabindex=0，初始落在今天", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const table = calendarTable();
    const focusable = table.querySelectorAll('[data-probe="calendar-day"][tabindex="0"]');
    expect(focusable).toHaveLength(1);
    expect(focusable[0]).toHaveAttribute("aria-label", "2026年10月12日 · 无消耗");
  });

  it("今天格 data-probe=calendar-today 唯一（挂在 td 上，365 计数不被挤占）", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const todayCells = document.querySelectorAll('[data-probe="calendar-today"]');
    expect(todayCells).toHaveLength(1);
    expect(todayCells[0].tagName).toBe("TD");
    expect(todayCells[0].querySelector('[data-probe="calendar-day"]')).not.toBeNull();
  });

  it("面板口径脚注在场（窗口固定、不随区间选择器）", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);
    expect(
      screen.getByText(
        "窗口固定滚动近 12 个月（365 天），不随上方区间选择器变化；色深 = 当日估算成本的四分位档，0 档 = 无消耗。"
      )
    ).toBeVisible();
  });
});

describe("UsageCalendarPanel · 样式纪律（读 CSS 文件断言，同 Heatmap 先例）", () => {
  // 注释先剥掉：「12px 格、3px 缝」的豁免说明写在注释里，不剥会误伤字面量检查。
  const css = readFileSync(
    resolve(process.cwd(), "src/features/usage/UsageCalendarPanel.module.css"),
    "utf8"
  ).replace(/\/\*[\s\S]*?\*\//g, "");

  it("焦点环走令牌：:focus-visible 里是 --focus-ring-width / --focus-ring-offset", () => {
    const rule = /\.dayButton:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("var(--focus-ring-width)");
    expect(rule![1]).toContain("var(--focus-ring-offset)");
  });

  it("无颜色字面量（--cal-* 与语义令牌只以 var() 引用，值在 tokens.css）", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/hsla?\(/);
  });

  it("间距走 --sp-*：px 字面量只剩「形」（格 / 缝 / 描边 / 轨道），12px 与 3px 各恰出现一次且在变量定义里", () => {
    const literals = Array.from(css.matchAll(/(\d+)px/g)).map((match) => match[0]);
    const allowed = new Set(["1px", "2px", "3px", "12px", "56px"]);
    for (const literal of literals) {
      expect(allowed.has(literal), `未豁免的像素字面量：${literal}`).toBe(true);
    }
    // 12px / 3px 是「形」的唯一定义点：格与缝从此派生（--cal-cell / --cal-gap）。
    expect(css.match(/12px/g) ?? []).toHaveLength(1);
    expect(css.match(/3px/g) ?? []).toHaveLength(1);
    expect(css).toMatch(/--cal-cell:\s*12px/);
    expect(css).toMatch(/--cal-gap:\s*3px/);
  });
});
