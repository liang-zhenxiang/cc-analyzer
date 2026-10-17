import type { Page } from "@playwright/test";
import { test, expect, compactScenario, defaultScenario } from "./fixtures";
import { sessionItems } from "./selectors";

/**
 * 会话详情「出血点」标签页（Round X）——**CI 里的唯一门禁**。
 *
 * 为什么这个文件必须存在：`screenshots.spec.ts` 里那条「截图归档 · 出血点」被
 * `test.skip(!process.env.SCREENSHOTS)` 包着，而 CI 从不设置 `SCREENSHOTS`，
 * 所以它在 CI 里永远是 skipped。单测（`BleedView.test.tsx` / `bleedModel.test.ts`）
 * 跑在 jsdom 里，看不见真实排版引擎下的行为。这个文件补的正是那段空白：
 * 标签页真的挂上了、真的渲染出了清单、金额与 token 真的分栏、侧栏徽章真的联动。
 *
 * 这一层验证的是只有真实浏览器才给得出的东西：
 *  - 五个视图标签里的「出血点」可点，且切过去不是空白 / 加载中 / 错误态；
 *  - 面板的 `role=region` 可访问名、`role=list` 清单、`role=listitem` 条目真的在场；
 *  - 四类计数器（输入 / 缓存写入 / 缓存读取 / 输出）在页面上真的**分开**成四栏；
 *  - 侧栏徽章是真的 `<button>`（行本体已降级为 `role="button"` 的 `<div>`），
 *    点它能进出血点视图。
 *
 * 数据全部来自共享夹具 `compact-session.jsonl`（2 次压缩：auto + manual）。
 * 下面每一个数字都用 `buildBleedReport(parseJsonlText(夹具))` 从夹具现算核过，
 * 不是抄来的常量：
 *   compactionCount = 2
 *   压缩 #1 丢掉 94 条 → usd = 1.922259 → 渲染成 $1.92（另有 47 次调用定价未知）
 *   压缩 #2 丢掉 82 条 → usd = 1.626405 → 渲染成 $1.63（另有 41 次调用定价未知）
 *   结论行 = `bleedHeadline` = 「2 次压缩丢掉了 176 条消息」（94 + 82 = 176）
 *
 * ---------------------------------------------------------------------------
 * **已知的覆盖空白：`countOnly` / `COUNT_ONLY_NOTE` 在本文件里没有被断言。**
 *
 * 不是忘了写，是**现有任何单个场景都够不到那段 DOM**。实测（用
 * `buildBleedReport(parseJsonlText(夹具))` 逐个数出来的）：
 *
 *  - `compact-session.jsonl`     → compactionCount = 2，items 全是 `compaction`，
 *                                  **零条 `countOnly`** → `COUNT_ONLY_NOTE` 不渲染。
 *  - `tool-census-session.jsonl` → 7 条 `countOnly`，但 compactionCount = **0**
 *                                  → `BleedView` 直接走空态，永远到不了清单。
 *  - `session-basic.jsonl`       → 2 条 `countOnly`，compactionCount 同样是 **0**。
 *
 * 即：**「有压缩 → 渲染清单」与「有工具调用 → 渲染 countOnly 说明」在现有夹具里
 * 互斥**，不存在一个场景同时满足两者。
 *
 * 为什么不在这里合成一个「压缩 + 工具调用」的内存场景：那样断言的是**任何真实
 * 用户路径都产生不出来的 markup**，这种测试永远不会因为正确的理由而失败——它给
 * 的是「已覆盖」的错觉，而错觉比已知的空白更危险（项目红线：一个永远通过的检查
 * 比没有检查更危险）。真实世界里两者兼得的会话很常见，但要用**夹具**证明，
 * 那是新增共享夹具的事，超出本任务写范围，应当单独开一条任务。
 *
 * 这段空白由单测兜底：`BleedView.test.tsx` 的三条 countOnly 用例在 jsdom 里覆盖
 * 了它——**但那只覆盖组件的渲染树，不覆盖真实排版引擎下的表现**。这一层确实没有门禁。
 * ---------------------------------------------------------------------------
 */

/** 打开会话详情并等解析到位（照 `context-view.spec.ts` 的既有写法）。 */
async function openSession(page: Page, query: string) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill(query);
  await sessionItems(page).first().click();
  // 会话图状态是解析完成的既有时序锚点，别的 spec 都等它——不等就会截到空态那一帧。
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

