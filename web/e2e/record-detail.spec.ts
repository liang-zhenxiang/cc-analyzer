import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * 记录详情面板的开合闭环。
 *
 * 单独成文件、不塞进 `smoke.spec.ts`：冒烟覆盖的是「应用起得来」，
 * 这里覆盖的是详情列自己的事——能不能收起、收起后选中状态还坏不坏。
 * 混在一起以后，冒烟失败会变得难定位（到底是应用没起来，还是关闭按钮没了）。
 *
 * 这里**不**断言复制后的 toast：复制走 `navigator.clipboard`，Chromium 在没
 * 显式授权时直接拒绝写入、WebKit 放行——两条分支的差别来自浏览器权限模型，
 * 不是产品行为，断言哪一条都会把环境差异写死成预期。复制反馈的成功/失败、
 * 空摘要回退分别由 `RecordDetailPanel.test.tsx` 与 `recordSummary.test.ts` 覆盖。
 */

function sessionItems(page: Page) {
  return page.getByLabel("会话列表").locator("button[title]");
}

/** 日志表的记录行。点一下就会把该行的主记录选进详情面板。 */
function logRows(page: Page) {
  return page.getByRole("main").locator("table tbody tr");
}

test.describe("记录详情面板", () => {
  test("选中记录才出现详情列，关闭后收起，再选一条还能打开", async ({ page }) => {
    await page.goto("/");
    await sessionItems(page).first().click();
    // 等会话图解析落定，免得到半张表上点
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    const detail = page.getByRole("complementary", { name: "记录详情" });
    // 没选记录时不该占着右侧那一列
    await expect(detail).toHaveCount(0);

    await logRows(page).first().click();
    await expect(detail).toBeVisible();

    await page.getByRole("button", { name: "收起详情" }).click();
    await expect(detail).toHaveCount(0);

    // 收起不是把选中状态弄坏：再点一条，详情列照样回来
    await logRows(page).nth(1).click();
    await expect(detail).toBeVisible();

    await page.getByRole("button", { name: "收起详情" }).click();
    await expect(detail).toHaveCount(0);
  });
});
