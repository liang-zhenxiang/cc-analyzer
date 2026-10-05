import type { Page } from "@playwright/test";
import { test, expect, defaultScenario } from "./fixtures";

/**
 * 本地归档的端到端：**读到**与**写到**两条路径。
 *
 * 读到：归档副本存在、而 `~/.claude` 里的原文件已被 Claude Code 清理时，
 * 会话必须仍然出现在列表里、能打开、带「归档」标记。
 *
 * 写到：设置里开启后点「立即归档」，真的把副本与索引写进应用数据目录
 * （这里断言的是桩收到的 `write_text` 路径与内容——与真实桥接同一段代码）。
 *
 * 用量总览不在这一页重复断言：它用的是同一个 `useSessions`（见
 * `features/usage/useUsageOverview.ts`），列表能看见就说明它也拿得到。
 */

const BUNDLE_APP_DATA =
  "/Users/e2e/Library/Application Support/io.github.liang-zhenxiang.cc-analyzer";
const ARCHIVE_ROOT = `${BUNDLE_APP_DATA}/archive`;
const GONE_SOURCE = "/Users/e2e/.claude/projects/-repo-gone/cleaned-up.jsonl";
const GONE_COPY = `${ARCHIVE_ROOT}/-repo-gone/cleaned-up.jsonl`;

/** 一份「源已被清理、只剩归档副本」的场景。 */
function archivedScenario(overrides = {}) {
  const base = defaultScenario(overrides);
  return {
    ...base,
    files: {
      ...base.files,
      // 副本本身是一份合法的会话记录：台账说明原文件已经不在了。
      [GONE_COPY]: [
        JSON.stringify({
          type: "user",
          sessionId: "cleaned-up-0001",
          cwd: "/repo/gone",
          timestamp: "2026-01-05T09:00:00.000Z",
          uuid: "gone-user-1",
          parentUuid: null,
          isSidechain: false,
          message: { role: "user", content: "三个月前的那次重构" }
        }),
        JSON.stringify({
          type: "assistant",
          sessionId: "cleaned-up-0001",
          timestamp: "2026-01-05T09:00:05.000Z",
          uuid: "gone-llm-1",
          parentUuid: "gone-user-1",
          isSidechain: false,
          message: {
            id: "gone-msg-1",
            role: "assistant",
            model: "claude-sonnet-4",
            content: [{ type: "text", text: "那次我们把解析器拆成了两层。" }],
            usage: { input_tokens: 30, output_tokens: 20 }
          }
        })
      ].join("\n"),
      [`${ARCHIVE_ROOT}/archive-index.json`]: JSON.stringify({
        version: 1,
        entries: {
          [GONE_SOURCE]: {
            sourcePath: GONE_SOURCE,
            archivePath: GONE_COPY,
            projectLabel: "-repo-gone",
            sessionId: "cleaned-up-0001",
            sizeBytes: 512,
            // 原始时间：列表的分组与相对时间要说「那次会话发生在什么时候」。
            mtimeMs: Date.UTC(2026, 0, 5, 9, 0, 5),
            archivedAt: Date.UTC(2026, 9, 4, 12, 0, 0)
          }
        }
      })
    }
  };
}

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

async function openArchivedSession(page: Page) {
  await page.goto("/");
  // 按项目目录过滤，收敛到唯一一条（-repo-gone）。
  await page.getByPlaceholder("搜会话 ID 或目录…").fill("gone");
  const item = sessionItems(page).first();
  await expect(item).toBeVisible({ timeout: 15_000 });
  await item.click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

test.describe("本地归档 · 读到", () => {
  test.use({ scenario: archivedScenario() });

  test("源文件已被清理的会话仍出现在列表里，并带归档标记", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("gone");

    const item = sessionItems(page).first();
    await expect(item).toBeVisible({ timeout: 15_000 });
    // 标记来自 SessionMeta.archived（源不在 ~/.claude 里，只有副本）。
    await expect(item.locator("[data-archive-badge]")).toBeVisible();
  });

  test("归档会话能打开、能解析出记录", async ({ page }) => {
    await openArchivedSession(page);

    // 打开的是副本（~/.claude 里没有这个文件），内容仍要解析出来。
    await expect(page.getByLabel("会话列表").getByText("三个月前的那次重构")).toBeVisible();
    await expect(page.getByRole("region", { name: "记录筛选" })).toBeVisible();
  });
});

test.describe("本地归档 · 写到", () => {
  test("开启后点「立即归档」，副本与索引写进应用数据目录", async ({ page }) => {
    await page.goto("/");

    // 设置浮层里开启归档（默认关闭）。
    await page.getByRole("button", { name: "设置" }).click();
    const toggle = page.getByRole("checkbox", { name: "启用本地归档" });
    await toggle.check();
    await page.getByRole("button", { name: "立即归档" }).click();

    // 完成后状态行收回结论（而不是一直转圈）。
    await expect(page.getByText(/已归档 \d+ 个会话/)).toBeVisible({ timeout: 20_000 });

    const writes = await page.evaluate(() => {
      const log =
        (window as unknown as { __CCA_E2E_LOG__?: Array<{ op: string; args: unknown[] }> })
          .__CCA_E2E_LOG__ ?? [];
      return log
        .filter((entry) => entry.op === "write_text")
        .map((entry) => entry.args[0] as { path: string; contents: string });
    });

    const copies = writes.filter((entry) => entry.path.startsWith(`${ARCHIVE_ROOT}/`));
    expect(copies.length).toBeGreaterThan(0);
    // 每个副本都写在 archive/<项目>/<会话>.jsonl 下，内容是原始 JSONL。
    for (const copy of copies.filter((entry) => entry.path.endsWith(".jsonl"))) {
      expect(copy.path).toMatch(new RegExp(`^${ARCHIVE_ROOT}/.+/.+\\.jsonl$`));
      // 内容是原始 JSONL（夹具里不一定每条都带 sessionId，但一定有 type）。
      expect(copy.contents).toContain('"type"');
    }

    const index = writes.find((entry) => entry.path.endsWith("archive-index.json"));
    expect(index, "归档索引没有被写出").toBeTruthy();
    const parsed = JSON.parse(index?.contents ?? "{}") as {
      entries: Record<string, { archivePath: string; mtimeMs: number }>;
    };
    const entries = Object.values(parsed.entries);
    expect(entries.length).toBeGreaterThan(0);
    // 索引记的是**原始** mtime，不是归档时刻。
    for (const entry of entries) {
      expect(entry.archivePath.startsWith(ARCHIVE_ROOT)).toBe(true);
      expect(entry.mtimeMs).toBeLessThan(Date.UTC(2030, 0, 1));
    }
  });
});
