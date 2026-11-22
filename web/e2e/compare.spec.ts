import type { Page } from "@playwright/test";
import { test, expect, emptyScenario, recentActivityScenario } from "./fixtures";

/*
 * 「对照」的端到端（Issue #377 验收）：两段区间的选择、重叠阻断、空态与
 * 四块结果面板真的挂进了用量页。
 *
 * 夹具用 `recentActivityScenario()`（最新活动日平移到昨天）：默认 A=近 7 天
 * 一定能读到昨天那段，B=「上一个等长区间」则落在更早、没有记录——这条真实
 * 形态同时覆盖「B 空」的空态分支。
 */

/** 打开「用量总览」并切到对照档；返回该视图根节点。 */
async function openCompare(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "对照" }).click();
  const view = page.locator("[data-probe='compare-ranges']");
  await expect(view).toBeVisible({ timeout: 15_000 });
  return view;
}

test.describe("对照 · 有数据", () => {
  test.use({ scenario: recentActivityScenario() });

  test("两个区间各自可切；结果区挂出并排读数、分布与日趋势", async ({ page }) => {
    await openCompare(page);

    // 页头的「近 N 天」对对照档不生效。
    await expect(page.getByRole("tablist", { name: "时间范围" })).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "区间 A 的预设" })).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: "区间 B 的预设" })).toBeVisible();

    // 结果四块：并排读数 / 按项目 / 按模型 / 每日趋势。
    await expect(page.locator("[data-probe='compare-readouts']")).toBeVisible();
    await expect(page.locator("[data-probe='compare-projects']")).toBeVisible();
    await expect(page.locator("[data-probe='compare-models']")).toBeVisible();
    await expect(page.locator("[data-probe='compare-trend']")).toBeVisible();

    // 六行读数，顺序固定。
    await expect(page.locator("[data-probe='compare-readout-row']")).toHaveCount(6);
    // 差值逐项声明方向：只有成本是「涨红跌绿」。
    await expect(
      page.locator("[data-probe='compare-readout-row'][data-metric='sessions'] [data-direction]")
    ).toHaveAttribute("data-direction", "neutral");
    await expect(
      page.locator("[data-probe='compare-readout-row'][data-metric='usd'] [data-direction]")
    ).toHaveAttribute("data-direction", "up-bad");

    // 日趋势：两条线、每天一个命中矩形，横轴是「第 N 天」。
    await expect(page.locator("[data-probe='compare-trend-a']")).toHaveCount(1);
    await expect(page.locator("[data-probe='compare-trend-b']")).toHaveCount(1);
    await expect(page.locator("[data-probe='compare-trend-hit']")).toHaveCount(7);
    await expect(page.locator("[data-probe='compare-trend-legend']")).toContainText("A ·");
  });

  test("切 A 到近 30 天：B 选「上一个等长区间」时长度跟着变", async ({ page }) => {
    await openCompare(page);

    const results = page.locator('[data-probe="compare-ranges"] [class*="rangeResult"]');
    await expect(results.nth(0)).toContainText("· 7 天");
    await expect(results.nth(1)).toContainText("· 7 天");

    await page
      .getByRole("radiogroup", { name: "区间 A 的预设" })
      .getByRole("radio", { name: "近 30 天" })
      .click();

    await expect(results.nth(0)).toContainText("· 30 天");
    await expect(results.nth(1)).toContainText("· 30 天");
    // 两段等长时不出现「长度不同」的提示。
    await expect(page.locator("[data-probe='compare-length-hint']")).toHaveCount(0);
  });

  test("两段都选近 7 天时完全重合：出重叠提示，表格与图不出现", async ({ page }) => {
    await openCompare(page);

    await page
      .getByRole("radiogroup", { name: "区间 B 的预设" })
      .getByRole("radio", { name: "近 7 天" })
      .click();

    const notice = page.locator("[data-probe='compare-overlap']");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("两段区间重叠，无法对照");
    await expect(notice).toContainText("两个区间完全重合");
    // 控件保持可用；结果区不出表格与图。
    await expect(page.getByRole("radiogroup", { name: "区间 A 的预设" })).toBeVisible();
    await expect(page.locator("[data-probe='compare-readouts']")).toHaveCount(0);
    await expect(page.locator("[data-probe='compare-trend']")).toHaveCount(0);
  });

  test("B 区间没有记录：读数按 0 计，表下说明没有基线", async ({ page }) => {
    await openCompare(page);

    // 默认 B 是「上一个等长区间」——昨天之前的一周，夹具里没有记录。
    await expect(page.locator("[data-probe='compare-empty-b']")).toContainText(
      "区间 B 内没有记录，差值没有基线"
    );
  });
});

test.describe("对照 · 空场景", () => {
  test.use({ scenario: emptyScenario() });

  test("没有会话时出 panel 空态，而不是整页空态", async ({ page }) => {
    // 一个会话都没有时用量页整页是空态；对照档靠「上一次停在这一档」进入。
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("cca-usage-view", "compare");
      } catch {
        // 隐私模式下 localStorage 可能不可用；这条用例的前提本来就是它可用。
      }
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();

    await expect(page.getByText("这两个区间都没有记录")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("换两个有记录的时间段再对照。A 与 B 不能重叠。")
    ).toBeVisible();
    // 用量档那句整页空态不是这一档的语言；控件保留。
    await expect(page.getByText("还没有可统计的会话")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "区间 A 的预设" })).toBeVisible();
  });
});
