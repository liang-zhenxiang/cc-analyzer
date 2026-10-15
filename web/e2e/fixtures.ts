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

/** 工具统计夹具里最新的活动日（tool-census 的 2026-10-03）——平移锚点。 */
const TOOL_CENSUS_NEWEST_DAY = Date.UTC(2026, 9, 3);

/**
 * 默认场景 + 工具统计夹具会话（/repo/census-demo，两个自然日）：主链 13 次
 * tool_use（含 Skill×2、mcp 3 段 + 2 段防御名、Agent×1 带 totalToolUseCount=2）
 * + sidechain 2 次（Bash / Skill maintain-loop）。
 *
 * 「工具与 skill」面板的端到端与归档截图靠它。窗内**只有这份夹具有工具调用**
 * （默认场景的两个 usage 夹具无 tool_use，其余会话平移后在窗外），面板计数因此
 * 是确定值。平移锚点取全部夹具里最新者（= 本夹具的 10-03，与错误场景同日）。
 */
export function toolCensusScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const base = defaultScenario(overrides);
  const offset = offsetToYesterday(TOOL_CENSUS_NEWEST_DAY);
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(base.files)) {
    files[path] = path.endsWith(".jsonl") ? shiftDays(content, offset) : content;
  }
  files[`${HOME}/.claude/projects/-repo-census-demo/tool-census-session.jsonl`] = shiftDays(
    fixture("tool-census-session.jsonl"),
    offset
  );
  return { ...base, files };
}

/**
 * 默认场景 + 改动文件夹具会话（/repo/changed-demo，2026-09-20 一个下午）：
 * 文件 A（cwd 内：Read ×2 → Edit ×2 → Write(create) → 失败 Edit → 子链 Edit）、
 * 文件 B（仅 Read）、文件 C（cwd 外 /etc/hosts 的 Edit），另含 snapshot / delta /
 * attachment / cost-state 四行已登记类型。「改动」标签页的端到端与归档截图靠它。
 * 改动视图没有时间窗概念，不需要平移。
 *
 * **时间戳刻意比 error-session 的最新（2026-10-03）早 13 天**：真机门禁把全部
 * 夹具整体平移到「最新活动日 = 昨天」，相对间距不变——本夹具若只早两三天，
 * 平移后会落进「近 7 天」窗口，它那条 is_error 的 Edit 就被错误档算成第 8 条
 * （真机门禁抓到过一次）。13 天 > 窗口 7 天 + 舍入余量，落在窗外。
 */
