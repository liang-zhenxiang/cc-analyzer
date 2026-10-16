import type { Page } from "@playwright/test";
import { test, expect, emptyScenario } from "./fixtures";
import {
  MILESTONES_COMPACTION_TITLE,
  MILESTONES_DAY,
  MILESTONES_FIRST_SESSION_TITLE,
  MILESTONES_MCP_DETAIL,
  MILESTONES_SKILL_NAME,
  MILESTONES_SUBAGENT_TYPE,
  milestonesDayStart,
  milestonesFullDate,
  milestonesScenario
} from "../tests/fixtures/milestones-scenario";

/*
 * 「里程碑」的端到端（Issue #214 / Round Y，R3 / R4 / R5 / R6 与验收标准）。
 *
 * 场景用 `milestonesScenario()`：五个会话各贡献一枚「第一次」、时间戳相对今天现算
 * （理由见那个模块）。
 * 断言逐条对着夹具的账——**累计 token / 会话数 / 档位读数**是这一页的核心契约，
 * 所以它们都以确定值出现，而不是「大于 0」这类恒真写法。
 */
test.use({ scenario: milestonesScenario() });

/** 某一枚里程碑卡片（按 `data-milestone` 键取，不按可见文案）。 */
function card(page: Page, key: string) {
  return page.locator(`[data-milestone='${key}']`);
}

/** 打开「用量总览」并切到里程碑档；返回该视图根节点。 */
async function openMilestones(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "里程碑" }).click();
  const view = page.locator("[data-probe='milestones-view']");
  await expect(view).toBeVisible({ timeout: 15_000 });
  return view;
}

test.describe("里程碑 · 确定值", () => {
  test("三组枚数、累计 token 与会话数、档位读数与夹具账逐项吻合", async ({ page }) => {
    const view = await openMilestones(page);

    // 窗口声明（R2）：全历史、含归档、只对读到的日志负责——五个会话一个不少。
    const scope = page.locator("[data-probe='milestones-scope']");
    await expect(scope).toContainText("全部已扫描的会话纳入统计");
    await expect(scope).toContainText("共 5 个");
    await expect(scope).toContainText("含本地归档");

    // 三组：首次 5（会话 / 压缩 / 子 agent / skill / MCP 夹具全有）、阶梯恒 7、记录 3。
    await expect(view.locator("[data-group='firsts'] [data-probe='milestone-card']")).toHaveCount(5);
    await expect(view.locator("[data-group='tiers'] [data-probe='milestone-card']")).toHaveCount(7);
    await expect(view.locator("[data-group='records'] [data-probe='milestone-card']")).toHaveCount(3);
    await expect(view.locator("[data-probe='milestone-card']")).toHaveCount(15);

    // 累计 token：1,200,000 + 2,000,100 + 20,100 + 30,000 + 120,000 = 3,370,200 → 3.4M；
    // 跨过 1M 这一档。
    await expect(card(page, "tier-tokens").locator("[data-probe='milestone-value']")).toHaveText(
      "3.4M"
    );
    await expect(
      card(page, "tier-tokens").locator("[data-probe='milestone-subread'][data-kind='tier']")
    ).toHaveText("1/4 档");
    await expect(
      card(page, "tier-tokens").locator("[data-probe='milestone-distance']")
    ).toHaveText("还差 6.6M 到 10.0M");

    // 累计会话数：5 个（夹具就是五个会话）——跨过第一档，但离 10 还远。
    await expect(card(page, "tier-sessions").locator("[data-probe='milestone-value']")).toHaveText(
      "5"
    );
    await expect(
      card(page, "tier-sessions").locator("[data-probe='milestone-subread'][data-kind='tier']")
    ).toHaveText("1/4 档");

    // 消息 17 条：一档都没跨过——未达成的那一侧（R4 给的是距离，不是灰剪影）。
    await expect(
      card(page, "tier-messages").locator("[data-probe='milestone-subread'][data-kind='tier']")
    ).toHaveText("0/4 档");
    await expect(
      card(page, "tier-messages").locator("[data-probe='milestone-distance']")
    ).toHaveText("还差 83 到 100");

    // 工具种类 = 4（Bash / skill:git-commit / subagent:trellis-research / mcp:docs），
    // 顺带钉住「工具身份走 censusKeyId」这条口径。
    await expect(card(page, "tier-tools").locator("[data-probe='milestone-value']")).toHaveText("4");
    await expect(
      card(page, "tier-tools").locator("[data-probe='milestone-subread'][data-kind='tier']")
    ).toHaveText("1/3 档");

    // 首次类的值是带年的日期；记录类的日期在副读数上。
    await expect(card(page, "first-session").locator("[data-probe='milestone-value']")).toHaveText(
      milestonesFullDate(MILESTONES_DAY.firstSession)
    );
    await expect(
      card(page, "record-session-tokens").locator("[data-probe='milestone-value']")
    ).toHaveText("2.0M");
    await expect(
      card(page, "record-session-tokens").locator(
        "[data-probe='milestone-subread'][data-kind='date']"
      )
    ).toHaveText(milestonesFullDate(MILESTONES_DAY.heavy));
    await expect(
      card(page, "record-session-duration").locator("[data-probe='milestone-value']")
    ).toHaveText("12h0m0s");
    // 项目数 = 5（五个会话各有自己的 cwd）——跨过 5 这一档，是本页唯一 2/4 的读数。
    await expect(
      card(page, "tier-projects").locator("[data-probe='milestone-subread'][data-kind='tier']")
    ).toHaveText("2/4 档");

    // 全历史口径与区间选择器正交：这一档不摆一个不起作用的时间范围控件。
    await expect(page.getByRole("tablist", { name: "时间范围" })).toHaveCount(0);
    await expect(page.locator("[data-probe='usage-progress']")).toHaveText(
      "全部 5 个已扫描会话纳入统计"
    );
  });
});

