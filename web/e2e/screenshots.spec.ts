import { mkdirSync } from "node:fs";
import path from "node:path";
import { test, expect, recentActivityScenario } from "./fixtures";
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
 * 浅色 + 深色两张」（会话分析空态/日志/树/报告、设置、实时监控、用量总览），
 * 手截的图过一轮就会和代码对不上，而且没人能复现出上一版是怎么截的。
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

/**
 * 把内容区（`main`，页面自己的滚动容器）滚到底，并等它**真的滚到位**。
 *
 * 用途是「下半屏」视图：用量页与报告页的溢出都发生在 main 内部，视口截图
 * 默认只拍到前一段。判据是事实（scrollTop + clientHeight 追上 scrollHeight）
 * 而不是 sleep——项目没有 `scroll-behavior: smooth`，赋值本应同步到位，
 * 这个等待防的是「布局晚一拍才把高度撑开」的过渡态。
 */
async function scrollMainToBottom(page: Page) {
  await page.locator("main").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForFunction(() => {
    const el = document.querySelector("main");
    return el !== null && el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
  });
  await page.waitForTimeout(150);
}

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

/**
 * 等页面上的图片真正解码完再截。
 *
 * 不等的话会截到「品牌图标是个空方块」的那一帧：`BrandMark` 是张 PNG，
 * DOM 里 `img` 已经在了，但位图还没解出来。这种缺陷**看不出来是缺陷**——
 * 图有了、尺寸也对，只是内容还没到，所以它会静静地进到仓库和 README 里。
 * 实测曾在 `analyzer-empty-*.png` 上发生过。
 */
async function settleImages(page: Page) {
  await page.waitForFunction(
    () => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0)
  );
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
      const shot = async (view: string) => {
        await settleImages(page);
        await page.screenshot({ path: path.join(OUT_DIR, `${view}-${theme}${suffix}.png`) });
      };

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

      // 报告正文按内容走，视口装不下时从视口下沿起——再滚到页面底部截一张，
      // 归档里才看得到报告本体（`analyzer-report` 拍的是生成后的首屏布局）。
      await scrollMainToBottom(page);
      await shot("analyzer-report-full");

      // 设置面板
      await page.getByRole("button", { name: "设置" }).click();
      await page.waitForTimeout(250);
      await shot("settings");
      await page.getByRole("button", { name: "设置" }).click();

      // 实时监控 —— 截的是**未打开**的默认态，也就是用户切进来第一眼看到的样子。
      // 不点「打开监控」：那个仪表盘服务不在本仓库内、夹具里也没在跑，
      // 点下去只会得到一张三次重试之后的失败态，而失败态不是这个页面的常态。
      await page.getByRole("tab", { name: "实时监控" }).click();
      await expect(page.getByRole("button", { name: "打开监控" })).toBeVisible();
      await page.waitForTimeout(250);
      await shot("monitor");
    });
  }
});

// 用量总览需要「最近真的有活动」才有内容可截：仪表盘的时间窗相对
// Date.now()，夹具的固定时间戳会随着日子过去掉出窗外，截出一排空图。
// 这里单独用平移后的场景（recentActivityScenario），并等扫描收口再截。
test.describe("截图归档 · 用量总览", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: recentActivityScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`用量总览 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.goto("/");
      await page.getByRole("tab", { name: "用量总览" }).click();
      // 等扫描收口成统计口径，避免截到「已分析 3 / 7」的中间帧。
      await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(300);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `usage-${theme}${suffix}.png`) });

      // 下半屏：三块面板（按项目分布 / 按模型分布 / 活跃时段）的内容与热力图
      // 整块在折叠线以下——视口截图从不滚动，它们因此从未进入归档、从未进入
      // 任何一次视觉验收（评审 §2 的方法论缺口，本视图存在的理由）。
      await scrollMainToBottom(page);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `usage-below-${theme}${suffix}.png`) });
    });
  }
});
