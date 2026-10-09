import type { CompactionAnchor } from "./contextSeries";
import type { CompactEvent, ContextSample, SessionRecord } from "./types";

export type DroppedBucket = {
  eventId: string;
  /** Messages that left the context at this boundary, chronological. */
  records: SessionRecord[];
  /**
   * Messages in the context right before the boundary — the denominator of
   * the 「幸存 N / M 条」 figure.
   */
  contextCount: number;
  /** Survivor records resolvable in this session, chronological. */
  survivors: SessionRecord[];
};

/**
 * 口径（design §2.4，写在这里防止实现走样）：每个压缩边界下「被丢出上下文的
 * 内容」= **该边界之前出现过的全部消息 − `preservedMessages.uuids`**；
 * 跨多次压缩时同一条消息只在**首次**被丢的边界下列出。
 *
 * 「边界之前」按对话顺序，不按边界时间戳：真实日志里压缩后的首批消息时间戳
 * 可能早于边界的写盘时刻（boundary 先写盘、后续消息带更早的时间戳，共享夹具
 * 里就有这样的行），拿边界时间戳当切割线会把压缩后的消息算进「被丢出」。
 * 切割线因此取锚点消息——断崖 pre 侧末点（`logicalParentUuid` 命中的样本）
 * 的时间戳；锚点缺失时回落到边界时间戳。
 *
 * 实现为一次线性扫描：维护「当前还在上下文里」的消息集合，边界到达前把
 * 时间戳 ≤ 切割线的消息全部纳入（主链与侧链都算——侧链消息同样离开上下文，
 * design §2.4），集合减去幸存清单即该边界丢出的内容；然后把集合收缩为
 * 幸存者，进入下一段。首次丢弃的去重由此自然成立：上一段丢掉的消息不在
 * 下一段的集合里。
 *
 * `isCompactSummary` 摘要消息不参与：它是模型的重写工件（由边界记录带着），
 * 不是用户发言，更不该以「用户」徽标出现在清单里（数据约束 #3）。
 */
export function droppedByEvent(
  records: readonly SessionRecord[],
  sidechain: readonly SessionRecord[],
  events: readonly CompactEvent[],
  samples: readonly ContextSample[],
  anchors: readonly CompactionAnchor[]
): Map<string, DroppedBucket> {
  // Both inputs are already chronological from the parser; merge them by
  // timestamp so a sidechain message interleaves correctly.
  const pool = [...records, ...sidechain]
    .filter((record) => record.compactSummary !== true)
    .sort((a, b) => a.timestamp - b.timestamp);

  const anchorByEvent = new Map(anchors.map((anchor) => [anchor.eventId, anchor]));
  const buckets = new Map<string, DroppedBucket>();
  let context = new Map<string, SessionRecord>();
  let cursor = 0;
  for (const event of events) {
    const anchor = anchorByEvent.get(event.id);
    const cut = anchor && anchor.beforeIndex >= 0 ? samples[anchor.beforeIndex].timestamp : event.timestamp;
    while (cursor < pool.length && pool[cursor].timestamp <= cut) {
      context.set(pool[cursor].fullId, pool[cursor]);
      cursor += 1;
    }
    const survived = new Set(event.survivedUuids);
    const survivors: SessionRecord[] = [];
    const dropped: SessionRecord[] = [];
    for (const record of context.values()) {
      if (survived.has(record.fullId)) survivors.push(record);
      else dropped.push(record);
    }
    buckets.set(event.id, {
      eventId: event.id,
      records: dropped,
      contextCount: context.size,
      survivors
    });
    const next = new Map<string, SessionRecord>();
    for (const record of survivors) next.set(record.fullId, record);
    context = next;
  }
  return buckets;
}
