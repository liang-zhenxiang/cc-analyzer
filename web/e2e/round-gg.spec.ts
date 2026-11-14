import {
  test,
  expect,
  defaultScenario,
  roundGGNow,
  roundGGRecords,
  roundGGScenario
} from "./fixtures";
import type { Page } from "@playwright/test";
import { sessionItems } from "./selectors";
import {
  roundGgContextQuantiles,
  roundGgProjectCard,
  roundGgStoryDays,
  storyDayMetaText,
  type GgFixtureRecord
} from "./round-gg-expectations";

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
/**
 * WebKit（macOS）**不认 TZ 环境变量**，Chromium 认。CI 的 Node 与两个引擎都在
 * UTC 上，本地却可能是 Asia/Shanghai；为了让「TZ=UTC 双引擎」这条验证真的
 * 把浏览器也切到 UTC，显式把 TZ 透传给 Playwright 的 timezoneId。CI 上通常
 * 不设 TZ，此时不覆盖，两边都取系统时区，仍然一致。
 */
const tzOverride = process.env.TZ?.trim() ? process.env.TZ.trim() : undefined;

test.use({
  scenario: roundGGScenario(),
  ...(tzOverride ? { timezoneId: tzOverride } : {})
});

/**
 * 时区漂移的唯一解法：期望的时刻一律从夹具记录**在 Node 里现算**，用与界面
 * 相同的本地时区格式化。CI runner 是 UTC、开发机是 Asia/Shanghai，写死
 * `11-01` 这类绝对日期在两边必然只能对一边（PR #285 首轮红）。
 *
 * 同样的道理适用于「窗口里恰好有几条」：默认窗口是最近 30 个本地日，夹具的
 * Q4 会话钉在 10-15，同一份夹具在 11-13 运行时 Q4 还在窗内、11-14 起就滑到
 * 窗外。期望值因此全部走 `round-gg-expectations.ts`（内部调用界面同一条
 * 纯函数链），spec 里不再出现 `toHaveCount(4)` / `1.1M` / `330k` 这类把某个
 * 运行日写死的数字（Issue #331）。
 */
