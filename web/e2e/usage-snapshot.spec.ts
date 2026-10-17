import type { Page } from "@playwright/test";
import { test, expect, recentActivityScenario, staleActivityScenario } from "./fixtures";

/**
 * 「用量总览导出为单文件 HTML 快照」的端到端闭环（Issue #149）：点页面上的
 * 「导出快照」→ 走既有保存桩 → 逐字符检查落到盘上的那份 HTML。
 *
 * 系统保存对话框没法在测试里点，但它在 `tauri-mock.ts` 的边界上被换成了确定的
 * 返回值与 `write_text` 桩——所以这里断言的仍然是真实构建产物走同一条
 * `plugin:dialog|save` → `write_text` 链路的行为，而不是「调用了某个函数」。
 *
 * 内容层有一条硬口径：屏幕上那个 KPI 数字必须原样出现在纸上（两份数字就是
 * 两套真相的开始），以及快照是要发出去的文件——本机的绝对路径一个字符都不许带。
 *
 * 「扫描中途禁用导出」这条刻意不测：夹具太少，渐进扫描（每 8 个会话发布一次）
 * 在 Playwright 能稳定观测到的时刻早已结束，硬塞一个「点下去时正好在扫」的断言
 * 只能靠拖慢扫描来造窗口，那是拿 flake 换覆盖率。这条分支由
 * `UsageOverviewPage.test.tsx` 的组件用例（可控的进度桩）与真机门禁的禁用态断言
 * 覆盖，两边都不依赖时序运气。
 */

const SAVED = "/Users/e2e/usage-snapshot-out.html";
const DASHBOARD = "用量总览";
const EXPORT_BUTTON = "导出用量快照（单文件 HTML）";

/** 快照的契约文案（Issue #149 评论里定死的原句；Round V / #187 补「消耗日历」）
 * ——写死在这里，改动必须显式，且与 usageSnapshot.ts 的 SNAPSHOT_SCOPE_NOTE 只有一个原文。 */
const SCOPE_NOTE =
  "本快照包含用量总览的读数与图表；不含消耗日历、工具与 skill 普查、压缩统计、错误档。";
const EMPTY_TITLE = "所选区间内没有会话记录";

function writtenFiles(page: Page) {
  return page.evaluate(() => {
    const log =
      (window as unknown as { __CCA_E2E_LOG__?: Array<{ op: string; args: unknown[] }> })
        .__CCA_E2E_LOG__ ?? [];
    return log
      .filter((entry) => entry.op === "write_text")
      .map((entry) => entry.args[0] as { path: string; contents: string });
  });
}

/** `plugin:dialog|save` 收到的参数（`defaultPath` 就是应用建议的文件名）。 */
function saveDialogNames(page: Page) {
  return page.evaluate(() => {
    const log =
      (window as unknown as { __CCA_E2E_LOG__?: Array<{ op: string; args: unknown[] }> })
        .__CCA_E2E_LOG__ ?? [];
    return log
      .filter((entry) => entry.op === "plugin:dialog|save")
      .map((entry) => {
        const options = (entry.args[0] as { options?: { defaultPath?: string } }).options ?? {};
        return options.defaultPath ?? "";
      });
  });
}

async function openUsageView(page: Page) {
  await page.goto("/");
  await page.getByRole("tab", { name: DASHBOARD }).click();
  await expect(page.getByLabel(DASHBOARD)).toBeVisible();
}

/**
 * 从 KPI 瓦片里读出数值。
 *
 * 按可见文本定位瓦片（不碰 CSS Module 类名）：瓦片里的三行是「标签 / 数值 /
 * 来源徽章」，数值那一行只有数字与千分位逗号，所以按这个形状取。
 */
async function kpiValue(page: Page, label: string): Promise<string> {
  const tile = page.getByLabel(DASHBOARD).getByText(label, { exact: true }).locator("..");
  const value = (await tile.innerText())
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^[\d,]+$/.test(line));
  expect(value, `KPI 瓦片里没读到数值：${label}`).toBeTruthy();
  return value ?? "";
}

