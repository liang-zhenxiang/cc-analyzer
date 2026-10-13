import type { Locator, Page } from "@playwright/test";
import { test, expect, calendarScenario } from "./fixtures";

/**
 * Issue #192「一日回望」的端到端覆盖：日历下钻展开区的日摘要 + 24 小时时间线，
 * 跑在生产构建产物上（Chromium + WebKit）。
 *
 * 数据来自 `calendarScenario()`（见 fixtures.ts）：今天 4 个会话（跨午夜 00:25 +
 * 09:20 / 13:05 / 18:40）、现在−2 的密集日 8 个会话、现在−3 的稀疏日 2 个会话，
 * 时刻都按**本地日历日的固定点**锚定，所以「条落在哪个比例位置」「哪个整点有块」
 * 是确定值，不随运行日期 / 时区漂移。
 *
 * 断言口径：几何一律**真算**——用轴首末刻度量出轨道列的左右边界，再拿横条
 * （`day-timeline-bar` 里的基线）的真实 `boundingBox` 反推比例，而不是读组件写下
 * 的百分比。悬停 / 可访问名逐字对照 §6.4 模板。
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

function dayCell(page: Page, daysAgo: number): Locator {
  return page.locator(
    `[data-usage-calendar] [data-probe="calendar-day"][aria-label^="${dayLabelPrefix(daysAgo)}"]`
  );
}

/** 展开今天格并等时间线落定（展开区是同一分支里的条件块）。 */
async function expandToday(page: Page): Promise<void> {
  await page.locator('[data-probe="calendar-today"] button').click();
  await expect(page.locator('[data-probe="day-summary"]')).toBeVisible();
  await expect(page.locator('[data-probe="day-timeline"]')).toBeVisible();
}

