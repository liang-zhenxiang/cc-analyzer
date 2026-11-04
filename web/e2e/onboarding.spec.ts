import { test, expect, defaultScenario } from "./fixtures";

/**
 * 开箱体验（Issue #306）端到端：
 *
 * 1. 找不到会话目录时，欢迎层要给出路径、隐私说明与可执行的下一步；
 * 2. 目录存在但没有 `.jsonl` 时，文案要和「找不到」区分开；
 * 3. 演示模式要一直有标记、能看到真实面板读数，并且能退出。
 *
 * e2e 的虚拟文件系统对未声明路径是抛错（`E2E 虚拟文件系统：readDir 遇到
 * 未声明的路径`），自检因此落在 `unreadable` 而不是 `missing`——欢迎层的
 * 标题与动作相同，所以断言只锁用户能看到的文案，不锁内部状态码。
 */

test.describe("开箱体验 · 没有可读的会话目录", () => {
  test.use({ scenario: defaultScenario({ files: { "/Users/e2e/notes.txt": "" } }) });

  test("欢迎层给出路径、隐私说明与动作", { tag: "@onboarding" }, async ({ page }) => {
    await page.goto("/");
    const gate = page.locator("[data-probe='claude-root-gate']");
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("还没有找到会话目录");
    await expect(gate).toContainText("会话数据只在本机读取，不上传、不内置遥测。");
    await expect(gate).toContainText("/Users/e2e/.claude/projects");
    await expect(gate.getByRole("button", { name: "重新扫描" })).toBeVisible();
    await expect(gate.getByRole("button", { name: "先看演示数据" })).toBeVisible();
  });

  test("先看演示数据：标记可见、有面板读数、可退出", { tag: "@onboarding" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "先看演示数据" }).click();

    const badge = page.locator("[data-probe='demo-badge']");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("演示数据");
    await expect(badge).toContainText("不会读取你的会话");

    // 演示数据是内存桥：用量页必须有可读的 KPI，而不是再次落回欢迎层。
    await page.getByRole("tab", { name: "用量总览" }).click();
    await expect(page.getByText("Tokens 总量").first()).toBeVisible();
    await expect(page.locator("[data-probe='claude-root-gate']")).toHaveCount(0);

    await page.locator("[data-probe='demo-exit']").click();
    await expect(page.locator("[data-probe='demo-badge']")).toHaveCount(0);
    // 退出后回到真实桥：这台「机器」仍没有目录，欢迎层应重新出现。
    await expect(page.locator("[data-probe='claude-root-gate']")).toBeVisible();
  });
});

test.describe("开箱体验 · 目录存在但没有会话", () => {
  test.use({
    scenario: defaultScenario({
      files: { "/Users/e2e/.claude/projects/placeholder.txt": "" }
    })
  });

  test("主界面放行，用量页给出三步引导与演示入口", { tag: "@onboarding" }, async ({ page }) => {
    await page.goto("/");
    // 目录存在只是没有会话：不整页拦截，交给用量页既有的 H10 引导。
    await expect(page.locator("[data-probe='claude-root-gate']")).toHaveCount(0);

    await page.getByRole("tab", { name: "用量总览" }).click();
    await expect(page.locator("[data-probe='empty-steps']")).toBeVisible();
    await expect(page.getByRole("button", { name: "先看演示数据" })).toBeVisible();
  });
});
