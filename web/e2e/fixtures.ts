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

/**
 * 默认场景 + 账单夹具会话（/repo/cost，Round BB）。
 *
 * 3 个模型（Sonnet 4.5 / Opus 4.1 / GPT-5 未定价）、8 笔可定价调用 + 2 次
 * 未计入调用（GPT-5 一笔 + 一次缺 usage）、四类科目全非零，其中缓存读取
 * 小计 $0.003 落在 (0, 0.01)——「假零」门禁 G4 靠它。
 *
 * **为什么不进 `SESSION_SEEDS`**：默认场景目前恰好 8 条会话，smoke /
 * selector-probe 的计数与全部含侧栏的归档截图都按这个数写死；把账单夹具塞进
 * 默认场景会让「会话数」从 8 变 9，牵动本轮之外的断言与基线。这里沿用
 * `compactScenario` / `toolCensusScenario` 的既有做法：只在需要它的场景里
 * 追加一份会话文件，默认场景的可见集合不变。
 */
export function costScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const base = defaultScenario(overrides);
  return {
    ...base,
    files: {
      ...base.files,
      [`${HOME}/.claude/projects/-repo-cost/cost-session.jsonl`]: fixture("cost-session.jsonl")
    }
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Round CC「用量页新面板」动态夹具
 *
 * 时间戳全部相对 `Date.now()` 现算：面板的时间窗（滚动 7 天 / 自然周 / 5h
 * 计费块）都相对当前时刻，写死日期的夹具过几天就会整片落到窗外。自然周
 * 用本地周一 00:00 起（与 `weeklyDigest.weekStartOf` 同一规则）。
 *
 * 三份会话 = 三个项目（/repo/alpha|beta|gamma），每个项目各喂给三个模型各
 * 一次、四类计数器全非零——流向图的 3×3 拓扑靠它；alpha 量级约为 beta 的
 * 9 倍，gamma 最小（擂台两列有可比的差）。
 *
 * 为什么不进 `SESSION_SEEDS`：默认场景的会话数（8）与全部含侧栏的归档截图
 * 都按它写死，追加会牵动本轮之外的断言；沿用 `costScenario` 的先例，只在
 * 需要它的场景里追加文件。默认场景的旧夹具整体平移到 30 天前，避免它们的
 * 用量落进 7 天窗、把「3 个项目」变成 4 个。
 * ────────────────────────────────────────────────────────────────────────── */

const ROUND_CC_HOUR = 3_600_000;
const ROUND_CC_DAY = 24 * ROUND_CC_HOUR;
const ROUND_CC_SONNET = "claude-sonnet-4-5-20250929";
const ROUND_CC_OPUS = "claude-opus-4-1-20250805";
const ROUND_CC_HAIKU = "claude-haiku-4-5-20251001";

type RoundCCUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

type RoundCCRecord = Record<string, unknown>;

type RoundCCSessionSeed = { cwd: string; id: string; records: RoundCCRecord[] };

/** 本地自然周起点（周一 00:00）——与 `weekStartOf` 同一条规则，只用于造数据。 */
function roundCCWeekStart(ts: number): number {
  const start = new Date(ts);
  start.setHours(0, 0, 0, 0);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start.getTime();
}

/** 造一段会话的 JSONL；记录按时间戳升序输出（跨周记录也是上周在前）。 */
function roundCCJsonl(seed: RoundCCSessionSeed): string {
  const sorted = [...seed.records].sort(
    (a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp))
  );
  return sorted.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function buildRoundCC(): { files: Record<string, string>; records: RoundCCRecord[]; now: number } {
  const now = Date.now();
  const weekStart = roundCCWeekStart(now);
  const sessions: RoundCCSessionSeed[] = [];
  let uuidSeed = 0;

  const idOf = (name: string) =>
    `c0ffee00-0000-4000-8000-${name.padEnd(12, "0").slice(0, 12)}`;

  function make(
    kind: "user" | "assistant",
    sessionId: string,
    cwd: string,
    at: number,
    message: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ): RoundCCRecord {
    uuidSeed += 1;
    return {
      type: kind,
      sessionId,
      cwd,
      gitBranch: "main",
      version: "2.1.0",
      timestamp: new Date(at).toISOString(),
      uuid: `roundcc-${uuidSeed}`,
      parentUuid: null,
      isSidechain: false,
      message,
      ...extra
    };
  }

  function user(sessionId: string, cwd: string, at: number, text: string): RoundCCRecord {
    return make("user", sessionId, cwd, at, { role: "user", content: text });
  }

  function assistant(
    sessionId: string,
    cwd: string,
    at: number,
    text: string,
    model: string = ROUND_CC_SONNET,
    usage?: RoundCCUsage
  ): RoundCCRecord {
    return make("assistant", sessionId, cwd, at, {
      id: `roundcc-msg-${uuidSeed + 1}`,
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {})
    });
  }

  const usage = (
    input: number,
    output: number,
    cacheCreation: number,
    cacheRead: number
  ): RoundCCUsage => ({
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  });

  // ── alpha：本周（跨周对比的「本周」列）+ 三个模型的用量 ──────────────────
  const alphaId = idOf("alpha");
  const alpha2Id = idOf("alpha-week2");
  const alphaRecords: RoundCCRecord[] = [];
  const alphaAt = weekStart + 30 * 60_000;
  alphaRecords.push(
    user(alphaId, "/repo/alpha", alphaAt, "本周：把 alpha 的账摊开"),
    user(alphaId, "/repo/alpha", alphaAt + 60_000, "本周：先看三个模型的消耗"),
    user(alphaId, "/repo/alpha", alphaAt + 120_000, "本周：再对一遍缓存"),
    assistant(alphaId, "/repo/alpha", alphaAt + 180_000, "本周回答一", ROUND_CC_SONNET, usage(1200, 900, 450, 450)),
    assistant(alphaId, "/repo/alpha", alphaAt + 240_000, "本周回答二", ROUND_CC_SONNET, usage(1200, 900, 450, 450)),
    assistant(alphaId, "/repo/alpha", alphaAt + 300_000, "本周回答三", ROUND_CC_SONNET, usage(1200, 900, 450, 450)),
    // F1：alpha × 三个模型各一条（四类计数器全非零）
    assistant(alphaId, "/repo/alpha", now - 26 * ROUND_CC_HOUR, "alpha 的 Sonnet 调用", ROUND_CC_SONNET, usage(600, 400, 200, 800)),
    assistant(alphaId, "/repo/alpha", now - 50 * ROUND_CC_HOUR, "alpha 的 Opus 调用", ROUND_CC_OPUS, usage(600, 400, 200, 800)),
    assistant(alphaId, "/repo/alpha", now - 74 * ROUND_CC_HOUR, "alpha 的 Haiku 调用", ROUND_CC_HAIKU, usage(300, 200, 100, 300)),
    // F4：时钟需要更多不同本地小时（几小时差开，且都在 7 天窗内）
    user(alphaId, "/repo/alpha", now - 30 * ROUND_CC_HOUR, "凌晨巡检一"),
    assistant(alphaId, "/repo/alpha", now - 34 * ROUND_CC_HOUR, "凌晨巡检一完成"),
    user(alphaId, "/repo/alpha", now - 38 * ROUND_CC_HOUR, "凌晨巡检二"),
    // F5：现在-2h 的用量把当前 5h 计费块打开（块内只有它自己）
    assistant(alphaId, "/repo/alpha", now - 2 * ROUND_CC_HOUR, "最近两小时的调用", ROUND_CC_SONNET, usage(8000, 6000, 4000, 22000))
  );
  sessions.push({ cwd: "/repo/alpha", id: alphaId, records: alphaRecords });

  // 本周新开的第二个会话（同一项目）：让周战报的「会话数」两端不同。
  sessions.push({
    cwd: "/repo/alpha",
    id: alpha2Id,
    records: [user(alpha2Id, "/repo/alpha", weekStart + ROUND_CC_HOUR, "本周新开的会话")]
  });

  // ── beta：上周（跨周对比的「上周」列）+ 三个模型的用量 ───────────────────
  const betaId = idOf("beta");
  const lastWeekAt = weekStart - 3 * ROUND_CC_DAY + 12 * ROUND_CC_HOUR;
  sessions.push({
    cwd: "/repo/beta",
    id: betaId,
    records: [
      user(betaId, "/repo/beta", lastWeekAt, "上周：先对齐口径"),
      user(betaId, "/repo/beta", lastWeekAt + 60_000, "上周：再看目录结构"),
      assistant(betaId, "/repo/beta", lastWeekAt + 120_000, "上周回答一", ROUND_CC_SONNET, usage(400, 300, 150, 150)),
      assistant(betaId, "/repo/beta", lastWeekAt + 180_000, "上周回答二", ROUND_CC_SONNET, usage(400, 300, 150, 150)),
      assistant(betaId, "/repo/beta", now - 26 * ROUND_CC_HOUR, "beta 的 Opus 调用", ROUND_CC_OPUS, usage(600, 400, 200, 800)),
      assistant(betaId, "/repo/beta", now - 50 * ROUND_CC_HOUR, "beta 的 Haiku 调用", ROUND_CC_HAIKU, usage(300, 200, 100, 300)),
      assistant(betaId, "/repo/beta", now - 74 * ROUND_CC_HOUR, "beta 的 Sonnet 调用", ROUND_CC_SONNET, usage(600, 400, 200, 800)),
      user(betaId, "/repo/beta", now - 54 * ROUND_CC_HOUR, "beta 夜班"),
      assistant(betaId, "/repo/beta", now - 58 * ROUND_CC_HOUR, "beta 夜班收尾"),
      user(betaId, "/repo/beta", now - 62 * ROUND_CC_HOUR, "beta 第二处")
    ]
  });

  // ── gamma：量级最小 + 两组工具错误（错误聚类） ───────────────────────────
  const gammaId = idOf("gamma");
  const toolUse = (at: number, toolId: string, name: string, input: Record<string, unknown>) =>
    make("assistant", gammaId, "/repo/gamma", at, {
      id: `roundcc-msg-${uuidSeed + 1}`,
      role: "assistant",
      model: ROUND_CC_SONNET,
      content: [{ type: "tool_use", id: toolId, name, input }]
    });
  const toolError = (at: number, toolId: string, text: string) =>
    make(
      "user",
      gammaId,
      "/repo/gamma",
      at,
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolId, content: text, is_error: true }]
      },
      { toolUseResult: { type: "tool_use_result", stdout: "", stderr: text } }
    );

  sessions.push({
    cwd: "/repo/gamma",
    id: gammaId,
    records: [
      assistant(gammaId, "/repo/gamma", now - 50 * ROUND_CC_HOUR, "gamma 的 Sonnet 调用", ROUND_CC_SONNET, usage(300, 200, 100, 300)),
      assistant(gammaId, "/repo/gamma", now - 74 * ROUND_CC_HOUR, "gamma 的 Opus 调用", ROUND_CC_OPUS, usage(300, 200, 100, 300)),
      assistant(gammaId, "/repo/gamma", now - 98 * ROUND_CC_HOUR, "gamma 的 Haiku 调用", ROUND_CC_HAIKU, usage(150, 100, 50, 150)),
      user(gammaId, "/repo/gamma", now - 66 * ROUND_CC_HOUR, "gamma 翻日志"),
      assistant(gammaId, "/repo/gamma", now - 70 * ROUND_CC_HOUR, "gamma 翻完日志"),
      // 错误聚类：Bash ×2、Grep ×2，首行完全一致（聚类键 = 工具名 + 首行）
      toolUse(now - 20 * ROUND_CC_HOUR, "roundcc-bash-1", "Bash", { command: "cat missing.txt" }),
      toolError(now - 20 * ROUND_CC_HOUR + 30_000, "roundcc-bash-1", "Error: ENOENT: no such file or directory\n  at cat missing.txt"),
      toolUse(now - 18 * ROUND_CC_HOUR, "roundcc-bash-2", "Bash", { command: "cat missing-two.txt" }),
      toolError(now - 18 * ROUND_CC_HOUR + 30_000, "roundcc-bash-2", "Error: ENOENT: no such file or directory\n  at cat missing-two.txt"),
      toolUse(now - 16 * ROUND_CC_HOUR, "roundcc-grep-1", "Grep", { pattern: "TODO" }),
      toolError(now - 16 * ROUND_CC_HOUR + 30_000, "roundcc-grep-1", "Error: ripgrep exited with code 2\n  partial output"),
      toolUse(now - 14 * ROUND_CC_HOUR, "roundcc-grep-2", "Grep", { pattern: "FIXME" }),
      toolError(now - 14 * ROUND_CC_HOUR + 30_000, "roundcc-grep-2", "Error: ripgrep exited with code 2\n  no matches")
    ]
  });

  // 默认场景的旧夹具整体推到 30 天前：它们的用量不能落进 7 天窗。
  const staleDays = Math.ceil((Date.now() - NEWEST_FIXTURE_DAY) / ROUND_CC_DAY) + 30;
  const base = defaultScenario();
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(base.files)) {
    files[path] = path.endsWith(".jsonl") ? shiftDays(content, -staleDays) : content;
  }
  for (const seed of sessions) {
    files[`${HOME}/.claude/projects/${projectDir(seed.cwd)}/${seed.id}.jsonl`] = roundCCJsonl(seed);
  }

  return { files, records: sessions.flatMap((seed) => seed.records), now };
}

