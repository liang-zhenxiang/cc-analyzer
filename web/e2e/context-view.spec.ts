import type { Locator, Page } from "@playwright/test";
import { test, expect, compactScenario } from "./fixtures";
import { sessionItems } from "./selectors";

/**
 * 会话详情「上下文」标签页（Round J · J2）。
 *
 * 这一层验证的是只有真实排版引擎才给得出的东西：曲线 SVG 真的画出来、
 * 事件 chip 可点且取证卡数字正确、被丢清单可达且能一步跳回日志视图、
 * 空态是「有数据的零」而不是空盒子。数据全部来自共享夹具
 * compact-session.jsonl（2 次压缩：auto + manual，断崖 ≥10×）。
 */

async function openSession(page: Page, query: string) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill(query);
  await sessionItems(page).first().click();
}

async function openContextView(page: Page, query: string) {
  await openSession(page, query);
  await page.getByRole("tab", { name: "上下文" }).click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

/** 一个 SVG 文本元素在 viewBox 坐标系里的包围盒（getBBox 用的就是用户单位）。 */
async function inkBoxes(locator: Locator) {
  return locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = (node as SVGGraphicsElement).getBBox();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    })
  );
}

/** 断言一组 bbox 完整落在 720×220 的 viewBox 内（Issue #341 的回归判据）。 */
function expectInsideViewBox(boxes: { x: number; y: number; width: number; height: number }[]) {
  for (const box of boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(720);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(220);
  }
}

