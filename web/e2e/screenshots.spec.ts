import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  test,
  expect,
  APP_VERSION,
  compactScenario,
  costScenario,
  roundCCScenario,
  roundCCAlphaPath,
  errorScenario,
  changedFilesScenario,
  calendarScenario,
  pulseScenario,
  monitorConsoleScenario,
  MONITOR_CONSOLE_NOW
} from "./fixtures";
import { milestonesScenario } from "../tests/fixtures/milestones-scenario";
import { sessionItems } from "./selectors";
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

/**
 * 截图视图清单的**单一权威**：`docs/screenshots/views.json`（仓库根相对路径）。
 *
 * 在这之前视图清单硬编码在**三处**（本文件、`scripts/check-screenshots.sh` 的
 * `EXPECTED_VIEWS`、`scripts/check-screenshots-test.sh` 的假基线 `views`），
 * 新增/改名/下线一个视图要逐项手工对齐。Issue #196 记录了这个坑：#193 加
 * `usage-day` 时前两处同步了、第三处漏了，CI 上「视觉基线一致性」5 秒即红，
 * 而且第一眼看起来像检查脚本自己坏了；N1 加 `error-*` 时踩的是同一个坑。
 *
 * **为什么是 JSON 而不是 TS**：消费方跨越两个运行时——TypeScript（Playwright
 * 的 spec，跑在 node 里）与 shell（两个检查脚本，用 python3 解析）。JSON 是
 * 两个世界都能直接读的最小公约数；若权威是 `.ts`，shell 侧就得靠「内联执行
 * TypeScript」这类额外手段（要么引入依赖、要么自己剥语法），正好违反本项目
 * 「不引入新的 npm 依赖」。JSON 是本文件用 `readFileSync` 读、脚本用
 * `json.load` 读，两边都不需要编译步骤。
 *
 * 用 `import.meta.url` 定位而不是 `process.cwd()`：spec 由 Playwright 从
 * `testDir` 加载，cwd 未必是 `web/`（`-c` 传绝对路径时就不是）。这样写与
 * cwd 无关，`--list` 与真实执行两条路径解析到同一份文件。
 */
const VIEWS_MANIFEST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "docs",
  "screenshots",
  "views.json"
);

/**
 * 读取权威清单。读不到或形状不对就抛错：仓库完整时这条路径不该有降级，
 * 静默降级只会把「清单没被读到」重新藏成「检查通过」。
 */
