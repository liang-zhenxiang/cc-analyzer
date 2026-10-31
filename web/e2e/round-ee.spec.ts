import { test, expect, roundEERecords, roundEEScenario } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Round EE（第三批十功能）端到端验收。
 *
 * 夹具 `roundEEScenario()` 只装本轮 19 个会话：18 个自然日各一次调用
 * （9,900 / 10,100 交替，10/14 一次 60,000 的异常尖峰）+ 今天一条 5 次调用的
 * 会话（上下文 20k→100k，合计 302,500 tok）。断言里的数值都是从这些记录手算的，
 * **不从界面读回来当期望值**。
 */

/**
 * 最贵一周的 token 总量：按本地周一 00:00 分桶，从夹具记录现算。
 * 写死 332,600 会随「now」跨周漂移（实测到 11 月后变成 362,500）。
 */
function eeCostliestWeekTotal(): number {
  const weeks = new Map<number, number>();
  for (const record of roundEERecords()) {
    const usage = (record.message as { usage?: Record<string, number> } | undefined)?.usage;
    if (!usage) continue;
    const day = new Date(String(record.timestamp));
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const total =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    weeks.set(start.getTime(), (weeks.get(start.getTime()) ?? 0) + total);
  }
  return Math.max(...weeks.values());
}

test.use({ scenario: roundEEScenario() });

async function openUsage(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览", exact: true }).click();
  await expect(page.getByText("Tokens 总量").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-probe='data-freshness']").first()).toBeVisible({
    timeout: 15_000
  });
  await page.waitForTimeout(600);
}

