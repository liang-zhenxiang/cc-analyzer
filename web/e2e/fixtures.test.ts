import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_VERSION,
  calendarScenario,
  changedFilesScenario,
  compactScenario,
  costScenario,
  defaultScenario,
  errorScenario,
  handoffScenario,
  monitorConsoleScenario,
  pulseScenario,
  recentActivityScenario,
  roundCCScenario,
  roundDDScenario,
  roundEEScenario,
  roundFFScenario,
  roundGGScenario,
  roundHHScenario,
  roundIIScenario,
  checkupScenario
} from "./fixtures";
import { milestonesScenario } from "../tests/fixtures/milestones-scenario";

/** 注释剥离后的 `screenshots.spec.ts`；场景块与「以某个场景打底」的别名都从这里解析。 */
const SCREENSHOTS_SOURCE = readFileSync(
  resolve(process.cwd(), "e2e/screenshots.spec.ts"),
  "utf8"
).replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * 归档截图的顶栏版本徽章读桩的 `updater.currentVersion`；桩缺省回落到
 * `0.0.0-mock`，而 `VersionBadge` 会把 `-` 之后截掉并加「Beta」胶囊。
 *
 * 这类漏传不该逐个靠肉眼看截图发现（`calendarScenario` 就是这么漏到
 * `usage-day-*` 里的，Issue #365）：这里扫 `screenshots.spec.ts` 的每一条
 * `test.use({ scenario: … })`——要么调用处显式传了 `updater`，要么该无参场景
 * 自己就带 `APP_VERSION`。
 */
function screenshotScenarioBlocks(): string[] {
  const lines = SCREENSHOTS_SOURCE.split("\n");
  const blocks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("test.use({")) continue;
    let block = lines[index];
    let cursor = index;
    while (!block.includes("});") && cursor + 1 < lines.length) {
      cursor += 1;
      block += `\n${lines[cursor]}`;
    }
    blocks.push(block);
  }
  return blocks;
}

/** `screenshots.spec.ts` 里出现过的场景工厂——新增截图场景要在这里登记。 */
const SCENARIO_FACTORIES: Record<string, () => { updater?: { currentVersion?: string } }> = {
  defaultScenario,
  recentActivityScenario,
  errorScenario,
  compactScenario,
  costScenario,
  roundCCScenario,
  roundDDScenario,
  calendarScenario,
  changedFilesScenario,
  pulseScenario,
  monitorConsoleScenario,
  milestonesScenario,
  roundEEScenario,
  roundFFScenario,
  roundGGScenario,
  roundHHScenario,
  roundIIScenario,
  handoffScenario,
  checkupScenario
};

describe("截图归档的版本号", () => {
  it("calendarScenario 自带真实版本号（修复前 usage-day-* 印的是 v0.0.0 Beta）", () => {
    expect(calendarScenario().updater?.currentVersion).toBe(APP_VERSION);
  });

  it("每条截图场景要么显式传 updater，要么无参场景自带 APP_VERSION", () => {
    const blocks = screenshotScenarioBlocks();
    expect(blocks.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    // 对象字面量写法以某个场景打底（`const base = recentActivityScenario()`），
    // 版本号来自那个场景；把别名映射回工厂名。
    const baseFactories = new Map<string, string>();
    for (const match of SCREENSHOTS_SOURCE.matchAll(/const\s+(\w+)\s*=\s*(\w+)\s*\(/g)) {
      if (SCENARIO_FACTORIES[match[2]]) baseFactories.set(match[1], match[2]);
    }

    for (const block of blocks) {
      if (block.includes("updater:")) continue;

      // 两种写法：`scenario: factory(...)`，或以某个场景打底的
      // `scenario: { ...base, files: ... }` 对象字面量。
      const direct = /scenario:\s*(\w+)\s*\(/.exec(block)?.[1];
      const spreadAlias = direct ? undefined : /\.\.\.\s*(\w+)/.exec(block)?.[1];
      const name = direct ?? (spreadAlias ? baseFactories.get(spreadAlias) : undefined);
      expect(name, `截图场景块无法解析：\n${block}`).toBeTruthy();

      const factory = SCENARIO_FACTORIES[name as string];
      expect(
        factory,
        `screenshots.spec.ts 用了未登记的截图场景 ${name}，请把它加进 SCENARIO_FACTORIES`
      ).toBeTruthy();
      if (factory().updater?.currentVersion !== APP_VERSION) offenders.push(name as string);
    }
    expect(offenders).toEqual([]);
  });
});
