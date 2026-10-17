import type { Page } from "@playwright/test";
import {
  test,
  expect,
  PULSE_LIVE_SESSION_PATH,
  pulseScenario,
  pulseUsageAppendText
} from "./fixtures";
import type { CcaE2EHooks } from "./tauri-mock";

/**
 * 「实时脉搏」的端到端（Issue #203，R1 / R6 / R7 与两条验收标准）。
 *
 * 这一层跑在**生产构建产物**上，且借桩的 `__CCA_E2E_APPEND_FILE__` 让虚拟会话
 * 「在两拍之间长一截」——这条路径在单测里做不到（jsdom 不做调度，也读不到文件）。
 *
 * 场景统一用 `pulseScenario()`：三个会话按 mtime 分成 live / recent / idle 三档，
 * 时间戳相对 `Date.now()` 现算——用固定日期的默认场景会让 5 小时窗口与三档
 * 新近度随日历漂移，断言会以「没渲染」这种毫无线索的方式假红。
 */
test.use({ scenario: pulseScenario() });

type LogEntry = { op: string; args: unknown[] };

/** 读桩的调用记账；只本文件用，名字与桩的 `__CCA_E2E_LOG__` 契约一致。 */
function invokeLog(page: Page): Promise<LogEntry[]> {
  return page.evaluate(
    () => (window as unknown as { __CCA_E2E_LOG__?: LogEntry[] }).__CCA_E2E_LOG__ ?? []
  );
}

async function countOp(page: Page, op: string): Promise<number> {
  return (await invokeLog(page)).filter((entry) => entry.op === op).length;
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
}

/**
 * 一个格式化的 token 文案 → 原始整数。
 *
 * 用量总览的表盘只渲染 `formatTokenCount()` 的结果（`1,234,567` / `1.2M`），
 * 而脉搏读数把原始整数放在 `title` 里。这里把两边都变成**数字**再比——
 * 直接比格式化串会在 ≥1M 的档位上把「1.2M 与 1.299M」读成相等，是假的绿。
 * 本夹具的总量 < 100 万，表盘文案就是完整的分组整数，解析无损——调用方另有
 * 「脉搏原始值 < 100 万」的守卫，夹具涨过这条线时会当场红，而不是悄悄比错。
 */
function parseTokenText(text: string | null): number {
  const digits = (text ?? "").replace(/[,\s]/g, "");
  expect(digits, `表盘读数不是分组整数：${JSON.stringify(text)}`).toMatch(/^\d+$/);
  return Number(digits);
}

async function openPulse(page: Page) {
  await page.getByRole("tab", { name: "实时监控" }).click();
  const pulse = page.locator("[data-probe='pulse-page']");
  await expect(pulse).toHaveAttribute("data-state", "fresh", { timeout: 15_000 });
  return pulse;
}

test.describe("实时脉搏 · 默认档与零探测", () => {
  test("切到实时监控默认渲染脉搏，且不调用 monitor_port / monitor_ping", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "实时监控" }).click();

    const pulse = page.locator("[data-probe='pulse-page']");
    await expect(pulse).toHaveAttribute("data-state", "fresh", { timeout: 15_000 });
    // 非浮窗态的页头在场、浮窗细头缺席。
    await expect(page.locator("[data-probe='pulse-head']")).toBeVisible();
    await expect(page.locator("[data-probe='pulse-float-head']")).toHaveCount(0);

    // R1 的硬事实：原生脉搏挂载一个字节都不碰外部仪表盘的两个探针。
    expect(await countOp(page, "monitor_port")).toBe(0);
    expect(await countOp(page, "monitor_ping")).toBe(0);
  });
});

test.describe("实时脉搏 · 跨标签数字一致", () => {
  test("脉搏「5 小时窗口 · 已用」与用量总览表盘逐位相等", async ({ page }) => {
    await page.goto("/");
    await openPulse(page);

    // 脉搏侧的原始值：读数容器的 title 就是未格式化的整数（组件把它写死给测试与真机用）。
    const raw = await page
      .locator("[data-readout='used'] b")
      .getAttribute("title");
    expect(raw).not.toBeNull();
    const pulseUsed = Number(raw);
    expect(Number.isInteger(pulseUsed)).toBe(true);
    // 守卫：夹具总量必须落在「表盘文案 = 完整分组整数」的区间，解析才无损。
    expect(pulseUsed).toBeGreaterThan(0);
    expect(pulseUsed).toBeLessThan(1_000_000);

    await page.getByRole("tab", { name: "用量总览" }).click();
    await expect(page.getByText(/纳入统计/)).toBeVisible({ timeout: 15_000 });

    const gauge = page.locator("[data-probe='gauge']");
    await expect(gauge).toBeVisible();
    // 表盘环心那个数（`<text>` 的第一个）就是「本窗口消耗」的原始读数。
    const usageUsed = parseTokenText(await gauge.locator("text").first().textContent());

    expect(usageUsed).toBe(pulseUsed);
  });
});

