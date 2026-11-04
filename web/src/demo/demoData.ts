/**
 * 演示模式的示例会话数据。
 *
 * 为什么是程序化生成而不是打包一份 JSONL 夹具：
 * - 生产包不能 import `web/tests/`，否则测试夹具会被打进用户下载的安装包；
 * - 演示要「看起来像最近发生的事」，写死的日期过几天就会变成一段陈年数据，
 *   第一眼就露馅。这里把时间锚在**当天本地零点**上，日期随运行日滚动。
 *
 * 数据必须**可复现**：同一本地日内多次调用 `demoFiles()` 得到逐字相同的文本，
 * 否则内存文件系统的 mtime/size 会漂，元数据缓存永远命中不了；跨日重新生成
 * 是有意的——第二天打开演示，趋势图应该往前滚一格。
 */
import { joinPath } from "../lib/path";

/** 演示模式伪造的 HOME。绝不能用真实 homeDir，否则演示会读到用户的会话。 */
export const DEMO_HOME = "/demo-home";

/** 两个项目目录名沿用 Claude Code 的编码规则（路径里的 `/` 换成 `-`）。 */
const ALPHA_LABEL = "-demo-alpha";
const ALPHA_CWD = "/Users/demo/work/orbit-dashboard";
const BETA_LABEL = "-demo-beta";
const BETA_CWD = "/Users/demo/work/papertrail-api";

const APP_VERSION = "2.1.0";
const MODEL_SONNET = "claude-sonnet-4-5";
const MODEL_OPUS = "claude-opus-4-1";
const MODEL_HAIKU = "claude-haiku-4-5";

type JsonLine = Record<string, unknown>;

type SessionContext = {
  sessionId: string;
  cwd: string;
  gitBranch: string;
};

/**
 * 本地时间锚点。**按日期分量**回退天数，而不是减 86_400_000 毫秒——夏令时
 * 切换那两天减毫秒会落到前一天的 23:00 或后一天的 01:00，演示数据的时间窗口
 * 就会跟着错位。
 */
function localIso(daysAgo: number, hour: number, minute: number, second = 0): string {
  const now = new Date();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysAgo,
    hour,
    minute,
    second,
    0
  ).toISOString();
}

/**
 * 今天的会话必须落在最近 5 小时内：脉搏档（`RECENT_ACTIVITY_WINDOW_MS`）只展示
 * 这段时间内有活动的会话，把「今天」写死在早上 9 点，下午打开演示只会看到
 * 一个空空的监控页。这里以「现在」为锚往前推，但**夹在今天本地零点之后**，
 * 避免凌晨运行时整段数据落到昨天、把三日趋势变成两日。
 */
function todayAgoMinutes(minutes: number): string {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const at = Math.max(dayStart + 60_000, now.getTime() - minutes * 60_000);
  return new Date(at).toISOString();
}

/** 同一段会话内的相对时刻：整段不超过几分钟，锚点只取一次，读起来才连贯。 */
function secondsAfter(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}

type UsageLine = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number };
};

function usage(
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number
): UsageLine {
  const fiveMinute = Math.round(cacheCreation * 0.6);
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
    // 给出 5m/1h 拆分：TokenPanel 的 TTL 分档在没有拆分时会退回估算，
    // 演示里让「有拆分」的那条路径也能被看到。
    cache_creation: {
      ephemeral_5m_input_tokens: fiveMinute,
      ephemeral_1h_input_tokens: cacheCreation - fiveMinute
    }
  };
}

function baseLine(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  parentUuid: string | null,
  type: string,
  extra: JsonLine,
  sidechain = false
): JsonLine {
  return {
    type,
    sessionId: ctx.sessionId,
    cwd: ctx.cwd,
    gitBranch: ctx.gitBranch,
    version: APP_VERSION,
    timestamp: ts,
    uuid,
    parentUuid,
    isSidechain: sidechain,
    ...extra
  };
}

function userPrompt(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  parentUuid: string | null,
  text: string
): JsonLine {
  return baseLine(ctx, ts, uuid, parentUuid, "user", {
    message: { role: "user", content: text }
  });
}

