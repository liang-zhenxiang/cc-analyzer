import type { Page } from "@playwright/test";
import { test, expect, defaultScenario, APP_VERSION } from "./fixtures";
import type { BundleEntry } from "../src/api/types";
import type { MockScenario } from "./tauri-mock";

/**
 * 加密归档包（Issue #152）的端到端：**导出**、**导入**、**口令错**三条路径。
 *
 * 系统保存 / 打开对话框与建包 / 解包都由 `tauri-mock.ts` 在真实边界上打桩，
 * 所以这里验的仍是生产构建产物走 `plugin:dialog|*` → `export_archive_bundle` /
 * `import_archive_bundle` → 前端索引语义这条完整链路，而不是「调用了某个函数」。
 *
 * 三件必须立住的事：导出的条目与本机索引吻合；导入后归档读数与列表真的变了；
 * 口令错时就地报错、**索引一个字节都不写**。
 */

const HOME = "/Users/e2e";
const APP_DATA = `${HOME}/Library/Application Support/io.github.liang-zhenxiang.cc-analyzer`;
const ARCHIVE_ROOT = `${APP_DATA}/archive`;
const INDEX_PATH = `${ARCHIVE_ROOT}/archive-index.json`;

/** 本机已归档、源文件已被 Claude Code 清理的一条：导出的就是它。 */
const GONE_SOURCE = `${HOME}/.claude/projects/-repo-gone/cleaned-up.jsonl`;
const GONE_COPY = `${ARCHIVE_ROOT}/-repo-gone/cleaned-up.jsonl`;
const GONE_ENTRY: BundleEntry = {
  sourcePath: GONE_SOURCE,
  archivePath: GONE_COPY,
  projectLabel: "-repo-gone",
  sessionId: "cleaned-up-0001",
  sizeBytes: 512,
  mtimeMs: Date.UTC(2026, 0, 5, 9, 0, 5)
};

/** 包里带来的一条：另一台机器的 `$HOME`，本机没有。 */
const IMPORT_SOURCE = "/Users/other/.claude/projects/-repo-imported/imported-session.jsonl";
const IMPORT_ENTRY: BundleEntry = {
  sourcePath: IMPORT_SOURCE,
  archivePath: "/Users/other/archive/-repo-imported/imported-session.jsonl",
  projectLabel: "-repo-imported",
  sessionId: "imported-session",
  sizeBytes: 321,
  mtimeMs: Date.UTC(2026, 1, 2, 3, 4, 5)
};

const BUNDLE_OUT = `${HOME}/exported.ccabundle`;
const BUNDLE_IN = `${HOME}/incoming.ccabundle`;

/** 一份合法的会话记录：台账说明原文件已经不在了 / 它来自另一台机器。 */
function transcript(sessionId: string, text: string): string {
  return [
    JSON.stringify({
      type: "user",
      sessionId,
      cwd: "/repo/imported",
      timestamp: "2026-02-02T03:04:05.000Z",
      uuid: `${sessionId}-user-1`,
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: text }
    })
  ].join("\n");
}

/** 默认场景 + 一条已归档的「源已清理」会话 + 导入包夹具。 */
function bundleScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const base = defaultScenario(overrides);
  return {
    ...base,
    savePath: BUNDLE_OUT,
    openPath: BUNDLE_IN,
    files: {
      ...base.files,
      [GONE_COPY]: transcript("cleaned-up-0001", "三个月前的那次重构"),
      [INDEX_PATH]: JSON.stringify({
        version: 1,
        entries: { [GONE_SOURCE]: { ...GONE_ENTRY, archivedAt: Date.UTC(2026, 9, 4, 12, 0, 0) } }
      })
    },
    bundleImport: {
      manifest: {
        formatVersion: 1,
        exportedAt: Date.UTC(2026, 1, 3, 0, 0, 0),
        appVersion: APP_VERSION,
        entries: [{ ...IMPORT_ENTRY, sha256: "a".repeat(64) }]
      },
      files: [
        { entry: IMPORT_ENTRY, contents: transcript("imported-session-0001", "从另一台机器搬来的会话") }
      ]
    }
  };
}

type LogEntry = { op: string; args: unknown[] };

