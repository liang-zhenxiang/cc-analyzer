import { test, expect, defaultScenario, APP_VERSION } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 软件更新设置的端到端：更新区渲染、渠道���换持久化、检查的两态
 * （已是最新 / 发现新版→安装按钮）。更新检查本身走 tauri-mock，
 * 真实的 GitHub 更新源由发布流水线验证。
 */

async function openUpdateSection(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  const panel = page.getByLabel("阈值设置");
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("软件更新", () => {
  test("顶栏版本徽章显示当前版本（升级生效的第一眼证据）", async ({ page }) => {
    await page.goto("/");
    // 期望值与 web/package.json 同源（APP_VERSION）：断言写死版本号会跟着发版
    // 悄悄漂移——桩换成真实版本后，写死的 v0.10.0 立刻就红了。
    const expected = new RegExp(`当前版本 v${APP_VERSION.replace(/\./g, "\\.")}`);
    await expect(page.getByRole("button", { name: expected })).toBeVisible();
  });

  test("更新区展示当前版本与渠道选择，默认稳定版", async ({ page }) => {
    const panel = await openUpdateSection(page);
    await expect(panel.getByText("软件更新")).toBeVisible();
    await expect(panel.getByLabel("更新渠道")).toHaveValue("stable");
    await expect(panel.getByText(/当前版本/)).toBeVisible();
    await expect(panel.getByText(/一次下载请求，不上传任何数据/)).toBeVisible();
  });

  test("渠道切换持久化到 localStorage", async ({ page }) => {
    const panel = await openUpdateSection(page);
    await panel.getByLabel("更新渠道").selectOption("beta");
    await expect(panel.getByLabel("更新渠道")).toHaveValue("beta");
    const stored = await page.evaluate(() => localStorage.getItem("cca-update-channel"));
    expect(stored).toBe("beta");
    // 重开面板仍是 beta
    await page.getByRole("button", { name: "关闭" }).click();
    const panel2 = await openUpdateSection(page);
    await expect(panel2.getByLabel("更新渠道")).toHaveValue("beta");
  });

  test("默认场景（无更新）：检查后显示已是最新", async ({ page }) => {
    const panel = await openUpdateSection(page);
    await panel.getByRole("button", { name: "立即检查更新" }).click();
    await expect(panel.getByText(/已是最新/)).toBeVisible({ timeout: 10_000 });
  });

});

test.describe("软件更新 · 有新版本", () => {
  test.use({
    // 这里的版本号是**故意写死**的：该场景测的是「0.8.0 → 0.9.0」的相对
    // 关系（有更新可用），与「当前版本」无关，跟着发版走反而没有意义。
    // check-e2e-mock-version.sh 只禁场景工厂与版本徽章断言里的字面量。
    scenario: defaultScenario({
      updater: { currentVersion: "0.8.0", version: "0.9.0-beta.1", notes: "测试更新" }
    })
  });

  test("显示版本号与「安装并重启」", async ({ page }) => {
    const panel = await openUpdateSection(page);
    await panel.getByRole("button", { name: "立即检查更新" }).click();
    await expect(panel.getByText("发现新版本 0.9.0-beta.1")).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole("button", { name: "安装并重启" })).toBeVisible();
  });
});
