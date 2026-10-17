import { expect } from "@playwright/test";
import { test as appTest, defaultScenario } from "./fixtures";
import { SESSION_ITEM_SELECTOR, sessionItems } from "./selectors";

/**
 * 选择器特异性的**实测**探针（不是推理）。
 *
 * 为什么值得单独一条用例：这个选择器历史上被写宽过一次、又被 DOM 改动打穿过
 * 一次，两次都是「看着像功能坏了，其实是选择器错了」。它的特异性由两半拼成——
 * `[title]` 与 `:has(strong)`——而这两半各自挡掉哪一类噪声，只有真的去数一遍
 * 才不会在下次改动时悄悄失效。
 *
 * 断言的是**事实数字**：会话列表容器内，新选择器的匹配数必须**恰好等于**会话条数，
 * 且**不含**工具栏那颗 IconButton（它也带 `title`，且就长在同一个 `<aside>` 里）。
 */

/**
 * 逐段放宽的对照表：从「几乎不匹配」到「宽到会把噪声算进来」。
 *
 * 顺序有意为之——最窄的 `[aria-label="会话列表"][title]` 是 0（容器自己不是条目），
 * 最宽的两条会把折叠按钮的 `<strong>` 或工具栏的 title 算进来。
 */
const HIERARCHY = [
  '[aria-label="会话列表"][title]:has(strong)',
  '[aria-label="会话列表"] [title]:has(strong)',
  '[aria-label="会话列表"] [role="button"]',
  '[aria-label="会话列表"] strong',
  '[aria-label="会话列表"] button[title]',
  SESSION_ITEM_SELECTOR
];

