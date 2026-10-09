import type { ParsedSession, SessionRecord } from "../sessions/types";
import type { SessionMeta } from "../sessions/metadataCache";
import { addLocalDays, dayStartOf, type UsageSessionInput } from "./usageAggregations";

/**
 * 跨会话错误聚合（N1，design.md §2.1）。两个独立通道——工具错误（tool_result
 * 的 is_error）与 API 错误（isApiErrorMessage 行）——从不合并；`--danger` 的
 * 「异常日」判定是唯一的派生结论，口径常量与界面文案同源（见 ANOMALY_*）。
 *
 * 提取（extractErrorEvents）与聚合（mergeErrorStats）分开的原因和压缩统计
 * （compactionStats）相同：提取随渐进扫描逐会话跑一次，聚合随区间控件反复跑。
 */

/** 一条错误事件——扫描期从 ParsedSession 提取，之后只与窗口聚合打交道。 */
export type ErrorEvent = {
  kind: "api" | "tool";
  timestamp: number;
  /** kind=tool 时必填（实测 tool_use_id 回溯 100% 成功）。 */
  toolName?: string;
  /** kind=api 时的 HTTP status；null = 传输层失败（无 status 行）。 */
  apiStatus?: number | null;
  /** 主链记录的 fullId；sidechain 记录为 null（下钻落到所在会话，见 §3）。 */
  recordId: string | null;
  /** 会话文件路径（下钻用）。 */
  path: string;
  projectLabel: string;
  /** ≤200 字符的脱敏预览：只取平台���定文案的首行（design §2.1）。 */
  preview: string;
};

/**
 * 一个本地日的分母事实。趋势分母（assistant 消息）、失败率分母（工具调用）、
 * 密度分母（记录数）都在提取趟按日聚合：窗口永远对齐本地日，按日裁剪就是
 * 按记录裁剪；而 sidechain 记录不在 UsageSessionInput.records 里，只能在这里
 * 数（design §2.1：分子分母必须同域）。
 */
export type ErrorDayFacts = {
  /** 该日 assistant 消息数（主链 + sidechain）——趋势分母。 */
  assistantMessages: number;
  /** 该日记录数（主链 + sidechain，全部 kind）——项目密度分母。 */
  records: number;
  /** 该日各工具调用次数（含成功、含 sidechain）——失败率分母。 */
  toolCalls: ReadonlyMap<string, number>;
};

/** 一个会话的错误提取结果：事件 + 逐日分母，`readSession` 一趟产出。 */
export type ErrorSessionFacts = {
  events: ErrorEvent[];
  days: Map<number, ErrorDayFacts>;
};

export type ErrorToolBucket = {
  toolName: string;
  errors: number;
  /** 该工具窗口内总调用次数（含成功、含 sidechain）。 */
  calls: number;
  /** errors ÷ calls。 */
  rate: number;
};

export type ErrorProjectBucket = {
  projectLabel: string;
  toolErrors: number;
  apiErrors: number;
  /** 该项目窗口内记录总数（主链 + sidechain）。 */
  records: number;
  /** (toolErrors + apiErrors) ÷ records。 */
  density: number;
};

export type ErrorDayPoint = {
  dayStart: number;
  api: number;
  tool: number;
  /** 含 sidechain 的 assistant 消息数；归一数（每千条）由视图自算（§7-4）。 */
  assistantMessages: number;
  anomalous: boolean;
};

export type ErrorStats = {
  total: { api: number; tool: number };
  /** 仅含有失败的工具，按失败次数降序（同数按名字稳定排序）。 */
  byTool: ErrorToolBucket[];
  /** 仅含有失败的项目，按密度降序。 */
  byProject: ErrorProjectBucket[];
  /** 窗口内逐日零填充；原始数，per1k 视图自算。 */
  daily: ErrorDayPoint[];
  /** 异常线阈值；窗口内非零日不足 2 天时 null（不画线，异常日恒 false）。 */
  anomalyThreshold: number | null;
  /** 窗口内全量事件，按时间倒序（下钻列表直接吃它）。 */
  events: ErrorEvent[];
  /** 窗口内工具调用总次数（含成功、含 sidechain）——空态事实行的数字来源。 */
  toolCalls: number;
};

