import { test, expect, defaultScenario, roundHHNow, roundHHRecords, roundHHScenario } from "./fixtures";
import { sessionItems } from "./selectors";

/**
 * 第六批十功能（Round HH）端到端门禁。
 *
 * 断言口径：**期望值一律从 `roundHHRecords()` 现算**，不写死日期/百分比。
 * 上一轮（Round GG）在 CI 上因 UTC runner 与本地时区分桶不一致红过四条，
 * 教训是「夹具锚 now、UI 按浏览器本地时区分桶」——凡落到文本上的日期/月，
 * 都在 Node 里用同一套本地时间格式算出来再比。
 */
type Row = Record<string, unknown>;

const records = roundHHRecords() as Row[];
const now = roundHHNow();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function cwdOf(r: Row): string {
  return String(r.cwd ?? "");
}
function tsOf(r: Row): number {
  return Date.parse(String(r.timestamp));
}
function usageOf(r: Row): { i: number; o: number; c: number; cr: number } | null {
  const message = r.message as { usage?: Record<string, number> } | undefined;
  const usage = message?.usage;
  if (!usage) return null;
  return {
    i: usage.input_tokens ?? 0,
    o: usage.output_tokens ?? 0,
    c: usage.cache_creation_input_tokens ?? 0,
    cr: usage.cache_read_input_tokens ?? 0
  };
}
function promptOf(r: Row): string | null {
  const message = r.message as { content?: unknown; role?: string } | undefined;
  if (message?.role !== "user") return null;
  if (typeof message.content === "string") return message.content;
  const parts = Array.isArray(message.content) ? message.content : [];
  const text = parts.find(
    (p): p is { type: string; text: string } =>
      typeof p === "object" && p !== null && (p as { type?: string }).type === "text"
  );
  return text?.text ?? null;
}
function isErrorResult(r: Row): boolean {
  const message = r.message as { content?: unknown } | undefined;
  const parts = Array.isArray(message?.content) ? message.content : [];
  return parts.some(
    (p) => typeof p === "object" && p !== null && (p as { type?: string }).type === "tool_result" && (p as { is_error?: boolean }).is_error === true
  );
}

/** 每个会话（cwd + 首条 timestamp）的创建时刻。 */
function sessionsOf(): Array<{ cwd: string; start: number; prompt: string | null; ctxPeak: number }> {
  const map = new Map<string, { cwd: string; start: number; prompt: string | null; ctxPeak: number }>();
  for (const r of records) {
    const key = `${cwdOf(r)}|${Math.floor(tsOf(r) / HOUR)}`;
    const current = map.get(key);
    const usage = usageOf(r);
    const peak = usage ? usage.i + usage.c + usage.cr : 0;
    if (!current) {
      map.set(key, { cwd: cwdOf(r), start: tsOf(r), prompt: promptOf(r), ctxPeak: peak });
    } else {
      current.prompt ??= promptOf(r);
      current.ctxPeak = Math.max(current.ctxPeak, peak);
    }
  }
  return [...map.values()];
}
const sessions = sessionsOf();
const errorCount = records.filter(isErrorResult).length;

