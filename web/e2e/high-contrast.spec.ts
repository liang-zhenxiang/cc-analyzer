import type { Page } from "@playwright/test";
import { test, expect, recentActivityScenario } from "./fixtures";

/**
 * 界面高对比度档的端到端回归（Round U）。
 *
 * 这一页要立住五件事，全都只能在真实排版引擎里量：
 *
 * 1. **档位真的写进根元素**：切「高对比度」后 `data-contrast="high"` 在场、计算出来的
 *    关键令牌（`--text` / `--bg` / `--border` / `--ring`）真的换到定稿值；切回「普通」是
 *    **属性被删除**（不是留下 `"normal"`），计算色也随之复原。
 * 2. **持久化**：高对比度下刷新仍在——这同时验证 `web/index.html` 那段预绘制脚本没写坏。
 * 3. **首帧脚本独立成立**：把模块脚本拦下来（React 不挂载）后，根属性仍由 head 里那段
 *    内联脚本写好，证明「第一帧就是对的档」不是靠模块脚本补的。
 * 4. **跟随系统**：无本地存储时 `prefers-contrast: more` 默认启用；用户显式点过之后
 *    系统再怎么变都不动（显式优先）。
 * 5. **只动颜色、不动尺寸**：130% 字号 + 高对比度下用量页与日志表都不横向溢出；
 *    分段控件的选中滑块补了 1px 描边，但控件外框**逐像素不变**。
 *
 * 它跑在**生产构建产物**上（`vite build` + `vite preview`），量到的是用户拿到的
 * 那个 bundle，不是 dev server 的。
 */

const PANEL = "阈值设置";
const GROUP = "界面对比度";
const SNAPSHOT_TITLE = "用量总览";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "设置" }).click();
  const panel = page.getByLabel(PANEL);
  await expect(panel).toBeVisible();
  return panel;
}

/** 对比度那一组——可访问名本身也是本轮要验的东西之一，所以按名取而不是按锚点取。 */
function contrastGroup(page: Page) {
  return page.getByRole("radiogroup", { name: GROUP });
}

function radio(page: Page, name: string) {
  return contrastGroup(page).getByRole("radio", { name });
}

/** 根元素上的自定义属性——换挡是否真的生效的唯一事实来源。 */
async function rootToken(page: Page, token: string): Promise<string> {
  return page.evaluate(
    (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
    token
  );
}

async function rootContrast(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute("data-contrast"));
}

async function hasContrast(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.hasAttribute("data-contrast"));
}

async function storedContrast(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("cca-contrast"));
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
}

/**
 * 计算色在不同引擎上有三种写法：`#rrggbb`、被压缩过的 `#rgb`、以及
 * `rgb(r, g, b)`。三者都是同一个颜色，所以统一解析成 RGB 三元组再比——
 * 既不会因为引擎的归一化假红，也不会退化成「只要非空就算过」。
 */
