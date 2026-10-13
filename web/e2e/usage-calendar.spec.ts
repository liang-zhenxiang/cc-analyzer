import type { Page } from "@playwright/test";
import { test, expect, calendarScenario } from "./fixtures";

/**
 * Issue #187「消耗日历」的端到端覆盖，跑在生产构建产物上（Chromium + WebKit）。
 *
 * 数据来自 `calendarScenario()`（见 fixtures.ts）：内存合成、时间戳按本地日历日
 * 的固定时刻锚定，所以「哪天是几档、今天有几个会话」是确定值。
 *
 * 主线：365 天格 + 53 列几何；档位着色真算（计算样式 vs 令牌解析值，不是文本
 * 匹配）；滚动收在日历容器内部（800 视口下文档 / main 不横向溢出）；130% 字号
 * 与高对比度两档换挡。
 *
 * 下钻展开区（Issue #192「一日回望」：日摘要 + 24h 时间线的结构、几何、交互与
 * 换挡）在 `day-review.spec.ts`——V1 的「Top 清单」形态已被融合时间线取代，
 * 那条用例随形态一起搬了过去。
 */

const USAGE_TAB = "用量总览";
const PANEL_LABEL = "消耗日历（近 12 个月）";

async function openUsage(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: USAGE_TAB }).click();
  await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
}

/** 某个本地日历日（0=今天，1=昨天……）的 aria-label 前缀。 */
function dayLabelPrefix(daysAgo: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 一个天格按钮（按 aria-label 的日期前缀定位——每个格子的名唯一）。 */
function dayCell(page: Page, daysAgo: number) {
  return page.locator(
    `[data-usage-calendar] [data-probe="calendar-day"][aria-label^="${dayLabelPrefix(daysAgo)}"]`
  );
}

/** `#rrggbb` → 计算样式的 rgb 文本（与 backgroundColor 的序列化同形）。 */
function hexToRgbText(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

/** 计算样式里的自定义令牌值（custom property 不被解析，原样返回）。 */
async function rootToken(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name
  );
}

async function overflowOf(page: Page): Promise<{ doc: number[]; main: number[] }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main");
    return {
      doc: [doc.scrollWidth, doc.clientWidth],
      main: main ? [main.scrollWidth, main.clientWidth] : [0, 0]
    };
  });
}

