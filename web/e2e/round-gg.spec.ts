import { test, expect, defaultScenario, roundGGScenario } from "./fixtures";
import type { Page } from "@playwright/test";
import { sessionItems } from "./selectors";

/**
 * Round GG（第五批十功能）端到端：
 *
 * G1 会话故事线、G5 错误档案、G8 项目季节、G2 会话筛选栏、G6 工具按月、
 * G9 相似会话、G7 上下文峰值分位、G4 年报逐月下钻、G3 会话档案导出、
 * G10 快照对比对话框 + 两条空态。
 *
 * 夹具是独立场景（不并进 SESSION_SEEDS）：并进默认场景会让 8 张列表截图的
 * 会话条数基线一起漂移。所有时刻由 roundGGNow() 锚定，不直读 Date.now()。
 */
test.use({ scenario: roundGGScenario() });

async function openUsage(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByText("Tokens 总量").first().waitFor();
  await page.getByText(/个会话纳入统计/).waitFor();
}

test.describe("Round GG 十功能", () => {
  test("G1 工作日志按天聚合，点开某天看到当天会话", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    const days = page.locator("[data-probe='story-day']");
    await expect(days).toHaveCount(7);
    // 夹具：今天 2 个会话（595,400 token），两个会话分别在 09:10 / 14:30。
    await expect(days.first()).toContainText("11-01");
    await expect(days.first()).toContainText("2 会话 · 1 项目 · 595,400 token · 最忙 09:00");
    await days.first().click();
    const detail = page.locator("[data-probe='story-detail']").first();
    await expect(detail.locator("li")).toHaveCount(2);
    await expect(detail).toContainText("今天上午：把对比视图的读数对一遍");
  });

  test("G5 错误档案按工具+签名聚合，展开看到样本与时间跨度", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    await page.getByRole("tab", { name: "错误" }).click();
    const tabs = page.getByRole("tablist", { name: "错误视图" });
    await expect(tabs.getByRole("tab")).toHaveText(["时间线", "档案"]);
    await tabs.getByRole("tab", { name: "档案" }).click();
    const rows = page.locator("[data-probe='archive-row']");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Bash");
    await expect(rows.first()).toContainText("5");
    await expect(rows.first()).toContainText("10-29 16:02 – 11-01 14:33");
    await expect(rows.nth(1)).toContainText("Read");
    await expect(rows.nth(1)).toContainText("ENOENT: no such file or directory");
    await page.getByRole("button", { name: /展开 Bash .* 的档案/ }).click();
    const detail = page.locator("[data-probe='archive-detail']");
    await expect(detail).toContainText("代表消息：");
    await expect(detail).toContainText("代表消息：Error: exit code 1");
  });

  test("G8 项目卡片给出四季度占比，最重季度写下百分比", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    const cards = page.locator("[data-probe='card-item']");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("gg-alpha");
    await expect(cards.first()).toHaveAttribute(
      "aria-label",
      "gg-alpha：4 个会话，1.1M token，成本 $7.68，最近活跃 刚刚，季节性：Q1 7%、Q2 18%、Q3 11%、Q4 64%"
    );
    await expect(cards.nth(1)).toHaveAttribute(
      "aria-label",
      /^gg-beta：3 个会话，137,600 token，成本 \$0\.42，最近活跃 \d+小时前，季节性：Q1 30%、Q2 11%、Q3 14%、Q4 44%$/
    );
    const seasons = page.locator("[data-probe='card-season']");
    await expect(seasons).toHaveCount(2);
    await expect(seasons.first()).toHaveAttribute("data-quarters", "4");
    await expect(page.locator("[data-probe='card-season-text']").first()).toHaveText("Q4 最重（64%）");
  });

  test("G2 筛选栏：错误条件把 13 个会话收窄到 4 个", { tag: "@round-gg" }, async ({ page }) => {
    await page.goto("/");
    await expect(sessionItems(page)).toHaveCount(13);
    const toggle = page.locator("[data-probe='session-query-toggle']");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("[data-probe='session-query-body']")).toBeVisible();
    await page.getByLabel("错误").selectOption("has");
    await expect(page.locator("[data-probe='session-query-toggle']")).toContainText(
      "筛选：1 个条件"
    );
    await expect(sessionItems(page)).toHaveCount(4);
    await page.locator("[data-probe='session-query-clear']").click();
    await expect(sessionItems(page)).toHaveCount(13);
  });

  test("G6 工具调用按月：5 个工具、Read 14 次并给出趋势", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    await page.getByRole("tab", { name: "按月" }).click();
    const rows = page.locator("[data-probe='tool-month-row']");
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText("Read");
    await expect(rows.first()).toContainText("14");
    await expect(rows.first()).toContainText("近 3 月 ↑");
    await expect(page.locator("[data-probe='tool-months'] [role='img']")).toHaveCount(5);
    await expect(rows.nth(1)).toContainText("Bash");
    await expect(page.locator("[data-probe='tool-months']")).toContainText("工具月（11 个月）");
  });

  test("G9 相似会话：点名对照会话并给出相似度与理由", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    const similar = page.locator("[data-probe='compare-similar']");
    await expect(similar).toContainText("与「Q4：整理 alpha 的季度账」最像");
    await expect(similar).toContainText("用了 3 个相同工具");
    await expect(similar).toContainText("100%");
  });

  test("G7 上下文峰值分位数：5 档，最大值等于 330k", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    const quantiles = page.locator("[data-probe='ctx-quantiles']");
    await expect(quantiles).toHaveAttribute("aria-label", "会话上下文峰值分位数");
    await expect(page.locator("[data-probe='ctx-q']")).toHaveCount(5);
    await expect(page.locator("[data-probe='ctx-q'][data-q='max']")).toHaveText("最大330k");
    await expect(page.locator("[data-probe='ctx-q'][data-q='p90']")).toHaveText("P90240k");
  });

  test("G4 年报逐月卡下钻回用量档并选中当月最活跃日", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    await page.getByRole("tab", { name: "年报" }).click();
    const months = page.locator("[data-probe='annual-months'] button");
    await expect(months).toHaveCount(11);
    await expect(months.last()).toHaveAttribute("aria-label", "2026 年 11 月 · 595,400");
    await months.last().click();
    await expect(page.getByRole("tab", { name: "用量", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.locator("[data-probe='day-summary']")).toContainText("595,400");
  });

  test("G3 会话档案导出：说明、记录数与保护性提示", { tag: "@round-gg" }, async ({ page }) => {
    await page.goto("/");
    await sessionItems(page).first().click();
    await page.getByRole("button", { name: "导出", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: "档案" }).click();
    await expect(page.locator("[data-probe='export-archive-note']")).toContainText(
      "只含统计与时间线摘要，不含消息内容与文件路径"
    );
    await expect(dialog).toContainText("将导出整会话档案（8 条记录汇总）");
    await expect(dialog.getByRole("button", { name: "保存…" })).toBeVisible();
  });

  test("G10 快照对比对话框：两份 JSON、六项合计与分母说明", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    await page.getByRole("button", { name: "对比两份用量快照" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("比它俩的六项合计");
    await expect(dialog).toContainText("百分比以 A 为分母");
    await expect(page.locator("[data-probe='snapshot-export-json']")).toHaveText(
      "导出当前区间为 JSON"
    );
    await dialog.getByRole("button", { name: "关闭" }).first().click();
    await expect(dialog).toHaveCount(0);
  });

  test.describe("空态 · D9 单分钟", () => {
    const base = defaultScenario();
    const oneMinute = (() => {
      const t = Math.floor(Date.now() / 60_000) * 60_000 - 60_000;
      const iso = new Date(t).toISOString();
      const records = [
        { type: "user", message: { role: "user", content: "一分钟内的会话" }, sessionId: "gg-one-minute", cwd: "/repo/one-minute", uuid: "gg-1m-u", parentUuid: null, timestamp: iso, version: "2.1.0" },
        { type: "assistant", message: { role: "assistant", id: "msg_1m", model: "claude-sonnet-4-5", content: [{ type: "text", text: "好" }], usage: { input_tokens: 2_000, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }, sessionId: "gg-one-minute", cwd: "/repo/one-minute", uuid: "gg-1m-a", parentUuid: "gg-1m-u", timestamp: new Date(t + 30_000).toISOString(), version: "2.1.0" }
      ];
      return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
    })();
    const path = `${base.home}/.claude/projects/-repo-one-minute/gg-one-minute.jsonl`;

    test.use({ scenario: { ...base, files: { [path]: oneMinute } } });

    test("只有一分钟有 token 时写明「只有这 1 分钟」", { tag: "@round-gg" }, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("tab", { name: "用量总览" }).click();
      await page.getByText("Tokens 总量").first().waitFor();
      await expect(page.locator("[data-probe='peak-minute']")).toContainText(
        "窗口内只有这 1 分钟有消耗"
      );
    });
  });

  test("空态 · D6 未选计划时不渲染燃烧表", { tag: "@round-gg" }, async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-billing-plan", JSON.stringify({ id: "none" }));
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();
    await page.getByText("Tokens 总量").first().waitFor();
    await expect(page.locator("[data-probe='burn-gauge']")).toHaveCount(0);
    await expect(page.locator("[data-probe='forecast-row']")).toHaveCount(0);
  });
});
