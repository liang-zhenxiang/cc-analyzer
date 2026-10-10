import type { Page } from "@playwright/test";
import { test, expect, quotaAttributionScenario } from "./fixtures";

/**
 * Issue #151「按会话的配额归因」的端到端覆盖。
 *
 * 面板挂在计费窗口卡里，数据来自 `quotaAttributionScenario()`（见 fixtures.ts）：
 * 自造会话的时间戳相对 `Date.now()`，全部落在**当前 5 小时窗口**里，所以「窗内
 * 有谁、有几行、占比多少」是确定的——不会随日期漂移。
 *
 * 三条主线：窗内多会话的标题 / token / 百分比 / 占比条；点行真的打开对应会话；
 * 超过 Top 5 时收敛成 5 行 + 「其余 N 个会话」且余项不是会话。
 *
 * 「窗口内一条记录都没有」不单独造场景：窗口本来是由记录开启的，那种状态在数据
 * 层不存在。真正可达的「不渲染」分支是窗口总量为 0（有记录、没有可归因的消耗），
 * 由最后一组用例覆盖。
 */

const USAGE_TAB = "用量总览";
const PANEL_NAME = "本窗口消耗 Top 会话";
const LIST_NAME = "本窗口消耗最多的会话";

/** 打开用量页并等扫描收口：进度行从「已分析 x / y」变成「近 N 天内 k 个会话纳入统计」。 */
async function openUsage(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: USAGE_TAB }).click();
  await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
}

/** 面板与列表都按可访问名定位（锚点走 aria 与 data-probe，不碰 CSS Module 类名）。 */
function panel(page: Page) {
  return page.getByRole("region", { name: PANEL_NAME });
}

function list(page: Page) {
  return page.getByRole("list", { name: LIST_NAME });
}

test.describe("按会话的配额归因", () => {
  test.use({ scenario: quotaAttributionScenario() });

  test("窗口内 3 个会话：标题、消耗、百分比与占比条都与夹具一致", async ({ page }) => {
    await openUsage(page);

    const region = panel(page);
    await expect(region).toBeVisible();

    // 行就是会话：3 个会话 3 个按钮。窗内不超过 Top 5，不该有「其余」行。
    const rows = list(page).getByRole("button");
    await expect(rows).toHaveCount(3);
    await expect(region.getByText(/其余 \d+ 个会话/)).toHaveCount(0);

    // 按消耗降序：会话 1（300,000）→ 2（200,000）→ 3（100,000）。
    await expect(region.locator('[data-probe="attribution-row-title"]')).toHaveText([
      "窗口归因夹具会话 1",
      "窗口归因夹具会话 2",
      "窗口归因夹具会话 3"
    ]);
    await expect(region.locator('[data-probe="attribution-row-token"]')).toHaveText([
      "300,000 tok",
      "200,000 tok",
      "100,000 tok"
    ]);
    await expect(region.locator('[data-probe="attribution-row-pct"]')).toHaveText([
      "50.0%",
      "33.3%",
      "16.7%"
    ]);

    // 占比条量的是真实布局：填充宽 / 轨道宽，而不是内联样式那串浮点字符串。
    const bars = await rows.evaluateAll((nodes) =>
      nodes.map((node) => {
        const fill = node.querySelector('[data-probe="attribution-row-bar"]');
        const track = fill?.parentElement ?? null;
        if (!fill || !track) return null;
        const trackWidth = track.getBoundingClientRect().width;
        return { trackWidth, ratio: fill.getBoundingClientRect().width / trackWidth };
      })
    );
    const expectedRatios = [0.5, 1 / 3, 1 / 6];
    bars.forEach((bar, index) => {
      if (!bar) throw new Error(`第 ${index + 1} 行没有占比条填充`);
      expect(bar.trackWidth).toBeCloseTo(56, 1);
      expect(bar.ratio).toBeCloseTo(expectedRatios[index], 2);
    });

    // 占比之和落在合理范围：行内按 0.1% 四舍五入，三项合计最多差 0.15。
    const pcts = await region.locator('[data-probe="attribution-row-pct"]').allTextContents();
    const sum = pcts.reduce((total, text) => total + Number.parseFloat(text), 0);
    expect(sum).toBeGreaterThanOrEqual(99.5);
    expect(sum).toBeLessThanOrEqual(100.5);
  });

  test("点首行切到会话分析，当前会话标题与行标题逐字相等", async ({ page }) => {
    await openUsage(page);

    const firstRow = list(page).getByRole("button").first();
    const rowTitle = await firstRow.locator('[data-probe="attribution-row-title"]').innerText();
    expect(rowTitle).toBe("窗口归因夹具会话 1");

    await firstRow.click();

    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // 逐字相等：不是「页面没崩」，而是真的开对了点下去的那一个会话。
    await expect(page.getByLabel("会话信息").locator("strong")).toHaveText(rowTitle);
    // 会话内容真的解析完了（图状态只在会话打开且解析完成后给出这句）。
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
  });
});