function readViewManifest(): readonly string[] {
  const parsed: unknown = JSON.parse(readFileSync(VIEWS_MANIFEST, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("views" in parsed)) {
    throw new Error(`${VIEWS_MANIFEST} 缺少 views 字段`);
  }
  const views = (parsed as { views: unknown }).views;
  if (!Array.isArray(views) || views.length === 0) {
    throw new Error(`${VIEWS_MANIFEST} 的 views 必须是非空数组`);
  }
  const seen = new Set<string>();
  for (const view of views) {
    if (typeof view !== "string" || view === "") {
      throw new Error(`${VIEWS_MANIFEST} 的 views 里有非字符串或空串项`);
    }
    if (seen.has(view)) {
      throw new Error(`${VIEWS_MANIFEST} 的 views 里有重复项：${view}`);
    }
    seen.add(view);
  }
  return views as readonly string[];
}

/** 权威清单里的全部视图名——check-screenshots.sh 的 EXPECTED_VIEWS 就是它。 */
export const ALL_VIEWS: readonly string[] = readViewManifest();

/**
 * 本文件**真正声明**了 test / test.skip 的视图名，按声明顺序登记。
 *
 * 这是「清单 ↔ spec」这一环的机器可读证据。`describe` 回调在收集阶段一定会跑
 * （`test.skip()` 只影响执行，不影响收集），所以这里登记是可靠的。
 *
 * `scripts/check-screenshots.sh` 用同一份 views.json、并以正则扫本文件的
 * `declareView("…")` 做**双向**对齐复核——因为 CI 的 screenshots-baseline job
 * 只跑 shell 检查、不跑 Playwright，本文件末尾那条同语义的断言在 CI 里是
 * skipped。两边语义一致，shell 侧那条才是 CI 真正生效的门禁。
 */
const declaredViews: string[] = [];

/**
 * 登记一个视图名，并返回它——调用点写成「常量 = 本函数(名字字面量)」的形态，
 * 就能把字符串字面量收敛成一处常量，改名只需改权威清单 + 那个常量。
 *
 * 注意：`scripts/check-screenshots.sh` 用正则扫本文件提取视图名，模式要求
 * 「= 本函数(小写名字字面量)」。所以（1）传参必须是字面量，不能用变量或模板串；
 * （2）**文档注释里不要写出完整的调用示例**——示例会被正则当成真声明扫进来，
 * 报出「声明了不在清单里的视图」这种假警报（实测踩过）。这也是这段注释用
 * 描述性措辞、不写代码样例的原因。
 */
function declareView(view: string): string {
  if (declaredViews.includes(view)) {
    throw new Error(`视图 ${view} 在本文件里被声明了两次——每次出图只该有一个声明`);
  }
  declaredViews.push(view);
  return view;
}

// 各视图的常量声明。每个名字都必须在权威清单里（由 shell 侧与末尾断言守着）。
const V_ANALYZER_EMPTY = declareView("analyzer-empty");
const V_ANALYZER_LOG = declareView("analyzer-log");
const V_ANALYZER_TREE = declareView("analyzer-tree");
const V_ANALYZER_REPORT = declareView("analyzer-report");
const V_ANALYZER_REPORT_FULL = declareView("analyzer-report-full");
const V_SETTINGS = declareView("settings");
const V_SETTINGS_BELOW = declareView("settings-below");
const V_MONITOR = declareView("monitor");
const V_USAGE = declareView("usage");
const V_USAGE_BELOW = declareView("usage-below");
const V_ANALYZER_LOG_COMPACT = declareView("analyzer-log-compact");
const V_CONTEXT = declareView("context");
const V_CONTEXT_EMPTY = declareView("context-empty");
const V_ERROR_VIEW = declareView("error-view");
const V_ERROR_EVENTS = declareView("error-events");
const V_CHANGED_FILES = declareView("changed-files");
const V_USAGE_DAY = declareView("usage-day");
const V_PULSE = declareView("pulse");
const V_PULSE_FLOAT = declareView("pulse-float");
const V_MILESTONES = declareView("milestones");
const V_MONITOR_CONSOLE = declareView("monitor-console");

// 出血点标签页（Round X）。与其余视图一样显式写成「常量 = declareView(字面量)」
// 的形态——不能从某张表的键里循环：check-screenshots.sh 的正则只认这种形态，
// 循环调用会让该视图被误报成「清单里有、spec 没声明」。
const V_BLEED = declareView("bleed");
// 重放（Round AA）
const V_REPLAY = declareView("replay");
// Round CC：用量页六块新面板 + 命令面板 / 大屏 / 图钉
const V_DIGEST = declareView("digest");
const V_FLOW = declareView("flow");
const V_ARENA = declareView("arena");
const V_CLOCK = declareView("clock");
const V_FORECAST = declareView("forecast");
const V_CARDS = declareView("cards");
const V_CLUSTERS = declareView("clusters");
const V_PINS = declareView("pins");
const V_PALETTE = declareView("palette");
const V_KIOSK = declareView("kiosk");
// 会话账单（Round BB）
const V_COST = declareView("cost");

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
      await shot(V_ANALYZER_EMPTY);

      await openFirstSession(page);
      // 会话分析 · 日志视图（已选会话）
      await shot(V_ANALYZER_LOG);

      await page.getByRole("tab", { name: "树视图" }).click();
      await page.waitForTimeout(250);
      await shot(V_ANALYZER_TREE);

      // 会话分析 · 报告面板（真的跑一次生成，而不是截占位文案）
      await page.getByRole("tab", { name: "日志视图" }).click();
      await page.getByRole("button", { name: /生成整会话分析/ }).click();
      await page.waitForTimeout(900);
      await shot(V_ANALYZER_REPORT);

      // 报告正文按内容走，视口装不下时从视口下沿起——再滚到页面底部截一张，
      // 归档里才看得到报告本体（`analyzer-report` 拍的是生成后的首屏布局）。
      await scrollMainToBottom(page);
      await shot(V_ANALYZER_REPORT_FULL);

      // 设置面板
      await page.getByRole("button", { name: "设置" }).click();
      await page.waitForTimeout(250);
      await shot(V_SETTINGS);
      // 面板下半屏：越靠后的小节（计费窗口之后新增的「常驻读数」等）只拍首屏
      // 永远看不到，归档里得有一张滚到底的。
      await scrollSettingsToBottom(page);
      await shot(V_SETTINGS_BELOW);
      await page.getByRole("button", { name: "设置" }).click();

      // 实时监控 —— 截的是**未打开**的默认态，也就是用户切进来第一眼看到的样子。
      // 不点「打开监控」：那个仪表盘服务不在本仓库内、夹具里也没在跑，
      // 点下去只会得到一张三次重试之后的失败态，而失败态不是这个页面的常态。
      // Issue #203 起这个标签默认是原生「脉搏」，所以先切到「外部仪表盘」子视图——
      // 这张 `monitor` 归档的仍是 dashboard 档未打开的形态（脉搏另有 `pulse` 视图）。
      await page.getByRole("tab", { name: "实时监控" }).click();
      await page.getByRole("tab", { name: "外部仪表盘" }).click();
      await expect(page.getByRole("button", { name: "打开监控" })).toBeVisible();
      await page.waitForTimeout(250);
      await shot(V_MONITOR);
    });
  }
});

