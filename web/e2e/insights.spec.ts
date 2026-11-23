import { test, expect, insightsScenario, staleActivityScenario } from "./fixtures";

/**
 * 「值得注意的变化」（Issue #383）端到端。
 *
 * 夹具让五条规则同时成立（模型 / 压缩 / 日均 / 错误率 / 会话长度），
 * 覆盖三件界面层最容易做错的事：
 * 1. 中性行没有箭头，错误率行只有箭头着色（▲ 上升 = --danger）；
 * 2. 依据区手风琴：同一时刻只开一条，Escape 收起且焦点留在行上；
 * 3. 「变化」行的单位按 kind 分三档：百分点 / % / 次/会话。
 *
 * 第二个 describe 用 200 天前的会话：两段窗口都空，只剩空态。
 */

test.describe("有达到阈值的项", () => {
  test.use({ scenario: insightsScenario() });

  test("卡片渲染五条、展开依据、单位与方向", { tag: "@insights" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();

    // 卡片头 / 区域名 / 五行。
    const card = page.getByRole("region", { name: "值得注意的变化" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole("heading", { name: "值得注意的变化" })).toBeVisible();
    const rows = card.locator("[data-probe='insight-row']");
    await expect(rows).toHaveCount(5);

    // 排序：变化幅度 ÷ 阈值降序——模型(5.0) → 压缩(4.0) → 日均(3.0)
    // → 错误率(2.5) → 会话长度(2.0)。
    await expect(rows.nth(0).locator("xpath=ancestor::li")).toHaveAttribute(
      "data-kind",
      "model"
    );
    await expect(rows.nth(1).locator("xpath=ancestor::li")).toHaveAttribute(
      "data-kind",
      "compaction"
    );
    await expect(rows.nth(2).locator("xpath=ancestor::li")).toHaveAttribute(
      "data-kind",
      "dailyTokens"
    );
    await expect(rows.nth(3).locator("xpath=ancestor::li")).toHaveAttribute(
      "data-kind",
      "errorRate"
    );
    await expect(rows.nth(4).locator("xpath=ancestor::li")).toHaveAttribute(
      "data-kind",
      "sessionLength"
    );

    // 中性行没有箭头；错误率行有 ▲ 且只有箭头着色。
    await expect(card.locator("[data-kind='model'] [data-probe='insight-arrow']")).toHaveCount(0);
    const arrow = card.locator("[data-kind='errorRate'] [data-probe='insight-arrow']");
    await expect(arrow).toHaveText("▲");
    await expect(arrow).toHaveClass(/arrowUp/);
    await expect(arrow).toHaveCSS("color", "rgb(179, 38, 30)");
    // 句子里的数字仍是正文色（不被箭头颜色带跑）。
    const number = card.locator(
      "[data-kind='errorRate'] [data-probe='insight-sentence'] span[class*='number']"
    ).first();
    await expect(number).toHaveCSS("color", "rgb(22, 24, 27)");

    // 范围文案与精确日期 title。
    await expect(rows.first()).toContainText("近 30 天 vs 上一个 30 天");
    await expect(rows.first().locator("span[title]")).toHaveAttribute("title", /^当前 \d+\/\d+–/);

    // 展开模型行的依据：百分点（当前 100.0% / 上一个 0.0%）。
    await rows.nth(0).click();
    await expect(rows.nth(0)).toHaveAttribute("aria-expanded", "true");
    const modelEvidence = card.locator("[data-probe='insight-evidence']");
    await expect(modelEvidence).toHaveCount(1);
    await expect(modelEvidence.locator("[data-probe='insight-change']")).toContainText(
      "+100.0 个百分点"
    );
    await expect(
      modelEvidence.locator("[data-probe='insight-sample']")
    ).toContainText("8,000 token");
    await expect(
      modelEvidence.locator("[data-probe='insight-sample']")
    ).toContainText("3,200 token");

    // 手风琴：打开压缩行，模型行的依据自动收起；单位是次/会话。
    await rows.nth(1).click();
    await expect(card.locator("[data-probe='insight-evidence']")).toHaveCount(1);
    await expect(card.locator("[data-kind='compaction'] [data-probe='insight-change']")).toContainText(
      "+2 次/会话"
    );

    // 再换日均行：单位是相对百分比。
    await rows.nth(2).click();
    await expect(card.locator("[data-probe='insight-evidence']")).toHaveCount(1);
    await expect(card.locator("[data-kind='dailyTokens'] [data-probe='insight-change']")).toContainText(
      "+150.0%"
    );

    // Escape 收起，焦点仍在行上。
    const dailyRow = card.locator("[data-kind='dailyTokens'] [data-probe='insight-row']");
    await dailyRow.focus();
    await dailyRow.press("Escape");
    await expect(card.locator("[data-probe='insight-evidence']")).toHaveCount(0);
    await expect(dailyRow).toBeFocused();
  });

  test("卡片不泄漏绝对路径", { tag: "@insights" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();
    const card = page.getByRole("region", { name: "值得注意的变化" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const text = await card.innerText();
    expect(text).not.toContain("/repo");
    expect(text).not.toContain("/Users/e2e");
    const titles = await card.locator("[title]").evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("title") ?? "")
    );
    for (const title of titles) {
      expect(title).not.toContain("/repo");
      expect(title).not.toContain("/Users/e2e");
    }
    await expect(card.locator("[data-probe='insights-empty']")).toHaveCount(0);
  });
});

test.describe("没有达到阈值的变化", () => {
  // 200 天前的唯一会话：当前窗口与对照窗口都空，六条规则全部不产出。
  test.use({ scenario: staleActivityScenario() });

  test("仍渲染卡片，陈述事实而不是「一切正常」", { tag: "@insights" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();
    const card = page.getByRole("region", { name: "值得注意的变化" });
    await expect(card).toBeVisible({ timeout: 15_000 });

    const empty = card.locator("[data-probe='insights-empty']");
    await expect(empty).toContainText("最近没有达到阈值的变化");
    await expect(empty).toContainText(
      "与上一个 30 天相比，没有指标同时满足变化幅度与样本量要求。"
    );
    await expect(card.locator("[data-probe='insight-row']")).toHaveCount(0);
    // 空态不写判断词；卡片头与口径脚注照旧渲染，不整卡消失。
    await expect(empty).not.toContainText("一切正常");
    await expect(card).toContainText("未达阈值的不会出现");
    await expect(card.getByRole("heading", { name: "值得注意的变化" })).toBeVisible();
  });
});