/** 切到出血点标签，并等到**面板与清单同时在场**（不是只等到标签高亮）。 */
async function openBleedView(page: Page, query: string) {
  await openSession(page, query);
  await page.getByRole("tab", { name: "出血点" }).click();
  const panel = page.getByRole("region", { name: "上下文出血点" });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  return panel;
}

test.describe("出血点标签页（含压缩会话）", () => {
  test.use({ scenario: compactScenario() });

  /**
   * 常态：结论行 + 清单 + 两条压缩条目。
   *
   * 结论行的数字（176）是从夹具现算的：`bleedHeadline` 把各 compaction 条目的
   * `recordIds.length` 求和，夹具里是 94 + 82。
   */
  test("结论行、清单与两条压缩条目齐备，数字与夹具一致", async ({ page }) => {
    const panel = await openBleedView(page, "compact-demo");

    // 结论行：数字由夹具现算（94 + 82 = 176），不是抄任务描述。
    await expect(panel.getByText("2 次压缩丢掉了 176 条消息")).toBeVisible();

    // 清单是 role=list，两条 role=listitem（压缩 #1 / #2）。
    const list = panel.getByRole("list", { name: "出血清单" });
    await expect(list).toBeVisible();
    await expect(list.getByRole("listitem")).toHaveCount(2);

    // 每条的标题逐字核过：条数就是被丢出上下文的记录数。
    await expect(list.getByText("压缩 #1 · 丢掉 94 条消息")).toBeVisible();
    await expect(list.getByText("压缩 #2 · 丢掉 82 条消息")).toBeVisible();

    // aria-label 把类别写进可访问名（读屏用户不必靠猜标题判断类别）。
    await expect(list.getByRole("listitem", { name: "压缩" })).toHaveCount(2);
  });

  /**
   * 金额：`usd` 非 null 时按 `formatUsd` 渲染成两位小数。
   * 1.922259 → `$1.92`、1.626405 → `$1.63`（都是从夹具算出来的真值）。
   *
   * 同时确认「金额未知」那条诚实性文案没被误触发：这两条都能定价，
   * `unpricedCalls > 0`（47 / 41）走的是另一条分支「（另有 N 次调用定价未知，未计入）」。
   */
  test("金额读数在场，且未计入的调用数如实标注（不是 $0.00）", async ({ page }) => {
    const panel = await openBleedView(page, "compact-demo");
    const list = panel.getByRole("list", { name: "出血清单" });

    await expect(list.getByText("$1.92")).toBeVisible();
    await expect(list.getByText("$1.63")).toBeVisible();

    // 部分调用定不了价时，金额旁边的括注必须如实说明「未计入」。
    await expect(list.getByText("（另有 47 次调用定价未知，未计入）")).toBeVisible();
    await expect(list.getByText("（另有 41 次调用定价未知，未计入）")).toBeVisible();

    // 「不知道」与「就是 0 美元」是两件事——这一页上不该出现冒充零的读数。
    await expect(list.getByText("定价未知", { exact: true })).toHaveCount(0);
  });

  /**
   * 四类计数器**分开**成四栏，且**没有求和**。
   *
   * `tokenTotals.ts` 的红线是四类计数器永不求和展示；出血点页把它渲染成
   * 输入 / 缓存写入 / 缓存读取 / 输出 四个 `<dt>`。
   *
   * 「没有求和」的**可证伪**形式是断言那个合计值不出现：夹具里压缩 #1 的
   * `total` 是 3,845,108（= 50,948 + 117,500 + 3,661,300 + 15,360）。它一旦
   * 出现在页面上就说明有人把四类加起来了——这比「四个名字都在」强得多。
   *
   * 读数走 `formatTokenCount`：≥100 万折成一位小数（cacheRead 3,661,300 → `3.7M`），
   * 否则带千分位（input 50,948 → `50,948`）。断言用的是**渲染后的形态**。
   */
  test("四类计数器分成四栏且不求和，口径声明在场", async ({ page }) => {
    const panel = await openBleedView(page, "compact-demo");
    const list = panel.getByRole("list", { name: "出血清单" });
    const first = list.getByRole("listitem").first();

    // 四个计数器名各在场一次（「缓存写入」是 cacheCreation 的显示名）。
    for (const name of ["输入", "缓存写入", "缓存读取", "输出"]) {
      await expect(first.getByText(name, { exact: true })).toBeVisible();
    }

    // 四类各自的真实读数（渲染形态）：input 50,948；cacheRead 3,661,300 → 3.7M。
    await expect(first.getByText("50,948")).toBeVisible();
    await expect(first.getByText("3.7M")).toBeVisible();

    // 求和后的 total **绝不出现**——total 只做分母（tokenTotals.ts 的红线）。
    await expect(first.getByText("3,845,108")).toHaveCount(0);
    await expect(first.getByText("3.8M")).toHaveCount(0);

    // 口径句必须明说「未求和」——这是本页可读性的地基。
    await expect(panel.getByText(/四类计数器分开读数，未求和/)).toBeVisible();

    // 排序说明如实区分三类条目的排序键（不存在有意义的全局序）。
    await expect(panel.getByText(/排序：压缩按时间/)).toBeVisible();
  });

  /**
   * 证据分级：`ProvenanceBadge` 在有估算时是 «估算»，detail 写快照日期。
   *
   * `compact-session.jsonl` 的两条都能定价（`hasEstimate = true`），所以这里
   * 走的是 estimated 分支；`pricingAsOf` 来自 `PRICING_AS_OF`。
   */
  test("金额是估算时带证据徽章与快照日期", async ({ page }) => {
    const panel = await openBleedView(page, "compact-demo");
    await expect(panel.getByText(/快照日期/)).toBeVisible();
  });

  /**
   * 侧栏徽章联动（X3 的特性）：压缩次数 > 0 的行渲染一个**真按钮**，
   * 点它打开会话并切到出血点标签。
   *
   * 徽章数字与详情页同源（两边都调 `buildBleedReport(...).compactionCount`），
   * 所以这里断言的就是那个共享读数 = 2。
   */
  test("侧栏「2 次压缩」徽章可点，点了直接进出血点视图", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("compact-demo");

    const badge = sessionItems(page).first().getByRole("button", { name: "打开出血点标签，2 次压缩" });
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveText("2 次压缩");

    await badge.click();
    // 徽章的动作是「打开该会话 + 切到出血点」，两条都要成立。
    await expect(page.getByRole("region", { name: "上下文出血点" })).toBeVisible({
      timeout: 15_000
    });
    await expect(page.getByRole("tab", { name: "出血点" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.getByText("2 次压缩丢掉了 176 条消息")).toBeVisible();
  });
});

/**
 * 空态：**与上面「有压缩」是两个不同的事实**。
 *
 * `BleedView.tsx` 的注释明写两种空态不得合并成一句。这里覆盖的是第一种
 * ——「本会话没有发生压缩」（`compactionCount === 0`），与
 * 「压缩了但没丢东西」（有压缩、没有可归因的条目）是相反的结论。
 *
 * 用的是默认场景里的 `/repo/demo`（`session-basic.jsonl`，有 usage、无压缩），
 * 与 `context-view.spec.ts:87` 的既有写法同源，不额外引夹具。
 */
test.describe("出血点标签页（无压缩会话）", () => {
  /**
   * 显式固定默认场景。
   *
   * 不固定的话本组会**继承同文件上一个 describe 的 `compactScenario()`**——
   * Playwright 的 `test.use` 是文件内按顺序生效的，一个 describe 的 `test.use`
   * 会泄漏给后面没有自己 `test.use` 的 describe。那样这组跑的就成了
   * `/repo/compact-demo`（有压缩），「空态」两条会直接失败——而失败原因是
   * **我的夹具接错**，不是产品缺陷。显式绑回来，让这组断言的是它自称的那个会话。
   */
  test.use({ scenario: defaultScenario() });

  test("空态说的是「没有发生压缩」，而不是「压缩了但没丢东西」", async ({ page }) => {
    await openSession(page, "demo");
    await page.getByRole("tab", { name: "出血点" }).click();

    // 空态没有 region=「上下文出血点」那个 Panel，所以直接断言两句文案。
    await expect(page.getByText("本会话没有发生压缩")).toBeVisible({ timeout: 15_000 });

    // 这是**另一种**空态，不该同时出现——两种事实不能混为一谈。
    await expect(page.getByText("压缩了但没丢东西")).toHaveCount(0);
    // 没有压缩就没有清单可看。
    await expect(page.getByRole("list", { name: "出血清单" })).toHaveCount(0);
    // 也不该出现结论行那种「N 次压缩丢掉了 M 条消息」。
    await expect(page.getByText(/\d+ 次压缩丢掉了 \d+ 条消息/)).toHaveCount(0);
  });

  test("无压缩的会话在侧栏不渲染出血点徽章（不用 0 占满列表）", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("demo");
    const row = sessionItems(page).first();
    await expect(row).toBeVisible();
    // 等到徽章扫描有结论：有压缩的那条会出现徽章，无压缩的这条永远不出现。
    await expect(row.locator("[data-bleed-badge]")).toHaveCount(0);
  });
});
