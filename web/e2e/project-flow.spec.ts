import { test, expect, emptyScenario, roundFFScenario } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

/**
 * Issue #388「项目流量河流图」端到端验收（设计规格 §7.3）。
 *
 * 跑在生产构建产物上（`npm run build && npm run preview`），双引擎
 * （Chromium + WebKit）。断言只依赖夹具的结构事实与几何常量：河道数、探针、
 * 游标、点数、tooltip 行数、字号档下的排版边界——**不按具体 token 值断言**，
 * 夹具或定价快照漂移时不该假红。
 *
 * 夹具沿用 `roundFFScenario()`（5 个项目 / 24 份会话），空态沿用
 * `emptyScenario()`；打开实验室的辅助函数与 `lab.spec.ts` / `cost-treemap.spec.ts`
 * 同一套，不另造 stub。
 */

/** 几何常量（`projectFlow.ts` §1.3）——「形」，不随字号缩放。 */
const FLOW_PLOT_TOP = 8;
const FLOW_LANE_HEIGHT = 36;
const FLOW_LANE_GAP = 8;
const FLOW_LANE_PITCH = FLOW_LANE_HEIGHT + FLOW_LANE_GAP;
const FLOW_PLOT_LEFT = 192;
const FLOW_PLOT_RIGHT = 24;
const FLOW_NAME_RIGHT = 184;
const FLOW_AXIS_LABEL_ROOM = 28;

async function openLab(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览", exact: true }).click();
  await expect(page.locator("[data-probe='usage-progress']")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "实验室", exact: true }).click();
  // 等扫描收口成统计口径：扫描中的进度行不写「17 个视角」。
  await expect(page.getByText(/纳入统计 · 17 个视角/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-probe='lab-view']")).toBeVisible();
  await expect(page.locator("[data-lab-card]")).toHaveCount(17);
}

function ribbonCard(page: Page): Locator {
  return page.locator('[data-lab-card="ribbon"]');
}

function ribbonSvg(page: Page): Locator {
  return ribbonCard(page).locator("svg[data-probe='ribbon-chart']");
}

/**
 * 面板摘要里的「近 N 天」——窗口天数不从组件内部常量猜，读页面自己声明的口径。
 * 这样区间默认值变了，坐标推算会跟着变，而不是悄悄算在某一天之外。
 */
