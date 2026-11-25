import type { Page } from "@playwright/test";
import {
  test,
  expect,
  checkupScenario,
  checkupInsufficientScenario,
  checkupQuietScenario,
  checkupObserveOnlyScenario
} from "./fixtures";

/**
 * 「工作流体检」（Issue #391）端到端，覆盖 design §7.3。
 *
 * 主场景让三条规则越线、委派项触发 observe（数字全部可手算）：
 *   - 上下文：12 / 22 个会话峰值 ≥ 170K（54.5% > 50%）；
 *   - 错误：18 次失败里 16 次来自 Bash（88.9%），Bash 失败率 80%；
 *   - 缓存：12.9% < 15%；
 *   - 委派：22 个会话里 0 个用过子 agent（0% < 5%），observe + 「说明」行；
 *   - 压缩：6 次 / 22 个会话 = 0.27，低于 0.40——刻意不触发：上限 4 条且
 *     observe 最先被挤掉，压缩项越线会让委派项进不了卡。
 * 另三个场景覆盖整卡不渲染（全健康 / 只有 observe / 样本不足）。
 */

async function openUsage(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
}

function checkupCard(page: Page) {
  return page.getByRole("region", { name: "工作流体检" });
}

function rootFontScale(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim()
  );
}

test.describe("工作流体检 · 有越线项", () => {
  test.use({ scenario: checkupScenario() });

  test("四条同屏：条目、顺序、级别、总述与事实", async ({ page }) => {
    await openUsage(page);
    const card = checkupCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    const items = card.locator("[data-probe='checkup-item']");
    await expect(items).toHaveCount(4);
    // 级别优先（focus → notice → observe），同级按 intensity 降序：
    // 上下文 1.18 > 错误 0.48；委派项恒为 observe（compaction 未触发）。
    const expected = [
      ["context-pressure", "focus"],
      ["error-focus", "focus"],
      ["cache-hit", "notice"],
      ["delegation", "observe"]
    ] as const;
    for (let index = 0; index < expected.length; index += 1) {
      await expect(items.nth(index)).toHaveAttribute("data-checkup-id", expected[index][0]);
      await expect(items.nth(index)).toHaveAttribute(
        "data-checkup-level",
        expected[index][1]
      );
    }

    await expect(card.locator("[data-probe='checkup-summary']")).toHaveText(
      "5 项检查里 3 项值得看一眼"
    );

    const facts = card.locator("[data-probe='checkup-fact']");
    await expect(facts.nth(0)).toContainText("12 / 22 个会话的上下文峰值不低于 170K");
    await expect(facts.nth(0)).toContainText("压缩阈值 200K 的 85%");
    await expect(facts.nth(1)).toContainText("全部 18 次工具失败里有 16 次来自 Bash");
    await expect(facts.nth(1)).toContainText("Bash 失败率 80%");
    await expect(facts.nth(2)).toContainText("输入侧只有 13% 来自缓存读取");
    await expect(facts.nth(3)).toContainText("22 个会话里没有一个用过子 agent");

    // observe 项的第二行是「说明」而不是「处方」，且没有跳转链接。
    const delegation = card.locator("[data-checkup-id='delegation']");
    await expect(delegation.locator("[data-probe='checkup-action']")).toContainText("说明");
    await expect(delegation).toContainText("这一项只陈述事实，不给建议");
    await expect(delegation.locator("[data-probe='checkup-action-link']")).toHaveCount(0);

    // 脚注：五项都达到样本下限，不出现「样本不足」；没有触发上限截断，
    // 不出现「前 4 项」。
    await expect(card).not.toContainText("样本不足，未判定。");
    await expect(card).not.toContainText("按严重度显示前 4 项。");

    // 事实与证据不泄漏绝对路径 / 项目名。
    const text = await card.innerText();
    expect(text).not.toContain("/repo");
    expect(text).not.toContain("/Users/e2e");
  });

  test("证据手风琴：只展开一条、Escape 收起且焦点留在「证据」按钮", async ({ page }) => {
    await openUsage(page);
    const card = checkupCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    const toggles = card.locator("[data-probe='checkup-evidence-toggle']");
    await expect(toggles).toHaveCount(4);
    await expect(card.locator("[data-probe='checkup-evidence']")).toHaveCount(0);

    await toggles.nth(0).click();
    await expect(toggles.nth(0)).toHaveAttribute("aria-expanded", "true");
    await expect(toggles.nth(0)).toHaveText("收起");
    await expect(card.locator("[data-probe='checkup-evidence']")).toHaveCount(1);

    const evidence = card.locator("[data-probe='checkup-evidence']");
    await expect(evidence.locator("dl")).toContainText("判定");
    await expect(evidence.locator("dl")).toContainText("样本");
    await expect(evidence.locator("dl")).toContainText("窗口");
    await expect(evidence.locator("[data-probe='checkup-meter']")).toBeVisible();
    // 证据区没有任何可聚焦元素。
    await expect(
      evidence.locator("a[href], button, input, select, textarea, [tabindex]")
    ).toHaveCount(0);

    // 再点另一条：上一条自动收起，仍只有一条。
    await toggles.nth(1).click();
    await expect(card.locator("[data-probe='checkup-evidence']")).toHaveCount(1);
    await expect(
      card.locator(
        "[data-checkup-id='context-pressure'] [data-probe='checkup-evidence']"
      )
    ).toHaveCount(0);

    await toggles.nth(1).press("Escape");
    await expect(card.locator("[data-probe='checkup-evidence']")).toHaveCount(0);
    await expect(toggles.nth(1)).toBeFocused();
  });

  test("打开错误档：切档后焦点落在「错误」标签，体检卡离开 DOM", async ({ page }) => {
    await openUsage(page);
    const card = checkupCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    const link = card.locator("[data-probe='checkup-action-link']");
    await expect(link).toHaveCount(1);
    await expect(link).toHaveText("打开错误档 →");
    await link.click();

    const viewGroup = page.getByRole("tablist", { name: "总览视图" });
    const errorsTab = viewGroup.getByRole("tab", { name: "错误", exact: true });
    await expect(errorsTab).toHaveAttribute("aria-selected", "true");
    // 焦点不能掉回 <body>：切档后下一帧落在「错误」那一枚。
    await expect(errorsTab).toBeFocused();
    // 用量档整块卸载，体检卡不再在 DOM 里。
    await expect(card).toHaveCount(0);
  });

  test("窗口切到 90 天：卡片重算，展开中的项保留", async ({ page }) => {
    await openUsage(page);
    const card = checkupCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    const toggle = card.locator("[data-probe='checkup-evidence-toggle']").first();
    await toggle.click();
    await expect(card.locator("[data-probe='checkup-evidence']")).toHaveCount(1);

    await page.getByRole("tablist", { name: "时间范围" }).getByRole("tab", { name: "近 90 天" }).click();

    // 规则与读数仍是同一批（夹具都在 12 天内）；展开状态不丢、不报错。
    await expect(card).toBeVisible();
    await expect(card.locator("[data-probe='checkup-item']")).toHaveCount(4);
    await expect(card.locator("[data-probe='checkup-evidence']")).toHaveCount(1);
    await expect(card).toContainText("近 90 天");
  });
});

