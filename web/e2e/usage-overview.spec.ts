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

/** KPI 数值断言的作用域：裸数字会撞上热力图的时刻刻度，先圈进读数瓦片。 */
function kpiTile(page: Page, label: string) {
  return page.getByLabel(DASHBOARD).getByText(label, { exact: true }).locator("..");
}

test.describe("用量总览", () => {
  test("切到标签后 KPI 读数与 provenance 徽章齐全", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    await expect(page.getByRole("tab", { name: DASHBOARD })).toHaveAttribute("aria-selected", "true");

    const dashboard = page.getByLabel(DASHBOARD);
    await expect(dashboard).toBeVisible();

    // KPI：tokens / 会话 / 消息读自日志，成本按快照估算并带快照日期。
    await expect(dashboard.getByText("246,130")).toBeVisible();
    await expect(kpiTile(page, "消息数").getByText("16", { exact: true })).toBeVisible();
    await expect(kpiTile(page, "会话数").getByText("2", { exact: true })).toBeVisible();
    // 计费窗口卡的「窗口开启」也标「读自日志」，按 KPI 行作用域数 3 枚。
    await expect(dashboard.locator("div[class*='kpiRow']").getByText("读自日志")).toHaveCount(3);
    await expect(dashboard.getByText("按定价快照估算")).toBeVisible();
    await expect(dashboard.getByText(/快照日期 \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(dashboard.getByText(/\$\d+\.\d{2}/)).toBeVisible();
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
    await expect(projects).toContainText("-repo-usage-days");
    await expect(projects).toContainText("-repo-usage-models");

    await expect(page.getByRole("img", { name: "按模型分布" })).toBeVisible();
    // 堆叠条下面的图例把模型名写成可读文本（exact：svg 的 title 也含模型名）。
    await expect(dashboard.getByText("claude-opus-4-1-20250805", { exact: true })).toBeVisible();

    await expect(page.getByRole("img", { name: "活跃时段热力图" })).toBeVisible();
  });

  test("扫描完成后进度行收口为统计口径", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();

    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/已分析/)).toHaveCount(0);
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