/** 与 UI 相同的本地月格式：`2026-11`。 */
function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}`;
}

async function openUsage(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await expect(page.getByText("Tokens 总量").first()).toBeVisible();
  await expect(page.getByText(/个会话纳入统计/).first()).toBeVisible();
}

async function openSession(page: import("@playwright/test").Page, prompt: string) {
  await page.getByRole("tab", { name: "会话分析" }).click();
  await page.locator("[data-probe='session-query-toggle']").waitFor();
  await sessionItems(page).filter({ hasText: prompt }).first().click();
  await expect(page.getByRole("tab", { name: "日志视图" })).toBeVisible();
}

test.use({ scenario: roundHHScenario() });

test.describe("Round HH 十功能", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "cca-billing-plan",
        JSON.stringify({ id: "custom", customLimitTokens: 1_500_000 })
      );
      localStorage.setItem("cca-usage-range", "90");
    });
  });

  test("H1 三件事：预算/异常日/错误，点错误项跳到错误视图", { tag: "@round-hh" }, async ({ page }) => {
    await openUsage(page);
    const briefing = page.locator("[data-probe='briefing']");
    await expect(briefing).toHaveAttribute("aria-label", "今天值得注意的三件事");
    const items = page.locator("[data-probe='briefing-item']");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toHaveAttribute("data-tone", "alert");
    await expect(items.nth(0)).toContainText("预算限额预计用到");
    await expect(items.nth(0)).toContainText("%");
    await expect(items.nth(1)).toHaveAttribute("data-tone", "warning");
    await expect(items.nth(1)).toContainText(/\d\d-\d\d 用量异常（\+\d+\.\dσ）/);
    await expect(items.nth(2)).toHaveAttribute("data-tone", "alert");
    await expect(items.nth(2)).toContainText(`共 ${errorCount} 条`);

    await items.nth(2).click();
    await expect(page.getByRole("tab", { name: "错误", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  test("H2 模型 A/B：按月的两条曲线（90 天三段）", { tag: "@round-hh" }, async ({ page }) => {
    await openUsage(page);
    const rows = page.locator("[data-probe='seesaw-row']");
    const months = new Set<string>();
    for (const session of sessions) {
      if (now - session.start <= 90 * DAY) months.add(monthKey(session.start));
    }
    await expect(rows).toHaveCount(months.size);
    const shown = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-month")));
    expect(new Set(shown)).toEqual(months);
    await expect(page.locator("[data-probe='model-seesaw']")).toContainText("Opus 4.1");
    await expect(page.locator("[data-probe='model-seesaw']")).toContainText("Sonnet 4.5");
  });

  test("H3 排序：展开筛选后按 Token 最多，首行是上下文峰值最大的会话", { tag: "@round-hh" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "会话分析" }).click();
    const toggle = page.locator("[data-probe='session-query-toggle']");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const select = page.locator("[data-probe='session-sort']");
    await expect(select.locator("option")).toHaveCount(6);
    await expect(select).toHaveValue("recent");
    await select.selectOption("tokens");
    await expect(select).toHaveValue("tokens");

    const expected = sessions.reduce((best, s) => (s.ctxPeak > best.ctxPeak ? s : best), sessions[0]);
    await expect(sessionItems(page).first()).toContainText(String(expected.prompt ?? ""));
  });

  test("H4 对话节奏：A1 的 3 次间隔与六档柱", { tag: "@round-hh" }, async ({ page }) => {
    await page.goto("/");
    await openSession(page, "早上第一段");
    await page.getByRole("tab", { name: "重放" }).click();
    const rhythm = page.locator("[data-probe='rhythm']");
    await expect(rhythm).toBeVisible();
    await expect(page.locator("[data-probe='rhythm-bar']")).toHaveCount(6);
    await expect(rhythm).toHaveAttribute("aria-label", /共 3 次间隔/);
    await expect(page.locator("[data-probe='rhythm-readout']")).toContainText("中位间隔 33m0s");
    await expect(page.locator("[data-probe='rhythm-label']")).toHaveText("长考后一击");
  });

  test("H4 样本不足：只有 1 次提问时不画空图", { tag: "@round-hh" }, async ({ page }) => {
    await page.goto("/");
    await openSession(page, "重来：晨报的排序");
    await page.getByRole("tab", { name: "重放" }).click();
    await expect(page.locator("[data-probe='rhythm']")).toHaveCount(0);
    await expect(page.locator("[data-probe='rhythm-few']")).toHaveText("只有 1 次提问，还看不出节奏");
  });

  test("H5 断点推演：滑块 1–24 与小时读数一致，切到 9 点少用 100%", { tag: "@round-hh" }, async ({ page }) => {
    await openUsage(page);
    await page.getByRole("tab", { name: "实验室" }).click();
    const slider = page.locator("[data-probe='cutoff-slider']");
    await expect(slider).toHaveAttribute("min", "1");
    await expect(slider).toHaveAttribute("max", "24");
    const value = Number(await slider.inputValue());
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(24);
    const hour = page.locator("[data-probe='cutoff-hour']");
    await expect(hour).toHaveText(new RegExp(`^${value}:00$`));
    await slider.fill("9");
    await expect(hour).toHaveText("9:00");
    await expect(page.locator("[data-probe='cutoff-result']")).toContainText("占总用量100.0%");
  });

  test("H7 缓存体检：命中率变差 18.7%", { tag: "@round-hh" }, async ({ page }) => {
    await openUsage(page);
    await expect(page.locator("[data-probe='cache-hit']")).toContainText(
      "缓存命中率在变差18.7%"
    );
    await expect(page.locator("[data-probe='cache-hit']")).toContainText(
      "按周：缓存读取 ÷（输入 + 缓存写入 + 缓存读取）"
    );
  });

  test("H8 分享卡：可导出的 PNG 入口（不含消息内容）", { tag: "@round-hh" }, async ({ page }) => {
    await page.goto("/");
    await openSession(page, "早上第一段");
    const share = page.locator("[data-probe='share-card']");
    await expect(share).toBeVisible();
    await expect(share).toBeEnabled();
    await expect(share).toHaveAttribute("title", "导出这张会话的分享卡（PNG，不含消息内容）");
  });

  test("H9 数据体检：优 + 五条检查 + 缺 usage 占比", { tag: "@round-hh" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    await page.locator("[data-probe='health-check-open']").click();
    const dialog = page.locator("[data-probe='health-dialog']");
    await expect(dialog).toBeVisible();
    await expect(page.locator("[data-probe='health-grade']")).toHaveText("优");
    await expect(page.locator("[data-probe='health-check-row']")).toHaveCount(5);
    await expect(page.locator("[data-probe='health-check-row']").nth(3)).toContainText("18.5%");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("H2 默认窗口：只画最近 30 天的月份", { tag: "@round-hh" }, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cca-usage-range", "30"));
    await openUsage(page);
    const months = new Set<string>();
    for (const session of sessions) {
      if (now - session.start <= 30 * DAY) months.add(monthKey(session.start));
    }
    await expect(page.locator("[data-probe='seesaw-row']")).toHaveCount(months.size);
  });
});

test.describe("Round HH 空会话列表", () => {
  test.use({
    scenario: defaultScenario({ files: { "/Users/e2e/.claude/projects/placeholder.txt": "" } })
  });

  test("H10 引导在没有任何会话时出现", { tag: "@round-hh" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();
    await expect(page.locator("[data-probe='empty-steps']")).toBeVisible();
    await expect(page.locator("[data-probe='guide-step']")).toHaveCount(3);
    const steps = page.locator("[data-probe='guide-step']");
    await expect(steps.nth(0)).toHaveAttribute("data-state", "done");
    await expect(steps.nth(1)).toHaveAttribute("data-state", "current");
    await expect(steps.nth(2)).toHaveAttribute("data-state", "todo");
    await expect(steps.nth(0)).toContainText("选择目录");
    await expect(steps.nth(2)).toContainText("打开用量总览");
    await expect(steps.nth(2)).toHaveAttribute("data-step-index", "3");
  });
});