function assistantText(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  parentUuid: string | null,
  text: string,
  tokens: UsageLine,
  model = MODEL_SONNET,
  sidechain = false
): JsonLine {
  return baseLine(
    ctx,
    ts,
    uuid,
    parentUuid,
    "assistant",
    {
      message: {
        id: `msg-${uuid}`,
        role: "assistant",
        model,
        content: [{ type: "text", text }],
        usage: tokens,
        stop_reason: "end_turn"
      }
    },
    sidechain
  );
}

function assistantTool(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  parentUuid: string | null,
  toolName: string,
  toolInput: Record<string, unknown>,
  tokens: UsageLine,
  model = MODEL_SONNET,
  sidechain = false
): JsonLine {
  return baseLine(
    ctx,
    ts,
    uuid,
    parentUuid,
    "assistant",
    {
      message: {
        id: `msg-${uuid}`,
        role: "assistant",
        model,
        content: [{ type: "tool_use", id: `${uuid}-tool`, name: toolName, input: toolInput }],
        usage: tokens,
        stop_reason: "tool_use"
      }
    },
    sidechain
  );
}

function toolResult(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  parentUuid: string,
  toolUseUuid: string,
  content: string,
  options: { isError?: boolean; toolUseResult?: Record<string, unknown>; sidechain?: boolean } = {}
): JsonLine {
  return baseLine(
    ctx,
    ts,
    uuid,
    parentUuid,
    "user",
    {
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: `${toolUseUuid}-tool`,
            content,
            ...(options.isError ? { is_error: true } : {})
          }
        ]
      },
      ...(options.toolUseResult ? { toolUseResult: options.toolUseResult } : {})
    },
    options.sidechain === true
  );
}

/** API 错误在日志里是一条 `<synthetic>` 的 assistant 行；错误分析单独认它。 */
function apiError(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  parentUuid: string,
  status: number,
  text: string
): JsonLine {
  return baseLine(ctx, ts, uuid, parentUuid, "assistant", {
    isApiErrorMessage: true,
    apiErrorStatus: status,
    error: "server_error",
    message: {
      id: `msg-${uuid}`,
      role: "assistant",
      model: "<synthetic>",
      content: [{ type: "text", text }]
    }
  });
}

function compactBoundary(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  logicalParentUuid: string,
  metadata: { trigger: string; preTokens: number; postTokens: number; durationMs: number }
): JsonLine {
  return baseLine(ctx, ts, uuid, null, "system", {
    subtype: "compact_boundary",
    content: "Conversation compacted",
    level: "info",
    logicalParentUuid,
    compactMetadata: {
      trigger: metadata.trigger,
      preTokens: metadata.preTokens,
      postTokens: metadata.postTokens,
      cumulativeDroppedTokens: metadata.preTokens - metadata.postTokens,
      durationMs: metadata.durationMs
    }
  });
}

function compactSummary(
  ctx: SessionContext,
  ts: string,
  uuid: string,
  boundaryUuid: string
): JsonLine {
  return baseLine(ctx, ts, uuid, boundaryUuid, "user", {
    isCompactSummary: true,
    isVisibleInTranscriptOnly: true,
    message: {
      role: "user",
      content:
        "This session is being continued from a previous conversation that ran out of context. " +
        "The conversation is summarized below:\nSummary:\n" +
        "把用量聚合的日界线从 UTC 改成用户本地日，并补上夏令时切换的两条边界用例。"
    }
  });
}

type GeneratedSession = {
  projectLabel: string;
  cwd: string;
  gitBranch: string;
  sessionId: string;
  lines: JsonLine[];
  /** 会话最后一条记录的时刻：既做文件 mtime，也让列表按「最近活动」排序。 */
  lastTimestamp: string;
  subagentFiles?: Array<{ name: string; lines: JsonLine[]; lastTimestamp: string }>;
};