test.describe("工作流体检 · 全健康", () => {
  test.use({ scenario: checkupQuietScenario() });

  test("整卡不渲染，但「值得注意的变化」仍在（不是整页空态）", async ({ page }) => {
    await openUsage(page);
    await expect(page.getByRole("region", { name: "值得注意的变化" })).toBeVisible({
      timeout: 15_000
    });
    await expect(checkupCard(page)).toHaveCount(0);
  });
});

test.describe("工作流体检 · 样本不足", () => {
  test.use({ scenario: checkupInsufficientScenario() });

  test("整卡不渲染，但洞察卡仍在（不是整页空态）", async ({ page }) => {
    await openUsage(page);
    // 数据层仍会返回 status: "insufficient" 与三个计数（组件测试钉住），
    // 但一条可执行信息都拿不出的卡不该占版面（design §4 修订）。
    await expect(page.getByRole("region", { name: "值得注意的变化" })).toBeVisible({
      timeout: 15_000
    });
    await expect(checkupCard(page)).toHaveCount(0);
    await expect(page.locator("[data-probe='checkup-insufficient']")).toHaveCount(0);
  });
});

test.describe("工作流体检 · 只有 observe", () => {
  test.use({ scenario: checkupObserveOnlyScenario() });

  test("没有处方的观察不单独占首屏：整卡不在 DOM 里", async ({ page }) => {
    await openUsage(page);
    await expect(page.getByRole("region", { name: "值得注意的变化" })).toBeVisible({
      timeout: 15_000
    });
    await expect(checkupCard(page)).toHaveCount(0);
  });
});

