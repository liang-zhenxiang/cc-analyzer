/**
 * JSON.stringify that never throws.
 *
 * Transcript data is external input: a session file can carry values that
 * `JSON.stringify` refuses (bigint) or that a future field could make cyclic,
 * and a thrown error in the middle of rendering would blank the panel. Cycles
 * are reported as `[循环引用]`, bigints as `1n`, and functions as `[函数]`.
 *
 * Note: because a replacer cannot tell "already visited" from "currently open",
 * a value referenced twice is also rendered as `[循环引用]` the second time.
 */
export function safeStringify(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === "bigint") return `${item.toString()}n`;
        if (typeof item === "function") return "[函数]";
        if (typeof item === "symbol") return item.toString();
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[循环引用]";
          seen.add(item);
        }
        return item;
      },
      space
    );
    return text ?? String(value);
  } catch (cause) {
    return `（无法序列化：${cause instanceof Error ? cause.message : String(cause)}）`;
  }
}