appTest.describe("会话条目选择器的特异性", () => {
  appTest.use({ scenario: defaultScenario() });

  appTest("匹配数等于会话条数，且不命中工具栏 IconButton", async ({ page }) => {
    await page.goto("/");

    const list = page.getByLabel("会话列表", { exact: true });
    await expect(list).toBeVisible();
    await sessionItems(page).first().waitFor({ timeout: 15_000 });

    // 1) 新选择器：命中数与应用的会话条数**逐字相等**（默认场景 8 条）。
    const matched = await sessionItems(page).count();
    expect(matched).toBe(8);

    // 2) 工具栏那颗 IconButton 真的在这个容器里、真的带 title —— 先证明「坑存在」。
    //    少了这条，下面的「不命中」可能只是因为容器里压根没有别的 title 元素，
    //    那样断言就是恒真的，等于没测。
    const toolbar = list.getByRole("button", { name: "刷新会话列表" });
    await expect(toolbar).toBeVisible();
    expect(await toolbar.getAttribute("title")).toBe("刷新会话列表");
    expect(await toolbar.evaluate((el) => el.tagName.toLowerCase())).toBe("button");

    // 3) 于是：容器内**全部** `[title]` 元素比会话条目多——多出来的正是工具栏那颗。
    //    这一条就是「选择器必须写窄」的机器化表达。
    const allTitled = await list.locator("[title]").count();
    expect(allTitled).toBeGreaterThan(matched);

    // 4) 工具栏按钮本身**不**被新选择器命中：它没有 <strong>。
    expect(await toolbar.locator("strong").count()).toBe(0);

    // 把实测数字打出来，供回报与排障引用（`--reporter=list` 会显示）。
    console.log(
      [
        "",
        "===== 选择器特异性实测（Chromium/WebKit 各跑一次） =====",
        `会话条目数 sessionItems()        = ${matched}`,
        `容器内 [title] 元素总数          = ${allTitled}  (多出的 ${allTitled - matched} 个正是工具栏 IconButton)`,
        `工具栏 IconButton title          = 刷新会话列表（tagName=button）`,
        `最终选择器                        = ${SESSION_ITEM_SELECTOR}`,
        "======================================================",
        ""
      ].join("\n")
    );
  });

  /**
   * 把选择器的**层级假设**钉死：`getByLabel("会话列表")` 命中的是 `<aside>`
   * 本身，而 `locator()` 是从它**内部**开始匹配后代。这条如果哪天变了
   * （比如 aside 变成 role=region 被包一层），上面的数字会一起塌。
   */
  appTest("层级：容器是 aside[aria-label=会话列表]，条目在其内部", async ({ page }) => {
    await page.goto("/");
    const list = page.getByLabel("会话列表", { exact: true });
    await expect(list).toBeVisible();
    await sessionItems(page).first().waitFor({ timeout: 15_000 });

    expect(await list.evaluate((el) => el.tagName.toLowerCase())).toBe("aside");

    // 逐条核对每个匹配项确实在容器**内部**（descendant），不是容器自己。
    const inside = await list.locator(SESSION_ITEM_SELECTOR).evaluateAll((els) => {
      const container = document.querySelector('[aria-label="会话列表"]');
      return els.map((el) => ({
        descendant: container !== null && container !== el && container.contains(el),
        isSelf: el.getAttribute("aria-label") === "会话列表",
        hasStrong: el.querySelector("strong") !== null,
        hasTitle: el.hasAttribute("title"),
        role: el.getAttribute("role")
      }));
    });

    expect(inside.length).toBe(8);
    for (const row of inside) {
      expect(row.descendant).toBe(true);
      expect(row.isSelf).toBe(false);
      expect(row.hasStrong).toBe(true);
      expect(row.hasTitle).toBe(true);
      expect(row.role).toBe("button");
    }
  });

  /**
   * `[title]` 这半到底挡掉了什么：把两半逐一摘掉，量出计数怎么变。
   * 这不是断言「某个选择器错了」，而是把**为什么不能省**写成可执行的证据。
   *
   * 注意 `[role="button"]` 那条目前是 8 而不是 9：出血点徽章虽然是个真 `<button>`，
   * 但它只在 `bleedCount > 0` 时渲染，而默认场景没有出血点会话。**若将来给默认
   * 场景加了出血点会话，这条会变成 9**——那不是回归，是夹具变了。
   */
  appTest("两半各自挡掉什么：逐段放宽的计数对照", async ({ page }) => {
    await page.goto("/");
    const list = page.getByLabel("会话列表", { exact: true });
    await expect(list).toBeVisible();
    await sessionItems(page).first().waitFor({ timeout: 15_000 });

    const counts: Record<string, number> = {};
    for (const sel of HIERARCHY) {
      counts[sel] = await page.locator(sel).count();
    }
    console.log(
      "\n===== 逐段放宽对照 =====\n" + JSON.stringify(counts, null, 2) + "\n=======================\n"
    );

    // 容器自己**不**匹配（选择器是从内部算后代的），所以这条必须是 0。
    expect(counts['[aria-label="会话列表"][title]:has(strong)']).toBe(0);
    // 最终选择器：8
    expect(counts[SESSION_ITEM_SELECTOR]).toBe(8);
    // 去掉 <strong> 那一半之后仍然是 8：符合 role=button 且带 title 的
    // 只有会话条目（IconButton 是 <button>，不是 role="button"）。
    expect(counts['[aria-label="会话列表"] [role="button"]']).toBe(8);
    // 反过来，去掉 [role="button"] 只留 [title]:has(strong) 也是 8——
    // 两半各自都够用，合起来是**双重保险**，将来任一类噪声进来都挡得住。
    expect(counts['[aria-label="会话列表"] [title]:has(strong)']).toBe(8);
    // 最宽的 `strong` 会多算（分组折叠按钮也含 <strong>）——证明不能按文本选。
    expect(counts['[aria-label="会话列表"] strong']).toBe(9);
    // 工具栏 IconButton 恰好 1 个，它就是 `[title]` 那半挡掉的对象。
    expect(counts['[aria-label="会话列表"] button[title]']).toBe(1);
  });
});