// 用量总览需要「最近真的有活动」才有内容可截：仪表盘的时间窗相对
// Date.now()，夹具的固定时间戳会随着日子过去掉出窗外，截出一排空图。
// Round CC 起场景换成 roundCCScenario：用量页现在有周战报 / 流向图 / 擂台 /
// 项目卡片 / 时钟 / 预报六块新面板，必须有「多项目、跨两周、有错误」的数据才
// 不是一排空盒。旧 toolCensusScenario 里的工具普查演示因此不在这一档（census
// 自身仍有 tool-census.spec.ts 与单测覆盖）。
test.describe("截图归档 · 用量总览", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: roundCCScenario() });

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
      await page.screenshot({ path: path.join(OUT_DIR, `${V_USAGE}-${theme}${suffix}.png`) });

      // 下半屏：项目卡片 / 消耗日历 / 流向图 / 活跃时段都住在折叠线以下——
      // 视口截图从不滚动，它们因此从未进入归档、从未进入任何一次视觉验收。
      await scrollMainToBottom(page);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_USAGE_BELOW}-${theme}${suffix}.png`) });
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
      await shot(V_ANALYZER_LOG_COMPACT);

      // 上下文标签页 · 含压缩会话：点第 2 枚事件 chip 打开取证卡（截图要有
      // 「选中态」的样子，引导行不是这个视图的常态演示）。
      await page.getByRole("tab", { name: "上下文" }).click();
      await expect(page.getByRole("img", { name: /上下文压力：120 条模型消息/ })).toBeVisible();
      const panel = page.getByRole("region", { name: "压缩事件" });
      await panel.getByRole("button", { name: /#2 / }).click();
      await expect(panel.getByText("被丢出上下文的内容 · 82 条")).toBeVisible();
      await page.waitForTimeout(250);
      await shot(V_CONTEXT);

      // 上下文标签页 · 无压缩会话：换到 /repo/demo（session-basic，有 usage、
      // 无压缩）。子视图随页面状态保持在「上下文」，无需再点。搜索词用带斜杠的
      // 完整 cwd——只搜 "demo" 会把 /repo/compact-demo 也筛进来，点到谁看排序。
      await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/demo");
      await sessionItems(page).first().click();
      await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
      await expect(page.getByRole("img", { name: /未发生压缩/ })).toBeVisible();
      await expect(page.getByText("本会话未发生压缩——上下文从未重置")).toBeVisible();
      await page.waitForTimeout(250);
      await shot(V_CONTEXT_EMPTY);
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
      await page.screenshot({ path: path.join(OUT_DIR, `${V_ERROR_VIEW}-${theme}${suffix}.png`) });

      await scrollMainToBottom(page);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_ERROR_EVENTS}-${theme}${suffix}.png`) });
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
      await page.screenshot({ path: path.join(OUT_DIR, `${V_CHANGED_FILES}-${theme}${suffix}.png`) });
    });
  }
});