let roundCCCache: { files: Record<string, string>; records: RoundCCRecord[]; now: number } | null = null;

function roundCCBuilt(): { files: Record<string, string>; records: RoundCCRecord[]; now: number } {
  // 同一进程里的多个用例共用一个时刻，避免「场景 A 的 now」与「场景 B 的 now」
  // 跨过整点后互相漂移。
  if (roundCCCache === null) roundCCCache = buildRoundCC();
  return roundCCCache;
}

/** Round CC 全量记录（时间戳为 ISO 字符串）——e2e 用它手算周战报的期望值。 */
export function roundCCRecords(): RoundCCRecord[] {
  return roundCCBuilt().records;
}

/** 构造夹具时的基准时刻——e2e 的手算与夹具用同一个 now，避免毫秒漂移。
 *  从记录反推而不是另存一个变量：缓存后调用 `Date.now()` 会拿到「现在的现在」，
 *  与夹具相对量（now-2h 等）已经错开。 */
export function roundCCNow(): number {
  const anchor = roundCCBuilt().now;
  return anchor;
}

/** `/repo/alpha` 主会话在磁盘上的路径（置顶截图预置 localStorage 用）。 */
export function roundCCAlphaPath(): string {
  return `${HOME}/.claude/projects/-repo-alpha/c0ffee00-0000-4000-8000-alpha0000000.jsonl`;
}

/** 默认场景（旧夹具推到 30 天前）+ alpha / beta / gamma 三份 Round CC 会话。 */
export function roundCCScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    ...defaultScenario(overrides),
    files: roundCCBuilt().files
  };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Round DD「第二批十功能」动态夹具
 *
 * 十功能各有自己的数据前提，这份场景是它们的**共同最小公倍数**：
 *   - D1 对比：至少 3 个会话，token 总量前两名差得开；
 *   - D2 健康：Bash 3 次各带耗时、其中 1 次失败（33.3% > 20%），
 *     Grep 只有 2 次（< MIN_FAILURE_SAMPLE=3 → 「样本不足（2 次）」）；
 *   - D3 换模：Sonnet / Opus / Haiku + 未定价的 gpt-5 混合；
 *   - D4 雷达：3 个项目（广度 3/6），最长会话 200 分钟（续航 83.3）；
 *   - D5 海报：全历史聚合有数据即可；
 *   - D6 微表：计划限额由用例用 `cca-billing-plan` 预置（场景本身不带）；
 *   - D7 甘特：13 个会话（12 行上限 + 「另有 1 个会话未画出」），
 *     A 09:00–12:20 与 B 09:30–11:00 相交（并行虚线带 + ∥）；
 *   - D8 习惯：昨天到四天前连续有活动（连击 4 天），上午消息远多于晚间（早鸟）；
 *   - D9 峰值：09:15 那一分钟 6 次调用共 1,230,000 tok，次高 209,000；
 *   - D10 换算：窗口内四类计数器合计 2,089,000 tok（四条换算都 ≥1）。
 *
 * 时间锚点：构建时取一次 `Date.now()`，之后所有记录都由 `roundDDNow()` 派生的
 * 本地日历（昨天 09:00 等）算出——用例不得再直接读 Date.now()，否则跨整点/
 * 跨天会让「昨天」变成「今天」，连击与峰值分钟随之漂移。
 *
 * **为什么不进 `SESSION_SEEDS`**：默认场景的会话数（8）与全部含侧栏的归档截图
 * 都按它写死；沿用 `costScenario` / `roundCCScenario` 的先例，只在需要它的
 * 场景里追加文件，并把默认场景的旧夹具整体推到 30 天前（避免它们的用量落进
 * 7 天窗，把「3 个项目」撑成第 4 个）。
 * ────────────────────────────────────────────────────────────────────────── */

const ROUND_DD_SONNET = "claude-sonnet-4-5-20250929";
const ROUND_DD_OPUS = "claude-opus-4-1-20250805";
const ROUND_DD_HAIKU = "claude-haiku-4-5-20251001";
/** 未收录定价的模型：D3 的「倍数」与脚注的「未计入」都靠它。 */
const ROUND_DD_UNPRICED = "gpt-5";

type RoundDDUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

type RoundDDRecord = Record<string, unknown>;

type RoundDDSessionSeed = { cwd: string; id: string; records: RoundDDRecord[] };

