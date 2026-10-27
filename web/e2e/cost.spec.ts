import { inflateSync } from "node:zlib";
import { test, expect, costScenario } from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import { sessionItems } from "./selectors";

/**
 * 「会话账单」（Round BB）的端到端验收：设计 G1–G15。
 *
 * 期望值全部从 `web/tests/fixtures/cost-session.jsonl` **手算**后写死在这里
 * （单价快照 2026-10-01：Sonnet 3/15/3.75/0.3、Opus 15/75/18.75/1.5），
 * 不把界面读回来的数字当成期望值——否则界面算错时测试会一起错。
 *
 * 夹具：3 个模型（Sonnet 4.5 / Opus 4.1 / GPT-5 未收录）、8 笔可定价调用 +
 * 2 次未计入（GPT-5 一笔 + 缺 usage 一笔）、四类科目全非零。缓存读取小计
 * $0.005 落在 (0, 0.01)——「假零」门禁 G4 靠它；四类单价都是跨档加权，
 * 所以四行都以 `≈` 开头（G6）。
 */

type ReceiptExpectation = {
  key: string;
  tokensText: string;
  tokens: number;
  usdText: string;
  usd: number;
  rate: string;
  share: string;
};

const RECEIPT: ReceiptExpectation[] = [
  {
    key: "input",
    tokensText: "230,000",
    tokens: 230_000,
    usdText: "$1.65",
    usd: 1.65,
    rate: "≈$7.17",
    share: "75.6%"
  },
  {
    key: "output",
    tokensText: "8,100",
    tokens: 8_100,
    usdText: "$0.40",
    usd: 0.3975,
    rate: "≈$49.07",
    share: "18.2%"
  },
  {
    key: "cacheWrite",
    tokensText: "15,000",
    tokens: 15_000,
    usdText: "$0.13",
    usd: 0.13125,
    rate: "≈$8.75",
    share: "6.0%"
  },
  {
    key: "cacheRead",
    tokensText: "11,000",
    tokens: 11_000,
    usdText: "$0.005",
    usd: 0.0045,
    rate: "≈$0.41",
    share: "0.2%"
  }
];

const TOTAL_TEXT = "$2.18";
const TOTAL_USD = RECEIPT.reduce((sum, line) => sum + line.usd, 0); // 2.18325

/** 把 `$1.65` / `-$0.003` 之类的展示串换成数字，用来对账。 */
function moneyValue(text: string): number {
  if (text.trim() === "—") return NaN;
  return Number(text.replace(/[^0-9.]/g, ""));
}

async function openCost(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/cost");
  await sessionItems(page).first().click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
    timeout: 15_000
  });
  await page.getByRole("tab", { name: "账单", exact: true }).click();
  await expect(page.locator("[data-probe='cost-root']")).toBeVisible();
}

function receiptTable(page: Page) {
  return page.locator("[data-probe='cost-receipt']");
}

function receiptRows(page: Page) {
  return receiptTable(page).locator("[data-probe='cost-receipt-row']");
}

async function rightEdges(locator: Locator): Promise<number[]> {
  const boxes = await locator.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().right)
  );
  return boxes.map(Number);
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

async function scrollMetrics(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('[data-probe="cost-scroll"]');
    const doc = document.scrollingElement as HTMLElement;
    return {
      scrollWidth: scroller?.scrollWidth ?? -1,
      clientWidth: scroller?.clientWidth ?? -1,
      scrollHeight: scroller?.scrollHeight ?? -1,
      clientHeight: scroller?.clientHeight ?? -1,
      docScrollWidth: doc.scrollWidth,
      docClientWidth: doc.clientWidth,
      docScrollHeight: doc.scrollHeight,
      docClientHeight: doc.clientHeight
    };
  });
}

