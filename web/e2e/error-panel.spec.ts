import { test, expect, errorScenario, recentActivityScenario } from "./fixtures";

/**
 * 「错误」档的端到端（N1）：夹具注入后面板可见且数字与夹具一致、切面过滤
 * 事件列表、事件行跳回会话分析并定位、空区间的诚实空态。
 *
 * 期望值全部由夹具形状计算（夹具注释见 errorStats.test.ts）：API 3 / 工具 4 /
 * 最常见失败工具 Bash（3 次）/ 事件 7 条；时间平移见 errorScenario。
 */

const DASHBOARD = "用量总览";
const ERROR_SEGMENT = "错误";

async function openErrorView(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: DASHBOARD }).click();
  await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: ERROR_SEGMENT, exact: true }).click();
  const view = page.getByLabel("跨会话错误分析");
  await expect(view).toBeVisible();
  return view;
}

test.describe("错误档", () => {
  test.use({ scenario: errorScenario() });

  test("KPI 数字与夹具一致，三个切面与口径脚注都在场", async ({ page }) => {
    const view = await openErrorView(page);

    await expect(view.getByText("3", { exact: true }).first()).toBeVisible();
    await expect(view.getByText("4", { exact: true }).first()).toBeVisible();
    await expect(view.getByText("Bash", { exact: true }).first()).toBeVisible();
    await expect(view.getByText("3 次")).toBeVisible();
    await expect(view.getByText("0 天", { exact: true })).toBeVisible();

    for (const title of ["每日错误率", "按工具失败", "按项目失败密度", "错误事件"]) {
      await expect(page.getByRole("region", { name: title })).toBeVisible();
    }
    // 趋势柱：默认 30 天窗口零填充（区间档与用量档共用，缺省 30）。
    await expect(page.locator("[data-error-trend] rect[data-bar]")).toHaveCount(30);
    // 口径脚注常显：三个分母 + 含子 agent。
    await expect(view.getByText(/失败 = 工具结果被标记为错误/)).toBeVisible();

    // 事件列表：7 条、时间倒序、含子 agent 徽标与身份段。
    await expect(view.getByText(/全部 7 条 · 时间倒序/)).toBeVisible();
    await expect(view.getByText("API·402", { exact: true }).first()).toBeVisible();
    await expect(view.getByText("API·网络", { exact: true }).first()).toBeVisible();
    await expect(view.getByText("子 agent", { exact: true })).toBeVisible();
  });

  test("点工具切面过滤事件列表，再点取消", async ({ page }) => {
    const view = await openErrorView(page);
    await expect(view.getByText(/全部 7 条 · 时间倒序/)).toBeVisible();

    const bashRow = page.getByRole("button", { name: /^Bash/ });
    await bashRow.click();
    await expect(bashRow).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-error-filter]")).toHaveText(/^Bash · 3 条 · 时间倒序$/);

    // 单选语义：再点同一行取消。
    await bashRow.click();
    await expect(page.locator("[data-error-filter]")).toHaveCount(0);
    await expect(view.getByText(/全部 7 条 · 时间倒序/)).toBeVisible();
  });

  test("点主链事件跳回会话分析并定位到记录", async ({ page }) => {
    await openErrorView(page);

    await page.getByRole("button", { name: /String to replace not found/ }).click();

    // 跳回会话分析、会话已开、定位的记录进详情面板——「只能看不能跳」在这里红。
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
    await expect(page.getByRole("complementary", { name: "记录详情" })).toBeVisible();

    // 定位的不只是会话：详情面板里是那条 Edit 失败记录（含固定文案头）。
    const detail = page.getByRole("complementary", { name: "记录详情" });
    await expect(detail).toContainText("String to replace not found");
  });

  test("sidechain 事件落会话本身，不开记录详情", async ({ page }) => {
    await openErrorView(page);

    // 子 agent 徽标的行：recordId=null → 只开会话，不定位记录。
    // （正则锚到徽标——/Exit code 1/ 单用会误伤「Exit code 127」的行。）
    await page.getByRole("button", { name: /Exit code 1\s*子 agent/ }).click();

    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
    await expect(page.getByRole("complementary", { name: "记录详情" })).toHaveCount(0);
  });
});

test.describe("错误档 · 空区间", () => {
  // recentActivityScenario 窗内只有 usage 两个夹具——都没有错误信号：
  // 空态分支要的是「有数据、零错误」，不是「没有数据」。
  test.use({ scenario: recentActivityScenario() });

  test("0 错误是检查后的结果：事实行在场、切面不画", async ({ page }) => {
    const view = await openErrorView(page);

    await expect(view.getByText(/没有发现失败记录——0 是检查后的结果/)).toBeVisible();
    await expect(view.getByText(/检查了 \d+ 个会话的 \d+ 条模型消息与 \d+ 次工具调用/)).toBeVisible();
    await expect(page.getByRole("region", { name: "每日错误率" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "错误事件" })).toHaveCount(0);
  });
});