/** 异常日口径（design.md 2026-10-10 定案）：非零日合计 per1k 中位数 × 该倍数。 */
export const ANOMALY_MULTIPLIER = 2;
/** 当日原始错误数下限：挡小样本日（40 条消息 1 个错 = 25/千条的假异常）。 */
export const ANOMALY_MIN_ERRORS = 10;
/** 判据一句话——趋势图 caption 与 KPI 说明都从这里取，不许两处手写。 */
export const ANOMALY_RULE_TEXT =
  `异常日 = 归一数超过窗口中位数 ${ANOMALY_MULTIPLIER} 倍且当日错误 ≥ ${ANOMALY_MIN_ERRORS} 条`;

/**
 * 「等用户输入」不算失败（Issue #146 口径）。排除是白名单文本规则，仅此一条：
 * AskUserQuestion 的拒绝文案是平台固定文案，可靠；其他工具的语义拒绝（若出现）
 * v1 不猜。
 */
const WAIT_TOOL_NAME = "AskUserQuestion";
const WAIT_REJECTION_TEXT = "user doesn't want to proceed";

/** preview 上限与截断规则：首行（平台固定文案）+ 200 字符封顶。 */
const PREVIEW_LIMIT = 200;

function previewOf(text: string): string {
  const firstLine = text.split("\n", 1)[0] ?? "";
  return firstLine.slice(0, PREVIEW_LIMIT);
}

function isWaitRejection(record: SessionRecord): boolean {
  return (
    record.toolName === WAIT_TOOL_NAME &&
    (record.toolResult ?? "").includes(WAIT_REJECTION_TEXT)
  );
}

function dayFactsOf(days: Map<number, ErrorDayFacts>, dayStart: number): ErrorDayFacts {
  let facts = days.get(dayStart);
  if (!facts) {
    facts = { assistantMessages: 0, records: 0, toolCalls: new Map() };
    days.set(dayStart, facts);
  }
  return facts;
}

/**
 * 从一个已解析会话提取错误事件与逐日分母（含 sidechainMessages，design §3：
 * 实测 35.4% 的工具错误在子链，只看主链会静默丢三分之一）。
 */
