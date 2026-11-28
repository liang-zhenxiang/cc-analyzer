import type { Locator, Page } from "@playwright/test";
import { test, expect, handoffScenario } from "./fixtures";

/**
 * 项目接续（Issue #397）端到端：项目档的「切换条 → 接续 → 记忆」三块共用
 * 同一个项目 key，接续卡的轨道、间隔、回声、键盘与空态都在真实排版引擎里量。
 *
 * 夹具 `handoffScenario()`：handoff 项目 13 次会话（8 次早期填充 + 5 次主序列），
 * solo 项目 1 次会话。主序列覆盖同日 2 小时 / 次日 22 小时 / 3 天后 / 2 天后
 * 四种间隔、四种末动作、一对命中与一对未命中，最后一次在 2 分钟内。
 */

test.use({ scenario: handoffScenario() });

const HANDOFF_KEY = "-repo-handoff";
const SOLO_KEY = "-repo-solo";

async function openProjectView(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();
  await page.getByRole("tab", { name: "项目", exact: true }).click();
  const toolbar = page.locator("[data-probe='handoff-toolbar']");
  await expect(toolbar).toBeVisible({ timeout: 15_000 });
  return toolbar;
}

async function selectProject(page: Page, key: string) {
  await page.locator(`[data-handoff-project='${key}']`).click();
  const card = page.locator("[data-probe='project-handoff']");
  await expect(card).toBeVisible();
  return card;
}

async function selectedId(card: Locator): Promise<string | null> {
  return card.locator("[data-handoff-selected]").getAttribute("data-handoff-node");
}