function parseColor(value: string): [number, number, number] | null {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (char) => char + char) : hex[1];
    return [0, 2, 4].map((i) => Number.parseInt(digits.slice(i, i + 2), 16)) as [
      number,
      number,
      number
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(text);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function expectColor(actual: string, hex: string) {
  expect(parseColor(actual), `无法解析计算色 ${JSON.stringify(actual)}`).toEqual(parseColor(hex));
}

async function setFontScale(page: Page, name: string) {
  await page.getByRole("radiogroup", { name: "界面字号" }).getByRole("radio", { name }).click();
}

test.describe("界面高对比度", () => {
  test("默认档：两档、普通选中、根元素没有 data-contrast", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    const items = contrastGroup(page).getByRole("radio");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveText("普通");
    await expect(items.nth(1)).toHaveText("高对比度");
    await expect(items.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(items.nth(1)).toHaveAttribute("aria-checked", "false");

    // 普通档是「属性不存在」，不是 `data-contrast="normal"`——探针与 CSS 都按这条对账。
    expect(await hasContrast(page)).toBe(false);
    expectColor(await rootToken(page, "--text"), "#16181b");

    const { scrollWidth, clientWidth } = await horizontalOverflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("切到高对比度：根属性、关键令牌与可见文字颜色一起换挡", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    // 用 `var(--text-tertiary)` 的说明句做「计算色确实变了」的可见证据。
    const note = page.getByText("提高文字、边框与图形的对比度，不改字号与间距。默认跟随系统设置。");
    await expect(note).toBeVisible();
    expectColor(await note.evaluate((node) => getComputedStyle(node).color), "#6b7381");

    await radio(page, "高对比度").click();
    await expect(radio(page, "高对比度")).toHaveAttribute("aria-checked", "true");

    expect(await rootContrast(page)).toBe("high");
    expectColor(await rootToken(page, "--text"), "#000000");
    expectColor(await rootToken(page, "--bg"), "#ffffff");
    expectColor(await rootToken(page, "--border"), "#6b7280");
    expectColor(await rootToken(page, "--ring"), "#0b3f9c");
    expect(await storedContrast(page)).toBe("high");
    expectColor(await note.evaluate((node) => getComputedStyle(node).color), "#33414f");

    const high = await horizontalOverflow(page);
    expect(high.scrollWidth).toBeLessThanOrEqual(high.clientWidth + 1);

    // 切回普通：可逆，且不留残属性。
    await radio(page, "普通").click();
    await expect(radio(page, "普通")).toHaveAttribute("aria-checked", "true");
    expect(await hasContrast(page)).toBe(false);
    expectColor(await rootToken(page, "--text"), "#16181b");
    expectColor(await note.evaluate((node) => getComputedStyle(node).color), "#6b7381");
  });

  test("持久化：刷新后仍是高对比度，「高对比度」仍选中", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await radio(page, "高对比度").click();
    expect(await rootContrast(page)).toBe("high");

    await page.reload();
    await openSettings(page);
    // 刷新后模块脚本会重新同步一次内存值；属性在场且计算色是高对比度定稿值。
    expect(await rootContrast(page)).toBe("high");
    expectColor(await rootToken(page, "--text"), "#000000");
    await expect(radio(page, "高对比度")).toHaveAttribute("aria-checked", "true");
    expect(await storedContrast(page)).toBe("high");

    await radio(page, "普通").click();
    expect(await hasContrast(page)).toBe(false);
    expect(await storedContrast(page)).toBe("normal");
  });

  test("首帧脚本独立成立：拦下模块脚本后根属性仍由 head 内联脚本写好", async ({ page }) => {
    // 这条把「index.html 的预绘制」与「模块脚本里的 initContrast」拆开验：
    // 生产产物的模块脚本被 abort 掉，React 不会挂载，页面里只剩 head 那几段内联脚本。
    // 根属性若仍正确，说明第一帧的档位不依赖 JS bundle。
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-contrast", "high");
    });
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/");
    // 守卫：模块脚本确实没跑（否则下面两条会因为在验 React 而失去意义）。
    await expect(page.locator("#root")).toBeEmpty();
    expect(await rootContrast(page)).toBe("high");
  });

  test("首帧脚本：存储里是白名单外的值时不写属性", async ({ page }) => {
    // 与上一条同一条路径的另一半：「不可信输入回落安全默认」。
    await page.addInitScript(() => {
      window.localStorage.setItem("cca-contrast", "max");
    });
    await page.route("**/assets/*.js", (route) => route.abort());

    await page.goto("/");
    await expect(page.locator("#root")).toBeEmpty();
    expect(await hasContrast(page)).toBe(false);
  });

  test("跟随系统：无存储时 prefers-contrast: more 默认高对比度，显式选择优先", async ({
    page
  }) => {
    await page.emulateMedia({ contrast: "more" });
    await page.goto("/");

    // 「先试再判断」：某些引擎不实现 prefers-contrast 的模拟，这时如实跳过而不是假绿。
    const supported = await page.evaluate(
      () => window.matchMedia("(prefers-contrast: more)").matches
    );
    test.skip(!supported, "该引擎不支持 prefers-contrast 的媒体模拟");

    expect(await rootContrast(page)).toBe("high");
    await openSettings(page);
    await expect(radio(page, "高对比度")).toHaveAttribute("aria-checked", "true");

    // 用户点「普通」= 显式选择：此后系统再怎么变，都停在普通档。
    await radio(page, "普通").click();
    expect(await hasContrast(page)).toBe(false);
    expect(await storedContrast(page)).toBe("normal");

    await page.emulateMedia({ contrast: "no-preference" });
    expect(await hasContrast(page)).toBe(false);
    await page.emulateMedia({ contrast: "more" });
    expect(await hasContrast(page)).toBe(false);
    await expect(radio(page, "普通")).toHaveAttribute("aria-checked", "true");
  });
});