/** 第 0 天：仪表盘缓存命中率（工具调用 + 一次失败的测试）。 */
function alphaTodaySession(): GeneratedSession {
  const sessionId = "b6f0c1a2-8d4e-4c3b-9a70-1f2e3d4c5a01";
  const ctx: SessionContext = { sessionId, cwd: ALPHA_CWD, gitBranch: "main" };
  const lines: JsonLine[] = [];
  const push = (line: JsonLine) => lines.push(line);
  // 锚在「一个多小时前」而不是固定钟点：脉搏档只认最近 5 小时的活动。
  const start = todayAgoMinutes(75);
  const at = (seconds: number) => secondsAfter(start, seconds);

  push(
    userPrompt(
      ctx,
      at(0),
      "a1-u1",
      null,
      "帮我看看仪表盘的缓存命中率为什么这两天在掉，顺便把趋势图画出来。"
    )
  );
  push(
    assistantText(
      ctx,
      at(18),
      "a1-a1",
      "a1-u1",
      "我先看用量聚合和缓存健康这两块。",
      usage(1200, 180, 6800, 42000)
    )
  );
  push(
    assistantTool(
      ctx,
      at(26),
      "a1-a2",
      "a1-a1",
      "Read",
      { file_path: `${ALPHA_CWD}/src/usage/cacheHealth.ts` },
      usage(240, 96, 1800, 48300)
    )
  );
  push(
    toolResult(
      ctx,
      at(27),
      "a1-r2",
      "a1-a2",
      "a1-a2",
      "export function cacheHealthOf(totals: UsageTotals) {\n  // cacheRead ÷ (input + cacheCreation + cacheRead)\n}"
    )
  );
  push(
    assistantTool(
      ctx,
      at(62),
      "a1-a3",
      "a1-r2",
      "Grep",
      { pattern: "cache_read_input_tokens", path: "src" },
      usage(320, 88, 2100, 50200)
    )
  );
  push(
    toolResult(
      ctx,
      at(64),
      "a1-r3",
      "a1-a3",
      "a1-a3",
      "src/usage/usageAggregations.ts:64\nsrc/usage/cacheHealth.ts:18"
    )
  );
  push(
    assistantTool(
      ctx,
      at(190),
      "a1-a4",
      "a1-r3",
      "Edit",
      {
        file_path: `${ALPHA_CWD}/src/usage/cacheHealth.ts`,
        old_string: "return { ratio, note: \"\" };",
        new_string: "return { ratio, note: shortSessionNote(totals) };"
      },
      usage(410, 240, 2600, 52600)
    )
  );
  push(
    toolResult(ctx, at(191), "a1-r4", "a1-a4", "a1-a4", "Applied 1 edit")
  );
  push(
    assistantText(
      ctx,
      at(210),
      "a1-a5",
      "a1-r4",
      "命中率掉的不是缓存本身：这两天的短会话变多了，分母涨得比分子快。我把这个口径写进了趋势图的脚注。",
      usage(520, 320, 3000, 54800)
    )
  );
  push(userPrompt(ctx, at(300), "a1-u2", "a1-a5", "跑一下相关测试。"));
  push(
    assistantTool(
      ctx,
      at(305),
      "a1-a6",
      "a1-u2",
      "Bash",
      { command: "npm --prefix web test -- cacheHealth", description: "跑缓存健康单测" },
      usage(380, 74, 2200, 56100)
    )
  );
  push(
    toolResult(
      ctx,
      at(335),
      "a1-r6",
      "a1-a6",
      "a1-a6",
      "Exit code 1\n\n ✗ cacheHealth > treats missing readings as zero\n   AssertionError: expected 0 to be 1\n",
      { isError: true }
    )
  );
  push(
    assistantText(
      ctx,
      at(370),
      "a1-a7",
      "a1-r6",
      "是夹具里少了一个 cache_read 字段，补上再跑。",
      usage(610, 260, 3400, 58400)
    )
  );
  push(userPrompt(ctx, at(420), "a1-u3", "a1-a7", "好，修完继续。"));
  push(
    assistantText(
      ctx,
      at(438),
      "a1-a8",
      "a1-u3",
      "补好了，三条用例全绿。今天这块可以收尾。",
      usage(430, 210, 2800, 60100)
    )
  );

  return {
    projectLabel: ALPHA_LABEL,
    cwd: ALPHA_CWD,
    gitBranch: "main",
    sessionId,
    lines,
    lastTimestamp: at(438)
  };
}