test.describe("里程碑 · 入口握手", () => {
  test("点会话入口落到会话分析并打开那个会话（与压缩 top3 同一条握手）", async ({ page }) => {
    await openMilestones(page);

    // 记录类里「最多 token」的赢家是那个压缩过的会话——证据行上写着它的标题。
    const entry = card(page, "record-session-tokens").locator("[data-probe='milestone-entry']");
    await expect(entry).toHaveAttribute("aria-label", `打开会话：${MILESTONES_COMPACTION_TITLE}`);
    await entry.click();

    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // 会话图状态只在有会话打开时渲染——读到「已加载」即证明会话真的开了。
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
  });

  test("点日期入口切回用量档并展开那一天（一日回望的时间线在场）", async ({ page }) => {
    await openMilestones(page);

    // 记录类的日期是「那一天」的入口（证据行在有会话元数据时优先打开会话）。
    const day = new Date(milestonesDayStart(MILESTONES_DAY.heavy));
    const dayLabel = `${day.getMonth() + 1}月${day.getDate()}日`;
    const dateEntry = card(page, "record-session-tokens").locator(
      "[data-probe='milestone-subread'][data-kind='date']"
    );
    await expect(dateEntry).toHaveAttribute("aria-label", /^打开 .+ 的一日回望$/);
    await dateEntry.click();

    // ① 切回用量档（日历住在那一档）。
    await expect(page.getByRole("tab", { name: "用量", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // ② 真的展开到那一天：展开区在场、头部写的就是那一天与它的会话数。
    const detail = page.locator("[data-calendar-sessions]");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(`${dayLabel} · 1 个会话`);
    // ③ 一日回望的时间线在场——不是只把档切回去就完事。
    await expect(page.locator("[data-probe='day-timeline']")).toBeVisible();
    // 对应格子的展开态也亮着：受控下钻走的是格子点击那条内部逻辑。
    await expect(
      page.locator(
        `[data-probe='calendar-day'][aria-expanded='true'][aria-label^='${day.getFullYear()}年${
          day.getMonth() + 1
        }月${day.getDate()}日']`
      )
    ).toHaveCount(1);
  });

  test("首次类的五行证据各写各自的目标名，不再是同一句会话标题", async ({ page }) => {
    await openMilestones(page);

    // Issue #214 的验收缺陷就出在这一行：五枚首次的 `detail` 没有进契约，界面只能
    // 退回会话标题，于是五行写成同一句。这里按**顺序**逐行取全文，五行必须各说各的。
    const names = await page
      .locator("[data-group='firsts'] [data-probe='milestone-evidence']")
      .allTextContents();
    expect(names.map((text) => text.replace("◆", "").trim())).toEqual([
      MILESTONES_FIRST_SESSION_TITLE,
      MILESTONES_COMPACTION_TITLE,
      MILESTONES_SUBAGENT_TYPE,
      MILESTONES_SKILL_NAME,
      MILESTONES_MCP_DETAIL
    ]);

    // 名字换的是读数，不是目标：入口打开的一直是那次调用所在的会话。
    await expect(card(page, "first-skill").locator("[data-probe='milestone-entry']")).toHaveAttribute(
      "aria-label",
      `打开会话：${MILESTONES_SKILL_NAME}`
    );
    await expect(
      card(page, "first-compaction").locator("[data-probe='milestone-entry']")
    ).toHaveAttribute("aria-label", `打开会话：${MILESTONES_COMPACTION_TITLE}`);
    await expect(card(page, "first-session").locator("[data-probe='milestone-entry']")).toHaveAttribute(
      "aria-label",
      `打开会话：${MILESTONES_FIRST_SESSION_TITLE}`
    );
  });
});

test.describe("里程碑 · 空场景", () => {
  test.use({ scenario: emptyScenario() });

  test("一个会话都没有时是一条事实行，不是空货架、也不是 0", async ({ page }) => {
    // 一个会话都没有时，用量页整页是那条「还没有可统计的会话」空态，分段控件
    // 根本不渲染——所以这一档只能用**上一次停在这一档**这个真实用户状态进入
    // （持久化键沿用 N1 的 `cca-usage-view`）。这也正是这条空态存在的理由：
    // 会话被清理掉之后，昨天停在里程碑档的人今天还会回到这里。
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("cca-usage-view", "milestones");
      } catch {
        // 隐私模式下 localStorage 可能不可用；这条用例的前提本来就是它可用。
      }
    });
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();

    const empty = page.locator("[data-probe='milestones-empty']");
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty).toContainText("还没有可以回顾的里程碑");
    await expect(empty).toContainText("本机 ~/.claude/projects 下没有会话记录");
    // 空货架的反面：一枚卡片都没有，三张 Panel 一张也不渲染。
    await expect(page.locator("[data-probe='milestone-card']")).toHaveCount(0);
    await expect(page.locator("[data-probe='milestones-group']")).toHaveCount(0);
    // 用量档那句「还没有可统计的会话」不是这一档的语言。
    await expect(page.getByText("还没有可统计的会话")).toHaveCount(0);
  });
});