test.describe("高对比度 · 分段控件选中滑块", () => {
  /** 选中档的边界与外框尺寸：切换前后各量一次。 */
  async function selectedMetrics(page: Page, name: string) {
    return radio(page, name).evaluate((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        borderWidth: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor,
        boxShadow: style.boxShadow,
        width: rect.width,
        height: rect.height
      };
    });
  }

  /**
   * 选中档要有**一条 1px 的 `--border-strong` 边界**（设计规格 §4.3）。
   *
   * 这里验的是那条边界的**意图**而不是某一种画法：1px 实线边框，或等价的
   * `inset 0 0 0 1px` 内阴影，都满足「选中与未选中在纯白/纯黑底上有边界」。
   * 之所以不绑死 `border`：`.item` 是**内容自适应**宽度，`box-sizing: border-box`
   * 只在显式给了宽高时才保住外框——实线边框会把控件撑大 2px（实测 Chromium
   * 60×36 → 62×38），与规格 §8.4 的「外框逐像素不变」硬断言直接冲突。
   * 尺寸那半由下面的几何断言独立把关，两条一起才成立。
   */
  function expectBoundary(
    edge: { borderWidth: string; borderStyle: string; borderColor: string; boxShadow: string },
    hex: string
  ) {
    const rgb = parseColor(hex);
    expect(rgb, `测试内部的期望色解析失败：${hex}`).not.toBeNull();
    const want = rgb as [number, number, number];
    const border = parseColor(edge.borderColor);
    const viaBorder =
      edge.borderWidth === "1px" &&
      edge.borderStyle === "solid" &&
      border !== null &&
      border[0] === want[0] &&
      border[1] === want[1] &&
      border[2] === want[2];
    const viaInset = edge.boxShadow.includes(
      `rgb(${want[0]}, ${want[1]}, ${want[2]}) 0px 0px 0px 1px inset`
    );
    expect(
      viaBorder || viaInset,
      `选中档缺少 1px 的 --border-strong 边界：` +
        `border=${edge.borderWidth} ${edge.borderStyle} ${edge.borderColor}，box-shadow=${edge.boxShadow}`
    ).toBe(true);
  }

  test("高对比度给选中档补 1px --border-strong 边界，外框尺寸逐像素不变", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    const before = await selectedMetrics(page, "普通");
    // 普通档没有这条边界：分界由阴影与字重承担。
    expect(before.borderWidth).toBe("0px");
    expect(before.boxShadow).not.toContain("1px inset");

    await radio(page, "高对比度").click();
    await expect(radio(page, "高对比度")).toHaveAttribute("aria-checked", "true");

    const after = await selectedMetrics(page, "高对比度");
    // 边界色就是高对比度块的 --border-strong（浅色 #3f4854）。
    expectColor(await rootToken(page, "--border-strong"), "#3f4854");
    expectBoundary(after, "#3f4854");

    // 「只动颜色」的可验证形式：多了这条边界，外框仍逐像素不变。
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(0.5);
  });
});