test.describe("用量快照 · 正常导出", () => {
  test.use({ scenario: recentActivityScenario({ savePath: SAVED }) });

  test("保存后落盘一份自包含、无脚本、无绝对路径的快照", async ({ page }) => {
    await openUsageView(page);
    // 屏幕上那个数从页面读出来，再断言纸上有一模一样的字符串——不写死夹具数字。
    const tokens = await kpiValue(page, "Tokens 总量");
    // 形状守卫：读到的必须是一个格式化过的计数（防「读到空串 → 断言恒真」）。
    expect(tokens).toMatch(/^\d{1,3}(,\d{3})*$/);

    await page.getByRole("button", { name: EXPORT_BUTTON }).click();

    await expect(page.getByText("已导出用量快照")).toBeVisible();

    const files = await writtenFiles(page);
    const saved = files.at(-1);
    expect(saved?.path).toBe(SAVED);
    const html = saved?.contents ?? "";
    expect(html.startsWith("<!doctype html>")).toBe(true);

    // 文件名由应用建议（日期部分随运行日走，所以只锁形状）。
    expect((await saveDialogNames(page)).at(-1)).toMatch(
      /^cc-analyzer-usage-\d{4}-\d{2}-\d{2}\.html$/
    );

    // 页面上的读数与口径说明必须原样进产物。
    expect(html).toContain(tokens);
    expect(html).toContain("Tokens 总量");
    expect(html).toContain("读自本机日志");
    expect(html).toMatch(/估算成本按定价快照（\d{4}-\d{2}-\d{2}）/);
    expect(html).toContain(SCOPE_NOTE);
    expect(html).toContain("由 CC Analyzer 生成");

    // 自包含与隐私：不发出去的路径、不引外部资源、不带脚本。
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("src=");
    expect(html).not.toContain("/Users/");
    expect(html).not.toContain("/home/");
    expect(html).not.toContain(".jsonl");
    expect(html).not.toContain(".claude/projects");
  });
});

test.describe("用量快照 · 区间为空", () => {
  // 本机有会话、但全在窗口之外：页头照常渲染，区间里 0 个会话。
  test.use({ scenario: staleActivityScenario({ savePath: SAVED }) });

  test("区间里 0 个会话不是错误：按钮可用，导出的是空态文档", async ({ page }) => {
    await openUsageView(page);
    await expect(page.getByText("近 30 天内 0 个会话纳入统计")).toBeVisible();

    const button = page.getByRole("button", { name: EXPORT_BUTTON });
    await expect(button).toBeEnabled();
    await button.click();
    await expect(page.getByText("已导出用量快照")).toBeVisible();

    const html = (await writtenFiles(page)).at(-1)?.contents ?? "";
    expect(html).toContain(EMPTY_TITLE);
    expect(html).toContain("近 30 天内没有可统计的会话记录");
    // 没有记录 = 成本未知，不是 $0.00；也不该留半张空图或一排「暂无数据」。
    expect(html).not.toContain("$0.00");
    expect(html).not.toContain("$0.0000");
    expect(html).not.toContain("暂无数据");
    // 整篇空态：四张图与计费窗口整节都不该出现（标题是可见文本，不碰类名）。
    for (const title of ["每日 Token 消耗", "按项目分布", "按模型分布", "计费窗口"]) {
      expect(html).not.toContain(title);
    }
  });
});

test.describe("用量快照 · 用户取消", () => {
  test.use({ scenario: recentActivityScenario({ savePath: null }) });

  test("系统保存对话框返回 null 时既不写文件也不报错", async ({ page }) => {
    await openUsageView(page);
    await page.getByRole("button", { name: EXPORT_BUTTON }).click();

    // 先确认按钮真的走到了保存这一步（否则下面的「没写文件」可能只是没点着）。
    await expect.poll(async () => (await saveDialogNames(page)).length).toBe(1);
    await expect(page.getByText("已导出用量快照")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    // 只能断言「没有写快照」：扫描本身会把自己的元数据缓存写进 appData，
    // 那也是 `write_text`——按「写入了一份 HTML 文档」判才不会误伤。
    const snapshots = (await writtenFiles(page)).filter((file) =>
      file.contents.startsWith("<!doctype html>")
    );
    expect(snapshots).toHaveLength(0);
  });
});

test.describe("用量快照 · 入口只在用量档", () => {
  test.use({ scenario: recentActivityScenario() });

  test("切到错误档后导出按钮消失，切回用量档又出现", async ({ page }) => {
    await openUsageView(page);
    await expect(page.getByRole("button", { name: EXPORT_BUTTON })).toBeVisible();

    await page.getByRole("tab", { name: "错误", exact: true }).click();
    await expect(page.getByRole("button", { name: EXPORT_BUTTON })).toHaveCount(0);

    await page.getByRole("tab", { name: "用量", exact: true }).click();
    await expect(page.getByRole("button", { name: EXPORT_BUTTON })).toBeVisible();
  });
});
