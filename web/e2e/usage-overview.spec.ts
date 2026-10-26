import type { Page } from "@playwright/test";
import { test, expect, emptyScenario, recentActivityScenario } from "./fixtures";

/**
 * 用量总览的端到端覆盖：切标签、KPI 读数、provenance 徽章、
 * 时间范围切换改变柱数、分布与热力图渲染、空场景引导。
 *
 * 场景经过 `recentActivityScenario` 时间平移（见 fixtures.ts 的注释）：
 * 窗内只有两个 usage 夹具，所有计数都是确定值——
 * 10 + 6 条消息、246,130 tokens（四类合计）、2 个会话。
 */

const DASHBOARD = "用量总览";

test.use({ scenario: recentActivityScenario() });

function trendBars(page: Page) {
  return page
    .getByRole("img", { name: "每日 Token 消耗趋势" })
    .locator("rect");
}

/** KPI 数值断言的作用域：裸数字会撞上热力图的时刻刻度，先圈进读数瓦片；
 * Round CC 起周战报表也有「消息数」等行标签，所以先收进 KPI 行再找瓦片。 */
function kpiTile(page: Page, label: string) {
  return page
    .getByLabel(DASHBOARD)
    .locator("div[class*='kpiRow']")
    .getByText(label, { exact: true })
    .locator("..");
}