export function changedFilesScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const base = defaultScenario(overrides);
  return {
    ...base,
    files: {
      ...base.files,
      [`${HOME}/.claude/projects/-repo-changed-demo/changed-files-session.jsonl`]: fixture(
        "changed-files-session.jsonl"
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

/**
 * 「按会话的配额归因」场景（Issue #151）：**当前 5 小时窗口**里一定有内容。
 *
 * 窗口是相对 `Date.now()` 算出来的，夹具就绝不能写死日期——写死的日期过几天
 * 就把窗内会话甩到窗外，断言会以「面板没渲染」这种毫无线索的方式假红。这里照
 * `largeScenario` 的做法在内存里合成 JSONL，并且**只用自造会话**（`emptyScenario`
 * 打底）：默认场景那几个夹具离今天只有几天，机器的当前时刻一旦落进它们的窗口，
 * 「6 个会话」这类计数就会被多出来的行打乱。空场景 + 自造会话把窗内成员锁死。
 *
 * 每个会话两条记录：首条 `user` 定标题，一条 `assistant` 带 usage。时间偏移都在
 * 4 小时以内、且靠后不超过 30 分钟一格，整段落在同一个 `[now - 4h, now + 1h)`
 * 窗口里，跨不过 5 小时的边界。会话 i（从 0 数）的 token 总量按阶梯递减
 * `(sessions - i) * 100_000`：3 个会话是 50.0 / 33.3 / 16.7，6 个会话刚好走
 * 「Top 5 + 其余 1 个会话」那条分支。
 *
 * @param options.sessions 造几个会话，默认 3（超过 5 个才会出现余项行）
 * @param options.withUsage 给 false 时 assistant 记录不带 usage：窗口里有记录、
 *   但没有可归因的消耗（窗口总量为 0），覆盖「整块不渲染」那条分支
 */
export function quotaAttributionScenario(
  options: { sessions?: number; withUsage?: boolean } = {}
): MockScenario {
  const count = Math.max(1, options.sessions ?? 3);
  const withUsage = options.withUsage ?? true;
  const now = Date.now();
  const files: Record<string, string> = {};

  for (let index = 0; index < count; index += 1) {
    const ordinal = index + 1;
    const cwd = `/repo/quota-attr-${ordinal}`;
    const sessionId = `3d2a5442-9c65-4b28-9c30-bb3d1a1d${String(ordinal).padStart(4, "0")}`;
    const startedAt = new Date(now - (4 - index * 0.5) * 3_600_000);
    const repliedAt = new Date(startedAt.getTime() + 90_000);
    // 四类计数器之和正好是阶梯值：input 20% + output 30% + cache_read 50%。
    const tokens = (count - index) * 100_000;
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId,
        cwd,
        timestamp: startedAt.toISOString(),
        uuid: `quota-${ordinal}-user`,
        parentUuid: null,
        isSidechain: false,
        message: { role: "user", content: `窗口归因夹具会话 ${ordinal}` }
      }),
      JSON.stringify({
        type: "assistant",
        sessionId,
        cwd,
        timestamp: repliedAt.toISOString(),
        uuid: `quota-${ordinal}-assistant`,
        parentUuid: `quota-${ordinal}-user`,
        isSidechain: false,
        message: {
          id: `quota-msg-${ordinal}`,
          role: "assistant",
          model: "claude-sonnet-4",
          content: [{ type: "text", text: `第 ${ordinal} 个会话的回答` }],
          ...(withUsage
            ? {
                usage: {
                  input_tokens: tokens / 5,
                  output_tokens: (tokens * 3) / 10,
                  cache_read_input_tokens: tokens / 2
                }
              }
            : {})
        }
      })
    ];
    files[`${HOME}/.claude/projects/${projectDir(cwd)}/${sessionId}.jsonl`] =
      `${lines.join("\n")}\n`;
  }

  const base = emptyScenario();
  return { ...base, files };
}

/**
 * 「本机有会话、但所选区间里一条都没有」场景（Issue #149 用量快照的 e2e）。
 *
 * 快照的整篇空态分支（`range.kpi.sessions === 0`）只在**区间为空**时成立，
 * 而 `emptyScenario()` 是「一条会话都没有」——那一档页面走的是整页空态
 * 「还没有可统计的会话」，连页头带导出按钮都不渲染，按钮能不能点根本无从谈起。
 * 要覆盖空态产物，就必须让**扫描有结果、区间为空**同时成立。
 *
 * 时间戳相对 `Date.now()` 取 200 天前：7 / 30 / 90 三档都够不着它，断言因此
 * 不随运行日期漂移（写死日期的夹具过几个月会自己走进窗口，把空态断言变成假红）。
 */
