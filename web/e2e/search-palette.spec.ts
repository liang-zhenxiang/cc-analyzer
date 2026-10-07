import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * 全局搜索的端到端：⌘K 唤起、跨项目命中分组、Enter 跳转后
 * 会话已选中且记录高亮、详情面板可见——「搜得到、跳得过去」是本轮命门
 * （CCHV 被骂得最多的就是联动断裂）。
 */

const DETAIL_ROLE = "complementary";
const DETAIL_NAME = "记录详情";

/**
 * 打开全局搜索面板。
 *
 * **不能 `goto` 完就按 ⌘K**：快捷键的监听挂在 `AppShell` 的 effect 里，而
 * `page.goto` 只等到 `load`——实测 WebKit 下偶发抢在挂载前按键，这一次按键就此
 * 丢失，用例只能等到超时（本地跑完整套件时复现过一次）。真人按不到这么快，所以
 * 这是测试的健壮性问题，不是产品缺陷。这里用 `toPass` 重试按键，把「可能丢一次键」
 * 变成确定通过。
 */
async function openPalette(page: Page) {
  await page.goto("/");
  const dialog = page.getByRole("dialog", { name: "全局搜索" });
  await expect(async () => {
    await page.keyboard.press("Meta+K");
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  return dialog;
}

test.describe("全局搜索", () => {
  test("⌘K 唤起与关闭；顶栏按钮亦可唤起", async ({ page }) => {
    const dialog = await openPalette(page);
    await expect(page.getByLabel("搜索消息")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "全局搜索" }).click();
    await expect(dialog).toBeVisible();
  });

  test("搜索命中跨项目消息并按项目分组", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索消息").fill("解析");
    // 夹具里 -repo-enhanced（“分析解析器”）与 -repo-usage-days（“先把数据面摸清楚”不含）——
    // 用「解析」至少命中 enhanced；宽松断言组标题出现且命中数可见。
    await expect(page.getByText(/条命中/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "-repo-enhanced" })).toBeVisible();
  });

  test("Enter 跳转：会话打开、记录高亮、详情面板可见", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索消息").fill("分析解析器");
    const firstItem = page.locator("[data-item-index='0']");
    await expect(firstItem).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Enter");

    // 关面板、切到会话分析、会话已选中（图状态加载完成）
    await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeHidden();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    // 记录被定位进日志视图且详情面板出现——联动不断裂
    await expect(page.getByRole(DETAIL_ROLE, { name: DETAIL_NAME })).toBeVisible({ timeout: 10_000 });
  });

  test("无匹配时的明确空态", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索消息").fill("绝对不存在的词xyz");
    await expect(page.getByText("没有匹配的消息")).toBeVisible({ timeout: 15_000 });
  });

  test("命中摘要剥掉终端转义序列：读到的是正文，不是 [33m", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索消息").fill("构建失败");

    // 夹具 session-ansi 的那条 assistant 记录正文就是 `\u001b[33m构建失败\u001b[0m：…`。
    const first = page.locator("[data-item-index='0']");
    await expect(first).toBeVisible({ timeout: 15_000 });

    // 用 textContent 而不是 innerText：这里要断言的就是**字节**有没有进 DOM，
    // 渲染近似值会把控制字符吃掉，那样这条断言就恒真了。
    const snippet = await first.evaluate((node) => node.textContent ?? "");
    expect(snippet).toContain("构建失败");
    expect(snippet).toContain("先修 src/app.ts:12。");
    expect(snippet).not.toContain("\u001b");
    expect(snippet).not.toContain("[33m");
  });
});