// 一日回望（Round V · 第二棒，#192）需要「今天真的有会话」的夹具：
// calendarScenario() 给今天排了四个会话（跨午夜一条 + 09:20 / 13:05 / 18:40），
// 展开今天格就得到日摘要 + 24h 时间线。
// 同一份夹具也被 usage-calendar.spec.ts 用来打几何与交互断言——截图只是把同一
// 形态归档，不另造数据。视图名 `usage-day` 与 check-screenshots.sh 的独立清单
// 一一对应（两处必须同步，否则 lint 报「截图套缺视图」）。
test.describe("截图归档 · 一日回望", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: calendarScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`一日回望 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.goto("/");
      await page.getByRole("tab", { name: "用量总览" }).click();
      // 等扫描收口成统计口径，避免截到「已分析 3 / 7」的中间帧。
      await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });

      await page.locator('[data-probe="calendar-today"] button').click();
      await expect(page.locator('[data-probe="day-summary"]')).toBeVisible();
      await expect(page.locator('[data-probe="day-timeline"]')).toBeVisible();

      // 整个日历面板 + 展开区落在一屏内：把 main 滚到日历网格顶之上 8px。
      // 用事实量（两个矩形之差），而不是猜一个 offsetTop——网格的 offsetParent
      // 未必是 main。
      await page.locator("main").evaluate((el) => {
        const panel = el.querySelector("[data-usage-calendar]");
        if (!panel) return;
        const elRect = el.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        el.scrollTop += panelRect.top - elRect.top - 8;
      });
      // 布局晚一拍才定高的话，这一拍之后再截，防的是过渡态。
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))
          )
      );
      await page.waitForTimeout(150);

      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_USAGE_DAY}-${theme}${suffix}.png`) });
    });
  }
});

// 实时脉搏（Issue #203）要一份「此刻真的有活动」的夹具：pulseScenario() 的三个会话
// 按 mtime 分成 live / recent / idle，5 小时窗口与三档新近度都相对 Date.now() 现算
// ——用固定日期的默认场景会让它们随日历漂出窗外，截出一页空态。
// 两张：主窗首屏与 420×620 浮窗态。live 档心跳是**无限循环**，出图前必须把动画关掉
// （prefers-reduced-motion 走 global.css 的全局归零），否则归档 PNG 会随机停在某一帧，
// 同一份代码每次出图都不一样（规格 §13.2-2 的裁决）。
test.describe("截图归档 · 实时脉搏", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  // 顶栏版本徽章读桩的 `updater`；`pulseScenario` 以 `emptyScenario` 打底、没带它，
  // 不覆盖就会把 `v0.0.0-mock` 印进 README 门面图（其它归档场景也都喂了 APP_VERSION）。
  test.use({ scenario: pulseScenario({ updater: { currentVersion: APP_VERSION } }) });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`实时脉搏 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.emulateMedia({ reducedMotion: "reduce" });

      await page.goto("/");
      await page.getByRole("tab", { name: "实时监控" }).click();
      await expect(page.locator("[data-probe='pulse-page']")).toHaveAttribute("data-state", "fresh", {
        timeout: 15_000
      });
      await page.waitForTimeout(300);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_PULSE}-${theme}${suffix}.png`) });

      // 浮窗态 + 真实浮窗尺寸（后端常量 420×620）。
      await page.getByRole("button", { name: "悬浮" }).click();
      await expect(page.locator("[data-probe='pulse-float-head']")).toBeVisible();
      await page.setViewportSize({ width: 420, height: 620 });
      await page.waitForTimeout(300);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_PULSE_FLOAT}-${theme}${suffix}.png`) });
    });
  }
});

/*
 * 监控台（Issue #225）要一份「今天真的有三个项目、三种事件」的夹具：
 * `monitorConsoleScenario()` 给 2,200 token、3 个活跃会话、2 次压缩与 2 条错误。
 * 四个读数在首屏同排出现，项目榜和事件流也都有确定内容；错误正文带绝对路径，
 * 截图前同时断言页面源码里已脱敏。
 */
test.describe("截图归档 · 监控台", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: monitorConsoleScenario({ updater: { currentVersion: APP_VERSION } }) });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`监控台 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.clock.setFixedTime(MONITOR_CONSOLE_NOW);

      await page.goto("/");
      await page.getByRole("tab", { name: "实时监控" }).click();
      await page.getByRole("tab", { name: "监控台" }).click();
      const view = page.locator("[data-probe='monitor-console-page']");
      await expect(view).toHaveAttribute("data-state", "fresh", { timeout: 15_000 });
      await expect(page.locator("[data-probe='monitor-console-readout']")).toHaveCount(4);
      await expect(page.locator("[data-probe='monitor-console-project-row']")).toHaveCount(3);
      await expect(page.locator("[data-probe='monitor-console-event-row']")).not.toHaveCount(0);

      // 截图与 DOM 都不该包含夹具里的真实路径形状。
      const rendered = await view.evaluate((node) => `${node.textContent}\n${node.innerHTML}`);
      expect(rendered).not.toContain("/Users/");
      expect(rendered).not.toContain("/home/");
      expect(rendered).not.toContain("/repo/");

      await page.waitForTimeout(300);
      await settleImages(page);
      await page.screenshot({
        path: path.join(OUT_DIR, `${V_MONITOR_CONSOLE}-${theme}${suffix}.png`)
      });
    });
  }
});