export function staleActivityScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const cwd = "/repo/stale";
  const sessionId = "3d2a5442-9c65-4b28-9c30-bb3d1a1e0001";
  const startedAt = new Date(Date.now() - 200 * 24 * 3_600_000);
  const repliedAt = new Date(startedAt.getTime() + 90_000);
  const lines = [
    JSON.stringify({
      type: "user",
      sessionId,
      cwd,
      timestamp: startedAt.toISOString(),
      uuid: "stale-user",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "区间外夹具会话" }
    }),
    JSON.stringify({
      type: "assistant",
      sessionId,
      cwd,
      timestamp: repliedAt.toISOString(),
      uuid: "stale-assistant",
      parentUuid: "stale-user",
      isSidechain: false,
      message: {
        id: "stale-msg",
        role: "assistant",
        model: "claude-sonnet-4",
        content: [{ type: "text", text: "这条记录只在近 7 / 30 / 90 天窗口之外" }],
        usage: { input_tokens: 120, output_tokens: 240, cache_read_input_tokens: 1_000 }
      }
    })
  ];

  const base = emptyScenario(overrides);
  return {
    ...base,
    // 快照页脚会印版本号；不给 updater 会落到桩的兜底值 v0.0.0-mock，
    // 空态产物就成了唯一一份「版本是假的」快照。与 defaultScenario 同源，
    // 调用方显式传入的 updater 仍然优先。
    updater: { currentVersion: APP_VERSION, ...overrides.updater },
    files: {
      [`${HOME}/.claude/projects/${projectDir(cwd)}/${sessionId}.jsonl`]: `${lines.join("\n")}\n`
    }
  };
}

/**
 * 「消耗日历」场景（Issue #187）+「一日回望」场景（Issue #192）：**内存合成**
 * （照 `quotaAttributionScenario` 的做法），时间戳按**本地日历日的固定时刻**
 * 锚定，断言不随运行日期 / 清晨深夜漂移。
 *
 * 只用自造会话（`emptyScenario` 打底）：日历的窗口是滚动 365 天，默认场景
 * 那几个写死日期的夹具平移后会零散落进窗口，档位分布就不确定了。
 *
 * 成本布景（sonnet，$3/MTok input）决定四分位档位：now−300 / −200 / −100 /
 * −30 / −8 天各一个会话、token 阶梯 200K / 400K / 600K / 1M / 2M（成本 $0.6 /
 * $1.2 / $1.8 / $3 / $6）；now−1 天 4 个会话合计 4M（$12，全窗最大 → 4 档）；
 * today 4 个会话合计 1.15M（$3.45）。非零成本 7 天的 Type 7 分布给出
 * q1=$1.5 / q2=$3 / q3=$4.725 → 昨天恰 4 档、今天恰 3 档、now−100（$1.8）2 档、
 * now−15（无活动）0 档——档位断言因此是确定值。
 *
 * 「一日回望」布景（#192）：
 *  - today 4 个会话，起点升序 = 跨午夜（00:25–01:10，150K）+ 09:20（600K）+
 *    13:05（300K）+ 18:40（100K）；日摘要 6 项与时间线 4 条由此确定
 *    （今日 token 合计 1,150,000 → 09:20 那条占 52.2%）。
 *  - 跨午夜会话（序号 13）：昨天 23:40 一条 user（定标题、无 usage）→ 今天段
 *    00:25 / 00:52 / 01:10 三条（hourly[0]=2、hourly[1]=1），crossDay=true。
 *  - now−2 密集日（序号 14–21）：1 个 09:00–17:00 每小时 1 条的长会话 + 1 个
 *    13:30–13:45 + 6 个短会话 = 8 个会话（>6 → 时间线行区内部竖滚）。
 *  - now−3 稀疏日（序号 22–23）：08:10–08:30 / 14:05–14:50，只有两个整点有块。
 *
 *  密集 / 稀疏日**刻意不带 usage**：它们只服务「时间线几何 / 逐小时块 / 竖滚」，
 *  写进 token 会多出两个非零成本日、把上面的四分位搅动（今天会从 3 档跳到
 *  4 档）。0 成本但有记录的日子照样能点开——展开看的是**会话数**（`onCellClick`
 *  只拦 `sessions === 0`），不是成本档位。
 */
