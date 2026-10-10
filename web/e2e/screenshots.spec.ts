import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  test,
  expect,
  toolCensusScenario,
  compactScenario,
  errorScenario,
  changedFilesScenario
} from "./fixtures";
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
 * 把设置浮层滚到底，并等它真的滚到位。
 *
 * 同样的理由，只是滚动容器不同：设置面板是 `position: fixed` + `overflow: auto`，
 * 溢出发生在**面板自己**身上，而它贴在顶栏下方——只拍首屏的话，越靠后的小节
 * 永远进不了归档（本轮新增的「常驻读数」就在最底下）。判据同样是事实而非 sleep。
 */
async function scrollSettingsToBottom(page: Page) {
  const panel = page.getByLabel("阈值设置");
  await panel.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await panel.evaluate(async (el) => {
    // 面板的内容高度会随后面的小节挂载而变（归档读数、更新状态都是异步的），
    // 赋值一次可能落在「还没长高」的瞬间，所以再等一轮：到底了就返回。
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    el.scrollTop = el.scrollHeight;
  });
  await expect
    .poll(async () =>
      panel.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
    )
    .toBe(true);
  await page.waitForTimeout(150);
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
      // 面板下半屏：越靠后的小节（计费窗口之后新增的「常驻读数」等）只拍首屏
      // 永远看不到，归档里得有一张滚到底的。
      await scrollSettingsToBottom(page);
      await shot("settings-below");
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
// 场景用 toolCensusScenario（N3 起多一块「工具与 skill」���板）：默认场景的
// usage 夹具没有任何 tool_use，继续用 recentActivityScenario 会让新面板
// 在归档截图里永远是全空态。该场景窗内只有 census 夹具有工具调用，
// 面板读数是确定值（见 tool-census.spec.ts 的账目）。
test.describe("截图归档 · 用量总览", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: toolCensusScenario() });

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
      // 「工具与 skill」面板（N3）住活跃时段之后：截一张**下钻选中态**——
      // 引导态不是这个面板的常态演示（同改动视图展开首文件的先例）。
      await page.locator("[data-tool-census-row='Bash']").click();
      await expect(page.locator("[data-tool-census-sessions]")).toBeVisible();
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `usage-below-${theme}${suffix}.png`) });
    });
  }
});