/** 第 0 天：支付回调重试（子 agent + sidechain 记录）。 */
function betaTodaySession(): GeneratedSession {
  const sessionId = "c7e1d2b3-9a5f-4d4c-8b60-2a3f4e5d6b02";
  const ctx: SessionContext = { sessionId, cwd: BETA_CWD, gitBranch: "feat/retry" };
  const lines: JsonLine[] = [];
  const push = (line: JsonLine) => lines.push(line);
  const start = todayAgoMinutes(45);
  const at = (seconds: number) => secondsAfter(start, seconds);

  push(
    userPrompt(
      ctx,
      at(0),
      "b1-u1",
      null,
      "梳理支付回调的重试逻辑，把边界条件列出来。"
    )
  );
  push(
    assistantText(
      ctx,
      at(15),
      "b1-a1",
      "b1-u1",
      "我让子 agent 先扫一遍回调入口，再自己核对退避参数。",
      usage(980, 190, 5400, 38000),
      MODEL_OPUS
    )
  );
  push(
    assistantTool(
      ctx,
      at(24),
      "b1-a2",
      "b1-a1",
      "Agent",
      {
        description: "扫描回调重试路径",
        prompt: "列出 src/payments 下所有重试入口、退避参数和上限。"
      },
      usage(260, 110, 1600, 41200),
      MODEL_OPUS
    )
  );
  // sidechain：真实日志会把子 agent 的消息写进同一文件，主链视图不展示它们，
  // 但错误分母与工具普查会读——演示要能看见这条旁路确实被接入。
  push(
    assistantTool(
      ctx,
      at(32),
      "b1-s1",
      "b1-a2",
      "Read",
      { file_path: `${BETA_CWD}/src/payments/retry.ts` },
      usage(180, 64, 1200, 43800),
      MODEL_HAIKU,
      true
    )
  );
  push(
    toolResult(
      ctx,
      at(33),
      "b1-sr1",
      "b1-s1",
      "b1-s1",
      "export const RETRY_DELAYS = [1000, 2000, 4000, 8000];",
      { sidechain: true }
    )
  );
  push(
    assistantText(
      ctx,
      at(44),
      "b1-s2",
      "b1-sr1",
      "找到三个入口：webhook、refund-sync、ledger-push。",
      usage(230, 88, 1400, 45200),
      MODEL_HAIKU,
      true
    )
  );
  push(
    toolResult(
      ctx,
      at(90),
      "b1-r2",
      "b1-a2",
      "b1-a2",
      "子 agent 完成：webhook 用固定退避，refund-sync / ledger-push 用线性退避。",
      {
        toolUseResult: {
          type: "tool_use_result",
          agentId: "demo01",
          agentFilePath: joinPath(
            DEMO_HOME,
            ".claude",
            "projects",
            BETA_LABEL,
            sessionId,
            "subagents",
            "agent-demo01.jsonl"
          )
        }
      }
    )
  );
  push(
    assistantText(
      ctx,
      at(120),
      "b1-a3",
      "b1-r2",
      "核对完了：只有 webhook 的退避是常量，另外两个是线性增长。常量退避在两次超时后会压到同一秒。",
      usage(760, 340, 4200, 47600),
      MODEL_OPUS
    )
  );
  push(userPrompt(ctx, at(240), "b1-u2", "b1-a3", "把 webhook 改成指数退避。"));
  push(
    assistantTool(
      ctx,
      at(252),
      "b1-a4",
      "b1-u2",
      "Edit",
      {
        file_path: `${BETA_CWD}/src/payments/retry.ts`,
        old_string: "RETRY_DELAYS",
        new_string: "exponentialDelays"
      },
      usage(540, 210, 3600, 49800),
      MODEL_OPUS
    )
  );
  push(
    toolResult(ctx, at(253), "b1-r4", "b1-a4", "b1-a4", "Applied 2 edits")
  );
  push(
    assistantTool(
      ctx,
      at(302),
      "b1-a5",
      "b1-r4",
      "Bash",
      { command: "npm --prefix web test -- payments", description: "跑支付重试单测" },
      usage(470, 130, 2900, 51200),
      MODEL_OPUS
    )
  );
  push(
    toolResult(
      ctx,
      at(340),
      "b1-r5",
      "b1-a5",
      "b1-a5",
      "Test Files  1 passed (1)\nTests  12 passed (12)"
    )
  );
  push(
    assistantText(
      ctx,
      at(360),
      "b1-a6",
      "b1-r5",
      "改完并验证：最大重试 4 次，退避 1s → 2s → 4s → 8s，测试全绿。",
      usage(680, 300, 3800, 53600),
      MODEL_OPUS
    )
  );

  return {
    projectLabel: BETA_LABEL,
    cwd: BETA_CWD,
    gitBranch: "feat/retry",
    sessionId,
    lines,
    lastTimestamp: at(360),
    subagentFiles: [
      {
        name: "agent-demo01.jsonl",
        lastTimestamp: at(58),
        lines: [
          userPrompt(ctx, at(35), "sa-u1", null, "列出回调相关的重试入口与参数。"),
          assistantTool(
            ctx,
            at(38),
            "sa-a1",
            "sa-u1",
            "Grep",
            { pattern: "retry|backoff", path: "src/payments" },
            usage(160, 44, 900, 9000),
            MODEL_HAIKU
          ),
          toolResult(
            ctx,
            at(39),
            "sa-r1",
            "sa-a1",
            "sa-a1",
            "src/payments/webhook.ts:41\nsrc/payments/refund.ts:18\nsrc/payments/ledger.ts:27"
          ),
          assistantText(
            ctx,
            at(58),
            "sa-a2",
            "sa-r1",
            "三个入口已列出：webhook 固定退避，refund / ledger 线性退避。",
            usage(220, 96, 1100, 11200),
            MODEL_HAIKU
          )
        ]
      }
    ]
  };
}

