import type { Page } from "@playwright/test";
import { test, expect, largeScenario, WINDOW_ROW_THRESHOLDS } from "./fixtures";

/**
 * 日志表的列预算与状态语义（Round I · I1）。
 *
 * 这一页要立住四条，全都只能在真实排版引擎里量：
 *
 * 1. **列宽不随筛选重排**——内容驱动布局下筛一次整表就重排（实测时间列 151→181），
 *    用户的眼睛要重新找列位置；
 * 2. **摘要列真的变宽了**——删掉 129px 的 waterfall 列之后它该 ≥400px；
 * 3. **行高收敛成一种**——数据行彼此等高；表头则**吃到同一条 `--row-h` 地板**，
 *    与数据行的差只允许是 border-collapse 的平台归属差异（判据见该用例的注释）；
 * 4. **失败是红的**——`.container td` 的基色曾经把失败语义色整个盖掉
 *    （v0.11.0 起失效），所以这条只能在浏览器里按**计算色**验。
 */

function sessionItems(page: Page) {
  return page.getByLabel("会话列表", { exact: true }).locator("button[title]:has(strong)");
}

/** 打开某个夹具会话（按目录名筛会话列表，再进日志视图）。 */
async function openSession(page: Page, query: string) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill(query);
  await sessionItems(page).first().click();
  await page.getByRole("tab", { name: "日志视图" }).click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

function logTable(page: Page) {
  return page.getByRole("main").locator("table").first();
}

/** 虚拟滚动的上下垫片没有 data-row-index，这里只数真的数据行。 */
function dataRows(page: Page) {
  return logTable(page).locator("tbody tr[data-row-index]");
}

function headerWidths(page: Page) {
  return logTable(page)
    .locator("thead th")
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().width * 100) / 100)
    );
}

/** 当前渲染出来的垫片行必须一个单元格都没有（列数由 colgroup 定，不由垫片定）。 */
async function expectPadRowsCellLess(page: Page) {
  const pads = await logTable(page)
    .locator("tbody tr[aria-hidden='true']")
    .evaluateAll((nodes) => nodes.map((row) => row.children.length));
  expect(pads.length).toBeGreaterThan(0);
  for (const cells of pads) expect(cells).toBe(0);
}

