import type { Locator, Page } from "@playwright/test";
import { test, expect, changedFilesScenario } from "./fixtures";

/**
 * 全局搜索的端到端：⌘K 唤起、跨项目命中分组、Enter 跳转后
 * 会话已选中且记录高亮、详情面板可见——「搜得到、跳得过去」是本轮命门
 * （CCHV 被骂得最多的就是联动断裂）。
 */

const DETAIL_ROLE = "complementary";
const DETAIL_NAME = "记录详情";

/* 断言只走 role / 可访问名 / data-probe：CSS Module 的类名带哈希，改一次样式就
   会静默失配，那种「断言还在、其实什么都没验」是最贵的一种绿。 */
const resultRows = (page: Page) => page.locator('[data-probe="search-result"]');
const statusLine = (page: Page) => page.locator('[data-probe="search-status"]');
const chip = (page: Page, source: string) =>
  page.locator(`[data-probe="search-filter-chip"][data-source="${source}"]`);
/** 行内来源标签（`data-source` 与可见文案同源）。 */
const sourceTagOf = (row: Locator) => row.locator('[data-probe="search-source"]');
/**
 * 某个来源之外的全部标签。
 *
 * 「只剩文件路径」这类收窄断言用一条 `toHaveCount(0)` 表达：逐个遍历可见行会在
 * 渐进索引中途拿到半份列表，前面的行刚断言完、后面的行才进 DOM。
 */
const tagsOtherThan = (page: Page, source: string) =>
  page.locator(
    `[data-probe="search-result"] [data-probe="search-source"]:not([data-source="${source}"])`
  );

/**
 * 打开全局搜索面板。
 *
 * 走顶栏按钮而不是 ⌘K：Round CC 起 ⌘K 归**命令面板**（面板里也有「全局搜索」
 * 一条命令）。档位很清楚——快捷键归全局层（`command-palette.spec.ts` 覆盖），
 * 这里只测搜索面板自己，入口越直接越不容易把两件事的失败搅在一起。
 */
