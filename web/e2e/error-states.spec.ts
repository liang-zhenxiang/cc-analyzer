import type { Locator, Page } from "@playwright/test";
import { test, expect, brokenScanScenario, defaultScenario } from "./fixtures";

/**
 * 错误态：一处语义，按位置分档，一次失败只在一个地方说。
 *
 * 首屏就失败的场景跑在「会话目录一个字节都没声明」的真实错误路径上——这不是
 * 桩出来的文案，是应用真的报了错。两条红线的断言（绝对路径 / 维护者用语）
 * 也只有在这条路径上才有意义：好场景里根本没有那段文本可泄漏。
 */
test.use({ scenario: brokenScanScenario() });

/** 三处的共同结构：一句标题、一句可执行的下一步、一个重试。 */
async function expectErrorShape(alert: Locator) {
  await expect(alert).toBeVisible();
  await expect(alert.locator(":scope > strong")).toHaveCount(1);
  await expect(alert.locator(":scope > p")).toHaveCount(1);
  await expect(alert.getByRole("button", { name: "重试" })).toBeVisible();
}

/** 这一块的中点离它的容器中线有多远——「顶部对齐」这个缺陷的机器化表达。 */
async function centerOffset(inner: Locator, outer: Locator): Promise<number> {
  const innerBox = await inner.boundingBox();
  const outerBox = await outer.boundingBox();
  expect(innerBox).not.toBeNull();
  expect(outerBox).not.toBeNull();
  return Math.abs(
    innerBox!.y + innerBox!.height / 2 - (outerBox!.y + outerBox!.height / 2)
  );
}

/** 让下一次目录读取失败（见 tauri-mock 里的开关）。 */
async function breakScan(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__CCA_E2E_FAIL_SCAN__ = true;
  });
}

test.describe("整页错误态", () => {
  test("扫描失败时主区整页说明，一次失败只说一遍", async ({ page }) => {
    await page.goto("/");

    const alerts = page.getByRole("alert");
    await expect(alerts).toHaveCount(1);
    await expectErrorShape(alerts.first());
    await expect(alerts.first()).toContainText("会话列表读取失败");

    // 红线：正文里不得出现绝对用户路径，也不得出现写给维护者的话。
    const text = await alerts.first().innerText();
    expect(text).not.toContain("/Users/");
    expect(text).not.toContain("/home/");
    expect(text).not.toContain("夹具");
    expect(text).not.toContain("E2E 虚拟文件系统");
    expect(await alerts.first().evaluate((el) => el.innerHTML)).not.toContain("/Users/");

    // 「从左侧列表挑一个会话」在列表根本没读到时是一个做不到的建议。
    await expect(page.getByText("选择一个会话开始分析")).toHaveCount(0);
    await expect(page.getByText("没有匹配的会话")).toHaveCount(0);

    // 整页错误态落在主区中线上，与加载 / 空态同一个位置。
    expect(await centerOffset(alerts.first(), page.getByRole("main"))).toBeLessThan(30);
  });

  test("展开「详情」才看得到原始错误串", async ({ page }) => {
    await page.goto("/");

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("会话列表读取失败");
    // 折叠着就是「页面里没有」，不是「很难看见」。
    expect(await alert.textContent()).not.toContain("/Users/");

    await alert.getByText("详情").click();
    // 展开后必须真的能看到原文，否则上一条会以「什么都没渲染」的形式永远为真。
    // 这条同时验证受控 <details> 在真实浏览器里确实能开。
    await expect(alert).toContainText("/Users/e2e/.claude/projects");
  });

  test("用量总览：错误态与空/加载落在同一条中线上，正文不横跨整屏", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();

    const alert = page.getByRole("alert");
    await expectErrorShape(alert);
    await expect(alert).toContainText("会话列表读取失败");

    // 正文限宽：一整行横跨约 1000px 的灰字，眼睛找不到行首。
    // 断言的是**约束本身**作用在这个块上。只量宽度会是一条永远为真的断言：
    // 这段说明本来就撑不到 640px，限宽删掉它照样绿（实测过，这条因此改过一版）。
    const limit = parseFloat(await alert.evaluate((el) => getComputedStyle(el).maxWidth));
    expect(limit).toBeLessThanOrEqual(640);

    // 约束之下宽度才有意义：块宽即行长上限（说明是在这块里换行的）。
    const block = await alert.boundingBox();
    expect(block).not.toBeNull();
    expect(block!.width).toBeLessThanOrEqual(limit + 1);

    expect(await centerOffset(alert, page.getByRole("main"))).toBeLessThan(30);
  });

  test("实时监控：探测失败给出可执行的下一步，而不是维护者内部信息", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "实时监控" }).click();

    // 打开之前就要写清连的是哪个地址——这是「下一步做什么」里可执行的那半句。
    await expect(page.getByText(/本机 localhost:8090/)).toBeVisible();

    await page.getByRole("button", { name: "打开监控" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expectErrorShape(alert);
    await expect(alert).toContainText("未在 localhost:8090 上检测到监控仪表盘");
    await expect(alert).toContainText("确认该服务已在你自己的终端里启动，然后重试。");

    const text = await alert.innerText();
    expect(text).not.toContain("不在本仓库内");
    expect(text).not.toContain("夹具");
    expect(text).not.toContain("/Users/");

    // 与用量页同一个位置：独占主区时落在中线上，而不是顶在上沿。
    expect(await centerOffset(alert, page.getByRole("main"))).toBeLessThan(30);
  });
});

/**
 * 侧栏那条告警走的是另一条真实路径：**已经有一份列表，刷新却失败了**。
 * 首屏就失败时错误归主区（上面一组），此时列表里已经有会话在显示、
 * 主区被数据占着，错误就该落在它发生的地方——列表本身。
 */
test.describe("侧栏告警条", () => {
  // 先要有一份读得出来的列表，才谈得上「刷新失败」。
  test.use({ scenario: defaultScenario() });

  test("已经打开会话时刷新失败：告警落在侧栏，主区数据不被顶掉", async ({ page }) => {
    await page.goto("/");

    // `button[title]` 会先命中工具栏那颗图标按钮（IconButton 把可访问名绑到
// tooltip 上），所以必须再加 `:has(strong)`——与 smoke 的选择器一致。
    const sessionRows = page
      .getByLabel("会话列表", { exact: true })
      .locator("button[title]:has(strong)");
    await sessionRows.first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });

    await breakScan(page);
    await page.getByRole("button", { name: "刷新会话列表" }).click();

    const alerts = page.getByRole("alert");
    await expect(alerts).toHaveCount(1);
    await expectErrorShape(alerts.first());
    await expect(alerts.first()).toContainText("会话列表读取失败");

    // 窄列用左对齐的告警条，且不越过它所在的那一列。
    expect(await alerts.first().evaluate((el) => getComputedStyle(el).textAlign)).toBe("left");
    const sidebar = await page.getByLabel("会话列表", { exact: true }).boundingBox();
    const alertBox = await alerts.first().boundingBox();
    expect(alertBox!.width).toBeLessThanOrEqual(sidebar!.width);

    // 红线同样成立：正文里没有绝对路径、没有维护者用语。
    expect(await alerts.first().innerText()).not.toContain("/Users/");
    expect(await alerts.first().innerText()).not.toContain("夹具");

    // 主区还在显示那个会话——错误不会把数据顶掉。
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载");

    // 重试真的能恢复：关掉故障注入，点「重试」，告警消失、列表照旧。
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__CCA_E2E_FAIL_SCAN__ = false;
    });
    await alerts.first().getByRole("button", { name: "重试" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(sessionRows).not.toHaveCount(0);
  });
});