import { test, expect, defaultScenario } from "./fixtures";

/**
 * 时间胶囊（Issue #325）端到端：
 *
 * 1. 机器上有一份「100 天前」的会话时，胶囊卡出现并写清相对时间；
 * 2. 卡片里不能出现绝对路径（会被截图与转发）；
 * 3. 没有可比的历史日时整卡不渲染（默认场景的固定日期与今天差太远）。
 *
 * 夹具时间必须**相对现在**构造：胶囊的三个候选是去年同日 / 上月同日 /
 * 100 天前，写死日期只会在某几天碰巧命中。
 */

const DAY = 86_400_000;

function sessionAt(atMs: number, id: string): string {
  const iso = new Date(atMs).toISOString();
  return (
    JSON.stringify({
      type: "user",
      sessionId: id,
      cwd: "/repo/capsule",
      uuid: `${id}-u`,
      parentUuid: null,
      timestamp: iso,
      version: "2.1.0",
      message: { role: "user", content: "一百天前的那次调试" }
    }) +
    "\n" +
    JSON.stringify({
      type: "assistant",
      sessionId: id,
      cwd: "/repo/capsule",
      uuid: `${id}-a`,
      parentUuid: `${id}-u`,
      timestamp: new Date(atMs + 30_000).toISOString(),
      version: "2.1.0",
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "好" }],
        usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
      }
    }) +
    "\n"
  );
}

test.use({
  scenario: defaultScenario({
    files: {
      "/Users/e2e/.claude/projects/-repo-capsule/capsule-0001.jsonl": sessionAt(
        Date.now() - 100 * DAY,
        "capsule-0001"
      )
    }
  })
});

test("时间胶囊：100 天前的记录让卡片出现", { tag: "@time-capsule" }, async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "用量总览" }).click();

  const capsule = page.locator("[data-probe='time-capsule']");
  await expect(capsule).toBeVisible({ timeout: 15_000 });
  await expect(capsule).toContainText("100 天前");
  await expect(capsule).toContainText("1 个会话");

  // 转发红线：卡片里不能出现绝对路径或项目目录结构。
  const text = await capsule.innerText();
  expect(text).not.toContain("/Users/e2e");
  expect(text).not.toContain(".claude/projects");
});

test.describe("没有可比的历史日", () => {
  // 独立场景：默认夹具的日期与三个候选日都不重合，胶囊整卡不渲染。
  test.use({ scenario: defaultScenario() });

  test("时间胶囊：整卡不渲染", { tag: "@time-capsule" }, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "用量总览" }).click();
    await expect(page.getByText("Tokens 总量").first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("[data-probe='time-capsule']")).toHaveCount(0);
  });
});
