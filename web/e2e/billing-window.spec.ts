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
    // 5h 层与周层各有一枚「读自日志」圆点，取其一证明徽章在场即可。
    await expect(card.getByText("读自日志").first()).toBeVisible();
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

test.describe("周用量（滚动 7 天）", () => {
  test("未设预算：消耗与「不是官方重置窗口」的说明在场，无任何百分比", async ({ page }) => {
    await openUsage(page);
    const weekly = page.getByLabel("周用量（滚动 7 天）");
    await expect(weekly).toBeVisible();

    // recentActivityScenario：两个 usage 夹具（跨 4 个本地日）全部落在 7 天窗内，
    // 与 KPI 的 246,130 同源——周层的消耗必须是同一份日志算出的同一个数。
    await expect(weekly.getByText("246,130", { exact: true })).toBeVisible();
    await expect(weekly.getByText("滚动 7 天", { exact: true })).toBeVisible();
    await expect(weekly.getByText(/不是官方重置窗口/)).toBeVisible();
    await expect(weekly.getByText(/未设周预算/)).toBeVisible();
    // 夹具没有更早的活动 → 上一周期如实说 0，不造 ±100% 的「趋势」。
    await expect(weekly.getByText("上一周期 0", { exact: true })).toBeVisible();
    // 没有分母就没有比率：周层里不应出现任何百分比读数。
    await expect(weekly.getByText(/\d+%/)).toHaveCount(0);
  });

  test("设置里填周预算 → 出现对照与日均推算；清掉 → 退回只显示消耗", async ({ page }) => {
    await openUsage(page);

    await page.getByRole("button", { name: "设置" }).click();
    const panel = page.getByLabel("阈值设置");
    await panel.getByLabel("周预算（可选）").fill("300000");
    await page.getByRole("button", { name: "关闭" }).click();

    const weekly = page.getByLabel("周用量（滚动 7 天）");
    await expect(weekly.getByText(/周预算已用 82%/)).toBeVisible();
    // 4 个活动日 ≥ 2 → 可推算；具体时刻随运行时间走，锁体例不锁值。
    await expect(weekly.getByText(/按日均推算 \d{2}-\d{2} \d{2}:\d{2} 触达/)).toBeVisible();

    await page.getByRole("button", { name: "设置" }).click();
    await page.getByLabel("阈值设置").getByLabel("周预算（可选）").fill("");
    await page.getByRole("button", { name: "关闭" }).click();

    await expect(weekly.getByText(/未设周预算/)).toBeVisible();
    await expect(weekly.getByText(/周预算已用/)).toHaveCount(0);
    await expect(weekly.getByText(/按日均推算/)).toHaveCount(0);
    await expect(weekly.getByText(/\d+%/)).toHaveCount(0);
  });
});