const ggRecords = roundGGRecords() as unknown as GgFixtureRecord[];

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** `11-01`：界面的月-日拍子（本地时区，零 locale 依赖）。 */
function monthDayOf(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** `16:02`。 */
function hhmmOf(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function timeOf(iso: string): number {
  return Date.parse(iso);
}

/** G5：Bash 失败（`exit code`）的最早/最晚时刻，档案行的时间跨度。 */
const bashErrorTimes = ggRecords
  .filter((record) => {
    if (!Array.isArray(record.message?.content)) return false;
    return record.message.content.some(
      (item) =>
        item.type === "tool_result" &&
        item.is_error === true &&
        String(item.content).includes("exit code")
    );
  })
  .map((record) => timeOf(record.timestamp as string))
  .sort((a, b) => a - b);
const bashErrorSpan = `${monthDayOf(new Date(bashErrorTimes[0]).toISOString())} ${hhmmOf(
  new Date(bashErrorTimes[0]).toISOString()
)} – ${monthDayOf(new Date(bashErrorTimes.at(-1) as number).toISOString())} ${hhmmOf(
  new Date(bashErrorTimes.at(-1) as number).toISOString()
)}`;

/** G4/G6：夹具的月几何=首条记录所在月 → 当前月（整月保留，空月也在）。 */
const ggNow = new Date(roundGGNow());
const ggFirstMonth = ggRecords
  .map((record) => new Date(record.timestamp as string))
  .reduce((first, date) => (date < first ? date : first));
const ggMonthCount =
  (ggNow.getFullYear() - ggFirstMonth.getFullYear()) * 12 +
  (ggNow.getMonth() - ggFirstMonth.getMonth()) +
  1;

/** G4：当前月的 token 合计（usage 四计数之和，含工具调用记录）。 */
function usageTokensOf(record: GgFixtureRecord): number {
  const usage = record.message?.usage;
  if (!usage) return 0;
  return (
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

const currentMonthTokens = ggRecords
  .filter((record) => {
    const date = new Date(record.timestamp as string);
    return (
      date.getFullYear() === ggNow.getFullYear() && date.getMonth() === ggNow.getMonth()
    );
  })
  .reduce((total, record) => total + usageTokensOf(record), 0);

/** 与 `formatTokenCount` 同款：百万以上保留一位小数，否则千分位。 */
function formatTokenCount(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(2)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return count.toLocaleString("en-US");
}

const currentMonthLabel = `${ggNow.getFullYear()} 年 ${ggNow.getMonth() + 1} 月 · ${formatTokenCount(
  currentMonthTokens
)}`;

/**
 * G1/G8/G7 的期望值：全部由 `round-gg-expectations.ts` 从同一份夹具现算。
 * 这些数字随「运行日相对 Q4 的 10-15 落在窗口哪一侧」变化，不要写死。
 */
const ggStoryDays = roundGgStoryDays(ggRecords, roundGGNow());
const ggLatestDay = ggStoryDays[0];
const ggLatestDayLabel = ggLatestDay.date.slice(5);
const ggAlphaCard = roundGgProjectCard(ggRecords, roundGGNow(), "/repo/gg-alpha");
const ggBetaCard = roundGgProjectCard(ggRecords, roundGGNow(), "/repo/gg-beta");
const ggQuantiles = roundGgContextQuantiles(ggRecords, roundGGNow());

/** 卡片的完整 aria-label，字段顺序与 `ProjectCardsPanel` 一致。 */
function cardAriaLabel(card: typeof ggAlphaCard): RegExp {
  return new RegExp(
    `^${escapeRegExp(card.displayName)}：${card.sessions} 个会话，${escapeRegExp(
      card.tokensText
    )} token，成本 ${escapeRegExp(card.costText)}，最近活跃 ${activeText}，季节性：${escapeRegExp(
      card.seasonAria
    )}$`
  );
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 「最近活跃」用两套相对时间口径：卡片走分钟/小时/天，故事线走更细的分级。
// 只写「刚刚 / N 小时前 / 昨天」会在夹具活动落在 1 小时内时假红（2026-11-10
// CI 实测：46 分钟前）；分钟与 N 天前也要接受。
const activeText = "(刚刚|\\d+分钟前|\\d+小时前|昨天|\\d+天前|\\d{1,2}-\\d{1,2})";

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
    // 期望值必须从夹具现算：默认 30 天窗口的起点随运行日漂移，夹具的 Q4
    // 10-15 在 11-13 还在窗内、11-14 起就在窗外。写死「4 天」等于把某个
    // 运行日钉死，换到 12 月 / 1 月 / 4 月会再红一次（Issue #331）。
    await expect(days).toHaveCount(ggStoryDays.length);
    // 不足一页（默认 5 天）时没有「再显示」入口；增量展开由 StoryLogPanel
    // 的单测覆盖（12 天夹具：5 → 10 → 12）。
    await expect(page.locator("[data-probe='story-more']")).toHaveCount(
      ggStoryDays.length > 5 ? 1 : 0
    );
    // 第一行永远是最近一天；会话数 / token / 最忙整点也由同一份 storyLog 现算。
    await expect(days.first()).toContainText(ggLatestDayLabel);
    await expect(days.first()).toContainText(storyDayMetaText(ggLatestDay));
    await days.first().click();
    const detail = page.locator("[data-probe='story-detail']").first();
    await expect(detail.locator("li")).toHaveCount(ggLatestDay.sessions);
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
    await expect(rows.first()).toContainText(bashErrorSpan);
    await expect(rows.nth(1)).toContainText("Read");
    await expect(rows.nth(1)).toContainText("ENOENT: no such file or directory");
    await page.getByRole("button", { name: /展开 Bash .* 的档案/ }).click();
    const detail = page.locator("[data-probe='archive-detail']");
    await expect(detail).toContainText("代表消息：");
    await expect(detail).toContainText("代表消息：Error: exit code 1");
  });

  test("G8 项目卡片给出四季度占比，四季百分比全部可见", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    const cards = page.locator("[data-probe='card-item']");
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText("gg-alpha");
    // 会话数 / token / 成本是 30 天窗口内的读数：Q4 会话滑出窗口时三者一起
    // 变化。由 buildProjectCards 现算，不写死「4 个会话 / 1.1M / $7.68」。
    await expect(cards.first()).toHaveAttribute("aria-label", cardAriaLabel(ggAlphaCard));
    await expect(cards.nth(1)).toHaveAttribute("aria-label", cardAriaLabel(ggBetaCard));
    const seasons = page.locator("[data-probe='card-season']");
    await expect(seasons).toHaveCount(2);
    await expect(seasons.first()).toHaveAttribute("data-quarters", "4");
    // 文字从「只写最重季」改为四季全量占比；空季写「无记录」。季节是
    // projectSeasons 的全历史月几何，与 30 天窗口正交，但仍从夹具现算。
    const seasonText = page.locator("[data-probe='card-season-text']").first();
    await expect(seasonText).toHaveText(ggAlphaCard.seasonText);
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
    await expect(page.locator("[data-probe='tool-months']")).toContainText(
      `工具月（${ggMonthCount} 个月）`
    );
  });

  test("G9 相似会话：点名对照会话并给出相似度与理由", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    const similar = page.locator("[data-probe='compare-similar']");
    await expect(similar).toContainText("与「Q4：整理 alpha 的季度账」最像");
    await expect(similar).toContainText("用了 3 个相同工具");
    await expect(similar).toContainText("100%");
  });

  test("G7 上下文峰值分位数：5 档，最大值由窗口内会话现算", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    const quantiles = page.locator("[data-probe='ctx-quantiles']");
    await expect(quantiles).toHaveAttribute("aria-label", "会话上下文峰值分位数");
    await expect(page.locator("[data-probe='ctx-q']")).toHaveCount(5);
    // 分位样本里含窗口外会话（峰值 0 参与统计，与页面一致），所以 Q4 滑出
    // 窗口时 max 会从 330k 掉到 240k、P90 也随之变化——必须现算。
    await expect(page.locator("[data-probe='ctx-q'][data-q='max']")).toHaveText(
      `最大${ggQuantiles.maxText}`
    );
    await expect(page.locator("[data-probe='ctx-q'][data-q='p90']")).toHaveText(
      `P90${ggQuantiles.p90Text}`
    );
  });

  test("G4 年报逐月卡下钻回用量档并选中当月最活跃日", { tag: "@round-gg" }, async ({ page }) => {
    await openUsage(page);
    await page.getByRole("tab", { name: "年报" }).click();
    const months = page.locator("[data-probe='annual-months'] button");
    await expect(months).toHaveCount(ggMonthCount);
    await expect(months.last()).toHaveAttribute("aria-label", currentMonthLabel);
    await months.last().click();
    await expect(page.getByRole("tab", { name: "用量", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.locator("[data-probe='day-summary']")).toContainText(
      formatTokenCount(ggLatestDay.tokens)
    );
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
