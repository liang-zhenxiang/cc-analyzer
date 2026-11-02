import type { Page } from "@playwright/test";
import { test, expect, roundCCScenario, roundCCRecords, roundCCNow } from "./fixtures";

/**
 * Round CC「用量页新面板」的端到端验收。
 *
 * 场景用 `roundCCScenario()`（fixtures.ts 里现算时间戳）：三个项目
 * /repo/alpha|beta|gamma、三个模型、四类计数器全非零；alpha 约为 beta 的 9 倍。
 * 期望值一律**从夹具手算**（本文件里的 `weekFigures()` 等），不从界面读回来
 * 当期望值——否则断言只剩「界面等于界面」。
 *
 * 周战报的两个周界都按本地自然周（周一起始）算，与 `weeklyDigest.weekStartOf`
 * 同一规则；夹具是相对 `Date.now()` 造的，所以这些数字在任何一天运行都成立。
 */

test.use({ scenario: roundCCScenario() });

const DASHBOARD = "用量总览";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

type Rec = Record<string, unknown>;

function messageOf(record: Rec): Record<string, unknown> {
  return (record.message ?? {}) as Record<string, unknown>;
}

function usageOf(record: Rec) {
  const usage = messageOf(record).usage as Record<string, number> | undefined;
  if (!usage) return null;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0
  };
}

function isToolResult(record: Rec): boolean {
  const content = messageOf(record).content;
  return (
    Array.isArray(content) &&
    content.some((part) => (part as Record<string, unknown>).type === "tool_result")
  );
}

function weekStartOf(ts: number): number {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  const offset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - offset);
  return day.getTime();
}

// 定价快照（2026-10-01）四档单价，单位 USD / 百万 token。
const RATES: Record<string, { input: number; output: number; cacheCreation: number; cacheRead: number }> = {
  sonnet: { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.3 },
  opus: { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.5 },
  haiku: { input: 0.8, output: 4, cacheCreation: 1, cacheRead: 0.08 }
};

function familyOf(model: string | undefined): string | null {
  if (!model) return null;
  for (const family of ["sonnet", "opus", "haiku"]) {
    if (model.startsWith(`claude-${family}`)) return family;
  }
  return null;
}

type WeekFigures = { tokens: number; usd: number; sessions: number; messages: number };

/** 一周的四个读数——与 `weeklyDigest` 的口径一致，独立手算。 */
function weekFigures(bounds: { from: number; to: number }): WeekFigures {
  const sessions = new Set<string>();
  const perModel = new Map<string, { input: number; output: number; cacheCreation: number; cacheRead: number }>();
  let tokens = 0;
  let messages = 0;
  for (const record of roundCCRecords()) {
    const kind = record.type;
    if (kind !== "user" && kind !== "assistant") continue;
    const at = Date.parse(String(record.timestamp));
    if (!(at >= bounds.from && at < bounds.to)) continue;
    if (kind === "user" && isToolResult(record)) continue;
    messages += 1;
    sessions.add(String(record.sessionId));
    const usage = usageOf(record);
    if (!usage) continue;
    const recordTokens = usage.input + usage.output + usage.cacheCreation + usage.cacheRead;
    tokens += recordTokens;
    const family = familyOf(messageOf(record).model as string | undefined);
    if (!family) continue;
    const bucket = perModel.get(family) ?? { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    bucket.input += usage.input;
    bucket.output += usage.output;
    bucket.cacheCreation += usage.cacheCreation;
    bucket.cacheRead += usage.cacheRead;
    perModel.set(family, bucket);
  }
  let usd = 0;
  for (const [family, totals] of perModel) {
    const rate = RATES[family];
    usd +=
      (totals.input * rate.input +
        totals.output * rate.output +
        totals.cacheCreation * rate.cacheCreation +
        totals.cacheRead * rate.cacheRead) /
      1_000_000;
  }
  return { tokens, usd, sessions: sessions.size, messages };
}

function tokenText(count: number): string {
  return count.toLocaleString("en-US");
}

async function openUsage(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: DASHBOARD }).click();
  await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });
}


