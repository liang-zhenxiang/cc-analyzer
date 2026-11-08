import { test, expect, recentActivityScenario } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 数据故事（Chronicle，Issue #313）端到端：
 *
 * 1. 切到「故事」档要看到真正的章节（≥3 章、第 1 章在最前）；
 * 2. 导出 Markdown 落盘，且**转发物不带绝对路径**——故事会被带出本机，
 *    隐私边界必须在生成侧守住。
 *
 * 空态（<3 章）由 ChroniclePanel 的组件测试覆盖：整页空态出现在档位标签
 * 之前，e2e 到不了故事档，硬造场景只会测出「整页空态」而不是组件空态。
 */

const SAVED = "/Users/e2e/out/story.md";

function writtenFiles(page: Page) {
  return page.evaluate(() => {
    const log =
      (window as unknown as { __CCA_E2E_LOG__?: Array<{ op: string; args: unknown[] }> })
        .__CCA_E2E_LOG__ ?? [];
    return log
      .filter((entry) => entry.op === "write_text")
      .map((entry) => entry.args[0] as { path: string; contents: string });
  });
}

// 夹具的最新活动必须落在「昨天」：Chronicle 吃的是页面 30 天窗口，
// 固定日期的默认场景在今天已经整体滚出窗外（会得到空故事）。
test.use({ scenario: recentActivityScenario({ savePath: SAVED }) });

test("故事档：章节顺序、导出 Markdown 与隐私边界", { tag: "@chronicle" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "故事" }).click();

  const story = page.getByRole("region", { name: "数据故事" });
  await expect(story).toBeVisible();

  const chapters = story.locator("[data-chapter-id]");
  expect(await chapters.count()).toBeGreaterThanOrEqual(3);
  await expect(chapters.first()).toContainText("第 1 章");
  // 大数字是章节的视觉重心：每章都必须有一个量级读数。
  await expect(chapters.first()).toContainText(/\d/);

  await page.locator('[data-probe="chronicle-export"]').click();
  await expect(page.getByText("已导出数据故事")).toBeVisible();

  const saved = (await writtenFiles(page)).at(-1);
  expect(saved?.path).toBe(SAVED);
  const markdown = saved?.contents ?? "";
  expect(markdown.startsWith("# 数据故事 · 近 30 天")).toBe(true);
  expect(markdown).toContain("第 1 章");
  // 转发物红线：不带应用自己的绝对路径与会话目录结构。
  expect(markdown).not.toContain("/Users/e2e");
  expect(markdown).not.toContain(".claude/projects");
});

test("故事档：区间控件保留，切回用量档故事卸载", { tag: "@chronicle" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "故事" }).click();
  await expect(page.getByRole("region", { name: "数据故事" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "时间范围" })).toBeVisible();

  await page.getByRole("tab", { name: "用量", exact: true }).click();
  await expect(page.getByRole("region", { name: "数据故事" })).toHaveCount(0);
  await expect(page.getByText("Tokens 总量").first()).toBeVisible();
});