async function scopeDays(page: Page): Promise<number> {
  const text = await ribbonCard(page)
    .locator("[data-ribbon-group] > p")
    .first()
    .innerText();
  const match = /近 (\d+) 天/.exec(text);
  if (!match) throw new Error(`摘要里找不到窗口天数：${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** SVG 用户坐标 → 视口坐标（viewBox 与 CSS 像素 1:1，但仍按实测宽度换算）。 */
async function svgUserPointToPage(
  svg: Locator,
  userX: number,
  userY: number
): Promise<{ x: number; y: number }> {
  const box = await svg.boundingBox();
  if (!box) throw new Error("河流图不在布局里，无法换算坐标");
  const viewBoxWidth = await svg.evaluate(
    (node) => (node as SVGSVGElement).viewBox.baseVal.width
  );
  const scale = box.width / viewBoxWidth;
  return { x: box.x + userX * scale, y: box.y + userY * scale };
}

/** 每条河的顶边路径（`fill="none"`），用于读 stroke / 降级状态。 */
function laneEdges(page: Page): Locator {
  return ribbonCard(page).locator("[data-ribbon-lane] path[fill='none']");
}

test.describe("项目流量 · 有数据", () => {
  test.use({ scenario: roundFFScenario() });

  test("结构与刻度：5 条河、2 个 y 标签、统一刻度 > 0", async ({ page }) => {
    await openLab(page);
    const card = ribbonCard(page);
    const svg = ribbonSvg(page);

    await expect(card.getByRole("region", { name: "项目流量" })).toBeVisible();
    await expect(card.locator("[data-probe='lab-ribbon']")).toBeVisible();
    await expect(svg).toBeVisible();

    await expect(card.locator("[data-ribbon-lane]")).toHaveCount(5);
    // y 轴只在第一条河上画「满格 / 0」两个标签——不是每行都画。
    await expect(card.locator("[data-ribbon-y-label]")).toHaveCount(2);
    await expect(card.locator("[data-ribbon-y-label='max']")).toHaveCount(1);
    await expect(card.locator("[data-ribbon-y-label='zero']")).toHaveCount(1);

    const max = Number(await svg.getAttribute("data-ribbon-max"));
    expect(Number.isFinite(max), `data-ribbon-max 不是数字：${max}`).toBe(true);
    expect(max).toBeGreaterThan(0);

    // 颜色身份固定且不重复（5 个项目各占 1 档，不含中性色）。
    const tones = await card
      .locator("[data-ribbon-lane]")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-ribbon-tone")));
    expect(new Set(tones).size).toBe(5);
  });

  test("悬停第 5 天：游标、5 个点、5 行 tooltip，浮层不出视口", async ({ page }) => {
    await openLab(page);
    const card = ribbonCard(page);
    const svg = ribbonSvg(page);
    await expect(svg).toBeVisible();
    await svg.scrollIntoViewIfNeeded();

    const days = await scopeDays(page);
    const viewBoxWidth = await svg.evaluate(
      (node) => (node as SVGSVGElement).viewBox.baseVal.width
    );
    const slot = (viewBoxWidth - FLOW_PLOT_LEFT - FLOW_PLOT_RIGHT) / days;
    // 从今天往回数的第 5 个 band。夹具只填最近 20 天 + 今天，窗口开头的几天
    // 没有 token（悬停只会出现「这一天没有用量记录」），所以取有读数的日子。
    const day = days - 5;
    const expectedX = FLOW_PLOT_LEFT + (day + 0.5) * slot;
    const point = await svgUserPointToPage(
      svg,
      expectedX,
      FLOW_PLOT_TOP + FLOW_LANE_HEIGHT / 2
    );

    await page.mouse.move(point.x, point.y);

    await expect(svg).toHaveAttribute("data-ribbon-cursor-day", String(day));

    const cursor = card.locator("[data-ribbon-cursor]");
    await expect(cursor).toHaveCount(1);
    expect(Number(await cursor.getAttribute("x1"))).toBeCloseTo(expectedX, 1);

    // 每条河一个点（值为 0 也画在基线上，跨天位置稳定）。
    await expect(card.locator("[data-ribbon-dot]")).toHaveCount(5);

    const tip = page.locator("[data-ribbon-tooltip]");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveAttribute("aria-hidden", "true");

    const rows = tip.locator("[data-ribbon-tooltip-row]");
    await expect(rows).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      const row = rows.nth(index);
      // 结构与非空，不按具体金额：每行有 token 读数与占比。
      await expect(row).toContainText("token");
      await expect(row).toContainText(/\d/);
      await expect(row).toContainText(/%/);
    }

    const tipBox = await tip.boundingBox();
    const viewport = page.viewportSize();
    expect(tipBox, "tooltip 没有布局盒").not.toBeNull();
    expect(viewport, "视口尺寸不可用").not.toBeNull();
    // 组件按 8px 边距翻转 / 夹取，舍入留 0.5px 余量。
    expect(tipBox!.x).toBeGreaterThanOrEqual(7.5);
    expect(tipBox!.y).toBeGreaterThanOrEqual(7.5);
    expect(tipBox!.x + tipBox!.width).toBeLessThanOrEqual(viewport!.width - 7.5);
    expect(tipBox!.y + tipBox!.height).toBeLessThanOrEqual(viewport!.height - 7.5);
  });

  test("点击第 2 条河：选中、其余 4 条降级；再点与 Escape 都清除", async ({ page }) => {
    await openLab(page);
    const card = ribbonCard(page);
    const svg = ribbonSvg(page);
    await expect(svg).toBeVisible();

    const secondKey = await card
      .locator("[data-ribbon-lane]")
      .nth(1)
      .getAttribute("data-ribbon-lane");
    expect(secondKey, "第 2 条河没有 key").toBeTruthy();

    // 点左栏（x < PLOT_LEFT）：命中带同样覆盖这一段，但不会出现悬停游标与点，
    // 避免点击落在游标点上而漏掉选河。
    const hit = card.locator("[data-ribbon-hit]").nth(1);
    const gutter = { x: 100, y: FLOW_LANE_HEIGHT / 2 + 4 };

    await hit.click({ position: gutter });
    await expect(svg).toHaveAttribute("data-ribbon-selected", secondKey!);
    await expect(card.locator("[data-ribbon-dim]")).toHaveCount(4);
    await expect(laneEdges(page)).toHaveCount(5);

    // 再点同一条：取消。
    await hit.click({ position: gutter });
    await expect(svg).not.toHaveAttribute("data-ribbon-selected", secondKey!);
    await expect(card.locator("[data-ribbon-dim]")).toHaveCount(0);

    // 选中后窗口级 Escape 也能清除（不需要图先获得焦点）。
    await hit.click({ position: gutter });
    await expect(svg).toHaveAttribute("data-ribbon-selected", secondKey!);
    await page.keyboard.press("Escape");
    await expect(svg).not.toHaveAttribute("data-ribbon-selected", secondKey!);
    await expect(card.locator("[data-ribbon-dim]")).toHaveCount(0);
  });

  test("键盘：Tab 进入、方向键移动、Enter 锁定、Escape 取消", async ({ page }) => {
    await openLab(page);
    const card = ribbonCard(page);
    const svg = ribbonSvg(page);
    await expect(svg).toBeVisible();

    const group = card.locator("[data-ribbon-group]");
    const days = await scopeDays(page);

    // 从紧邻的「实验室」标签起 Tab：整张图只有一个 Tab 停点，进入后焦点环
    // 落在第 1 条河。不用点击聚焦——点击选河不该抢走键盘焦点（规格 §4.2）。
    await page.getByRole("tab", { name: "实验室", exact: true }).focus();

    let reached = false;
    for (let press = 0; press < 120; press += 1) {
      await page.keyboard.press("Tab");
      if (await group.evaluate((node) => node === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached, "Tab 应能到达河流图（整图一个停点）").toBe(true);

    const ring = card.locator("[data-ribbon-focus-ring]");
    await expect(ring).toHaveCount(1);
    // 焦点环画在第 1 条河的整行 band 上：y = flowLaneTop(0) - 3。
    expect(Number(await ring.getAttribute("y"))).toBe(FLOW_PLOT_TOP - 3);

    // 规格 §4.3：焦点进入时游标默认落在今天（窗口最后一天），并显示焦点环与
    // tooltip。这里不按任何方向键，直接验聚焦后的初始状态——聚焦引起的滚动
    // 不得把游标收掉。
    await expect(svg).toHaveAttribute("data-ribbon-cursor-day", String(days - 1));
    await expect(card.locator("[data-ribbon-cursor]")).toHaveCount(1);
    await expect(page.locator("[data-ribbon-tooltip]")).toBeVisible();

    // 方向键从今天（窗口最后一天）往回走：Home 跳到第 1 天，ArrowRight +1。
    await page.keyboard.press("Home");
    await expect(svg).toHaveAttribute("data-ribbon-cursor-day", "0");
    await page.keyboard.press("ArrowRight");
    await expect(svg).toHaveAttribute("data-ribbon-cursor-day", "1");

    // ArrowDown 换到第 2 条河：焦点环跟着下行一个 pitch。
    await page.keyboard.press("ArrowDown");
    await expect(ring).toHaveAttribute("y", String(FLOW_PLOT_TOP + FLOW_LANE_PITCH - 3));

    const secondKey = await card
      .locator("[data-ribbon-lane]")
      .nth(1)
      .getAttribute("data-ribbon-lane");
    expect(secondKey, "第 2 条河没有 key").toBeTruthy();

    await page.keyboard.press("Enter");
    await expect(svg).toHaveAttribute("data-ribbon-selected", secondKey!);
    await expect(card.locator("[data-ribbon-live]")).toContainText("已锁定");

    await page.keyboard.press("Escape");
    await expect(svg).not.toHaveAttribute("data-ribbon-selected", secondKey!);
    await expect(card.locator("[data-ribbon-dim]")).toHaveCount(0);
  });
});

test.describe("项目流量 · 空场景", () => {
  test.use({ scenario: emptyScenario() });

  test("无会话：data-ribbon-empty=no-sessions，且不画空坐标系", async ({ page }) => {
    // 与 lab.spec.ts 的空态写法一致：预先落在 lab 档，避免整页空态盖住卡片。
    await page.addInitScript(() => {
      localStorage.setItem("cca-usage-view", "lab");
    });

    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览", exact: true }).click();
    await expect(page.locator("[data-probe='lab-view']")).toBeVisible({ timeout: 15_000 });

    const card = ribbonCard(page);
    await expect(card.locator("[data-ribbon-empty]")).toHaveAttribute(
      "data-ribbon-empty",
      "no-sessions"
    );
    await expect(card).toContainText("所选范围内没有会话");
    await expect(card.locator("svg[data-probe='ribbon-chart']")).toHaveCount(0);
  });
});

test.describe("项目流量 · 130% 字号", () => {
  test.use({ scenario: roundFFScenario() });

  test("x 标签不相交、项目名不越界、图高仍按河道数固定", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cca-font-scale", "1.3");
    });

    await openLab(page);
    const card = ribbonCard(page);
    const svg = ribbonSvg(page);
    await expect(svg).toBeVisible();

    const fontScale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim()
    );
    expect(fontScale).toBe("1.3");

    // x 标签：按包围盒排序后相邻两两不相交（等价于全体两两不相交）。
    const ticks = await card.locator("[data-ribbon-x-tick]").evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, text: node.textContent ?? "" };
      })
    );
    expect(ticks.length).toBeGreaterThan(1);
    const sorted = [...ticks].sort((a, b) => a.left - b.left);
    for (let index = 1; index < sorted.length; index += 1) {
      expect(
        sorted[index].left,
        `x 标签「${sorted[index - 1].text}」与「${sorted[index].text}」在 130% 下相交`
      ).toBeGreaterThanOrEqual(sorted[index - 1].right - 0.5);
    }

    // 项目名在左栏内截断，不越过 x=184 的右界（换回 SVG 用户坐标再比）。
    const names = await card.locator("[data-ribbon-name]").evaluateAll((nodes) => {
      const owner = (nodes[0] as SVGTextElement).ownerSVGElement;
      if (!owner) throw new Error("项目名不在 SVG 里");
      const svgRect = owner.getBoundingClientRect();
      const scale = svgRect.width / owner.viewBox.baseVal.width;
      return nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          right: (rect.right - svgRect.left) / scale,
          text: node.textContent ?? ""
        };
      });
    });
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name.right, `项目名「${name.text}」越过 x=${FLOW_NAME_RIGHT}`).toBeLessThanOrEqual(
        FLOW_NAME_RIGHT + 0.5
      );
    }

    // 几何不随字号缩放：viewBox / 渲染高度都仍是 44 × 河道数 + 28。
    const laneCount = await card.locator("[data-ribbon-lane]").count();
    const expectedHeight = FLOW_LANE_PITCH * laneCount + FLOW_AXIS_LABEL_ROOM;
    const metrics = await svg.evaluate((node) => {
      const element = node as SVGSVGElement;
      return {
        viewBoxHeight: element.viewBox.baseVal.height,
        renderedHeight: element.getBoundingClientRect().height
      };
    });
    expect(metrics.viewBoxHeight).toBe(expectedHeight);
    expect(metrics.renderedHeight).toBeCloseTo(expectedHeight, 0);
  });
});

test.describe("项目流量 · 主题", () => {
  test.use({ scenario: roundFFScenario() });

  test("切到深色：面积仍引用 --chart-N-soft", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("cca-theme", "light");
    });

    await openLab(page);
    const card = ribbonCard(page);
    const svg = ribbonSvg(page);
    await expect(svg).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
    await page.getByRole("button", { name: "切换主题" }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");

    // 面积填充是令牌引用，不是写死的色值——换主题只换令牌。
    const fills = await card.locator("[data-ribbon-lane] > path").evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute("fill"))
        .filter((fill): fill is string => fill !== null && fill !== "none")
    );
    expect(fills).toHaveLength(5);
    for (const fill of fills) {
      expect(fill).toMatch(/^var\(--chart-[1-6]-soft\)$/);
    }
  });

  test("高对比度：顶边 2px，SVG 内没有 opacity / fill-opacity / color-mix", async ({
    page
  }) => {
    await openLab(page);
    const svg = ribbonSvg(page);
    await expect(svg).toBeVisible();

    await page.getByRole("button", { name: "设置" }).click();
    const contrast = page.getByRole("radiogroup", { name: "界面对比度" });
    await expect(contrast).toBeVisible();
    await contrast.getByRole("radio", { name: "高对比度" }).click();
    await expect(contrast.getByRole("radio", { name: "高对比度" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    await page.getByRole("button", { name: "关闭" }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.contrast))
      .toBe("high");

    // 高对比度要的是确定边界：每条河的顶边都加粗到 2px。
    const edges = laneEdges(page);
    await expect(edges).toHaveCount(5);
    for (let index = 0; index < 5; index += 1) {
      await expect(edges.nth(index)).toHaveAttribute("stroke-width", "2");
    }

    // 颜色与体量都不靠叠透明度 / color-mix（最低系统 WKWebView 不认后者）。
    const findings = await svg.evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll("*"))];
      const out: string[] = [];
      for (const node of nodes) {
        if (node.hasAttribute("opacity")) out.push(`${node.nodeName}: opacity`);
        if (node.hasAttribute("fill-opacity")) out.push(`${node.nodeName}: fill-opacity`);
        for (const attribute of Array.from(node.attributes)) {
          if (attribute.value.includes("color-mix")) {
            out.push(`${node.nodeName}: ${attribute.name} 含 color-mix`);
          }
        }
      }
      return out;
    });
    expect(findings).toEqual([]);
  });
});