/** 造一段会话的 JSONL；记录按时间戳升序输出。 */
function roundDDJsonl(seed: RoundDDSessionSeed): string {
  const sorted = [...seed.records].sort(
    (a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp))
  );
  return sorted.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function buildRoundDD(): { files: Record<string, string>; records: RoundDDRecord[]; now: number } {
  const now = Date.now();

  /** 本地日历：`daysAgo` 天前的 `hour:minute:second`（跨 DST 也按日历走）。 */
  const at = (daysAgo: number, hour: number, minute: number, second = 0): number => {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    day.setHours(hour, minute, second, 0);
    return day.getTime();
  };

  let uuidSeed = 0;
  const idOf = (slug: string) =>
    `dd00ffee-0000-4000-8000-${slug.padEnd(12, "0").slice(0, 12)}`;

  function make(
    kind: "user" | "assistant",
    sessionId: string,
    cwd: string,
    timestamp: number,
    message: Record<string, unknown>,
    extra: Record<string, unknown> = {}
  ): RoundDDRecord {
    uuidSeed += 1;
    return {
      type: kind,
      sessionId,
      cwd,
      gitBranch: "main",
      version: "2.1.0",
      timestamp: new Date(timestamp).toISOString(),
      uuid: `rounddd-${uuidSeed}`,
      parentUuid: null,
      isSidechain: false,
      message,
      ...extra
    };
  }

  const user = (sessionId: string, cwd: string, timestamp: number, text: string) =>
    make("user", sessionId, cwd, timestamp, { role: "user", content: text });

  const assistant = (
    sessionId: string,
    cwd: string,
    timestamp: number,
    text: string,
    model: string = ROUND_DD_SONNET,
    usage?: RoundDDUsage
  ) =>
    make("assistant", sessionId, cwd, timestamp, {
      id: `rounddd-msg-${uuidSeed + 1}`,
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {})
    });

  const toolUse = (
    sessionId: string,
    cwd: string,
    timestamp: number,
    toolId: string,
    name: string,
    input: Record<string, unknown>
  ) =>
    make("assistant", sessionId, cwd, timestamp, {
      id: `rounddd-msg-${uuidSeed + 1}`,
      role: "assistant",
      model: ROUND_DD_SONNET,
      content: [{ type: "tool_use", id: toolId, name, input }]
    });

  const toolResult = (
    sessionId: string,
    cwd: string,
    timestamp: number,
    toolId: string,
    text: string,
    isError = false
  ) =>
    make(
      "user",
      sessionId,
      cwd,
      timestamp,
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolId, content: text, ...(isError ? { is_error: true } : {}) }]
      },
      isError ? { toolUseResult: { type: "tool_use_result", stdout: "", stderr: text } } : {}
    );

  const usage = (
    input: number,
    output: number,
    cacheCreation: number,
    cacheRead: number
  ): RoundDDUsage => ({
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  });

  const sessions: RoundDDSessionSeed[] = [];

  // ── A：主会话（09:00–12:20），D9 峰值 + D2 工具画像 ──────────────────────
  const aId = idOf("alpha-main");
  const a: RoundDDRecord[] = [
    user(aId, "/repo/dd-alpha", at(1, 9, 0), "dd：把今天的 alpha 账摊开"),
    // 09:15 这一分钟 6 次调用 × 205,000 = 1,230,000 tok（D9 冠军分钟）
    ...[0, 5, 10, 15, 20, 25].map((second) =>
      assistant(
        aId,
        "/repo/dd-alpha",
        at(1, 9, 15, second),
        `峰值第 ${second / 5 + 1} 次回答`,
        ROUND_DD_SONNET,
        usage(120_000, 5_000, 20_000, 60_000)
      )
    ),
    user(aId, "/repo/dd-alpha", at(1, 9, 35), "接着体检工具"),
    toolUse(aId, "/repo/dd-alpha", at(1, 9, 40), "dd-bash-1", "Bash", { command: "cat missing.txt" }),
    toolResult(
      aId,
      "/repo/dd-alpha",
      at(1, 9, 40, 1) + 200,
      "dd-bash-1",
      "cat: missing.txt: No such file or directory",
      true
    ),
    toolUse(aId, "/repo/dd-alpha", at(1, 9, 45), "dd-bash-2", "Bash", { command: "ls" }),
    toolResult(aId, "/repo/dd-alpha", at(1, 9, 45, 2) + 400, "dd-bash-2", "app.ts"),
    toolUse(aId, "/repo/dd-alpha", at(1, 9, 50), "dd-bash-3", "Bash", { command: "npm test" }),
    toolResult(aId, "/repo/dd-alpha", at(1, 9, 50, 4) + 800, "dd-bash-3", "ok"),
    toolUse(aId, "/repo/dd-alpha", at(1, 10, 0), "dd-grep-1", "Grep", { pattern: "TODO" }),
    toolResult(aId, "/repo/dd-alpha", at(1, 10, 0, 0) + 800, "dd-grep-1", "2 matches"),
    toolUse(aId, "/repo/dd-alpha", at(1, 10, 5), "dd-grep-2", "Grep", { pattern: "FIXME" }),
    toolResult(aId, "/repo/dd-alpha", at(1, 10, 5, 1) + 600, "dd-grep-2", "0 matches"),
    ...[0, 2, 4, 6].flatMap((second, index) => [
      toolUse(aId, "/repo/dd-alpha", at(1, 10, 8, second), `dd-read-${index + 1}`, "Read", {
        file_path: "/repo/dd-alpha/app.ts"
      }),
      toolResult(
        aId,
        "/repo/dd-alpha",
        at(1, 10, 8, second) + 600,
        `dd-read-${index + 1}`,
        "export const ok = true;"
      )
    ]),
    assistant(aId, "/repo/dd-alpha", at(1, 10, 10), "第一组小结", ROUND_DD_SONNET, usage(40_000, 3_000, 5_000, 20_000)),
    user(aId, "/repo/dd-alpha", at(1, 10, 20), "继续"),
    assistant(aId, "/repo/dd-alpha", at(1, 10, 40), "第二组小结", ROUND_DD_SONNET, usage(40_000, 3_000, 5_000, 20_000)),
    user(aId, "/repo/dd-alpha", at(1, 11, 0), "再继续"),
    assistant(aId, "/repo/dd-alpha", at(1, 11, 20), "第三组小结", ROUND_DD_SONNET, usage(40_000, 3_000, 5_000, 20_000)),
    assistant(aId, "/repo/dd-alpha", at(1, 12, 20), "今天的账摊完了")
  ];
  sessions.push({ cwd: "/repo/dd-alpha", id: aId, records: a });

  // ── B：与 A 时间相交的并行会话（D7 的 ∥），Opus 两次调用 ────────────────
  const bId = idOf("beta-parallel");
  sessions.push({
    cwd: "/repo/dd-beta",
    id: bId,
    records: [
      user(bId, "/repo/dd-beta", at(1, 9, 30), "dd：beta 并行跑一遍"),
      assistant(bId, "/repo/dd-beta", at(1, 9, 35), "beta 第一段", ROUND_DD_OPUS, usage(60_000, 4_000, 8_000, 30_000)),
      assistant(bId, "/repo/dd-beta", at(1, 9, 40), "beta 第二段", ROUND_DD_OPUS, usage(60_000, 4_000, 8_000, 30_000)),
      user(bId, "/repo/dd-beta", at(1, 10, 50), "并行收尾"),
      assistant(bId, "/repo/dd-beta", at(1, 11, 0), "beta 收尾")
    ]
  });

  // ── C：前天（D8 连击的第 2 天），Haiku 三次调用 ─────────────────────────
  const cId = idOf("alpha-day2");
  sessions.push({
    cwd: "/repo/dd-alpha",
    id: cId,
    records: [
      user(cId, "/repo/dd-alpha", at(2, 9, 5), "dd：前天的 alpha"),
      assistant(cId, "/repo/dd-alpha", at(2, 9, 10), "前天第一段", ROUND_DD_HAIKU, usage(30_000, 2_000, 4_000, 10_000)),
      assistant(cId, "/repo/dd-alpha", at(2, 9, 20), "前天第二段", ROUND_DD_HAIKU, usage(30_000, 2_000, 4_000, 10_000)),
      user(cId, "/repo/dd-alpha", at(2, 9, 50), "收尾"),
      assistant(cId, "/repo/dd-alpha", at(2, 10, 5), "前天第三段", ROUND_DD_HAIKU, usage(30_000, 2_000, 4_000, 10_000))
    ]
  });

  // ── D：大前天，gpt-5（未定价）两次调用 —— D3 的「未知价」与「未计入」 ────
  const dId = idOf("gamma-unpriced");
  sessions.push({
    cwd: "/repo/dd-gamma",
    id: dId,
    records: [
      user(dId, "/repo/dd-gamma", at(3, 9, 0), "dd：gamma 试一下未定价模型"),
      assistant(dId, "/repo/dd-gamma", at(3, 9, 12), "gamma 第一段", ROUND_DD_UNPRICED, usage(200_000, 9_000, 0, 0)),
      assistant(dId, "/repo/dd-gamma", at(3, 9, 30), "gamma 第二段", ROUND_DD_UNPRICED, usage(100_000, 4_000, 0, 0)),
      assistant(dId, "/repo/dd-gamma", at(3, 9, 40), "gamma 结束")
    ]
  });

  // ── 9 个单消息会话：凑满 13 行（12 行上限）并撑起四天连击 ────────────────
  const fillers: Array<{ slug: string; cwd: string; daysAgo: number; hour: number; minute: number }> = [
    { slug: "fill-1", cwd: "/repo/dd-alpha", daysAgo: 1, hour: 10, minute: 0 },
    // 22:00 这条开始得最晚，是第 13 行、被上限截掉的那一个
    { slug: "fill-2", cwd: "/repo/dd-alpha", daysAgo: 1, hour: 22, minute: 0 },
    { slug: "fill-3", cwd: "/repo/dd-alpha", daysAgo: 2, hour: 10, minute: 0 },
    { slug: "fill-4", cwd: "/repo/dd-alpha", daysAgo: 2, hour: 11, minute: 0 },
    { slug: "fill-5", cwd: "/repo/dd-alpha", daysAgo: 3, hour: 10, minute: 0 },
    { slug: "fill-6", cwd: "/repo/dd-alpha", daysAgo: 3, hour: 11, minute: 0 },
    { slug: "fill-7", cwd: "/repo/dd-alpha", daysAgo: 3, hour: 12, minute: 0 },
    { slug: "fill-8", cwd: "/repo/dd-alpha", daysAgo: 4, hour: 9, minute: 30 },
    { slug: "fill-9", cwd: "/repo/dd-alpha", daysAgo: 4, hour: 10, minute: 30 }
  ];
  for (const filler of fillers) {
    const id = idOf(filler.slug);
    sessions.push({
      cwd: filler.cwd,
      id,
      records: [user(id, filler.cwd, at(filler.daysAgo, filler.hour, filler.minute), `dd：${filler.slug}`)]
    });
  }

  // **不装默认场景的八份**：它们的时间戳在两个月前，甘特按开始时间升序的
  // 前 12 行会被它们占满，本轮的 A/B/C 被挤出画面，并行标记就看不见；
  // 工具健康也会被旧夹具的 Bash 调用顶成 7 次。默认八份由别的场景覆盖。
  const files: Record<string, string> = {};
  for (const seed of sessions) {
    files[`${HOME}/.claude/projects/${projectDir(seed.cwd)}/${seed.id}.jsonl`] = roundDDJsonl(seed);
  }

  return { files, records: sessions.flatMap((seed) => seed.records), now };
}

let roundDDCache: { files: Record<string, string>; records: RoundDDRecord[]; now: number } | null =
  null;

function roundDDBuilt(): { files: Record<string, string>; records: RoundDDRecord[]; now: number } {
  // 同一进程里的多个用例共用一个时刻：跨整点/跨天后「昨天 09:00」不会漂。
  if (roundDDCache === null) roundDDCache = buildRoundDD();
  return roundDDCache;
}

/** Round DD 全量记录（时间戳为 ISO 字符串）——e2e 用它手算期望值。 */
export function roundDDRecords(): RoundDDRecord[] {
  return roundDDBuilt().records;
}

/** 夹具构建时的基准时刻；用例不得再直接读 `Date.now()`。 */
export function roundDDNow(): number {
  return roundDDBuilt().now;
}

