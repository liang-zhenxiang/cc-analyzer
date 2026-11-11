import type { Page } from "@playwright/test";
import { test, expect, defaultScenario } from "./fixtures";

/**
 * 个性化强调色的端到端回归（Issue #322）。
 *
 * 这一页要立住四件事：
 *
 * 1. **选择真的写进根元素**：选「紫罗兰」后 `data-accent="violet"` 在场、
 *    `--accent` 的计算值确实变了；切回「品牌蓝」属性被**删除**（不是 `"blue"`）。
 * 2. **持久化**：刷新后仍是紫罗兰，且首帧由 `web/index.html` 的内联脚本写好
 *    ——把模块脚本拦下来、React 不挂载时属性依然在场，证明第一帧不闪品牌蓝。
 * 3. **不可信输入回落**：存储里是白名单外的值时，首帧脚本不写属性。
 * 4. **高对比度优先**：高对比度档固定使用最高对比色，`--accent` 回到该档的
 *    品牌蓝；切回普通档后所选的紫罗兰恢复。断言用同页实测值对比，不写死色号
 *    ——色板由 `tokens.css` 定义，写死 hex 会让测试与设计改动互相拖拽。
 */

const PANEL = "设置";
const GROUP = "强调色";
const VIOLET = "紫罗兰";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "设置" }).click();
  const panel = page.getByRole("region", { name: PANEL });
  await expect(panel).toBeVisible();
  return panel;
}

function accentGroup(page: Page) {
  return page.getByRole("group", { name: GROUP });
}

function accentOption(page: Page, name: string) {
  return accentGroup(page).getByRole("button", { name });
}

/** 默认档（蓝）是第一个选项；文案由 ACCENT_PRESETS 决定，这里按位置取。 */
function defaultAccent(page: Page) {
  return accentGroup(page).getByRole("button").first();
}

function contrastRadio(page: Page, name: string) {
  return page.getByRole("radiogroup", { name: "界面对比度" }).getByRole("radio", { name });
}

/** 根元素上的自定义属性——换色是否真的生效的唯一事实来源之一。 */
async function rootToken(page: Page, token: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    token
  );
}

async function rootAccent(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-accent"));
}

async function hasAccent(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.hasAttribute("data-accent"));
}

async function storedAccent(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("cca-accent"));
}

test.use({ scenario: defaultScenario() });

test.describe("个性化强调色", () => {
  test("默认：六档、品牌蓝选中、根元素没有 data-accent", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    const items = accentGroup(page).getByRole("button");
    await expect(items).toHaveCount(6);
    await expect(items.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(accentOption(page, VIOLET)).toHaveAttribute("aria-pressed", "false");

    // 品牌蓝是「属性不存在」，不是 `data-accent="blue"`——CSS 只命中一种默认状态。
    expect(await hasAccent(page)).toBe(false);
  });

  test("选「紫罗兰」：根属性、持久化与 --accent 计算值一起换色", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    const before = await rootToken(page, "--accent");
    expect(before).not.toBe("");

    await accentOption(page, VIOLET).click();
    await expect(accentOption(page, VIOLET)).toHaveAttribute("aria-pressed", "true");

    expect(await rootAccent(page)).toBe("violet");
    expect(await storedAccent(page)).toBe("violet");

    const after = await rootToken(page, "--accent");
    expect(after).not.toBe("");
    expect(after).not.toBe(before);

    // 切回默认蓝：属性被删掉，颜色也回到同一档的品牌蓝。
    await defaultAccent(page).click();
    await expect(defaultAccent(page)).toHaveAttribute("aria-pressed", "true");
    expect(await hasAccent(page)).toBe(false);
    expect(await storedAccent(page)).toBe("blue");
    expect(await rootToken(page, "--accent")).toBe(before);
  });

  test("持久化：刷新后仍是紫罗兰，选中态与计算色都跟着回来", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await accentOption(page, VIOLET).click();
    const violetToken = await rootToken(page, "--accent");

    await page.reload();
    await openSettings(page);

    expect(await rootAccent(page)).toBe("violet");
    expect(await storedAccent(page)).toBe("violet");
    await expect(accentOption(page, VIOLET)).toHaveAttribute("aria-pressed", "true");
    expect(await rootToken(page, "--accent")).toBe(violetToken);
  });

  test("首帧脚本独立成立：拦下模块脚本后根属性仍由 head 内联脚本写好", async ({ page }) => {
    // 把「index.html 的预绘制」与「模块脚本里的 initAccent」拆开验：生产产物的
    // 模块脚本被 abort 掉，React 不会挂载，页面里只剩 head 那几段内联脚本。
    // 根属性若仍正确，说明第一帧的强调色不依赖 JS bundle。
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-accent", "violet");
    });
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/");
    // 守卫：模块脚本确实没跑（否则下面两条会因为在验 React 而失去意义）。
    await expect(page.locator("#root")).toBeEmpty();
    expect(await rootAccent(page)).toBe("violet");
  });

  test("首帧脚本：白名单外的值不写属性，回到品牌蓝", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-accent", "magenta");
    });
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/");
    await expect(page.locator("#root")).toBeEmpty();
    expect(await hasAccent(page)).toBe(false);
  });

  test("高对比度优先：固定最高对比色，切回普通档后所选强调色恢复", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    // 先量出这一档（高对比度、未选强调色）的品牌蓝基准值，后面用它对比。
    await contrastRadio(page, "高对比度").click();
    const highContrast = await rootToken(page, "--accent");
    await contrastRadio(page, "普通").click();
    const normal = await rootToken(page, "--accent");
    expect(highContrast).not.toBe(normal);

    await accentOption(page, VIOLET).click();
    const violet = await rootToken(page, "--accent");
    expect(violet).not.toBe(normal);

    await contrastRadio(page, "高对比度").click();
    expect(await rootAccent(page)).toBe("violet");
    // 高对比度色板覆盖强调色：计算值回到该档的品牌蓝，而不是紫罗兰。
    expect(await rootToken(page, "--accent")).toBe(highContrast);
    expect(await rootToken(page, "--accent")).not.toBe(violet);

    // 选择没有被抹掉：切回普通档，紫罗兰立刻恢复。
    await contrastRadio(page, "普通").click();
    expect(await rootToken(page, "--accent")).toBe(violet);
  });

  test("高对比度档仍显示选择器，并说明此刻不生效", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await contrastRadio(page, "高对比度").click();

    await expect(accentGroup(page)).toBeVisible();
    await expect(page.getByText(/高对比度档固定使用最高对比色/)).toBeVisible();
    await expect(accentOption(page, VIOLET)).toBeEnabled();
  });
});
