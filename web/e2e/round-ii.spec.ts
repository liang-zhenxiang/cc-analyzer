import { expect, test } from "./fixtures";
import { roundIIScenario, roundIISavedSearches, roundIIWeekdayTokens } from "./fixtures";
import { sessionItems } from "./selectors";

/**
 * Round II（第七批十功能）端到端：
 * 会话形状（I1/I3/I9/I10）、工作日对照（I2）、多选对照（I4）、提问画像（I5）、
 * 决策点（I6，当前命中缺陷，见用例注释）、保存的搜索（I7）、首条消息预览（I8）。
 *
 * 期望值只写「由夹具构造决定的常量」：时长/间隔/切换/配方的桶边界都是
 * 本地时区无关的量；凡是「周几」的判定交给页面，用它自己算出的会话数对账。
 */

test.use({ scenario: roundIIScenario() });

// WebKit（macOS）不认 TZ 环境变量，Chromium 认——显式把 TZ 透传给
// Playwright 的 timezoneId，否则「TZ=UTC 双引擎」验证里 webkit 仍按
// 系统时区跑，时区漂移只会以错误的一致性通过（同 round-gg 的教训）。
const iiTzOverride = process.env.TZ?.trim() ? process.env.TZ.trim() : undefined;
if (iiTzOverride) test.use({ timezoneId: iiTzOverride });

async function openUsage(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByText("Tokens 总量").first().waitFor({ timeout: 15_000 });
}

test("I8 首条消息预览已脱敏：渲染文本不含主目录用户名，行高 72", async ({ page }) => {
  await page.goto("/");
  const rows = sessionItems(page);
  await rows.first().waitFor();

  const previews = page.locator("[data-probe='session-preview']");
  await expect(previews).toHaveCount(9);

  const texts = await previews.allInnerTexts();
  expect(texts.join("\n")).not.toContain("e2e");
  expect(texts[0]).toContain("~");
  expect(texts[0]).toContain("<路径>");

  const firstRow = rows.first();
  const height = await firstRow.evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.round(height)).toBe(72);

  // 脱敏标记不进入正文：正文是 `~`/`<路径>`，标记只以图标出现。
  await expect(firstRow.locator("[data-probe='session-preview']")).toHaveAttribute(
    "title",
    "看看 ~<路径> 里的构建日志"
  );
  await expect(firstRow.getByLabel("已脱敏")).toBeVisible();
});

test("I1 会话时长五桶：9 个会话、中位 15m0s、无单记录会话", async ({ page }) => {
  await openUsage(page);
  await page.getByText("会话形状").first().scrollIntoViewIfNeeded();

  await expect(page.locator("[data-probe='session-shape']")).toHaveAttribute(
    "data-shape",
    "duration"
  );
  const bars = page.locator("[data-probe='shape-bar']");
  await expect(bars).toHaveCount(5);
  await expect(bars.nth(0)).toContainText("不足 5 分钟");
  await expect(bars.nth(4)).toContainText("≥ 4 小时");

  const counts = await bars.evaluateAll((elements) =>
    elements.map((element) => element.querySelector("span")?.nextElementSibling?.textContent)
  );
  expect(counts).toEqual(["2", "2", "3", "1", "1"]);

  await expect(page.locator("[data-probe='shape-readout']")).toHaveText(
    "中位跨度 15m0s，9 个会话"
  );
  await expect(page.locator("[data-probe='session-shape']")).toContainText(
    "按首末记录差算，含等待。"
  );
});

test("I3 会话间隔六桶：8 对相邻会话、按开始时刻排序", async ({ page }) => {
  await openUsage(page);
  await page.getByRole("tab", { name: "间隔" }).click();

  await expect(page.locator("[data-probe='session-shape']")).toHaveAttribute("data-shape", "gap");
  await expect(page.locator("[data-probe='shape-bar']")).toHaveCount(6);
  await expect(page.locator("[data-probe='shape-readout']")).toContainText("8 对相邻会话");
  await expect(page.locator("[data-probe='session-shape']")).toContainText(
    "按开始时刻排序取相邻差。"
  );
});

