import { test, expect, emptyScenario, roundFFScenario } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Round FF「第四批十功能 · 数据实验室」端到端验收。
 *
 * 夹具 `roundFFScenario()` 只装本轮的 24 份会话（5 个项目、最近 20 天 +
 * 今天 / 昨天 / 本周、三种已定价模型 + 一个未定价模型、六种工具、两个共享
 * 绝对路径）。断言只依赖夹具的结构事实（卡在、探针在、读数不是空串），
 * 不按墙钟绝对值断言——时间一律相对构建时刻生成，跨整点也不该假红。
 *
 * 实验室是第 5 个子视图：区间控件保留（9 张卡吃「近 N 天」），导出按钮不出现。
 */

/** `parsePlanSelection` 只认 `custom*` 字段；两种拼写都写，兼容任务口径与既有设置。 */
const FF_PLAN = JSON.stringify({
  id: "max5",
  customLimitTokens: 88_000,
  customWeeklyLimitTokens: 500_000,
  weeklyLimitTokens: 500_000
});

const LAB_CARDS = [
  "galaxy",
  "terrain",
  "hall",
  "flame",
  "sandbox",
  "network",
  "footprint",
  "heartbeat",
  "runway",
  "scatter"
] as const;

async function openLab(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览", exact: true }).click();
  await expect(page.locator("[data-probe='usage-progress']")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "实验室", exact: true }).click();
  // 等扫描收口成统计口径：扫描中的进度行不写「14 个视角」。
  // Round HH 起 11 张；Round II 加会话形状/工作日对照/多选对照/提问画像中的
  // 三张实验室卡（weekend / multi / profile），视角数 11→14。
  await expect(page.getByText(/纳入统计 · 14 个视角/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-probe='lab-view']")).toBeVisible();
  await expect(page.locator("[data-lab-card]")).toHaveCount(14);
}