test.describe("工作流体检 · 130% 字号", () => {
  test.use({ scenario: checkupScenario() });

  test("卡内无横向溢出，维度名与事实不重叠，证据按钮留在卡内", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-font-scale", "1.3");
    });
    await openUsage(page);
    const card = checkupCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });
    expect(await rootFontScale(page)).toBe("1.3");

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // 维度名不越出自己的 92px 列，也不与事实列重叠。
    const dimension = card
      .locator("[data-checkup-id='context-pressure'] h3")
      .first();
    const fact = card
      .locator("[data-checkup-id='context-pressure'] [data-probe='checkup-fact']")
      .first();
    const [dimensionBox, factBox] = await Promise.all([
      dimension.boundingBox(),
      fact.boundingBox()
    ]);
    expect(dimensionBox).not.toBeNull();
    expect(factBox).not.toBeNull();
    expect(dimensionBox!.x + dimensionBox!.width).toBeLessThanOrEqual(factBox!.x + 1);
    const dimensionOverflow = await dimension.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }));
    expect(dimensionOverflow.scrollWidth).toBeLessThanOrEqual(
      dimensionOverflow.clientWidth + 1
    );

    // 证据按钮不越出卡片右边界；事实折行不裁字。
    const cardBox = await card.boundingBox();
    const toggleBox = await card
      .locator("[data-probe='checkup-evidence-toggle']")
      .first()
      .boundingBox();
    expect(cardBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 1);

    const factMetrics = await fact.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
    expect(factMetrics.scrollHeight).toBeLessThanOrEqual(factMetrics.clientHeight + 1);
  });
});

test.describe("工作流体检 · 深色 / 高对比度", () => {
  test.use({ scenario: checkupScenario() });

  test("标记仍按形状可辨，链接可见", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-theme", "dark");
      window.localStorage.setItem("cca-contrast", "high");
    });
    await openUsage(page);
    const card = checkupCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    const focusMarker = card
      .locator("[data-checkup-level='focus'] > span:first-child > span")
      .first();
    const noticeMarker = card
      .locator("[data-checkup-level='notice'] > span:first-child > span")
      .first();

    const focusStyle = await focusMarker.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.width,
        height: style.height,
        background: style.backgroundColor
      };
    });
    expect(focusStyle.width).toBe("8px");
    expect(focusStyle.height).toBe("8px");
    expect(focusStyle.background).not.toBe("rgba(0, 0, 0, 0)");

    const noticeStyle = await noticeMarker.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderTopStyle: style.borderTopStyle,
        borderTopWidth: style.borderTopWidth,
        background: style.backgroundColor
      };
    });
    // 环是「有描边、内部是面板底色」：Chromium 会把 1.5px 的 used value 舍到
    // 设备像素，所以只宣明「有实线描边」而不把 1.5 写死。
    expect(noticeStyle.borderTopStyle).toBe("solid");
    expect(parseFloat(noticeStyle.borderTopWidth)).toBeGreaterThanOrEqual(1);
    expect(noticeStyle.background).not.toBe("rgba(0, 0, 0, 0)");

    // observe 是 8×2 短横，靠宽度与圆形成对比，不靠颜色。
    const observeMarker = card
      .locator("[data-checkup-level='observe'] > span:first-child > span")
      .first();
    const observeStyle = await observeMarker.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        width: style.width,
        height: style.height,
        borderRadius: style.borderRadius,
        background: style.backgroundColor
      };
    });
    expect(observeStyle.width).toBe("8px");
    expect(observeStyle.height).toBe("2px");
    expect(observeStyle.background).not.toBe("rgba(0, 0, 0, 0)");

    // 唯一的彩色出口仍然可见。
    await expect(card.locator("[data-probe='checkup-action-link']")).toBeVisible();
  });
});
