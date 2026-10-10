import type { Page } from "@playwright/test";
import { test, expect, recentActivityScenario } from "./fixtures";

/**
 * 菜单栏 / 托盘常驻读数的端到端。
 *
 * 这一条要在**真实边界**上验证两件事：读数真的以正确的命令名与 payload 推给了
 * Rust；设置里的开关真的触发 set_tray_visible。桩把命令记在 `__CCA_E2E_LOG__`，
 * 所以断言读的就是生产代码发出的东西。
 *
 * 场景是 `recentActivityScenario`（夹具整体平移到「最新活动 = 昨天」）再加一个
 * **贴近当下的 mtime**：托盘按文件 mtime 收窄扫描，而 stat 桩缺省给的是一个固定
 * 旧值——不给近期 mtime，一份会话都不会被解析，读数永远是空的，断言也就空转。
 */
test.use({ scenario: recentActivityScenario({ statMtimeMs: Date.now() }) });

type LogEntry = { op: string; args: unknown[] };

function trayReadouts(page: Page): Promise<unknown[]> {
  return page.evaluate(() =>
    (
      (window as unknown as { __CCA_E2E_LOG__?: LogEntry[] }).__CCA_E2E_LOG__ ?? []
    )
      .filter((entry) => entry.op === "update_tray_readout")
      .map((entry) => (entry.args[0] as { readout: unknown }).readout)
  );
}

function setVisibleCalls(page: Page): Promise<unknown[]> {
  return page.evaluate(() =>
    (
      (window as unknown as { __CCA_E2E_LOG__?: LogEntry[] }).__CCA_E2E_LOG__ ?? []
    )
      .filter((entry) => entry.op === "set_tray_visible")
      .map((entry) => (entry.args[0] as { visible: unknown }).visible)
  );
}

type TrayReadout = {
  block: {
    usedTokens: number;
    percent: number | null;
    startsAt: number;
    endsAt: number;
  } | null;
  weekly: { usedTokens: number; percent: number | null; days: number };
  computedAt: number;
  hasEstimate: boolean;
};

test.describe("常驻读数", () => {
  test("加载后把 5 小时 / 滚动 7 天读数推给 Rust，数字与夹具同源", async ({ page }) => {
    await page.goto("/");

    // 首跳是异步的（列目录 → stat → 解析 → 推送），等 mock 里真的出现读数。
    await expect
      .poll(async () => (await trayReadouts(page)).length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const readout = (await trayReadouts(page)).at(-1) as TrayReadout;

    // 契约里三个必备字段的形状。
    expect(typeof readout.computedAt).toBe("number");
    expect(readout.computedAt).toBeGreaterThan(0);
    expect(typeof readout.hasEstimate).toBe("boolean");
    expect(readout.weekly.days).toBe(7);
    expect(typeof readout.weekly.usedTokens).toBe("number");
    // 未设预算 → 没有分母就没有比率，percent 必须是 null 而不是 0。
    expect(readout.weekly.percent).toBeNull();

    // 周窗口与用量页「滚动 7 天」是同一个数：同一批夹具走同一批纯函数。
    expect(readout.weekly.usedTokens).toBe(246_130);

    // 夹具的最新活动在昨天 → 当前块存在，只是窗口已关闭；读数仍要给消耗。
    expect(readout.block).not.toBeNull();
    expect(typeof readout.block?.usedTokens).toBe("number");
    expect(typeof readout.block?.startsAt).toBe("number");
    expect(typeof readout.block?.endsAt).toBe("number");
    expect(readout.block?.percent).toBeNull();
  });

  test("设置里的「显示用量读数」开关触发 set_tray_visible", async ({ page }) => {
    await page.goto("/");

    // 挂载时就先推一次当前值（默认开）。
    await expect
      .poll(async () => (await setVisibleCalls(page)).length, { timeout: 15_000 })
      .toBeGreaterThan(0);
    expect((await setVisibleCalls(page)).at(-1)).toBe(true);

    await page.getByRole("button", { name: "设置" }).click();
    const toggle = page.getByRole("checkbox", { name: "显示用量读数" });
    await expect(toggle).toBeChecked();
    // 关闭态的补充说明只在关闭后出现（照「启用本地归档」那条的写法）。
    await expect(page.getByText(/关掉只是不显示读数/)).toHaveCount(0);
    await toggle.uncheck();

    await expect.poll(async () => (await setVisibleCalls(page)).at(-1)).toBe(false);
    await expect(page.getByText(/关掉只是不显示读数/)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("cca-tray-visible"))).toBe("false");
  });
});