// 上下文标签页（Round J）需要「真的发生过压缩」的会话：默认场景八个会话都没有
// compact 边界，截出来的上下文页只有空态。这里用 compactScenario（默认场景 +
// /repo/compact-demo），同一轮里顺带补两张：含压缩行的日志视图（第七种行类型的
// 真实排版，analyzer-log 继续验证无压缩的基础形态）与无压缩会话的上下文空态
// （「有数据的零」，不是空盒子）。
test.describe("截图归档 · 上下文", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: compactScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`上下文标签页 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;
      const shot = async (view: string) => {
        await settleImages(page);
        await page.screenshot({ path: path.join(OUT_DIR, `${view}-${theme}${suffix}.png`) });
      };

      await page.goto("/");
      await page.getByPlaceholder("搜会话 ID 或目录…").fill("compact-demo");
      await sessionItems(page).first().click();
      await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
      await page.waitForTimeout(300);

      // 含压缩行的日志视图：打开会话默认落在日志视图。夹具 251 行，超出窗口化
      // 阈值（120）——不滚过去，压缩带行根本不在渲染窗口里；而带行不在表尾
      // （其后还有第三段对话），一步滚到底也见不到。按视口步进滚，每步给窗口
      // 化一拍重算时间，见到任一带行即停。滚动容器是 table 的父级（与
      // PROBE_JS 同一个结构事实）。
      for (let step = 0; step < 20; step += 1) {
        if (await page.getByText(/压缩 #\d（(自动|手动)）/, { exact: false }).count()) break;
        await page.evaluate(() => {
          const table = document.querySelector("main table");
          const scroller = table?.parentElement;
          if (scroller) {
            scroller.scrollTop = Math.min(
              scroller.scrollTop + scroller.clientHeight,
              scroller.scrollHeight
            );
          }
        });
        await page.waitForTimeout(120);
      }
      await expect(page.getByText(/压缩 #\d（(自动|手动)）/).first()).toBeVisible();
      await shot("analyzer-log-compact");

      // 上下文标签页 · 含压缩会话：点第 2 枚事件 chip 打开取证卡（截图要有
      // 「选中态」的样子，引导行不是这个视图的常态演示）。
      await page.getByRole("tab", { name: "上下文" }).click();
      await expect(page.getByRole("img", { name: /上下文压力：120 条模型消息/ })).toBeVisible();
      const panel = page.getByRole("region", { name: "压缩事件" });
      await panel.getByRole("button", { name: /#2 / }).click();
      await expect(panel.getByText("被丢出上下文的内容 · 82 条")).toBeVisible();
      await page.waitForTimeout(250);
      await shot("context");

      // 上下文标签页 · 无压缩会话：换到 /repo/demo（session-basic，有 usage、
      // 无压缩）。子视图随页面状态保持在「上下文」，无需再点。搜索词用带斜杠的
      // 完整 cwd——只搜 "demo" 会把 /repo/compact-demo 也筛进来，点到谁看排序。
      await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/demo");
      await sessionItems(page).first().click();
      await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
      await expect(page.getByRole("img", { name: /未发生压缩/ })).toBeVisible();
      await expect(page.getByText("本会话未发生压缩——上下文从未重置")).toBeVisible();
      await page.waitForTimeout(250);
      await shot("context-empty");
    });
  }
});

// 错误档（Round N / N1）需要「真的有过失败」的会话：errorScenario 在默认场景
// 上挂 /repo/error-demo（两个自然日、API 3 + 工具 4 + 一条 sidechain 失败）。
// 两张：首屏（KPI 行 + 趋势主角）与滚到底（两个分布切面 + 事件列表）。
test.describe("截图归档 · 错误档", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: errorScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`错误档 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.goto("/");
      await page.getByRole("tab", { name: "用量总览" }).click();
      await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
      await page.getByRole("tab", { name: "错误", exact: true }).click();
      await expect(page.getByLabel("跨会话错误分析")).toBeVisible();
      await expect(page.getByText(/全部 7 条 · 时间倒序/)).toBeVisible();
      await page.waitForTimeout(300);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `error-view-${theme}${suffix}.png`) });

      await scrollMainToBottom(page);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `error-events-${theme}${suffix}.png`) });
    });
  }
});

// 改动标签页（Round N / N2）需要「真的动过文件」的会话：changedFilesScenario
// 挂 /repo/changed-demo（三个文件：新建 + 失败 + 子链 + 项目外路径俱全）。
// 一张：展开首文件后的完整形态（行、徽标、展开区记录清单与口径脚注）——
// 空态由 e2e 断言覆盖，不另入截图矩阵。
test.describe("截图归档 · 改动", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: changedFilesScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`改动标签页 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.goto("/");
      await page.getByPlaceholder("搜会话 ID 或目录…").fill("changed-demo");
      await sessionItems(page).first().click();
      await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
        timeout: 15_000
      });
      await page.getByRole("tab", { name: "改动", exact: true }).click();
      await expect(page.getByRole("region", { name: "改动文件" })).toBeVisible();
      // 展开首文件：截图要有展开区的样子（小结行 + 记录清单），引导态不是常态。
      await page
        .getByRole("region", { name: "改动文件" })
        .getByRole("button", { name: /src\/web\/foo\.ts/ })
        .click();
      await expect(
        page.getByRole("region", { name: "改动文件" }).locator("[data-changes-records]")
      ).toBeVisible();
      await page.waitForTimeout(250);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `changed-files-${theme}${suffix}.png`) });
    });
  }
});