test.describe("项目接续", () => {
  test("切换条与节点：数量、动作、间隔文案都与夹具一致，且没有绝对路径", async ({ page }) => {
    const toolbar = await openProjectView(page);

    // 两个项目，各自带窗口内的会话数。
    await expect(toolbar.locator("[data-handoff-project]")).toHaveCount(2);
    await expect(toolbar.locator(`[data-handoff-project='${HANDOFF_KEY}']`)).toContainText("13");
    await expect(toolbar.locator(`[data-handoff-project='${SOLO_KEY}']`)).toContainText("1");

    const card = await selectProject(page, HANDOFF_KEY);

    // 13 次会话默认画最近 12 个，隐藏 1 个。
    await expect(card.locator("[data-handoff-node]")).toHaveCount(12);
    await expect(card).toHaveAttribute("data-handoff-hidden", "1");
    await expect(card.locator('[data-probe="handoff-count"]')).toContainText("13 次会话");
    await expect(card.locator('[data-probe="handoff-toggle"]')).toHaveText("显示全部");

    // 四种末动作都在（动作拆成「动词 / 目标」两段渲染，只断言目标词）。
    await expect(card).toContainText("export-button.tsx");
    await expect(card).toContainText("npm test");
    await expect(card).toContainText("README.md");
    await expect(card).toContainText("无工具调用");

    // 间隔标签与像素值同源。
    const sameDay = card.locator("[data-handoff-gap]").filter({ hasText: "同日 · 2 小时后" });
    await expect(sameDay).toHaveCount(1);
    await expect(sameDay).toHaveAttribute("data-handoff-gap", String(2 * 3_600_000));

    const nextDay = card.locator("[data-handoff-gap]").filter({ hasText: "次日 · 22 小时后" });
    await expect(nextDay).toHaveCount(1);
    await expect(nextDay).toHaveAttribute("data-handoff-gap", String(22 * 3_600_000));

    const threeDays = card.locator("[data-handoff-gap]").filter({ hasText: /^3 天后$/ });
    await expect(threeDays).toHaveCount(1);
    await expect(threeDays).toHaveAttribute("data-handoff-gap", String(3 * 86_400_000));

    // 间隔标签数 = 可见节点数 - 1。
    await expect(card.locator("[data-handoff-gap]")).toHaveCount(11);

    // 转发红线：卡片里没有绝对路径，也没有编码目录名。
    const text = await card.innerText();
    expect(text).not.toContain("/Users");
    expect(text).not.toContain("/repo");
    expect(text).not.toContain("-repo-handoff");
  });

  test("回声：命中节点有空心圆、读数行给出百分比；未命中没有圆但仍有分数", async ({ page }) => {
    await openProjectView(page);
    const card = await selectProject(page, HANDOFF_KEY);

    // 只有 S2 命中（开头与 S1 结尾逐字相同 → 100%）。
    await expect(card.locator("[data-handoff-echo]")).toHaveCount(1);
    const hitNode = card
      .locator("[data-handoff-node]")
      .filter({ has: page.locator("[data-handoff-echo]") });
    await expect(hitNode).toHaveCount(1);
    await expect(hitNode).toContainText("npm test");

    await hitNode.click();
    const detail = card.locator('[data-probe="handoff-detail"]');
    await expect(detail).toBeVisible();
    await expect(card.locator('[data-probe="handoff-echo-line"]')).toContainText(
      "达到阈值 55%"
    );
    await expect(card.locator('[data-probe="handoff-opening"]')).toContainText(
      "导出按钮的禁用态修好之后，把测试补上"
    );
    await expect(card.locator('[data-probe="handoff-closing"]')).toContainText(
      "测试补完了，截图基线也更新了"
    );
    // 评分对象是「本次开头 vs 上一次结尾」——那句话必须能在屏幕上读到，
    // 否则两句不同的引文配一个 100% 会让人以为数是编的。
    await expect(card.getByText("上次结尾", { exact: true })).toBeVisible();
    await expect(card.locator('[data-probe="handoff-previous-closing"]')).toContainText(
      "导出按钮的禁用态修好之后，把测试补上"
    );

    // 未命中节点（S3，约 20%）：没有空心圆，读数行仍报出真实分数。
    const missNode = card.locator("[data-handoff-node]").filter({ hasText: "README.md" });
    await expect(missNode.locator("[data-handoff-echo]")).toHaveCount(0);
    await missNode.click();
    await expect(card.locator('[data-probe="handoff-echo-line"]')).toContainText(
      "低于阈值 55%"
    );
    await expect(card.locator("[data-handoff-echo]")).toHaveCount(1);
  });

  test("键盘：一个 Tab 止点；方向键 / Home / End 移动选中，Enter 打开会话", async ({ page }) => {
    await openProjectView(page);
    const card = await selectProject(page, HANDOFF_KEY);
    const track = card.locator('[data-probe="handoff-track"]');

    await track.focus();
    await expect(track).toBeFocused();

    const latest = await selectedId(card);
    expect(latest).not.toBeNull();

    await page.keyboard.press("ArrowLeft");
    const afterLeft = await selectedId(card);
    expect(afterLeft).not.toBe(latest);
    await expect(track).toHaveAttribute("aria-activedescendant", /./);

    await page.keyboard.press("End");
    await expect(card.locator("[data-handoff-selected]")).toHaveAttribute(
      "data-handoff-node",
      latest ?? ""
    );

    await page.keyboard.press("Home");
    const first = card.locator("[data-handoff-node]").first();
    await expect(first).toHaveAttribute("data-handoff-selected", "");
    // 方向键移动后节点被滚进视野（不是只改了状态）。
    const inView = await first.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const scroller = element.closest('[data-probe="handoff-track"]')?.parentElement;
      if (!scroller) return false;
      const view = scroller.getBoundingClientRect();
      return rect.left >= view.left - 1 && rect.right <= view.right + 1;
    });
    expect(inView).toBe(true);

    // Enter 走既有握手：切回会话分析并打开当前会话。
    await page.keyboard.press("Enter");
    await expect(page.getByRole("tab", { name: "会话分析", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // 会话图状态只在有会话打开时渲染——读到「已加载」即证明会话真的开了。
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
  });

  test("显示全部：13 个节点；收起时被隐藏的选中项回落到最右", async ({ page }) => {
    await openProjectView(page);
    const card = await selectProject(page, HANDOFF_KEY);
    const latest = await selectedId(card);

    await card.locator('[data-probe="handoff-toggle"]').click();
    await expect(card.locator("[data-handoff-node]")).toHaveCount(13);
    await expect(card).toHaveAttribute("data-handoff-hidden", "0");
    await expect(card.locator('[data-probe="handoff-toggle"]')).toHaveText("只看最近 12 次");

    // 选中展开后才出现的第一个节点（收起后它落在隐藏段）。
    const track = card.locator('[data-probe="handoff-track"]');
    await track.focus();
    await page.keyboard.press("Home");
    await expect(card.locator("[data-handoff-node]").first()).toHaveAttribute(
      "data-handoff-selected",
      ""
    );
    // 最早一条没有可对比的上一次：「上次结尾」整行不渲染。
    await expect(card.locator('[data-probe="handoff-previous-closing"]')).toHaveCount(0);

    await card.locator('[data-probe="handoff-toggle"]').click();
    await expect(card.locator("[data-handoff-node]")).toHaveCount(12);
    // 隐藏段里的选中项不会消失：回落到最右（最新）。
    await expect(card.locator("[data-handoff-selected]")).toHaveAttribute(
      "data-handoff-node",
      latest ?? ""
    );
  });

  test("窗口 7 / 90 天：卡片重算；7 天下的单会话项目不画轨道", async ({ page }) => {
    await openProjectView(page);
    await page.getByRole("tablist", { name: "时间范围" }).getByRole("tab", { name: "近 7 天" }).click();

    const card = await selectProject(page, SOLO_KEY);
    await expect(card.locator('[data-handoff-empty="single-session"]')).toBeVisible();
    await expect(card.locator('[data-probe="handoff-track"]')).toHaveCount(0);
    await expect(card.getByRole("button", { name: "打开会话 →" })).toBeVisible();
    await expect(card).toContainText("这个项目在窗口内只有一次会话，没有接续可看。");

    // 90 天：会话重新进窗，默认仍只画最近 12 个，展开后 13 个。
    await page.getByRole("tablist", { name: "时间范围" }).getByRole("tab", { name: "近 90 天" }).click();
    const wide = await selectProject(page, HANDOFF_KEY);
    await expect(wide.locator("[data-handoff-node]")).toHaveCount(12);
    await wide.locator('[data-probe="handoff-toggle"]').click();
    await expect(wide.locator("[data-handoff-node]")).toHaveCount(13);
  });

  test("130% 字号：节点几何不缩放、轨道可横向滚动、页面不横向溢出", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    await page
      .getByRole("radiogroup", { name: "界面字号" })
      .getByRole("radio", { name: "130%" })
      .click();
    await page.getByRole("button", { name: "关闭" }).click();

    await openProjectView(page);
    const card = await selectProject(page, HANDOFF_KEY);

    // 节点宽仍是 176（几何不随字号缩放），标题字号跟着 130% 走。
    const node = card.locator("[data-handoff-node]").first();
    const metrics = await node.evaluate((element) => {
      const title = element.querySelector<HTMLElement>('[class*="nodeTitle"]');
      const rect = element.getBoundingClientRect();
      return {
        width: rect.width,
        titleFontSize: title ? getComputedStyle(title).fontSize : ""
      };
    });
    expect(Math.round(metrics.width)).toBe(176);
    expect(parseFloat(metrics.titleFontSize)).toBeCloseTo(15.6, 1);

    // 轨道自己横向滚动，页面没有横向溢出。
    const scrollable = await card
      .locator('[data-probe="handoff-track"]')
      .evaluate((element) => {
        const scroller = element.parentElement;
        return scroller ? scroller.scrollWidth > scroller.clientWidth : false;
      });
    expect(scrollable).toBe(true);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // 相邻节点不重叠；间隔标签彼此不重叠。
    const overlaps = await card.evaluate((element) => {
      const nodes = [...element.querySelectorAll("[data-handoff-node]")].map((node) =>
        node.getBoundingClientRect()
      );
      const labels = [...element.querySelectorAll("[data-handoff-gap]")].map((label) =>
        label.getBoundingClientRect()
      );
      const hit = (a: DOMRect, b: DOMRect) =>
        a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      let nodeHit = false;
      for (let i = 0; i < nodes.length - 1; i += 1) {
        if (hit(nodes[i], nodes[i + 1])) nodeHit = true;
      }
      let labelHit = false;
      for (let i = 0; i < labels.length - 1; i += 1) {
        if (hit(labels[i], labels[i + 1])) labelHit = true;
      }
      return { nodeHit, labelHit };
    });
    expect(overlaps.nodeHit).toBe(false);
    expect(overlaps.labelHit).toBe(false);

    // 表头不横向溢出。
    const headerFits = await card.locator("header").evaluate((element) => {
      return element.scrollWidth <= element.clientWidth + 1;
    });
    expect(headerFits).toBe(true);

    // 三行引文 + 脚注在 130% 下仍完整：卡片高度由内容决定，不裁字、不出
    // 卡内纵向滚动条。
    await expect(card.locator('[data-probe="handoff-previous-closing"]')).toBeVisible();
    await expect(card.locator('[data-probe="handoff-echo-line"]')).toBeVisible();
    await expect(card.locator('[class*="footnote"]')).toContainText(
      "节点之间是相邻两次会话的开始时刻之差"
    );
    const clipped = await card.evaluate(
      (element) => element.scrollHeight > element.clientHeight + 1
    );
    expect(clipped).toBe(false);
  });

  test("深色与高对比度：基线与空心圆仍可见，空心圆加粗到 2px", async ({ page }) => {
    await openProjectView(page);
    const card = await selectProject(page, HANDOFF_KEY);

    const baselineColor = () =>
      card.locator('[class*="baseline"]').evaluate((element) => {
        return getComputedStyle(element).backgroundColor;
      });
    const ringColor = () =>
      card.locator("[data-handoff-echo]").evaluate((element) => {
        return getComputedStyle(element).borderTopColor;
      });

    expect(await baselineColor()).not.toBe("rgba(0, 0, 0, 0)");
    expect(await ringColor()).not.toBe("rgba(0, 0, 0, 0)");

    await page.getByRole("button", { name: "切换主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    expect(await baselineColor()).not.toBe("rgba(0, 0, 0, 0)");
    expect(await ringColor()).not.toBe("rgba(0, 0, 0, 0)");

    // 高对比度：基线改用实色 --border；空心圆加粗到 2px。
    await page.getByRole("button", { name: "设置" }).click();
    await page
      .getByRole("radiogroup", { name: "界面对比度" })
      .getByRole("radio", { name: "高对比度" })
      .click();
    await page.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
    expect(await baselineColor()).not.toBe("rgba(0, 0, 0, 0)");
    const ringWidth = await card
      .locator("[data-handoff-echo]")
      .evaluate((element) => getComputedStyle(element).borderTopWidth);
    expect(parseFloat(ringWidth)).toBeGreaterThanOrEqual(2);
  });
});