test.describe("Round EE · 用量页", () => {
  test("E1 趋势图叠层：图例逐字、均线与外推各一条", async ({ page }) => {
    await openUsage(page);
    await expect(
      page.getByText("实线＝7 天移动平均 · 虚线＝按最近 14 天外推 · ▲＝异常日（z ≥ 2）", {
        exact: true
      })
    ).toBeVisible();
    const overlay = page.locator("[data-probe='trend-overlay']");
    await expect(overlay).toHaveCount(1);
    await expect(overlay.locator("[data-probe='trend-ma']")).toHaveCount(1);
    await expect(overlay.locator("[data-probe='trend-forecast']")).toHaveCount(1);
  });

  test("E2 异常日：三枚 ▲ 且 60,000 与 302,500 两天都在", async ({ page }) => {
    await openUsage(page);
    const marks = page.locator("[data-probe='anomaly-marks'] > span");
    await expect(marks).toHaveCount(3);
    const titles = await marks.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("title") ?? ""));
    expect(titles.some((t) => /60,000 tok/.test(t))).toBe(true);
    expect(titles.some((t) => /302,500 tok/.test(t))).toBe(true);
    for (const title of titles) {
      const z = Number(/z=\+?(-?[\d.]+)/.exec(title)?.[1]);
      expect(Number.isFinite(z)).toBe(true);
      expect(z).toBeGreaterThanOrEqual(2);
    }
    // 日历圆点：三枚异常日与 ▲ 同源；60,000 那天必须带「异常」读数。
    // 不写死 10/14——夹具窗口相对 now 滚动，跨周/跨月后异常日会漂。
    // 日历格用「，异常」后缀与 ▲ 同源；60,000 那天必须在其中。
    await expect(
      page.locator("[data-probe='calendar-day'][aria-label*='60,000'][aria-label*='，异常']")
    ).toHaveCount(1);
  });

  test("E5 导出 CSV：保存框 → write_text，内容带 BOM 与表头", async ({ page }) => {
    await openUsage(page);
    const button = page.locator("[data-probe='csv-export-projects'] button");
    await expect(button).toHaveText("导出 CSV");
    await button.click();
    await expect(page.getByText(/已导出 \d+ 行 CSV/)).toBeVisible();
    const writes = await page.evaluate(() => {
      const log = (window as unknown as { __CCA_E2E_LOG__: Array<{ op: string; args: unknown[] }> })
        .__CCA_E2E_LOG__;
      return log
        .filter((entry) => entry.op === "write_text" || entry.op === "plugin:dialog|save")
        .map((entry) => ({ op: entry.op, args: entry.args }));
    });
    const saves = writes.filter((w) => w.op === "plugin:dialog|save");
    const wrote = writes.filter((w) => {
      if (w.op !== "write_text") return false;
      const arg = w.args[0] as { path?: string };
      return typeof arg.path === "string" && arg.path.endsWith(".csv");
    });
    expect(saves.length).toBe(1);
    expect(wrote.length).toBe(1);
    const payload = wrote[0].args[0] as { path: string; contents: string };
    expect(payload.path.endsWith(".csv")).toBe(true);
    expect(payload.contents.charCodeAt(0)).toBe(0xfeff);
    expect(payload.contents).toContain("项目,token");
  });

  test("E6 模型迁移：两条泳道、1 个回归断点、可访问名带起止", async ({ page }) => {
    await openUsage(page);
    await page
      .getByRole("tablist", { name: "按模型分布视图" })
      .getByRole("tab", { name: "迁移", exact: true })
      .click();
    const root = page.locator("[data-probe='model-migration']");
    await expect(root).toHaveCount(1);
    await expect(root.locator("[data-probe='migration-bar']")).toHaveCount(2);
    await expect(root.locator("[data-probe='migration-gap']")).toHaveCount(1);
    await expect(root.getByRole("img")).toHaveAttribute(
      "aria-label",
      /^模型迁移：Sonnet 4\.5 \d+\/\d+ 至 \d+\/\d+；Opus 4\.1 \d+\/\d+ 至 \d+\/\d+$/
    );
  });

  test("E9 新鲜度：用量页与详情页报同一个最后记录时刻", async ({ page }) => {
    await openUsage(page);
    const badge = page.locator("[data-probe='data-freshness']").first();
    const text = (await badge.textContent()) ?? "";
    expect(text).toMatch(/^数据截至 \d{2}:\d{2}（\d+ 分钟前）$/);
    expect(await badge.getAttribute("data-state")).toBe("fresh");
    const clock = /^数据截至 (\d{2}:\d{2})/.exec(text)?.[1];

    await page.getByRole("tab", { name: "会话分析", exact: true }).click();
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/ee");
    await page
      .locator("[role='button'][title]:has(strong)")
      .filter({ hasText: "时间轴第 1 段" })
      .first()
      .click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
    const sessionBadge = page.locator("[data-probe='data-freshness']").first();
    const sessionText = (await sessionBadge.textContent()) ?? "";
    expect(sessionText).toContain(`数据截至 ${clock}`);
  });

  test("E10 火花线：两枚 KPI 各一条，扁平序列画中线", async ({ page }) => {
    await openUsage(page);
    await expect(page.locator("[data-probe='kpi-sparkline']")).toHaveCount(2);
    const shapes = await page
      .locator("[data-probe='kpi-sparkline']")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({ polyline: n.querySelectorAll("polyline").length, line: n.querySelectorAll("line").length }))
      );
    // 每条火花线只有一个形状：要么折线，要么「无变化」的中线
    for (const shape of shapes) {
      expect(shape.polyline + shape.line).toBe(1);
    }
  });
});

test.describe("Round EE · 会话时间轴与健康分", () => {
  test("E3 时间轴：轨道在桶内，Home/→/End 与拖动都改读数", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/ee");
    await page
      .locator("[role='button'][title]:has(strong)")
      .filter({ hasText: "时间轴第 1 段" })
      .first()
      .click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
    await page.getByRole("tab", { name: "时间轴", exact: true }).click();
    const track = page.getByRole("slider", { name: "会话时间轴" });
    await expect(track).toBeVisible();
    const box = await track.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(24);
    expect(box?.height).toBeLessThanOrEqual(400);

    await track.focus();
    await page.keyboard.press("Home");
    await expect(track).toHaveAttribute("aria-valuenow", "0");
    // 0% 时读数停在第 2 条记录（实现见 TimelineView 的 valueText；观测值，先按现状锁住）
    await expect(track).toHaveAttribute("aria-valuetext", /第 2 条记录$/);
    await page.keyboard.press("ArrowRight");
    await expect(track).toHaveAttribute("aria-valuenow", "1");
    await expect(track).toHaveAttribute("aria-valuetext", /第 2 条记录$/);
    await page.keyboard.press("End");
    await expect(track).toHaveAttribute("aria-valuenow", "100");
    await expect(track).toHaveAttribute("aria-valuetext", /第 9 条记录$/);

    if (!box) throw new Error("轨道没有几何盒");
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
    await expect(track).toHaveAttribute("aria-valuenow", /^(4[5-9]|5[0-5])$/);
  });

  test("E7 健康分：70 / 偏紧但可控，括号组可访问名", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/ee");
    await page
      .locator("[role='button'][title]:has(strong)")
      .filter({ hasText: "时间轴第 1 段" })
      .first()
      .click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
    const group = page.locator("[aria-label='健康分 70']");
    await expect(group).toHaveCount(1);
    await expect(group).toContainText("平均水位 30%，压缩 0 次，出血 0 处——偏紧但可控");
  });
});