/** 第 1 天：用量聚合日界线重构（含一次自动压缩）。 */
function alphaYesterdaySession(): GeneratedSession {
  const sessionId = "d8f2e3c4-0b6a-4e5d-9c71-3b4a5f6e7c03";
  const ctx: SessionContext = { sessionId, cwd: ALPHA_CWD, gitBranch: "main" };
  const lines: JsonLine[] = [];
  const push = (line: JsonLine) => lines.push(line);

  push(
    userPrompt(
      ctx,
      localIso(1, 14, 5),
      "a2-u1",
      null,
      "重构用量聚合的日界线，改成按本地日算，UTC 会把凌晨的会话算到前一天。"
    )
  );
  push(
    assistantText(
      ctx,
      localIso(1, 14, 5, 20),
      "a2-a1",
      "a2-u1",
      "先确认现在按哪条时间线分组，再动聚合函数。",
      usage(1100, 220, 7200, 46000)
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(1, 14, 6),
      "a2-a2",
      "a2-a1",
      "Read",
      { file_path: `${ALPHA_CWD}/src/usage/usageAggregations.ts` },
      usage(300, 110, 2000, 48800)
    )
  );
  push(
    toolResult(
      ctx,
      localIso(1, 14, 6, 2),
      "a2-r2",
      "a2-a2",
      "a2-a2",
      "export function dayStartOf(ts: number): number {\n  const date = new Date(ts);\n  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();\n}"
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(1, 14, 20),
      "a2-a3",
      "a2-r2",
      "Edit",
      {
        file_path: `${ALPHA_CWD}/src/usage/usageAggregations.ts`,
        old_string: "const dayKey = Math.floor(ts / 86_400_000);",
        new_string: "const dayKey = dayStartOf(ts);"
      },
      usage(620, 360, 3800, 124000)
    )
  );
  push(
    toolResult(ctx, localIso(1, 14, 20, 2), "a2-r3", "a2-a3", "a2-a3", "Applied 3 edits")
  );
  push(
    assistantText(
      ctx,
      localIso(1, 14, 30),
      "a2-a4",
      "a2-r3",
      "聚合改成按本地日了，但连续 30 天跨两次夏令时，热力图的空格要单独验证。",
      usage(480, 250, 3100, 151000)
    )
  );
  // 自动压缩：上下文逼近上限时由客户端写入的 boundary 行。
  push(compactBoundary(ctx, localIso(1, 14, 40), "a2-boundary", "a2-a4", {
    trigger: "auto",
    preTokens: 168400,
    postTokens: 11800,
    durationMs: 38200
  }));
  push(compactSummary(ctx, localIso(1, 14, 40, 1), "a2-summary", "a2-boundary"));
  push(
    userPrompt(
      ctx,
      localIso(1, 14, 42),
      "a2-u2",
      "a2-summary",
      "继续，把夏令时那组用例补上。"
    )
  );
  push(
    assistantText(
      ctx,
      localIso(1, 14, 45),
      "a2-a5",
      "a2-u2",
      "补了两条：春令时 3 月第二个周日、冬令时 11 月第一个周日，各断言日期边界。",
      usage(340, 210, 1500, 9200)
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(1, 14, 52),
      "a2-a6",
      "a2-a5",
      "Bash",
      { command: "npm --prefix web test -- usageAggregations", description: "跑聚合单测" },
      usage(420, 96, 2400, 11800)
    )
  );
  push(
    toolResult(
      ctx,
      localIso(1, 14, 53, 10),
      "a2-r6",
      "a2-a6",
      "a2-a6",
      "Test Files  1 passed (1)\nTests  27 passed (27)"
    )
  );
  push(
    assistantText(
      ctx,
      localIso(1, 14, 54),
      "a2-a7",
      "a2-r6",
      "日界线这条改完了，窗口裁剪与工作日志现在共用同一个本地日口径。",
      usage(560, 280, 2900, 13600)
    )
  );

  return {
    projectLabel: ALPHA_LABEL,
    cwd: ALPHA_CWD,
    gitBranch: "main",
    sessionId,
    lines,
    lastTimestamp: localIso(1, 14, 54)
  };
}

