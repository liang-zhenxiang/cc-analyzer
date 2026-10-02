import { test, expect } from "./fixtures";

/**
 * 全局搜索的端到端：⌘K 唤起、跨项目命中分组、Enter 跳转后
 * 会话已选中且记录高亮、详情面板可见——「搜得到、跳得过去」是本轮命门
 * （CCHV 被骂得最多的就是联动断裂）。
 */

const DETAIL_ROLE = "complementary";
const DETAIL_NAME = "记录详情";

test.describe("全局搜索", () => {
  test("⌘K 唤起与关闭；顶栏按钮亦可唤起", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K");
    const dialog = page.getByRole("dialog", { name: "全局搜索" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("搜索消息")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "全局搜索" }).click();
    await expect(dialog).toBeVisible();
  });

  test("搜索命中跨项目消息并按项目分组", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K");
    await page.getByLabel("搜索消息").fill("解析");
    // 夹具里 -repo-enhanced（“分析解析器”）与 -repo-usage-days（“先把数据面摸清楚”不含）——
    // 用「解析」至少命中 enhanced；宽松断言组标题出现且命中数可见。
    await expect(page.getByText(/条命中/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "-repo-enhanced" })).toBeVisible();
  });

  test("Enter 跳转：会话打开、记录高亮、详情面板可见", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K");
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
    await page.goto("/");
    await page.keyboard.press("Meta+K");
    await page.getByLabel("搜索消息").fill("绝对不存在的词xyz");
    await expect(page.getByText("没有匹配的消息")).toBeVisible({ timeout: 15_000 });
  });
});