test.describe("实时脉搏 · 文件增长后一拍内更新", () => {
  test("追加一条 usage 记录后无需任何操作，读数在一拍内跟上", async ({ page }) => {
    await page.goto("/");
    await openPulse(page);

    const used = page.locator("[data-readout='used'] b");
    const before = Number(await used.getAttribute("title"));
    expect(Number.isInteger(before)).toBe(true);

    // 往正在被写的会话尾部追加一条真实结构的 usage 记录（模拟 Claude Code 的写入）。
    const at = Date.now();
    const text = pulseUsageAppendText(at);
    await page.evaluate(
      ({ path, contents }) => {
        (window as unknown as CcaE2EHooks).__CCA_E2E_APPEND_FILE__(path, contents);
      },
      { path: PULSE_LIVE_SESSION_PATH, contents: text }
    );

    // FAST_TICK_MS 是 5 秒：给足四拍的时间，全程不碰页面。
    await expect
      .poll(async () => Number(await used.getAttribute("title")), {
        timeout: 20_000,
        intervals: [500, 1_000, 2_000]
      })
      .toBeGreaterThan(before);

    const after = Number(await used.getAttribute("title"));
    // 增量必须正好是追加那条记录的四个计数器之和——不多读一份、不漏算一类。
    expect(after - before).toBe(320 + 260 + 2_400 + 9_800);
  });
});

test.describe("实时脉搏 · 浮窗往返", () => {
  test("悬浮 → 细头在场 / 顶栏收起 → 420 无横向溢出 → 退出恢复", async ({ page }) => {
    await page.goto("/");
    await openPulse(page);

    await expect(page.locator("[data-probe='pulse-head']")).toBeVisible();
    await expect(page.locator("[data-probe='pulse-float-head']")).toHaveCount(0);
    expect(await countOp(page, "plugin:float|enter")).toBe(0);

    await page.getByRole("button", { name: "悬浮" }).click();

    const floatHead = page.locator("[data-probe='pulse-float-head']");
    await expect(floatHead).toBeVisible();
    await expect(floatHead).toHaveAttribute("data-tauri-drag-region", "deep");
    // 「悬浮」必须**同时**切版式与调窗口命令：只切版式会得到「版式是浮窗、窗口
    // 还是 1400×872」的四不像（2026-10-15 真机门禁抓到的缺陷，这条钉死它），
    // 而调两次就是同一件事跑了两遍。恰好 1 次。
    expect(await countOp(page, "plugin:float|enter")).toBe(1);
    // 浮窗态收起页头与整条顶栏：工作区标签、设置按钮都不在。
    await expect(page.locator("[data-probe='pulse-head']")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "会话分析" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "设置" })).toHaveCount(0);
    await expect(page.locator("[data-probe='pulse-float-exit']")).toBeVisible();

    // 主窗宽度：浮窗态仍不横向溢出。
    const wide = await horizontalOverflow(page);
    expect(wide.scrollWidth).toBeLessThanOrEqual(wide.clientWidth + 1);

    // 真实浮窗尺寸（后端常量 420×620）：容器查询的紧凑档从这里才开始命中。
    await page.setViewportSize({ width: 420, height: 620 });
    await expect(floatHead).toBeVisible();
    const narrow = await horizontalOverflow(page);
    expect(narrow.clientWidth).toBe(420);
    expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.clientWidth + 1);

    // 退出浮窗：细头消失、页头回来。
    await page.locator("[data-probe='pulse-float-exit']").click();
    await expect(page.locator("[data-probe='pulse-float-head']")).toHaveCount(0);
    await expect(page.locator("[data-probe='pulse-head']")).toBeVisible();
    // 出与进对称：窗口命令恰好发过一次，不多不少。
    expect(await countOp(page, "plugin:float|exit")).toBe(1);
  });
});

test.describe("实时脉搏 · 外部仪表盘子视图保持 #55", () => {
  test("不自动探测、点「打开监控」才探测、失败态可重试", async ({ page }) => {
    await page.goto("/");
    await openPulse(page);

    await page.getByRole("tab", { name: "外部仪表盘" }).click();
    const open = page.getByRole("button", { name: "打开监控" });
    await expect(open).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);

    // 切进来只是「可以打开」：没有 ping（探测），与 #55 的行为逐字一致。
    expect(await countOp(page, "monitor_ping")).toBe(0);

    // 点了才探测；夹具里的外部服务连不上，稳定落在失败态（三次重试约 1.6s）。
    await open.click();
    const retry = page.getByRole("button", { name: "重试" });
    await expect(retry).toBeVisible({ timeout: 10_000 });
    const afterFirstProbe = await countOp(page, "monitor_ping");
    expect(afterFirstProbe).toBeGreaterThan(0);

    // 重试真的重新探测了一轮（命令计数增加），而不是只把文案复位。
    await retry.click();
    await expect(retry).toBeVisible({ timeout: 10_000 });
    expect(await countOp(page, "monitor_ping")).toBeGreaterThan(afterFirstProbe);
  });
});