export function calendarScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const dayMs = 24 * 3_600_000;
  // 锚定本地日历日：偏移天 + 当天时刻从今天 00:00 起算——「now − 24h − 3h」
  // 这种相对写法在清晨 / 深夜运行时会落到错误的日历日，档位断言就漂了。
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dayAt = (offsetDays: number, hour: number, minute = 0) =>
    todayStart.getTime() - offsetDays * dayMs + hour * 3_600_000 + minute * 60_000;
  const files: Record<string, string> = {};

  /**
   * 一份会话文件：`cwd` / `sessionId` 都由会话序号派生（全局唯一）。`kind`
   * 决定行类型；只有带 `tokens` 的 assistant 记录写 usage（input 单类即可定档）。
   * 会话标题 = 首条 user 记录的文本（`metadataScanner` 的口径）。
   */
  type SeedRecord = { kind: "user" | "assistant"; at: number; text?: string; tokens?: number };
  const writeSession = (ordinal: number, records: SeedRecord[]) => {
    const cwd = `/repo/calendar-${ordinal}`;
    const sessionId = `3d2a5442-9c65-4b28-9c30-bb3d1a1f${String(ordinal).padStart(4, "0")}`;
    const lines = records.map((record, index) => {
      const uuid = `cal-${ordinal}-${index}`;
      const message =
        record.kind === "user"
          ? { role: "user", content: record.text ?? `消耗日历夹具会话 ${ordinal}` }
          : {
              id: `cal-msg-${ordinal}-${index}`,
              role: "assistant",
              model: "claude-sonnet-4",
              content: [{ type: "text", text: record.text ?? `第 ${ordinal} 个会话的回答` }],
              ...(record.tokens ? { usage: { input_tokens: record.tokens } } : {})
            };
      return JSON.stringify({
        type: record.kind,
        sessionId,
        cwd,
        timestamp: new Date(record.at).toISOString(),
        uuid,
        parentUuid: index === 0 ? null : `cal-${ordinal}-${index - 1}`,
        isSidechain: false,
        message
      });
    });
    files[`${HOME}/.claude/projects/${projectDir(cwd)}/${sessionId}.jsonl`] =
      `${lines.join("\n")}\n`;
  };

  /** 两记录骨架：user 定标题，assistant 90s 后带 usage（历史各天的定档会话用）。 */
  const seed = (startedAt: number, ordinal: number, tokens: number) =>
    writeSession(ordinal, [
      { kind: "user", at: startedAt },
      { kind: "assistant", at: startedAt + 90_000, tokens }
    ]);

  // 定档会话（序号 1–12）：序号即项目名（`/repo/calendar-N`）。
  seed(dayAt(300, 10), 1, 200_000);
  seed(dayAt(200, 10), 2, 400_000);
  seed(dayAt(100, 10), 3, 600_000);
  seed(dayAt(30, 10), 4, 1_000_000);
  seed(dayAt(8, 10), 5, 2_000_000);
  seed(dayAt(1, 10), 6, 1_000_000);
  seed(dayAt(1, 11), 7, 1_000_000);
  seed(dayAt(1, 12), 8, 1_000_000);
  seed(dayAt(1, 13), 9, 1_000_000);
  // 今天三个会话：本地日历日的固定时刻 09:20 / 13:05 / 18:40（token 不变）。
  seed(dayAt(0, 9, 20), 10, 600_000);
  seed(dayAt(0, 13, 5), 11, 300_000);
  seed(dayAt(0, 18, 40), 12, 100_000);

  // 跨午夜会话（序号 13）：昨天 23:40 一条 user 定标题、无 usage；今天 00:25 /
  // 00:52 / 01:10 三条。今天段 = 00:25–01:10（150K），crossDay = true。
  writeSession(13, [
    { kind: "user", at: dayAt(1, 23, 40), text: "跨午夜夹具会话 13" },
    { kind: "assistant", at: dayAt(0, 0, 25), tokens: 90_000 },
    { kind: "user", at: dayAt(0, 0, 52), text: "继续" },
    { kind: "assistant", at: dayAt(0, 1, 10), tokens: 60_000 }
  ]);

  // now−2 密集日（序号 14–21）：1 个 09:00–17:00 每小时 1 条的长会话 + 1 个
  // 13:30–13:45 + 6 个短会话 —— 共 8 个会话（>6 → 时间线行区内部竖滚）。
  const longHourly: SeedRecord[] = [];
  for (let hour = 9; hour <= 17; hour += 1) {
    longHourly.push({ kind: hour === 9 ? "user" : "assistant", at: dayAt(2, hour, 0) });
  }
  writeSession(14, longHourly);
  writeSession(15, [
    { kind: "user", at: dayAt(2, 13, 30), text: "密集日会话 15" },
    { kind: "assistant", at: dayAt(2, 13, 45) }
  ]);
  [10, 11, 12, 14, 15, 16].forEach((hour, index) => {
    const ordinal = 16 + index;
    writeSession(ordinal, [
      { kind: "user", at: dayAt(2, hour, 15), text: `密集日短会话 ${ordinal}` },
      { kind: "assistant", at: dayAt(2, hour, 35) }
    ]);
  });

  // now−3 稀疏日（序号 22–23）：08:xx 与 14:xx 两个有活动的小时，各一个会话。
  writeSession(22, [
    { kind: "user", at: dayAt(3, 8, 10), text: "稀疏日会话 22" },
    { kind: "assistant", at: dayAt(3, 8, 30) }
  ]);
  writeSession(23, [
    { kind: "user", at: dayAt(3, 14, 5), text: "稀疏日会话 23" },
    { kind: "assistant", at: dayAt(3, 14, 50) }
  ]);

  const base = emptyScenario();
  return { ...base, files, ...overrides };
}

