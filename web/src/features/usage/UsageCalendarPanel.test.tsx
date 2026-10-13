import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { DAY_DENSITY_LEVELS, densityLevelOf } from "./dayReview";
import { addLocalDays, type UsageSessionInput } from "./usageAggregations";
import { UsageCalendarPanel } from "./UsageCalendarPanel";

/**
 * 组件直挂（页面级集成由 UsageOverviewPage.test 与 e2e 负责）：网格几何、
 * aria-label 三分支逐字、点击展开 / 收起、roving tabindex 键盘映射、图例与
 * 视觉纪律；展开区是 Round V2 的「一日回望」——日摘要六项 + 24 小时时间线
 * （一行一会话，形状与账目同一行）。`now` 注入固定时刻——「今天」因此是确定的
 * 2026-10-12（周一），昨天 2026-10-11、前天 10-10、大前天 10-09。
 */

const NOW = new Date(2026, 9, 12, 12, 0, 0).getTime();
const TODAY = new Date(2026, 9, 12).getTime();
const YESTERDAY = addLocalDays(TODAY, -1);

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

/** 一天内的本地时刻（当天 00:00 起的秒数）。 */
const at = (hour: number, minute = 0, second = 0): number => hour * 3600 + minute * 60 + second;

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

/** 一个会话的多条记录：`[当天秒数, input token]`，用来摆出逐小时的活动形状。 */
function sessionWithPoints(
  path: string,
  title: string,
  dayStart: number,
  points: ReadonlyArray<readonly [number, number]>,
  project: { label: string; cwd: string } = { label: "-repo-cal", cwd: "/repo/cal" }
) {
  return {
    records: points.map(([seconds, tokens]) =>
      record(dayStart + seconds * 1000, {
        model: "claude-sonnet-4-5",
        usage: { inputTokens: tokens }
      })
    ),
    projectLabel: project.label,
    projectPath: project.cwd,
    session: metaOf(path, title)
  };
}

/** 昨天 8 个会话按 token 阶梯（8,000 → 1,000），单一项目。 */
function ladderInputs() {
  return Array.from({ length: 8 }, (_, index) =>
    sessionAt(`/sessions/s${index}.jsonl`, `会话 ${index}`, YESTERDAY, (8 - index) * 1_000)
  );
}

/** 三种 aria-label 分支 + 部分未知追加段的一次性布景（网格用例用）。 */
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

/**
 * 一日回望的主布景：A 是 09:20 起 90 秒的极短会话（同一小时 2 条记录），
 * B 横跨 13:05–18:40（四个小时各一条），两个项目 → 有色键。
 */
function dayReviewInputs() {
  return [
    sessionWithPoints("/sessions/a.jsonl", "会话 A", YESTERDAY, [
      [at(9, 20), 400_000],
      [at(9, 20, 90), 200_000]
    ]),
    sessionWithPoints(
      "/sessions/b.jsonl",
      "会话 B",
      YESTERDAY,
      [
        [at(13, 5), 100_000],
        [at(15), 80_000],
        [at(17, 30), 70_000],
        [at(18, 40), 50_000]
      ],
      { label: "-repo-other", cwd: "/repo/other" }
    )
  ];
}

/** 昨天：4 条落在 09 点（档 2）+ 2 条落在 10 点（档 1）；更密集的 6 条在 14 点（档 3）。 */
function densityInputs() {
  return [
    sessionWithPoints("/sessions/dense.jsonl", "密集", YESTERDAY, [
      [at(9), 1],
      [at(9, 1), 1],
      [at(9, 2), 1],
      [at(9, 3), 1],
      [at(10), 1],
      [at(10, 1), 1]
    ]),
    sessionWithPoints(
      "/sessions/denser.jsonl",
      "更密集",
      YESTERDAY,
      Array.from({ length: 6 }, (_, index) => [at(14, index), 1] as const)
    )
  ];
}

/** 今天：一个昨天 23:40 起、今天 00:25 / 00:52 / 01:10 都有记录的跨午夜会话 + 一个当天会话。 */
function crossDayInputs() {
  return [
    {
      records: [
        record(YESTERDAY + at(23, 40) * 1000, {
          model: "claude-sonnet-4-5",
          usage: { inputTokens: 50_000 }
        }),
        record(TODAY + at(0, 25) * 1000, {
          model: "claude-sonnet-4-5",
          usage: { inputTokens: 90_000 }
        }),
        record(TODAY + at(0, 52) * 1000, {
          model: "claude-sonnet-4-5",
          usage: { inputTokens: 30_000 }
        }),
        record(TODAY + at(1, 10) * 1000, {
          model: "claude-sonnet-4-5",
          usage: { inputTokens: 60_000 }
        })
      ],
      projectLabel: "-repo-cal",
      projectPath: "/repo/cal",
      session: metaOf("/sessions/night.jsonl", "跨午夜")
    },
    sessionWithPoints("/sessions/plain.jsonl", "当天会话", TODAY, [[at(10), 10_000]])
  ];
}

function calendarTable() {
  return screen.getByRole("table", { name: "消耗日历（近 12 个月）" });
}

