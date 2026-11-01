import { useMemo } from "react";
import type { HealthInput } from "./dataHealth";
import type { ParsedSession } from "./types";
import { sharedSessionParseCache } from "./sessionParseCache";

/**
 * H9 数据体检的取数器：点开体检时**现算**，不做常驻轮询。
 *
 * 数据源是 sharedSessionParseCache——用量页扫描趟已经把每个会话解析过
 * 并留在进程级缓存里（见 sessionParseCache.ts 的注释：one parse per
 * file, however many consumers）。体检读的就是「这次会话实际读到的
 * 东西」，与用量页同一份解析结果，不产生第二次 IO 或解析。
 *
 * 缓存里没有的会话（从未打开过用量页）按「没读到」处理：不猜、不补
 * 扫——体检单宁可说「0 个会话」（模型层会给「先扫描」的建议），也不
 * 给一个基于半份证据的「优」。
 *
 * 六数字口径（与 dataHealth.ts 的 HealthInput 一一对应）：
 * - sessions：缓存里能看到的会话数；
 * - totalRecords：records 总数；
 * - unmatchedRecords：unmatchedToolUses 长度合计；
 * - truncatedLines：parseCoverage.unparsableLines 合计（读不进来的行
 *   = 文件被外接截断/写坏的部分；coverage 缺省按 0——没证据不定罪）；
 * - parseWarnings：warnings 长度合计；
 * - missingUsage：kind=assistant 且 usage===undefined 的记录数
 *   （eventsWithoutUsage 同思想：缺读数不折零，数出来示警）。
 *
 * 命名注意：本文件叫 sessionHealthCollect（「这批会话整体的健康取数」），
 * 与既有的单会话状态点模块 sessionHealth.ts（三档状态灯）是两件事。
 */

/** 从共享解析缓存现算六数字。 */
export function collectHealthInput(sessions: readonly { path: string }[]): HealthInput {
  const health: HealthInput = {
    sessions: 0,
    totalRecords: 0,
    unmatchedRecords: 0,
    truncatedLines: 0,
    parseWarnings: 0,
    missingUsage: 0
  };
  for (const session of sessions) {
    const cached = sharedSessionParseCache.get(session.path);
    const parsed: ParsedSession | undefined = cached?.session;
    if (!parsed) continue;
    health.sessions += 1;
    health.totalRecords += parsed.records.length;
    health.unmatchedRecords += parsed.unmatchedToolUses.length;
    health.truncatedLines += parsed.parseCoverage?.unparsableLines ?? 0;
    health.parseWarnings += parsed.warnings.length;
    health.missingUsage += parsed.records.filter(
      (record) => record.kind === "assistant" && record.usage === undefined
    ).length;
  }
  return health;
}

const EMPTY_INPUT: HealthInput = {
  sessions: 0,
  totalRecords: 0,
  unmatchedRecords: 0,
  truncatedLines: 0,
  parseWarnings: 0,
  missingUsage: 0
};

/** 点开体检时现算一次（open=false 时不算——关闭的浮层不该做工作）。 */
export function useCollectHealthInput(
  sessions: readonly { path: string }[],
  open: boolean
): HealthInput {
  return useMemo(
    () => (open ? collectHealthInput(sessions) : EMPTY_INPUT),
    [sessions, open]
  );
}
