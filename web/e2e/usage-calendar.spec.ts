import type { Page } from "@playwright/test";
import { test, expect, calendarScenario, dayViewScenario } from "./fixtures";

/**
 * Issue #187「消耗日历」的端到端覆盖，跑在生产构建产物上（Chromium + WebKit）。
 *
 * 数据来自 `calendarScenario()`（见 fixtures.ts）：内存合成、时间戳相对
 * `Date.now()` 按本地日历日锚定，所以「哪天是几档、今天有几个会话」是确定值。
 *
 * 主线：365 天格 + 53 列几何；档位着色真算（计算样式 vs 令牌解析值，不是文本
 * 匹配）；点击今天格展开当天会话 Top 清单、行点击真的打开会话；滚动收在日历
 * 容器内部（960 视口下文档 / main 不横向溢出）；130% 字号与高对比度两档换挡。
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

  test("点击今天格展开当天 Top 会话，行点击真的打开那个会话", async ({ page }) => {
    await openUsage(page);

    const todayCell = page.locator('[data-probe="calendar-today"] button');
    await expect(todayCell).toHaveAttribute("aria-expanded", "false");
    await todayCell.click();

    const detail = page.locator("[data-calendar-sessions]");
    await expect(detail).toBeVisible();
    // 夹具今天 3 个会话（600K / 300K / 100K）。头部文案升格为整块的名字
    // （Issue #192：清单只是展开区的一段）；行按列表自身的可访问名圈定
    // （今天日期拼进名字——归因面板的列表也叫「消耗最多的会话」，模糊匹配会撞），
    // 「× 清除」是头部按钮、不数进行。
    await expect(detail.getByText(/共 3 个会话/)).toBeVisible();
    const now = new Date();
    const rows = page
      .getByRole("list", { name: `${now.getMonth() + 1}月${now.getDate()}日消耗最多的会话` })
      .getByRole("button");
    await expect(rows).toHaveCount(3);
    // 行读数是「$X · N tok」双数：600,000 tok × $3/MTok = $1.80。
    await expect(rows.first()).toContainText("$1.80 · 600,000 tok");

    // 行点击 → 会话分析，当前会话与行标题逐字一致。
    await rows.first().click();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话信息").locator("strong")).toHaveText("消耗日历夹具会话 10");
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
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
});

/**
 * 一日回望（Issue #192）：dayViewScenario 在 calendarScenario 之上追加文件
 * （sessionId 13 起），今天的会话总数是确定值（原 3 + 追加 6 = 9）。档位着色
 * 断言仍由上一个 describe（原 calendarScenario）负责，两组各自 test.use、
 * 互不污染。
 */