test.describe("日志表列预算", () => {
  test("删掉 waterfall 之后摘要列拿到 ≥400px，表头全中文", async ({ page }) => {
    await openSession(page, "ansi");

    const headers = await logTable(page)
      .locator("thead th")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          text: (node.textContent ?? "").trim(),
          width: Math.round(node.getBoundingClientRect().width)
        }))
      );

    expect(headers).toHaveLength(8);
    expect(headers.map((header) => header.text)).not.toContain("waterfall");
    for (const header of headers.filter((item) => item.text.length > 0)) {
      expect(header.text, header.text).toMatch(/[一-龥]/);
    }
    // 摘要列原来只有 305px，第三行就被截到「…我跑…」。
    const summary = headers[2];
    expect(summary.text).toBe("操作 / 摘要");
    expect(summary.width).toBeGreaterThanOrEqual(400);
  });

  test("数据行彼此等高，且表头吃到同一条 --row-h 地板", async ({ page }) => {
    await openSession(page, "ansi");

    const measured = await page.evaluate(() => {
      const round = (value: number) => Math.round(value * 100) / 100;
      const table = document.querySelector("main table") as HTMLTableElement;
      const head = table.querySelector("thead tr") as HTMLElement;
      const rows = [...table.querySelectorAll("tbody tr[data-row-index]")] as HTMLElement[];
      const tops = rows.map((row) => row.getBoundingClientRect().top);

      // `--row-h` 这条共用地板的**实际高度**：探针与表头读的是 :root 上的同一份令牌，
      // 因此是「同一个引擎里量两次」，跨引擎的边框归属差异在这里被抵消掉。
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute;top:-9999px;left:0;width:0;height:var(--row-h)";
      document.body.appendChild(probe);
      const floorPixels = probe.offsetHeight;
      probe.remove();

      // **整数量**：offsetHeight 按布局单位取整，是这一条唯一与亚像素无关的口径。
      const rowPixels = rows.map((row) => row.offsetHeight).sort((a, b) => a - b);
      return {
        floorPixels,
        headerPixels: head.offsetHeight,
        medianPixels: rowPixels[Math.floor(rowPixels.length / 2)],
        rowBoxes: rows.map((row) => round(row.getBoundingClientRect().height)),
        rowPixels,
        // 相邻数据行的行距：这才是「38/37/36 三种行高」那条老毛病的样子。
        pitches: tops.slice(1).map((top, index) => round(top - tops[index]))
      };
    });

    // 夹具健全性：至少三行才谈得上「等高」。
    expect(measured.pitches.length).toBeGreaterThanOrEqual(2);

    // 失败信息打印**原始数值**：只有差值时看不出是谁比谁大，定位要一次到位。
    const detail =
      `表头 ${measured.headerPixels} 个布局像素 · ` +
      `数据行 ${measured.rowPixels.join("/")} · ` +
      `行距 ${measured.pitches.join("/")}`;

    // 一、连续性：不许某一行因为内容不同就长高。行距是盒顶之间的距离，
    // 不受折叠边框与取整影响，所以这里用小数、容差 0.1 就够。
    const spread = Math.max(...measured.pitches) - Math.min(...measured.pitches);
    const pitchSpread = Math.round(spread * 100) / 100;
    expect(pitchSpread, `行距不均 —— 极差 ${pitchSpread} · ${detail}`).toBeLessThanOrEqual(0.1);

    // 二、表头吃到同一条 `--row-h` 地板——**这一条的判据本体**。把 `thead tr` 从那条
    // 共用地板里摘掉（CSS 只留 `.container tbody tr { height: var(--row-h) }`），表头就
    // 只剩自己的内容盒（--fs-xs + --lh-xs + 两倍 --row-pad-y = 28px，量到 29），
    // 立刻掉到地板以下；四个平台组合上都是 29 < 30，所以这条在哪都红。
    expect(
      measured.headerPixels,
      `表头没吃到 --row-h 这条共用地板 —— 表头 ${measured.headerPixels} 个布局像素 ` +
        `< 地板 ${measured.floorPixels} · ${detail}`
    ).toBeGreaterThanOrEqual(measured.floorPixels);

    // 三、表头与数据行的**整数量**之差落在一个有依据的带宽里。口径取整数而不是
    // getBoundingClientRect 的小数：同一次渲染里两个引擎的小数量到的是两套数
    // （实测表头 30 两边一致，数据行 chromium 31 / webkit 31.38，末行 30.5 / 30.88），
    // 那点小数是引擎的度量噪声（末行 0.5 来自 :last-child 去掉下边框，另外 0.38 来自
    // WebKit 对 vertical-align: middle 的行内块的行盒计算），不是排版事实。
    //
    // 带宽是 2，**不要再收紧**：它已经被收紧两次、红了两次 CI
    // （先是 `Expected <= 0.5, Received 1`，再是 `Expected <= 1.5, Received 2`）。
    // 四次实测（同一份夹具，表头恒为 30）：
    //
    //   | 平台            | 表头 | 数据行（中位） | 差 |
    //   | --------------- | ---- | -------------- | -- |
    //   | macOS chromium  | 30   | 31             | 1  |
    //   | macOS webkit    | 30   | 31             | 1  |
    //   | Linux chromium  | 30   | 32             | 2  |
    //   | Linux webkit    | 30   | 32（31/32/32） | 2  |
    //
    // 这 1~2px 的差是 `border-collapse: collapse` 对那条 1px 分隔线的**劈法**不同：
    // 数据行上下各摊半像素、表头行没有上一行可摊，于是数据行总比表头高一点，Linux 比
    // macOS 多摊 1px。**没有任何 CSS 能把它抹平**，所以带宽下界必须 ≥2（0.5 会把它判红）。
    //
    // 反面单独说清楚：地板被摘掉时表头是 29，与数据行相差 2（macOS）/ 3（Linux）。
    // 也就是说「差 2」既是 Linux 的正常值、也是 macOS 的回归值——**任何单靠像素差的带宽
    // 都无法同时容纳前者并抓住后者**，两个区间在 2 这个点上正好重叠。所以回归由上面
    // 那条地板判据抓（与平台无关），这里的带宽只负责另一个方向：表头不许比数据行高太多。
    // 两条合起来才覆盖全部方向；谁想把 2 收紧到 1，先看这张表。
    //
    // 取中位数而不是首行/均值：末行因为 :last-child 去掉了下边框，恰好压在整数边界上
    // （小数量到 30.5 / 30.88），单看它会被那半像素带偏。
    expect(
      Math.abs(measured.headerPixels - measured.medianPixels),
      `表头与数据行不等高 —— ${detail} · 地板 ${measured.floorPixels} · ` +
        `数据行盒 ${measured.rowBoxes.join("/")}`
    ).toBeLessThanOrEqual(2);
  });

  test("失败行的状态列取 --danger，正常行不取", async ({ page }) => {
    await openSession(page, "errors");

    const measured = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--danger)";
      document.body.appendChild(probe);
      const danger = getComputedStyle(probe).color;
      probe.remove();

      const cells = [...document.querySelectorAll("main table tbody tr[data-row-index]")].map(
        (row) => {
          const cell = row.children[6] as HTMLElement;
          const style = getComputedStyle(cell);
          return { text: (cell.textContent ?? "").trim(), color: style.color, weight: style.fontWeight };
        }
      );
      return { danger, cells };
    });

    const failed = measured.cells.filter((cell) => cell.text === "失败");
    const ok = measured.cells.filter((cell) => cell.text === "正常");
    // 夹具健全性：这个会话里真的既有失败也有正常，否则下面两段断言都空转。
    expect(failed.length).toBeGreaterThan(0);
    expect(ok.length).toBeGreaterThan(0);

    for (const cell of failed) {
      expect(cell.color).toBe(measured.danger);
      expect(cell.weight).toBe("600");
    }
    for (const cell of ok) {
      expect(cell.color).not.toBe(measured.danger);
    }
  });

  test("130% 字号下表头不裁字，表格与页面都不横向溢出", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "设置" }).click();
    await page
      .getByRole("radiogroup", { name: "界面字号" })
      .getByRole("radio", { name: "130%" })
      .click();
    await page.getByRole("button", { name: "关闭" }).click();

    await openSession(page, "ansi");

    const measured = await page.evaluate(() => {
      const table = document.querySelector("main table") as HTMLTableElement;
      const wrap = table.parentElement as HTMLElement;
      const headers = [...table.querySelectorAll("thead th")].map((node) => {
        const element = node as HTMLElement;
        return {
          text: (element.textContent ?? "").trim(),
          clipped: element.scrollWidth > element.clientWidth + 1
        };
      });
      return {
        scale: getComputedStyle(document.documentElement).getPropertyValue("--font-scale").trim(),
        document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        wrapper: wrap.scrollWidth - wrap.clientWidth,
        headers
      };
    });

    // 缩放真的生效了才谈得上「130% 下不裁字」。
    expect(measured.scale).toBe("1.3");
    expect(measured.document).toBeLessThanOrEqual(1);
    expect(measured.wrapper).toBeLessThanOrEqual(1);
    for (const header of measured.headers) {
      expect(header.clipped, `表头「${header.text}」被裁`).toBe(false);
    }
  });

  test("展开行横跨整张表，右侧不留空档", async ({ page }) => {
    await openSession(page, "ansi");
    // 展开一条**有记录**的行：首行是「用户+LLM」合并行，展开后没有工具面板。
    await logTable(page)
      .locator('tr:has-text("Bash")')
      .first()
      .getByRole("button", { name: "展开" })
      .click();
    await expect(page.getByRole("region", { name: "工具输入" })).toBeVisible();

    const measured = await page.evaluate(() => {
      const cell = document.querySelector("main table tbody td[colspan]") as HTMLElement | null;
      if (!cell) return null;
      const table = cell.closest("table") as HTMLTableElement;
      return {
        span: Number(cell.getAttribute("colspan")),
        columns: table.querySelectorAll("thead th").length,
        gap: Math.round((table.getBoundingClientRect().right - cell.getBoundingClientRect().right) * 10) / 10
      };
    });

    expect(measured).not.toBeNull();
    // 少写一列在 jsdom 里看不出来：固定布局下展开面板右侧会空出一块。
    expect(measured!.span).toBe(measured!.columns);
    expect(measured!.gap, `展开行右边空出 ${measured!.gap}px`).toBeLessThanOrEqual(1);
  });
});