/**
 * 按 aria-label 取格子（日期是每个格子唯一的名）。直接查属性、不走 RTL 的
 * 可访问名计算：365 个格子逐个算名是 `getByRole(name)` 的开销大头，也是这个
 * 文件在全量并行下偶尔被 5s 超时饿到的来源。「可访问名到底叫什么」另有一条
 * 用例走 `dayButtonByRole` 逐字断言——查得到与名叫什么，两件事分开验。
 */
function dayButton(label: string): HTMLElement {
  const button = document.querySelector(`[data-probe="calendar-day"][aria-label="${label}"]`);
  if (!button) throw new Error(`没有找到格子：${label}`);
  return button as HTMLElement;
}

/** 按可访问名取格子（只有「可访问名三分支逐字」那条用例需要这条路径）。 */
function dayButtonByRole(label: string): HTMLElement {
  return screen.getByRole("button", { name: label });
}

function sessionsSection(): HTMLElement {
  const section = document.querySelector("[data-calendar-sessions]");
  if (!section) throw new Error("展开区不在场");
  return section as HTMLElement;
}

/** 按会话数找格子（不想复算格子 aria-label 的布景用它）。 */
function dayButtonWithSessions(count: number): HTMLElement {
  const button = document.querySelector(`[data-probe="calendar-day"][data-sessions="${count}"]`);
  if (!button) throw new Error(`没有 ${count} 个会话的格子`);
  return button as HTMLElement;
}

function barOf(path: string): HTMLElement {
  const bars = Array.from(document.querySelectorAll('[data-probe="day-timeline-bar"]'));
  const bar = bars.find((element) => element.getAttribute("data-session-path") === path);
  if (!bar) throw new Error(`没有找到 ${path} 的时间线条`);
  return bar as HTMLElement;
}

function blocksOf(path: string): HTMLElement[] {
  return Array.from(
    barOf(path).querySelectorAll('[data-probe="day-timeline-density"]')
  ) as HTMLElement[];
}

/** 轨道取第一个活动块的父节点（轨道本身没有锚点：锚点只在块与行上）。 */
function trackOf(path: string): HTMLElement {
  const track = blocksOf(path)[0]?.parentElement;
  if (!track) throw new Error(`${path} 没有活动块，取不到轨道`);
  return track as HTMLElement;
}

/** 基线是轨道里的第一个子节点（渲染顺序即 rail → block…）。 */
function railOf(path: string): HTMLElement {
  return trackOf(path).children[0] as HTMLElement;
}

const percent = (value: string): number => Number.parseFloat(value);

const DAY_REVIEW_LABEL =
  "2026年10月11日 · 估算成本 $2.70 · 900,000 tok · 2 个会话 · cal";