/** 脉搏夹具的会话模型：与真实日志一致，只是不写 `gitBranch` / `version`。 */
const PULSE_MODEL = "claude-sonnet-4";

/** `message.usage` 的四个计数器（脉搏只认这一组，缺一不可）。 */
export type PulseUsage = {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
};

const pulseUsage = (
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): PulseUsage => ({ input, output, cacheCreation, cacheRead });

type PulseRecord =
  | { kind: "user"; at: number; text: string }
  | { kind: "assistant"; at: number; text: string; usage: PulseUsage }
  | {
      kind: "compact";
      at: number;
      trigger: "auto" | "manual";
      preTokens: number;
      postTokens: number;
      summary: string;
    };

/**
 * 把种子记录渲染成真实 JSONL。行结构照 `web/tests/fixtures/session-token-usage.jsonl`
 * 与 `compact-session.jsonl`：`assistant` 记录带 `message.usage` 四计数器；
 * `compact` 渲染成**两行**——`type:"system", subtype:"compact_boundary"` 边界加紧随
 * 其后的 `isCompactSummary` 摘要（摘要是边界后的 `user` 记录，`parentUuid` 指回边界
 * uuid，解析器靠这条链把两行配成一个 `CompactEvent`）。
 *
 * 返回 `mtimeMs = 最后一条记录的时刻`：真实写入会把 mtime 推到那一刻，脉搏的
 * 新近度（live / recent / idle）与「活跃集合（5 小时内有 mtime）」都读它。
 */