/**
 * Round DD 专用场景：**只装本轮的会话文件**，不叠默认的八份。
 *
 * 叠默认夹具会把工具健康（Bash 被旧夹具的调用顶到 7 次）与甘特（21 个会话，
 * 开始时间最早的 12 个先占坑，把 A/B/C 挤出画面，并行标记也就看不见了）
 * 一起带偏；默认八份已由别的场景覆盖，这里要的是能对账的干净数字。
 */
export function roundDDScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    ...defaultScenario(overrides),
    files: roundDDBuilt().files
  };
}

/**
 * 「单分钟 / 无计划」的最小场景：两轮请求都落在同一分钟里，且只有一段会话。
 *
 * 给 D9 的「单分钟」与 D6 的「没有计划限额」两个空态用：`peakMinute` 有读数
 * 但没有次高（提示写「只有这一分钟有读数」），`buildLimitForecast` 因
 * `limitTokens === null` 返回 null（`forecast-row` 整行不画）。
 *
 * 刻意**不带**默认的八个会话：带上就会混进别的分钟，D9 的「单分钟」前提消失。
 */
export function roundDDQuietScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const now = roundDDNow();
  const minute = Math.floor(now / 60_000) * 60_000 - 10 * 60_000;
  const stamp = (offset: number) => new Date(minute + offset).toISOString();
  const records = [
    {
      type: "user",
      sessionId: "dd00ffee-0000-4000-8000-quiet-only-0",
      cwd: "/repo/dd-quiet",
      timestamp: stamp(0),
      message: { role: "user", content: "这一分钟里只有两次请求。" }
    },
    {
      type: "assistant",
      sessionId: "dd00ffee-0000-4000-8000-quiet-only-0",
      cwd: "/repo/dd-quiet",
      timestamp: stamp(20_000),
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "第一次。" }],
        usage: {
          input_tokens: 60,
          output_tokens: 40,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      }
    },
    {
      type: "assistant",
      sessionId: "dd00ffee-0000-4000-8000-quiet-only-0",
      cwd: "/repo/dd-quiet",
      timestamp: stamp(40_000),
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [{ type: "text", text: "第二次。" }],
        usage: {
          input_tokens: 30,
          output_tokens: 10,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        }
      }
    }
  ];
  return {
    ...defaultScenario(overrides),
    files: {
      [`${HOME}/.claude/projects/${projectDir("/repo/dd-quiet")}/quiet-dd.jsonl`]:
        records.map((record) => JSON.stringify(record)).join("\n") + "\n"
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

/**
 * 一日回望 × 未知定价（Issue #195）。
 *
 * 在 `calendarScenario()` 之上加一个「现在−5」的会话，它的模型**不在定价快照里**：
 * 这一天的成本只统计已知部分，天格与展开区摘要都必须标「部分会话未知价」。
 * 单独一个场景而不是改 `calendarScenario()`——后者被大量确定性断言（成本、会话数、
 * 天格标签）钉着，往里塞一条 unknown 会话会连带打掉一片用例。
 */
export function calendarUnknownCostScenario(): MockScenario {
  const base = calendarScenario();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const startedAt = todayStart.getTime() - 5 * 24 * 3_600_000 + 10 * 3_600_000;

  const cwd = "/repo/calendar-unknown";
  const sessionId = "3d2a5442-9c65-4b28-9c30-bb3d1a1f9001";
  const lines = [
    {
      type: "user",
      sessionId,
      cwd,
      timestamp: new Date(startedAt).toISOString(),
      uuid: "cal-unknown-0",
      parentUuid: null,
      isSidechain: false,
      message: { role: "user", content: "未知定价夹具会话" }
    },
    {
      type: "assistant",
      sessionId,
      cwd,
      timestamp: new Date(startedAt + 90_000).toISOString(),
      uuid: "cal-unknown-1",
      parentUuid: "cal-unknown-0",
      isSidechain: false,
      message: {
        id: "cal-unknown-msg-1",
        role: "assistant",
        // 已定价模型：这一天的成本是**已知部分**的合计，不是 0。
        model: "claude-sonnet-4",
        content: [{ type: "text", text: "已知定价的那条回答" }],
        usage: { input_tokens: 100_000 }
      }
    },
    {
      type: "assistant",
      sessionId,
      cwd,
      timestamp: new Date(startedAt + 180_000).toISOString(),
      uuid: "cal-unknown-2",
      parentUuid: "cal-unknown-1",
      isSidechain: false,
      message: {
        id: "cal-unknown-msg-2",
        role: "assistant",
        // 这个模型刻意不在定价快照里：成本无法折算，但 token 照报。
        model: "gpt-unknown-9",
        content: [{ type: "text", text: "未知定价夹具会话的回答" }],
        usage: { input_tokens: 100_000 }
      }
    }
  ];

  const path = `${HOME}/.claude/projects/${projectDir(cwd)}/${sessionId}.jsonl`;
  return {
    ...base,
    files: { ...base.files, [path]: `${lines.map((line) => JSON.stringify(line)).join("\n")}\n` }
  };
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

/**
 * 「监控台」场景（Issue #225）：三个项目、三个活跃会话，所有时间都相对
 * `Date.now()` 现算。写死日期会让「今天」「近 15 分钟」和 24 小时窗口在第二天
 * 同时失效，断言会以空面板这种毫无线索的方式假红。
 *
 * 账目（e2e 与截图逐项对账）：
 *  - token：alpha 600 + beta 1,000 + gamma 600 = 2,200；
 *  - 活跃会话：3；今天压缩：2（alpha 自动、beta 手动）；
 *  - 事件流：7 条——3 个会话开始、2 条错误、2 次压缩；
 *  - 项目速率：beta 4,000/时，alpha / gamma 各 2,400/时（并列按项目名升序）。
 *
 * 错误正文刻意带 `/Users/...` 与 `/home/...`：页面上只允许出现脱敏预览，
 * 截图与 DOM 都不该泄漏这些绝对路径。
 */
export const MONITOR_CONSOLE_TITLES = {
  alpha: "修复构建脚本的失败路径",
  beta: "排查导出日志缺失",
  gamma: "整理监控台端到端断言"
} as const;

export const MONITOR_CONSOLE_TOTAL_TOKENS = 2_200;

/**
 * 监控台夹具与页面共同使用的本地时刻：当天 12:30。
 *
 * 24 小时活动带要同时出现 past / current / future，凌晨 0 点或深夜 23 点运行
 * 时这个前提天然不成立。`page.clock.setFixedTime()` 只冻结 `Date`，保留真实
 * 定时器，所以 feed 的 5 秒拍点照常运行。
 */
export const MONITOR_CONSOLE_NOW = (() => {
  const date = new Date();
  date.setHours(12, 30, 0, 0);
  return date.getTime();
})();

export const MONITOR_CONSOLE_EVENT_COUNTS = {
  all: 7,
  compaction: 2,
  error: 2,
  session: 3
} as const;

type MonitorConsoleSession = {
  cwd: string;
  id: string;
  prefix: string;
};

const MONITOR_CONSOLE_SESSIONS: Record<keyof typeof MONITOR_CONSOLE_TITLES, MonitorConsoleSession> = {
  alpha: {
    cwd: "/repo/console-alpha",
    id: "3d2a5442-9c65-4b28-9c30-bb3d1a210001",
    prefix: "monitor-console-alpha"
  },
  beta: {
    cwd: "/repo/console-beta",
    id: "3d2a5442-9c65-4b28-9c30-bb3d1a210002",
    prefix: "monitor-console-beta"
  },
  gamma: {
    cwd: "/repo/console-gamma",
    id: "3d2a5442-9c65-4b28-9c30-bb3d1a210003",
    prefix: "monitor-console-gamma"
  }
};

type MonitorConsoleRecord =
  | { kind: "user"; at: number; text: string }
  | { kind: "assistant"; at: number; text: string; usage?: PulseUsage }
  | {
      kind: "toolUse";
      at: number;
      toolId: string;
      toolName: string;
      input: Record<string, unknown>;
    }
  | { kind: "toolError"; at: number; toolId: string; text: string }
  | { kind: "apiError"; at: number; text: string }
  | {
      kind: "compact";
      at: number;
      trigger: "auto" | "manual";
      preTokens: number;
      summary: string;
    };

function monitorConsoleSessionLines(
  session: MonitorConsoleSession,
  records: readonly MonitorConsoleRecord[]
): { content: string; mtimeMs: number } {
  const lines: string[] = [];
  let lastUuid: string | null = null;

  for (const record of records) {
    const timestamp = new Date(record.at).toISOString();
    const uuid = `${session.prefix}-${lines.length}`;

    if (record.kind === "compact") {
      lines.push(
        JSON.stringify({
          sessionId: session.id,
          cwd: session.cwd,
          timestamp,
          uuid,
          parentUuid: null,
          isSidechain: false,
          type: "system",
          subtype: "compact_boundary",
          content: "Conversation compacted",
          level: "info",
          logicalParentUuid: lastUuid,
          compactMetadata: {
            trigger: record.trigger,
            preTokens: record.preTokens,
            postTokens: 2_000,
            cumulativeDroppedTokens: record.preTokens - 2_000,
            durationMs: 12_000
          }
        })
      );
      lastUuid = uuid;
      const summaryUuid = `${session.prefix}-${lines.length}`;
      lines.push(
        JSON.stringify({
          sessionId: session.id,
          cwd: session.cwd,
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
      sessionId: session.id,
      cwd: session.cwd,
      timestamp,
      uuid,
      parentUuid: lastUuid,
      isSidechain: false
    };

    if (record.kind === "user") {
      lines.push(
        JSON.stringify({
          ...base,
          type: "user",
          message: { role: "user", content: record.text }
        })
      );
    } else if (record.kind === "toolUse") {
      lines.push(
        JSON.stringify({
          ...base,
          type: "assistant",
          message: {
            id: `${session.prefix}-msg-${lines.length}`,
            role: "assistant",
            model: PULSE_MODEL,
            content: [
              {
                type: "tool_use",
                id: record.toolId,
                name: record.toolName,
                input: record.input
              }
            ]
          }
        })
      );
    } else if (record.kind === "toolError") {
      lines.push(
        JSON.stringify({
          ...base,
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: record.toolId,
                content: record.text,
                is_error: true
              }
            ]
          }
        })
      );
    } else if (record.kind === "apiError") {
      lines.push(
        JSON.stringify({
          ...base,
          type: "assistant",
          isApiErrorMessage: true,
          message: {
            id: `${session.prefix}-api-error-${lines.length}`,
            role: "assistant",
            model: "<synthetic>",
            content: [{ type: "text", text: record.text }],
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            }
          }
        })
      );
    } else {
      lines.push(
        JSON.stringify({
          ...base,
          type: "assistant",
          message: {
            id: `${session.prefix}-msg-${lines.length}`,
            role: "assistant",
            model: PULSE_MODEL,
            content: [{ type: "text", text: record.text }],
            ...(record.usage
              ? {
                  usage: {
                    input_tokens: record.usage.input,
                    output_tokens: record.usage.output,
                    cache_creation_input_tokens: record.usage.cacheCreation,
                    cache_read_input_tokens: record.usage.cacheRead
                  }
                }
              : {})
          }
        })
      );
    }

    lastUuid = uuid;
  }

  const last = records.at(-1);
  return {
    content: `${lines.join("\n")}\n`,
    mtimeMs: last?.at ?? Date.now()
  };
}

function monitorConsoleSessionPath(session: MonitorConsoleSession): string {
  return `${HOME}/.claude/projects/${projectDir(session.cwd)}/${session.id}.jsonl`;
}

export function monitorConsoleScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  const now = MONITOR_CONSOLE_NOW;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const ago = (minutes: number, seconds = 0) =>
    Math.max(todayStart.getTime(), now - minutes * 60_000 - seconds * 1_000);

  const alpha = monitorConsoleSessionLines(MONITOR_CONSOLE_SESSIONS.alpha, [
    { kind: "user", at: ago(14), text: MONITOR_CONSOLE_TITLES.alpha },
    {
      kind: "assistant",
      at: ago(13),
      text: "先检查构建入口。",
      usage: pulseUsage(100, 20, 30, 50)
    },
    {
      kind: "compact",
      at: ago(12),
      trigger: "auto",
      preTokens: 10_000,
      summary: "会话摘要：构建入口已定位，下一步检查失败路径。"
    },
    {
      kind: "assistant",
      at: ago(11),
      text: "再跑一次失败用例。",
      usage: pulseUsage(200, 40, 60, 100)
    },
    {
      kind: "toolUse",
      at: ago(10, 2),
      toolId: "monitor-console-alpha-bash",
      toolName: "Bash",
      input: { command: "npm test" }
    },
    {
      kind: "toolError",
      at: ago(10),
      toolId: "monitor-console-alpha-bash",
      text: "Exit code 2\n/Users/alice/private/build.log: permission denied"
    }
  ]);

  const beta = monitorConsoleSessionLines(MONITOR_CONSOLE_SESSIONS.beta, [
    { kind: "user", at: ago(8), text: MONITOR_CONSOLE_TITLES.beta },
    {
      kind: "assistant",
      at: ago(7),
      text: "先跑导出并检查日志。",
      usage: pulseUsage(500, 100, 150, 250)
    },
    {
      kind: "apiError",
      at: ago(6),
      text: "ENOENT /Users/alice/private/export.json\n/home/alice/private/export.log"
    },
    {
      kind: "compact",
      at: ago(5),
      trigger: "manual",
      preTokens: 50_000,
      summary: "会话摘要：导出错误已复现，等待重新运行。"
    }
  ]);

  const gamma = monitorConsoleSessionLines(MONITOR_CONSOLE_SESSIONS.gamma, [
    { kind: "user", at: ago(4), text: MONITOR_CONSOLE_TITLES.gamma },
    {
      kind: "assistant",
      at: ago(3),
      text: "端到端断言的账目已对齐。",
      usage: pulseUsage(300, 60, 90, 150)
    }
  ]);

  const files: Record<string, string> = {
    [monitorConsoleSessionPath(MONITOR_CONSOLE_SESSIONS.alpha)]: alpha.content,
    [monitorConsoleSessionPath(MONITOR_CONSOLE_SESSIONS.beta)]: beta.content,
    [monitorConsoleSessionPath(MONITOR_CONSOLE_SESSIONS.gamma)]: gamma.content
  };
  const fileMtimes: Record<string, number> = {
    [monitorConsoleSessionPath(MONITOR_CONSOLE_SESSIONS.alpha)]: alpha.mtimeMs,
    [monitorConsoleSessionPath(MONITOR_CONSOLE_SESSIONS.beta)]: beta.mtimeMs,
    [monitorConsoleSessionPath(MONITOR_CONSOLE_SESSIONS.gamma)]: gamma.mtimeMs
  };

  return { ...emptyScenario(), files, fileMtimes, ...overrides };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Round EE「第三批十功能」夹具
 *
 * 数据形状（每条都有对应断言）：
 *   - 18 个自然日各一段会话（day-18 … day-1），满足 E1 的 7 天均线与
 *     14 天外推；日量在 9,000 / 11,000 之间交替，让异常判定的标准差非零；
 *   - day-13 是 60,000 tok 的异常日（约为邻近日的 6 倍，z ≥ 2，日历上也
 *     会点亮角标）；
 *   - Sonnet 只在 day-18 与 day-2 使用（间隔 16 天 > 14 天）→ E6 的回归段；
 *     其余日子用 Opus，两种模型各有一条起止条；
 *   - 今天一段 5 次调用的时间轴会话（上下文 20k→100k）→ E3 的水位与手柄、
 *     E7 的健康分（平均水位 60%，压缩 0 次、出血 0 处 → 40 分「紧张」）；
 *   - 最后一条记录在 now−2 分钟，E9 的「N 分钟前」有真实读数可读。
 *
 * 时间锚点：构建时取一次 `Date.now()`，之后全部由 `at(daysAgo, h, m)` 派生；
 * 同一进程内多条用例共用一个 now（见 roundEECache），跨整点时「今天」不漂。
 *
 * **为什么不进 `SESSION_SEEDS`**：默认场景的 8 份会话与全部含侧栏的归档截图
 * 都按它写死，追加会让「会话数」类断言与截图基线整体漂移；沿用 `costScenario`
 * / `roundCCScenario` / `roundDDScenario` 的先例，只在需要它的场景里装文件。
 * ────────────────────────────────────────────────────────────────────────── */

const ROUND_EE_SONNET = "claude-sonnet-4-5-20250929";
const ROUND_EE_OPUS = "claude-opus-4-1-20250805";

type RoundEEUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

type RoundEERecord = Record<string, unknown>;

type RoundEESessionSeed = { cwd: string; id: string; records: RoundEERecord[] };

function roundEEJsonl(seed: RoundEESessionSeed): string {
  const sorted = [...seed.records].sort(
    (a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp))
  );
  return sorted.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

function buildRoundEE(): { files: Record<string, string>; records: RoundEERecord[]; now: number } {
  const now = Date.now();

  /** 本地日历：`daysAgo` 天前的 `hour:minute:second`。 */
  const at = (daysAgo: number, hour: number, minute: number, second = 0): number => {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    day.setHours(hour, minute, second, 0);
    return day.getTime();
  };

  let uuidSeed = 0;
  const idOf = (slug: string) =>
    `ee00ffee-0000-4000-8000-${slug.padEnd(12, "0").slice(0, 12)}`;

  const make = (
    kind: "user" | "assistant",
    sessionId: string,
    cwd: string,
    timestamp: number,
    message: Record<string, unknown>
  ): RoundEERecord => {
    uuidSeed += 1;
    return {
      type: kind,
      sessionId,
      cwd,
      gitBranch: "main",
      version: "2.1.0",
      timestamp: new Date(timestamp).toISOString(),
      uuid: `roundee-${uuidSeed}`,
      parentUuid: null,
      isSidechain: false,
      message
    };
  };

  const user = (sessionId: string, cwd: string, timestamp: number, text: string) =>
    make("user", sessionId, cwd, timestamp, { role: "user", content: text });

  const assistant = (
    sessionId: string,
    cwd: string,
    timestamp: number,
    text: string,
    model: string,
    usage?: RoundEEUsage
  ) =>
    make("assistant", sessionId, cwd, timestamp, {
      id: `roundee-msg-${uuidSeed + 1}`,
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {})
    });

  const usage = (
    input: number,
    output: number,
    cacheCreation: number,
    cacheRead: number
  ): RoundEEUsage => ({
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  });

  const cwd = "/repo/ee";
  const sessions: RoundEESessionSeed[] = [];

  // ── 18 个自然日：E1 的均线/外推、E2 的异常日、E6 的回归段 ──────────────
  for (let day = 18; day >= 1; day -= 1) {
    const id = idOf(`day-${day}`);
    const total = day === 13 ? 60_000 : day % 2 === 0 ? 9_900 : 10_100;
    const model = day === 18 || day === 2 ? ROUND_EE_SONNET : ROUND_EE_OPUS;
    const input = Math.round(total * 0.6);
    sessions.push({
      cwd,
      id,
      records: [
        user(id, cwd, at(day, 10, 0), `ee：第 ${day} 天`),
        assistant(id, cwd, at(day, 10, 2), `第 ${day} 天的回答`, model, usage(input, total - input, 0, 0))
      ]
    });
  }

  // ── 今天：E3 时间轴 / E7 健康分 / E9 新鲜度 ───────────────────────────
  const timelineId = idOf("timeline");
  const timelineRecords: RoundEERecord[] = [];
  const contexts = [20_000, 40_000, 60_000, 80_000, 100_000];
  const start = now - 10 * 60_000;
  contexts.forEach((context, index) => {
    const stamp = start + index * 2 * 60_000;
    timelineRecords.push(user(timelineId, cwd, stamp, `ee：时间轴第 ${index + 1} 段`));
    timelineRecords.push(
      assistant(
        timelineId,
        cwd,
        stamp + 15_000,
        `第 ${index + 1} 段回答`,
        ROUND_EE_SONNET,
        usage(1_000, 500, 0, context - 1_000)
      )
    );
  });
  sessions.push({ cwd, id: timelineId, records: timelineRecords });

  const files: Record<string, string> = {};
  for (const seed of sessions) {
    files[`${HOME}/.claude/projects/${projectDir(seed.cwd)}/${seed.id}.jsonl`] = roundEEJsonl(seed);
  }

  return { files, records: sessions.flatMap((seed) => seed.records), now };
}

let roundEECache: { files: Record<string, string>; records: RoundEERecord[]; now: number } | null =
  null;

function roundEEBuilt(): { files: Record<string, string>; records: RoundEERecord[]; now: number } {
  if (roundEECache === null) roundEECache = buildRoundEE();
  return roundEECache;
}

/** Round EE 全量记录（时间戳为 ISO 字符串）——e2e 用它手算期望值。 */
export function roundEERecords(): RoundEERecord[] {
  return roundEEBuilt().records;
}

/** 夹具构建时的基准时刻；用例不得再直接读 `Date.now()`。 */
export function roundEENow(): number {
  return roundEEBuilt().now;
}

/**
 * Round EE 专用场景：只装本轮会话，不叠默认八份（理由见上方长注释）。
 *
 * `savePath` 缺省给一个虚拟路径，让 E5 的 CSV 导出走完「保存框 → write_text」；
 * 需要「用户取消」分支的场景显式传 `savePath: null`。
 */
export function roundEEScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    ...defaultScenario(overrides),
    files: roundEEBuilt().files,
    savePath: "/Users/e2e/Documents/export.csv",
    ...overrides
  };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Round FF「第四批十功能 · 数据实验室」夹具
 *
 * 十张卡要同时有内容，数据形状因此比前几轮更宽（每条都对应一张卡的断言）：
 *   - 5 个项目 × 24 个会话，散布在最近 20 天 + 今天 + 昨天 + 本周；
 *   - 三个已定价模型（sonnet / opus / haiku）+ 一个未定价模型（`gpt-4o`），
 *     后者让成本地形 / 名人堂报出「未参与」计数；
 *   - 今天一场跨三条通道的会话，中间留一段长停顿（心跳的静默标注）；
 *   - 至少一个只有用户消息、没有 usage 的会话（星系的空心环）；
 *   - Read / Edit / Write / Grep / Glob / Bash 都有配对结果，耗时各不相同；
 *     一条失败调用（火焰 / 错误的真实形态）、一条未配对调用（?N 计数）；
 *   - `/repo/shared/CONTRIBUTING.md` 与 `/repo/shared/scripts/lint.sh` 被多个
 *     项目触碰（足迹图的共享文件；绝对路径不常显，只进 title）；
 *   - 用户提示词长度（2–900 字）与间隔（10 秒 / 90 秒 / 12 分 / 45 分）跨度大
 *     （散点的分布形状）；今天与本周都有记录（跑道）。
 *
 * 时间一律相对 `Date.now()` 生成；「本周」按本地自然周（周一起）算，而不是
 * 「今天减 N 天」——否则周一跑截图时，减 3 天会掉到上一周。
 * 同一进程内多条用例共用一个 now（见 roundFFCache），跨整点时「今天」不漂。
 *
 * **为什么不进 `SESSION_SEEDS`**：默认八份会话是全部既有归档截图的基线，
 * 追加会让「会话数」类断言整体漂移；沿用 roundCC / DD / EE 的先例，只在需要
 * 它的场景里装文件。
 * ────────────────────────────────────────────────────────────────────────── */