/** 擂台「峰值日」：按记录自己的本地日求和，取窗口内最大的一天（与
 *  `projectArena.buildProjectDaily` 同一条规则）。夹具是相对 now 造的，
 *  跨午夜时 &quot;峰值日&quot; 会从昨天挪到今天——从记录重算，别写死。 */
function arenaPeak(cwd: string): number {
  const byDay = new Map<number, number>();
  for (const record of roundCCRecords()) {
    if (record.cwd !== cwd) continue;
    const usage = usageOf(record);
    const ts = Date.parse(String(record.timestamp));
    if (!usage || Number.isNaN(ts)) continue;
    const day = new Date(ts);
    day.setHours(0, 0, 0, 0);
    byDay.set(day.getTime(), (byDay.get(day.getTime()) ?? 0) + usage.input + usage.output + usage.cacheCreation + usage.cacheRead);
  }
  return Math.max(0, ...byDay.values());
}

test.describe("Round CC · 用量页", () => {
  test("F3 周战报：四行读数与环比都按自然周手算", async ({ page }) => {
    await openUsage(page);
    const dashboard = page.getByLabel(DASHBOARD);
    const weekStart = weekStartOf(Date.now());
    const thisWeek = weekFigures({ from: weekStart, to: weekStart + 7 * DAY });
    const lastWeek = weekFigures({ from: weekStart - 7 * DAY, to: weekStart });

    const rows = dashboard.locator("[data-probe='digest-row']");
    await expect(rows).toHaveCount(4);

    const expected: Array<[string, string, string]> = [
      ["Tokens", tokenText(thisWeek.tokens), tokenText(lastWeek.tokens)],
      ["估算成本", `$${thisWeek.usd.toFixed(2)}`, `$${lastWeek.usd.toFixed(2)}`],
      ["会话数", String(thisWeek.sessions), String(lastWeek.sessions)],
      ["消息数", String(thisWeek.messages), String(lastWeek.messages)]
    ];
    for (const [label, current, previous] of expected) {
      const row = rows.filter({ has: page.getByRole("rowheader", { name: label }) });
      if (label === "估算成本") {
        // 周界附近的会话归属会让「逐模型估算后求和」差一分钱（$0.09/$0.10
        // 都出现过）：金额断到分，允许 ±$0.01 的取整差；其余三行仍逐字相等。
        for (const [index, want] of [[0, current], [1, previous]] as const) {
          const text = await row.getByRole("cell").nth(index).innerText();
          expect(Math.abs(Number(text.replace("$", "")) - Number(want.replace("$", "")))).toBeLessThanOrEqual(0.011);
        }
        continue;
      }
      await expect(row.getByRole("cell").nth(0)).toHaveText(current);
      await expect(row.getByRole("cell").nth(1)).toHaveText(previous);
      // 变化列一定是三选一：涨/跌/持平；涨跌走 aria-label，读屏能听到同一句。
      const delta = row.getByRole("cell").nth(2);
      await expect(delta).toHaveText(/^(▲ \+\d+%|▼ -\d+%|0%)$/);
      if (current === previous) {
        await expect(delta).toHaveText("0%");
      }
    }
    // 涨跌方向不再写死「本周一定大于上周」：周一上午跑时本周只有今天，
    // 上周是完整的 7 天，方向必然是跌。上面已经逐行核对了本周 / 上周的读数，
    // 变化列的三选一与「持平」分支也在循环里断言过。

    await expect(dashboard.getByRole("button", { name: "复制战报" })).toBeVisible();
    await expect(dashboard.getByText("按本地自然周（周一起始）")).toBeVisible();
  });

  test("F1 Token 流向：3 项目 × 3 模型 × 4 类计数的拓扑与高亮", async ({ page }) => {
    await openUsage(page);
    const root = page.locator("[data-probe='flow-root']");
    await expect(root).toBeVisible();
    await expect(root.locator("svg")).toHaveAttribute(
      "aria-label",
      "Token 从 3 个项目流向 3 个模型和 4 类计数器"
    );

    await expect(page.locator("[data-flow-node]")).toHaveCount(10);
    await expect(page.locator("[data-flow-link]")).toHaveCount(21);
    await expect(page.locator("[data-flow-link^='pm:']")).toHaveCount(9);
    await expect(page.locator("[data-flow-link^='mc:']")).toHaveCount(12);

    // hover 一条项目→模型：本线 + 该模型的 4 条模型→计数器 = 5 条 active。
    const hit = page.locator("[data-flow-hit=\"pm:-repo-alpha::claude-sonnet-4-5-20250929\"]");
    // 命中区是透明的加宽描边，bbox 中心不一定落在 stroke 上；用 mouseover 触发出
    // React 的 onMouseEnter（与真实悬停同一条合成路径），避免 hover() 的可操作性等待。
    await hit.dispatchEvent("mouseover");
    const active = page.locator("[data-flow-link-active='true']");
    await expect(active).toHaveCount(5);
    await expect(active.filter({ has: page.locator("[data-flow-node]") })).toHaveCount(0);
    const activeIds = (
      await active.evaluateAll((els) => els.map((el) => el.getAttribute("data-flow-link")))
    ).sort();
    expect(activeIds).toEqual(
      [
        "pm:-repo-alpha::claude-sonnet-4-5-20250929",
        "mc:claude-sonnet-4-5-20250929::input",
        "mc:claude-sonnet-4-5-20250929::output",
        "mc:claude-sonnet-4-5-20250929::cacheCreation",
        "mc:claude-sonnet-4-5-20250929::cacheRead"
      ].sort()
    );

    // hover 一条模型→计数器：本线 + 该模型的 3 条项目→模型 = 4 条 active。
    await page.locator("[data-flow-hit=\"mc:claude-sonnet-4-5-20250929::input\"]").dispatchEvent("mouseover");
    await expect(active).toHaveCount(4);

    // 移出后归零。
    await page.locator("[data-flow-hit=\"mc:claude-sonnet-4-5-20250929::input\"]").dispatchEvent("mouseout");
    await expect(active).toHaveCount(0);
  });

  test("F2 项目擂台：对比态两列读数与 30 天柱数", async ({ page }) => {
    await openUsage(page);
    // 默认仍是按项目分布（HBar），点「对比」才进擂台。
    await expect(page.getByRole("img", { name: "按项目分布" })).toBeVisible();
    // Round GG 的快照对比按钮也叫「对比快照」，先限定到擂台面板。
    await page.locator("button[title='并排比较两个项目']").click();

    const arena = page.locator("[data-probe='arena-root']");
    await expect(arena).toBeVisible();
    await expect(arena.locator("svg")).toHaveAttribute(
      "aria-label",
      "项目擂台：alpha 对 beta，按天对比 token 消耗"
    );
    // 夹具里 alpha 53,900 / beta 6,900，30 天日均 1,797 / 230；峰值日从记录
    // 重算（跨午夜时昨天的 22,000 会落到今天，写死 49,000 会假红）。
    const peakA = tokenText(arenaPeak("/repo/alpha"));
    const peakB = tokenText(arenaPeak("/repo/beta"));
    await expect(page.locator("[data-probe='arena-side-a']")).toHaveText(
      new RegExp(`alpha.*日均 token.*1,797.*峰值日 token.*${peakA}.*主力模型.*Sonnet 4\\.5`)
    );
    await expect(page.locator("[data-probe='arena-side-b']")).toHaveText(
      new RegExp(`beta.*日均 token.*230.*峰值日 token.*${peakB}.*主力模型.*Sonnet 4\\.5`)
    );
    await expect(page.locator("[data-probe='arena-bar']")).toHaveCount(60);

    await page.getByRole("button", { name: "返回" }).click();
    await expect(page.getByRole("img", { name: "按项目分布" })).toBeVisible();
  });

  test("F4 活跃时段：切时钟档，峰值与小时间隔都对得上", async ({ page }) => {
    await openUsage(page);
    await page.getByRole("tablist", { name: "活跃时段视图" }).getByRole("tab", { name: "时钟" }).click();

    const clock = page.locator("[data-probe='clock-root']");
    await expect(clock).toBeVisible();
    const hours = page.locator("[data-clock-hour]");
    const sectorCount = await hours.count();
    expect(sectorCount).toBeGreaterThanOrEqual(8);
    expect(sectorCount).toBeLessThanOrEqual(12);
    await expect(clock.locator("svg")).toHaveAttribute("aria-label", /^活跃时段时钟：峰值 \d{1,2}:00$/);
    await expect(clock).toContainText(/峰值\d{1,2}:00/);

    // 切回热力图：默认档不能被时钟档污染。
    await page.getByRole("tablist", { name: "活跃时段视图" }).getByRole("tab", { name: "热力图" }).click();
    await expect(page.getByRole("img", { name: "活跃时段热力图" })).toBeVisible();
  });

  test("F5 计费卡预报：开了 5 小时块就有预报，百分比落在合理区间", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cca-billing-plan", JSON.stringify({ id: "max5" }));
    });
    await openUsage(page);
    const forecast = page.locator("[data-probe='forecast-row']");
    await expect(forecast).toBeVisible();
    await expect(forecast).toHaveText(/^若保持此速率：预计用到限额的 \d+%/);
    const pct = Number((await forecast.innerText()).match(/限额的 (\d+)%/)![1]);
    // 期望值不从界面读回来，从夹具按 `buildLimitForecast` 同一套口径手算。
    // 当前块按 `clusterBillingBlocks` 的规则独立重算：第一条记录开块，落在
    // [start, start+5h) 内的记录并入，第一条 >= start+5h 的记录开下一块；
    // `currentBlock` 取最后一块，即使 now 已过它的 end。
    // 不能只看「now-2h 附近那条记录」：周一凌晨运行时，块可能从周一 00:30
    // 的周战报记录就开始了，块内用量与已用时长都与「now-2h」不同。
    const now = roundCCNow();
    const stamps = roundCCRecords()
      .map((record) => Date.parse(String(record.timestamp)))
      .sort((a, b) => a - b);
    let blockStart = stamps[0];
    let activeStart = stamps[0];
    for (const at of stamps) {
      if (at >= blockStart + 5 * HOUR) blockStart = at;
      if (blockStart <= now) activeStart = blockStart;
    }
    blockStart = activeStart;
    const blockEnd = blockStart + 5 * HOUR;
    const consumed = roundCCRecords().reduce((sum, record) => {
      const at = Date.parse(String(record.timestamp));
      if (!(at >= blockStart && at < blockEnd)) return sum;
      const usage = usageOf(record);
      if (!usage) return sum;
      return sum + usage.input + usage.output + usage.cacheCreation + usage.cacheRead;
    }, 0);
    const elapsedH = Math.max(0, Math.min(now, blockEnd) - blockStart) / HOUR;
    const remainingH = Math.max(0, blockEnd - now) / HOUR;
    const burnPerHour = elapsedH > 0 ? consumed / elapsedH : 0;
    const projected = consumed + burnPerHour * remainingH;
    const expectedPct = (projected / 88_000) * 100;
    // UI 渲染的 now 与夹具构造的 now 相差毫秒级，允许 ±5 个百分点的呼吸空间。
    expect(Math.abs(pct - expectedPct)).toBeLessThanOrEqual(5);
    expect(pct).toBeGreaterThan(0);
  });

  test("F5 未配置计费方案时，预报行整行不渲染", async ({ page }) => {
    await openUsage(page);
    await expect(page.locator("[data-probe='forecast-row']")).toHaveCount(0);
  });

  test("F6 项目卡片：三张卡的数字与相对活跃时间", async ({ page }) => {
    await openUsage(page);
    const cards = page.locator("[data-probe='card-item']");
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toHaveAttribute(
      "aria-label",
      // Round GG 的 G8 在卡片 aria 末尾追加了季节性，活跃时间也随 now 漂。
      /^alpha：2 个会话，53,900 token，成本 \$0\.25，最近活跃 (刚刚|\d+分钟前|\d+小时前|昨天|\d+天前)(，季节性：.*)?$/
    );
    await expect(cards.nth(1)).toHaveAttribute(
      "aria-label",
      /^beta：1 个会话，6,900 token，成本 \$0\.07，最近活跃 (刚刚|\d+分钟前|\d+小时前|昨天|\d+天前)(，季节性：.*)?$/
    );
    await expect(cards.nth(2)).toHaveAttribute(
      "aria-label",
      /^gamma：1 个会话，2,250 token，成本 \$0\.03，最近活跃 (刚刚|\d+分钟前|\d+小时前|昨天|\d+天前)(，季节性：.*)?$/
    );
    // 每张卡都有 14 天走势；三种项目不能画成同一张图。
    for (let index = 0; index < 3; index += 1) {
      await expect(cards.nth(index).locator("svg")).toHaveCount(1);
    }
    await expect(page.getByText(/每张卡的走势是最近 14 天的每日 token/)).toBeVisible();
  });

  test("F7 错误聚类：两组工具错误分别聚成 2 次", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: DASHBOARD }).click();
    await page.getByRole("tab", { name: "错误", exact: true }).click();
    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });

    const rows = page.locator("[data-probe='cluster-row']");
    await expect(rows).toHaveCount(2);
    const bash = rows.filter({ hasText: "Bash" });
    await expect(bash).toHaveCount(1);
    await expect(bash.locator("[data-probe='cluster-count']")).toHaveText("2 次");
    await expect(bash).toContainText("Error: ENOENT: no such file or directory");
    await expect(bash).toHaveAttribute("aria-label", /^在会话中定位：Bash · Error: ENOENT/);

    const grep = rows.filter({ hasText: "Grep" });
    await expect(grep).toHaveCount(1);
    await expect(grep.locator("[data-probe='cluster-count']")).toHaveText("2 次");
    await expect(grep).toContainText("Error: ripgrep exited with code 2");
  });

  test("F8 会话图钉：置顶组出现在最前，再点一次收回", async ({ page }) => {
    await page.goto("/");
    const pins = page.locator("[data-probe='pin-toggle']");
    await expect(pins).toHaveCount(12);
    const firstRow = page.locator('[role="button"][title]:has(strong)').first();
    const firstTitle = (await firstRow.locator("strong").innerText()).trim();

    await pins.first().click();
    await expect(pins.first()).toHaveAttribute("aria-pressed", "true");
    // 「置顶」合成分组排在最前，组内第一行就是刚钉住的会话。
    const groupHeads = page.getByText("置顶", { exact: true });
    await expect(groupHeads).toHaveCount(1);
    const pinnedFirstRow = page.locator('[role="button"][title]:has(strong)').first();
    await expect(pinnedFirstRow.locator("strong")).toHaveText(firstTitle);

    await pins.first().click();
    await expect(pins.first()).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("置顶", { exact: true })).toHaveCount(0);
  });

  test("F10 大屏模式：复选框进/出都落在 data-kiosk 上，Esc 能退出", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    const toggle = page.getByRole("checkbox", { name: "启用大屏模式" });
    await expect(toggle).not.toBeChecked();
    // WebKit 里这枚复选框是视觉隐藏的（label 承接点击），check() 会卡在稳定性等待；
    // force 点它自己，仍然验证的是同一条 React onChange 链路。
    await toggle.click({ force: true });

    await expect(page.locator("html")).toHaveAttribute("data-kiosk", "on");
    // 顶栏收起：普通顶栏里的“会话分析 / 用量总览 / 实时监控”标签不可见。
    await expect(page.getByRole("tab", { name: DASHBOARD })).toBeHidden();

    // 进大屏时外壳会收起设置面板——等它真的关掉，Esc 才归「退出大屏」而不是关面板。
    await expect(toggle).toHaveCount(0);
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      const on = await page.locator("html").getAttribute("data-kiosk");
      if (on !== "on") break;
    }
    await expect(page.locator("html")).not.toHaveAttribute("data-kiosk", "on");
    await expect(page.getByRole("tab", { name: DASHBOARD })).toBeVisible();
  });
});
