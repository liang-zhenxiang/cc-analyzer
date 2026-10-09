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
 * `web/package.json` 的 version：e2e 里「当前版本」的唯一事实来源。
 *
 * 写死它会让每一版归档截图的顶栏版本徽章都停在旧版本——v0.10.0 那一代就是
 * 桩忘了跟着发版走，截图在撒谎而没人发现。e2e 跑在 node 里，直接读文件；
 * 读不到或形状不对就抛错：仓库完整时这条路径不该有降级，静默降级只会把
 * 问题重新藏进截图。防「机制被退化成写死」由 scripts/check-e2e-mock-version.sh
 * 负责。
 */
export const APP_VERSION: string = (() => {
  const parsed: unknown = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    const version = (parsed as Record<string, unknown>).version;
    if (typeof version === "string" && version !== "") return version;
  }
  throw new Error("web/package.json 缺少可用的 version 字段——e2e 的版本桩依赖它");
})();

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
  { cwd: "/repo/usage-models", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b7a77", content: fixture("usage-dashboard-models.jsonl") },
  // 终端转义序列（颜色、进度回车、OSC 标题）的真身：ANSI 渲染的端到端与真机
  // 断言都靠它，没有它那几条断言会变成「空场景下恒真」。
  { cwd: "/repo/ansi", id: "3d2a5442-9c65-4b28-9c30-bb3d1a1b8a88", content: fixture("session-ansi.jsonl") }
];

/** 默认场景：八个项目、八份会话——正常、子 agent、解析增强、错误、时长模型、两个用量仪表盘夹具，加一份终端转义夹具 */
export function defaultScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    home: HOME,
    appData: APP_DATA,
    files: sessionsToFiles(SESSION_SEEDS),
    monitor: { port: 8090, alive: false },
    // 顶栏版本徽章读它；与 web/package.json 同源，截图上的版本号才是真的
    updater: { currentVersion: APP_VERSION },
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
  // `:\s*`：夹具不全是紧凑 JSON——compact-session.jsonl 的字段冒号后带空格，
  // 只匹配无空格形式会把整个平移变成空操作（事件留在窗外、面板读到 0 次）。
  return content.replace(/"timestamp":\s*"([^"]+)"/g, (match, iso: string) => {
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

/** 错误夹具里最新的活动日（error-session 的 2026-10-03）——错误场景的平移锚点 */
const ERROR_FIXTURE_NEWEST_DAY = Date.UTC(2026, 9, 3);

/** 「最新活动日在昨天」的共用偏移（天）：全部场景共用同一平移策略。 */
function offsetToYesterday(newestDay: number): number {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const target = Date.UTC(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate());
  return Math.round((target - newestDay) / 86_400_000);
}

/**
 * 默认场景 + 错误夹具会话（/repo/error-demo，两个自然日：API 错误 3 +
 * 工具错误 4 + 一次被排除的 AskUserQuestion 拒绝 + 一条 sidechain 失败）。
 *
 * 「错误」档面板的端到端与真机门禁都靠它；平移锚点是**全部**（含错误夹具）
 * 里最新的 timestamp，会话之间的相对日期保持不变。窗内另有 usage 两个夹具
 * （无错误），空态分支用 recentActivityScenario（不含错误夹具）覆盖。
 */
export function errorScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const base = defaultScenario(overrides);
  const offset = offsetToYesterday(ERROR_FIXTURE_NEWEST_DAY);
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(base.files)) {
    files[path] = path.endsWith(".jsonl") ? shiftDays(content, offset) : content;
  }
  files[`${HOME}/.claude/projects/-repo-error-demo/error-session.jsonl`] = shiftDays(
    fixture("error-session.jsonl"),
    offset
  );
  return { ...base, files };
}

/**
 * 默认场景 + 压缩夹具会话（/repo/compact-demo，2 次压缩：auto + manual）。
 *
 * 上下文标签页、日志表的压缩带行与真机门禁的「上下文」步骤都靠它——夹具里
 * 还混着 future-widget / quantum-latch 两类未识别行，解析覆盖率 chip 的
 * 「N 行未识别」态也因此被这套场景覆盖。
 */