/** 第 1 天：错误用例（工具错误 + API 错误两条通道）。 */
function betaYesterdaySession(): GeneratedSession {
  const sessionId = "e9a3f4d5-1c7b-4f6e-8d82-4c5b6a7f8d04";
  const ctx: SessionContext = { sessionId, cwd: BETA_CWD, gitBranch: "fix/errors" };
  const lines: JsonLine[] = [];
  const push = (line: JsonLine) => lines.push(line);

  push(
    userPrompt(
      ctx,
      localIso(1, 16, 30),
      "b2-u1",
      null,
      "补一组错误用例，工具失败和 API 超时都要覆盖。"
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(1, 16, 31),
      "b2-a1",
      "b2-u1",
      "Read",
      { file_path: `${BETA_CWD}/src/payments/__tests__/retry.test.ts` },
      usage(900, 84, 5200, 33000),
      MODEL_OPUS
    )
  );
  push(
    toolResult(
      ctx,
      localIso(1, 16, 31, 2),
      "b2-r1",
      "b2-a1",
      "b2-a1",
      "describe(\"retry\", () => {\n  // 现有用例只覆盖成功路径\n});"
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(1, 16, 33),
      "b2-a2",
      "b2-r1",
      "Edit",
      {
        file_path: `${BETA_CWD}/src/payments/__tests__/retry.test.ts`,
        old_string: "  // 现有用例只覆盖成功路径",
        new_string: "  // 工具失败与 API 超时各一条"
      },
      usage(480, 300, 3000, 35600),
      MODEL_OPUS
    )
  );
  push(
    toolResult(
      ctx,
      localIso(1, 16, 33, 2),
      "b2-r2",
      "b2-a2",
      "b2-a2",
      "<tool_use_error>String to replace not found in file. String: \"  // 现有用例只覆盖成功路径\"</tool_use_error>",
      { isError: true }
    )
  );
  push(
    assistantText(
      ctx,
      localIso(1, 16, 34),
      "b2-a3",
      "b2-r2",
      "锚点被上一条用例改过了，我改成按函数名定位。",
      usage(520, 240, 3200, 37200),
      MODEL_OPUS
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(1, 16, 36),
      "b2-a4",
      "b2-a3",
      "Edit",
      {
        file_path: `${BETA_CWD}/src/payments/__tests__/retry.test.ts`,
        old_string: "describe(\"retry\", () => {",
        new_string: "describe(\"retry\", () => {\n  // 工具失败与 API 超时各一条"
      },
      usage(560, 280, 3400, 39800),
      MODEL_OPUS
    )
  );
  push(toolResult(ctx, localIso(1, 16, 36, 2), "b2-r4", "b2-a4", "b2-a4", "Applied 1 edit"));
  // API 错误通道：与工具错误分开统计，演示里两类都能在「错误」档看到。
  push(
    apiError(
      ctx,
      localIso(1, 16, 40),
      "b2-api-error",
      "b2-r4",
      500,
      "API Error: Internal server error"
    )
  );
  push(userPrompt(ctx, localIso(1, 16, 41), "b2-u2", "b2-api-error", "重试一下。"));
  push(
    assistantText(
      ctx,
      localIso(1, 16, 43),
      "b2-a5",
      "b2-u2",
      "重试通过。错误档现在能同时看到一条工具错误和一次 500，趋势分母也按天对上了。",
      usage(640, 320, 3900, 42600),
      MODEL_OPUS
    )
  );

  return {
    projectLabel: BETA_LABEL,
    cwd: BETA_CWD,
    gitBranch: "fix/errors",
    sessionId,
    lines,
    lastTimestamp: localIso(1, 16, 43)
  };
}