/*
 * 里程碑（Issue #214 / Round Y）要一份「几种第一次都真的发生过」的夹具：
 * `milestonesScenario()` 三个会话按天错开，四种「第一次」（会话 / 压缩 / 子 agent /
 * skill / MCP）与三条单会话记录全在场。默认场景那批固定日期的夹具没有压缩、没有
 * skill / MCP 调用，首次类会缺枚、档位读数也不确定，拍出来是一张缺角的图。
 * 本轮零动效，`emulateMedia({ reducedMotion: "reduce" })` 只是与本文件其它视图一致。
 * 一张：三组面板齐备的常态（1400 窗宽下三组都在首屏）。
 */
test.describe("截图归档 · 里程碑", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: milestonesScenario({ updater: { currentVersion: APP_VERSION } }) });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`里程碑 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.emulateMedia({ reducedMotion: "reduce" });

      await page.goto("/");
      await page.getByRole("tab", { name: "用量总览" }).click();
      await page.getByRole("tab", { name: "里程碑" }).click();
      await expect(page.locator("[data-probe='milestones-view']")).toBeVisible({ timeout: 15_000 });
      // 三组都在场再截：少一组说明拍的是另一件事（首次类全缺席），不是这个视图的常态。
      await expect(page.locator("[data-probe='milestones-group']")).toHaveCount(3);
      await page.waitForTimeout(300);
      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_MILESTONES}-${theme}${suffix}.png`) });
    });
  }
});

// 出血点标签页（Round X）需要「**真的发生过压缩**」的会话，理由与上下文标签页
// 完全一致：默认场景八个会话都没有 compact 边界，拍出来只有「本会话没有发生压缩」
// 这句空态。用 compactScenario()（/repo/compact-demo，2 次压缩：auto + manual）——
// 该会话的压缩 #1 丢掉 94 条、#2 丢掉 82 条，清单里有带金额的压缩条目
// （$1.92）与四栏 token 读数，图里看得见这个功能真正的样子。
//
// 为什么不复用「上下文」那个 describe：它拍的是**上下文压力**页（扇形图 + 压缩事件
// chip 的取证卡），与出血点的口径不同（出血点 = 每条消息在压缩时的 token 归属）。
// 两个标签页共用同一份夹具是刻意的——同一份事实，两种问法，截图各拍各的。
//
// 一张：清单+结论行的常态。不点任何下钻：出血点页首屏就是它的完整形态。
test.describe("截图归档 · 出血点", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: compactScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`出血点 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.goto("/");
      await page.getByPlaceholder("搜会话 ID 或目录…").fill("compact-demo");
      await sessionItems(page).first().click();
      await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

      await page.getByRole("tab", { name: "出血点" }).click();
      // 等到**结论行**与**清单**同时在场再截。只等标签页可见会截到空态那一帧
      // （报告由 useMemo 现算，切换标签到清单渲染之间有一拍）。这两条断言同时
      // 也是「拍的确实是出血点页」的证据——不是空白页、不是加载中、不是错误态。
      await expect(page.getByRole("region", { name: "上下文出血点" })).toBeVisible();
      await expect(page.getByText("2 次压缩丢掉了 176 条消息")).toBeVisible();
      const list = page.getByRole("list", { name: "出血清单" });
      await expect(list).toBeVisible();
      // 首条是压缩 #1（夹具事实，见 BleedView.test.tsx）：图里必须有这条真读数，
      // 否则说明拍的是一张「压缩了但没丢东西」的空态——那是另一件事的事实。
      await expect(list.getByText("压缩 #1 · 丢掉 94 条消息")).toBeVisible();
      await page.waitForTimeout(250);

      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_BLEED}-${theme}${suffix}.png`) });
    });
  }
});

