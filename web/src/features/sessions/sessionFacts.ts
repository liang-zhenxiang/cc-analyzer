import type { SessionFacts, SessionMeta } from "./metadataCache";
import type { ParsedSession } from "./types";
import { extractErrorEvents } from "../usage/errorStats";
import { censusKeyId, extractToolCalls } from "../usage/toolCensus";

/**
 * 从一个会话的完整解析结果推出筛选事实（G2，design §2.4 方案 C）。
 *
 * 只在**建立索引**那一趟调用；口径逐条对应 `usage/sessionQuery.ts`：
 * 模型、上下文峰值、时长、错误、工具都从同一份 `ParsedSession` 算，避免
 * 「筛出来的」与「列表里看到的」对不上。
 *
 * 这里放在 sessions 层、由 `sessionRepository` 在补全元数据时调用，是因为
 * 索引是会话列表自己的事；usage 层的筛选只消费事实，不再反读日志。
 */

const UNKNOWN_MODEL_LABEL = "未知模型";

export function sessionFactsOf(parsed: ParsedSession, session: SessionMeta): SessionFacts {
  const models = new Set<string>();
  let ctxPeak = 0;
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;

  for (const record of parsed.records) {
    if (record.timestamp < first) first = record.timestamp;
    if (record.timestamp > last) last = record.timestamp;
    if (!record.usage) continue;
    models.add(record.model ?? UNKNOWN_MODEL_LABEL);
    const context =
      (record.usage.inputTokens ?? 0) +
      (record.usage.cacheCreationTokens ?? 0) +
      (record.usage.cacheReadTokens ?? 0);
    if (context > ctxPeak) ctxPeak = context;
  }

  const tools = new Set<string>();
  for (const fact of extractToolCalls(parsed)) {
    tools.add(censusKeyId(fact.key));
  }

  const errors = extractErrorEvents(parsed, session).events.length;
  const durationMs =
    parsed.records.length === 0 || !Number.isFinite(first) || !Number.isFinite(last)
      ? 0
      : Math.max(0, last - first);

  return {
    models: [...models],
    tools: [...tools],
    ctxPeak,
    errors,
    durationMs,
    messages: parsed.records.length
  };
}
