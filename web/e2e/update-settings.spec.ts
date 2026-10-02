import { test, expect, defaultScenario } from "./fixtures";
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