const YESTERDAY_LABEL = "2026年10月11日 · 估算成本 $0.11 · 36,000 tok · 8 个会话 · cal";
const DAY_FOOTNOTE =
  "活跃跨度 = 当天首条至末条记录的时刻，不是有活动的小时数；占比分母 = 当日 token 总量。成本为估算值（定价快照 2026-10-01），token、会话数、消息数读自本机日志；项目色按当日 token 降序取前 5 名，其余项目并入「其他」。";

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
    expect(dayButtonByRole(YESTERDAY_LABEL)).toHaveAttribute("title", YESTERDAY_LABEL);
    // 有记录无成本（全 unknown）：token 与会话照报，不装作没有活动。
    expect(
      dayButtonByRole("2026年10月10日 · 123 tok · 1 个会话 · 定价未知")
    ).toBeInTheDocument();
    // 无记录（今天）。
    expect(dayButtonByRole("2026年10月12日 · 无消耗")).toBeInTheDocument();
    // cost > 0 且有 unknown token：末尾追加「部分会话未知价」。
    expect(
      dayButtonByRole(
        "2026年10月9日 · 估算成本 $3.00 · 1.0M tok · 1 个会话 · cal · 部分会话未知价"
      )
    ).toBeInTheDocument();
  });

  it("点击有会话的格子展开一日回望：头部计数、再点收起、空格无展开", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const yesterday = dayButton(YESTERDAY_LABEL);
    expect(yesterday).toHaveAttribute("aria-expanded", "false");
    await user.click(yesterday);

    expect(yesterday).toHaveAttribute("aria-expanded", "true");
    const detail = document.querySelector("[data-calendar-sessions]") as HTMLElement;
    expect(detail).not.toBeNull();
    expect(within(detail).getByText("10月11日 · 8 个会话")).toBeVisible();
    // 展开区容器的 aria-label 沿用 V1 原文（不制造第二个人话名字）。
    expect(detail).toHaveAttribute("aria-label", "10月11日会话清单");
    // 旧「Top 会话」形态整个退场。
    expect(within(detail).queryByText(/消耗 Top 会话/)).toBeNull();
    expect(within(detail).queryByText(/其余 \d+ 个会话/)).toBeNull();

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

describe("UsageCalendarPanel · 一日回望（Round V2）", () => {
  const summaryItems = (): HTMLElement[] =>
    Array.from(
      document.querySelectorAll('[data-probe="day-summary-item"]')
    ) as HTMLElement[];

  function itemOf(key: string): HTMLElement {
    const item = summaryItems().find((element) => element.getAttribute("data-summary-key") === key);
    if (!item) throw new Error(`没有找到摘要项 ${key}`);
    return item;
  }

  /** 第一行是标签，最后一行是数值（徽章夹在中间）。 */
  const labelOf = (item: HTMLElement): string => item.firstElementChild?.textContent ?? "";
  const valueOf = (item: HTMLElement): string => item.lastElementChild?.textContent ?? "";

  it("日摘要六项：顺序、标签、值、悬停原文与出处徽章逐字", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} />);
    await user.click(dayButton(DAY_REVIEW_LABEL));

    const container = document.querySelector('[data-probe="day-summary"]');
    expect(container).not.toBeNull();
    expect(summaryItems().map((item) => item.getAttribute("data-summary-key"))).toEqual([
      "cost",
      "sessions",
      "messages",
      "span",
      "model",
      "projects"
    ]);

    // 双数格：成本 + token 同行（后段降一档）。
    expect(labelOf(itemOf("cost"))).toBe("当日消耗");
    expect(valueOf(itemOf("cost"))).toBe("$2.70 · 900,000 tok");
    expect(labelOf(itemOf("sessions"))).toBe("会话数");
    expect(valueOf(itemOf("sessions"))).toBe("2");
    expect(labelOf(itemOf("messages"))).toBe("消息数");
    expect(valueOf(itemOf("messages"))).toBe("6");
    expect(labelOf(itemOf("span"))).toBe("活跃跨度");
    expect(valueOf(itemOf("span"))).toBe("09:20–18:40");
    expect(labelOf(itemOf("model"))).toBe("最常用模型");
    expect(valueOf(itemOf("model"))).toBe("Sonnet 4.5");
    expect(labelOf(itemOf("projects"))).toBe("涉及项目");
    expect(valueOf(itemOf("projects"))).toBe("2");

    // 悬停原文（§4.2 表）逐字：跨度只给时刻对，时长进 title。
    expect(itemOf("cost")).toHaveAttribute(
      "title",
      "当日估算成本 $2.70（定价快照 2026-10-01）；token 合计 900,000，读自本机日志"
    );
    expect(itemOf("sessions")).toHaveAttribute("title", "当天有记录的会话数");
    expect(itemOf("messages")).toHaveAttribute(
      "title",
      "当天 user / assistant 记录的条数（不含压缩摘要）"
    );
    expect(itemOf("span")).toHaveAttribute(
      "title",
      "活跃跨度：当天首条记录 09:20，末条 18:40，跨度 9 小时 20 分（不是有活动的小时数）"
    );
    expect(itemOf("model")).toHaveAttribute("title", "claude-sonnet-4-5 · 900,000 tok");
    expect(itemOf("projects")).toHaveAttribute("title", "当天涉及的项目数（按项目标签去重）");

    // 徽章：双数格取较弱的一侧（成本估算），其余五项读自日志；一格最多一枚。
    expect(
      itemOf("cost").querySelector('[aria-label^="数据来源：按定价快照估算"]')
    ).not.toBeNull();
    for (const key of ["sessions", "messages", "span", "model", "projects"]) {
      expect(itemOf(key).querySelector('[aria-label^="数据来源：读自日志"]')).not.toBeNull();
    }
    expect(itemOf("cost").querySelectorAll("[aria-label]")).toHaveLength(1);
  });

  it("展开区脚注逐字（活跃跨度口径 / 占比分母 / 成本估算 / 项目色档）", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} />);
    await user.click(dayButton(DAY_REVIEW_LABEL));

    expect(within(sessionsSection()).getByText(DAY_FOOTNOTE)).toBeVisible();
  });

  it("时间线：条数 = 会话数、按起点升序、条数三方一致的声明值、轴 9 个刻度", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} />);
    await user.click(dayButton(DAY_REVIEW_LABEL));

    const timeline = document.querySelector('[data-probe="day-timeline"]') as HTMLElement;
    expect(timeline).not.toBeNull();
    // 组件声明的会话数：门禁拿它与实测条数、<li> 计数三方对账。
    expect(timeline).toHaveAttribute("data-session-count", "2");

    const bars = Array.from(document.querySelectorAll('[data-probe="day-timeline-bar"]'));
    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.getAttribute("data-session-path"))).toEqual([
      "/sessions/a.jsonl",
      "/sessions/b.jsonl"
    ]);
    // <li> 计数 === 条数（门禁数的是 li）。
    expect(document.querySelectorAll('[data-probe="day-timeline-list"] li')).toHaveLength(2);
    // 列表的具名沿用「会话时间线」。
    expect(
      within(sessionsSection()).getByRole("list", { name: "10月11日会话时间线" })
    ).toBeInTheDocument();

    const ticks = Array.from(document.querySelectorAll('[data-probe="day-timeline-tick"]'));
    expect(ticks.map((tick) => tick.textContent)).toEqual([
      "00:00",
      "03:00",
      "06:00",
      "09:00",
      "12:00",
      "15:00",
      "18:00",
      "21:00",
      "24:00"
    ]);
  });

  it("条几何：基线 left / width 与本地日长的比例一致，行可访问名逐字", async () => {
    const user = userEvent.setup();
    // 可访问名的模板分两支（可打开 / 当前不可打开）；这里是可打开那一支。
    render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} onOpenSession={vi.fn()} />);
    await user.click(dayButton(DAY_REVIEW_LABEL));

    const daySeconds = 86_400;
    // A：09:20:00 → 09:21:30（90 秒）。
    expect(percent(railOf("/sessions/a.jsonl").style.left)).toBeCloseTo(
      (at(9, 20) / daySeconds) * 100,
      3
    );
    expect(percent(railOf("/sessions/a.jsonl").style.width)).toBeCloseTo((90 / daySeconds) * 100, 3);
    // B：13:05 → 18:40（5 小时 35 分）。
    expect(percent(railOf("/sessions/b.jsonl").style.left)).toBeCloseTo(
      (at(13, 5) / daySeconds) * 100,
      3
    );
    expect(percent(railOf("/sessions/b.jsonl").style.width)).toBeCloseTo(
      ((at(18, 40) - at(13, 5)) / daySeconds) * 100,
      3
    );

    // 行可访问名 / 悬停原文是同一份格式函数（§6.4 模板）。
    expect(barOf("/sessions/a.jsonl")).toHaveAttribute(
      "aria-label",
      "打开会话：会话 A（项目：cal）· 09:20–09:21 · 时长 1m30s · 当日消耗 $1.80 · 600,000 tok · 占当日 66.7%"
    );
    expect(barOf("/sessions/a.jsonl")).toHaveAttribute(
      "title",
      "打开会话：会话 A（项目：cal）· 09:20–09:21 · 时长 1m30s · 当日消耗 $1.80 · 600,000 tok · 占当日 66.7%"
    );
    expect(barOf("/sessions/b.jsonl")).toHaveAttribute(
      "aria-label",
      "打开会话：会话 B（项目：other）· 13:05–18:40 · 时长 5h35m0s · 当日消耗 $0.90 · 300,000 tok · 占当日 33.3%"
    );
  });

  it("密度块：按 4 / 8 / 12px 三档分高、块标题逐字、无记录的整点不画块", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={densityInputs()} now={NOW} />);
    await user.click(dayButtonWithSessions(2));

    const levels = (path: string) =>
      blocksOf(path).map((block) => block.getAttribute("data-density-level"));
    const titles = (path: string) => blocksOf(path).map((block) => block.getAttribute("title"));

    // 4 条 → 档 2；2 条 → 档 1；没有记录的小时（11–13、15–23）一块都没有。
    expect(levels("/sessions/dense.jsonl")).toEqual(["2", "1"]);
    expect(titles("/sessions/dense.jsonl")).toEqual([
      "09:00–10:00 · 4 条记录",
      "10:00–11:00 · 2 条记录"
    ]);
    // 6 条 → 档 3。
    expect(levels("/sessions/denser.jsonl")).toEqual(["3"]);
    expect(titles("/sessions/denser.jsonl")).toEqual(["14:00–15:00 · 6 条记录"]);

    // 档位口径与数据层同一张表（组件不另造一套阈值）。
    expect(DAY_DENSITY_LEVELS).toEqual([4, 8, 12]);
    expect(densityLevelOf(4)).toBe(2);
    expect(densityLevelOf(6)).toBe(3);
  });

  it("零跨度会话：基线宽 0（靠最小可视宽兜成刻痕）、起止两个相同时刻、时长 0ms", async () => {
    const user = userEvent.setup();
    render(
      <UsageCalendarPanel
        inputs={[sessionWithPoints("/sessions/one.jsonl", "单条", YESTERDAY, [[at(16), 100_000]])]}
        now={NOW}
        onOpenSession={vi.fn()}
      />
    );
    await user.click(dayButtonWithSessions(1));

    const rail = railOf("/sessions/one.jsonl");
    expect(rail.style.width).toBe("0%");
    expect(percent(rail.style.left)).toBeCloseTo((at(16) / 86_400) * 100, 3);
    // 单条记录只有一个小时块。
    expect(blocksOf("/sessions/one.jsonl")).toHaveLength(1);
    expect(barOf("/sessions/one.jsonl")).toHaveAttribute(
      "aria-label",
      "打开会话：单条（项目：cal）· 16:00–16:00 · 时长 0ms · 当日消耗 $0.30 · 100,000 tok · 占当日 100.0%"
    );
  });

  it("跨午夜：只画当天那一段、贴左边缘、标「跨天」，非跨天行三样都没有", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={crossDayInputs()} now={NOW} onOpenSession={vi.fn()} />);
    const todayCell = document.querySelector('[data-probe="calendar-today"] button') as HTMLElement;
    await user.click(todayCell);

    // 时间序：凌晨那行在前。
    const bars = Array.from(document.querySelectorAll('[data-probe="day-timeline-bar"]'));
    expect(bars.map((bar) => bar.getAttribute("data-session-path"))).toEqual([
      "/sessions/night.jsonl",
      "/sessions/plain.jsonl"
    ]);

    const night = barOf("/sessions/night.jsonl");
    expect(night).toHaveAttribute("data-cross-day", "true");
    expect(night.textContent).toContain("跨天");
    expect(night.getAttribute("aria-label")).toMatch(/ · 跨天$/);
    // 当天段 00:25–01:10（跨午夜被切开）。
    expect(percent(railOf("/sessions/night.jsonl").style.left)).toBeCloseTo(
      (at(0, 25) / 86_400) * 100,
      3
    );
    expect(percent(railOf("/sessions/night.jsonl").style.width)).toBeCloseTo(
      ((at(1, 10) - at(0, 25)) / 86_400) * 100,
      3
    );
    expect(blocksOf("/sessions/night.jsonl").map((block) => block.getAttribute("title"))).toEqual([
      "00:00–01:00 · 2 条记录",
      "01:00–02:00 · 1 条记录"
    ]);

    const plain = barOf("/sessions/plain.jsonl");
    expect(plain).not.toHaveAttribute("data-cross-day");
    expect(plain.textContent).not.toContain("跨天");
    expect(plain.getAttribute("aria-label")).not.toContain("跨天");
  });

  it("项目色键：≥2 个项目时在场且与行色点同档；单项目日不渲染", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} />);
    await user.click(dayButton(DAY_REVIEW_LABEL));

    const key = document.querySelector('[data-probe="day-project-key"]') as HTMLElement;
    expect(key).not.toBeNull();
    const keyItems = Array.from(key.querySelectorAll("li"));
    expect(keyItems.map((item) => item.textContent)).toEqual(["cal", "other"]);
    expect(
      keyItems.map((item) =>
        item.querySelector('[data-probe="day-project-dot"]')?.getAttribute("data-project-index")
      )
    ).toEqual(["1", "2"]);
    // 行色点与色键同一档（token → 1..6）。
    expect(
      barOf("/sessions/a.jsonl")
        .querySelector('[data-probe="day-project-dot"]')
        ?.getAttribute("data-project-index")
    ).toBe("1");
    expect(
      barOf("/sessions/b.jsonl")
        .querySelector('[data-probe="day-project-dot"]')
        ?.getAttribute("data-project-index")
    ).toBe("2");
    unmount();

    // 单项目日：不给唯一的项目一个随机色，色键整个不在场。
    render(<UsageCalendarPanel inputs={ladderInputs()} now={NOW} />);
    await user.click(dayButton(YESTERDAY_LABEL));
    expect(document.querySelector('[data-probe="day-project-key"]')).toBeNull();
    expect(document.querySelectorAll('[data-probe="day-timeline-bar"]')).toHaveLength(8);
  });

  it("点行 → onOpenSession 收到该行的 SessionMeta（path 逐字）", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} onOpenSession={onOpenSession} />);
    await user.click(dayButton(DAY_REVIEW_LABEL));

    await user.click(barOf("/sessions/b.jsonl"));
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession.mock.calls[0][0]).toEqual(metaOf("/sessions/b.jsonl", "会话 B"));
  });

  it("无 SessionMeta 的行照列但不可点：disabled、不进 Tab 顺序、悬停说明照报", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    const inputs = [
      sessionWithPoints("/sessions/a.jsonl", "会话 A", YESTERDAY, [[at(9), 100_000]]),
      {
        records: [
          record(YESTERDAY + at(11) * 1000, {
            model: "claude-sonnet-4-5",
            usage: { inputTokens: 50_000 }
          })
        ],
        projectLabel: "-repo-cal"
      }
    ];
    render(<UsageCalendarPanel inputs={inputs} now={NOW} onOpenSession={onOpenSession} />);
    await user.click(dayButtonWithSessions(2));

    const anonymous = barOf("");
    expect(anonymous).toBeDisabled();
    expect(anonymous.getAttribute("aria-label")).toMatch(/ · 当前不可打开$/);
    // 只有可打开的那一行进 Tab 顺序。
    const tabbable = document.querySelectorAll(
      '[data-probe="day-timeline-bar"][tabindex="0"]'
    );
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("data-session-path", "/sessions/a.jsonl");
  });

  it("时间线键盘：单个 Tab stop、↑↓ / Home / End 移动不环绕、Enter 打开、Escape 收起并回焦到天格", async () => {
    const user = userEvent.setup();
    const onOpenSession = vi.fn();
    render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} onOpenSession={onOpenSession} />);

    const yesterday = dayButton(DAY_REVIEW_LABEL);
    await user.click(yesterday);

    const first = barOf("/sessions/a.jsonl");
    const second = barOf("/sessions/b.jsonl");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");

    first.focus();
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(second);
    // 末行不环绕、首行不环绕。
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(second);

    await user.keyboard("{Enter}");
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession.mock.calls[0][0].path).toBe("/sessions/b.jsonl");

    // Escape：收起展开区，焦点回到网格上被选中的那个天格（aria-expanded 的闭环）。
    await user.keyboard("{Escape}");
    expect(document.querySelector("[data-calendar-sessions]")).toBeNull();
    expect(document.activeElement).toBe(yesterday);
    expect(yesterday).toHaveAttribute("aria-expanded", "false");
  });

  it("当天无会话（防御态）：只留一行实话，不造空轴、不造 0 行", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<UsageCalendarPanel inputs={dayReviewInputs()} now={NOW} />);
    await user.click(dayButton(DAY_REVIEW_LABEL));
    expect(document.querySelector('[data-probe="day-summary"]')).not.toBeNull();

    // 渐进扫描把这一天的记录刷新掉后，展开区仍在场——此时不造假数据。
    rerender(<UsageCalendarPanel inputs={[]} now={NOW} />);
    expect(within(sessionsSection()).getByText("这一天没有会话记录")).toBeVisible();
    expect(document.querySelector('[data-probe="day-summary"]')).toBeNull();
    expect(document.querySelector('[data-probe="day-timeline"]')).toBeNull();
    expect(document.querySelector('[data-probe="day-project-key"]')).toBeNull();
  });
});

