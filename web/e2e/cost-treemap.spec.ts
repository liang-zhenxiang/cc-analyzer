import { test, expect, roundFFScenario } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Issue #359「成本树图」端到端验收。
 *
 * 跑在生产构建上（`npm run build && npm run preview`），双引擎（Chromium +
 * WebKit）。断言只依赖夹具的结构事实：块在、口径切换后读数换单位、点击后
 * 真的落到会话分析、键盘能在一张图里走完。不断言具体金额——定价快照更新
 * 时不该假红。
 */

async function openLab(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览", exact: true }).click();
  await expect(page.locator("[data-probe='usage-progress']")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "实验室", exact: true }).click();
  await expect(page.getByText(/纳入统计 · 17 个视角/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-probe='lab-view']")).toBeVisible();
}

function treemapCard(page: Page): Locator {
  return page.locator('[data-lab-card="treemap"]');
}

test.describe("成本树图", () => {
  test.use({ scenario: roundFFScenario() });

  test("面板渲染：块、项目名、脚注与读屏等价表格都在", async ({ page }) => {
    await openLab(page);
    const card = treemapCard(page);

    await expect(card.getByRole("region", { name: "成本树图" })).toBeVisible();
    await expect(card.locator("[data-probe='cost-treemap-chart']")).toBeVisible();
    await expect(card.locator("[data-treemap-hit]").first()).toBeVisible();
    await expect(card.locator("[data-treemap-project-label]").first()).toBeVisible();
    // 成本口径：脚注必须说明未定价会话怎么处理（Round FF 夹具里有一个未定价模型）。
    await expect(card.getByText(/面积是已定价会话的估算成本/)).toBeVisible();
    await expect(card.getByText(/\d+ 个会话使用未收录定价的模型，未计入。/)).toBeVisible();

    // 视觉隐藏的等价表格：树图对读屏不可用，这张表才是可读层。
    const table = card.getByRole("table");
    await expect(table).toHaveCount(1);
    await expect(table.locator("caption")).toHaveText(/成本树图等价表格（估算成本口径）/);
    expect(await table.locator("tbody tr").count()).toBeGreaterThanOrEqual(1);
  });

  test("维度切换：成本 ↔ token，摘要、脚注与表格列一起换口径", async ({ page }) => {
    await openLab(page);
    const card = treemapCard(page);
    const group = card.getByRole("radiogroup", { name: "树图面积口径" });

    await expect(group.getByRole("radio", { name: "成本" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(card.getByRole("group", { name: /面积表示已定价会话的估算成本/ })).toBeVisible();

    await group.getByRole("radio", { name: "token" }).click();
    await expect(group.getByRole("radio", { name: "token" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(card.getByRole("group", { name: /四类 token 之和/ })).toBeVisible();
    await expect(card.getByText(/定价未知的会话照常计入/)).toBeVisible();
    await expect(card.getByRole("columnheader", { name: "token" })).toBeVisible();
    await expect(card.locator("tbody tr").first()).toContainText(/token/);
  });

  test("点击会话块跳到会话分析（沿用 onOpenSession 握手）", async ({ page }) => {
    await openLab(page);
    const card = treemapCard(page);

    await card.locator("[data-treemap-hit]").first().click();

    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("键盘：roving tabindex——整图一个 Tab 停靠点，方向键 / End 移动焦点", async ({ page }) => {
    await openLab(page);
    const hits = treemapCard(page).locator("[data-treemap-hit]");

    await expect(hits.first()).toHaveAttribute("tabindex", "0");
    await expect(hits.nth(1)).toHaveAttribute("tabindex", "-1");

    await hits.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(hits.nth(1)).toBeFocused();
    await expect(hits.nth(1)).toHaveAttribute("tabindex", "0");
    await expect(hits.first()).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("End");
    await expect(hits.last()).toBeFocused();
    await page.keyboard.press("Home");
    await expect(hits.first()).toBeFocused();
  });

  test("悬停浮层：显示会话标题、读数与模型/时间，离开后关闭", async ({ page }) => {
    await openLab(page);
    const card = treemapCard(page);
    const hit = card.locator("[data-treemap-hit]").first();

    await hit.hover();
    const tip = page.locator("[data-treemap-tooltip]");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute("aria-hidden", "true");
    await expect(tip).toContainText(/占本窗口 \d+\.\d+%/);
    await expect(tip).toContainText(/Sonnet|Opus|Haiku|未知模型/);

    // 指针移出交互层（移到卡片头部）后浮层消失。
    await card.getByRole("heading", { name: "成本树图" }).hover();
    await expect(tip).toHaveCount(0);
  });
});