async function openPalette(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "全局搜索" }).click();
  const dialog = page.getByRole("dialog", { name: "全局搜索" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("全局搜索", () => {
  test("顶栏按钮唤起与关闭；⌘K 现在开的是命令面板", async ({ page }) => {
    const dialog = await openPalette(page);
    await expect(page.getByLabel("搜索会话记录")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // 同一个快捷键不能再被两个面板抢：⌘K 只开命令面板，搜索面板不动。
    await page.keyboard.press("Meta+K");
    await expect(page.getByRole("dialog", { name: "命令面板" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeHidden();
    await page.keyboard.press("Escape");
  });

  test("搜索命中跨项目消息并按项目分组", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索会话记录").fill("解析");
    // 夹具里 -repo-enhanced（“分析解析器”）与 -repo-usage-days（“先把数据面摸清楚”不含）——
    // 用「解析」至少命中 enhanced；宽松断言组标题出现且命中数可见。
    // 标题印末段（编码前导 `-` 不再直接给用户），完整目录名在 title 上。
    await expect(page.getByText(/条命中/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "repo-enhanced" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "repo-enhanced" })).toHaveAttribute(
      "title",
      "-repo-enhanced"
    );
  });

  test("Enter 跳转：会话打开、记录高亮、详情面板可见", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索会话记录").fill("分析解析器");
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
    await page.getByLabel("搜索会话记录").fill("绝对不存在的词xyz");
    // 零命中的文案在 #147 里统一成一句，并在后面追加条目口径的索引读数。
    await expect(page.locator('[data-probe="search-status"]')).toContainText("没有匹配的记录", {
      timeout: 15_000
    });
  });

  test("命中摘要剥掉终端转义序列：读到的是正文，不是 [33m", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索会话记录").fill("构建失败");

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

test.describe("全局搜索 · 工具输出与报错（#147）", () => {
  test("工具输出：只在 Bash 结果里出现的词命中，标签是「工具输出」", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索会话记录").fill("file two");

    // `file two` 只在 session-parser-enhanced 的 Bash 结果（`ls` 的输出）里出现，
    // 消息、路径、错误三类都没有它——所以这一条命中的来源是确定的。
    const outputRow = resultRows(page)
      .filter({ has: page.locator('[data-probe="search-source"][data-source="tool-output"]') })
      .first();
    await expect(outputRow).toBeVisible({ timeout: 15_000 });
    await expect(sourceTagOf(outputRow)).toHaveText("工具输出");
    // 可访问名 = `{来源}：{片段}`——读屏用户听到的就是「这是工具输出」。
    await expect(outputRow).toHaveAttribute("aria-label", /^工具输出：/);
  });

  test("转义字节不进索引：搜 [31m 零命中，剥过的正文照常搜得到", async ({ page }) => {
    await openPalette(page);
    const input = page.getByLabel("搜索会话记录");

    // ANSI 夹具的工具结果实实在在带着 `\u001b[31m`，但索引里存的是剥过的正文：
    // 转义序列本身不能是「可搜索的内容」，否则每次搜颜色码都会命中一片。
    await input.fill("[31m");
    await expect(statusLine(page)).toContainText("没有匹配的记录", { timeout: 15_000 });
    await expect(resultRows(page)).toHaveCount(0);

    // 断言不只是「搜不到」：同一段输出剥掉转义后是正常正文，必须搜得到，
    // 否则「整条工具结果没进索引」也会让上面那条零命中断言假绿。
    await input.fill("build failed");
    await expect(resultRows(page).first()).toBeVisible({ timeout: 15_000 });

    // 着色行是真彩色那段（`\u001b[38;2;…`），剥完后是普通文本。
    await input.fill("truecolour info line");
    const strippedRow = resultRows(page).first();
    await expect(strippedRow).toBeVisible({ timeout: 15_000 });
    // 用 textContent 而不是 innerText：要断言的就是字节有没有进 DOM，
    // 渲染近似值会把控制字符吃掉，那样这条断言就恒真了。
    const rendered = await strippedRow.evaluate((node) => node.textContent ?? "");
    expect(rendered).toContain("truecolour info line");
    expect(rendered).not.toContain("\u001b");
    expect(rendered).not.toContain("[38;2;");
  });

  test("错误文本：只在报错里出现的词命中，标签是「错误」且回车跳得过去", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索会话记录").fill("command failed");

    // session-errors 里那次失败的 Bash 只有这一句输出（内容与结构化 stderr
    // 同源、同一记录），消息与文件路径都没有它。
    const errorRow = resultRows(page)
      .filter({ has: page.locator('[data-probe="search-source"][data-source="error"]') })
      .first();
    await expect(errorRow).toBeVisible({ timeout: 15_000 });
    await expect(sourceTagOf(errorRow)).toHaveText("错误");

    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeHidden();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    // 落到的是**那条报错记录**，不只是会话：详情面板里就是它的输出正文。
    const detail = page.getByRole(DETAIL_ROLE, { name: DETAIL_NAME });
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(detail).toContainText("command failed");
  });
});

test.describe("全局搜索 · 来源过滤（#147）", () => {
  test("清空「全部」再只留文件路径，消息类命中消失；再点「全部」恢复", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索会话记录").fill("app.ts");

    // `app.ts` 两侧都命中：ansi 夹具的 assistant 正文里有 `src/app.ts:12`，
    // enhanced 夹具的 Read 结果是 `/repo/app.ts`。只有两侧都在，收窄才有意义。
    await expect(resultRows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(tagsOtherThan(page, "file-path")).not.toHaveCount(0);
    await expect(chip(page, "all")).toHaveAttribute("aria-pressed", "true");

    // 「全部」是快捷开关，不是第六个来源：点一次清空。
    await chip(page, "all").click();
    await expect(chip(page, "all")).toHaveAttribute("aria-pressed", "false");
    await expect(statusLine(page)).toContainText("没有匹配的记录", { timeout: 15_000 });
    await expect(resultRows(page)).toHaveCount(0);

    await chip(page, "file-path").click();
    await expect(resultRows(page).first()).toBeVisible({ timeout: 15_000 });
    // 只剩路径档：任何「非文件路径」标签都不该留在结果里。
    await expect(tagsOtherThan(page, "file-path")).toHaveCount(0);

    await chip(page, "all").click();
    await expect(chip(page, "all")).toHaveAttribute("aria-pressed", "true");
    await expect(resultRows(page).first()).toBeVisible();
    await expect(tagsOtherThan(page, "file-path").first()).toBeVisible();
  });

  test("输入糖：`路径:` 前缀只留文件路径档，前缀本身不参与匹配", async ({ page }) => {
    await openPalette(page);
    const input = page.getByLabel("搜索会话记录");
    await input.fill("路径:app.ts");

    await expect(input).toHaveValue("app.ts");
    await expect(chip(page, "file-path")).toHaveAttribute("aria-pressed", "true");
    for (const other of ["user", "assistant", "tool-output", "error"]) {
      await expect(chip(page, other)).toHaveAttribute("aria-pressed", "false");
    }
    await expect(resultRows(page).first()).toBeVisible({ timeout: 15_000 });
    await expect(tagsOtherThan(page, "file-path")).toHaveCount(0);
  });
});

test.describe("全局搜索 · 文件路径（#147，changed-files 夹具）", () => {
  // 默认场景里就有几条路径，但这个夹具的 `src/web/foo.ts` 被反复读写——
  // 「路径命中 → 回车 → 落到那条记录」这条链路用它验。
  test.use({ scenario: changedFilesScenario() });

  test("搜文件路径命中并带「文件路径」标签，回车落到那条记录", async ({ page }) => {
    await openPalette(page);
    await page.getByLabel("搜索会话记录").fill("src/web/foo.ts");

    const pathRow = resultRows(page)
      .filter({ has: page.locator('[data-probe="search-source"][data-source="file-path"]') })
      .first();
    await expect(pathRow).toBeVisible({ timeout: 15_000 });
    await expect(sourceTagOf(pathRow)).toHaveText("文件路径");
    await expect(pathRow).toHaveAttribute("aria-label", /^文件路径：/);

    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "全局搜索" })).toBeHidden();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    // 定位到的是带上这条路径的记录，详情面板里看得到它。
    const detail = page.getByRole(DETAIL_ROLE, { name: DETAIL_NAME });
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(detail).toContainText("foo.ts");
  });
});