export function compactScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const base = defaultScenario(overrides);
  return {
    ...base,
    files: {
      ...base.files,
      [`${HOME}/.claude/projects/-repo-compact-demo/compact-session.jsonl`]: fixture(
        "compact-session.jsonl"
      )
    }
  };
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

/**
 * 坏场景：`~/.claude/projects` **一个字节都没声明**。
 *
 * e2e 的虚拟文件系统对未声明的目录是**抛错**而不是返回空数组——静默的空列表
 * 会把夹具错误伪装成功能缺陷。这里刻意留着那个尖角：它是唯一能稳定触发
 * 「应用真的报错了」的路径，而错误态要测的正是这条路径。
 *
 * 空场景只需要多声明一行 `emptyDirs` 就是好场景，所以两者的差别是**故意的**：
 * 前者验「真的没有会话」，后者验「真的出错了」。
 */
export function brokenScanScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    home: HOME,
    appData: APP_DATA,
    files: {},
    monitor: { port: 8090, alive: false },
    updater: { currentVersion: APP_VERSION },
    ...overrides
  };
}

/**
 * 足够长的一份会话，用来把日志表**推过窗口化阈值**。
 *
 * 现有夹具最多 17 行，而窗口化的阈值下限是 20，所以「虚拟滚动 + 定宽列」这条
 * 路径在别的场景里根本走不到：垫片行（`<tr aria-hidden>`）不出现，列宽也就没被
 * 真正考验过。这里在内存里合成 60 轮对话（≈60 行），配合 `logWindowRows: 20`
 * 就能让上下垫片真的出现。**不写进 `tests/fixtures/`**：它是给布局用的压力夹具，
 * 不是解析夹具，混进共享夹具目录会让单测那边多出一份没人读的大文件。
 */
export function largeScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const sessionId = "3d2a5442-9c65-4b28-9c30-bb3d1a1c1a99";
  const cwd = "/repo/long";
  const start = Date.UTC(2026, 0, 3, 10, 0, 0);
  const lines: string[] = [];
  for (let turn = 0; turn < 60; turn += 1) {
    const userAt = new Date(start + turn * 60_000).toISOString();
    const assistantAt = new Date(start + turn * 60_000 + 2_000).toISOString();
    // 每 10 轮一条长消息，其余是「继续」这种短消息。
    // 这条夹具是给**列宽**用的：内容驱动布局的毛病只在「有行宽到能顶开列预算」时
    // 才显形（实测短夹具上 auto 与 fixed 量出来一模一样，那样的用例抓不住回归），
    // 所以它必须同时含长短两种内容，让「筛掉长行」成为一次真的列宽压力。
    const longTurn = turn % 10 === 0;
    const userText = longTurn
      ? `第 ${turn} 轮：${"把这段逻辑再往下拆一层，".repeat(12)}`
      : `第 ${turn} 轮：继续`;
    const assistantText = longTurn ? `第 ${turn} 轮回答` : `第 ${turn} 轮回答：继续`;
    lines.push(
      JSON.stringify({
        type: "user",
        sessionId,
        cwd,
        timestamp: userAt,
        uuid: `long-${turn}-user`,
        parentUuid: turn === 0 ? null : `long-${turn - 1}-assistant`,
        isSidechain: false,
        message: { role: "user", content: userText }
      })
    );
    lines.push(
      JSON.stringify({
        type: "assistant",
        sessionId,
        cwd,
        timestamp: assistantAt,
        uuid: `long-${turn}-assistant`,
        parentUuid: `long-${turn}-user`,
        isSidechain: false,
        message: {
          id: `long-msg-${turn}`,
          role: "assistant",
          model: "claude-sonnet-4",
          content: [{ type: "text", text: assistantText }],
          usage: { input_tokens: 12, cache_read_input_tokens: 3, output_tokens: 34 }
        }
      })
    );
  }

  const base = defaultScenario(overrides);
  return {
    ...base,
    files: {
      ...base.files,
      [`${HOME}/.claude/projects/${projectDir(cwd)}/${sessionId}.jsonl`]: `${lines.join("\n")}\n`
    }
  };
}

/** 让窗口化在 20 行就生效——阈值下限，最小的夹具也能触发上下垫片。 */
export const WINDOW_ROW_THRESHOLDS = JSON.stringify({ logWindowRows: 20 });

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