function pulseSessionLines(
  prefix: string,
  cwd: string,
  sessionId: string,
  records: PulseRecord[]
): { content: string; mtimeMs: number; lastUuid: string } {
  const lines: string[] = [];
  let lastUuid = "";

  for (const record of records) {
    const uuid = `${prefix}-${lines.length}`;
    const timestamp = new Date(record.at).toISOString();

    if (record.kind === "compact") {
      lines.push(
        JSON.stringify({
          sessionId,
          cwd,
          timestamp,
          uuid,
          parentUuid: null,
          isSidechain: false,
          type: "system",
          subtype: "compact_boundary",
          content: "Conversation compacted",
          level: "info",
          logicalParentUuid: lastUuid === "" ? null : lastUuid,
          compactMetadata: {
            trigger: record.trigger,
            preTokens: record.preTokens,
            postTokens: record.postTokens,
            cumulativeDroppedTokens: record.preTokens - record.postTokens,
            durationMs: 32_000
          }
        })
      );
      lastUuid = uuid;
      const summaryUuid = `${prefix}-${lines.length}`;
      lines.push(
        JSON.stringify({
          sessionId,
          cwd,
          timestamp,
          uuid: summaryUuid,
          parentUuid: uuid,
          isSidechain: false,
          type: "user",
          isCompactSummary: true,
          isVisibleInTranscriptOnly: true,
          message: { role: "user", content: record.summary }
        })
      );
      lastUuid = summaryUuid;
      continue;
    }

    const base = {
      sessionId,
      cwd,
      timestamp,
      uuid,
      parentUuid: lastUuid === "" ? null : lastUuid,
      isSidechain: false
    };
    if (record.kind === "user") {
      lines.push(
        JSON.stringify({ ...base, type: "user", message: { role: "user", content: record.text } })
      );
    } else {
      lines.push(
        JSON.stringify({
          ...base,
          type: "assistant",
          message: {
            id: `${prefix}-msg-${lines.length}`,
            role: "assistant",
            model: PULSE_MODEL,
            content: [{ type: "text", text: record.text }],
            usage: {
              input_tokens: record.usage.input,
              output_tokens: record.usage.output,
              cache_creation_input_tokens: record.usage.cacheCreation,
              cache_read_input_tokens: record.usage.cacheRead
            }
          }
        })
      );
    }
    lastUuid = uuid;
  }

  const last = records[records.length - 1];
  return { content: `${lines.join("\n")}\n`, mtimeMs: last?.at ?? Date.now(), lastUuid };
}

const PULSE_LIVE = { cwd: "/repo/pulse-live", id: "3d2a5442-9c65-4b28-9c30-bb3d1a200001" } as const;
const PULSE_RECENT = { cwd: "/repo/pulse-recent", id: "3d2a5442-9c65-4b28-9c30-bb3d1a200002" } as const;
const PULSE_IDLE = { cwd: "/repo/pulse-idle", id: "3d2a5442-9c65-4b28-9c30-bb3d1a200003" } as const;

function pulseSessionPath(session: { cwd: string; id: string }): string {
  return `${HOME}/.claude/projects/${projectDir(session.cwd)}/${session.id}.jsonl`;
}

/** live 档会话的路径——spec 拿它当 `__CCA_E2E_APPEND_FILE__` 的目标。 */
export const PULSE_LIVE_SESSION_PATH = pulseSessionPath(PULSE_LIVE);

/**
 * live 档会话的种子记录：最后一条在 `now − 30s`（mtime 同步取那一刻 → live 档），
 * 整段回溯 4 小时（仍在 5 小时窗口内），中间夹**三次自动压缩**——上下文曲线画得出
 * 断崖，参考带也够 n=3 的绘制门槛。时间戳全部相对 `now` 现算，绝不写死日期。
 */