test.describe("实验室 · 有数据", () => {
  test.use({ scenario: roundFFScenario() });

  // 预算必须在页面脚本之前埋好：跑道没有预算时只画实际线与预测线，
  // 「预算线」断言会退化成空态。
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((plan) => {
      localStorage.setItem("cca-billing-plan", plan as string);
    }, FF_PLAN);
  });

  test("页头与十张卡：第 5 档、区间控件保留、导出按钮不出现", async ({ page }) => {
    await openLab(page);

    await expect(page.getByRole("heading", { name: "数据实验室" })).toBeVisible();
    await expect(page.getByText("近 30 天 · 全量扫描")).toBeVisible();
    for (const card of LAB_CARDS) {
      await expect(page.locator(`[data-lab-card="${card}"]`)).toBeVisible();
    }
    // 实验室吃「近 N 天」，所以区间控件必须还在；快照只描述用量档。
    await expect(page.getByRole("tablist", { name: "时间范围" })).toBeVisible();
    await expect(page.getByRole("button", { name: /导出用量快照/ })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "实验室" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("会话星系：24 颗星、一颗空心环、最重 5 个会话的可操作清单", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="galaxy"]');

    await expect(card.locator("[data-constellation-star]")).toHaveCount(24);
    await expect(card.getByRole("img", { name: /^会话星系：/ })).toBeVisible();
    // 空心环 = 这段窗口里没有 usage 的会话；它是事实，不被省略。
    const hollow = await card.locator("[data-constellation-star]").evaluateAll((nodes) =>
      nodes.filter((node) => (node.getAttribute("class") ?? "").includes("hollow")).length
    );
    expect(hollow).toBeGreaterThanOrEqual(1);
    // 图形本身不进 Tab 序；清单才是键盘 / 读屏的可操作层。
    const rows = card.locator("[data-constellation-row]");
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toBeEnabled();
  });

  test("成本地形：摘要可读、峰值常显标注、未定价小时有声明", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="terrain"]');

    await expect(card.getByRole("img", { name: /^成本地形：/ })).toBeVisible();
    // 峰值标注形如「三 14 时 · $1.20」——常显的 SVG <text>，不靠 hover。
    // 不能按整卡 getByText 找：168 个格子的 <title> 也含同样的句子。
    await expect(card.locator("[data-terrain-peak]")).toHaveCount(1);
    await expect(card.locator("svg text").filter({ hasText: /时 · \$\d/ })).toBeVisible();
    await expect(card.getByText(/等高线是阈值边界（p50\/p80\/p95），不做插值/)).toBeVisible();
    await expect(card.getByText(/未定价模型的小时不计入，共 \d+ 小时受影响/)).toBeVisible();
  });

  test("最贵时刻：领奖台 3 名 + 榜单 7 行，第 1 名带金额", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="hall"]');

    await expect(card.locator("[data-hall-entry]")).toHaveCount(10);
    await expect(card.locator("[data-hall-entry^='podium-']")).toHaveCount(3);
    await expect(card.locator("[data-hall-entry='podium-1']")).toContainText(/\$\d/);
    await expect(card.getByText(/无定价模型的 \d+ 次调用未参与排名/)).toBeVisible();
  });

  test("工具火焰：12 行封顶、?N 标出未知耗时、行是按钮", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="flame"]');

    const rows = card.locator("[data-probe='lab-flame-row']");
    await expect(rows).toHaveCount(12);
    await expect(rows.first()).toHaveAttribute("aria-label", /工具耗时|调用/);
    // 未配对调用不是 0：右列标 ?N。
    await expect(card.getByText(/^\?\d+$/).first()).toBeVisible();
    await expect(card.getByText(/只累计配对了工具结果的调用耗时/)).toBeVisible();
  });

  test("成本沙盘：三根滑杆、拖动接管比例后假设读数变化", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="sandbox"]');

    await expect(card.locator("[data-probe='sandbox-waterfall']")).toBeVisible();
    await expect(card.locator("[data-probe='sandbox-bar-current']")).toHaveCount(1);
    await expect(card.locator("[data-probe='sandbox-bar-final']")).toHaveCount(1);

    const cache = card.getByLabel("目标缓存命中率");
    const takeover = card.getByLabel("便宜模型接管比例");
    const output = card.getByLabel("输出削减比例");
    await expect(cache).toBeVisible();
    await expect(takeover).toHaveAttribute("aria-valuetext", "便宜模型接管比例 25%");
    await expect(output).toHaveAttribute("aria-valuetext", "输出削减比例 15%");

    const hypothetical = card.locator("[data-probe='sandbox-hypothetical']");
    const before = await hypothetical.textContent();
    // 原生 range 的键盘行为在 Chromium / WebKit 上不完全一致；这里走一次
    // React 认得的 input 事件，两个引擎得到同一个确定结果。
    await takeover.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "100");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(await takeover.inputValue()).toBe("100");
    await expect(takeover).toHaveAttribute("aria-valuetext", "便宜模型接管比例 100%");
    // 假设成本随杠杆变化；不断言具体金额（定价快照更新时不该假红）。
    await expect.poll(async () => hypothetical.textContent()).not.toBe(before);
  });

  test("工具生态：节点可点、筛选状态可读、最强共现列表在场", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="network"]');

    const nodes = card.locator("[data-probe='ecosystem-node']");
    expect(await nodes.count()).toBeGreaterThanOrEqual(2);
    await expect(card.getByLabel("最强共现")).toBeVisible();

    await nodes.first().locator("circle").click();
    await expect(card.locator("[data-probe='ecosystem-filter']")).toContainText("已筛选：");
  });

  test("文件足迹：跨项目共享边、共享文件列表带项目数与次数", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="footprint"]');

    await expect(card.getByRole("img", { name: /^文件足迹：/ })).toBeVisible();
    expect(await card.locator("[data-probe='footprint-edge']").count()).toBeGreaterThan(0);
    await expect(card.getByLabel("共享最多的文件")).toContainText("CONTRIBUTING.md");
    await expect(card.getByLabel("共享最多的文件")).toContainText(/\d+ 个项目 · \d+ 次/);
  });

  test("对话心跳：三条通道、四条读数、切到单会话后出现选择框", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="heartbeat"]');

    await expect(card.locator("[data-probe='lab-heartbeat-chart']")).toBeVisible();
    await expect(card.locator("[data-heartbeat-channel]").first()).toBeVisible();
    await expect(card.locator("ul[aria-label='心跳读数'] > li")).toHaveCount(4);
    await expect(card.locator("ul[aria-label='心跳读数']")).toContainText("最长静默");

    await page
      .getByRole("radiogroup", { name: "心跳范围" })
      .getByRole("radio", { name: "单会话" })
      .click();
    await expect(card.locator("select")).toBeVisible();
  });

  test("预算跑道：4 格读数、预算线标签与落地状态都在", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="runway"]');

    await expect(card.locator("[data-probe='runway-readouts'] > div")).toHaveCount(4);
    // 计划已在 init script 里写好：预算线必须出现，而不是「未设周预算」。
    await expect(card).toContainText(/预算 [\d.]+k|预算 [\d.]+M/);
    await expect(card.getByText(/未设周预算/)).toHaveCount(0);
    await expect(card.locator("[data-probe='runway-status']")).not.toBeEmpty();
  });

  test("提示词节奏：点集可读、中位十字与图例切换", async ({ page }) => {
    await openLab(page);
    const card = page.locator('[data-lab-card="scatter"]');

    expect(await card.locator("[data-rhythm-point]").count()).toBeGreaterThan(8);
    await expect(card.getByRole("img", { name: /^提示词节奏：/ })).toBeVisible();
    await expect(card.getByText(/中位 /)).toBeVisible();

    const legend = card.getByLabel("项目图例（可点选隐藏）").getByRole("button").first();
    await expect(legend).toHaveAttribute("aria-pressed", "true");
    await legend.click();
    await expect(legend).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("实验室 · 空场景", () => {
  test.use({ scenario: emptyScenario() });

  test("十一张卡都显示空态而不是崩溃", async ({ page }) => {
    // 实验室自己承担空态（与里程碑同一取舍）：预先落在 lab 档，页头的整页
    // 空态就不会盖掉十一张卡各自的解释。
    await page.addInitScript(() => {
      localStorage.setItem("cca-usage-view", "lab");
    });

    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览", exact: true }).click();
    await expect(page.locator("[data-probe='lab-view']")).toBeVisible({ timeout: 15_000 });
    // Round HH 起 11 张；Round II 三张实验室卡（weekend / multi / profile）→ 14。
    await expect(page.locator("[data-lab-card]")).toHaveCount(14);

    const expectations: ReadonlyArray<readonly [string, RegExp]> = [
      ["galaxy", /所选范围内没有会话/],
      ["terrain", /所选范围内没有可估算的成本/],
      ["hall", /所选范围内没有可定价的调用/],
      ["flame", /所选范围内没有工具调用/],
      ["sandbox", /所选范围内没有可建模的消耗/],
      ["network", /工具之间还没有重复共现/],
      ["footprint", /没有跨项目共享的文件/],
      ["heartbeat", /所选范围内没有可画的一天/],
      ["runway", /本周还没有消耗/],
      ["scatter", /所选范围内没有可读的用户消息/],
      ["cutoff", /没有逐小时读数/]
    ];
    for (const [card, text] of expectations) {
      await expect(page.locator(`[data-lab-card="${card}"]`)).toContainText(text);
    }
  });
});
