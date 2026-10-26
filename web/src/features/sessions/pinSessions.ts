/**
 * F8 session pinning — the pure rules behind the sidebar's pinned group.
 *
 * The persisted shape is a JSON array of `SessionMeta.path` strings under
 * `PINNED_STORAGE_KEY`. Reading stays forgiving on purpose: the value outlives
 * any one build and hand-edited or corrupt entries must never break the
 * sidebar, so bad JSON, a non-array or non-string members are all dropped
 * silently. The parser is pure (takes the raw string) because the storage
 * access itself belongs to the component, next to the other list preferences.
 */

/** localStorage key holding the pinned session paths (JSON string array). */
export const PINNED_STORAGE_KEY = "cca-pinned-sessions";

/** Parses the persisted JSON array, dropping anything that is not a path. */
export function parsePinnedPaths(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
  } catch {
    return [];
  }
}

/**
 * Drops remembered paths the current scan no longer contains (deleted or
 * moved sessions). The input set is left untouched.
 */
export function prunePinnedPaths(
  pinned: ReadonlySet<string>,
  known: ReadonlySet<string>
): Set<string> {
  const next = new Set<string>();
  for (const path of pinned) {
    if (known.has(path)) next.add(path);
  }
  return next;
}

/**
 * Stable partition: pinned items first, everything else after, with each
 * side keeping its incoming order. Callers sort once for display (recency)
 * and then lift the pinned sessions to the front without shuffling the rest.
 */
export function partitionPinned<T>(items: readonly T[], isPinned: (item: T) => boolean): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (isPinned(item)) pinned.push(item);
    else rest.push(item);
  }
  return [...pinned, ...rest];
}
