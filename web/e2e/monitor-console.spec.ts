import type { Page } from "@playwright/test";
import {
  test,
  expect,
  emptyScenario,
  monitorConsoleScenario,
  MONITOR_CONSOLE_EVENT_COUNTS,
  MONITOR_CONSOLE_NOW,
  MONITOR_CONSOLE_TITLES,
  MONITOR_CONSOLE_TOTAL_TOKENS
} from "./fixtures";

/**
 * 「监控台」的端到端（Issue #225，R3–R9）。
 *
 * 场景：三个项目 / 三个活跃会话，合计 2,200 token；事件流恰 7 条
 * （3 个会话开始 + 2 次压缩 + 2 条错误）。所有时间相对 `Date.now()` 现算，
 * 所以「今天」「近 15 分钟」和 24 小时三态不会随运行日期漂移。
 */
test.use({ scenario: monitorConsoleScenario() });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(MONITOR_CONSOLE_NOW);
});

function readout(page: Page, id: string) {
  return page.locator(`[data-probe='monitor-console-readout'][data-readout='${id}']`);
}

function eventRows(page: Page) {
  return page.locator("[data-probe='monitor-console-event-row']");
}

function projectRows(page: Page) {
  return page.locator("[data-probe='monitor-console-project-row']");
}

async function openConsole(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "实时监控" }).click();
  await page.getByRole("tab", { name: "监控台" }).click();
  const view = page.locator("[data-probe='monitor-console-page']");
  await expect(view).toHaveAttribute("data-state", "fresh", { timeout: 15_000 });
  return view;
}

test.describe("监控台 · 确定值", () => {
  test("四枚读数、项目榜与 24 小时三态与夹具账逐项吻合", async ({ page }) => {
    const view = await openConsole(page);

    const readouts = page.locator("[data-probe='monitor-console-readout']");
    await expect(readouts).toHaveCount(4);
    expect(
      await readouts.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-readout")))
    ).toEqual(["window", "today", "active-sessions", "today-compactions"]);

    await expect(readout(page, "window").locator("b")).toHaveText("2,200");
    await expect(readout(page, "window").locator("b")).toHaveAttribute(
      "title",
      String(MONITOR_CONSOLE_TOTAL_TOKENS)
    );
    await expect(readout(page, "today").locator("b")).toHaveText("2,200");
    await expect(readout(page, "active-sessions").locator("b")).toHaveText("3");
    await expect(readout(page, "today-compactions").locator("b")).toHaveText("2");

    await expect(projectRows(page)).toHaveCount(3);
    await expect(page.locator("[data-probe='monitor-console-projects']")).toContainText(
      "console-beta"
    );
    await expect(page.locator("[data-probe='monitor-console-projects']")).toContainText(
      "console-alpha"
    );
    await expect(page.locator("[data-probe='monitor-console-projects']")).toContainText(
      "console-gamma"
    );

    const slots = page.locator("[data-probe='monitor-console-hour-slot']");
    await expect(slots).toHaveCount(24);
    await expect(page.locator("[data-probe='monitor-console-hour']")).toHaveCount(24);
    expect(
      new Set(
        await page
          .locator("[data-probe='monitor-console-hour']")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-phase")))
      )
    ).toEqual(new Set(["past", "current", "future"]));
    const current = page.locator("[data-probe='monitor-console-hour'][data-phase='current']");
    await expect(current).toHaveCount(1);
    await expect(current.locator("[data-probe='monitor-console-hour-fill']")).toHaveAttribute(
      "data-partial",
      "true"
    );

    const future = page.locator("[data-probe='monitor-console-hour'][data-phase='future']");
    expect(await future.count()).toBeGreaterThan(0);
    await expect(future.locator("[data-probe='monitor-console-hour-fill']")).toHaveCount(0);

    // 错误正文在夹具里带绝对路径；界面只能显示脱敏后的首行。
    const rendered = await view.evaluate((node) => `${node.textContent}\n${node.innerHTML}`);
    expect(rendered).not.toContain("/Users/");
    expect(rendered).not.toContain("/home/");
    await expect(page.locator("[data-probe='monitor-console-event-detail']").first()).not.toHaveText(
      ""
    );
  });

  test("5 小时窗口「已用」与脉搏逐位相等", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "实时监控" }).click();
    await expect(page.locator("[data-probe='pulse-page']")).toHaveAttribute("data-state", "fresh", {
      timeout: 15_000
    });
    const pulseUsed = await page.locator("[data-readout='used'] b").getAttribute("title");
    expect(pulseUsed).toBe(String(MONITOR_CONSOLE_TOTAL_TOKENS));

    await page.getByRole("tab", { name: "监控台" }).click();
    await expect(page.locator("[data-probe='monitor-console-page']")).toHaveAttribute(
      "data-state",
      "fresh",
      { timeout: 15_000 }
    );
    const consoleUsed = await readout(page, "window").locator("b").getAttribute("title");
    expect(consoleUsed).toBe(pulseUsed);
  });
});

