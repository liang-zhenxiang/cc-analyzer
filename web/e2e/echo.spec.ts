import { expect, test, emptyScenario, roundFFScenario } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Issue #371「回声」端到端验收。
 *
 * 跑在生产构建上（`npm run build && npm run preview`），双引擎（Chromium +
 * WebKit）。Round FF 夹具里最近 20 天的会话共享同一套标题/首条消息模板，
 * 因此它们会聚成一组「重复话题」——这正好覆盖组头读数、频率条刻度、展开
 * 列表与点击打开会话；具体组数不写死，按组头自己报出的「N 个会话」对账。
 */

async function openLab(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览", exact: true }).click();
  await expect(page.locator("[data-probe='usage-progress']")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "实验室", exact: true }).click();
  await expect(page.getByText(/纳入统计 · 16 个视角/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-probe='lab-view']")).toBeVisible();
}

function echoCard(page: Page): Locator {
  return page.locator('[data-lab-card="echo"]');
}

function groupCountOf(head: Locator): Promise<number> {
  return head
    .textContent()
    .then((text) => Number(/(\d+) 个会话/.exec(text ?? "")?.[1] ?? "0"));
}

test.describe("回声", () => {
  test.use({ scenario: roundFFScenario() });

  test("面板渲染：总结句、组头读数与频率条刻度一一对应", async ({ page }) => {
    await openLab(page);
    const card = echoCard(page);

    await expect(card.getByRole("region", { name: "回声" })).toBeVisible();
    await expect(card.getByText(/发现 \d+ 组重复话题，共 \d+ 个会话/)).toBeVisible();
    // actions 只放估算徽章，不写「N 组」。
    await expect(card.getByText("按定价快照估算", { exact: true })).toHaveCount(1);

    const groups = card.locator("[data-echo-group]");
    const count = await groups.count();
    expect(count).toBeGreaterThan(0);

    const first = groups.first();
    const head = first.getByRole("button", { name: /^展开：/ });
    const sessions = await groupCountOf(head);
    expect(sessions).toBeGreaterThanOrEqual(2);
    await expect(head).toContainText(`${sessions} 个会话`);
    await expect(head).toContainText(/跨度 \d+ 天/);
    // 每个会话一个刻度；轨道与轴标签对读屏隐藏。
    await expect(first.locator("[data-echo-tick]")).toHaveCount(sessions);
    await expect(first.locator("[data-echo-strip]")).toHaveAttribute("aria-hidden", "true");
    await expect(first.locator("[data-echo-axis]")).toHaveAttribute("aria-hidden", "true");
    // 轴只在有起止两日时给两个端点。
    await expect(first.locator("[data-echo-axis] span")).toHaveCount(
      sessions > 0 ? 2 : 0
    );
  });

  test("展开 / 收起：整组头是按钮，行按时间升序且只有一条「代表」", async ({ page }) => {
    await openLab(page);
    const first = echoCard(page).locator("[data-echo-group]").first();
    const head = first.getByRole("button", { name: /^展开：/ });

    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(first.locator("[data-echo-session]")).toHaveCount(0);
    const sessions = await groupCountOf(head);

    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "true");
    await expect(first.locator("[data-echo-session]")).toHaveCount(sessions);
    await expect(first.getByText("代表", { exact: true })).toHaveCount(1);

    // 行按时间升序：每行的 data-echo-session 是会话路径，不直接暴露时间；
    // 用可见时间戳（MM-DD HH:mm）做单调性检查。
    const stamps = await first.locator("[data-echo-session]").evaluateAll((rows) =>
      rows.map((row) => row.querySelector("span")?.textContent?.trim() ?? "")
    );
    expect(stamps).toEqual([...stamps].sort());

    await head.click();
    await expect(head).toHaveAttribute("aria-expanded", "false");
    await expect(first.locator("[data-echo-session]")).toHaveCount(0);
  });

  test("点击会话行跳到会话分析（沿用 onOpenSession）", async ({ page }) => {
    await openLab(page);
    const first = echoCard(page).locator("[data-echo-group]").first();
    await first.getByRole("button", { name: /^展开：/ }).click();

    const row = first.locator("[data-echo-session]").first();
    await expect(row).toBeEnabled();
    await row.click();

    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("键盘：组头可聚焦，Enter 展开、空格收起", async ({ page }) => {
    await openLab(page);
    const first = echoCard(page).locator("[data-echo-group]").first();
    const head = first.getByRole("button", { name: /^展开：/ });

    await head.focus();
    await expect(head).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(head).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press(" ");
    await expect(head).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("回声 · 空态", () => {
  test.use({ scenario: emptyScenario() });

  test("没有会话时显示空态而不是崩溃", async ({ page }) => {
    // 空场景没有进度行；和 lab.spec 一样预先落在实验室档，让卡片自己承担空态。
    await page.addInitScript(() => {
      localStorage.setItem("cca-usage-view", "lab");
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览", exact: true }).click();
    await expect(page.locator("[data-probe='lab-view']")).toBeVisible({ timeout: 15_000 });

    const card = echoCard(page);
    await expect(card.getByRole("region", { name: "回声" })).toBeVisible();
    await expect(card.getByText("本窗口还没有会话")).toBeVisible();
    await expect(card.locator("[data-echo-group]")).toHaveCount(0);
  });
});
