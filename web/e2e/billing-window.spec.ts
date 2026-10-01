import { test, expect, recentActivityScenario } from "./fixtures";

/**
 * 计费窗口仪表的端到端：窗口读数、未选计划的降级、设置里选计划后的
 * 限额刻度。场景经时间平移（最新活动=昨天），因此当前窗口必然已关闭——
 * 关闭态的读数（「已关闭」）是确定可断言的。
 */

const DASHBOARD = "用量总览";

async function openUsage(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: DASHBOARD }).click();
  await expect(page.getByText(/纳入统计/, { exact: false })).toBeVisible({ timeout: 15_000 });
}

test.use({ scenario: recentActivityScenario() });

test.describe("计费窗口", () => {
  test("当前窗口读数与来源徽章齐全；窗口已关闭时倒计时说已关闭", async ({ page }) => {
    await openUsage(page);
    const card = page.getByLabel("计费窗口", { exact: true });
    await expect(card).toBeVisible();

    await expect(card.getByText("窗口开启", { exact: true })).toBeVisible();
    await expect(card.getByText("已关闭")).toBeVisible();
    await expect(card.getByText("读自日志")).toBeVisible();
  });

  test("未选计划：只看消耗，不显示百分比", async ({ page }) => {
    await openUsage(page);
    const card = page.getByLabel("计费窗口", { exact: true });
    await expect(card.getByText("未选计划")).toBeVisible();
    await expect(card.getByText(/未选择订阅计划/)).toBeVisible();
  });

  test("设置里选择计划后，仪表刻度出现且口径说明可见", async ({ page }) => {
    await openUsage(page);

    await page.getByRole("button", { name: "设置" }).click();
    const panel = page.getByLabel("阈值设置");
    await expect(panel).toBeVisible();
    await panel.getByLabel("订阅计划").selectOption("pro");
    await page.getByRole("button", { name: "关闭" }).click();

    await expect(page.getByRole("img", { name: /已用 \d+%/ })).toBeVisible();
    const card = page.getByLabel("计费窗口", { exact: true });
    await expect(card.getByText(/社区整理的估算值/)).toBeVisible();
  });

  test("跨多天的夹具产出历史窗口条", async ({ page }) => {
    await openUsage(page);
    const history = page.getByRole("img", { name: "历史计费窗口消耗" });
    await expect(history).toBeVisible();
  });
});
