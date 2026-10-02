import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";
import { installTauriMock, type MockScenario } from "./tauri-mock";

const here = path.dirname(fileURLToPath(import.meta.url));

/** 读取 `web/tests/fixtures/` 下的夹具——与单元测试共用同一批数据 */
export function fixture(name: string): string {
  return readFileSync(path.join(here, "..", "tests", "fixtures", name), "utf8");
}

/**
 * 真实 Claude Code 把项目目录名取为 cwd 的路径分隔符替换成 `-`
 * （`/repo/demo` → `-repo-demo`），这里照做，免得夹具与真实布局不一致。
 */
function projectDir(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

const HOME = "/Users/e2e";
const APP_DATA = "/Users/e2e/Library/Application Support/io.github.liang-zhenxiang.cc-analyzer";

type SessionSeed = { cwd: string; id: string; content: string };

function sessionsToFiles(seeds: SessionSeed[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const seed of seeds) {
    // 夹具正文的 cwd 是写作时的占位；种子声明的 cwd 才是文件实际装载到的
    // 项目目录。统一改写让两者一致，否则 title 提示与分组目录对不上。
    const content = seed.content.replace(/"cwd":"[^"]*"/g, `"cwd":"${seed.cwd}"`);
    files[`${HOME}/.claude/projects/${projectDir(seed.cwd)}/${seed.id}.jsonl`] = content;
  }
  return files;
}

const SESSION_SEEDS: SessionSeed[] = [
  { cwd: "/repo/demo", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11", content: fixture("session-basic.jsonl") },
  { cwd: "/repo/subagent", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b2a22", content: fixture("session-subagent.jsonl") },
  { cwd: "/repo/enhanced", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b3a33", content: fixture("session-parser-enhanced.jsonl") },
  { cwd: "/repo/errors", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b4a44", content: fixture("session-errors.jsonl") },
  { cwd: "/repo/duration", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b5a55", content: fixture("session-duration-model.jsonl") },
  { cwd: "/repo/usage-days", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b6a66", content: fixture("usage-dashboard-days.jsonl") },
  { cwd: "/repo/usage-models", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b7a77", content: fixture("usage-dashboard-models.jsonl") }
];

/** 默认场景：七个项目、七份会话——正常、子 agent、解析增强、错误、时长模型，加两个用量仪表盘夹具 */
export function defaultScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    home: HOME,
    appData: APP_DATA,
    files: sessionsToFiles(SESSION_SEEDS),
    monitor: { port: 8090, alive: false },
    // 顶栏版本徽章读它；截图与断言都该看到一个正常的版本号
    updater: { currentVersion: "0.10.0" },
    claudeStdout: [
      "## 会话概览",
      "",
      "- 总时长：3 分 12 秒",
      "- 工具调用：7 次",
      "",
      "## 主要发现",
      "",
      "1. 首次响应耗时偏长。",
      "2. 子 agent 占用了约三分之一的墙钟时间。"
    ],
    savePath: `${HOME}/report.md`,
    ...overrides
  };
}

/** 夹具里最新的活动日（usage-dashboard-models 的 2026-10-01）——时间平移的锚点 */
const NEWEST_FIXTURE_DAY = Date.UTC(2026, 9, 1);

/** 把内容里全部 `"timestamp"` 整体平移 N 天（UTC 日历日，保留当天时刻）。 */
export function shiftDays(content: string, offsetDays: number): string {
  return content.replace(/"timestamp":"([^"]+)"/g, (match, iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return match;
    date.setUTCDate(date.getUTCDate() + offsetDays);
    return `"timestamp":"${date.toISOString()}"`;
  });
}

/**
 * 把默认场景的会话整体平移到「最新活动日在昨天」。
 *
 * 用量仪表盘的时间窗相对 `Date.now()`，而夹具时间戳是写死的——不平移，
 * 三天后相关断言就会假红（或者更糟：假绿）。整场景统一偏移，会话之间的
 * 相对日期保持不变；旧夹具（2026-01-02、1970）平移后依然在窗外，
 * 窗内就只有两个 usage 夹具，计数因此是确定的。
 */
export function recentActivityScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const target = Date.UTC(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
  const offsetDays = Math.round((target - NEWEST_FIXTURE_DAY) / 86_400_000);
  const base = defaultScenario(overrides);
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(base.files)) {
    files[path] = path.endsWith(".jsonl") ? shiftDays(content, offsetDays) : content;
  }
  return { ...base, files };
}

/** 空场景：家目录存在但没有任何会话 */
export function emptyScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    home: HOME,
    appData: APP_DATA,
    files: {},
    emptyDirs: [`${HOME}/.claude/projects`],
    ...overrides
  };
}

type Fixtures = { scenario: MockScenario };

export const test = base.extend<Fixtures>({
  scenario: async ({}, use) => {
    await use(defaultScenario());
  },

  page: async ({ page, scenario }, use) => {
    await page.addInitScript(installTauriMock, scenario);
    await use(page);
  }
});

export { expect };
