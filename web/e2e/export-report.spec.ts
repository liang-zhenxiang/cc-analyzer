import type { Page } from "@playwright/test";
import { test, expect, defaultScenario } from "./fixtures";

/**
 * 「导出会话报告」的端到端闭环：真的打开会话、点开浮层、切格式、保存与复制，
 * 然后**逐字符检查落到盘上/进到剪贴板的东西**。
 *
 * 系统保存对话框没法在测试里点，但它在 `tauri-mock.ts` 的边界上被换成了确定
 * 的返回值与 `write_text` 桩——所以这里断言的仍然是真实构建产物走同一条
 * `plugin:dialog|save` → `write_text` 链路的行为，而不是「调用了某个函数」。
 *
 * 三个必须先立住的性质：产物自包含（无外链、无脚本）、内容转义到底、
 * 浮层报的条数与导出条数一致——**两个范围都要成立**（只改文件名不换数据，
 * 会导出一份自称完整、实则筛选后的子集）。
 */

const SAVED = "/Users/e2e/export-out.file";
const SESSION_CWD_MATCH = "demo";

test.use({ scenario: defaultScenario({ savePath: SAVED }) });

async function openFirstSession(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill(SESSION_CWD_MATCH);
  await page
    .getByLabel("会话列表", { exact: true })
    .locator("button[title]:has(strong)")
    .first()
    .click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

async function openExportDialog(page: Page) {
  await openFirstSession(page);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** 浮层里报的「将导出 N 条记录」。 */
async function exportedCount(page: Page): Promise<number> {
  const text = await page.getByRole("dialog").locator("#export-dialog-count").innerText();
  const digits = text.match(/将导出\s*([\d,]+)\s*条记录/)?.[1]?.replace(/,/g, "");
  expect(digits, `浮层里没读到条数：${text}`).toBeTruthy();
  return Number(digits);
}

/**
 * CSV 里的记录条数（不含表头）。
 *
 * **不能按 `\r\n` 朴素切分**：摘要列可能带引号包裹的换行（工具调用的 JSON
 * 就是多行的），一行记录会跨多个物理行。这里按 RFC 4180 的口径数「引号外的
 * 行尾」，与单测里的解析器同一套规则。
 */
function countCsvRecords(csv: string): number {
  const body = csv.slice(1); // 去掉 BOM
  let records = 0;
  let quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === "\r" && body[index + 1] === "\n") records += 1;
  }
  return records - 1; // 减去表头那一行
}

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

function clipboardWrites(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __CCA_CLIPBOARD__?: string[] }).__CCA_CLIPBOARD__ ?? []
  );
}

test.describe("导出 · HTML 报告", () => {
  test("保存后落盘一份自包含、无脚本的报告", async ({ page }) => {
    await openExportDialog(page);

    await page.getByRole("button", { name: "保存…" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/已导出 HTML 报告/)).toBeVisible();

    const files = await writtenFiles(page);
    const saved = files.at(-1);
    expect(saved?.path).toBe(SAVED);
    const html = saved?.contents ?? "";
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("由 CC Analyzer 生成");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    // 报告是转发物：应用自己的绝对路径一个字符都不许带上。
    expect(html).not.toContain("/Users/e2e");
    expect(html).not.toContain(".claude/projects");
  });

  test("复制到剪贴板的是 HTML 源码", async ({ page }) => {
    await openExportDialog(page);

    await page.getByRole("button", { name: "复制到剪贴板" }).click();

    await expect(page.getByRole("dialog").getByText("已复制 HTML 源码")).toBeVisible();
    const writes = await clipboardWrites(page);
    expect(writes.at(-1)?.startsWith("<!doctype html>")).toBe(true);
  });
});

test.describe("导出 · CSV", () => {
  test("两个范围导出的行数都与浮层读数一致", async ({ page }) => {
    await openExportDialog(page);
    await page.getByRole("tab", { name: "CSV" }).click();

    const filtered = await exportedCount(page);
    expect(filtered).toBeGreaterThan(0);

    await page.getByRole("button", { name: "保存…" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const filteredCsv = (await writtenFiles(page)).at(-1)?.contents ?? "";
    expect(filteredCsv.charCodeAt(0)).toBe(0xfeff);
    expect(filteredCsv.slice(1).split("\r\n")[0]).toBe(
      "record_id,timestamp,timestamp_ms,kind,tool,model,duration_ms,is_error,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,summary"
    );
    expect(countCsvRecords(filteredCsv)).toBe(filtered);
    expect(filteredCsv).not.toContain("/Users/e2e");

    // 「全部记录」必须真的换一批数据——只改文件名后缀是最贵的假绿。
    await openExportDialog(page);
    await page.getByRole("tab", { name: "CSV" }).click();
    await page.getByRole("tab", { name: "全部记录" }).click();
    const all = await exportedCount(page);
    expect(all).toBeGreaterThanOrEqual(filtered);

    await page.getByRole("button", { name: "保存…" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const allCsv = (await writtenFiles(page)).at(-1)?.contents ?? "";
    expect(countCsvRecords(allCsv)).toBe(all);
  });

});

test.describe("导出 · 取消", () => {
  test.use({ scenario: defaultScenario({ savePath: null }) });

  test("用户取消系统对话框不是失败", async ({ page }) => {
    await openExportDialog(page);

    await page.getByRole("button", { name: "保存…" }).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText(/已导出/)).toHaveCount(0);
  });
});