// 重放（Round AA / 会话重放）：用压缩会话（/repo/compact-demo，242 条记录、
// 2 次压缩）——胶片带上同时有「最烧一分钟」「最长停顿」「压缩 #1/#2」四枚跃点，
// 滑到第 1 次压缩时舞台、读数区与播放头都在一个确定的时刻上（TZ 无关的次数与
// token 账）。截的是「正在重放某一段」的常态，不是空态。
test.describe("截图归档 · 重放", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: compactScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`重放 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.goto("/");
      await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/compact-demo");
      await sessionItems(page).first().click();
      await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
      await page.waitForTimeout(300);

      await page.getByRole("tab", { name: "重放", exact: true }).click();
      await expect(page.locator("[data-probe='replay-root']")).toBeVisible();
      await expect(page.getByLabel("会话胶片")).toContainText("共 242 条记录");

      // 停在第 1 次压缩：舞台卡片、已播放读数与播放头都换成那一刻的事实。
      await page
        .getByLabel("会话胶片")
        .getByRole("button", { name: /^压缩 #1 · / })
        .click();
      await expect(page.getByLabel("重放舞台")).toContainText("第 103 / 242 条");
      await expect(page.getByLabel("重放舞台")).toContainText("压缩 #1（自动）");
      await expect(page.getByRole("slider", { name: "重放进度" })).toHaveAttribute(
        "aria-valuenow",
        "43"
      );
      await page.waitForTimeout(250);

      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_REPLAY}-${theme}${suffix}.png`) });
    });
  }
});


