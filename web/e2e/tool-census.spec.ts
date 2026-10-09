import { test, expect, toolCensusScenario, errorScenario, recentActivityScenario } from "./fixtures";

/**
 * 「工具与 skill」面板的端到端（N3）：夹具注入后四栏数字与夹具一致、
 * 双口径读数（行单列含子 agent + title 主链对照）、点行下钻会话列表、
 * 点会话跳回会话分析、折尾行可下钻、桶空态与全空态。
 *
 * 期望值全部由夹具形状计算（夹具注释见 toolCensus.test.ts）：主链 13 /
 * 含子 agent 15（子 agent 占 2/15 = 13.3%）；内置 7 类 9 次（Bash 3 = 2 主 +
 * 1 子）、skill 3 个、MCP 2 个 server（demo 3 段名 / broken 2 段防御名）、
 * 子 agent 1 类。toolCensusScenario 窗内只有这份夹具有 tool_use。
 */

const DASHBOARD = "用量总览";

async function openUsageView(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: DASHBOARD }).click();
  await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
  const panel = page.getByRole("region", { name: "工具与 skill" });
  await expect(panel).toBeVisible();
  await expect(page.locator("[data-tool-census]")).toBeVisible();
  return panel;
}

test.describe("工具与 skill 面板", () => {
  test.use({ scenario: toolCensusScenario() });

  test("四栏数字与夹具一致，双口径读数与口径脚注都在场", async ({ page }) => {
    const panel = await openUsageView(page);

    // 体首行：总量双读数（含子 agent 为主读数，主链常显对照）。
    await expect(panel.getByText("共 15 次调用 · 主链 13 · 子 agent 占 13.3%")).toBeVisible();

    // 栏头量级锚：类数与合计逐栏写明。
    await expect(panel.getByText("7 类 · 9 次")).toBeVisible();
    await expect(panel.getByText("3 个 · 3 次")).toBeVisible();
    await expect(panel.getByText("1 类 · 1 次")).toBeVisible();
    await expect(panel.getByText("2 个服务器 · 2 次")).toBeVisible();

    // 主榜 dual 读数：次数 + 会话数；主链对照在 title（非悬停通道由体首行承担）。
    const bashRow = panel.getByRole("button", { name: /^Bash/ });
    await expect(bashRow).toBeVisible();
    await expect(bashRow).toContainText("3");
    await expect(bashRow).toContainText("1 会话");
    await expect(bashRow).toHaveAttribute("title", "Bash：3 次（主链 2 · 子 agent 1）· 1 个会话");

    // 折尾：7 类内置 → Top-6 + 「其他 1 类」（Write 入尾），会话列不给读数。
    const tail = panel.getByRole("button", { name: /^其他 1 类/ });
    await expect(tail).toContainText("—");

    // skill 名整串保留（命名空间形态不拆）；sidechain-only 的 maintain-loop 也在。
    const skillList = panel.getByRole("list", { name: "skill 调用排行" });
    await expect(skillList.getByRole("button", { name: /git-commit/ })).toBeVisible();
    await expect(skillList.getByRole("button", { name: /trellis:finish-work/ })).toBeVisible();
    await expect(skillList.getByRole("button", { name: /maintain-loop/ })).toBeVisible();

    // MCP：server 行 + title 工具明细（2 段防御名也如实呈现）。
    const demoRow = panel.getByRole("button", { name: /demo/ });
    await expect(demoRow).toContainText("1 次 · 1 个工具");
    await expect(demoRow).toHaveAttribute("title", expect.stringContaining("query 1 次"));
    await expect(panel.getByRole("button", { name: /broken/ })).toHaveAttribute(
      "title",
      expect.stringContaining("mcp__broken 1 次")
    );

    // 子 agent 桶按 subagent_type 归类。
    await expect(
      panel.getByRole("list", { name: "子 agent 调用排行" }).getByRole("button", { name: /trellis-research/ })
    ).toBeVisible();

    await expect(panel.getByText(/调用次数含子 agent 记录/)).toBeVisible();
  });

  test("点榜行下钻会话列表，点会话跳回会话分析", async ({ page }) => {
    const panel = await openUsageView(page);

    const bashRow = panel.getByRole("button", { name: /^Bash/ });
    await bashRow.click();
    await expect(bashRow).toHaveAttribute("aria-pressed", "true");
    await expect(panel.locator("[data-tool-census-filter]")).toHaveAttribute(
      "data-tool-census-filter",
      "Bash"
    );
    await expect(panel.getByText("使用「Bash」最多的会话 · 共 1 个")).toBeVisible();

    // 会话行 → 跳会话分析并打开该会话（用量页与会话分析的握手）。
    await panel.getByRole("button", { name: /盘点最常用工具/ }).click();
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
  });

  test("折尾行可下钻；× 清除后下钻区离场", async ({ page }) => {
    const panel = await openUsageView(page);

    const tail = panel.getByRole("button", { name: /^其他 1 类/ });
    await tail.click();
    await expect(tail).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText("使用「其他 1 类」最多的会话 · 共 1 个")).toBeVisible();
    await expect(panel.locator("[data-tool-census-sessions]")).toBeVisible();

    await panel.getByRole("button", { name: "× 清除" }).click();
    await expect(panel.locator("[data-tool-census-sessions]")).toHaveCount(0);
    await expect(panel.locator("[data-tool-census-filter]")).toHaveCount(0);
    await expect(tail).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("工具与 skill 面板 · 桶空态", () => {
  // errorScenario 窗内只有 error-session 有工具调用（Bash/Read/Edit/
  // AskUserQuestion 全是内置桶成员）——skill / 子 agent / MCP 三栏恰好为空。
  test.use({ scenario: errorScenario() });

  test("空桶栏保留 + 一行事实；AskUserQuestion 是内置桶的普通成员", async ({ page }) => {
    const panel = await openUsageView(page);

    await expect(panel.getByText("共 7 次调用 · 主链 6 · 子 agent 占 14.3%")).toBeVisible();
    await expect(panel.getByText("4 类 · 7 次")).toBeVisible();
    await expect(panel.getByRole("button", { name: /AskUserQuestion/ })).toBeVisible();

    await expect(panel.getByText("本区间没有 skill 调用")).toBeVisible();
    await expect(panel.getByText("本区间没有子 agent 调用")).toBeVisible();
    await expect(panel.getByText("本区间没有 MCP 调用")).toBeVisible();
    // 栏保留：空桶的列表 landmark 不渲染，栏头仍在（版式不跳）。
    await expect(panel.getByText("skill", { exact: true })).toBeVisible();
    await expect(panel.getByRole("list", { name: "skill 调用排行" })).toHaveCount(0);
  });
});

test.describe("工具与 skill 面板 · 全空态", () => {
  // recentActivityScenario 窗内只有两个 usage 夹具——都没有 tool_use：
  // 全空态要的是「有会话、零工具调用」，不是「没有数据」。
  test.use({ scenario: recentActivityScenario() });

  test("0 次工具调用是检查后的结果：事实行在场、四栏不渲染", async ({ page }) => {
    const panel = await openUsageView(page);

    await expect(panel.getByText("近 30 天检查了 2 个会话，没有工具调用记录")).toBeVisible();
    await expect(panel.getByText(/共 \d+ 次调用/)).toHaveCount(0);
    await expect(panel.getByRole("list", { name: "内置工具调用排行" })).toHaveCount(0);
  });
});