function pulseLiveRecords(now: number): PulseRecord[] {
  const last = now - 30_000;
  const hour = 3_600_000;
  return [
    { kind: "user", at: last - 4 * hour, text: "把实时脉搏这条线铺开" },
    {
      kind: "assistant",
      at: last - 4 * hour + 30_000,
      text: "先盘点现有的监控页状态机。",
      usage: pulseUsage(1_600, 700, 3_200, 118_000)
    },
    {
      kind: "assistant",
      at: last - 3 * hour - 50 * 60_000,
      text: "上下文涨得有点快，做一轮自动压缩。",
      usage: pulseUsage(1_800, 640, 3_200, 148_600)
    },
    {
      kind: "compact",
      at: last - 3 * hour - 48 * 60_000,
      trigger: "auto",
      preTokens: 167_400,
      postTokens: 11_200,
      summary: "会话摘要：完成既有监控页盘点，下一步实现脉搏调度。"
    },
    {
      kind: "assistant",
      at: last - 3 * hour - 40 * 60_000,
      text: "压缩后继续读调度约定。",
      usage: pulseUsage(220, 180, 2_400, 18_600)
    },
    { kind: "user", at: last - 3 * hour - 20 * 60_000, text: "接着看 e2e 桩。" },
    {
      kind: "assistant",
      at: last - 3 * hour - 10 * 60_000,
      text: "桩的 stat 现在锁死了 mtime，需要可变钩子。",
      usage: pulseUsage(1_400, 520, 2_600, 86_400)
    },
    {
      kind: "compact",
      at: last - 2 * hour - 50 * 60_000,
      trigger: "auto",
      preTokens: 158_900,
      postTokens: 10_400,
      summary: "会话摘要：确认需要可变文件与 mtime 的测试钩子。"
    },
    {
      kind: "assistant",
      at: last - 2 * hour - 40 * 60_000,
      text: "钩子设计：改写、追加、读 mtime。",
      usage: pulseUsage(260, 210, 2_400, 24_100)
    },
    { kind: "user", at: last - 2 * hour, text: "夹具也要跟上。" },
    {
      kind: "assistant",
      at: last - 1 * hour - 50 * 60_000,
      text: "夹具的时间戳必须相对 Date.now() 现算。",
      usage: pulseUsage(1_200, 460, 2_500, 106_800)
    },
    {
      kind: "compact",
      at: last - 1 * hour - 20 * 60_000,
      trigger: "auto",
      preTokens: 172_300,
      postTokens: 11_800,
      summary: "会话摘要：夹具将按会话年龄分成三档。"
    },
    {
      kind: "assistant",
      at: last - 40 * 60_000,
      text: "三档会话就位。",
      usage: pulseUsage(240, 190, 2_400, 17_300)
    },
    { kind: "user", at: last - 5 * 60_000, text: "再补一条 usage 记录。" },
    {
      kind: "assistant",
      at: last,
      text: "补上最后一条记录，正好落在 live 档。",
      usage: pulseUsage(300, 240, 2_400, 6_100)
    }
  ];
}

function pulseLiveSession(now: number): { path: string; content: string; mtimeMs: number; lastUuid: string } {
  const rendered = pulseSessionLines("pulse-live", PULSE_LIVE.cwd, PULSE_LIVE.id, pulseLiveRecords(now));
  return { path: pulseSessionPath(PULSE_LIVE), ...rendered };
}

const PULSE_LIVE_BASELINE = pulseLiveSession(Date.now());

/**
 * live 档会话的**基线内容**（与 `pulseScenario()` 写进虚拟文件的一致）。
 * spec 用 `__CCA_E2E_APPEND_FILE__(PULSE_LIVE_SESSION_PATH, text)` 往它尾部补记录
 * 来模拟「会话正在被写」时，可以先拿它核对现有尾部。
 *
 * 锚点是模块加载时刻的 `Date.now()`：时间戳仍是**现算的相对值**（没有写死日期），
 * 只是比 `pulseScenario()` 那次早几毫秒——追加一条记录时这点差无关紧要。
 * 因此**别拿它跟 `scenario.files[PULSE_LIVE_SESSION_PATH]` 做相等断言**（时间戳
 * 会差几毫秒），要断言就用场景自己产出的那份。
 */
export const PULSE_LIVE_SESSION_CONTENT = PULSE_LIVE_BASELINE.content;

/** live 档会话最后一条记录的 uuid——追加记录时挂上去，链路不断。 */
export const PULSE_LIVE_LAST_UUID = PULSE_LIVE_BASELINE.lastUuid;

/** 追加记录的缺省用量：与 fixture 里其它 usage 记录同量级，但一眼能认出来是追加的。 */
const PULSE_APPEND_USAGE = pulseUsage(320, 260, 2_400, 9_800);

