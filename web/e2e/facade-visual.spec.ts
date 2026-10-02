import type { Page } from "@playwright/test";
import { test, expect, recentActivityScenario } from "./fixtures";

/**
 * 门面两处硬伤的端到端回归：
 * 1. 用量总览的计费窗口表盘曾被 `.chart`（`width: 100%`）撑满整屏——它是
 *    README 首图，破损布局挂在门面上。
 * 2. 日志表右端列在窄窗口被硬切，且静止时没有任何「可横向滚动」的可见提示。
 *
 * 判据取几何而非像素：表盘边长有界且为正方形、末列右边界不越过容器右边界，
 * 这样界面重做也不会让断言变成恒真或恒假。
 */

const DASHBOARD = "用量总览";

async function openUsage(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: DASHBOARD }).click();
  await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
}

async function openFirstSession(page: Page) {
  await page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)").first().click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

async function logTableMetrics(page: Page) {
  return page.locator("table").first().evaluate((table) => {
    const container = table.parentElement as HTMLElement;
    const headers = Array.from(table.querySelectorAll("thead th"));
    const last = headers[headers.length - 1] as HTMLElement;
    const rect = container.getBoundingClientRect();
    return {
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
      lastRight: last.getBoundingClientRect().right,
      containerRight: rect.right
    };
  });
}

test.describe("门面 · 用量总览表盘尺寸", () => {
  test.use({ scenario: recentActivityScenario() });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1400, height: 872 },
    { width: 960, height: 640 }
  ]) {
    test(`表盘有界、正方形、不超出卡片 @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openUsage(page);

      const card = page.getByLabel("计费窗口", { exact: true });
      const gauge = card.getByRole("img", { name: /当前窗口/ });
      const box = await gauge.boundingBox();
      const cardBox = await card.boundingBox();
      expect(box).not.toBeNull();
      expect(cardBox).not.toBeNull();

      // 曾经是 1030×1030：有界（≤200）且正方形是回归防线。
      expect(box!.width).toBeLessThanOrEqual(200);
      expect(Math.abs(box!.width - box!.height)).toBeLessThanOrEqual(1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);
    });
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1400, height: 872 }
  ]) {
    test(`宽窗口下 KPI 读数行与趋势图落在首屏 @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openUsage(page);
      await expect(page.getByText("Tokens 总量", { exact: true })).toBeInViewport();
      await expect(page.getByRole("img", { name: "每日 Token 消耗趋势" })).toBeInViewport();
    });
  }
});

test.describe("门面 · 日志表横向可达", () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1400, height: 872 }
  ]) {
    test(`${viewport.width}×${viewport.height}：所有列完整可见，无横向溢出`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await openFirstSession(page);

      const metrics = await logTableMetrics(page);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
      expect(metrics.lastRight).toBeLessThanOrEqual(metrics.containerRight + 1);
      // 不溢出就不该渲染滚动提示。
      await expect(page.locator("[data-scroll-hint]")).toHaveCount(0);
    });
  }

  test("960×640：渲染常驻滚动提示，末列可滚到、不永久裁切", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto("/");
    await openFirstSession(page);

    const before = await logTableMetrics(page);
    // 内容确实超出容器——所以才需要提示与可达性断言。
    expect(before.scrollWidth).toBeGreaterThan(before.clientWidth + 1);
    // 常驻、静止可见的横向滚动提示（原生覆盖式滚动条静止时不占位、不可见）。
    await expect(page.locator("[data-scroll-hint]")).toBeVisible();

    // 滚到最右：末列落回容器内，证明内容可达、不被永久裁切。
    await page.locator("table").first().evaluate((table) => {
      const container = table.parentElement as HTMLElement;
      container.scrollLeft = container.scrollWidth;
    });
    const after = await logTableMetrics(page);
    expect(after.lastRight).toBeLessThanOrEqual(after.containerRight + 1);
  });
});
