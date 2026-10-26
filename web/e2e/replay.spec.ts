import { test, expect, defaultScenario } from "./fixtures";
import type { Page } from "@playwright/test";
import { sessionItems } from "./selectors";

/**
 * 「会话重放」（Round AA）的端到端验收：真浏览器里走完整用户流。
 *
 * 只读 DOM 事实（`data-probe` 锚点 + `aria-*`），不碰实现里的 CSS Module 类名。
 * 所有断言都带**具体数值或具体文案**——「存在某个元素」不在验收范围内：
 *
 * - 夹具用 `defaultScenario()` 里既有的两个会话：`/repo/demo`（session-basic，
 *   6 条记录、56.0s、无错误无压缩）与 `/repo/errors`（session-errors，4 条记录、
 *   4.00s、有首次失败）。时间戳在同一份夹具里**互不相同**（0 / 25% / 50% / 100%），
 *   这样 ←/→ 的每一步都落在确定的事件上；`/repo/demo` 末两条同刻（11:05:01），
 *   只用来验 Home/End 与几何，不拿它验逐事件步进。
 * - 断言里的时刻不写死：夹具时间戳会被渲染成本机时区，所以文案里带时刻的地方
 *   统一用 `\d{2}:\d{2}:\d{2}`，带**数量与金额**的地方写死（「共 6 条」「$0.00」）。
 */

async function openSession(page: Page, query: string) {
  await page.goto("/");
  await page.getByPlaceholder("搜会话 ID 或目录…").fill(query);
  await sessionItems(page).first().click();
  await expect(page.getByLabel("会话图状态")).toContainText("会话图已加载", { timeout: 15_000 });
}

async function openReplay(page: Page, query: string) {
  await openSession(page, query);
  await page.getByRole("tab", { name: "重放", exact: true }).click();
  await expect(page.locator("[data-probe='replay-root']")).toBeVisible();
  await expect(page.getByLabel("会话胶片")).toBeVisible();
}

function lane(page: Page) {
  return page.getByRole("slider", { name: "重放进度" });
}

async function laneValue(page: Page): Promise<number> {
  return Number(await lane(page).getAttribute("aria-valuenow"));
}

async function laneGeometry(page: Page) {
  const box = await lane(page).boundingBox();
  if (!box) throw new Error("重放轨道没有几何盒");
  return box;
}