const ROUND_FF_SONNET = "claude-sonnet-4-5-20250929";
const ROUND_FF_OPUS = "claude-opus-4-1-20250805";
const ROUND_FF_HAIKU = "claude-haiku-4-5-20251001";
/** 定价快照里没有这个前缀——成本地形与名人堂必须把它报成「未参与」。 */
const ROUND_FF_UNPRICED = "gpt-4o";
const ROUND_FF_HOUR = 3_600_000;

type RoundFFUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

type RoundFFRecord = Record<string, unknown>;

type RoundFFSessionSeed = { cwd: string; id: string; records: RoundFFRecord[] };

function roundFFJsonl(seed: RoundFFSessionSeed): string {
  const sorted = [...seed.records].sort(
    (a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp))
  );
  return sorted.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

/** 本地自然周的周一零点（Natural week, Monday start）。 */
function roundFFWeekStart(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  // getDay(): 0 = Sunday；折成「周一 = 0」。
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

function buildRoundFF(): {
  files: Record<string, string>;
  records: RoundFFRecord[];
  now: number;
} {
  const now = Date.now();
  const weekStart = roundFFWeekStart(now);
  const sessions: RoundFFSessionSeed[] = [];
  let uuidSeed = 0;

  /** 本地日历：`daysAgo` 天前的 `hour:minute`。 */
  const at = (daysAgo: number, hour: number, minute: number): number => {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    day.setHours(hour, minute, 0, 0);
    return day.getTime();
  };

  const idOf = (value: number) =>
    `ff00ffee-0000-4000-8000-${String(value).padStart(12, "0")}`;

  const make = (
    kind: "user" | "assistant",
    sessionId: string,
    cwd: string,
    timestamp: number,
    message: Record<string, unknown>
  ): RoundFFRecord => {
    uuidSeed += 1;
    return {
      type: kind,
      sessionId,
      cwd,
      gitBranch: "main",
      version: "2.1.0",
      timestamp: new Date(timestamp).toISOString(),
      uuid: `roundff-${uuidSeed}`,
      parentUuid: null,
      isSidechain: false,
      message
    };
  };

  const user = (sessionId: string, cwd: string, timestamp: number, text: string) =>
    make("user", sessionId, cwd, timestamp, { role: "user", content: text });

  const assistant = (
    sessionId: string,
    cwd: string,
    timestamp: number,
    text: string,
    model: string,
    usage?: RoundFFUsage
  ) =>
    make("assistant", sessionId, cwd, timestamp, {
      id: `roundff-msg-${uuidSeed + 1}`,
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      ...(usage ? { usage } : {})
    });

  const toolUse = (
    sessionId: string,
    cwd: string,
    timestamp: number,
    toolId: string,
    name: string,
    input: Record<string, unknown>,
    model: string
  ) =>
    make("assistant", sessionId, cwd, timestamp, {
      id: `roundff-tool-msg-${toolId}`,
      role: "assistant",
      model,
      content: [{ type: "tool_use", id: toolId, name, input }],
      // 真实日志里 tool_use 也属于一次带 usage 的 assistant 消息；给上小用量，
      // 让「每条 assistant 都有 usage」这条夹具事实成立。
      usage: usage(500, 200, 0, 1_500)
    });

  const toolResult = (
    sessionId: string,
    cwd: string,
    timestamp: number,
    toolId: string,
    text = "ok",
    isError = false
  ) =>
    make("user", sessionId, cwd, timestamp, {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolId, content: text, is_error: isError }]
    });

  const usage = (
    input: number,
    output: number,
    cacheCreation: number,
    cacheRead: number
  ): RoundFFUsage => ({
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  });

  const PROJECTS = [
    { cwd: "/repo/ff-alpha", name: "ff-alpha" },
    { cwd: "/repo/ff-beta", name: "ff-beta" },
    { cwd: "/repo/ff-gamma", name: "ff-gamma" },
    { cwd: "/repo/ff-delta", name: "ff-delta" },
    { cwd: "/repo/ff-epsilon", name: "ff-epsilon" }
  ];
  const MODELS = [ROUND_FF_SONNET, ROUND_FF_OPUS, ROUND_FF_HAIKU, ROUND_FF_UNPRICED];
  const TOOL_NAMES = ["Read", "Edit", "Write", "Grep", "Glob", "Bash"];
  /** 同一工具在不同会话的耗时差：火焰图才有「哪段最长」可读。 */
  const TOOL_DELAYS = [1_200, 4_500, 30_000, 95_000];
  /** 用户消息之间的间隔：10 秒 → 45 分，散点横轴的形状靠它。 */
  const PROMPT_GAPS = [10_000, 90_000, 12 * 60_000, 45 * 60_000];
  const SHARED_CONTRIBUTING = "/repo/shared/CONTRIBUTING.md";
  const SHARED_LINT = "/repo/shared/scripts/lint.sh";

  const toolInput = (
    name: string,
    path: string,
    index: number
  ): Record<string, unknown> => {
    if (name === "Read" || name === "Edit" || name === "Write") {
      return { file_path: path };
    }
    if (name === "Grep") return { pattern: index % 2 === 0 ? "TODO" : "FIXME" };
    if (name === "Glob") return { pattern: index % 2 === 0 ? "**/*.ts" : "**/*.md" };
    return { command: index % 2 === 0 ? "npm test" : "git status --short" };
  };

  // ── 最近 20 天：每天一段会话，轮换项目 / 模型 / 小时 / 星期 ──────────────
  for (let index = 0; index < 20; index += 1) {
    const project = PROJECTS[index % PROJECTS.length];
    const model = MODELS[index % MODELS.length];
    const sessionId = idOf(index + 1);
    const base = at(index + 1, 7 + ((index * 3) % 14), (index * 11) % 50);
    const records: RoundFFRecord[] = [];

    // 两条用户消息：长度与间隔都在变（散点需要两个维度都有方差）。
    records.push(
      user(
        sessionId,
        project.cwd,
        base,
        `${project.name} 第 ${index + 1} 段：${"背景与约束 ".repeat(1 + (index % 5))}`
      )
    );
    records.push(
      user(
        sessionId,
        project.cwd,
        base + PROMPT_GAPS[index % PROMPT_GAPS.length],
        index % 3 === 0
          ? "继续"
          : `补充 ${index + 1}：${"把这一步的取舍与证据写清楚 ".repeat(8 + (index % 9))}`
      )
    );

    const total = 12_000 + index * 3_700;
    records.push(
      assistant(
        sessionId,
        project.cwd,
        base + 120_000,
        `第 ${index + 1} 段的回答`,
        model,
        usage(total, Math.round(total * 0.4), Math.round(total * 0.2), total * 2)
      )
    );

    for (let slot = 0; slot < 3; slot += 1) {
      const name = TOOL_NAMES[(index + slot) % TOOL_NAMES.length];
      const toolId = `ff-tool-${index}-${slot}`;
      const useAt = base + 180_000 + slot * 10_000;
      // 前两槽是项目内文件；之后按 (index + slot) 的路数穿插两个共享绝对路径。
      let path = `${project.cwd}/src/module-${index}-${slot}.ts`;
      if (slot > 0 && (index + slot) % 3 === 0) path = SHARED_CONTRIBUTING;
      else if (slot > 0 && (index + slot) % 5 === 0) path = SHARED_LINT;

      records.push(toolUse(sessionId, project.cwd, useAt, toolId, name, toolInput(name, path, index), model));
      records.push(
        toolResult(
          sessionId,
          project.cwd,
          useAt + TOOL_DELAYS[(index + slot) % TOOL_DELAYS.length],
          toolId,
          // 一例失败调用：火焰的失败事实与错误聚类的真实形态。
          index === 4 && slot === 2 ? "Error: exit code 1" : "ok",
          index === 4 && slot === 2
        )
      );
    }

    // 一条未配对调用：耗时未知（火焰右列的 ?N），不是 0。
    if (index === 6) {
      records.push(
        toolUse(
          sessionId,
          project.cwd,
          base + 420_000,
          `ff-unmatched-${index}`,
          "Glob",
          { pattern: "**/*.md" },
          model
        )
      );
    }

    sessions.push({ cwd: project.cwd, id: sessionId, records });
  }

  // ── 今天：三条通道 + 一段长停顿（心跳），并埋一次最贵调用（名人堂）──────
  const todayId = idOf(101);
  const todayCwd = PROJECTS[0].cwd;
  const todayStart = (() => {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  })();
  // 让今天的事件全部落在当日且早于 now：正常时段从 now-6h 起；
  // 凌晨启动时退化到零点，宁可把节奏带压短，也不生成未来时间戳。
  const todayCandidate = Math.max(todayStart + 60_000, now - 6 * ROUND_FF_HOUR);
  const todayAnchor = todayCandidate <= now - 60_000 ? todayCandidate : todayStart;
  const todaySpan = Math.max(1_000, now - todayAnchor - 30_000);
  const todayAt = (fraction: number) => todayAnchor + Math.floor(todaySpan * fraction);

  const todayRecords: RoundFFRecord[] = [
    user(todayId, todayCwd, todayAt(0), "今天：把 ff-alpha 的十种看法都跑一遍"),
    assistant(
      todayId,
      todayCwd,
      todayAt(0.02),
      "先跑星系与地形。",
      ROUND_FF_SONNET,
      usage(2_400, 900, 1_200, 8_000)
    ),
    toolUse(todayId, todayCwd, todayAt(0.04), "ff-today-read", "Read", {
      file_path: SHARED_CONTRIBUTING
    }, ROUND_FF_SONNET),
    toolResult(todayId, todayCwd, todayAt(0.04) + 2_000, "ff-today-read"),
    toolUse(todayId, todayCwd, todayAt(0.08), "ff-today-bash", "Bash", {
      command: "npm --prefix web test"
    }, ROUND_FF_SONNET),
    toolResult(todayId, todayCwd, todayAt(0.08) + 65_000, "ff-today-bash"),
    // 中间空出约半个 span：心跳的「静默 N 小时」读数。
    user(
      todayId,
      todayCwd,
      todayAt(0.62),
      `隔了很久再问：${"这一段请按会话分组，并说明为什么有些调用没有结果。".repeat(6)}`
    ),
    // 高成本调用：Opus 的 12k 输入 + 90k 输出，明显高于其余每条。
    assistant(
      todayId,
      todayCwd,
      todayAt(0.66),
      "最贵的一次推演。",
      ROUND_FF_OPUS,
      usage(12_000, 90_000, 40_000, 300_000)
    ),
    toolUse(todayId, todayCwd, todayAt(0.74), "ff-today-edit", "Edit", {
      file_path: SHARED_LINT
    }, ROUND_FF_OPUS),
    toolResult(todayId, todayCwd, todayAt(0.74) + 6_500, "ff-today-edit"),
    // 未定价模型：成本地形与名人堂都要报「未参与」。
    assistant(
      todayId,
      todayCwd,
      todayAt(0.9),
      "这一段用了未收录定价的模型。",
      ROUND_FF_UNPRICED,
      usage(5_000, 2_000, 0, 12_000)
    )
  ];
  sessions.push({ cwd: todayCwd, id: todayId, records: todayRecords });

  // ── 空心星：只有对话、没有任何 usage ─────────────────────────────────────
  const hollowId = idOf(102);
  const hollowCwd = PROJECTS[1].cwd;
  sessions.push({
    cwd: hollowCwd,
    id: hollowId,
    records: [
      user(hollowId, hollowCwd, now - 3 * ROUND_FF_HOUR, "只记个待办，没有模型消耗。"),
      user(
        hollowId,
        hollowCwd,
        now - 3 * ROUND_FF_HOUR + 30 * 60_000,
        "补充：这个会话全程只在本地记笔记。"
      )
    ]
  });

  // ── 本周（自然周，周一起）：跑道的「已用」不依赖今天是否周一 ─────────────
  const thisWeekId = idOf(103);
  const thisWeekCwd = PROJECTS[3].cwd;
  const thisWeekAt = Math.max(
    weekStart,
    Math.min(weekStart + 2 * ROUND_FF_HOUR, now - 120_000)
  );
  sessions.push({
    cwd: thisWeekCwd,
    id: thisWeekId,
    records: [
      user(thisWeekId, thisWeekCwd, thisWeekAt, "本周：先跑一遍预算跑道"),
      assistant(
        thisWeekId,
        thisWeekCwd,
        thisWeekAt + 45_000,
        "本周的第一段回答。",
        ROUND_FF_HAIKU,
        usage(3_000, 1_200, 600, 5_000)
      ),
      toolUse(thisWeekId, thisWeekCwd, thisWeekAt + 60_000, "ff-week-grep", "Grep", {
        pattern: "createBudgetRunway"
      }, ROUND_FF_HAIKU),
      toolResult(thisWeekId, thisWeekCwd, thisWeekAt + 60_000 + 3_200, "ff-week-grep")
    ]
  });

  // ── 昨天（若今天是周一，则落进上周）：让成本地形多一天形状 ──────────────
  const yesterdayId = idOf(104);
  const yesterdayCwd = PROJECTS[2].cwd;
  const yesterdayAt = now - 26 * ROUND_FF_HOUR;
  sessions.push({
    cwd: yesterdayCwd,
    id: yesterdayId,
    records: [
      user(yesterdayId, yesterdayCwd, yesterdayAt, "昨天：对一下两个模型的差异"),
      assistant(
        yesterdayId,
        yesterdayCwd,
        yesterdayAt + 4 * 60_000,
        "差异主要在输出与缓存写入。",
        ROUND_FF_SONNET,
        usage(9_000, 5_000, 3_000, 20_000)
      ),
      toolUse(yesterdayId, yesterdayCwd, yesterdayAt + 6 * 60_000, "ff-yesterday-write", "Write", {
        file_path: SHARED_CONTRIBUTING
      }, ROUND_FF_SONNET),
      toolResult(yesterdayId, yesterdayCwd, yesterdayAt + 6 * 60_000 + 12_000, "ff-yesterday-write")
    ]
  });

  const files: Record<string, string> = {};
  for (const seed of sessions) {
    files[`${HOME}/.claude/projects/${projectDir(seed.cwd)}/${seed.id}.jsonl`] = roundFFJsonl(seed);
  }

  return { files, records: sessions.flatMap((seed) => seed.records), now };
}

