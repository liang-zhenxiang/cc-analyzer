import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";

/**
 * 终端输出保真的端到端回归。
 *
 * Claude Code 把工具输出原样写进 transcript，所以 `Bash` 结果里全是 SGR 序列。
 * 这一页要立住两条：**表格里是纯文本**（用户按看到的字能搜到），
 * **详情面板里是原色**（颜色来自主题变量，不是转义码本身）。
 */

const ESC = "\u001b";

async function openAnsiSession(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill("ansi");
  await page
    .getByLabel("会话列表", { exact: true })
    .locator("button[title]:has(strong)")
    .first()
    .click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

/** 页面上渲染出来的所有文字里都不该有 ESC——它是控制字符，不是文本。 */
async function escapeCount(page: Page): Promise<number> {
  return page.evaluate((needle) => {
    const text = document.body.innerText;
    return text.split(needle).length - 1;
  }, ESC);
}

test.describe("终端输出保真", () => {
  test("日志表的摘要里没有转义序列，按看到的文字能搜到", async ({ page }) => {
    await openAnsiSession(page);

    const table = page.locator("table").first();
    await expect(table).toContainText("12 passed");
    expect(await escapeCount(page)).toBe(0);

    // 摘要被剥成纯文本之后，搜索框里输入屏幕上看到的字必须能命中。
    await page.getByPlaceholder("搜索命令 / 路径 / 摘要…").fill("passed");
    await expect(table).toContainText("passed");
  });

  test("展开行的工具输出按主题调色板着色", async ({ page }) => {
    await openAnsiSession(page);

    await page.locator('tr:has-text("Bash")').first().getByRole("button", { name: "展开" }).click();
    const output = page.getByRole("region", { name: "工具输出" });
    await expect(output).toContainText("build failed");
    expect(await escapeCount(page)).toBe(0);

    // 红色是主题变量给的（浅/深各一套值），不是写死的十六进制。
    const colored = await output
      .locator("span")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).style.color).filter((value) => value.length > 0)
      );
    expect(colored).toContain("var(--ansi-1)");
  });
});