test.describe("一日回望", () => {
  test.use({ scenario: dayViewScenario() });

  /** 展开今天格并等待时间线渲染，返回展开区定位器。 */
  async function openTodayDetail(page: Page) {
    await openUsage(page);
    await page.locator('[data-probe="calendar-today"] button').click();
    const detail = page.locator("[data-calendar-sessions]");
    await expect(detail).toBeVisible();
    await expect(detail.locator("[data-calendar-lanes]")).toBeVisible();
    return detail;
  }

  /** 今天 0 点起的真实天长（DST 天 23/25 小时，同组件坐标系）。 */
  function todaySpanMs(): number {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    return next.getTime() - start.getTime();
  }

  test("展开区三段结构：摘要行 / 时间线 / 清单都在，摘要含今天会话总数", async ({ page }) => {
    const detail = await openTodayDetail(page);

    // 头部升格为整块的名字；清单自己的可访问名不动（V1 按它定位）。
    const now = new Date();
    await expect(
      detail.getByText(`${now.getMonth() + 1}月${now.getDate()}日 · 共 9 个会话`)
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: `${now.getMonth() + 1}月${now.getDate()}日消耗最多的会话` })
    ).toBeVisible();

    // 摘要行全字段：原 3 + 追加 6 会话 = 9；token 2.61M × $3/MTok = $7.83
    // （显示层 formatTokenCount 对 ≥1M 取一位小数，2.61M 印作 "2.6M"）；
    // 消息 20 条；主力 Sonnet 4。口径脚注在场。
    const summary = detail.locator("[data-calendar-summary]");
    await expect(summary).toContainText("消耗 $7.83");
    await expect(summary).toContainText("2.6M tok");
    await expect(summary).toContainText("9 个会话");
    await expect(summary).toContainText("20 条消息");
    await expect(summary).toContainText("主力 Sonnet 4");
    await expect(detail).toContainText("时刻为本地时间");
  });

  test("时间线几何真算：left/W 差 <0.5%、instant 宽 ≥2、密度档位手算、并行三泳道", async ({ page }) => {
    const detail = await openTodayDetail(page);
    const lanes = detail.locator("[data-calendar-lanes]");

    await expect(lanes.locator('[data-probe="calendar-bar"]')).toHaveCount(9);

    const lanesLeft = await lanes.evaluate((el) => el.getBoundingClientRect().left);
    const lanesWidth = await lanes.evaluate((el) => el.getBoundingClientRect().width);
    const span = todaySpanMs();
    // 追加会话的时刻是确定的（todaySafe 三条依赖 now，不进本断言）。
    const densityBar = lanes.locator('[aria-label^="密度会话"]');
    const crossBar = lanes.locator('[aria-label^="跨午夜会话"]');
    const ratioOf = (bar: ReturnType<typeof lanes.locator>) =>
      bar.evaluate((el) => el.getBoundingClientRect().left);
    expect(((await ratioOf(densityBar)) - lanesLeft) / lanesWidth).toBeCloseTo(9 / 24, 2);
    // 跨午夜条起点 = 今天 00:30（30 分钟处的比例）。
    expect(((await ratioOf(crossBar)) - lanesLeft) / lanesWidth).toBeCloseTo(
      (30 * 60_000) / span,
      2
    );

    // 跨午夜条：今天侧单记录 → instant、最小可视宽 2px。
    await expect(crossBar).toHaveAttribute("data-instant", "true");
    const crossWidth = await crossBar.evaluate((el) => el.getBoundingClientRect().width);
    expect(crossWidth).toBeGreaterThanOrEqual(2);

    // 密度段档位：100K/400K/200K/800K 对 800K 归一 → ceil(v/max×4) =
    // 1/2/1/4（规格 §7.4 手写的 1/3/2/4 与 §2.3 公式矛盾，以公式为准）。
    const segHours = await densityBar
      .locator("[data-seg-hour]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-seg-hour")));
    const segLevels = await densityBar
      .locator("[data-seg-hour]")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-seg-level")));
    expect(segHours).toEqual(["9", "10", "11", "12"]);
    expect(segLevels).toEqual(["1", "2", "1", "4"]);

    // 并行三会话：三泳道 0/1/2，top 递增 24px（getComputedStyle 解析内联 calc）。
    const parallelBars = lanes.locator('[aria-label^="并行会话"]');
    await expect(parallelBars).toHaveCount(3);
    const parallelLanes = await parallelBars.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-lane"))
    );
    expect(parallelLanes).toEqual(["0", "1", "2"]);
    const parallelTops = await parallelBars.evaluateAll((els) =>
      els.map((el) => Number.parseFloat(getComputedStyle(el).top))
    );
    expect(parallelTops[1] - parallelTops[0]).toBeCloseTo(24, 5);
    expect(parallelTops[2] - parallelTops[1]).toBeCloseTo(24, 5);
  });

  test("悬停与点击：条 title 含起止与成本；点密度会话的条真的打开它", async ({ page }) => {
    const detail = await openTodayDetail(page);
    const densityBar = detail.locator('[aria-label^="密度会话"]');

    const title = await densityBar.getAttribute("title");
    expect(title).toContain("09:00–12:00");
    expect(title).toContain("$4.50");
    expect(title).toContain("1.5M tok");

    await densityBar.click();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话信息").locator("strong")).toHaveText("密度会话");
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
  });

  test("泳道有界且文档无横向溢出（时间线不设横向滚动）", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 720 });
    const detail = await openTodayDetail(page);

    const lanesHeight = await detail
      .locator("[data-calendar-lanes]")
      .evaluate((el) => el.clientHeight);
    // 下界同样要断：条全是 absolute 不撑容器，height 没按 laneCount 设时
    // clientHeight 恒 0——只断上界会放过这个回归（真机门禁抓到过）。
    expect(lanesHeight).toBeGreaterThanOrEqual(24);
    expect(lanesHeight).toBeLessThanOrEqual(7 * 24 + 2);

    const { doc, main } = await overflowOf(page);
    expect(doc[0]).toBeLessThanOrEqual(doc[1] + 1);
    expect(main[0]).toBeLessThanOrEqual(main[1] + 1);
  });

  test("高对比度：密度段实色（opacity 1）、条描边 ≥1px（浅色）", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-contrast", "high");
    });
    const detail = await openTodayDetail(page);

    const densityBar = detail.locator('[aria-label^="密度会话"]');
    const opacity = await densityBar
      .locator("[data-seg-hour]")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe("1");
    const borderWidth = await densityBar
      .locator("span")
      .first()
      .evaluate((el) => getComputedStyle(el).borderWidth);
    expect(Number.parseFloat(borderWidth)).toBeGreaterThanOrEqual(1);
  });

  test("高对比度深色：段同样实色（抽一）", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-contrast", "high");
      window.localStorage.setItem("cca-theme", "dark");
    });
    const detail = await openTodayDetail(page);

    const opacity = await detail
      .locator("[data-seg-hour]")
      .first()
      .evaluate((el) => getComputedStyle(el).opacity);
    expect(opacity).toBe("1");
  });

  test("键盘：Enter 展开 → Tab 进时间线第一条 → → 到第二条 → Enter 打开会话", async ({ page }) => {
    await openUsage(page);
    const todayCell = page.locator('[data-probe="calendar-today"] button');
    await todayCell.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-calendar-sessions]")).toBeVisible();

    // DOM 序：格子 → × 清除 → 时间线第一条（规格 §5.4 的 Tab 序把清除画在
    // 清单后，与 §1.2 五段结构的 DOM 顺序矛盾；按 DOM 落地，清除先遇）。
    await page.keyboard.press("Tab");
    await expect(page.locator("button", { hasText: "× 清除" })).toBeFocused();
    await page.keyboard.press("Tab");
    const firstBar = page.locator('[data-calendar-lanes] [tabindex="0"]');
    await expect(firstBar).toBeFocused();

    // → 移到第二条（时间序），Enter 打开它——真实引擎跑 roving。
    await page.keyboard.press("ArrowRight");
    const secondName = (await page
      .locator('[data-calendar-lanes] [tabindex="0"]')
      .getAttribute("aria-label"))!
      .split("（")[0];
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话信息").locator("strong")).toHaveText(secondName);
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
  });
});