test.describe("上下文标签页（含压缩会话）", () => {
  test.use({ scenario: compactScenario() });

  test("曲线、事件标记与压缩事件条齐备，取证数字与夹具一致", async ({ page }) => {
    await openContextView(page, "compact-demo");

    // 主图：role=img 带摘要，且真的有面积/描边两条 path。
    const chart = page.getByRole("img", { name: /上下文压力：120 条模型消息/ });
    await expect(chart).toBeVisible();
    await expect(chart.locator("path").first()).toBeAttached();

    // 事件三件套：每个压缩一根竖线、一个菱形、一个 24px 命中区。
    await expect(chart.locator("rect[data-event-id]")).toHaveCount(2);

    // 事件条：两个 chip，编号与 trigger 都是文字。
    const panel = page.getByRole("region", { name: "压缩事件" });
    await expect(panel.getByRole("button", { name: /#1 .*自动/ })).toHaveCount(1);
    await expect(panel.getByRole("button", { name: /#2 .*手动/ })).toHaveCount(1);

    // 点击 chip #2：取证卡数字 + 被丢清单（边界 2：86 条上下文 − 4 幸存 = 82）。
    await panel.getByRole("button", { name: /#2 / }).click();
    await expect(panel.getByText(/156,200/)).toBeVisible();
    await expect(panel.getByText(/9,600/)).toBeVisible();
    const list = panel.getByRole("region", { name: "被丢出上下文的内容" });
    await expect(list.getByText("被丢出上下文的内容 · 82 条")).toBeVisible();
    await expect(list.getByRole("listitem").first()).toBeVisible();
  });

  test("被丢清单行点击跳回日志视图定位该记录", async ({ page }) => {
    await openContextView(page, "compact-demo");
    const panel = page.getByRole("region", { name: "压缩事件" });
    await panel.getByRole("button", { name: /#1 / }).click();

    const list = panel.getByRole("region", { name: "被丢出上下文的内容" });
    await list.getByRole("listitem").first().click();

    // 视图切回日志页签，表格里能找到那条被丢的首条消息。
    await expect(page.getByRole("tab", { name: "日志视图" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("table").getByText("帮我梳理这个仓库的解析层").first()).toBeVisible();
  });

  test("时间线与筛选在上下文标签页消失（取证口径不可漂移）", async ({ page }) => {
    await openContextView(page, "compact-demo");
    await expect(page.getByRole("img", { name: /上下文压力/ })).toBeVisible();
    await expect(page.getByLabel("会话时间概览")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "记录筛选" })).toHaveCount(0);

    // 切回日志视图它们要回来。
    await page.getByRole("tab", { name: "日志视图" }).click();
    await expect(page.getByLabel("会话时间概览")).toBeVisible();
    await expect(page.getByRole("region", { name: "记录筛选" })).toBeVisible();
  });

  test("x 轴刻度与 0 基线完整落在 viewBox 内（不再被面板底边裁掉）", async ({ page }) => {
    await openContextView(page, "compact-demo");
    const chart = page.getByRole("img", { name: /上下文压力：120 条模型消息/ });

    // 刻度是真实 DOM 文本（不是画上去的像素）：bbox 以用户单位报告，直接与
    // 720×220 的 viewBox 比较。修复前面板体只有 256px 高，y=214 的这排刻度
    // 整排落在裁切区外——这里量的就是那排。
    const ticks = chart.locator('[data-probe="x-axis-tick"]');
    await expect(ticks.first()).toBeAttached();
    const boxes = await inkBoxes(ticks);
    expect(boxes.length).toBeGreaterThan(3);
    expectInsideViewBox(boxes);

    // 0 基线标签（y 轴唯一的「0」）与 x 轴同处一条被裁区间。
    const zero = chart.getByText("0", { exact: true });
    await expect(zero).toHaveCount(1);
    expectInsideViewBox(await inkBoxes(zero));
  });

  test("压缩事件面板的最后一行可完整滚入容器（不被 overflow 裁掉）", async ({ page }) => {
    await openContextView(page, "compact-demo");
    const panel = page.getByRole("region", { name: "压缩事件" });
    await panel.getByRole("button", { name: /#2 / }).click();

    // 取证数字栏是面板被压缩时唯一没有滚动链的一列：把它的六行事实滚到底，
    // 末行「幸存消息」的 bbox 必须完整落在容器可视区里。
    const facts = panel.locator('[data-probe="context-facts"]');
    await expect(facts).toBeVisible();
    const lastFact = facts.locator("dl > div").last();
    await expect(lastFact).toContainText("幸存消息");
    await facts.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const geometry = await facts.evaluate((el) => {
      const last = el.querySelector("dl > div:last-child");
      if (!last) throw new Error("取证数字栏缺少末行");
      const container = el.getBoundingClientRect();
      const row = last.getBoundingClientRect();
      return {
        containerTop: container.top,
        containerBottom: container.bottom,
        rowTop: row.top,
        rowBottom: row.bottom
      };
    });
    expect(geometry.rowTop).toBeGreaterThanOrEqual(geometry.containerTop - 0.5);
    expect(geometry.rowBottom).toBeLessThanOrEqual(geometry.containerBottom + 0.5);
  });
});

test.describe("上下文标签页（无压缩会话）", () => {
  test("曲线照画，事件面板是「有数据的零」", async ({ page }) => {
    // 默认场景里的 /repo/demo（session-basic：有 usage、无压缩）。
    await openContextView(page, "demo");

    await expect(page.getByRole("img", { name: /未发生压缩/ })).toBeVisible();
    await expect(page.getByText("本会话未发生压缩——上下文从未重置")).toBeVisible();
    await expect(page.getByRole("button", { name: /^#/ })).toHaveCount(0);
  });

  test("峰值标签完整落在 viewBox 内（右缘峰值不再被切成「峰值 2」）", async ({ page }) => {
    await openContextView(page, "demo");
    const chart = page.getByRole("img", { name: /未发生压缩/ });
    const peak = chart.locator('[data-probe="peak-label"]');
    await expect(peak).toHaveCount(1);
    // 峰值通常在最后一条消息上（x≈708）：修复前 textAnchor="middle" 让右半截
    // 落在 720 的 viewBox 之外，截图里只剩「峰值 2」。
    expectInsideViewBox(await inkBoxes(peak));
  });
});