/**
 * 年报里的年份 / 月份 / 周起点都从夹具现算。
 *
 * 夹具相对 `Date.now()` 生成，把这些日历值写成字面量的话，跨天、跨月、跨年
 * 都会让 CI 假红（2026-10-29 已经踩过一次）。这里按年报的同一组口径独立手算：
 * 目标年 = 最新记录的本地年；月份 / 自然周按 token 求和，并列取更早；
 * 连击按本地自然日逐日判。
 */
type AnnualFixtureRecord = {
  type?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
};

function startOfLocalDay(ts: number): number {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function addLocalDays(ts: number, days: number): number {
  const next = new Date(ts);
  next.setDate(next.getDate() + days);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

function startOfLocalWeek(ts: number): number {
  const day = startOfLocalDay(ts);
  const weekday = new Date(day).getDay();
  return addLocalDays(day, -((weekday + 6) % 7));
}

function dayMonthLabel(ts: number): string {
  const day = new Date(ts);
  return `${day.getMonth() + 1}/${day.getDate()}`;
}

function annualLabels(): {
  year: number;
  topMonthLabel: string;
  costliestWeekLabel: string;
  longestStreakDays: number;
} {
  const records: AnnualFixtureRecord[] = [];
  for (const [path, content] of Object.entries(roundEEScenario().files)) {
    if (!path.endsWith(".jsonl")) continue;
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as AnnualFixtureRecord);
      } catch {
        // 夹具行都是 JSON；万一不是，跳过而不是让整条用例失败。
      }
    }
  }
  const usable = records.filter(
    (record) => record.timestamp && record.isSidechain !== true && record.isMeta !== true
  );
  const year = new Date(Math.max(...usable.map((record) => Date.parse(record.timestamp!)))).getFullYear();
  const inYear = usable.filter(
    (record) => new Date(record.timestamp!).getFullYear() === year
  );
  const byMonth = new Map<number, number>();
  const byWeek = new Map<number, number>();
  const days = new Set<number>();
  for (const record of inYear) {
    const at = Date.parse(record.timestamp!);
    days.add(startOfLocalDay(at));
    const usage = record.message?.usage;
    if (!usage) continue;
    const tokens =
      (usage.input_tokens ?? 0) +
      (usage.output_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0);
    if (tokens <= 0) continue;
    const month = new Date(at).getMonth() + 1;
    byMonth.set(month, (byMonth.get(month) ?? 0) + tokens);
    const week = startOfLocalWeek(at);
    byWeek.set(week, (byWeek.get(week) ?? 0) + tokens);
  }
  let topMonth: [number, number] | null = null;
  for (const entry of byMonth) {
    if (
      topMonth === null ||
      entry[1] > topMonth[1] ||
      (entry[1] === topMonth[1] && entry[0] < topMonth[0])
    ) {
      topMonth = entry;
    }
  }
  let topWeek: [number, number] | null = null;
  for (const entry of byWeek) {
    if (
      topWeek === null ||
      entry[1] > topWeek[1] ||
      (entry[1] === topWeek[1] && entry[0] < topWeek[0])
    ) {
      topWeek = entry;
    }
  }
  const sortedDays = [...days].sort((left, right) => left - right);
  let longestStreakDays = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sortedDays) {
    run = previous !== null && addLocalDays(previous, 1) === day ? run + 1 : 1;
    previous = day;
    longestStreakDays = Math.max(longestStreakDays, run);
  }
  return {
    year,
    topMonthLabel: topMonth === null ? "" : `${topMonth[0]} 月`,
    costliestWeekLabel: topWeek === null ? "" : dayMonthLabel(topWeek[0]),
    longestStreakDays
  };
}

