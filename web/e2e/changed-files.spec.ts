import type { Page } from "@playwright/test";
import { test, expect, changedFilesScenario } from "./fixtures";

/**
 * 会话详情「改动」标签页（Round N / N2）。
 *
 * 这一层验证真实排版与交互链路：聚合读数与行数字和夹具一致、展开区的记录
 * 数与口径（失败可见不计数、子链并入）、点记录真的切回日志视图并高亮到行、
 * 纯问答会话走空态。数据全部来自共享夹具 changed-files-session.jsonl。
 */

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

async function openSession(page: Page, query: string) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill(query);
  await sessionItems(page).first().click();
}

async function openChangesView(page: Page, query: string) {
  await openSession(page, query);
  await page.getByRole("tab", { name: "改动", exact: true }).click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
  return page.getByRole("region", { name: "改动文件" });
}

test.describe("改动标签页（changed-files 夹具）", () => {
  test.use({ scenario: changedFilesScenario() });

  test("聚合读数、行序与计数同夹具一致；时间线与筛选不渲染", async ({ page }) => {
    const panel = await openChangesView(page, "changed-demo");

    // 聚合读数（3 文件：A 改动4/查看2，B 查看1，C 改动1；A 新建；A 子链 1）。
    await expect(panel.getByText("3 个文件 · 5 次改动 · 3 次查看 · 1 个新建")).toBeVisible();

    // 行序 lastAt 降序：A（13:40）→ B（12:40）→ C（12:02）。
    const rows = panel.locator("[data-changes-file]");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute("data-changes-file", "src/web/foo.ts");
    await expect(rows.nth(1)).toHaveAttribute("data-changes-file", "docs/bar.md");
    await expect(rows.nth(2)).toHaveAttribute("data-changes-file", "/etc/hosts");

    // A 行：新建徽标 + 子 agent 徽标；全路径只进 title（隐私约定）。
    const rowA = panel.getByRole("button", { name: /src\/web\/foo\.ts/ });
    await expect(rowA).toContainText("新建");
    await expect(rowA).toContainText("子agent 1");
    await expect(rowA).toHaveAttribute(
      "title",
      expect.stringContaining("/repo/changed-demo/src/web/foo.ts")
    );
    // B 行零改动列是「—」；C 行项目外路径原样显示。
    await expect(panel.getByRole("button", { name: /docs\/bar\.md/ })).toContainText("—");
    await expect(panel.getByRole("button", { name: /\/etc\/hosts/ })).toContainText("1");

    // 口径与 context 档同款：会话级全量清单，记录级筛选会让口径漂移。
    await expect(page.getByLabel("会话时间概览")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "记录筛选" })).toHaveCount(0);
    // 口径脚注常显。
    await expect(panel.getByText(/不含 Bash 等间接写文件的调用/)).toBeVisible();
  });

  test("展开文件行见全部记录（含失败与子链），点记录跳回日志视图并高亮", async ({ page }) => {
    const panel = await openChangesView(page, "changed-demo");

    await panel.getByRole("button", { name: /src\/web\/foo\.ts/ }).click();
    const records = panel.locator("[data-changes-records]");
    // 7 条：Read ×2、Edit ×2、Write、失败 Edit、子链 Edit——失败可见但不计数。
    await expect(records.locator("[data-changes-record]")).toHaveCount(7);
    await expect(records.getByText(/7 条记录 · 其中 1 次失败/)).toBeVisible();
    // 失败注记是记录行里的独立 span（title 带口径说明，与小结行区分开）。
    await expect(records.locator("[title='该调用失败，不计入上方计数']")).toBeVisible();
    await expect(records.getByText("子 agent")).toBeVisible();

    // 点第 3 条（成功的 Edit，cf-edit-a1）：切回日志视图、高亮行在视口。
    await records.locator("[data-changes-record]").nth(2).click();
    await expect(page.getByRole("tab", { name: "日志视图" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    // 高亮行（cca-flash；CSS Module 类名带哈希，按 class* 匹配）在视口内且是那次 Edit。
    const highlighted = table.locator("tr[class*='highlight']");
    await expect(highlighted).toBeVisible();
    await expect(highlighted).toContainText("Edit");
    await expect(highlighted).toBeInViewport();
  });

  test("纯问答会话走空态（面板骨架与口径脚注保留）", async ({ page }) => {
    // /repo/subagent 只有 Agent 调用，没有任何文件工具。
    const panel = await openChangesView(page, "subagent");

    await expect(panel.getByText("本会话没有接触任何文件")).toBeVisible();
    await expect(panel.getByText("没有成功的 Edit / Write / NotebookEdit，也没有 Read。")).toBeVisible();
    // 0 是检查后的结果：口径脚注照常在场。
    await expect(panel.getByText(/改动 = 成功的 Edit \/ Write \/ NotebookEdit/)).toBeVisible();
    await expect(panel.locator("[data-changes-files]")).toHaveCount(0);
  });

  test("表头三列与每一行的对应列中心一一对齐，列间有可见间隙", async ({ page }) => {
    // 列布局回归（视觉验收抓到过：每行独立 grid + max-content 逐行解析，
    // 跨行永不共宽且数字贴死）。表头与行共用同一份固定 ch 轨模板，居中对齐，
    // 中心差必须 ≤2px；计数列之间至少 --sp-2（8px）的可见间隙。
    const panel = await openChangesView(page, "changed-demo");
    const columns = ["changes", "reads", "last"] as const;

    const center = async (locator: import("@playwright/test").Locator) => {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      return box!.x + box!.width / 2;
    };

    for (const col of columns) {
      const headCenter = await center(panel.locator(`[data-changes-head] [data-col='${col}']`));
      const rows = panel.locator("li[data-changes-file]");
      const rowCount = await rows.count();
      expect(rowCount).toBe(3);
      for (let index = 0; index < rowCount; index += 1) {
        const rowCenter = await center(rows.nth(index).locator(`[data-col='${col}']`));
        // 失败时要能看出是哪列哪行差多少——循环里所有断言共享一行代码。
        expect(Math.abs(headCenter - rowCenter), `列 ${col} 第 ${index} 行中心差`).toBeLessThanOrEqual(2);
      }
    }

    // 可见间隙：行内 改动→查看、查看→末次 的列间空隙 ≥ 8px - 1px 容差。
    const firstRow = panel.locator("li[data-changes-file]").first();
    for (const [left, right] of [
      ["changes", "reads"],
      ["reads", "last"]
    ] as const) {
      const leftBox = await firstRow.locator(`[data-col='${left}']`).boundingBox();
      const rightBox = await firstRow.locator(`[data-col='${right}']`).boundingBox();
      expect(leftBox).not.toBeNull();
      expect(rightBox).not.toBeNull();
      expect(rightBox!.x - (leftBox!.x + leftBox!.width)).toBeGreaterThanOrEqual(7);
    }
  });
});