/** 第 2 天：CSV 字段顺序（一次完整的小修）。 */
function alphaTwoDaysAgoSession(): GeneratedSession {
  const sessionId = "f0b4a5e6-2d8c-4a7f-9e93-5d6c7b8a9e05";
  const ctx: SessionContext = { sessionId, cwd: ALPHA_CWD, gitBranch: "main" };
  const lines: JsonLine[] = [];
  const push = (line: JsonLine) => lines.push(line);

  push(
    userPrompt(
      ctx,
      localIso(2, 11, 0),
      "a3-u1",
      null,
      "导出 CSV 的字段顺序和表头对不上，帮我对齐一下。"
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(2, 11, 1),
      "a3-a1",
      "a3-u1",
      "Read",
      { file_path: `${ALPHA_CWD}/src/usage/csvExport.ts` },
      usage(820, 92, 4600, 29000)
    )
  );
  push(
    toolResult(
      ctx,
      localIso(2, 11, 1, 2),
      "a3-r1",
      "a3-a1",
      "a3-a1",
      "const HEADER = [\"date\", \"tokens\", \"cost\"];\nconst row = (d: DayBucket) => [d.date, d.tokens, d.cost];"
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(2, 11, 6),
      "a3-a2",
      "a3-r1",
      "Edit",
      {
        file_path: `${ALPHA_CWD}/src/usage/csvExport.ts`,
        old_string: "const HEADER = [\"date\", \"tokens\", \"cost\"];",
        new_string: "const HEADER = [\"date\", \"input\", \"output\", \"cache_creation\", \"cache_read\", \"cost\"];"
      },
      usage(540, 280, 3100, 31800)
    )
  );
  push(toolResult(ctx, localIso(2, 11, 6, 2), "a3-r2", "a3-a2", "a3-a2", "Applied 1 edit"));
  push(
    assistantTool(
      ctx,
      localIso(2, 11, 10),
      "a3-a3",
      "a3-r2",
      "Bash",
      { command: "npm --prefix web test -- csvExport", description: "跑 CSV 导出单测" },
      usage(430, 80, 2500, 34200)
    )
  );
  push(
    toolResult(
      ctx,
      localIso(2, 11, 10, 30),
      "a3-r3",
      "a3-a3",
      "a3-a3",
      "Test Files  1 passed (1)\nTests  9 passed (9)"
    )
  );
  push(
    assistantText(
      ctx,
      localIso(2, 11, 11),
      "a3-a4",
      "a3-r3",
      "表头与行生成现在共用同一个字段表，以后加列不会再出现两处漂移。",
      usage(410, 190, 2400, 36600)
    )
  );

  return {
    projectLabel: ALPHA_LABEL,
    cwd: ALPHA_CWD,
    gitBranch: "main",
    sessionId,
    lines,
    lastTimestamp: localIso(2, 11, 11)
  };
}

