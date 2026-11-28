import { test, expect, roundDDScenario } from "./fixtures";

/**
 * 项目档（Issue #317 / #397）端到端：
 *
 * 1. 两张卡之上只有一条项目切换条，接续卡与记忆卡都在；
 * 2. 搜索能把命令/文件过滤空，并给出诚实的空结果提示；
 * 3. 切换项目后搜索被清空，记忆卡的项目名跟着切换条走；
 * 4. 页面上不能出现绝对路径——档案会被截图与转发。
 *
 * 夹具用 Round DD：它的会话锚定「现在」、且真的带 Bash / Edit / Read 调用。
 */

test.use({ scenario: roundDDScenario() });

async function openProjectView(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  const toolbar = page.locator("[data-probe='handoff-toolbar']");
  await expect(toolbar).toBeVisible({ timeout: 15_000 });
  // 记忆卡是「项目」档的下半张卡；切换条先出现，等它一起就绪。
  const memory = page.getByRole("region", { name: "项目记忆" });
  await expect(memory).toBeVisible();
  return { toolbar, memory };
}

test("项目档：切换条、两张卡与搜索", { tag: "@project-memory" }, async ({ page }) => {
  const { toolbar, memory } = await openProjectView(page);

  await expect(toolbar.locator("[data-handoff-project]")).not.toHaveCount(0);
  // 切换条之上的接续卡也在（同一档的第一张卡）。
  await expect(page.getByRole("region", { name: "项目接续" })).toBeVisible();

  // 命令与文件至少有一块有内容（夹具含 Bash 调用）；坑可能为空，允许整块省略。
  const sections = await memory.locator("section h3").allTextContents();
  expect(sections.length).toBeGreaterThanOrEqual(2);
  expect(sections.join(" ")).toMatch(/常用命令|热文件|坑/);

  const search = page.locator("[data-probe='memory-search']");
  await expect(search).toBeVisible();
  await search.fill("zzz-no-such-command");
  await expect(page.locator("[data-probe='memory-no-match']")).toBeVisible();

  // 转发红线：项目档里不能出现绝对路径。
  for (const region of [toolbar, memory, page.getByRole("region", { name: "项目接续" })]) {
    const text = await region.innerText();
    expect(text).not.toContain("/Users/e2e");
    expect(text).not.toContain(".claude/projects");
  }
});

test("项目档：切换项目后搜索被清空，两张卡同时换", { tag: "@project-memory" }, async ({ page }) => {
  const { toolbar, memory } = await openProjectView(page);
  const chips = toolbar.locator("[data-handoff-project]");
  const count = await chips.count();
  if (count < 2) test.skip(true, "夹具里只有一个项目，切换行为由组件测试覆盖");

  await chips.first().click();
  const search = page.locator("[data-probe='memory-search']");
  await search.fill("zzz");
  await expect(page.locator("[data-probe='memory-no-match']")).toBeVisible();

  const second = chips.nth(1);
  const secondName = await second.getAttribute("title");
  await second.click();
  await expect(search).toHaveValue("");
  // 记忆卡体内的 h3 用切换条给的显示名（不是自己再造一个）。
  await expect(memory.locator("h3").first()).toHaveText(secondName ?? "");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  // 接续卡也在同一轮切换：标题栏的项目名等于同一个显示名。
  await expect(
    page.getByRole("region", { name: "项目接续" }).locator("header")
  ).toContainText(secondName ?? "");
});