test("I9 模型切换：从不 7 / 1 次 1 / 2 次及以上 1，A→B→A 计 2 次", async ({ page }) => {
  await openUsage(page);
  await page.getByRole("tab", { name: "切换" }).click();

  const bars = page.locator("[data-probe='shape-bar']");
  await expect(bars).toHaveCount(3);
  await expect(bars.nth(0)).toContainText("从不");
  await expect(bars.nth(1)).toContainText("1 次");
  await expect(bars.nth(2)).toContainText("2 次及以上");

  await expect(page.locator("[data-probe='shape-readout']")).toHaveText(
    "22% 的会话换过模型"
  );
  await expect(page.locator("[data-probe='session-shape']")).toContainText(
    "换回旧模型也算（A→B→A 是 2 次）。"
  );
});

test("I10 工具配方：Bash · Read 重复 3 次、Edit 2 次，1 个会话无工具", async ({ page }) => {
  await openUsage(page);
  await page.getByRole("tab", { name: "配方" }).click();

  await expect(page.locator("[data-probe='shape-bar']")).toHaveCount(0);
  const body = page.locator("[data-probe='session-shape']");
  await expect(body).toContainText("Bash · Read");
  await expect(body).toContainText("3 个会话");
  await expect(body).toContainText("Edit");
  await expect(body).toContainText("2 个会话");
  await expect(page.locator("[data-probe='shape-readout']")).toHaveText("2 种配方重复出现");
  await expect(body).toContainText("1 个会话没有调用工具");
});

test("I2 工作日 vs 周末：工作日 7 会话 / 周末 2 会话，空侧写 —", async ({ page }) => {
  await openUsage(page);
  await page.getByRole("tab", { name: "实验室" }).click();

  const split = page.locator("[data-probe='workday-split']");
  await split.scrollIntoViewIfNeeded();
  const rows = page.locator("[data-probe='workday-row']");
  await expect(rows).toHaveCount(2);

  const weekday = page.locator("[data-probe='workday-row'][data-group='weekday']");
  const weekend = page.locator("[data-probe='workday-row'][data-group='weekend']");
  await expect(weekday).toContainText("工作日");
  // 「周几」随 runner 时区漂移（夹具锚上一周周一，UTC 与上海对跨午夜
  // 小时的归属不同）——期望值从夹具现算，不写死（时区铁律）。
  const expected = roundIIWeekdayTokens();
  await expect(weekday).toContainText(expected.weekday.toLocaleString("en-US"));
  await expect(weekend).toContainText(expected.weekend.toLocaleString("en-US"));
  // 两侧都有记录，不该出现「—」占位。
  await expect(split).not.toContainText("—");
  await expect(page.getByText("按本地日历日分组；日均活跃小时的分母固定 5 天 / 2 天")).toBeVisible();
});

test("I4 多选对照：项目两行 55.3% / 44.7%，不足 2 个时不出表", async ({ page }) => {
  await openUsage(page);
  await page.getByRole("tab", { name: "实验室" }).click();

  const compare = page.locator("[data-probe='multi-compare']");
  await compare.scrollIntoViewIfNeeded();
  await expect(page.locator("[data-probe='multi-row']")).toHaveCount(2);
  const table = page.locator("[data-probe='multi-table']");
  await expect(table).toContainText("按 项目对照");
  await expect(table).toContainText("55.3%");
  await expect(table).toContainText("44.7%");
  await expect(table).toContainText("本组最重");
  await expect(page.getByText("占比按所选实体合计，不是全站", { exact: false })).toBeVisible();

  // 取消一个实体 → 不足 2 个，表格消失、提示出现。
  await page.locator("[data-probe='multi-chip']").first().click();
  await expect(page.locator("[data-probe='multi-table']")).toHaveCount(0);
  await expect(compare).toContainText("再选 1 个就能对照");

  // 切到模型维度：三个模型 chip，重新选 2 个后表格回来。
  await page.getByRole("tab", { name: "模型" }).click();
  await expect(page.locator("[data-probe='multi-chip']")).toHaveCount(3);
  await expect(page.locator("[data-probe='multi-table']")).toContainText("按 模型对照");
  await expect(page.locator("[data-probe='multi-row']")).toHaveCount(2);
  await page.locator("[data-probe='multi-chip']").nth(2).click();
  await expect(page.locator("[data-probe='multi-row']")).toHaveCount(3);
});