/** 第 2 天：发布说明（写文件类工具）。 */
function betaTwoDaysAgoSession(): GeneratedSession {
  const sessionId = "a1c5b6f7-3e9d-4b8a-8f04-6e7d8c9b0f06";
  const ctx: SessionContext = { sessionId, cwd: BETA_CWD, gitBranch: "docs/release" };
  const lines: JsonLine[] = [];
  const push = (line: JsonLine) => lines.push(line);

  push(
    userPrompt(
      ctx,
      localIso(2, 17, 10),
      "b3-u1",
      null,
      "写一段 v0.38 的发布说明，重点讲监控台账。"
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(2, 17, 11),
      "b3-a1",
      "b3-u1",
      "Read",
      { file_path: `${BETA_CWD}/CHANGELOG.md` },
      usage(760, 70, 4100, 25000)
    )
  );
  push(
    toolResult(
      ctx,
      localIso(2, 17, 11, 2),
      "b3-r1",
      "b3-a1",
      "b3-a1",
      "## [Unreleased]\n### Added\n- 监控台账：会话级的心跳与压缩读数"
    )
  );
  push(
    assistantTool(
      ctx,
      localIso(2, 17, 14),
      "b3-a2",
      "b3-r1",
      "Write",
      {
        file_path: `${BETA_CWD}/CHANGELOG.md`,
        content: "## [0.38.0]\n### Added\n- 监控台账：把心跳、压缩与上下文峰值放进同一张表"
      },
      usage(880, 480, 5600, 27800)
    )
  );
  push(toolResult(ctx, localIso(2, 17, 14, 2), "b3-r2", "b3-a2", "b3-a2", "Wrote 6 lines"));
  push(
    assistantText(
      ctx,
      localIso(2, 17, 15),
      "b3-a3",
      "b3-r2",
      "写好了：一段本轮主题、三条 Added、一条 Fixed，分类沿用仓库既有档位。",
      usage(560, 230, 3200, 30400)
    )
  );

  return {
    projectLabel: BETA_LABEL,
    cwd: BETA_CWD,
    gitBranch: "docs/release",
    sessionId,
    lines,
    lastTimestamp: localIso(2, 17, 15)
  };
}

/** 全部会话：两天一个项目各一段，同一天至少两段，覆盖三个本地日。 */
function sessions(): GeneratedSession[] {
  return [
    alphaTodaySession(),
    betaTodaySession(),
    alphaYesterdaySession(),
    betaYesterdaySession(),
    alphaTwoDaysAgoSession(),
    betaTwoDaysAgoSession()
  ];
}

export type DemoFileEntry = {
  path: string;
  contents: string;
  mtimeMs: number;
};

function dayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

let cache: { key: string; entries: DemoFileEntry[] } | null = null;

/**
 * 绝对路径 → 文本内容。同一天内结果稳定；换日后时间锚点整体前移。
 * mtime 取会话最后一条记录的时刻（再往后 1 秒，避免与「最后一条记录刚写下」
 * 的边界重合），既稳定又符合「文件最后被写入」的直觉。
 */
export function demoFileEntries(): DemoFileEntry[] {
  const key = dayKey();
  if (cache && cache.key === key) return cache.entries.map((entry) => ({ ...entry }));

  const projectsRoot = joinPath(DEMO_HOME, ".claude", "projects");
  const entries: DemoFileEntry[] = [];

  for (const session of sessions()) {
    const base = joinPath(projectsRoot, session.projectLabel);
    entries.push({
      path: joinPath(base, `${session.sessionId}.jsonl`),
      contents: `${session.lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
      mtimeMs: Date.parse(session.lastTimestamp) + 1000
    });

    for (const subagent of session.subagentFiles ?? []) {
      entries.push({
        path: joinPath(base, session.sessionId, "subagents", subagent.name),
        contents: `${subagent.lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
        mtimeMs: Date.parse(subagent.lastTimestamp) + 1000
      });
    }
  }

  cache = { key, entries };
  return entries.map((entry) => ({ ...entry }));
}

/** 目录树与读取 API 都基于这张表；路径一律是 POSIX 绝对路径。 */
export function demoFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of demoFileEntries()) files[entry.path] = entry.contents;
  return files;
}
