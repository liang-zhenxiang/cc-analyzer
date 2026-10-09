import type { Page } from "@playwright/test";
import { test, expect, defaultScenario, fixture } from "./fixtures";
import type { MockScenario } from "./tauri-mock";

/**
 * 会话详情「上下文」标签页（Round J · J2）。
 *
 * 这一层验证的是只有真实排版引擎才给得出的东西：曲线 SVG 真的画出来、
 * 事件 chip 可点且取证卡数字正确、被丢清单可达且能一步跳回日志视图、
 * 空态是「有数据的零」而不是空盒子。数据全部来自共享夹具
 * compact-session.jsonl（2 次压缩：auto + manual，断崖 ≥10×）。
 */

const HOME = "/Users/e2e";

/** 默认场景 + 压缩夹具会话（/repo/compact-demo）。 */
function compactScenario(): MockScenario {
  const base = defaultScenario();
  return {
    ...base,
    files: {
      ...base.files,
      [`${HOME}/.claude/projects/-repo-compact-demo/compact-session.jsonl`]: fixture(
        "compact-session.jsonl"
      )
    }
  };
}

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

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
});

test.describe("上下文标签页（无压缩会话）", () => {
  test("曲线照画，事件面板是「有数据的零」", async ({ page }) => {
    // 默认场景里的 /repo/demo（session-basic：有 usage、无压缩）。
    await openContextView(page, "demo");

    await expect(page.getByRole("img", { name: /未发生压缩/ })).toBeVisible();
    await expect(page.getByText("本会话未发生压缩——上下文从未重置")).toBeVisible();
    await expect(page.getByRole("button", { name: /^#/ })).toHaveCount(0);
  });
});