test.describe("监控台 · 筛选", () => {
  test("点项目行筛事件流，事件都属于该项目；再点取消恢复", async ({ page }) => {
    await openConsole(page);
    await expect(eventRows(page)).toHaveCount(MONITOR_CONSOLE_EVENT_COUNTS.all);

    const beta = projectRows(page).filter({ hasText: "console-beta" });
    await expect(beta).toHaveCount(1);
    await beta.click();
    await expect(beta).toHaveAttribute("data-selected", "true");
    await expect(eventRows(page)).toHaveCount(3);

    const texts = await eventRows(page).allTextContents();
    expect(texts).toHaveLength(3);
    for (const text of texts) {
      expect(text).toContain(MONITOR_CONSOLE_TITLES.beta);
      expect(text).not.toContain(MONITOR_CONSOLE_TITLES.alpha);
      expect(text).not.toContain(MONITOR_CONSOLE_TITLES.gamma);
    }

    await beta.click();
    await expect(beta).toHaveAttribute("data-selected", "false");
    await expect(eventRows(page)).toHaveCount(MONITOR_CONSOLE_EVENT_COUNTS.all);
  });

  test("事件类型四档：全部 / 压缩 / 错误 / 会话开始", async ({ page }) => {
    await openConsole(page);
    const filters = page.getByRole("radiogroup", { name: "事件类型" });

    await expect(filters.getByRole("radio")).toHaveCount(4);
    await expect(filters.getByRole("radio", { name: "全部" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(eventRows(page)).toHaveCount(MONITOR_CONSOLE_EVENT_COUNTS.all);

    for (const [label, kind, count] of [
      ["压缩", "compaction", MONITOR_CONSOLE_EVENT_COUNTS.compaction],
      ["错误", "error", MONITOR_CONSOLE_EVENT_COUNTS.error],
      ["会话开始", "session", MONITOR_CONSOLE_EVENT_COUNTS.session]
    ] as const) {
      await filters.getByRole("radio", { name: label }).click();
      await expect(filters.getByRole("radio", { name: label })).toHaveAttribute(
        "aria-checked",
        "true"
      );
      const rows = eventRows(page);
      await expect(rows).toHaveCount(count);
      await expect(page.locator(`[data-probe='monitor-console-event-row'][data-kind='${kind}']`)).toHaveCount(
        count
      );
    }

    await filters.getByRole("radio", { name: "全部" }).click();
    await expect(eventRows(page)).toHaveCount(MONITOR_CONSOLE_EVENT_COUNTS.all);
  });
});

test.describe("监控台 · 事件入口", () => {
  test("点事件行落到会话分析并打开那个会话", async ({ page }) => {
    await openConsole(page);

    const event = page
      .locator("[data-probe='monitor-console-event-row'][data-kind='session']")
      .filter({ hasText: MONITOR_CONSOLE_TITLES.alpha });
    await expect(event).toHaveCount(1);
    await event.click();

    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByLabel("会话信息").locator("strong")).toHaveText(
      MONITOR_CONSOLE_TITLES.alpha
    );
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
  });
});

test.describe("监控台 · 空场景", () => {
  test.use({ scenario: emptyScenario() });

  test("一条事实行，不渲染读数带或三张面板", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "实时监控" }).click();
    await page.getByRole("tab", { name: "监控台" }).click();

    const view = page.locator("[data-probe='monitor-console-page']");
    await expect(view).toHaveAttribute("data-state", "empty", { timeout: 15_000 });
    const empty = page.locator("[data-probe='monitor-console-empty']");
    await expect(empty).toBeVisible();
    await expect(empty.locator("strong")).toHaveText("本机还没有会话日志");
    await expect(empty.locator("p")).toHaveCount(1);
    await expect(page.locator("[data-probe='monitor-console-readout']")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "24 小时活动" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "项目热度" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "事件流" })).toHaveCount(0);
  });
});