let roundFFCache: {
  files: Record<string, string>;
  records: RoundFFRecord[];
  now: number;
} | null = null;

function roundFFBuilt(): { files: Record<string, string>; records: RoundFFRecord[]; now: number } {
  if (roundFFCache === null) roundFFCache = buildRoundFF();
  return roundFFCache;
}

/** Round FF 全量记录（时间戳为 ISO 字符串）——e2e 用它手算期望值。 */
export function roundFFRecords(): RoundFFRecord[] {
  return roundFFBuilt().records;
}

/** 夹具构建时的基准时刻；用例不得再直接读 `Date.now()`。 */
export function roundFFNow(): number {
  return roundFFBuilt().now;
}

/**
 * Round FF 专用场景：只装本轮的 24 份会话，不叠默认八份。
 *
 * `savePath` 沿用 roundEE 的虚拟路径（本场景没有导出用例，但不留空避免
 * 共享 mock 在别的断言里拿到 undefined）。
 */
export function roundFFScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    ...defaultScenario(overrides),
    files: roundFFBuilt().files,
    savePath: "/Users/e2e/Documents/export.csv",
    ...overrides
  };
}


/* ====================================================================== *
 * Round GG 场景（第三批十功能的端到端夹具）
 *
 * 独立场景，不碰 SESSION_SEEDS：并进去会让既有 8 张列表截图基线整体漂移。
 * 形状按十功能的需要铺：
 *   - G1 工作日志：最近 3 天有会话（今天 2 段、昨天 2 段、三天前 1 段）；
 *   - G4 月报 + G8 季节条：两个项目 × 四个季度各有 usage（Q1/Q2/Q3/Q4），
 *     且 alpha 的 Q4 与 beta 的 Q1 分别是各自最重季；
 *   - G5 错误档案：同工具同首行的失败聚成 4 次（Bash exit 1）与 2 次
 *     （Read ENOENT），够档案表出两行；
 *   - G6 工具按月：读/写/命令在多个季度月里都有调用；
 *   - G7 上下文分位：窗口内 5 段会话各有 usage，样本 ≥2；
 *   - G9 相似会话：token 前两名同项目、同模型、同工具组。
 * 时间锚定 `Date.now()`（与 Round FF 同款，用例不得再直读 Date.now）。
 * ====================================================================== */