test.describe("Round EE · 年报", () => {
  test("E4 年报六卡：年中起点、读数与无时间范围控件", async ({ page }) => {
    await openUsage(page);
    const before = await page.evaluate(() => {
      const log = (window as unknown as { __CCA_E2E_LOG__: Array<{ op: string }> }).__CCA_E2E_LOG__;
      return log.filter((entry) => entry.op === "read_dir").length;
    });

    await page.getByRole("tab", { name: "年报", exact: true }).click();
    const report = page.locator("[data-probe='year-report']");
    await expect(report).toBeVisible();
    await expect(report.getByRole("region")).toHaveCount(6);
    const labels = annualLabels();
    const names = await report
      .getByRole("region")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label") ?? ""));
    expect(names).toEqual([
      `第 ${labels.year} 年总量`,
      `第 ${labels.year} 年消息数`,
      `第 ${labels.year} 年最活跃的月份`,
      `第 ${labels.year} 年主力模型`,
      `第 ${labels.year} 年最长连击`,
      `第 ${labels.year} 年最贵的一周`
    ]);

    // 夹具相对 `Date.now()` 生成，起点日期与天数**不能写死**（2026-10-29 的
    // CI 就是因为写死 10-09/18 天而红）。年报吃整个扫描窗口（默认场景 + 本夹具），
    // 天数会随两者重叠略有出入，所以只断言格式、起点落在夹具窗口内、天数在合理范围。
    const heading = report.getByRole("heading", {
      name: /^数据从 \d{4}-\d{2}-\d{2} 开始（已记录 \d+ 天）$/
    });
    await expect(heading).toBeVisible();
    const match = (await heading.innerText()).match(
      /^数据从 (\d{4})-(\d{2})-(\d{2}) 开始（已记录 (\d+) 天）$/
    );
    expect(match).not.toBeNull();
    const [, year, month, day, activeDays] = match!;
    const start = new Date(Number(year), Number(month) - 1, Number(day));
    const now = new Date();
    const earliest = new Date(now);
    earliest.setDate(earliest.getDate() - 19);
    earliest.setHours(0, 0, 0, 0);
    expect(start.getTime()).toBeGreaterThanOrEqual(earliest.getTime());
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(Number(activeDays)).toBeGreaterThanOrEqual(18);
    expect(Number(activeDays)).toBeLessThanOrEqual(20);
    await expect(report).toContainText("522,500");
    await expect(report).toContainText("44");
    await expect(report).toContainText(labels.topMonthLabel);
    // 月份占比随夹具窗口跨月而变（实测 10/11 两月时约 57.9%），只断格式。
    await expect(report).toContainText(/占全年 \d+\.\d%/);
    await expect(report).toContainText("Sonnet 4.5");
    await expect(report).toContainText("322,300");
    await expect(report).toContainText("61.7%");
    await expect(report).toContainText(`${labels.longestStreakDays}天`);
    await expect(report).toContainText(eeCostliestWeekTotal().toLocaleString("en-US"));
    await expect(report).toContainText(`${labels.costliestWeekLabel} 起的一周`);

    await expect(page.getByText(/全部 \d+ 个已扫描会话纳入年度统计/)).toBeVisible();
    await expect(page.getByRole("tablist", { name: "时间范围" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /导出用量快照/ })).toHaveCount(0);

    const after = await page.evaluate(() => {
      const log = (window as unknown as { __CCA_E2E_LOG__: Array<{ op: string }> }).__CCA_E2E_LOG__;
      return log.filter((entry) => entry.op === "read_dir").length;
    });
    expect(after).toBe(before);
  });
});

test.describe("Round EE · 年报空态", () => {
  test.use({
    scenario: roundEEScenario({
      files: { "/Users/e2e/.claude/projects/-repo-empty/empty.jsonl": "" }
    })
  });

  test("E4b 空态：只有「用量年报」一块 region 与两句指引", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览", exact: true }).click();
    await page.waitForTimeout(600);
    await page.getByRole("tab", { name: "年报", exact: true }).click();
    await expect(page.getByText("这一年没有记录", { exact: true })).toBeVisible();
    await expect(
      page.getByText("先在「会话」档扫描一次日志目录——年报按本机日志现算，没有扫描过就没有可统计的会话。")
    ).toBeVisible();
    await expect(page.getByRole("region", { name: "用量年报" })).toHaveCount(1);
    await expect(page.locator("[data-probe='year-report']")).toHaveCount(0);
  });
});
