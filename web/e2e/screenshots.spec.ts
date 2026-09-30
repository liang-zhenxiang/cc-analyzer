import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 把主要界面的浅色 / 深色截图归档到 `docs/screenshots/`。
 *
 * **默认不跑**：CI 上的 `npm run test:e2e` 会跳过它，产物也不该由 CI 写。
 * 需要在改完视觉后重新出图时：
 *
 *     SCREENSHOTS=1 npm --prefix web run test:e2e
 *
 * 为什么要有这个脚本而不是手动截图：视觉验收要求「每个主要界面都有
 * 浅色 + 深色两张、共 12 张」，手截的图过一轮就会和代码对不上，
 * 而且没人能复现出上一版是怎么截的。
 */

const OUT_DIR = path.resolve(process.cwd(), "..", "docs", "screenshots");

/** 主题在 ThemeProvider 初始化时读 localStorage，所以要在页面脚本之前埋好。 */
async function useTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("cca-theme", value as string);
    } catch {
      // 隐私模式下 localStorage 可能不可用；截图脚本不必为此中断。
    }
  }, theme);
}

function sessionItems(page: Page) {
  return page.getByLabel("会话列表").locator("button[title]");
}

async function openFirstSession(page: Page) {
  await sessionItems(page).first().click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
  // 让树视图的布局稳定下来，避免截到过渡中的一帧。
  await page.waitForTimeout(300);
}

test.describe("截图归档", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`主要界面 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      // 引擎名进文件名：macOS 上应用跑的是 WKWebView，所以要留下 WebKit 那一份。
      // chromium 不加后缀，README 引用的是它。
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;
      const shot = (view: string) =>
        page.screenshot({ path: path.join(OUT_DIR, `${view}-${theme}${suffix}.png`) });

      await page.goto("/");
      // 会话分析 · 空态
      await shot("analyzer-empty");

      await openFirstSession(page);
      // 会话分析 · 日志视图（已选会话）
      await shot("analyzer-log");

      await page.getByRole("tab", { name: "树视图" }).click();
      await page.waitForTimeout(250);
      await shot("analyzer-tree");

      // 会话分析 · 报告面板（真的跑一次生成，而不是截占位文案）
      await page.getByRole("tab", { name: "日志视图" }).click();
      await page.getByRole("button", { name: /生成整会话分析/ }).click();
      await page.waitForTimeout(900);
      await shot("analyzer-report");

      // 设置面板
      await page.getByRole("button", { name: "设置" }).click();
      await page.waitForTimeout(250);
      await shot("settings");
      await page.getByRole("button", { name: "设置" }).click();

      // 实时监控
      await page.getByRole("tab", { name: "实时监控" }).click();
      await page.waitForTimeout(3_000);
      await shot("monitor");
    });
  }
});