/**
 * 「筛选前后列宽不动」必须在一个**有行宽到能顶开列预算**的会话上验。
 *
 * 短夹具（ansi，5 行）验不出这条：内容宽度差不多时，`auto` 布局会照单全收
 * colgroup 声明的宽度，两种筛选态量出来一模一样（实测都是 158/98/404/…）——
 * 用例在回归真正发生时是绿的。合成长会话里每 10 轮有一条长消息，筛掉这些长行
 * 之后摘要列的内容需求塌下去，`auto` 下整表立刻重排。
 */
test.describe("筛选前后的列宽（含长/短两种内容）", () => {
  test.use({ scenario: largeScenario() });

  test("筛掉长摘要行之后每一列的宽度都不动", async ({ page }) => {
    await openSession(page, "long");
    const before = await headerWidths(page);
    const rowsBefore = await dataRows(page).count();

    // 长行只出现在每 10 轮里，所以「继续」留下的严格是一个更短、更窄的子集。
    await page.getByPlaceholder("搜索命令 / 路径 / 摘要…").fill("继续");
    await expect(dataRows(page).first()).toBeVisible();
    const rowsAfter = await dataRows(page).count();

    // 夹具健全性：筛选**真的**换了行集，否则「宽度没变」是一句空话。
    expect(rowsAfter).toBeGreaterThan(0);
    expect(rowsAfter).toBeLessThan(rowsBefore);

    const after = await headerWidths(page);
    expect(after).toHaveLength(before.length);
    after.forEach((width, index) => {
      expect(
        Math.abs(width - before[index]),
        `第 ${index + 1} 列：筛选前 ${before[index]} → 筛选后 ${width}`
      ).toBeLessThanOrEqual(1);
    });
  });
});

