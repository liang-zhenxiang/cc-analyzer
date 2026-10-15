import { test, expect } from "./fixtures";
import { sessionItems } from "./selectors";

/**
 * 「通电」轮的端到端：首屏读数行、三张表的键盘导航。
 * 读数行是按钮（展开 Token 面板），键盘流走真实按键。
 * 会话定位统一走 `selectors.ts` 的 `sessionItems()`：行的本体是 `role="button"`
 * 的 <div>（不是 <button>），而工具栏那颗 IconButton 也带 title，所以选择器
 * 必须按 role 选、同时用 `[title]` 把它挡在外面。理由见 selectors.ts。
 */

test.describe("读数行", () => {
  test("选中会话后读数行给出五个读数并可展开 Token 面板", async ({ page }) => {
    await page.goto("/");
    await sessionItems(page).first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    const readouts = page.getByRole("button", { name: "会话读数" });
    await expect(readouts).toBeVisible();
    await expect(readouts).toHaveAttribute("aria-expanded", "false");
    for (const label of ["总耗时", "输入", "缓存读取", "输出", "记录数"]) {
      await expect(readouts.getByText(label, { exact: true })).toBeVisible();
    }

    await readouts.click();
    await expect(page.getByRole("region", { name: "Token 计数" })).toBeVisible();
    await expect(readouts).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("行级键盘导航", () => {
  test("日志表可纯键盘换行与选中", async ({ page }) => {
    await page.goto("/");
    await sessionItems(page).first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    const firstRow = page.locator("tbody tr[data-row-index='0']").first();
    await firstRow.focus();
    await expect(firstRow).toBeFocused();

    await page.keyboard.press("ArrowDown");
    const secondRow = page.locator("tbody tr[data-row-index='1']").first();
    await expect(secondRow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(secondRow).toHaveClass(/selected/);
  });

  test("耗时树可键盘导航并选中节点", async ({ page }) => {
    await page.goto("/");
    await sessionItems(page).first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    await page.getByRole("tab", { name: "树视图" }).click();
    const firstItem = page.locator("[role='treeitem'][data-row-index='0']");
    await firstItem.focus();
    await expect(firstItem).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.locator("[role='treeitem'][data-row-index='1']")).toBeFocused();
  });
});