test.describe("会话重放", () => {
  test.use({ scenario: defaultScenario() });

  test("进入重放：舞台、胶片带与读数落在真实几何上", async ({ page }) => {
    await openReplay(page, "demo");

    const film = page.getByLabel("会话胶片");
    // 胶片带的 sr-only 摘要：数量、种类分布、墙钟与最长停顿都写死为夹具事实。
    await expect(film).toContainText("本次会话墙钟 56.0s，共 6 条记录：LLM 3，工具 2，等用户 1");
    await expect(film).toContainText("最长停顿 50.0s");

    // 舞台高度是设计规格的下界（≥148），不是「看得见就行」。
    const stageHeight = await page
      .locator("[data-probe='replay-stage']")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(stageHeight).toBeGreaterThanOrEqual(148);

    const filmHeight = await page
      .locator("[data-probe='replay-film']")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.round(filmHeight)).toBe(112);

    const laneBox = await laneGeometry(page);
    expect(laneBox.width).toBeGreaterThan(400);
    await expect(lane(page)).toHaveAttribute("aria-valuenow", "0");
    await expect(lane(page)).toHaveAttribute("aria-valuetext", /，第一个事件之前$/);

    // 两枚跃点都是真实按钮，名字里带夹具算出来的具体读数。
    await expect(
      film.getByRole("button", { name: "最烧一分钟 · 142 tok · 6 个事件", exact: true })
    ).toBeVisible();
    await expect(film.getByRole("button", { name: "最长停顿 · 50.0s", exact: true })).toBeVisible();

    // 走带按钮把播放头送到终点：读数、舞台收尾文案、已播放计数一起到账。
    await page.getByRole("button", { name: "跳到结尾", exact: true }).click();
    await expect(lane(page)).toHaveAttribute("aria-valuenow", "100");
    await expect(page.getByLabel("重放舞台")).toContainText(
      "重放结束 · 共 6 条 · 墙钟 56.0s"
    );
    const reads = page.locator("[data-probe='replay-reads']");
    const readsText = await reads.innerText();
    expect(readsText).toMatch(/消息\s+6\s+工具\s+2/);
    expect(readsText).toMatch(/prompt\s+55\s+output\s+87/);
    expect(readsText).toMatch(/成本\s+\$0\.00/);
  });

  test("播放与暂停：播放头按真实时间前进，暂停后停在同一格", async ({ page }) => {
    // 用 /repo/errors（4 秒跨度、四个不同时刻）：播放 800ms 已越过第一个事件，
    // 暂停后 aria-live 有明确的当前位置可播报。
    await openReplay(page, "errors");
    const slider = lane(page);

    // 不自动播放：进视图 300ms 后播放头仍在 0。
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await page.waitForTimeout(300);
    await expect(slider).toHaveAttribute("aria-valuenow", "0");

    // 焦点在轨道（视图内）时 Space 播放。
    await slider.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    const live = page.locator("[data-probe='replay-root'] [role='status']");
    await expect(live).toHaveText("播放中，暂停后会播报当前位置");

    // 用探针值证明播放头**真的前进**（「片长 60s」把 4 秒会话铺满一分钟，
    // 所以 1% 就是可观察的最低刻度；等它到 1 再暂停）。
    await expect
      .poll(async () => laneValue(page), { timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);
    expect(await laneValue(page)).toBeGreaterThan(0);

    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "播放", exact: true })).toBeVisible();
    const paused = await laneValue(page);
    await page.waitForTimeout(450);
    expect(await laneValue(page)).toBe(paused);
  });

  test("键盘：End/←/→/Home 在 /repo/errors 的四个不同时刻间步进", async ({ page }) => {
    await openReplay(page, "errors");
    const slider = lane(page);
    const stage = page.getByLabel("重放舞台");
    await slider.focus();

    await page.keyboard.press("End");
    await expect(slider).toHaveAttribute("aria-valuenow", "100");
    await expect(stage).toContainText("重放结束 · 共 4 条 · 墙钟 4.00s");

    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "50");
    await expect(slider).toHaveAttribute("aria-valuetext", /，第 3 \/ 4 条，LLM\+工具，command failed$/);
    await expect(stage).toContainText("第 3 / 4 条");
    await expect(stage).toContainText("时长 1.50s");

    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "25");
    await expect(stage).toContainText("第 2 / 4 条");

    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "50");

    await page.keyboard.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
    await expect(stage).toContainText("播放头在第一个事件之前");

    // Shift+←/→ 在轨道上微调 1%：0 → 1 → 0。
    await page.keyboard.press("Shift+ArrowRight");
    await expect(slider).toHaveAttribute("aria-valuenow", "1");
    await page.keyboard.press("Shift+ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");
  });

  test("焦点在播放按钮上按 Space 只切换一次", async ({ page }) => {
    await openReplay(page, "errors");

    // 第一次 Space：若按钮的原生 click 与视图级 keydown 各切一次，状态会回到
    // 「暂停」——标签与播放头都不会前进。两条断言同时成立才算只触发一次。
    const playButton = page.getByRole("button", { name: "播放", exact: true });
    await playButton.focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "播放", exact: true })).toHaveCount(0);
    // 真实时钟在 60s 片长下 350ms 只走约 0.6%，整机负载高时 rAF 可能还没
    // 提交第一帧；用 poll 等它真的动起来（3 秒兜底），而不是赌固定延时。
    await expect.poll(async () => laneValue(page), { timeout: 3_000 }).toBeGreaterThan(0);

    // 第二次 Space：暂停，且此后播放头不再动。
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "播放", exact: true })).toBeVisible();
    const paused = await laneValue(page);
    await page.waitForTimeout(400);
    expect(await laneValue(page)).toBe(paused);
  });

  test("跃点：点「首次失败」把播放头落到该时刻，舞台讲同一件事", async ({ page }) => {
    await openReplay(page, "errors");
    const stage = page.getByLabel("重放舞台");
    const slider = lane(page);

    await page
      .getByLabel("会话胶片")
      .getByRole("button", { name: "首次失败 · LLM+工具 · command failed", exact: true })
      .click();

    await expect(slider).toHaveAttribute("aria-valuenow", "50");
    await expect(slider).toHaveAttribute("aria-valuetext", /，第 3 \/ 4 条，LLM\+工具，command failed$/);
    await expect(stage).toContainText("第 3 / 4 条");
    await expect(stage).toContainText("失败");
    await expect(stage).toContainText("command failed");
    await expect(stage).toContainText("时长 1.50s");

    // aria-live 只在非播放态播报事件切换：内容 = 时刻 · 事件 · 细节。
    await expect(page.locator("[data-probe='replay-root'] [role='status']")).toHaveText(
      /^\d{2}:\d{2}:\d{2} · LLM\+工具 · command failed$/
    );

    // 已播放读数与舞台同步：3 条消息、2 次工具、1 个错误、花了 $0.00。
    const readsText = await page.locator("[data-probe='replay-reads']").innerText();
    expect(readsText).toMatch(/消息\s+3\s+工具\s+2\s+错误\s+1/);
    expect(readsText).toMatch(/成本\s+\$0\.00/);

    // 播放头几何上确实落在轨道内。
    const laneBox = await laneGeometry(page);
    const head = await page.locator("[data-probe='replay-head']").boundingBox();
    if (!head) throw new Error("播放头没有几何盒");
    expect(head.x).toBeGreaterThanOrEqual(laneBox.x - 1);
    expect(head.x).toBeLessThanOrEqual(laneBox.x + laneBox.width + 1);
  });

  test("胶片带：点击与拖动都把播放头放到指针位置", async ({ page }) => {
    await openReplay(page, "errors");
    const box = await laneGeometry(page);
    const y = box.y + box.height / 2;

    // 点 75%：轨道宽度是确定的事实，容差只留给亚像素取整。
    await page.mouse.click(box.x + box.width * 0.75, y);
    const clicked = await laneValue(page);
    expect(clicked).toBeGreaterThanOrEqual(74);
    expect(clicked).toBeLessThanOrEqual(76);
    await expect(lane(page)).toHaveAttribute("aria-valuetext", /，停顿中（\d{2}:\d{2}:\d{2} 至 \d{2}:\d{2}:\d{2}，2 秒）$/);
    await expect(page.getByLabel("重放舞台")).toContainText("停顿 2 秒");

    // 从 25% 拖到 55%：拖动期间连续 seek，松手后停在指针处。
    await page.mouse.move(box.x + box.width * 0.25, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, y, { steps: 10 });
    await page.mouse.up();
    const dragged = await laneValue(page);
    expect(dragged).toBeGreaterThanOrEqual(54);
    expect(dragged).toBeLessThanOrEqual(56);
  });

  test("跳过停顿：开关状态与倍速读数一起切换", async ({ page }) => {
    await openReplay(page, "demo");

    const skip = page.getByRole("button", { name: "跳过停顿", exact: true });
    await expect(skip).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("约 0.9×，60 秒看完", { exact: true })).toBeVisible();

    await skip.click();
    await expect(skip).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("空档已跳过，时间轴不再等速", { exact: true })).toBeVisible();
    await expect(page.getByText("约 0.9×，60 秒看完", { exact: true })).toHaveCount(0);

    await skip.click();
    await expect(skip).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("约 0.9×，60 秒看完", { exact: true })).toBeVisible();
  });
});

