import { test, expect, recentActivityScenario } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 故事长图（Chronicle PNG）端到端：
 *
 * 在真实浏览器里跑一遍「排版 → 离屏 canvas → toDataURL → 宿主 write_binary」，
 * 断言落盘的 base64 以 PNG 魔数开头——这条链路在 jsdom 里被桩掉了，只有
 * 真实 canvas 才能证明「点下去真的产出一张图」，而不是一段空白文本。
 *
 * 对话框与文件系统由 `tauri-mock.ts` 在真实边界上打桩（savePath 返回固定
 * 路径，write_binary 记账）。
 */

const SAVED = "/Users/e2e/out/story.png";

/** PNG 文件头：base64 编码后的前 8 个字节恒为 `iVBORw0KGgo`。 */
const PNG_MAGIC = "iVBORw0KGgo";

function binaryWrites(page: Page) {
  return page.evaluate(() => {
    const log =
      (window as unknown as { __CCA_E2E_LOG__?: Array<{ op: string; args: unknown[] }> })
        .__CCA_E2E_LOG__ ?? [];
    return log
      .filter((entry) => entry.op === "write_binary")
      .map((entry) => entry.args[0] as { path: string; contentsBase64: string });
  });
}

// 故事吃页面 30 天窗口：夹具的最新活动必须落在昨天（见 fixtures.ts）。
test.use({ scenario: recentActivityScenario({ savePath: SAVED }) });

test("故事长图：导出 PNG，交给宿主的是图片而不是空文本", { tag: "@chronicle" }, async ({
  page
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "故事" }).click();

  const story = page.getByRole("region", { name: "数据故事" });
  await expect(story).toBeVisible();

  await page.locator('[data-probe="chronicle-export-card"]').click();
  await expect(page.getByText("已导出故事长图")).toBeVisible();

  const saved = (await binaryWrites(page)).at(-1);
  expect(saved?.path).toBe(SAVED);
  const base64 = saved?.contentsBase64 ?? "";
  expect(base64.length).toBeGreaterThan(0);
  expect(base64.startsWith(PNG_MAGIC)).toBe(true);
});

test.describe("用户取消", () => {
  // savePath 为 null 即用户按下「取消」：不是失败，不写文件也不弹错误。
  test.use({ scenario: recentActivityScenario({ savePath: null }) });

  test("故事长图：取消保存不写文件、不报错", { tag: "@chronicle" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();
    await page.getByRole("tab", { name: "故事" }).click();
    await expect(page.getByRole("region", { name: "数据故事" })).toBeVisible();

    await page.locator('[data-probe="chronicle-export-card"]').click();
    // 先确认「保存对话框真的被问过」——否则「没有写入」可能只是点击还没生效。
    await expect
      .poll(() =>
        page.evaluate(() => {
          const log =
            (window as unknown as { __CCA_E2E_LOG__?: Array<{ op: string }> }).__CCA_E2E_LOG__ ??
            [];
          return log.filter((entry) => entry.op === "plugin:dialog|save").length;
        })
      )
      .toBeGreaterThan(0);
    expect((await binaryWrites(page)).length).toBe(0);
    await expect(page.getByText(/导出失败/)).toHaveCount(0);
    await expect(page.locator('[data-probe="chronicle-export-card"]')).toBeEnabled();
  });
});
