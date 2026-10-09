import type { Page } from "@playwright/test";
import { test, expect, defaultScenario, fixture, shiftDays } from "./fixtures";
import type { MockScenario } from "./tauri-mock";

/**
 * Round J · J3 三处集成的端到端覆盖：
 *
 * 1. 日志表压缩边界带行——出现、可展开、摘要不再单独成行、「在上下文视图定位」
 *    与 J2 的选中态握手；
 * 2. 用量总览「压缩（上下文重置）」面板——数字与夹具一致、top3 行真能打开会话；
 * 3. 解析覆盖率 chip——出现条件、弹出卡分布表、复制报告只进剪贴板且不带路径。
 *
 * 数据来自共享夹具 compact-session.jsonl（2 次压缩：auto 156,200 + manual
 * 146,600 = 302,800 丢弃；unknown 类型 future-widget×2 / quantum-latch×1、
 * 1 行坏 JSON → M = 4）。压缩夹具按**自己的**活动日（2026-03-01）平移到
 * 「昨天」——它与默认场景的锚点日不同，各平移各的，用量页 30 天窗内的
 * 计数因此是确定值。
 */

const HOME = "/Users/e2e";
/** 压缩夹具的最新活动日（boundary #2 之后的最后几条消息同在 2026-03-01）。 */
const COMPACT_FIXTURE_DAY = Date.UTC(2026, 2, 1);

