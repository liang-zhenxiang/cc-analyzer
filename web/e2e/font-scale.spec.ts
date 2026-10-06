import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * 界面字号缩放的端到端回归。
 *
 * 这一页要立住三条：**档位真的写进了根元素**（首屏字号真的变了）、
 * **切档后布局不破**（130% 下不横向溢出、会话行不裁字）、
 * **持久化与回落都对**（未知值回落 100%，选过的档位重开还在）。
 *
 * 它跑在**生产构建产物**上（`vite build` + `vite preview`），所以量出来的
 * 是用户拿到的那个 bundle 的行为，不是 dev server 的。
 */

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "设置" }).click();
  const panel = page.getByLabel("阈值设置");
  await expect(panel).toBeVisible();
  return panel;
}

function fontScaleGroup(page: Page) {
  // radiogroup 是本轮做的正确 ARIA（分段控件按「选一个值」语义用的变体）。
  return page.getByRole("radiogroup", { name: "界面字号" });
}

/** 根元素上算出来的 `--font-scale`——缩放是否真的生效的唯一事实来源。 */
async function rootFontScale(page: Page): Promise<string> {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim()
  );
}

async function bodyMetrics(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { fontSize: style.fontSize, lineHeight: style.lineHeight };
  });
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
}

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

test.describe("界面字号缩放", () => {
  test("默认 100%：五档、100% 选中、正文 13/20", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    const group = fontScaleGroup(page);

    const items = group.getByRole("radio");
    await expect(items).toHaveCount(5);
    await expect(items.nth(0)).toHaveText("90%");
    await expect(items.nth(1)).toContainText("100%");
    await expect(items.nth(2)).toHaveText("110%");
    await expect(items.nth(3)).toHaveText("120%");
    await expect(items.nth(4)).toHaveText("130%");

    // 默认恰有 1 项选中，且是 100%（它的可访问名里带一个视觉隐藏的「（默认）」）。
    await expect(items.nth(1)).toHaveAttribute("aria-checked", "true");
    await expect(items.nth(0)).toHaveAttribute("aria-checked", "false");
    // 视觉隐藏的「（默认）」在可访问名里会带一个空白，别把空格写死。
    await expect(items.nth(1)).toHaveAccessibleName(/100%\s*（默认）/);

    expect(await rootFontScale(page)).toBe("1");
    expect(await bodyMetrics(page)).toEqual({ fontSize: "13px", lineHeight: "20px" });
  });

  test("选 130%：根变量、正文、持久化都跟着走，且不横向溢出", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    const group = fontScaleGroup(page);

    await group.getByRole("radio", { name: "130%" }).click();

    await expect(group.getByRole("radio", { name: "130%" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await expect(group.getByRole("radio", { name: "100%" })).toHaveAttribute(
      "aria-checked",
      "false"
    );
    expect(await rootFontScale(page)).toBe("1.3");
    expect(await bodyMetrics(page)).toEqual({ fontSize: "16.9px", lineHeight: "26px" });
    expect(await page.evaluate(() => localStorage.getItem("cca-font-scale"))).toBe("1.3");

    // 放大字号最容易破的就是横向：131% 一行放不下的表头/侧栏会把文档撑宽。
    await page.getByRole("button", { name: "关闭" }).click();
    const { scrollWidth, clientWidth } = await horizontalOverflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);

    // 切回 100% 复原：可逆，不留痕。
    await openSettings(page);
    await fontScaleGroup(page).getByRole("radio", { name: "100%" }).click();
    expect(await rootFontScale(page)).toBe("1");
    expect(await bodyMetrics(page)).toEqual({ fontSize: "13px", lineHeight: "20px" });
  });

  test("切档后会话行不裁字、行高按比例长", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await fontScaleGroup(page).getByRole("radio", { name: "130%" }).click();
    await page.getByRole("button", { name: "关闭" }).click();

    const firstRow = sessionItems(page).first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
    const row = firstRow.locator("xpath=..");

    const box = await row.evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      rectHeight: el.getBoundingClientRect().height
    }));
    // 54 × 1.3 = 70.2 → 70px（TS 常量会话行高就是 round(54*1.3)）。
    expect(Math.round(box.rectHeight)).toBe(70);
    // 内容装得下：元信息行没有被 overflow:hidden 切掉。
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1);
  });

  test("键盘：100% 上按 ArrowRight 选中 110% 并把焦点带过去", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    const group = fontScaleGroup(page);

    await group.getByRole("radio", { name: "100%" }).focus();
    await page.keyboard.press("ArrowRight");

    const active = group.getByRole("radio", { name: "110%" });
    await expect(active).toHaveAttribute("aria-checked", "true");
    await expect(active).toBeFocused();
    expect(await rootFontScale(page)).toBe("1.1");
  });

  test("持久化里是未知值时回落 100%，不抛错", async ({ page }) => {
    // 在模块脚本之前埋一个不在白名单里的值——「不可信输入回落安全默认」。
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-font-scale", "115");
    });
    await page.goto("/");
    await openSettings(page);

    const group = fontScaleGroup(page);
    await expect(group.getByRole("radio", { name: "100%" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(await rootFontScale(page)).toBe("1");
    expect(await bodyMetrics(page)).toEqual({ fontSize: "13px", lineHeight: "20px" });
  });
});