test.describe("用量总览", () => {
  test("切到标签后 KPI 读数与 provenance 徽章齐全", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    await expect(page.getByRole("tab", { name: DASHBOARD })).toHaveAttribute("aria-selected", "true");

    const dashboard = page.getByLabel(DASHBOARD);
    await expect(dashboard).toBeVisible();

    // KPI：tokens / 会话 / 消息读自日志，成本按快照估算并带快照日期。
    // 246,130 同时是周层「滚动 7 天」的消耗（同一份日志），圈进 KPI 瓦片再断言。
    await expect(kpiTile(page, "Tokens 总量").getByText("246,130")).toBeVisible();
    await expect(kpiTile(page, "消息数").getByText("16", { exact: true })).toBeVisible();
    await expect(kpiTile(page, "会话数").getByText("2", { exact: true })).toBeVisible();
    // 计费窗口卡的「窗口开启」也标「读自日志」，按 KPI 行作用域数 3 枚。
    await expect(dashboard.locator("div[class*='kpiRow']").getByText("读自日志")).toHaveCount(3);
    // 「按定价快照估算」四枚：KPI 的估算成本瓦片、消耗日历的色深口径徽章，
    // 加上 Round CC 的周战报与项目卡片两个面板头（整块面板共一枚，不是每行/每卡一枚）。
    // exact 只数档位本身；周战报那枚的 detail 是另一段文字（「成本按定价快照估算」），
    // 不该被算成第二枚徽章。
    await expect(dashboard.getByText("按定价快照估算", { exact: true })).toHaveCount(4);
    await expect(dashboard.getByText(/快照日期 \d{4}-\d{2}-\d{2}/)).toBeVisible();
    // 金额读数：KPI 瓦片与（Round V3 起）一年洞察句都带 $ 金额，first() 恒落在
    // KPI 的那一枚（KPI 行在 DOM 中先于日历面板）。
    await expect(dashboard.getByText(/\$\d+\.\d{2}/).first()).toBeVisible();
  });

  test("时间范围切换改变趋势柱数", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();

    // 默认 30 天（零填充的天也有柱），切 7 天后是 7 根。
    await expect(trendBars(page)).toHaveCount(30);
    await page.getByRole("tab", { name: "近 7 天" }).click();
    await expect(trendBars(page)).toHaveCount(7);
    await expect(page.getByRole("tab", { name: "近 7 天" })).toHaveAttribute("aria-selected", "true");
  });

  test("Token 类别切换后趋势图仍在且徽章语义不变", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    await expect(trendBars(page)).toHaveCount(30);

    await page.getByRole("tab", { name: "缓存读取" }).click();
    await expect(page.getByRole("tab", { name: "缓存读取" })).toHaveAttribute("aria-selected", "true");
    await expect(trendBars(page)).toHaveCount(30);
  });

  test("按项目与按模型分布、活跃时段热力图都有内容", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    const dashboard = page.getByLabel(DASHBOARD);

    const projects = page.getByRole("img", { name: "按项目分布" });
    await expect(projects).toBeVisible();
    // 坐标轴上印的是会话真实 cwd 的末段，不是编码过的目录名。
    await expect(projects).toContainText("usage-days");
    await expect(projects).toContainText("usage-models");
    await expect(projects).not.toContainText("-repo-usage-days");

    await expect(page.getByRole("img", { name: "按模型分布" })).toBeVisible();
    // 图例印「家族 + 版本」，原始 model id 收进 title（exact：svg 的 title 里也带着它）。
    await expect(dashboard.getByText("Opus 4.1", { exact: true })).toBeVisible();
    await expect(dashboard.getByTitle("claude-opus-4-1-20250805").first()).toBeVisible();

    await expect(page.getByRole("img", { name: "活跃时段热力图" })).toBeVisible();
  });

  test("扫描完成后进度行收口为统计口径", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();

    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/已分析/)).toHaveCount(0);
  });

  test("1440×900 首屏有周战报与会话对比，项目卡片滚动可达", async ({ page }) => {
    // Round DD 起用量页在 KPI 之后插入了「周战报」与「会话对比」两行；实测
    // 1440×900 首屏（main 高 852）完整可见的是这两块——「按项目分布」被推到
    // 1012px、项目卡片 1249px，都要滚一次才可达，所以首屏断言改成这两块，
    // 项目卡片仍断「滚到后整块可见」。
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });

    // 「不滚动」要成立：主区必须还在顶端（内容区在自己的滚动容器里）。
    const main = page.locator("main");
    expect(await main.evaluate((element) => element.scrollTop)).toBe(0);

    await expect(page.getByRole("heading", { name: "周战报" })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("heading", { name: "会话对比" })).toBeInViewport({ ratio: 1 });

    const cards = page.getByRole("heading", { name: "项目卡片" });
    await cards.scrollIntoViewIfNeeded();
    const scrolled = await main.evaluate((element) => ({
      top: element.scrollTop,
      view: element.clientHeight
    }));
    expect(scrolled.top).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "按项目分布" })).toBeInViewport({ ratio: 1 });
    await expect(cards).toBeInViewport({ ratio: 1 });
  });

  test("滚到下半屏后各面板的标题仍然可达", async ({ page }) => {
    // 截图脚本负责「把下半屏拍下来」（usage-below 视图），这条负责「有人断言过」：
    // 标题滚一次就能进视口 = 面板内容离首屏不超过一屏。面板被懒加载吞掉、或
    // 页面重新长过一屏（标题滚到底也回不来）都会在这里红。
    // 「按项目分布」在首屏（上一条已断言）；页面变长后滚到底，第一行会越过
    // 视口上缘（途中已见过），这里断言的是第二屏以下的面板。
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });

    const main = page.locator("main");
    await main.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    // 断言「滚到位」本身：滚不动了才算到底，否则后面的是非判断建立在过渡态上。
    const settled = await main.evaluate((element) => ({
      top: element.scrollTop,
      height: element.scrollHeight,
      view: element.clientHeight
    }));
    expect(settled.top + settled.view).toBeGreaterThanOrEqual(settled.height - 1);

    // Round CC 加了三块整行面板：日历被项目卡片推到第二屏，流向图在模型分布之后，
    // 周战报在页面顶部。这里逐个滚到它面前再断言整块可见——「滚一次可达」比
    // 「滚到底时还在视口里」更贴合产品承诺，也不因页面变长而误红。
    for (const title of [
      "按模型分布",
      "活跃时段（周 × 小时）",
      "工具与 skill",
      "消耗日历（近 12 个月）",
      "Token 流向",
      "周战报"
    ]) {
      const heading = page.getByRole("heading", { name: title });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeInViewport({ ratio: 1 });
    }
  });

  test("切到用量页再切回分析页，内容左缘不变", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
    const usage = await page.getByLabel(DASHBOARD).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });

    await page.getByRole("tab", { name: "会话分析", exact: true }).click();
    // 分析页的根是 <div class="page">，用量页的根是 <section>——两者都直接挂在
    // 主区下，比的正是「页面容器的左缘与宽度」。
    const analyzer = await page.locator("main > *").first().evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    });

    expect(Math.abs(usage.left - analyzer.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(usage.width - analyzer.width)).toBeLessThanOrEqual(1);
  });
});

test.describe("用量总览 · 空场景", () => {
  test.use({ scenario: emptyScenario() });

  test("没有会话时给出指向会话扫描的引导", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();

    await expect(page.getByText("还没有可统计的会话")).toBeVisible();
    await expect(page.getByLabel(DASHBOARD)).toHaveCount(0);
  });
});
