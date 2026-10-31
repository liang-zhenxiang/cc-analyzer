/**
 * 用量快照的 JSON 版（Round GG G10）。
 *
 * 为什么需要第三种文件：`usageSnapshot.ts` 产出的是给人看的单文件 HTML，
 * 里面没有任何机器可读结构；而「两份快照对比」要读的是数字。把数字从 HTML
 * 里再抠出来是脆的（改一次排版就断），所以另立一个**只含数字**的格式。
 *
 * ## 版本契约（Lead 已拍板）
 *
 * 顶层带 `schema` 与 `version` 两个字段，且只有**同时匹配**才被接受：
 * 不匹配时不尽力解析，直接拒收并说「不是本应用导出的快照数据」。理由——
 * 尽力的解析会把「字段名变了」伪装成「这一项是 0」，而差值表看上去依然正常。
 *
 * ## 口径（v1 定稿）
 *
 * 六个指标：token 四类（输入/输出/缓存写/缓存读）+ 消息数 + 会话数。
 * **估算成本不进 v1**：跨快照的成本口径（不同定价表、不同未定价条数）对不上，
 * 一个「$1.23 → $1.10」的差值会让人以为省了钱，其实只是两次导出的价目不同。
 *
 * 隐私：文件里没有会话 id、没有路径、没有消息文本。项目维度不进 v1。
 */

/**
 * 写入与校验共用的格式标识——**只有一处定义**：`snapshotCompare.ts` 是读方，
 * 这里只做写入与版本闸门，两个常量从那边取，避免"读的和写的不一样"。
 */
export const SNAPSHOT_SCHEMA = USAGE_SNAPSHOT_SCHEMA;
export const SNAPSHOT_VERSION = USAGE_SNAPSHOT_SCHEMA_VERSION;

import {
  USAGE_SNAPSHOT_SCHEMA,
  USAGE_SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_METRICS,
  parseUsageSnapshot,
  type UsageSnapshot
} from "./snapshotCompare";

/** 超过这个大小的 JSON 一定不是我们导出的快照（正常一份几十 KB）。 */
export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

export type SnapshotTotalsJson = {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationTokens: number | null;
  cacheReadTokens: number | null;
  messages: number | null;
  sessions: number | null;
};

export type SnapshotJson = {
  schema: string;
  version: number;
  /** 导出时刻（ms epoch）。 */
  generatedAt: number | null;
  range: { start: string; end: string };
  totals: SnapshotTotalsJson;
};

/** 页面那一份 `range` 里要拿到的数。字段名与 `UsageTotals` 对齐。 */
export type SnapshotSource = {
  totals: { input: number; output: number; cacheCreation: number; cacheRead: number };
  messages: number;
  sessions: number;
  startMs: number;
  endMs: number;
  generatedAt: number;
};

/**
 * 六个指标的行序 = 写出字段序 = 对比表行序（三次导出 diff 起来才有意义）。
 * 清单本身从读方取，这里只换一个更贴合"v1 定稿"的名字。
 */
export const SNAPSHOT_V1_METRICS = SNAPSHOT_METRICS;

/**
 * 区间用的是 `range` 自身那两天，**不是** `now - days` 重新推一遍：页面上那份
 * 窗口是渐进的（扫描未完成时是半份），重推会得到一个更漂亮但不存在的时间段。
 */
export function buildSnapshotJson(source: SnapshotSource): SnapshotJson {
  return {
    schema: SNAPSHOT_SCHEMA,
    version: SNAPSHOT_VERSION,
    generatedAt: source.generatedAt,
    range: {
      start: new Date(source.startMs).toISOString(),
      end: new Date(source.endMs).toISOString()
    },
    totals: {
      inputTokens: source.totals.input,
      outputTokens: source.totals.output,
      cacheCreationTokens: source.totals.cacheCreation,
      cacheReadTokens: source.totals.cacheRead,
      messages: source.messages,
      sessions: source.sessions
    }
  };
}

/** 两空格缩进 + 末尾换行：版本库里 diff 得动。 */
export function snapshotJsonText(snapshot: SnapshotJson): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function snapshotJsonFileName(nowMs: number): string {
  const date = new Date(nowMs);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `cca-usage-snapshot-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}.json`;
}

export type SnapshotParse =
  | { ok: true; snapshot: UsageSnapshot }
  | { ok: false; message: string };

/** 拒收时的唯一一句话——三种失败（无 schema / 错 schema / 版本不符）同一句。 */
export const SNAPSHOT_REJECT = "不是本应用导出的快照数据";
export const SNAPSHOT_TOO_BIG = "快照文件超过 4MB，可能不是快照";

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * 先认版本、再读字段。顺序不能反：先读字段的话，一个「字段名全对但版本是 2」
 * 的文件会被读成合法数据，而它的口径可能已经变了。
 */
export function parseSnapshotJson(text: string, byteSize?: number): SnapshotParse {
  if (byteSize !== undefined && byteSize > SNAPSHOT_MAX_BYTES) {
    return { ok: false, message: SNAPSHOT_TOO_BIG };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    const first = String(cause instanceof Error ? cause.message : cause).split("\n")[0];
    return { ok: false, message: `文件不是合法 JSON（${first}）` };
  }

  // 缺 schema 与「schema 是别的字符串」是同一件事：不是我们写的。
  // 版本不符也在这里拦——先认版本再读字段，否则一个字段名全对、版本是 2 的
  // 文件会被读成合法数据，而它的口径可能已经变了。
  const root = recordOf(raw);
  if (root.schema !== USAGE_SNAPSHOT_SCHEMA || root.version !== USAGE_SNAPSHOT_SCHEMA_VERSION) {
    return { ok: false, message: SNAPSHOT_REJECT };
  }

  // 过了闸门之后字段读取交给读方那份解析：缺字段读成 null，界面印「—」。
  const parsed = parseUsageSnapshot(raw);
  return parsed.ok ? { ok: true, snapshot: parsed.snapshot } : { ok: false, message: parsed.reason };
}