const ROUND_GG_SONNET = "claude-sonnet-4-5-20250929";
const ROUND_GG_OPUS = "claude-opus-4-1-20250805";
const ROUND_GG_HAIKU = "claude-haiku-4-5-20251001";

type RoundGGTool = { name: string; error?: string };

function roundGGJsonl(seed: RoundFFSessionSeed): string {
  const sorted = [...seed.records].sort(
    (a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp))
  );
  return sorted.map((record) => JSON.stringify(record)).join("\n") + "\n";
}

/**
 * 一段会话：user → assistant(usage) → 每件工具一对 use/result。
 * 工具结果可带失败文案；首行即错误聚类的签名。
 */
function buildRoundGG(): {
  files: Record<string, string>;
  records: RoundFFRecord[];
  now: number;
  days: number;
} {
  const now = Date.now();
  const sessions: RoundFFSessionSeed[] = [];
  let seed = 0;

  const at = (daysAgo: number, hour: number, minute: number): number => {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    day.setHours(hour, minute, 0, 0);
    return day.getTime();
  };

  /** 第 q 季中旬（本月未到就退到去年），保证四季总有数据。 */
  const quarterAt = (q: 1 | 2 | 3 | 4, hour: number): number => {
    const year = new Date(now).getFullYear();
    const month = (q - 1) * 3;
    let stamp = new Date(year, month, 15, hour, 0, 0, 0).getTime();
    if (stamp > now) stamp = new Date(year - 1, month, 15, hour, 0, 0, 0).getTime();
    return stamp;
  };

  const make = (
    kind: "user" | "assistant",
    sessionId: string,
    cwd: string,
    timestamp: number,
    message: Record<string, unknown>
  ): RoundFFRecord => {
    seed += 1;
    return {
      type: kind,
      sessionId,
      cwd,
      gitBranch: "main",
      version: "2.1.0",
      timestamp: new Date(timestamp).toISOString(),
      uuid: `roundgg-${seed}`,
      parentUuid: null,
      isSidechain: false,
      message
    };
  };

  const usage = (
    input: number,
    output: number,
    cacheCreation: number,
    cacheRead: number
  ): RoundFFUsage => ({
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead
  });

  const session = (options: {
    id: string;
    cwd: string;
    start: number;
    prompt: string;
    model: string;
    tokens: RoundFFUsage;
    tools: RoundGGTool[];
  }) => {
    const { id, cwd, start, prompt, model, tokens, tools } = options;
    const records: RoundFFRecord[] = [
      make("user", id, cwd, start, { role: "user", content: prompt }),
      make("assistant", id, cwd, start + 60_000, {
        id: `roundgg-msg-${id}`,
        role: "assistant",
        model,
        content: [{ type: "text", text: `${prompt}（回答）` }],
        usage: tokens
      })
    ];
    tools.forEach((tool, index) => {
      const toolId = `${id}-tool-${index}`;
      const useAt = start + 120_000 + index * 30_000;
      records.push(
        make("assistant", id, cwd, useAt, {
          id: `roundgg-tool-msg-${toolId}`,
          role: "assistant",
          model,
          content: [
            {
              type: "tool_use",
              id: toolId,
              name: tool.name,
              input:
                tool.name === "Bash"
                  ? { command: index % 2 === 0 ? "npm test" : "git status --short" }
                  : { file_path: `${cwd}/src/gg-${index}.ts` }
            }
          ],
          usage: usage(500, 200, 0, 1_500)
        })
      );
      records.push(
        make("user", id, cwd, useAt + 8_000, {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolId,
              content: tool.error ?? "ok",
              is_error: tool.error !== undefined
            }
          ]
        })
      );
    });
    sessions.push({ cwd, id, records });
  };

  const ALPHA = "/repo/gg-alpha";
  const BETA = "/repo/gg-beta";
  const idOf = (value: number) =>
    `99009900-0000-4000-8000-${String(value).padStart(12, "0")}`;

  // ── 四季（G4 月报 / G8 季节条）：alpha 的 Q4 最重，beta 的 Q1 最重 ──
  const quarterTokens: Array<{ q: 1 | 2 | 3 | 4; alpha: RoundFFUsage; beta: RoundFFUsage }> = [
    { q: 1, alpha: usage(80_000, 20_000, 10_000, 10_000), beta: usage(70_000, 15_000, 5_000, 0) },
    { q: 2, alpha: usage(200_000, 50_000, 30_000, 20_000), beta: usage(20_000, 5_000, 5_000, 0) },
    { q: 3, alpha: usage(120_000, 30_000, 20_000, 10_000), beta: usage(30_000, 5_000, 5_000, 0) },
    { q: 4, alpha: usage(260_000, 70_000, 40_000, 30_000), beta: usage(15_000, 5_000, 0, 0) }
  ];
  for (const cell of quarterTokens) {
    session({
      id: idOf(100 + cell.q),
      cwd: ALPHA,
      start: quarterAt(cell.q, 10),
      prompt: `Q${cell.q}：整理 alpha 的季度账`,
      model: ROUND_GG_SONNET,
      tokens: cell.alpha,
      tools: [
        { name: "Read" },
        { name: "Bash" },
        { name: "Edit" }
      ]
    });
    session({
      id: idOf(200 + cell.q),
      cwd: BETA,
      start: quarterAt(cell.q, 15),
      prompt: `Q${cell.q}：beta 的回归清单`,
      model: ROUND_GG_HAIKU,
      tokens: cell.beta,
      tools: [
        { name: "Grep" },
        { name: "Read" }
      ]
    });
  }

  // ── 最近三天（G1 日志 / G5 档案 / G7 分位 / G9 相似）──────────────────
  session({
    id: idOf(301),
    cwd: ALPHA,
    start: at(0, 9, 10),
    prompt: "今天上午：把对比视图的读数对一遍",
    model: ROUND_GG_SONNET,
    tokens: usage(120_000, 60_000, 40_000, 80_000),
    tools: [
      { name: "Read" },
      { name: "Read" },
      { name: "Edit" },
      { name: "Bash", error: "Error: exit code 1" }
    ]
  });
  session({
    id: idOf(302),
    cwd: ALPHA,
    start: at(0, 14, 30),
    prompt: "今天下午：相似会话的判据再核一次",
    model: ROUND_GG_SONNET,
    tokens: usage(110_000, 55_000, 35_000, 80_000),
    tools: [
      { name: "Read" },
      { name: "Edit" },
      { name: "Bash", error: "Error: exit code 1" }
    ]
  });
  session({
    id: idOf(303),
    cwd: ALPHA,
    start: at(1, 10, 0),
    prompt: "昨天：错误档案的聚类口径",
    model: ROUND_GG_OPUS,
    tokens: usage(50_000, 25_000, 10_000, 5_000),
    tools: [
      { name: "Bash", error: "Error: exit code 1" },
      { name: "Bash", error: "Error: exit code 1" },
      { name: "Read", error: "ENOENT: no such file or directory" }
    ]
  });
  session({
    id: idOf(304),
    cwd: BETA,
    start: at(1, 11, 20),
    prompt: "昨天：beta 的导出清单",
    model: ROUND_GG_HAIKU,
    tokens: usage(35_000, 15_000, 5_000, 5_000),
    tools: [
      { name: "Grep" },
      { name: "Read" },
      { name: "Write" }
    ]
  });
  session({
    id: idOf(305),
    cwd: BETA,
    start: at(3, 16, 0),
    prompt: "三天前：beta 的文件写入失败排查",
    model: ROUND_GG_SONNET,
    tokens: usage(25_000, 10_000, 3_000, 2_000),
    tools: [
      { name: "Bash", error: "Error: exit code 1" },
      { name: "Read", error: "ENOENT: no such file or directory" },
      { name: "Write" }
    ]
  });

  // G7 需要真实的压缩事件（分位行挂在压缩面板里，压缩 0 次时整段不渲染）。
  const compacted = sessions.find((entry) => entry.id === idOf(303));
  compacted?.records.push(
    make("assistant", idOf(303), ALPHA, at(1, 10, 6), {
      role: "assistant",
      content: [{ type: "text", text: "上下文压缩完成。" }]
    })
  );
  compacted?.records.push({
    type: "system",
    subtype: "compact_boundary",
    sessionId: idOf(303),
    cwd: ALPHA,
    gitBranch: "main",
    version: "2.1.0",
    timestamp: new Date(at(1, 10, 6) + 2_000).toISOString(),
    uuid: "roundgg-compact-1",
    parentUuid: null,
    isSidechain: false,
    compactMetadata: {
      trigger: "auto",
      preTokens: 180_000,
      postTokens: 24_000,
      cumulativeDroppedTokens: 156_000,
      durationMs: 35_000
    }
  });

  const files: Record<string, string> = {};
  for (const entry of sessions) {
    files[`${HOME}/.claude/projects/${projectDir(entry.cwd)}/${entry.id}.jsonl`] =
      roundGGJsonl(entry);
  }

  return {
    files,
    records: sessions.flatMap((entry) => entry.records),
    now,
    days: new Set(
      sessions.map((entry) => new Date(entry.records[0]?.timestamp as string).toDateString())
    ).size
  };
}

let roundGGCache: {
  files: Record<string, string>;
  records: RoundFFRecord[];
  now: number;
  days: number;
} | null = null;

function roundGGBuilt() {
  if (roundGGCache === null) roundGGCache = buildRoundGG();
  return roundGGCache;
}

/** Round GG 全量记录（时间戳为 ISO 字符串）——用例用它手算期望值。 */
export function roundGGRecords(): RoundFFRecord[] {
  return roundGGBuilt().records;
}

/** 夹具构建时的基准时刻；用例不得再直接读 `Date.now()`。 */
export function roundGGNow(): number {
  return roundGGBuilt().now;
}

/** 夹具覆盖的「有记录的自然日」数（G1 日志行数的下界）。 */
export function roundGGDays(): number {
  return roundGGBuilt().days;
}

/** Round GG 专用场景：只装本轮的 13 份会话，不叠默认八份。 */
export function roundGGScenario(overrides: Partial<MockScenario> = {}): MockScenario {
  return {
    ...defaultScenario(overrides),
    files: roundGGBuilt().files,
    savePath: "/Users/e2e/Documents/export.md",
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
