import type { SessionMeta } from "../sessions/metadataCache";
import { sessionTitle } from "../sessions/metadataCache";
import type { SessionRecord } from "../sessions/types";
import { tokenTotalsOf } from "../sessions/tokenTotals";
import type { BillingBlock } from "./billingWindow";
import { totalsSum, type UsageSessionInput } from "./usageAggregations";

/**
 * 5 小时窗口的会话归因（Issue #151）：「这个窗口是谁在烧额度」。
 *
 * 窗口对象由调用方从 `clusterBillingBlocks` 拿到、原样传进来——本模块不重算
 * 边界、不引入第二套窗口数学，`windowTokens` 就是 `totalsSum(block.totals)`
 * 那个表盘数。记录按自己的时间戳归窗，窗口是**半开区间** `[start, end)`：
 * 同一个会话跨窗口会被切开，各窗口只拿落在自己区间里的那些记录。
 *
 * 行只描述「窗口内消耗」这一件事，不读磁盘、不联网、不做进程级推断。
 */

export type QuotaAttributionRow = {
  /**
   * `SessionMeta.path`——点行打开会话用的键。输入没有元数据时是空串：
   * 消耗照算，但这种行不可跳转（手写夹具、扫描中途的输入）。
   */
  path: string;
  /** 会话标题（`sessionTitle` 的口径）；无元数据时退回项目标签。 */
  title: string;
  projectLabel: string;
  projectPath?: string;
  /** 窗口内该会话的 token 数（四类计数器之和，即 `totalsSum`）。 */
  tokens: number;
  /** 窗口内该会话的记录条数，与 `clusterBillingBlocks` 的 messages 同口径。 */
  messages: number;
  /** `tokens / windowTokens`（0..1）；窗口总量为 0 时是 0，不是 NaN。 */
  share: number;
};

export type QuotaAttribution = {
  /** `totalsSum(block.totals)`：与窗口表盘同一个数。 */
  windowTokens: number;
  windowStart: number;
  windowEnd: number;
  /** Top N，按 tokens 降序；并列时按标题、再按路径稳定排序。 */
  rows: QuotaAttributionRow[];
  /**
   * 被截断掉的那些会话的合并值；会话数不超过 Top N 时是 `null`——
   * 不造一个「其余 0 个会话」的空行。
   */
  remainder: { sessions: number; tokens: number; messages: number; share: number } | null;
  /** 窗口内有记录的会话数（含被截断的），不等于传入的输入条数。 */
  sessionsInWindow: number;
};

export const DEFAULT_QUOTA_ATTRIBUTION_TOP = 5;

type SessionTally = {
  path: string;
  title: string;
  projectLabel: string;
  projectPath?: string;
  tokens: number;
  messages: number;
};

/**
 * 窗口内记录的 token 合计。走 `tokenTotalsOf`（TokenPanel 那一套求和）
 * 再折进 `totalsSum`，全程只有一套口径；缺失的计数器是 0，不是未知。
 */
function tokensInWindow(records: readonly SessionRecord[]): number {
  const totals = tokenTotalsOf(records);
  return totalsSum({
    input: totals.input,
    output: totals.output,
    cacheCreation: totals.cacheCreation,
    cacheRead: totals.cacheRead
  });
}

/** 占比分母唯一：表盘数。没有分母就没有比率，也不拿行合计凑一个。 */
function shareOf(tokens: number, windowTokens: number): number {
  return windowTokens > 0 ? tokens / windowTokens : 0;
}

function normalizeTop(top: number | undefined): number {
  if (top === undefined || !Number.isFinite(top)) return DEFAULT_QUOTA_ATTRIBUTION_TOP;
  return Math.max(0, Math.floor(top));
}

/**
 * 把一个计费窗口的消耗摊到会话上。
 *
 * 输入顺序、每个会话记录的顺序都不影响结果——记录是按自己的时间戳筛的，
 * 不假设 `input.records` 已排序。
 *
 * 恒等式（当 `block` 与 `inputs` 出自同一批记录时必然成立，也正是 UI 的验收线）：
 * `Σ rows.tokens + remainder.tokens === windowTokens`、`Σ rows.share + remainder.share === 1`。
 */
export function attributeQuota(
  inputs: readonly UsageSessionInput[],
  block: BillingBlock,
  options?: { top?: number }
): QuotaAttribution {
  const windowTokens = totalsSum(block.totals);
  const top = normalizeTop(options?.top);

  // 同一会话只留一行：身份键用 SessionMeta.path（与「点击开会话」同一个键）。
  // 没有元数据的输入按数组位置分行——它们是彼此独立的会话，不能因为缺
  // 元数据就被合并成一行，也不能因此漏账。
  const tallies = new Map<string, SessionTally>();
  inputs.forEach((source, index) => {
    const inWindow = source.records.filter(
      (record) => record.timestamp >= block.start && record.timestamp < block.end
    );
    if (inWindow.length === 0) return;

    const session: SessionMeta | undefined = source.session;
    const path = session?.path ?? "";
    const key = session ? `path:${path}` : `anonymous:${index}`;
    const tokens = tokensInWindow(inWindow);

    const existing = tallies.get(key);
    if (existing) {
      existing.tokens += tokens;
      existing.messages += inWindow.length;
      return;
    }
    tallies.set(key, {
      path,
      title: session ? sessionTitle(session) : source.projectLabel,
      projectLabel: source.projectLabel,
      // 扫描输入带 `projectPath`；手写输入可能只给了元数据里的 cwd。
      projectPath: source.projectPath ?? session?.cwd,
      tokens,
      messages: inWindow.length
    });
  });

  const sorted = [...tallies.values()].sort(
    (a, b) => b.tokens - a.tokens || a.title.localeCompare(b.title) || a.path.localeCompare(b.path)
  );

  const rows = sorted.slice(0, top).map((tally) => ({
    path: tally.path,
    title: tally.title,
    projectLabel: tally.projectLabel,
    projectPath: tally.projectPath,
    tokens: tally.tokens,
    messages: tally.messages,
    share: shareOf(tally.tokens, windowTokens)
  }));

  const tail = sorted.slice(top);
  const tailTokens = tail.reduce((sum, tally) => sum + tally.tokens, 0);
  return {
    windowTokens,
    windowStart: block.start,
    windowEnd: block.end,
    rows,
    remainder:
      tail.length === 0
        ? null
        : {
            sessions: tail.length,
            tokens: tailTokens,
            messages: tail.reduce((sum, tally) => sum + tally.messages, 0),
            share: shareOf(tailTokens, windowTokens)
          },
    sessionsInWindow: sorted.length
  };
}