// 会话账单（Round BB）：/repo/cost 夹具（3 个模型、四类科目全非零、$0.005
// 的缓存读取小计与「另有 2 次调用未计入」）。截的是收据 + 按模型两段——
// 账单页最常被看的就是这两块；最贵五次在卡内滚动之下，不强行拉进来。
test.describe("截图归档 · 会话账单", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: costScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`账单 · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;

      await page.goto("/");
      await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/cost");
      await sessionItems(page).first().click();
      await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
      await page.waitForTimeout(300);

      await page.getByRole("tab", { name: "账单", exact: true }).click();
      await expect(page.locator("[data-probe='cost-root']")).toBeVisible();
      await expect(page.getByLabel("费用收据")).toContainText("230,000");
      await expect(page.getByLabel("费用收据")).toContainText("$0.005");
      await page.waitForTimeout(250);

      await settleImages(page);
      await page.screenshot({ path: path.join(OUT_DIR, `${V_COST}-${theme}${suffix}.png`) });
    });
  }
});


// Round CC：用量页六块新面板 + 命令面板 / 大屏 / 图钉。全部走 roundCCScenario
// （多项目、跨两周、有错误、正在烧的 5 小时块），截的是有数据的常态。
test.describe("截图归档 · Round CC 新面板", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test.use({ scenario: roundCCScenario() });

  test.beforeAll(() => {
    mkdirSync(OUT_DIR, { recursive: true });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`Round CC · ${theme}`, async ({ page }) => {
      await useTheme(page, theme);
      const engine = test.info().project.name;
      const suffix = engine === "chromium" ? "" : `-${engine}`;
      const shot = async (view: string) => {
        await settleImages(page);
        await page.screenshot({ path: path.join(OUT_DIR, `${view}-${theme}${suffix}.png`) });
      };
      // 面板比视口高时，scrollIntoViewIfNeeded 会把它贴在视口下沿、只露出上半截；
      // 截图要的是整块面板的常态，所以显式居中。
      const center = (locator: ReturnType<Page["locator"]>) =>
        locator.evaluate((element) => element.scrollIntoView({ block: "center" }));

      // 计费方案与置顶都要在页面脚本之前埋好（同 useTheme）。
      await page.addInitScript(
        (pinned) => {
          localStorage.setItem("cca-billing-plan", JSON.stringify({ id: "max5" }));
          localStorage.setItem("cca-pinned-sessions", JSON.stringify([pinned]));
        },
        roundCCAlphaPath()
      );

      await page.goto("/");
      await page.getByRole("tab", { name: "用量总览" }).click();
      await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(300);
      // 周战报：KPI 行之后、两列网格之前。
      await page.getByRole("heading", { name: "周战报" }).scrollIntoViewIfNeeded();
      await shot(V_DIGEST);

      // 项目擂台：按项目分布的对比态。
      await page.getByRole("button", { name: "对比" }).click();
      await center(page.locator("[data-probe='arena-root']"));
      await page.waitForTimeout(250);
      await shot(V_ARENA);
      await page.getByRole("button", { name: "返回" }).click();

      // 项目卡片：整行，紧接在按项目分布之后。
      await center(page.locator("[data-probe='cards-root']"));
      await shot(V_CARDS);

      // Token 流向：按模型分布之后。
      await center(page.locator("[data-probe='flow-root']"));
      await shot(V_FLOW);

      // 活跃时段 · 时钟档。
      await page.getByRole("tablist", { name: "活跃时段视图" }).getByRole("tab", { name: "时钟" }).click();
      await center(page.locator("[data-probe='clock-root']"));
      await page.waitForTimeout(250);
      await shot(V_CLOCK);

      // 计费卡预报行：5 小时块里已经有 40,000 token。
      await center(page.locator("[data-probe='forecast-row']"));
      await shot(V_FORECAST);

      // 错误档 · 错误聚类。
      await page.getByRole("tab", { name: "错误", exact: true }).click();
      await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
      await center(page.locator("[data-probe='clusters-root']"));
      await shot(V_CLUSTERS);

      // 会话列表 · 置顶组（alpha 在 init script 里已钉住）。
      await page.getByRole("tab", { name: "会话分析", exact: true }).click();
      await page.waitForTimeout(400);
      await expect(page.getByText("置顶", { exact: true })).toBeVisible();
      await shot(V_PINS);

      // 命令面板。
      await page.keyboard.press("Control+k");
      await expect(page.locator("[data-probe='palette-root']")).toBeVisible();
      await page.waitForTimeout(250);
      await shot(V_PALETTE);
      await page.keyboard.press("Escape");

      // 大屏模式：设置页里的复选框 → 外壳收起。
      await page.getByRole("button", { name: "设置" }).click();
      await page.getByRole("checkbox", { name: "启用大屏模式" }).click({ force: true });
      await expect(page.locator("html")).toHaveAttribute("data-kiosk", "on");
      await page.waitForTimeout(400);
      await shot(V_KIOSK);
      await page.keyboard.press("Escape");
    });
  }
});

//
// 权威清单里的每个视图名，都必须在本文件里被 `declareView` 声明过；本文件声明
// 的每个名字，也必须在权威清单里。报错**指名道姓**。
//
// 注意：这条断言带 `test.skip(!process.env.SCREENSHOTS)`，而 CI 的
// screenshots-baseline job 只跑 shell 检查、不跑 Playwright（`SCREENSHOTS`
// 在 CI 里从没被设置过），所以它在 CI 里是 skipped。真正进 CI 的同语义门禁是
// `scripts/check-screenshots.sh` 的第 0 段——它用同一份 views.json 并以正则扫
// 本文件的 declareView 做双向复核。两者都在，是因为本地出图时（SCREENSHOTS=1）
// 这条断言能更早、更贴近源码地报出问题。
// ---------------------------------------------------------------------------
test.describe("截图视图清单对齐", () => {
  test.skip(!process.env.SCREENSHOTS, "设置 SCREENSHOTS=1 才生成，CI 不跑");

  test("spec 的声明与权威清单 views.json 一致", async () => {
    const declared = new Set(declaredViews);
    const listed = new Set(ALL_VIEWS);

    const missingDeclaration = ALL_VIEWS.filter((view) => !declared.has(view));
    const extraDeclaration = declaredViews.filter((view) => !listed.has(view));

    expect(
      missingDeclaration,
      `docs/screenshots/views.json 里有 ${missingDeclaration.length} 个视图没人声明：` +
        `${missingDeclaration.join("、")}——请在本文件里加 declareView 与出图，` +
        `或从 views.json 里移除`
    ).toEqual([]);

    expect(
      extraDeclaration,
      `本文件声明了 ${extraDeclaration.length} 个不在 views.json 里的视图：` +
        `${extraDeclaration.join("、")}——请把它们加进 docs/screenshots/views.json`
    ).toEqual([]);

    expect(declaredViews.length).toBe(ALL_VIEWS.length);
  });
});