test.describe("按会话的配额归因 · 超过 Top 5", () => {
  test.use({ scenario: quotaAttributionScenario({ sessions: 6 }) });

  test("6 个会话收敛为 Top 5 + 「其余 1 个会话」，余项不是按钮", async ({ page }) => {
    await openUsage(page);

    const region = panel(page);
    await expect(region).toBeVisible();

    const listLocator = list(page);
    // 5 个会话行 + 1 个余项 = 6 个列表项；余项只多一行，不冒充第 6 个会话。
    await expect(listLocator.getByRole("button")).toHaveCount(5);
    await expect(listLocator.getByRole("listitem")).toHaveCount(6);

    // 总数 2,100,000：Top 5 = 2,000,000（95.2%），余项 = 100,000（4.8%）。
    await expect(region.locator('[data-probe="attribution-row-pct"]')).toHaveText([
      "28.6%",
      "23.8%",
      "19.0%",
      "14.3%",
      "9.5%"
    ]);

    const rest = listLocator.locator('[data-probe="attribution-rest"]');
    await expect(rest).toHaveCount(1);
    await expect(rest).toContainText("其余 1 个会话");
    await expect(rest).toContainText("100,000 tok");
    // 余项不是会话：role=button 数不到它，行内也没有 button 元素，标签就是 li。
    await expect(listLocator.getByRole("button", { name: /其余 1 个会话/ })).toHaveCount(0);
    await expect(rest.locator("button")).toHaveCount(0);
    expect(await rest.evaluate((node) => node.tagName)).toBe("LI");

    // 行内按 0.1% 四舍五入：5 行 + 余项的可见百分比合计仍是 100%。
    const rowPcts = await region.locator('[data-probe="attribution-row-pct"]').allTextContents();
    // 余项行没有 data-probe 的百分比锚点，取它最后一个 span（四列的最后一列）。
    const restPct = await rest.locator("span").last().innerText();
    const sum = [...rowPcts, restPct].reduce(
      (total, text) => total + Number.parseFloat(text),
      0
    );
    expect(sum).toBeGreaterThanOrEqual(99);
    expect(sum).toBeLessThanOrEqual(101);
  });
});

test.describe("按会话的配额归因 · 窗口内没有可归因的消耗", () => {
  test.use({ scenario: quotaAttributionScenario({ sessions: 1, withUsage: false }) });

  test("窗口总量为 0 时计费卡在、归因面板整块不渲染", async ({ page }) => {
    await openUsage(page);

    // 卡在：窗口里有记录（会话列得出来），所以计费窗口照常渲染。
    await expect(page.getByLabel("计费窗口")).toBeVisible();
    // 面板不在：没有分母就没有比率，不画 0 行空列表。
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-probe="attribution-panel"]')).toHaveCount(0);
  });
});