test.describe("会话重放 · 960×640 窄窗", () => {
  test.use({ scenario: defaultScenario(), viewport: { width: 960, height: 640 } });

  test("重放视图没有横向溢出，也没有第二条竖向滚动条", async ({ page }) => {
    await openReplay(page, "demo");

    const facts = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-probe='replay-root']");
      const stage = document.querySelector<HTMLElement>("[data-probe='replay-stage']");
      const film = document.querySelector<HTMLElement>("[data-probe='replay-film']");
      const laneEl = document.querySelector<HTMLElement>("[data-probe='replay-lane']");
      const main = document.querySelector<HTMLElement>("main");
      if (!root || !stage || !film || !laneEl || !main) throw new Error("重放锚点缺失");
      const rootRect = root.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const filmRect = film.getBoundingClientRect();
      const laneRect = laneEl.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      let nestedScrollers = 0;
      for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
        const overflowY = getComputedStyle(el).overflowY;
        if (overflowY === "auto" || overflowY === "scroll") nestedScrollers += 1;
      }
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        docScrollHeight: document.documentElement.scrollHeight,
        docClientHeight: document.documentElement.clientHeight,
        rootScrollWidth: root.scrollWidth,
        rootClientWidth: root.clientWidth,
        rootOverflowY: getComputedStyle(root).overflowY,
        rootRectRight: rootRect.right,
        mainScrollWidth: main.scrollWidth,
        mainClientWidth: main.clientWidth,
        mainRight: mainRect.right,
        stageHeight: stageRect.height,
        stageRight: stageRect.right,
        filmHeight: filmRect.height,
        filmRight: filmRect.right,
        laneWidth: laneRect.width,
        laneRight: laneRect.right,
        nestedScrollers
      };
    });

    // 文档与 main 都没有横向溢出（设计 §13.2 不变量 1）。
    expect(facts.docScrollWidth).toBeLessThanOrEqual(facts.docClientWidth + 1);
    expect(facts.mainScrollWidth).toBeLessThanOrEqual(facts.mainClientWidth + 1);
    expect(facts.rootScrollWidth).toBeLessThanOrEqual(facts.rootClientWidth + 1);

    // 文档本身不滚：竖直方向只有应用自己那一条滚动轴。
    expect(facts.docScrollHeight).toBeLessThanOrEqual(facts.docClientHeight + 1);

    // 重放内部没有任何 auto/scroll 容器（.lane 是 hidden），舞台不超出 main。
    expect(facts.nestedScrollers).toBe(0);
    expect(facts.rootOverflowY).toBe("visible");
    expect(facts.stageRight).toBeLessThanOrEqual(facts.mainRight + 0.5);
    expect(facts.stageHeight).toBeGreaterThanOrEqual(148);
    expect(facts.rootRectRight).toBeLessThanOrEqual(facts.docClientWidth + 0.5);

    // 胶片带高度与轨道宽度在窄窗下仍满足规格；轨道右边界不越过胶片带。
    expect(Math.round(facts.filmHeight)).toBe(112);
    expect(facts.laneWidth).toBeGreaterThanOrEqual(400);
    expect(facts.laneRight).toBeLessThanOrEqual(facts.filmRight + 0.5);
  });
});
