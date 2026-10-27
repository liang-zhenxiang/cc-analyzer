import type { ContextSample } from "./types";

/**
 * 会话内时间旅行（E3）的纯逻辑模型：把「上下文曲线 + 事件刻度」折成一条
 * 可拖动的时间轴。视图只管手势与渲染，位置、水位、最近事件全部在这里算——
 * 同一份输入永远得到同一份答案，测试不依赖时钟。
 *
 * 口径：
 * - start/end = samples 与 events 时间戳并集的 min/max；两者都空 → 0/0。
 *   轴的范围必须盖住事件刻度：事件若落在采样区间外（如会话末尾的压缩
 *   边界事件晚于最后一次采样），拖到头也要能到达它。
 * - positionAt 严格线性映射到 [0,1]，轴外夹到端点；零跨度恒 0（除零没有
 *   语义，恒 0 让拖杆停在起点而不是 NaN 乱跳）。
 * - watermarkAt 是「当时的」水位：取 ≤ realMs 的最后一个 sample 的
 *   contextTokens，绝不前瞻——回到 t 时刻必须看到 t 时刻模型的上下文，
 *   提前看到 t+1 的水位就把「时间旅行」变成了剧透。早于首个 sample 时
 *   null（还没有任何水位可读，0 会冒充「上下文为空」）。
 * - nearestEvent 二分查找；距离并列（两事件到 realMs 等距）取更早的那个
 *   ——「接下来发生什么」比「刚才发生了什么」对拖动方向更有用，并列时
 *   时间轴的读法习惯是从早到晚。
 */

/** 刻度事件的最小形状：时间 + 标签（压缩边界、工具调用等由视图命名）。 */
export type ScrubberEvent = {
  timestamp: number;
  label: string;
};

export type ScrubberNearestEvent = {
  /** 在按时间戳升序稳定排序后的事件表里的下标（并列时保持输入顺序）。 */
  index: number;
  timestamp: number;
  label: string;
};

export type ScrubberModel = {
  start: number;
  end: number;
  /** realMs 在轴上的位置 [0,1]；零跨度恒 0。 */
  positionAt(realMs: number): number;
  /** 距 realMs 最近的事件；空表 null；距离并列取更早。 */
  nearestEvent(realMs: number): ScrubberNearestEvent | null;
  /** ≤ realMs 的最后一个 sample 的 contextTokens；早于首个 sample 时 null。 */
  watermarkAt(realMs: number): number | null;
};

/**
 * 构建时间轴模型。samples 按约定升序传入，这里仍防御性排序一份副本——
 * 二分查找的正确性依赖顺序，一次排序换掉一整类乱序输入的静默错答。
 * events 同样按时间戳稳定排序，并列时间戳保持输入顺序。
 */
export function buildScrubber(
  samples: readonly ContextSample[],
  events: readonly ScrubberEvent[]
): ScrubberModel {
  const orderedSamples = [...samples].sort((a, b) => a.timestamp - b.timestamp);
  const orderedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  let start = 0;
  let end = 0;
  if (orderedSamples.length > 0 || orderedEvents.length > 0) {
    const candidates: number[] = [];
    if (orderedSamples.length > 0) {
      candidates.push(orderedSamples[0].timestamp, orderedSamples[orderedSamples.length - 1].timestamp);
    }
    if (orderedEvents.length > 0) {
      candidates.push(orderedEvents[0].timestamp, orderedEvents[orderedEvents.length - 1].timestamp);
    }
    start = Math.min(...candidates);
    end = Math.max(...candidates);
  }

  const positionAt = (realMs: number): number => {
    if (end <= start) return 0;
    const ratio = (realMs - start) / (end - start);
    return Math.min(1, Math.max(0, ratio));
  };

  // 二分：首个 timestamp > realMs 的下标（即「≤ realMs 的段」的右边界）。
  const upperBound = (array: readonly { timestamp: number }[], realMs: number): number => {
    let low = 0;
    let high = array.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (array[mid].timestamp <= realMs) low = mid + 1;
      else high = mid;
    }
    return low;
  };

  const nearestEvent = (realMs: number): ScrubberNearestEvent | null => {
    if (orderedEvents.length === 0) return null;
    const upper = upperBound(orderedEvents, realMs);
    // 候选只剩 upper-1（≤ realMs 的最后一个）与 upper（> realMs 的第一个）。
    const before = upper > 0 ? orderedEvents[upper - 1] : null;
    const after = upper < orderedEvents.length ? orderedEvents[upper] : null;
    if (before === null) {
      const event = after!;
      return { index: upper, timestamp: event.timestamp, label: event.label };
    }
    if (after === null) {
      const event = before;
      return { index: upper - 1, timestamp: event.timestamp, label: event.label };
    }
    // 距离并列时取更早（before）：<= 让并列落左边。
    const distanceBefore = realMs - before.timestamp;
    const distanceAfter = after.timestamp - realMs;
    const pickBefore = distanceBefore <= distanceAfter;
    const index = pickBefore ? upper - 1 : upper;
    const event = pickBefore ? before : after;
    return { index, timestamp: event.timestamp, label: event.label };
  };

  const watermarkAt = (realMs: number): number | null => {
    const index = upperBound(orderedSamples, realMs) - 1;
    if (index < 0) return null;
    return orderedSamples[index].contextTokens;
  };

  return { start, end, positionAt, nearestEvent, watermarkAt };
}