export function extractErrorEvents(parsed: ParsedSession, meta: SessionMeta): ErrorSessionFacts {
  const events: ErrorEvent[] = [];
  const days = new Map<number, ErrorDayFacts>();
  const path = parsed.path;
  const projectLabel = meta.projectLabel;

  const consume = (record: SessionRecord, sidechain: boolean) => {
    const facts = dayFactsOf(days, dayStartOf(record.timestamp));
    facts.records += 1;

    if (record.kind === "assistant") {
      facts.assistantMessages += 1;
      // API 错误通道：isError 在解析层就来自 isApiErrorMessage，apiError 结构
      // 只在错误行上存在——结构化字段优先，不碰文本。
      if (record.isError && record.apiError) {
        events.push({
          kind: "api",
          timestamp: record.timestamp,
          apiStatus: record.apiError.status,
          recordId: sidechain ? null : record.fullId,
          path,
          projectLabel,
          preview: previewOf(record.text)
        });
      }
      return;
    }

    if (record.kind === "tool" && record.toolName) {
      const calls = facts.toolCalls as Map<string, number>;
      calls.set(record.toolName, (calls.get(record.toolName) ?? 0) + 1);
      if (record.isError && !isWaitRejection(record)) {
        events.push({
          kind: "tool",
          timestamp: record.timestamp,
          toolName: record.toolName,
          recordId: sidechain ? null : record.fullId,
          path,
          projectLabel,
          preview: previewOf(record.toolResult ?? "")
        });
      }
    }
  };

  for (const record of parsed.records) consume(record, false);
  for (const record of parsed.sidechainMessages) consume(record, true);

  return { events, days };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 异常日判定（design.md 定案）。返回阈值与逐日 anomalous；阈值 null 时全部
 * false。per1k 无法计算（当日无模型消息）的日子不参与中位数、也恒非异常。
 */
function anomalyOf(daily: ErrorDayPoint[]): { threshold: number | null } {
  const per1kValues = daily
    .filter((point) => point.api + point.tool > 0 && point.assistantMessages > 0)
    .map((point) => ((point.api + point.tool) / point.assistantMessages) * 1000);
  if (per1kValues.length < 2) return { threshold: null };
  return { threshold: median(per1kValues) * ANOMALY_MULTIPLIER };
}

/**
 * 窗口化聚合：对全量 inputs 按区间一次跑。会话跨窗口边缘时按日裁剪分母、
 * 按时间戳裁剪事件（窗口对齐本地日，两者等价）。没有 errorExtract 的输入
 * （手造测试数据）对该聚合不可见——分母与分子必须同源。
 */
export function mergeErrorStats(
  inputs: readonly UsageSessionInput[],
  days: number,
  now: number = Date.now()
): ErrorStats {
  const windowDays = Math.max(1, Math.floor(days));
  const todayStart = dayStartOf(now);
  const startTs = addLocalDays(todayStart, -(windowDays - 1));

  const events: ErrorEvent[] = [];
  const toolCalls = new Map<string, number>();
  const projects = new Map<string, { tool: number; api: number; records: number }>();
  const dayMap = new Map<number, { api: number; tool: number; assistantMessages: number }>();

  for (const input of inputs) {
    const extract = input.errorExtract;
    if (!extract) continue;

    // 同一项目可能有多个会话：逐会话并入同一个桶（与 mergeInto 的 projects 同法）。
    const projectOf = () => {
      let bucket = projects.get(input.projectLabel);
      if (!bucket) {
        bucket = { tool: 0, api: 0, records: 0 };
        projects.set(input.projectLabel, bucket);
      }
      return bucket;
    };

    for (const [dayStart, facts] of extract.days) {
      if (dayStart < startTs) continue;
      let day = dayMap.get(dayStart);
      if (!day) {
        day = { api: 0, tool: 0, assistantMessages: 0 };
        dayMap.set(dayStart, day);
      }
      day.assistantMessages += facts.assistantMessages;
      projectOf().records += facts.records;
      for (const [toolName, calls] of facts.toolCalls) {
        toolCalls.set(toolName, (toolCalls.get(toolName) ?? 0) + calls);
      }
    }

    for (const event of extract.events) {
      if (event.timestamp < startTs) continue;
      events.push(event);
      let day = dayMap.get(dayStartOf(event.timestamp));
      if (!day) {
        day = { api: 0, tool: 0, assistantMessages: 0 };
        dayMap.set(dayStartOf(event.timestamp), day);
      }
      if (event.kind === "api") {
        day.api += 1;
        projectOf().api += 1;
      } else {
        day.tool += 1;
        projectOf().tool += 1;
      }
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);

  // 零填充逐日序列（趋势图的「0 值天画短桩」依赖它）。
  const daily: ErrorDayPoint[] = [];
  for (let dayStart = startTs; dayStart <= todayStart; dayStart = addLocalDays(dayStart, 1)) {
    const bucket = dayMap.get(dayStart);
    daily.push({
      dayStart,
      api: bucket?.api ?? 0,
      tool: bucket?.tool ?? 0,
      assistantMessages: bucket?.assistantMessages ?? 0,
      anomalous: false
    });
  }

  const { threshold } = anomalyOf(daily);
  for (const point of daily) {
    point.anomalous =
      threshold !== null &&
      point.api + point.tool >= ANOMALY_MIN_ERRORS &&
      point.assistantMessages > 0 &&
      ((point.api + point.tool) / point.assistantMessages) * 1000 > threshold;
  }

  const totalTool = events.filter((event) => event.kind === "tool").length;
  const byTool = [...toolCalls]
    .map(([toolName, calls]) => {
      const errors = events.filter(
        (event) => event.kind === "tool" && event.toolName === toolName
      ).length;
      return { toolName, errors, calls, rate: calls > 0 ? errors / calls : 0 };
    })
    .filter((bucket) => bucket.errors > 0)
    .sort((a, b) => b.errors - a.errors || a.toolName.localeCompare(b.toolName));

  const byProject = [...projects]
    .map(([projectLabel, bucket]) => ({
      projectLabel,
      toolErrors: bucket.tool,
      apiErrors: bucket.api,
      records: bucket.records,
      density: bucket.records > 0 ? (bucket.tool + bucket.api) / bucket.records : 0
    }))
    .filter((bucket) => bucket.toolErrors + bucket.apiErrors > 0)
    .sort(
      (a, b) =>
        b.density - a.density || b.toolErrors + b.apiErrors - (a.toolErrors + a.apiErrors) || a.projectLabel.localeCompare(b.projectLabel)
    );

  return {
    total: { api: events.length - totalTool, tool: totalTool },
    byTool,
    byProject,
    daily,
    anomalyThreshold: threshold,
    events,
    toolCalls: [...toolCalls.values()].reduce((sum, calls) => sum + calls, 0)
  };
}
