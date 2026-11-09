import { test, expect, roundDDScenario } from "./fixtures";

/**
 * 项目记忆（Project Memory，Issue #317）端到端：
 *
 * 1. 「项目」档要有项目切换条、三块档案与搜索框；
 * 2. 搜索能把命令/文件过滤空，并给出诚实的空结果提示；
 * 3. 页面上不能出现绝对路径——档案会被截图与转发。
 *
 * 夹具用 Round DD：它的会话锚定「现在」、且真的带 Bash / Edit / Read 调用。
 * 默认场景平移后窗口内只剩两个 usage 会话（没有工具），记忆页只会剩下头部。
 */

test.use({ scenario: roundDDScenario() });

async function openMemory(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  const memory = page.getByRole("region", { name: "项目记忆" });
  await expect(memory).toBeVisible({ timeout: 15_000 });
  return memory;
}

test("项目档：切换条、三块档案与搜索", { tag: "@project-memory" }, async ({ page }) => {
  const memory = await openMemory(page);

  const chips = memory.locator("[data-probe='memory-project']");
  expect(await chips.count()).toBeGreaterThanOrEqual(1);

  // 命令与文件至少有一块有内容（夹具含 Bash 调用）；坑可能为空，允许整块省略。
  const sections = await memory.locator("section h3").allTextContents();
  expect(sections.length).toBeGreaterThanOrEqual(2);
  expect(sections.join(" ")).toMatch(/常用命令|热文件|坑/);

  const search = page.locator("[data-probe='memory-search']");
  await expect(search).toBeVisible();
  await search.fill("zzz-no-such-command");
  await expect(page.locator("[data-probe='memory-no-match']")).toBeVisible();

  // 转发红线：档案里不能出现绝对路径。
  const text = await memory.innerText();
  expect(text).not.toContain("/Users/e2e");
  expect(text).not.toContain(".claude/projects");
});

test("项目档：切换项目后搜索被清空", { tag: "@project-memory" }, async ({ page }) => {
  const memory = await openMemory(page);
  const chips = memory.locator("[data-probe='memory-project']");
  const count = await chips.count();
  if (count < 2) test.skip(true, "夹具里只有一个项目，切换行为由组件测试覆盖");

  await chips.first().click();
  const search = page.locator("[data-probe='memory-search']");
  await search.fill("zzz");
  await expect(page.locator("[data-probe='memory-no-match']")).toBeVisible();

  await chips.nth(1).click();
  await expect(search).toHaveValue("");
});