/** 某个摘要项的「值行」（innerText 的最后一行）。 */
async function summaryValue(page: Page, key: string): Promise<string> {
  const text = await page
    .locator(`[data-probe="day-summary-item"][data-summary-key="${key}"]`)
    .innerText();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * 时间线的一行按钮里的基线（`.rail`）。轨道是行内唯一带 `aria-hidden` 且自身含
 * 子 span 的容器（标签列的项目色点也带 `aria-hidden`，但没有子 span，会被这条
 * `> span` 过滤掉）；基线是轨道的**第一个**子 span（其次是逐小时密度块）。
 * 基线没有 data-probe，几何断言只能这样落到它身上——行按钮本身是整行宽，
 * 量的是行不是条。
 */
function railOf(row: Locator): Locator {
  return row.locator('span[aria-hidden="true"] > span').first();
}

/**
 * 轨道列的左右边界：轴首刻度 `00:00` 贴左对齐（`transform: none`），其左边缘就是
 * 轨道左边界；末刻度 `24:00` 贴右对齐（`right: 0`），其右边缘就是轨道右边界。
 * 两个刻度都是 `position: absolute` 的文本盒，量出来的边界是真实渲染值。
 */
async function trackBounds(page: Page): Promise<{ left: number; span: number }> {
  const ticks = page.locator('[data-probe="day-timeline-tick"]');
  const start = await ticks.first().boundingBox();
  const end = await ticks.last().boundingBox();
  if (!start || !end) throw new Error("轴刻度不在场，量不到轨道边界");
  const left = start.x;
  const right = end.x + end.width;
  return { left, span: right - left };
}

/** `#rrggbb` → 计算样式的 rgb 文本（与 backgroundColor 的序列化同形）。 */
function hexToRgbText(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

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

/** `HH:MM` 时刻占一整天的比例（分钟 / 1440）。 */
function minuteFraction(hour: number, minute: number): number {
  return (hour * 60 + minute) / (24 * 60);
}

test.describe("一日回望", () => {
  test.use({ scenario: calendarScenario() });

  test("展开今天格：六个摘要项、四条时间线、九个刻度、行序起点升序", async ({ page }) => {
    await openUsage(page);
    await expandToday(page);

    // 展开区头部沿用「日期 · N 个会话」的 V1 形态，N 从 3 → 4（多一条跨午夜）。
    await expect(page.locator("[data-calendar-sessions]")).toContainText("4 个会话");

    // 摘要恰 6 项，键与顺序写死（契约）。值是夹具决定的确定值。
    const summaryKeys = await page
      .locator('[data-probe="day-summary-item"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-summary-key")));
    expect(summaryKeys).toEqual(["cost", "sessions", "messages", "span", "model", "projects"]);
    expect(await summaryValue(page, "cost")).toBe("$3.45 · 1.1M tok");
    expect(await summaryValue(page, "sessions")).toBe("4");
    expect(await summaryValue(page, "messages")).toBe("9");
    expect(await summaryValue(page, "span")).toBe("00:25–18:41");
    expect(await summaryValue(page, "model")).toBe("Sonnet 4");
    expect(await summaryValue(page, "projects")).toBe("4");
    // 成本项的 title 带定价快照日期（不要在测试里钉死日期，只钉首尾话术）。
    await expect(
      page.locator('[data-probe="day-summary-item"][data-summary-key="cost"]')
    ).toHaveAttribute("title", /^当日估算成本 \$3\.45（定价快照 .+）；token 合计 1\.1M，读自本机日志$/);

    // 时间线容器声明会话数 = 4，实测横条也是 4 条（数量 === 会话数）。
    const timeline = page.locator('[data-probe="day-timeline"]');
    await expect(timeline).toHaveAttribute("data-session-count", "4");
    await expect(page.locator('[data-probe="day-timeline-bar"]')).toHaveCount(4);
    await expect(page.locator('[data-probe="day-timeline-list"]')).toHaveCount(1);

    // 轴：恰 9 个刻度，文本 00:00 … 24:00。
    const ticks = page.locator('[data-probe="day-timeline-tick"]');
    await expect(ticks).toHaveCount(9);
    expect(await ticks.allTextContents()).toEqual([
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

    // 可访问名：行区 `<ol>` 是「M月D日会话时间线」，展开区 `<section>` 沿用 V1。
    const now = new Date();
    const shortDate = `${now.getMonth() + 1}月${now.getDate()}日`;
    await expect(page.getByRole("list", { name: `${shortDate}会话时间线` })).toHaveCount(1);
    await expect(page.getByRole("region", { name: PANEL_LABEL })).toBeVisible();
    await expect(page.locator(`[data-calendar-sessions][aria-label="${shortDate}会话清单"]`)).toHaveCount(1);

    // 行序 = 起点升序（跨午夜 00:25 打头，其余按 09:20 / 13:05 / 18:40）。
    const starts = await page.locator('[data-probe="day-timeline-bar"]').evaluateAll((nodes) =>
      nodes.map((node) => {
        const label = node.getAttribute("title") ?? "";
        const match = /· (\d\d:\d\d)–(\d\d:\d\d) ·/.exec(label);
        return match ? match[1] : "";
      })
    );
    expect(starts).toEqual(["00:25", "09:20", "13:05", "18:40"]);
  });

  test("时间线几何真算：条位置贴合本地时刻占 24h 的比例，极短会话仍可见", async ({ page }) => {
    await openUsage(page);
    await expandToday(page);

    const { left, span } = await trackBounds(page);
    const rows = page.locator('[data-probe="day-timeline-bar"]');

    // 首行是跨午夜那条（00:25–01:10）：起点比例 = 25/1440，宽度比例 = 45/1440。
    const cross = rows.first();
    await expect(cross).toHaveAttribute("data-cross-day", "true");
    const crossRail = await railOf(cross).boundingBox();
    if (!crossRail) throw new Error("跨午夜行没有基线");
    expect((crossRail.x - left) / span).toBeCloseTo(minuteFraction(0, 25), 2);
    expect(crossRail.width / span).toBeCloseTo(45 / (24 * 60), 2);

    // 09:20 那条：起点比例 = (9×60+20)/1440 ≈ 0.3889。
    const at0920 = rows.nth(1);
    const rail0920 = await railOf(at0920).boundingBox();
    if (!rail0920) throw new Error("09:20 行没有基线");
    expect((rail0920.x - left) / span).toBeCloseTo(minuteFraction(9, 20), 2);
    // 极短会话（两条记录相隔 90s）：真实跨度不足 1px，靠 `min-width: 3px` 兜底可见。
    expect(rail0920.width).toBeGreaterThanOrEqual(3);
  });

  test("悬停 / 可访问名逐字：与设计 §6.4 模板相等（含占比）", async ({ page }) => {
    await openUsage(page);
    await expandToday(page);

    const rows = page.locator('[data-probe="day-timeline-bar"]');
    // 首行跨午夜（末尾追加「· 跨天」）。
    await expect(rows.first()).toHaveAttribute(
      "title",
      "打开会话：跨午夜夹具会话 13（项目：calendar-13）· 00:25–01:10 · 时长 45m0s · 当日消耗 $0.45 · 150,000 tok · 占当日 13.0% · 跨天"
    );
    await expect(rows.first()).toHaveAttribute(
      "aria-label",
      "打开会话：跨午夜夹具会话 13（项目：calendar-13）· 00:25–01:10 · 时长 45m0s · 当日消耗 $0.45 · 150,000 tok · 占当日 13.0% · 跨天"
    );
    // 09:20 那条与设计样例同形（占比 600K / 1.15M = 52.2%）。
    await expect(rows.nth(1)).toHaveAttribute(
      "title",
      "打开会话：消耗日历夹具会话 10（项目：calendar-10）· 09:20–09:21 · 时长 1m30s · 当日消耗 $1.80 · 600,000 tok · 占当日 52.2%"
    );
    await expect(rows.nth(2)).toHaveAttribute(
      "title",
      "打开会话：消耗日历夹具会话 11（项目：calendar-11）· 13:05–13:06 · 时长 1m30s · 当日消耗 $0.90 · 300,000 tok · 占当日 26.1%"
    );
    await expect(rows.nth(3)).toHaveAttribute(
      "title",
      "打开会话：消耗日历夹具会话 12（项目：calendar-12）· 18:40–18:41 · 时长 1m30s · 当日消耗 $0.30 · 100,000 tok · 占当日 8.7%"
    );

    // 逐小时密度块的 title：`HH:00–HH+1:00 · N 条记录`。
    const block = rows.nth(1).locator('[data-probe="day-timeline-density"]').first();
    await expect(block).toHaveAttribute("title", "09:00–10:00 · 2 条记录");
  });

  test("点时间线首行（起点最早）真的打开那个会话", async ({ page }) => {
    await openUsage(page);
    await expandToday(page);

    // 首行 = 起点最早的跨午夜会话（V1 的「按成本 Top 排序首行」已换成时间序）。
    await page.locator('[data-probe="day-timeline-bar"]').first().click();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话信息").locator("strong")).toHaveText("跨午夜夹具会话 13");
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
  });

  test("跨午夜行：标记、文本「跨天」、可访问名与条位置都落在当天段", async ({ page }) => {
    await openUsage(page);
    await expandToday(page);

    const cross = page.locator('[data-probe="day-timeline-bar"][data-cross-day="true"]');
    await expect(cross).toHaveCount(1);
    await expect(cross).toContainText("跨天");
    await expect(cross).toHaveAttribute("title", / · 跨天$/);
    // 条贴左边缘：起点 00:25（比例 ≈ 0.0174），只画落在今天的那一段。
    const { left, span } = await trackBounds(page);
    const rail = await railOf(cross).boundingBox();
    if (!rail) throw new Error("跨午夜行没有基线");
    expect((rail.x - left) / span).toBeCloseTo(minuteFraction(0, 25), 2);

    // 非跨天行没有跨天标记。
    const others = page.locator('[data-probe="day-timeline-bar"]:not([data-cross-day])');
    await expect(others).toHaveCount(3);
  });

  test("项目色键：≥2 项目时在场，色点按 token 降序取 1..N", async ({ page }) => {
    await openUsage(page);
    await expandToday(page);

    const key = page.locator('[data-probe="day-project-key"]');
    await expect(key).toHaveCount(1);
    const items = key.locator("li");
    await expect(items).toHaveCount(4);
    // 600K / 300K / 150K / 100K → calendar-10 / 11 / 13 / 12，色档 1..4。
    await expect(items).toHaveText(["calendar-10", "calendar-11", "calendar-13", "calendar-12"]);
    expect(
      await key
        .locator("[data-probe='day-project-dot']")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-project-index")))
    ).toEqual(["1", "2", "3", "4"]);
    // 行内色点与色键同档：09:20 那条是色档 1。
    await expect(
      page.locator('[data-probe="day-timeline-bar"]').nth(1).locator("[data-probe='day-project-dot']")
    ).toHaveAttribute("data-project-index", "1");
  });

  test("密集日（现在−2）：8 条会话、行区内部竖滚", async ({ page }) => {
    await openUsage(page);
    await dayCell(page, 2).click();
    await expect(page.locator('[data-probe="day-timeline"]')).toBeVisible();

    await expect(page.locator('[data-probe="day-timeline"]')).toHaveAttribute(
      "data-session-count",
      "8"
    );
    await expect(page.locator('[data-probe="day-timeline-bar"]')).toHaveCount(8);
    const list = await page.locator('[data-probe="day-timeline-list"]').evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY
    }));
    // 8 行 × 24px = 192px > max-height 144px → 行区内部竖滚，不外溢。
    expect(list.overflowY).toBe("auto");
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  });

  test("稀疏日（现在−3）：只有两个整点有活动块", async ({ page }) => {
    await openUsage(page);
    await dayCell(page, 3).click();
    await expect(page.locator('[data-probe="day-timeline"]')).toBeVisible();

    await expect(page.locator('[data-probe="day-timeline-bar"]')).toHaveCount(2);
    const titles = await page
      .locator('[data-probe="day-timeline-density"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title") ?? ""));
    const hours = new Set(titles.map((title) => title.slice(0, 2)));
    expect([...hours].sort()).toEqual(["08", "14"]);
    // 每个块都带「该小时记录条数」——夹具两个会话各 2 条。
    expect(titles.every((title) => / · 2 条记录$/.test(title))).toBe(true);
  });

  test("滚动收在时间线容器内：窄视口下容器横向滚、文档与 main 不溢出", async ({ page }) => {
    // 内容最小宽 800px；960 视口的内容区（≈884px）装得下，会「不滚」——
    // 把视口收到 800，内容区（≈724px）才真的放不下，滚动收容在这里才被考验。
    await page.setViewportSize({ width: 800, height: 720 });
    await openUsage(page);
    await expandToday(page);

    const timeline = await page.locator('[data-probe="day-timeline"]').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX
    }));
    expect(timeline.scrollWidth).toBeGreaterThan(timeline.clientWidth);
    expect(timeline.overflowX).toBe("auto");

    const { doc, main } = await overflowOf(page);
    expect(doc[0]).toBeLessThanOrEqual(doc[1] + 1);
    expect(main[0]).toBeLessThanOrEqual(main[1] + 1);
  });

  test("130% 字号 + 高对比度：令牌解析上色、切档几何逐像素不变", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 720 });
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-font-scale", "1.3");
      window.localStorage.setItem("cca-contrast", "high");
    });
    await openUsage(page);
    await expandToday(page);

    expect(await rootToken(page, "--font-scale")).toBe("1.3");
    const contrast = await page.evaluate(() => document.documentElement.getAttribute("data-contrast"));
    expect(contrast).toBe("high");

    // 放大字号后文档 / main 仍无横向溢出。
    const { doc, main } = await overflowOf(page);
    expect(doc[0]).toBeLessThanOrEqual(doc[1] + 1);
    expect(main[0]).toBeLessThanOrEqual(main[1] + 1);

    // 色档 1 的行（09:20 那条）的基线颜色 === --chart-1 的解析值（零特判：走令牌）。
    const row = page.locator('[data-probe="day-timeline-bar"]').nth(1);
    const rail = railOf(row);
    const chart1 = await rootToken(page, "--chart-1");
    expect(chart1).toMatch(/^#[0-9a-f]{6}$/);
    expect(await rail.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      hexToRgbText(chart1)
    );

    // 切回普通档（去掉根上的 data-contrast）后，同一行的矩形逐像素不变。
    const before = await row.boundingBox();
    const railBefore = await rail.boundingBox();
    await page.evaluate(() => document.documentElement.removeAttribute("data-contrast"));
    const after = await row.boundingBox();
    const railAfter = await rail.boundingBox();
    if (!before || !after || !railBefore || !railAfter) throw new Error("行矩形量不到");
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(railAfter.x - railBefore.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(railAfter.width - railBefore.width)).toBeLessThanOrEqual(0.5);
    // 反向校验：颜色确实换了（换档真的生效，不是两边都没上色）。
    expect(await rail.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
      hexToRgbText(chart1)
    );
  });
});