describe("UsageCalendarPanel · 一年洞察（Round V3）", () => {
  /** 键 → 句 li 的直查（六句的键写死，与门禁 / e2e 同一份契约）。 */
  function insightItemOf(key: string): HTMLElement {
    const item = document.querySelector(
      `[data-probe="calendar-insight-item"][data-insight-key="${key}"]`
    );
    if (!item) throw new Error(`没有找到洞察句 ${key}`);
    return item as HTMLElement;
  }

  /**
   * 365 天几乎全有消耗（每天 1000 tok sonnet）：10−2 换成密集日（全 unknown →
   * 0 成本但有会话）、10−1 真空白——把「最���空白」逼成两天小段，密集日型端点
   * （可点）与真空白天端点（纯文本）在同一个区间里出现。
   */
  function nearFullInputs(): UsageSessionInput[] {
    const inputs: UsageSessionInput[] = [];
    for (let offset = -364; offset <= 0; offset += 1) {
      const dayStart = addLocalDays(TODAY, offset);
      if (offset === -1) continue;
      if (offset === -2) {
        inputs.push({
          records: [
            record(dayStart + 11 * 3_600_000, {
              model: "gpt-unknown-9",
              usage: { inputTokens: 123 }
            })
          ],
          projectLabel: "-repo-cal",
          projectPath: "/repo/cal"
        });
        continue;
      }
      inputs.push(sessionAt(`/sessions/full${-offset}.jsonl`, `满年 ${-offset}`, dayStart, 1_000));
    }
    return inputs;
  }

  it("六句全渲染：键序逐字 = Issue 契约顺序；洞察区带「一年洞察」名、在图例正下方", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const keys = Array.from(document.querySelectorAll('[data-probe="calendar-insight-item"]')).map(
      (item) => item.getAttribute("data-insight-key")
    );
    expect(keys).toEqual([
      "longest-streak",
      "current-streak",
      "peak-day",
      "longest-gap",
      "active-share",
      "month-compare"
    ]);
    const insights = document.querySelector('[data-probe="calendar-insights"]') as HTMLElement;
    expect(insights.tagName).toBe("UL");
    expect(insights).toHaveAttribute("aria-label", "一年洞察");
    // 形态位置（§1.2）：图���之后、展开区之上——展开一日回望时句子不动。
    const legend = document.querySelector("[data-cal-legend]")!;
    expect(legend.nextElementSibling).toBe(insights);
  });

  // mixedInputs 的手算账：active 天 = 10-09（$3.00）与 10-11（$0.108 → $0.11），
  // 10-10 是密集日（0 成本、1 会话）、今天无 → pending 单日段。环比 N = 12，
  // 本月第 1..12 天合计 $3.108、上月同期（9 月）无消耗。
  it("文案逐字（§4.1 模板：全角括号、en dash、单日区间只写一次）", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    expect(insightItemOf("longest-streak").textContent).toBe("最长连胜 1 天（10月11日）");
    expect(insightItemOf("current-streak").textContent).toBe(
      "今天还没有消耗；此前连续 1 天（10月11日）"
    );
    expect(insightItemOf("peak-day").textContent).toBe("最贵一天 10月9日（$3.00）");
    expect(insightItemOf("longest-gap").textContent).toBe("最长空白 361 天（2025年10月13日–10月8日）");
    expect(insightItemOf("active-share").textContent).toBe("这一年 2/365 天有消耗（1%）");
    expect(insightItemOf("month-compare").textContent).toBe("本月前 12 天 $3.11（上月同期无消耗）");
  });

  it("六条口径 title 逐字（§5.2 表）；longest-gap 触及窗口首日追加「实际可能长」", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    expect(insightItemOf("longest-streak").getAttribute("title")).toBe(
      "连续 1 天 = 窗口内连续「当日估算成本 > $0」的最长天数，与格子 0 档同口径（定价未知的天不计）；并列取最近一段"
    );
    expect(insightItemOf("current-streak").getAttribute("title")).toBe(
      "从今天往回数「当日估算成本 > $0」的连续天数；今天没有消耗时如实说明，不预设今天结束"
    );
    expect(insightItemOf("peak-day").getAttribute("title")).toBe(
      "当日估算成本最大的一天，与格子色深同口径（定价快照 2026-10-01）；并列取最近"
    );
    expect(insightItemOf("longest-gap").getAttribute("title")).toBe(
      "连续「当日估算成本 ≤ $0」的最长天数；定价未知的天计入空白（与格子 0 档同口径）；并列取最近一段；区间自窗口首日起算，实际可能长"
    );
    expect(insightItemOf("active-share").getAttribute("title")).toBe(
      "窗口 365 天里「当日估算成本 > $0」的天数；定价未知的天不计入"
    );
    expect(insightItemOf("month-compare").getAttribute("title")).toBe(
      "本月第 1..12 天与上月同期 12 天的估算成本之和对比（等长日历窗，不拿部分月比完整月）；成本为估算值（定价快照 2026-10-01）"
    );
  });

  it("日期下钻：点 peak-day 句的日期按钮 → 展开区在场且头部含该天、格子 aria-expanded=true、再点收起", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const dateButton = insightItemOf("peak-day").querySelector("button")!;
    expect(dateButton.textContent).toBe("10月9日");
    await user.click(dateButton);

    const detail = document.querySelector("[data-calendar-sessions]") as HTMLElement;
    expect(detail).not.toBeNull();
    expect(within(detail).getByText("10月9日 · 1 个会话")).toBeVisible();
    expect(
      dayButton("2026年10月9日 · 估算成本 $3.00 · 1.0M tok · 1 个会话 · cal · 部分会话未知价")
    ).toHaveAttribute("aria-expanded", "true");

    // toggle：再点同一日期按钮收起（与格子点击同一条 state）。
    await user.click(dateButton);
    expect(document.querySelector("[data-calendar-sessions]")).toBeNull();
  });

  it("日期按钮的 title / aria-label 同文且带年（cellLabelOf 的完整式 + 动作预告）", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const dateButton = insightItemOf("peak-day").querySelector("button")!;
    expect(dateButton).toHaveAttribute("title", "2026年10月9日 · 打开一日回望");
    expect(dateButton).toHaveAttribute("aria-label", "2026年10月9日 · 打开一日回望");
    // 跨年端点（窗口首日）的正文带年，按钮名仍带年。
    const gapStart = insightItemOf("longest-gap").textContent;
    expect(gapStart).toContain("2025年10月13日");
  });

  it("可点资格：密集日端点（sessions > 0、costUsd = 0）是 button 且点击可展开；真空白天端点是纯文本", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={nearFullInputs()} now={NOW} />);

    const gap = insightItemOf("longest-gap");
    expect(gap.textContent).toBe("最长空白 2 天（10月10日–10月11日）");
    const buttons = gap.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("10月10日");
    await user.click(buttons[0]);
    expect(document.querySelector("[data-calendar-sessions]")).not.toBeNull();
  });

  it("真空白天端点不是禁用按钮（mixedInputs 的最长空白两端都无会话）", () => {
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const gap = insightItemOf("longest-gap");
    expect(gap.querySelectorAll("button")).toHaveLength(0);
    expect(within(gap).queryByRole("button")).toBeNull();
    // 端点日期仍是正文的一部分（span 文本）。
    expect(gap.textContent).toContain("2025年10月13日");
  });

  it("当前连胜 active 态；触及窗口首日的最长连胜照报且 title 注明「实际可能更长」", () => {
    render(<UsageCalendarPanel inputs={nearFullInputs()} now={NOW} />);

    expect(insightItemOf("current-streak").textContent).toBe("当前连胜 1 天（10月12日至今）");
    expect(insightItemOf("longest-streak").textContent).toBe("最长连胜 362 天（2025年10月13日–10月9日）");
    expect(insightItemOf("longest-streak").getAttribute("title")).toBe(
      "连续 362 天 = 窗口内连续「当日估算成本 > $0」的最长天数，与格子 0 档同口径（定价未知的天不计）；并列取最近一段；区间自窗口首日起算，实际可能更长"
    );
  });

  it("当前连胜 broken 态：最近消耗日 +「N 天前」（idleDays ≥ 2 的分支）", () => {
    render(
      <UsageCalendarPanel
        inputs={[sessionAt("/sessions/old.jsonl", "旧会话", addLocalDays(TODAY, -4), 100_000)]}
        now={NOW}
      />
    );
    expect(insightItemOf("current-streak").textContent).toBe("连胜已断：最近消耗 10月8日（4 天前）");
  });

  it("Escape：展开态下焦点在日期按钮上按 Escape → 展开区收起、焦点留在按钮", async () => {
    const user = userEvent.setup();
    render(<UsageCalendarPanel inputs={mixedInputs()} now={NOW} />);

    const dateButton = insightItemOf("peak-day").querySelector("button")!;
    await user.click(dateButton);
    expect(document.querySelector("[data-calendar-sessions]")).not.toBeNull();

    dateButton.focus();
    await user.keyboard("{Escape}");
    expect(document.querySelector("[data-calendar-sessions]")).toBeNull();
    expect(document.activeElement).toBe(dateButton);
  });

  it("空态：无 usage 输入 → 六句不在、空态单句在场（calendar-insights 容器仍在）", () => {
    render(<UsageCalendarPanel inputs={[]} now={NOW} />);

    const container = document.querySelector('[data-probe="calendar-insights"]') as HTMLElement;
    expect(container).not.toBeNull();
    expect(container.querySelectorAll("[data-insight-key]")).toHaveLength(0);
    expect(container.textContent).toBe("这一年还没有可统计的消耗");
  });

  it("视觉纪律：.insight* 规则无颜色字面量、无 --sp-* 之外的间距字面量", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/features/usage/UsageCalendarPanel.module.css"),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const blocks = Array.from(css.matchAll(/\.insight[^{}]*\{([^}]*)\}/g)).map((match) => match[1]);
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const block of blocks) {
      expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(block).not.toMatch(/rgba?\(/);
      expect(block).not.toMatch(/hsla?\(/);
      expect(block).not.toMatch(/\d+(?:\.\d+)?px/);
    }
    // 句间分隔走 --sp-* 令牌（不写字面量间距）。
    expect(css).toMatch(/\.insights\s*\{[^}]*gap: var\(--sp-1\) var\(--sp-3\)/);
    // 焦点环走令牌（普通 2px / HC 3px 自动换挡，组件零分支）。
    expect(css).toMatch(/\.insightDate:focus-visible\s*\{[^}]*var\(--focus-ring-width\)/);
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

  it("整行焦点环用负偏移：行是全宽控件，正偏移的环会被行区 overflow 裁掉", () => {
    const rule = /\.dayRow:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("var(--focus-ring-width)");
    expect(rule![1]).toContain("var(--focus-ring-inset)");
  });

  it("无颜色字面量（--cal-* / --chart-* 与语义令牌只以 var() 引用，值在 tokens.css）", () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/rgba?\(/);
    expect(css).not.toMatch(/hsla?\(/);
  });

  it("密度是几何不是颜色：全文件不出现 opacity 声明，也不出现 direction", () => {
    expect(css).not.toMatch(/opacity\s*:/);
    expect(css).not.toMatch(/direction\s*:/);
  });

  it("时间线零高对比度特判：唯一的 [data-contrast] 规则仍是日历格描边", () => {
    const selectors = Array.from(css.matchAll(/([^{}]*\[data-contrast[^{}]*)\{/g)).map((match) =>
      match[1].trim()
    );
    expect(selectors).toEqual([':global([data-contrast="high"]) .dayButton']);
  });

  it("时间线行区有界：max-height 走令牌、竖向滚动收在行区里", () => {
    const rule = /\.dayRows\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain("max-height: var(--day-rows-max)");
    expect(rule![1]).toContain("overflow-y: auto");
    expect(css).toMatch(/--day-rows-max:\s*144px/);
  });

  it("间距走 --sp-*：px 字面量只剩「形」，时间线几何只在 --day-* 变量块里定义一次", () => {
    const literals = Array.from(css.matchAll(/(\d+(?:\.\d+)?)px/g)).map((match) => match[1]);
    const allowed = new Set([
      "0",
      "1",
      "2",
      "3",
      "4",
      "8",
      "10",
      "12",
      "14",
      "104",
      "132",
      "144",
      "200",
      "216",
      "240",
      "800"
    ]);
    for (const literal of literals) {
      expect(allowed.has(literal), `未豁免的像素字面量：${literal}px`).toBe(true);
    }
    // 日历格与缝仍是唯一定义点。
    expect(css).toMatch(/--cal-cell:\s*12px/);
    expect(css).toMatch(/--cal-gap:\s*3px/);
    // 时间线的列预算 / 轨道 / 块高 / 色点 / 行区上限全部由 --day-* 派生。
    for (const declaration of [
      "--day-summary-min: 132px",
      "--day-col-label: 200px",
      "--day-col-track-min: 240px",
      "--day-col-time: 104px",
      "--day-col-read: 216px",
      "--day-content-min: 800px",
      "--day-track-h: 14px",
      "--day-rail-h: 1px",
      "--day-rail-min-w: 3px",
      "--day-block-min-w: 2px",
      "--day-dot: 10px"
    ]) {
      expect(css).toContain(declaration);
    }
  });

  it("密度块三档高与 DAY_DENSITY_LEVELS 同源：4 / 8 / 12px 由 --day-block-h* 给出", () => {
    expect(css).toContain(`--day-block-h1: ${DAY_DENSITY_LEVELS[0]}px`);
    expect(css).toContain(`--day-block-h2: ${DAY_DENSITY_LEVELS[1]}px`);
    expect(css).toContain(`--day-block-h3: ${DAY_DENSITY_LEVELS[2]}px`);
    expect(css).toMatch(/\.block\[data-density-level="1"\]\s*\{[^}]*var\(--day-block-h1\)/);
    expect(css).toMatch(/\.block\[data-density-level="2"\]\s*\{[^}]*var\(--day-block-h2\)/);
    expect(css).toMatch(/\.block\[data-density-level="3"\]\s*\{[^}]*var\(--day-block-h3\)/);
    // 基线 1px、块最小宽 2px、条最小宽 3px（形，不随字号缩放）。
    expect(css).toMatch(/\.rail\s*\{[^}]*min-width:\s*var\(--day-rail-min-w\)/);
    expect(css).toMatch(/\.rail\s*\{[^}]*height:\s*var\(--day-rail-h\)/);
    expect(css).toMatch(/\.block\s*\{[^}]*min-width:\s*var\(--day-block-min-w\)/);
    // 旧「Top 会话」的占比条类名整个退场。
    for (const gone of [".barTrack", ".barFill", ".barRestFill", ".sessionRest", ".sessionPct"]) {
      expect(css).not.toContain(gone);
    }
  });
});