test.describe("消耗日历", () => {
  test.use({ scenario: calendarScenario() });

  test("365 个天格、53 列（12~13 个月份标签）、星期行周一先行", async ({ page }) => {
    await openUsage(page);

    const panel = page.getByRole("region", { name: PANEL_LABEL });
    await expect(panel).toBeVisible();

    const table = page.getByRole("table", { name: PANEL_LABEL });
    await expect(table).toBeVisible();
    await expect(table.locator('[data-probe="calendar-day"]')).toHaveCount(365);
    const monthMarks = table.locator('th[scope="col"]');
    const monthCount = await monthMarks.count();
    expect(monthCount).toBeGreaterThanOrEqual(12);
    expect(monthCount).toBeLessThanOrEqual(13);
    // 365 天格 + 6 pad = 371 个 td；星期行 rowheader 从「一」开始。
    await expect(table.locator("td")).toHaveCount(371);
    const rowHeaders = await table.locator('th[scope="row"]').allTextContents();
    expect(rowHeaders.slice(1)).toEqual(["一", "二", "三", "四", "五", "六", "日"]);
    // 今天格唯一（挂在 td 上，不挤占 calendar-day 的 365 计数）。
    await expect(page.locator('[data-probe="calendar-today"]')).toHaveCount(1);
  });

  test("档位着色真算：最大成本天 4 档、空天 0 档，计算值与令牌解析值逐字节相等", async ({
    page
  }) => {
    await openUsage(page);

    // 昨天：4 会话合计 4M tok（$12）＝ 全窗最大成本 → 4 档。
    const yesterday = dayCell(page, 1);
    await expect(yesterday).toHaveAttribute("data-cal-level", "4");
    const cal4 = await rootToken(page, "--cal-4");
    expect(cal4).toMatch(/^#[0-9a-f]{6}$/);
    const yesterdayBg = await yesterday.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(yesterdayBg).toBe(hexToRgbText(cal4));

    // 15 天前：夹具没有活动 → 0 档（空格 = --bg-inset）。
    const empty = dayCell(page, 15);
    await expect(empty).toHaveAttribute("data-cal-level", "0");
    const inset = await rootToken(page, "--bg-inset");
    const emptyBg = await empty.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(emptyBg).toBe(hexToRgbText(inset));

    // 图例 5 格与格子同一套令牌（含 0 档）。
    const legend = page.locator("[data-cal-legend]");
    await expect(legend.locator("[data-legend-level]")).toHaveCount(5);
  });

  test("点今天格展开 / 再点收起：aria-expanded 两个方向都被跟踪", async ({ page }) => {
    // 展开区的**形态**断言（摘要六项、时间线条数、几何、点击开会话）在
    // day-review.spec.ts；这里只保留 V1 就有的「格子 → 展开区」开合闭环，
    // 它验证的是 aria-expanded 的状态机，与展开区长什么样无关。
    await openUsage(page);

    const todayCell = page.locator('[data-probe="calendar-today"] button');
    await expect(todayCell).toHaveAttribute("aria-expanded", "false");
    await todayCell.click();
    await expect(todayCell).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-calendar-sessions]")).toBeVisible();

    await todayCell.click();
    await expect(todayCell).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("[data-calendar-sessions]")).toHaveCount(0);
  });

  test("滚动收在日历容器内：窄视口下容器横向滚、文档与 main 都不溢出", async ({ page }) => {
    // 800 宽（内容区约 726px）< 网格固有宽（≈816px）：容器必然横向滚。
    // 用量页自身没有侧栏（那是会话分析页的），960 视口下内容区其实放得下
    // 网格——滚动收容机制要在更窄的视口上验证。
    await page.setViewportSize({ width: 800, height: 720 });
    await openUsage(page);

    const calendar = page.locator("[data-usage-calendar]");
    await expect(calendar).toBeVisible();
    const containerBox = await calendar.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX
    }));
    expect(containerBox.scrollWidth).toBeGreaterThan(containerBox.clientWidth);
    expect(containerBox.overflowX).toBe("auto");

    const { doc, main } = await overflowOf(page);
    expect(doc[0]).toBeLessThanOrEqual(doc[1] + 1);
    expect(main[0]).toBeLessThanOrEqual(main[1] + 1);
  });

  test("130% 字号下文档仍无横向溢出、月份标签不裁", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-font-scale", "1.3");
    });
    await page.setViewportSize({ width: 960, height: 720 });
    await openUsage(page);

    expect(await rootToken(page, "--font-scale")).toBe("1.3");
    const { doc, main } = await overflowOf(page);
    expect(doc[0]).toBeLessThanOrEqual(doc[1] + 1);
    expect(main[0]).toBeLessThanOrEqual(main[1] + 1);
    // 标签不裁：月份标签行的高度跟 --lh-xs 走（16 × 1.3 = 20.8px），
    // 文本完整在场（jsdom 量不了裁切，这里用真实引擎量行高）。
    const monthRowHeight = await page
      .locator(`[data-usage-calendar] th[scope="col"]`)
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(monthRowHeight).toBeGreaterThan(20);
  });

  test("高对比度档：色带换到 HC 取值、格子拿到 1px 描边（浅 / 深各抽）", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-contrast", "high");
    });
    await openUsage(page);

    expect(await rootToken(page, "--cal-1")).toBe("#c1d1f6");
    const hcBorder = await dayCell(page, 1).evaluate((el) => getComputedStyle(el).borderWidth);
    expect(Number.parseFloat(hcBorder)).toBeGreaterThanOrEqual(1);
  });

  test("高对比度深色：--cal-1 换深色 HC 取值，描边同样在场", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-contrast", "high");
      window.localStorage.setItem("cca-theme", "dark");
    });
    await openUsage(page);

    expect(await rootToken(page, "--cal-1")).toBe("#31407a");
    const hcBorder = await dayCell(page, 1).evaluate((el) => getComputedStyle(el).borderWidth);
    expect(Number.parseFloat(hcBorder)).toBeGreaterThanOrEqual(1);
  });

  // 「一年洞察」（Round V3 / #199）：图例之下的六句实事。夹具布景账
  // （calendarScenario，§0）：有成本天 = now−300 / −200 / −100 / −30 / −8 /
  // −1 / 0 共 7 天；最长连胜 2 天（昨天到今天）、最贵一天 $12.00（昨天 4 会话
  // 合计 4M tok）、最长空白 99 天（now−199..−101 与前一段并列，取最近）。
  // 日期随运行日漂移——断句子的稳定前缀与数字段，不断整句；环比的值随夹具
  // 活动日落进哪个月漂移，只断结构（数学由单测的固定 now 钉死）。
  test("一年洞察：六句键序与确定值（最长连胜 / 最贵一天 / 最长空白 / 活跃占比 / 当前连胜）", async ({
    page
  }) => {
    await openUsage(page);

    const insights = page.locator('[data-probe="calendar-insights"]');
    await expect(insights).toBeVisible();
    await expect(insights).toHaveAttribute("aria-label", "一年洞察");

    const items = insights.locator('[data-probe="calendar-insight-item"]');
    await expect(items).toHaveCount(6);
    const keys = await items.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).getAttribute("data-insight-key"))
    );
    expect(keys).toEqual([
      "longest-streak",
      "current-streak",
      "peak-day",
      "longest-gap",
      "active-share",
      "month-compare"
    ]);

    const text = (await insights.textContent()) ?? "";
    expect(text).toContain("最长连胜 2 天");
    // 夹具今天有会话（$3.45）→ current-streak 落在 active 态。
    expect(text).toContain("当前连胜 2 天");
    expect(text).toContain("$12.00");
    expect(text).toContain("最长空白 99 天");
    expect(text).toContain("这一年 7/365 天有消耗（2%）");
    // 环比只断结构（五分支都含这两个词）。
    expect(text).toContain("本月前");
    expect(text).toContain("上月同期");
  });

  test("洞察下钻闭环：点最贵一天的日期按钮展开一日回望（昨天 5 会话）→ × 清除收起；空白端点不可点", async ({
    page
  }) => {
    await openUsage(page);

    // 最贵一天 = 昨天（$12.00）：日期按钮是句内唯一的 button，可访问名带年
    // 与「打开一日回望」的动作预告。
    const dateButton = page.locator('[data-insight-key="peak-day"] button');
    await expect(dateButton).toHaveCount(1);
    await expect(dateButton).toHaveAttribute("aria-label", `${dayLabelPrefix(1)} · 打开一日回望`);
    await dateButton.click();

    const sessions = page.locator("[data-calendar-sessions]");
    await expect(sessions).toBeVisible();
    // 昨天的会话账：4 个 1M tok 的定档会话 + 跨午夜夹具会话的昨天段（23:40
    // 一条定标题的 user 记录，无 usage）→ 展开区头部是 5 个会话、$12.00 不变。
    await expect(sessions.getByText(/5 个会话/)).toBeVisible();
    await expect(dayCell(page, 1)).toHaveAttribute("aria-expanded", "true");

    // 「× 清除」收起（既有展开区的收起路径，不新增协议）。
    await page.getByRole("button", { name: "× 清除" }).click();
    await expect(page.locator("[data-calendar-sessions]")).toHaveCount(0);

    // 夹具的最长空白段（now−199..−101）两端都是真空白天（无会话）→ 纯文本
    // span，不是按钮（点了没有反馈的控件是坏交互）。
    await expect(page.locator('[data-insight-key="longest-gap"] button')).toHaveCount(0);
  });
});