/** 极简 PNG 解码（8-bit RGB/RGBA，无隔行）——只为了在 G9 里读两三个像素。 */
function decodePng(buffer: Buffer): {
  width: number;
  height: number;
  pixel: (x: number, y: number) => [number, number, number];
} {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const type = buffer.toString("ascii", pos + 4, pos + 8);
    const data = buffer.subarray(pos + 8, pos + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    }
    pos += 12 + length;
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`不支持的 PNG 颜色类型 ${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * bpp);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const offset = y * (stride + 1);
    const filter = raw[offset];
    const line = raw.subarray(offset + 1, offset + 1 + stride);
    const current = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? current[i - bpp] : 0;
      const up = previous[i];
      const upLeft = i >= bpp ? previous[i - bpp] : 0;
      const value = line[i];
      let restored: number;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          restored = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
          break;
        }
        default:
          throw new Error(`不支持的 PNG 过滤类型 ${filter}`);
      }
      current[i] = restored & 0xff;
    }
    current.copy(out, y * stride);
    previous = current;
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const offset = y * stride + x * bpp;
      return [out[offset], out[offset + 1], out[offset + 2]];
    }
  };
}

function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

test.describe("会话账单", () => {
  test.use({ scenario: costScenario() });

  test("G1 收据进入第 8 个标签（第三批新增「时间轴」后），且刷新后仍停在「账单」", async ({ page }) => {
    await openCost(page);

    const viewBar = page.getByRole("tablist", { name: "视图切换" });
    const tabs = viewBar.getByRole("tab");
    await expect(tabs).toHaveCount(8);
    await expect(tabs.last()).toHaveText("账单");
    await expect(page.getByRole("tab", { name: "账单", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(await page.evaluate(() => localStorage.getItem("cca-analyzer-view"))).toBe("cost");

    await page.reload();
    await page.getByPlaceholder("搜会话 ID 或目录…").fill("/repo/cost");
    await sessionItems(page).first().click();
    await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", {
      timeout: 15_000
    });
    // 不点标签：视图必须从 localStorage 恢复。
    await expect(page.getByRole("tab", { name: "账单", exact: true })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(page.locator("[data-probe='cost-root']")).toBeVisible();
  });

  test("G2/G3 四行收据按固定顺序，每行小计 = tokens/1e6 × 加权单价，合计 = 四行之和", async ({
    page
  }) => {
    await openCost(page);

    const rows = receiptRows(page);
    await expect(rows).toHaveCount(4);
    await expect(receiptTable(page).locator("[data-probe='cost-receipt-total']")).toHaveCount(1);

    for (const [index, expected] of RECEIPT.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute("data-class", expected.key);
      const cells = row.locator("td");
      await expect(cells.nth(0)).toHaveText(expected.tokensText);
      await expect(cells.nth(1)).toHaveText(expected.rate);
      await expect(cells.nth(2)).toContainText(expected.share);
      await expect(cells.nth(3)).toHaveText(expected.usdText);

      // 小计与手算值逐位相等（$0.005 不能被印成 $0.00，也不能被四舍五入成 $0.01）。
      // 展示值保留 3 位（很小）或 2 位（其余），所以先对「展示串」对账，再验它
      // 与精确值的差不超过该档的显示精度。
      const shown = moneyValue(await cells.nth(3).innerText());
      expect(Math.abs(shown - moneyValue(expected.usdText))).toBeLessThan(1e-9);
      const decimals = (expected.usdText.split(".")[1] ?? "").length;
      expect(Math.abs(shown - expected.usd)).toBeLessThanOrEqual(
        decimals >= 3 ? 0.00051 : 0.005
      );

      // tokens / 1e6 × 展示出来的加权单价 ≈ 小计（只差在单价显示到分）。
      const rate = moneyValue(await cells.nth(1).innerText());
      const recomputed = (expected.tokens / 1_000_000) * rate;
      expect(Math.abs(recomputed - expected.usd)).toBeLessThan(0.006);
    }

    const totalCell = receiptTable(page).locator("[data-probe='cost-receipt-total'] [data-col='sum']");
    await expect(totalCell).toHaveText(TOTAL_TEXT);
    expect(Math.abs(moneyValue(TOTAL_TEXT) - TOTAL_USD)).toBeLessThan(0.006);
    // 合计的展示值必须等于「四行精确值之和」按分四舍五入后的结果。
    expect(moneyValue(TOTAL_TEXT)).toBe(Number(TOTAL_USD.toFixed(2)));

    // 左栏是「科目」，四行文字也按 LEDGER_CLASS_ORDER 的顺序。
    await expect(rows.nth(0).locator("th")).toContainText("输入");
    await expect(rows.nth(1).locator("th")).toContainText("输出");
    await expect(rows.nth(2).locator("th")).toContainText("缓存写入");
    await expect(rows.nth(3).locator("th")).toContainText("缓存读取");
  });

  test("G4 不出现假零：有 token 的科目金额不为 $0.00，且缓存读取印出 $0.005", async ({
    page
  }) => {
    await openCost(page);

    const zeroRows: string[] = [];
    let tiny: { text: string; value: number } | null = null;
    for (const expected of RECEIPT) {
      const row = page
        .locator(`[data-probe='cost-receipt-row'][data-class='${expected.key}']`)
        .first();
      const text = (await row.locator("[data-col='sum']").innerText()).trim();
      const value = moneyValue(text);
      if (expected.tokens > 0 && text === "$0.00") zeroRows.push(expected.key);
      if (value > 0 && value < 0.01) tiny = { text, value };
    }
    expect(zeroRows).toEqual([]);
    expect(tiny).not.toBeNull();
    expect(tiny!.text).toMatch(/^\$0\.00[1-9]$/);
    expect(tiny!.value).toBeGreaterThan(0);
    expect(tiny!.value).toBeLessThan(0.01);
  });

  test("G5 未知模型（GPT-5）金额是「—」，并明确「另有 2 次调用未计入」", async ({ page }) => {
    await openCost(page);

    // 文案的括注在 Round BB 收尾时扩成「没有可用的 token 读数，或模型定价未知」，
    // 断言只钉前缀（次数是夹具的账，括注是文案）。
    await expect(page.locator("[data-probe='cost-unpriced']")).toHaveText(
      /^另有 2 次调用未计入/
    );

    const models = page.locator("[data-probe='cost-models'] [data-probe='cost-model-row']");
    await expect(models).toHaveCount(3);

    const gptRow = models.filter({ has: page.locator("[title='gpt-5']") });
    await expect(gptRow).toHaveCount(1);
    await expect(gptRow.locator("[data-col='sum']")).toHaveText("—");
    await expect(gptRow.locator("[data-col='sum']")).toHaveAttribute(
      "aria-label",
      "小计 定价未知"
    );
    await expect(gptRow).toContainText("定价未知 · 1 次调用");

    const opusRow = models.filter({ has: page.locator("[title='claude-opus-4-1-20250805']") });
    await expect(opusRow.locator("[data-col='sum']")).toHaveText("$1.64");
    await expect(opusRow.locator("th")).toContainText("Opus 档 · 5 次调用");

    const sonnetRow = models.filter({
      has: page.locator("[title='claude-sonnet-4-5-20250929']")
    });
    await expect(sonnetRow.locator("[data-col='sum']")).toHaveText("$0.54");
    await expect(sonnetRow.locator("th")).toContainText("Sonnet 档 · 3 次调用");
  });

  test("缓存经济学读数：命中率 4.6%、读取 11,000、省下（估算）$0.04", async ({ page }) => {
    await openCost(page);

    const cache = page.locator("[data-probe='cost-cache']");
    await expect(cache).toContainText("缓存命中率");
    await expect(cache).toContainText("4.6%");
    await expect(cache).toContainText("11,000");
    await expect(cache).toContainText("$0.04");
    await expect(page.getByText("估算，不是账单 · 定价快照 2026-10-01")).toBeVisible();
  });

  test("G6 单价三态：本夹具四类跨档，全部带 ≈；合计行单价是「—」", async ({ page }) => {
    await openCost(page);

    const rows = receiptRows(page);
    for (const [index, expected] of RECEIPT.entries()) {
      const rateCell = rows.nth(index).locator("td").nth(1);
      await expect(rateCell).toHaveText(expected.rate);
      expect(expected.rate.startsWith("≈")).toBe(true);
    }
    await expect(
      receiptTable(page).locator("[data-probe='cost-receipt-total'] td").nth(1)
    ).toHaveText("—");
  });

  test("G7 金额右沿对齐：收据 / 按模型 / 最贵五次三张表的金额列右沿差 ≤ 1px", async ({ page }) => {
    await openCost(page);

    const groups = [
      page.locator("[data-probe='cost-receipt'] [data-col='sum']"),
      page.locator("[data-probe='cost-models'] [data-col='sum']"),
      page.locator("[data-probe='cost-top'] [data-col='sum']")
    ];
    const counts = [5, 3, 5];
    for (const [index, locator] of groups.entries()) {
      await expect(locator).toHaveCount(counts[index]);
      const edges = await rightEdges(locator);
      expect(spread(edges)).toBeLessThanOrEqual(1);
    }
  });

  test("G8 行高：收据 28±1，按模型 / 最贵五次 26±1（100% 字号）", async ({ page }) => {
    await openCost(page);

    const heights = await receiptRows(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height)
    );
    expect(heights).toHaveLength(4);
    for (const height of heights) expect(Math.abs(height - 28)).toBeLessThanOrEqual(1);

    const modelHeights = await page
      .locator("[data-probe='cost-model-row']")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(modelHeights).toHaveLength(3);
    for (const height of modelHeights) expect(Math.abs(height - 26)).toBeLessThanOrEqual(1);

    const topHeights = await page
      .locator("[data-probe='cost-top-row']")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(topHeights).toHaveLength(5);
    for (const height of topHeights) expect(Math.abs(height - 26)).toBeLessThanOrEqual(1);
  });

  test("G9 合计行上方有一道 1px 分隔线（计算样式 + 像素采样）", async ({ page }) => {
    await openCost(page);

    const totalRow = page.locator("[data-probe='cost-receipt-total']");
    // 分隔线画在 tfoot 的单元格上（tr 自己不带边框），所以从单元格读计算样式。
    const border = await totalRow.locator("td").first().evaluate((node) => {
      const style = getComputedStyle(node as HTMLElement);
      return { width: style.borderTopWidth, style: style.borderTopStyle };
    });
    expect(border.width).toBe("1px");
    expect(border.style).toBe("solid");

    await totalRow.scrollIntoViewIfNeeded();
    const box = await totalRow.boundingBox();
    expect(box).not.toBeNull();
    const x = Math.round(box!.x + Math.min(140, box!.width / 2));
    const y = Math.round(box!.y);
    const shot = await page.screenshot({
      clip: { x, y: Math.max(0, y - 1), width: 1, height: 6 }
    });
    const image = decodePng(shot);
    const background = luminance(image.pixel(0, image.height - 1));
    const diffs = Array.from({ length: image.height - 1 }, (_, row) =>
      Math.abs(luminance(image.pixel(0, row)) - background)
    );
    expect(Math.max(...diffs)).toBeGreaterThanOrEqual(16);
  });

  test("G10/G11 卡内滚动：1440×900 无横向溢出、页面无第二竖向滚动轴、账单卡自己滚", async ({
    page
  }) => {
    await openCost(page);

    const metrics = await scrollMetrics(page);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);
    expect(metrics.docScrollHeight).toBeLessThanOrEqual(metrics.docClientHeight + 1);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  });

  test("G12 点「最贵五次」的时刻回到日志并高亮同一条记录", async ({ page }) => {
    await openCost(page);

    const firstRow = page.locator("[data-probe='cost-top-row']").first();
    const jump = firstRow.locator("button");
    const clock = (await jump.innerText()).trim();
    expect(clock).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    await expect(jump).toHaveAttribute("aria-label", /^跳到日志：/);

    await jump.click();
    await expect(page.getByRole("tab", { name: "日志视图" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const highlighted = page.locator("[data-probe='record-table'] tr[class*='highlight']");
    await expect(highlighted).toContainText(clock, { timeout: 1_500 });
    await expect(highlighted).toBeInViewport();
  });

  test("G13 无障碍：占比条 aria-hidden、金额读屏带美元/定价未知、跳转按钮有完整标签", async ({
    page
  }) => {
    await openCost(page);

    const bars = page.locator("[data-probe='cost-bar']");
    await expect(bars).toHaveCount(4);
    for (const bar of await bars.all()) {
      await expect(bar).toHaveAttribute("aria-hidden", "true");
    }

    const money = page.locator("[data-col='sum']");
    const labels = await money.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("aria-label") ?? "")
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(label).toMatch(/(美元|定价未知)$/);

    const jumpLabels = await page
      .locator("[data-probe='cost-top'] button")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label") ?? ""));
    expect(jumpLabels).toHaveLength(5);
    for (const label of jumpLabels) {
      expect(label.startsWith("跳到日志：")).toBe(true);
      expect(label).toMatch(/小计 .+）/);
    }
  });

  test("G14 130% 字号：标签页不裁、不与右侧状态重叠，收据五列不溢出，行高 34/31.4±1", async ({
    page
  }) => {
    await openCost(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty("--font-scale", "1.3");
    });
    await page.waitForTimeout(250);

    const tabs = page.getByRole("tablist", { name: "视图切换" }).getByRole("tab");
    await expect(tabs).toHaveCount(8);
    for (const tab of await tabs.all()) {
      expect(await tab.evaluate((node) => (node as HTMLElement).scrollWidth)).toBeLessThanOrEqual(
        await tab.evaluate((node) => (node as HTMLElement).clientWidth + 1)
      );
    }

    const lastTab = await tabs.last().boundingBox();
    const status = await page.getByLabel("会话图状态").boundingBox();
    expect(lastTab).not.toBeNull();
    expect(status).not.toBeNull();
    const separated =
      lastTab!.x + lastTab!.width <= status!.x - 4 ||
      lastTab!.y + lastTab!.height <= status!.y - 4;
    expect(separated).toBe(true);

    const cells = receiptTable(page).locator("th, td");
    for (const cell of await cells.all()) {
      const [scrollWidth, clientWidth] = await cell.evaluate((node) => [
        (node as HTMLElement).scrollWidth,
        (node as HTMLElement).clientWidth
      ]);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
    }

    const receiptHeights = await receiptRows(page).evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().height)
    );
    for (const height of receiptHeights) expect(Math.abs(height - 34)).toBeLessThanOrEqual(1);
    const modelHeights = await page
      .locator("[data-probe='cost-model-row']")
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    for (const height of modelHeights) expect(Math.abs(height - 31.4)).toBeLessThanOrEqual(1);
  });

  test("G16 滚动提示：进入时在场、滚到底消失，滚到底后仍无横向溢出", async ({ page }) => {
    await openCost(page);

    const scroll = page.locator("[data-probe='cost-scroll']");
    const fade = page.locator("[data-probe='cost-fade']");
    await expect(fade).toBeVisible();
    await expect(fade).toHaveAttribute("aria-hidden", "true");

    const before = await scroll.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight
    }));
    expect(before.scrollHeight).toBeGreaterThan(before.clientHeight);

    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight - node.clientHeight;
    });
    await expect(fade).toHaveCount(0);

    const after = await scroll.evaluate((node) => ({
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth
    }));
    expect(after.scrollWidth).toBeLessThanOrEqual(after.clientWidth + 1);
  });
});

test.describe("会话账单 · 960×640 窄窗", () => {
  test.use({ scenario: costScenario(), viewport: { width: 960, height: 640 } });

  test("G15 重放/账单视图在窄窗下无横向溢出（纵向页面滚动允许）", async ({ page }) => {
    await openCost(page);

    const metrics = await scrollMetrics(page);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);
  });
});
