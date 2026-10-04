import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * 「复制 resume 命令」的真机点击闭环。
 *
 * 复制走 `navigator.clipboard`，而 Chromium 与 WebKit 对它的权限模型不同
 * （前者未授权直接拒绝、后者放行）。为了让断言与引擎无关，`tauri-mock.ts`
 * 把 `navigator.clipboard` 换成记录写入的桩，这里断言桩收到的字符串——
 * 这对两个引擎都是同一份期望。
 */

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

test.describe("复制 resume 命令", () => {
  test("点击后剪贴板收到带项目目录的完整命令", async ({ page }) => {
    await page.goto("/");
    // 用搜索收敛到唯一一条会话（cwd=/repo/subagent），期望的命令串才是确定的。
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("subagent");
    await sessionItems(page).first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    await page.getByRole("button", { name: "复制 resume 命令" }).click();

    const writes = await page.evaluate(
      () => (window as unknown as { __CCA_CLIPBOARD__?: string[] }).__CCA_CLIPBOARD__ ?? []
    );
    expect(writes.at(-1)).toBe(
      'cd "/repo/subagent" && claude --resume 3d2a5442-9c65-4b28-9c30-bb3d1a1b2a22'
    );
  });
});