/**
 * 窗口化（虚拟滚动）下的列宽。现有夹具最多 17 行，而窗口化阈值下限是 20，
 * 所以别的用例**永远走不到**上下垫片这条路——而 `table-layout: fixed` 下
 * 「垫片行会不会把列宽带偏」正是最该验的一条。这里用合成的 60 轮会话把阈值
 * 开到 20，让垫片真的出现。
 */
test.describe("窗口化下的列宽", () => {
  test.use({ scenario: largeScenario() });

  test("上下垫片出现时列宽不动，滚到底最后一行可达", async ({ page }) => {
    await page.addInitScript((value) => {
      window.localStorage.setItem("cca-thresholds", value);
    }, WINDOW_ROW_THRESHOLDS);

    await openSession(page, "long");

    const rendered = await dataRows(page).count();
    expect(rendered).toBeLessThan(60); // 夹具健全性：窗口化真的生效了
    await expect(logTable(page).locator("tbody tr[aria-hidden='true']").first()).toBeAttached();

    const before = await headerWidths(page);
    // 垫片行本身**不带单元格**——列数由 colgroup 定死，垫片只是一个高度的行。
    // 一塞单元格就等于给这张表多认一列，所以这条要在**两个端点**各验一次：
    // 贴顶时只渲染下垫片、贴底时只渲染上垫片，少验一头就漏一头。
    await expectPadRowsCellLess(page);

    await page.evaluate(() => {
      const wrap = document.querySelector("main table")!.parentElement as HTMLElement;
      wrap.scrollTop = wrap.scrollHeight;
    });
    await expect(logTable(page)).toContainText("第 59 轮", { timeout: 10_000 });
    await expectPadRowsCellLess(page);

    const after = await headerWidths(page);
    expect(after).toHaveLength(before.length);
    after.forEach((width, index) => {
      expect(
        Math.abs(width - before[index]),
        `第 ${index + 1} 列：滚动前 ${before[index]} → 滚动后 ${width}`
      ).toBeLessThanOrEqual(1);
    });
  });
});