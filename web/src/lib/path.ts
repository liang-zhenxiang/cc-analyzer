export function pathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") || /^[A-Za-z]:/.test(path) ? "\\" : "/";
}

export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

export function parentDirectory(path: string): string | undefined {
  const withoutTrailingSeparators = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(
    withoutTrailingSeparators.lastIndexOf("/"),
    withoutTrailingSeparators.lastIndexOf("\\")
  );
  if (separatorIndex < 0) return undefined;

  const parent = withoutTrailingSeparators.slice(0, separatorIndex);
  if (/^[A-Za-z]:$/.test(parent)) return `${parent}\\`;
  return parent || undefined;
}

export function joinPath(base: string, ...segments: string[]): string {
  const separator = pathSeparator(base);
  const baseWithoutTrailingSeparator = base.replace(/[\\/]+$/, "");
  const cleanSegments = segments
    .flatMap((segment) => segment.split(/[\\/]+/))
    .filter(Boolean);
  return [baseWithoutTrailingSeparator, ...cleanSegments].join(separator);
}

/**
 * Claude Code stores a session as `<project>/<sessionId>.jsonl` with its
 * subagents under `<project>/<sessionId>/subagents`, so the session's own
 * directory is the file path without the `.jsonl` suffix.
 */
export function sessionDirectory(path: string): string {
  return path.replace(/\.jsonl$/i, "");
}

/** Segments with `.` and `..` resolved, so scoping cannot be tricked by them. */
function resolvedSegments(path: string): string[] {
  const segments: string[] = [];
  for (const segment of pathSegments(path)) {
    if (segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments;
}

/**
 * True when `target` is `root` itself or lives below it.
 *
 * Used for paths that come from a session file (`childSessionPath`): a crafted
 * JSONL must not make the app read a file outside the session tree.
 */
export function isPathInside(target: string, root: string): boolean {
  const targetSegments = resolvedSegments(target);
  const rootSegments = resolvedSegments(root);
  if (rootSegments.length === 0 || targetSegments.length < rootSegments.length) return false;
  return rootSegments.every((segment, index) => segment === targetSegments[index]);
}

export function isPathInsideAny(target: string, roots: string[]): boolean {
  return roots.some((root) => isPathInside(target, root));
}