test("I5 提问画像：中位 16 字、代码块 8.3%、中文 86.3%、共 12 条", async ({ page }) => {
  await openUsage(page);
  await page.getByRole("tab", { name: "实验室" }).click();

  const profile = page.locator("[data-probe='prompt-profile']");
  await profile.scrollIntoViewIfNeeded();
  await expect(profile).toContainText("提问长度中位 16 字");
  await expect(profile).toContainText("含代码块 8.3%");
  await expect(profile).toContainText("中文汉字占 86.3%");
  await expect(profile).toContainText("共 12 条");
  await expect(profile.getByRole("img", { name: "提问长度分布" })).toBeVisible();
});

test("I7 保存的搜索：卡片回填查询、保存后重载仍在", async ({ page }) => {
  // 只在首次进入时播种：reload 后保留「保存」写进去的那条（否则 init script
  // 每次导航都会把 localStorage 重置回 1 条，往返断言永远看不到新卡片）。
  await page.addInitScript((saved) => {
    if (window.localStorage.getItem("cca-saved-searches") === null) {
      window.localStorage.setItem("cca-saved-searches", saved);
    }
  }, roundIISavedSearches());
  await page.goto("/");
  await page.getByRole("button", { name: "全局搜索" }).click();

  const saved = page.locator("[data-probe='saved-search']");
  await expect(saved).toHaveCount(1);
  await expect(saved.first()).toContainText("错误排查");
  await saved.first().click();
  await expect(page.getByRole("textbox", { name: "搜索会话记录" })).toHaveValue("错误:");

  // 保存一条新的：输入 → 保存 → 起名 → 回车，卡片变两张。
  const input = page.getByRole("textbox", { name: "搜索会话记录" });
  await input.fill("构建 失败");
  await page.locator("[data-probe='saved-save']").click();
  await page.getByRole("textbox", { name: "保存的搜索名称" }).fill("构建失败");
  await page.getByRole("button", { name: "存", exact: true }).click();
  // 保存卡片只在空查询时出现（设计 §4.6）：清空输入再看列表。
  await page.getByRole("textbox", { name: "搜索会话记录" }).fill("");
  await expect(page.locator("[data-probe='saved-search']")).toHaveCount(2);

  await page.reload();
  await page.getByRole("button", { name: "全局搜索" }).click();
  await expect(page.locator("[data-probe='saved-search']")).toHaveCount(2);
});

test("I6 决策点：合并行还原成 user 视图后，开关出现且能过滤出决策帧", async ({ page }) => {
  // buildLogRows 会把每轮首条 user 行并进「用户+LLM」行（kind="llm"、
  // mergedWith:"user"）；SessionAnalyzerPage 喂给 decisionPointsOf 前把
  // 合并行还原成 user 视图（summary 取「 · 」前半、时间戳回退轮起点）。
  // 夹具 ii-4 的 user 消息命中 restart / escalate / redirect 三类。
  await page.goto("/");
  await page.getByRole("textbox", { name: "搜索会话" }).fill("ii-4");
  await sessionItems(page).first().click();
  await page.getByRole("tab", { name: "日志视图" }).click();
  await page.getByText("会话图已加载", { exact: false }).waitFor();

  const toggle = page.locator("[data-probe='decisions-only']");
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator("[data-probe='decision-tag']")).toHaveCount(3);
});
