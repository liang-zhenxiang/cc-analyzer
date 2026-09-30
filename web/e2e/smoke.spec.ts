import type { Page } from "@playwright/test";
import { test, expect, emptyScenario } from "./fixtures";

/**
 * 冒烟覆盖：应用能不能起来、会话能不能被发现、主视图能不能切换。
 *
 * 这一层刻意只断言「用户看得见的结果」，不碰实现细节——
 * 它要在重构（包括视觉重做）时保持稳定。
 */

/**
 * 会话条目。用 `title` 定位而不是 `button:has(strong)`——
 * 后者会把分组折叠按钮一起算进来（它也含 `<strong>`），
 * 于是「5 个会话」的断言会拿到 6，看着像功能坏了，其实是选择器写宽了。
 * 会话条目带 `title={cwd ?? path}`，这是给用户看的路径提示，语义正好。
 */
function sessionItems(page: Page) {
  return page.getByLabel("会话列表").locator("button[title]");
}

test.describe("会话分析", () => {
  test("启动后列出磁盘上的全部会话", async ({ page }) => {
    await page.goto("/");

    const list = page.getByLabel("会话列表");
    await expect(list).toBeVisible();

    // 五个夹具项目 → 五条会话
    await expect(sessionItems(page)).toHaveCount(5);
    // 列表不该出现错误提示
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("选中会话后日志视图与树视图都能渲染", async ({ page }) => {
    await page.goto("/");

    await sessionItems(page).first().click();

    const logTab = page.getByRole("tab", { name: "日志视图" });
    const treeTab = page.getByRole("tab", { name: "树视图" });
    await expect(logTab).toHaveAttribute("aria-selected", "true");

    await treeTab.click();
    await expect(treeTab).toHaveAttribute("aria-selected", "true");
    await expect(logTab).toHaveAttribute("aria-selected", "false");
  });

  test("会话图加载完成后给出已加载状态", async ({ page }) => {
    await page.goto("/");

    await sessionItems(page).first().click();

    // 状态行由「加载中…」变成「已加载 · N 个会话」，等它落定
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
  });

  test("时间线与项目两种分组可以切换", async ({ page }) => {
    await page.goto("/");

    const timeline = page.getByRole("tab", { name: "时间线" });
    const byProject = page.getByRole("tab", { name: "项目" });

    await expect(timeline).toHaveAttribute("aria-selected", "true");
    await byProject.click();
    await expect(byProject).toHaveAttribute("aria-selected", "true");
  });

  test("搜索可以筛掉不匹配的会话", async ({ page }) => {
    await page.goto("/");
    await expect(sessionItems(page)).toHaveCount(5);

    // 夹具里有一个项目叫 -repo-subagent
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("subagent");
    await expect(sessionItems(page)).toHaveCount(1);
  });
});

test.describe("页面切换", () => {
  test("可以切到实时监控再切回来", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("tab", { name: "实时监控" }).click();
    await expect(page.getByRole("tab", { name: "实时监控" })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "会话分析" }).click();
    await expect(page.getByRole("tab", { name: "会话分析" })).toHaveAttribute("aria-selected", "true");
  });

  test("设置面板可以开合", async ({ page }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: "设置" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("主题可以在深浅之间切换", async ({ page }) => {
    await page.goto("/");

    const toggle = page.getByRole("button", { name: "切换主题" });
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await toggle.click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
  });
});

test.describe("空状态", () => {
  test.use({ scenario: emptyScenario() });

  test("没有任何会话时给出空列表而不是报错", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByLabel("会话列表")).toBeVisible();
    await expect(sessionItems(page)).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});

/**
 * 布局不变量。这些只有在真实排版引擎里才成立——
 * jsdom 没有布局，同样的断言在那里只会拿到一串空字符串。
 */
test.describe("视口与布局", () => {
  test("未选会话时空状态在主区垂直居中，且没有虚线框", async ({ page }) => {
    await page.goto("/");

    const title = page.getByText("选择一个会话开始分析");
    await expect(title).toBeVisible();

    const main = await page.getByRole("main").boundingBox();
    const box = await title.locator("xpath=..").boundingBox();
    expect(main).not.toBeNull();
    expect(box).not.toBeNull();

    // 垂直居中：空状态盒子的中线应落在主区中线上。
    const emptyCenter = box!.y + box!.height / 2;
    const mainCenter = main!.y + main!.height / 2;
    expect(Math.abs(emptyCenter - mainCenter)).toBeLessThan(20);

    // 虚线框是「既没撑满、里面又什么都没有」的画法，已经被移除。
    const borderStyle = await title
      .locator("xpath=..")
      .evaluate((element) => getComputedStyle(element).borderTopStyle);
    expect(borderStyle).not.toBe("dashed");
  });

  test("选中会话后日志表格在内部滚动，页面本身不出现滚动条", async ({ page }) => {
    await page.goto("/");
    await sessionItems(page).first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    // 表格容器吸收剩余高度并在内部滚动。窗口化的表格一旦不能滚动，
    // 就永远只看得见第一屏——这条不变量原先由 useViewportCap 用 JS 兜着，
    // 布局修好后由 CSS 承担，所以断言也从单测搬到了这里。
    const scrollBox = await page.getByRole("main").locator("table").first().locator("xpath=..").boundingBox();
    expect(scrollBox).not.toBeNull();
    expect(scrollBox!.height).toBeGreaterThan(240);
    expect(scrollBox!.y + scrollBox!.height).toBeLessThanOrEqual(900);

    const overflow = await page.evaluate(() => {
      const content = document.querySelector("main");
      return {
        document: document.documentElement.scrollHeight - window.innerHeight,
        content: content ? content.scrollHeight - content.clientHeight : 0
      };
    });
    expect(overflow.document).toBeLessThanOrEqual(1);
    expect(overflow.content).toBeLessThanOrEqual(1);
  });
});

test.describe("夹具健全性", () => {
  test("默认场景装载了预期数量的会话", ({ scenario }) => {
    // 防止夹具被改坏后，上面那些计数断言静默变成「断言 0 等于 0」
    const jsonl = Object.keys(scenario.files).filter((f) => f.endsWith(".jsonl"));
    expect(jsonl).toHaveLength(5);
    for (const file of jsonl) {
      expect(file).toContain("/.claude/projects/");
    }
  });
});