/** 默认场景 + 平移到「最新活动日在昨天」的压缩夹具会话（/repo/compact-demo）。 */
function compactRecentScenario(): MockScenario {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const target = Date.UTC(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
  const offsetDays = Math.round((target - COMPACT_FIXTURE_DAY) / 86_400_000);
  const base = defaultScenario();
  return {
    ...base,
    files: {
      ...base.files,
      [`${HOME}/.claude/projects/-repo-compact-demo/compact-session.jsonl`]: shiftDays(
        fixture("compact-session.jsonl"),
        offsetDays
      )
    }
  };
}

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

async function openCompactSession(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill("compact-demo");
  await sessionItems(page).first().click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

test.describe("J3 三处集成（含压缩会话）", () => {
  test.use({ scenario: compactRecentScenario() });

  test("日志表出现压缩带行：筛选可见、摘要折叠、可展开并可定位到上下文视图", async ({
    page
  }) => {
    await openCompactSession(page);

    // 186+ 行的会话在默认阈值下走了虚拟化，带行不在首屏——先用「压缩」类型
    // 筛选把它变成仅有的两行（这同时验了第七个 chip 真的接上了行模型）。
    await page.getByRole("region", { name: "记录筛选" }).getByRole("button", { name: "压缩" }).click();

    const table = page.getByRole("table");
    await expect(table.getByText("压缩 #1（自动）")).toBeVisible();
    await expect(table.getByText("压缩 #2（手动）")).toBeVisible();
    await expect(table.getByText("167,400 → 11,200 tok · 丢弃 156,200 · 37.5s")).toBeVisible();

    // 通栏带行：整行只有一个跨 8 列的单元格，不是消息行的列布局。
    const band = table.getByText("压缩 #1（自动）").locator("xpath=ancestor::tr");
    await expect(band.locator("td")).toHaveCount(1);
    const colspan = await band.locator("td").getAttribute("colspan");
    expect(colspan).toBe("8");

    // 摘要消息不单独成行：折叠态整表都没有它的正文（数据约束 #3）。
    await expect(table).not.toContainText("previous conversation");

    // 展开区三块 + 摘要在其中现形 + 幸存清单是行语言。
    await page.getByRole("button", { name: "展开压缩行" }).first().click();
    await expect(page.getByRole("region", { name: "压缩摘要（模型重写）" })).toContainText(
      "previous conversation"
    );
    // 幸存清单是行语言：事件 #1 幸存的是第 47–49 轮的用户/模型消息。
    await expect(page.getByRole("region", { name: "幸存消息" })).toContainText("继续第");
    await expect(page.getByRole("region", { name: "原始事件" })).toContainText(
      "compact_boundary"
    );

    // 与 J2 握手：切到上下文标签并选中 #1（取证卡标题带编号）。
    await page.getByRole("button", { name: "在上下文视图定位" }).click();
    await expect(page.getByRole("tab", { name: "上下文" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByRole("region", { name: "压缩事件" })).toContainText("压缩 #1 ·");
  });

  test("用量总览压缩面板数字与夹具一致，top3 行能打开会话", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();

    const panel = page.getByRole("region", { name: "压缩（上下文重置）" });
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // 2 次（自动 1 / 手动 1）、Σ(pre−post) = 156,200 + 146,600 = 302,800、1 个会话。
    await expect(panel.getByText("压缩次数").locator("xpath=following-sibling::span[1]")).toHaveText("2");
    await expect(
      panel.getByText("累计丢弃").locator("xpath=following-sibling::span[1]")
    ).toHaveText("302,800 tok");
    await expect(panel.getByText("触发会话").locator("xpath=following-sibling::span[1]")).toHaveText("1 个");
    await expect(panel.getByText("自动 1")).toBeVisible();
    await expect(panel.getByText("手动 1")).toBeVisible();
    await expect(page.getByRole("img", { name: "压缩触发方式分布" })).toBeVisible();

    // 用量页与取证页的握手：点击 top 行切回会话分析并落到该会话。
    // exact：会话打开后报告面板还有「整会话分析」这个 tab，子串会撞两个。
    await page.getByRole("list", { name: "丢弃最多的会话" }).getByRole("button").click();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // 会话图状态只在有会话打开时渲染——它读到「已加载」即证明会话真的开了。
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
  });

  test("解析覆盖率 chip：M=4 出现，弹出卡有分布表，复制报告不携带路径", async ({
    page
  }) => {
    await openCompactSession(page);

    const chip = page.getByRole("button", { name: "4 行未识别" });
    await expect(chip).toBeVisible();
    await chip.click();

    const dialog = page.getByRole("dialog", { name: "解析覆盖率" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("future-widget");
    await expect(dialog).toContainText("quantum-latch");
    await expect(dialog).toContainText("（无法解析的行）");

    await dialog.getByRole("button", { name: "复制报告" }).click();
    const writes = await page.evaluate(
      () => (window as unknown as { __CCA_CLIPBOARD__?: string[] }).__CCA_CLIPBOARD__ ?? []
    );
    const report = writes.at(-1) ?? "";
    expect(report).toContain("future-widget: 2");
    expect(report).toContain("quantum-latch: 1");
    // 隐私红线：报告只进剪贴板，且短式标识之外不得出现任何绝对路径。
    expect(report).not.toContain("/Users/");
    expect(report).not.toContain(".jsonl");
  });
});

test.describe("J3 · 无压缩的会话", () => {
  test.use({ scenario: defaultScenario() });

  test("日志表没有压缩带行，压缩筛选后为空，覆盖率 chip 不出现", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("demo");
    await sessionItems(page).first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });

    await expect(page.getByRole("table")).not.toContainText("压缩 #");
    await expect(page.getByRole("button", { name: /行未识别/ })).toHaveCount(0);

    await page
      .getByRole("region", { name: "记录筛选" })
      .getByRole("button", { name: "压缩" })
      .click();
    await expect(page.getByText("没有符合筛选条件的记录")).toBeVisible();
  });

  test("用量总览压缩面板是「有数据的零」：一行事实，不画空图", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();

    const panel = page.getByRole("region", { name: "压缩（上下文重置）" });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toContainText("近 30 天没有压缩记录——没有会话触发过上下文重置。");
    await expect(page.getByRole("img", { name: "压缩触发方式分布" })).toHaveCount(0);
  });
});