async function writes(page: Page) {
  const log = await page.evaluate(
    () => (window as unknown as { __CCA_E2E_LOG__?: LogEntry[] }).__CCA_E2E_LOG__ ?? []
  );
  return log
    .filter((entry) => entry.op === "write_text")
    .map((entry) => entry.args[0] as { path: string; contents: string });
}

async function loggedCommands(page: Page, op: string) {
  const log = await page.evaluate(
    () => (window as unknown as { __CCA_E2E_LOG__?: LogEntry[] }).__CCA_E2E_LOG__ ?? []
  );
  return log.filter((entry) => entry.op === op).map((entry) => entry.args[0] as Record<string, unknown>);
}

async function openBundleDialog(page: Page, name: "导出归档包…" | "导入归档包…") {
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).click();
  await page.getByRole("button", { name }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

test.use({ scenario: bundleScenario() });

test("导出：假桥收到条目与本机归档索引逐字吻合", async ({ page }) => {
  await openBundleDialog(page, "导出归档包…");

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("口令").fill("hunter2");
  await dialog.getByLabel("再输一次").fill("hunter2");
  await dialog.getByRole("button", { name: "确认" }).click();

  await expect(dialog.getByText(/已导出 1 条会话/)).toBeVisible();

  const calls = await loggedCommands(page, "export_archive_bundle");
  expect(calls).toHaveLength(1);
  expect(calls[0].outPath).toBe(BUNDLE_OUT);
  expect(calls[0].password).toBe("hunter2");
  // 条目就是本机索引里的那一条——字段逐字对齐 Rust 侧线格式。
  expect(calls[0].entries).toEqual([GONE_ENTRY]);
});

test("导入：读数按夹具给出四类计数，归档索引与列表跟着变", async ({ page }) => {
  await openBundleDialog(page, "导入归档包…");

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("口令").fill("hunter2");
  await dialog.getByRole("button", { name: "确认" }).click();

  await expect(dialog.getByText("新增 1 · 已存在 0 · 并列 0 · 失败 0")).toBeVisible();

  // 索引被改写：原来 1 条（已归档、源已清理），导入后 2 条。
  const indexWrite = (await writes(page)).find((entry) => entry.path === INDEX_PATH);
  expect(indexWrite, "导入没有写回归档索引").toBeTruthy();
  const index = JSON.parse(indexWrite?.contents ?? "{}") as {
    entries: Record<string, { archivePath: string; sessionId: string }>;
  };
  expect(Object.keys(index.entries).sort()).toEqual([GONE_SOURCE, IMPORT_SOURCE].sort());
  expect(index.entries[IMPORT_SOURCE].archivePath).toBe(
    `${ARCHIVE_ROOT}/-repo-imported/imported-session.jsonl`
  );
  expect(index.entries[IMPORT_SOURCE].sessionId).toBe("imported-session");

  // 临时目录里的明文必须被清掉。
  const removals = await loggedCommands(page, "remove_import_staging");
  expect(removals).toHaveLength(1);
  expect(String(removals[0].stagingDir)).toMatch(/import-staging-\d+$/);

  // 收掉弹层，看会话列表：导入进来的会话真的出现了（列表内容按夹具变化）。
  await dialog.getByRole("button", { name: "完成" }).click();
  await page.getByPlaceholder("搜会话 ID 或目录…").fill("imported");
  const imported = sessionItems(page).first();
  await expect(imported).toBeVisible({ timeout: 15_000 });
  // 标记来自 SessionMeta.archived：它只有归档副本，本机 ~/.claude 里没有这个路径。
  await expect(imported.locator("[data-archive-badge]")).toBeVisible();
});

test.describe("口令错", () => {
  test.use({
    scenario: bundleScenario({
      bundleImportError: "口令错误：无法解密归档包"
    })
  });

  test("就地报错，索引一个字节都不写", async ({ page }) => {
    await openBundleDialog(page, "导入归档包…");

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("口令").fill("wrong");
    await dialog.getByRole("button", { name: "确认" }).click();

    await expect(dialog.getByRole("alert")).toContainText("口令错误");
    // 没有 rebuild 索引：没有任何一次 write_text 落在归档索引上。
    expect((await writes(page)).filter((entry) => entry.path === INDEX_PATH)).toHaveLength(0);
    // 明文临时目录仍然被清掉（失败路径也不留）。
    expect(await loggedCommands(page, "remove_import_staging")).toHaveLength(1);
  });
});