test.describe("高对比度 · 几何不变量", () => {
  test.use({ scenario: recentActivityScenario() });

  test("130% 字号 + 高对比度下用量页不横向溢出", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await setFontScale(page, "130%");
    await radio(page, "高对比度").click();
    await page.getByRole("button", { name: "关闭" }).click();

    await page.getByRole("tab", { name: SNAPSHOT_TITLE }).click();
    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });

    // 两条路径都真的生效了，才谈得上「130% + 高对比度下不溢出」。
    expect(await rootToken(page, "--font-scale")).toBe("1.3");
    expect(await rootContrast(page)).toBe("high");

    const { scrollWidth, clientWidth } = await horizontalOverflow(page);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test("130% 字号 + 高对比度下日志表不横向溢出", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);
    await setFontScale(page, "130%");
    await radio(page, "高对比度").click();
    await page.getByRole("button", { name: "关闭" }).click();

    await page.getByPlaceholder("搜会话 ID 或目录…").fill("ansi");
    await page
      .getByLabel("会话列表", { exact: true })
      .locator("button[title]:has(strong)")
      .first()
      .click();
    await page.getByRole("tab", { name: "日志视图" }).click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    expect(await rootToken(page, "--font-scale")).toBe("1.3");
    expect(await rootContrast(page)).toBe("high");

    const measured = await page.evaluate(() => {
      const table = document.querySelector("main table") as HTMLTableElement | null;
      const wrap = table?.parentElement as HTMLElement | null;
      return {
        table: table ? table.scrollWidth - table.clientWidth : Number.NaN,
        wrapper: wrap ? wrap.scrollWidth - wrap.clientWidth : Number.NaN,
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    });
    // 表格、表格容器与页面三层都不许横向溢出——高对比度只换颜色，这三条账与普通档相同。
    expect(measured.document).toBeLessThanOrEqual(1);
    expect(measured.wrapper).toBeLessThanOrEqual(1);
    expect(measured.table).toBeLessThanOrEqual(1);
  });
});

test.describe("高对比度 · 设置面板分段控件宽度", () => {
  /**
   * 「界面对比度」控件外面套了一层锚点 div（给真机门禁收窄 radiogroup 用）。
   * 那层 div 若是普通 block，inline-flex 的 SegmentedControl 会收缩到内容宽
   * （实测 126px），把「高对比度」挤成两行；修法是锚点容器用 1fr 单列网格，
   * 让控件照旧撑满——与相邻「界面字号」控件（直接挂在 flex 列的
   * `.preferenceSection` 上）同宽。
   *
   * 这里量的是真实排版：两个控件等宽且都等于面板内容宽（1440×900 实测 394px），
   * 且「界面对比度」两档的文字都在一行里。
   */
  test("两个分段控件同宽撑满面板，「高对比度」两档不折行", async ({ page }) => {
    await page.goto("/");
    await openSettings(page);

    const fontGroup = page.getByRole("radiogroup", { name: "界面字号" });
    const contrast = contrastGroup(page);

    // 面板内容宽：字号控件是 `.preferenceSection` 的直接子项，父元素就是那一列的
    // 内容盒（无内边距），它的 clientWidth 即面板内容宽。
    const widths = await fontGroup.evaluate((node) => {
      const section = node.parentElement as HTMLElement;
      return {
        section: section.clientWidth,
        font: (node as HTMLElement).getBoundingClientRect().width
      };
    });
    const contrastWidth = await contrast.evaluate((node) => node.getBoundingClientRect().width);

    // 锚点容器不得改变控件布局：对比度控件要有字号控件那么宽，且两者都撑满面板。
    // 缺陷态下对比度控件只有 126px（内容宽），与 394px 差出 268px。
    expect(Math.abs(contrastWidth - widths.section)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(widths.font - widths.section)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(contrastWidth - widths.font)).toBeLessThanOrEqual(0.5);

    // 两档文字都在一行：用 Range 数行盒的行顶。
    // 注意 `scrollHeight === clientHeight` 抓不到这一处折行——两行文字（各 18px）
    // 恰好等于 min-height 36px，溢出量为零；行顶去重后必须只剩一个。
    const lines = await contrast.getByRole("radio").evaluateAll((nodes) =>
      nodes.map((node) => {
        const el = node as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = Array.from(range.getClientRects()).map((rect) => Math.round(rect.top));
        return {
          text: el.textContent,
          lineCount: new Set(tops).size,
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth
        };
      })
    );

    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.lineCount, `「${line.text}」折成了 ${line.lineCount} 行`).toBe(1);
      expect(line.scrollHeight).toBe(line.clientHeight);
      expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
    }
  });
});
