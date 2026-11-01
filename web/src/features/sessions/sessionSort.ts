/**
 * 会话排序（H3）：SessionList / useSessions 的排序单一来源。
 *
 * 口径与为什么：
 * - 纯函数，不碰 IO——`getValue` 由调用方注入（tokens/messages/tools 从
 *   SessionFacts 取，durationMs 从 meta 取，errors 从 facts 取），排序本身
 *   只认「给得出数字」这一件事，数据从哪来不关它的事；
 * - 一律降序：recent（mtimeMs）与数值列共享同一个方向，用户在表头切换
 *   排序键时不会遇到「有的列升有的列降」的错乱；
 * - `getValue` 返回 null 的条目排最后：数据不完整就不是「0 个 token」，
 *   猜 0 会把它顶到降序列首（最显眼的位置），排在末尾是诚实的选择；
 * - 并列稳定：同值条目保持传入时的相对顺序（Array.prototype.sort 在
 *   V8 里本就稳定，但 ES 规范到 ES2019 才保证——显式带 index 兜底，
 *   把「稳定」写进实现而不是寄希望于引擎）；
 * - 不修改入参数组（`slice()` 复制后排），调用方持有的原序不受影响。
 */

/** 排序键：与表头列一一对应（recent = 修改时间）。 */
export type SessionSortKey =
  | "recent"
  | "tokens"
  | "durationMs"
  | "messages"
  | "tools"
  | "errors";

/**
 * 按 key 降序排序会话。`getValue` 返回 null（数据不完整）的条目整体排
 * 最后；并列保持原相对顺序。空数组 → 空数组。
 */
export function sortSessions<T extends { mtimeMs: number }>(
  sessions: readonly T[],
  key: SessionSortKey,
  getValue: (s: T, key: SessionSortKey) => number | null
): T[] {
  return sessions
    .slice()
    .map((session, index) => ({ session, index }))
    .sort((a, b) => {
      const va = getValue(a.session, key);
      const vb = getValue(b.session, key);
      // null（数据不完整）排最后，null 之间保持原序——不完整的条目之间
      // 没有可比性，乱序反而掩盖「哪些行缺数据」。
      if (va === null && vb === null) return a.index - b.index;
      if (va === null) return 1;
      if (vb === null) return -1;
      // 数值降序；并列用 index 兜底（稳定）。
      if (vb !== va) return vb - va;
      return a.index - b.index;
    })
    .map((entry) => entry.session);
}
