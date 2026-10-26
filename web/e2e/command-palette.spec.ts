import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 命令面板（F9）与大屏模式（F10）的端到端回归。
 *
 * 这两个功能都在**全局层**（`AppShell`），所以这里不挂任何场景夹具：要验的是
 * 「快捷键真的开了面板」「Enter 真的执行了动作」「外壳真的收起来了」这三件事，
 * 数据长什么样与本轮无关。
 *
 * ⌘K 的监听挂在 `AppShell` 的 effect 里，`goto` 只等到 load——WebKit 下偶发抢在
 * 挂载前按键，所以和全局搜索那份一样用 `toPass` 把「可能丢一次键」变成确定通过。
 */
async function openCommandPalette(page: Page) {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "命令面板" });
  await expect(async () => {
    await page.keyboard.press("Meta+K");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  return dialog;
}

function rootFontScale(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim()
  );
}

test.describe("命令面板（F9）", () => {
  test("⌘K 唤起、过滤、Enter 执行：跳到用量总览并关面板", async ({ page }) => {
    const dialog = await openCommandPalette(page);
    await expect(page.getByLabel("搜索命令")).toBeFocused();

    await page.keyboard.type("用量总览");
    const options = dialog.getByRole("option");
    await expect(options.first()).toContainText("用量总览");

    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    // 动作是一次真实的视图切换：标签页选中态与持久化都跟着走。
    await expect(page.getByRole("tab", { name: "用量总览" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(await page.evaluate(() => localStorage.getItem("cca-workspace-tab"))).toBe("usage");
  });

  test("不可用的动作仍列出，并写明「不可用」而不接受 Enter", async ({ page }) => {
    const dialog = await openCommandPalette(page);
    await page.keyboard.type("导出");
    const option = dialog.getByRole("option").first();
    await expect(option).toContainText("导出用量快照");
    await expect(option).toContainText("不可用");
    await expect(option).toHaveAttribute("aria-disabled", "true");

    // 回车不该关掉面板：高亮停在不可用项上时什么也不会发生。
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
  });

  test("↑↓ 跳过不可用项绕回，Esc 关闭并把焦点交回页面", async ({ page }) => {
    const dialog = await openCommandPalette(page);
    const selected = dialog.locator('[role="option"][aria-selected="true"]');
    await page.keyboard.press("ArrowDown");
    // 高亮唯一，且永远落在可用项上：一路按到底都不会停在不可用命令上。
    await expect(selected).toHaveCount(1);
    const count = await dialog.getByRole("option").count();
    for (let i = 0; i < count; i += 1) {
      await page.keyboard.press("ArrowDown");
      await expect(selected).toHaveCount(1);
      await expect(selected).not.toHaveAttribute("aria-disabled", "true");
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("130% 字号 + 960px 窄窗：面板不横向溢出，长列表自己滚", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.addInitScript(() => localStorage.setItem("cca-font-scale", "1.3"));
    const dialog = await openCommandPalette(page);

    const panel = await dialog.evaluate((el) => ({
      width: el.clientWidth,
      scrollWidth: el.scrollWidth,
      viewport: window.innerWidth
    }));
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.width + 1);
    expect(panel.width).toBeLessThanOrEqual(panel.viewport);

    // 列表是唯一的滚动区：面板本身定高，命令再多也只在这一层滚。
    const list = await dialog.getByRole("listbox").evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight
    }));
    expect(list.overflowY).toBe("auto");
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  });
});

test.describe("大屏模式（F10）", () => {
  test("设置里开启：顶栏收起、字号到 130%，Esc 退出并把字号还回去", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    // 用 click 而不是 check：这一下会把设置浮层一起收起（见下），元素立刻消失，
    // check 的「点完再验证仍是勾选态」会在元素脱落后无限重试。
    await page.getByRole("checkbox", { name: "启用大屏模式" }).click();

    // 外壳收起（顶栏是 role=banner 的 <header>，工作区标签与页头控件都在里面）。
    await expect(page.getByRole("banner")).toBeHidden();
    await expect(page.locator('[data-probe="kiosk-root"]')).toHaveAttribute("data-kiosk", "on");
    expect(await rootFontScale(page)).toBe("1.3");

    // 进入大屏会把设置浮层一起收起（顶栏连同「设置」按钮都藏了，留着浮层就是死角）。
    await expect(page.getByLabel("阈值设置")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("banner")).toBeVisible();
    expect(await rootFontScale(page)).toBe("1");
    expect(await page.evaluate(() => localStorage.getItem("cca-kiosk"))).toBe("off");
  });
});