/**
 * 造一段**待追加**的文本（一条 `assistant` + `usage` 记录，行尾带换行），
 * 直接喂给 `__CCA_E2E_APPEND_FILE__(PULSE_LIVE_SESSION_PATH, text, mtimeMs?)`。
 * 行结构照真实日志，`parentUuid` 挂在 live 会话最后一条记录上，链路不断。
 */
export function pulseUsageAppendText(at: number, usage: PulseUsage = PULSE_APPEND_USAGE): string {
  const line = JSON.stringify({
    sessionId: PULSE_LIVE.id,
    cwd: PULSE_LIVE.cwd,
    timestamp: new Date(at).toISOString(),
    uuid: `pulse-live-append-${at}`,
    parentUuid: PULSE_LIVE_LAST_UUID,
    isSidechain: false,
    type: "assistant",
    message: {
      id: `pulse-live-append-msg-${at}`,
      role: "assistant",
      model: PULSE_MODEL,
      content: [{ type: "text", text: "追加的一条 usage 记录" }],
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        cache_creation_input_tokens: usage.cacheCreation,
        cache_read_input_tokens: usage.cacheRead
      }
    }
  });
  return `${line}\n`;
}

/**
 * 「实时脉搏」场景（Issue #203）：**内存合成**（照 `quotaAttributionScenario` /
 * `calendarScenario` 的做法），时间戳**相对 `Date.now()` 现算**——脉搏的 5 小时
 * 窗口和新近度都随运行时刻走，写死日期过几天就把会话甩出窗外，断言会以「没渲染」
 * 这种毫无线索的方式假红。时间锚点也**只用 `Date.now()`**，别用本地日历日。
 *
 * 只用自造会话（`emptyScenario` 打底）：默认场景那批夹具既有固定日期、又会在窗内
 * 多出一堆会话，档位与会话行计数都不确定。
 *
 * 三个会话按**最后一条记录的相对年龄**分档，`fileMtimes` 同步取那一刻（脉搏的活跃
 * 集合与「N 分钟前有新记录」都读 mtime，不读记录时间戳）：
 *  - live   —— 30 秒前，带三次**自动**压缩（上下文曲线的断崖 + 参考带 n=3）；
 *  - recent —— 8 分钟前；
 *  - idle   —— 40 分钟前。
 *
 * 每个会话至少一条 usage 记录带齐四个计数器，行结构照 `web/tests/fixtures/` 里
 * `session-token-usage.jsonl` 与 `compact-session.jsonl`。
 */
export function pulseScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const now = Date.now();
  const live = pulseLiveSession(now);
  const recentAt = now - 8 * 60_000;
  const idleAt = now - 40 * 60_000;
  const recent = pulseSessionLines("pulse-recent", PULSE_RECENT.cwd, PULSE_RECENT.id, [
    { kind: "user", at: recentAt - 120_000, text: "八分钟前收尾的那个会话" },
    {
      kind: "assistant",
      at: recentAt,
      text: "最近一档：几分钟前还有记录。",
      usage: pulseUsage(420, 260, 2_400, 41_200)
    }
  ]);
  const idle = pulseSessionLines("pulse-idle", PULSE_IDLE.cwd, PULSE_IDLE.id, [
    { kind: "user", at: idleAt - 120_000, text: "四十分钟前停下的会话" },
    {
      kind: "assistant",
      at: idleAt,
      text: "闲置一档：已经有一阵子没动静。",
      usage: pulseUsage(380, 220, 2_400, 11_500)
    }
  ]);

  const files: Record<string, string> = {
    [live.path]: live.content,
    [pulseSessionPath(PULSE_RECENT)]: recent.content,
    [pulseSessionPath(PULSE_IDLE)]: idle.content
  };
  const fileMtimes: Record<string, number> = {
    [live.path]: live.mtimeMs,
    [pulseSessionPath(PULSE_RECENT)]: recent.mtimeMs,
    [pulseSessionPath(PULSE_IDLE)]: idle.mtimeMs
  };

  return { ...emptyScenario(), files, fileMtimes, ...overrides };
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
