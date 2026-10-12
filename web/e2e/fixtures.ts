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
 * 「消耗日历」场景（Issue #187）：**内存合成**（照 `quotaAttributionScenario`
 * 的做法），时间戳相对 `Date.now()`，断言不随运行日期漂移。
 *
 * 只用自造会话（`emptyScenario` 打底）：日历的窗口是滚动 365 天，默认场景
 * 那几个写死日期的夹具平移后会零散落进窗口，档位分布就不确定了。
 *
 * 布景（sonnet，$3/MTok input）：now−300 / −200 / −100 / −30 / −8 天各一个
 * 会话、token 阶梯 200K / 400K / 600K / 1M / 2M（成本 $0.6 / $1.2 / $1.8 /
 * $3 / $6）；now−1 天 4 个会话合计 4M（$12，全窗最大 → level 4）；今天
 * 3 个会话合计 1M（$3）。非零成本 7 天的分布（Type 7）给出
 * q1=$1.5 / q2=$3 / q3=$4.5，于是昨天恰落 4 档、今天恰落 3 档、
 * now−100（$1.8）落 2 档——档位断言因此是确定值。
 */
export function calendarScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const now = Date.now();
  const dayMs = 24 * 3_600_000;
  // 锚定本地日历日：偏移天 + 当天时刻从今天 00:00 起算——「now − 24h − 3h」
  // 这种相对写法在清晨 / 深夜运行时会落到错误的日历日，档位断言就漂了。
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const dayAt = (offsetDays: number, hour: number) =>
    todayStart.getTime() - offsetDays * dayMs + hour * 3_600_000;
  // 今天的会话要落在「今天的 00:00 之后、几乎不越到未来」的区间里：
  // 取两者较大者（凌晨运行时宁可晚一分钟，也不落到昨天）。
  const todaySafe = Math.max(todayStart.getTime() + 60_000, now - 60_000);
  const files: Record<string, string> = {};

  /** 一个会话两条记录：user 定标题，assistant 带 usage（input 单类即可定档）。 */
  const seed = (startedAt: number, ordinal: number, tokens: number) => {
    const cwd = `/repo/calendar-${ordinal}`;
    const sessionId = `3d2a5442-9c65-4b28-9c30-bb3d1a1f${String(ordinal).padStart(4, "0")}`;
    const repliedAt = new Date(startedAt + 90_000);
    const lines = [
      JSON.stringify({
        type: "user",
        sessionId,
        cwd,
        timestamp: new Date(startedAt).toISOString(),
        uuid: `cal-${ordinal}-user`,
        parentUuid: null,
        isSidechain: false,
        message: { role: "user", content: `消耗日历夹具会话 ${ordinal}` }
      }),
      JSON.stringify({
        type: "assistant",
        sessionId,
        timestamp: repliedAt.toISOString(),
        uuid: `cal-${ordinal}-assistant`,
        parentUuid: `cal-${ordinal}-user`,
        isSidechain: false,
        message: {
          id: `cal-msg-${ordinal}`,
          role: "assistant",
          model: "claude-sonnet-4",
          content: [{ type: "text", text: `第 ${ordinal} 个会话的回答` }],
          usage: { input_tokens: tokens }
        }
      })
    ];
    files[`${HOME}/.claude/projects/${projectDir(cwd)}/${sessionId}.jsonl`] =
      `${lines.join("\n")}\n`;
  };

  // 各天的会话布景；序号全局唯一（sessionId / uuid 不能撞）。
  seed(dayAt(300, 10), 1, 200_000);
  seed(dayAt(200, 10), 2, 400_000);
  seed(dayAt(100, 10), 3, 600_000);
  seed(dayAt(30, 10), 4, 1_000_000);
  seed(dayAt(8, 10), 5, 2_000_000);
  seed(dayAt(1, 10), 6, 1_000_000);
  seed(dayAt(1, 11), 7, 1_000_000);
  seed(dayAt(1, 12), 8, 1_000_000);
  seed(dayAt(1, 13), 9, 1_000_000);
  // 今天的三个会话各错开 1 秒（落在同一天的区间里，不给凌晨边界留缝隙）。
  seed(todaySafe, 10, 600_000);
  seed(todaySafe + 1_000, 11, 300_000);
  seed(todaySafe + 2_000, 12, 100_000);

  const base = emptyScenario();
  return { ...base, files, ...overrides };
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
