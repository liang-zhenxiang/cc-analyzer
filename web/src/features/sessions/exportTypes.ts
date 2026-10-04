import type { SessionRecord } from "./types";

/**
 * One export request — everything both renderers need, with the clock injected.
 *
 * `generatedAt` is a field rather than a `Date.now()` call inside the renderer:
 * the same input must produce byte-identical output (the CSV test asserts
 * exactly that), and a hidden clock is the only thing that could break it.
 */
export type ExportFormat = "html" | "csv";
export type ExportScope = "filtered" | "all";

export type ExportInput = {
  format: ExportFormat;
  scope: ExportScope;
  title: string;
  sessionId: string;
  /** Directory name only — the full path never leaves the machine (privacy rule). */
  projectName: string;
  startedAt: number;
  endedAt: number;
  /** Records the current filter matched — the "current filter" scope. */
  records: readonly SessionRecord[];
  /**
   * Every record in the session — the "all records" scope, and the denominator
   * behind the scope line. Carried alongside `records` rather than fetched by
   * the dialog: the two scopes are two sets, and a renderer that only ever sees
   * the filtered one would silently write a filtered file under an `-all` name.
   */
  allRecords: readonly SessionRecord[];
  generatedAt: number;
  appVersion: string;
};

/**
 * Everything an export request needs except the choices the dialog owns — and
 * `generatedAt`, which the dialog stamps when it actually builds the payload
 * (a timestamp taken when the session was opened would lie about a report
 * exported an hour later).
 */
export type ExportBase = Omit<ExportInput, "format" | "scope" | "generatedAt">;

/**
 * One export is capped: a shared report has to stay openable, and a CSV has to
 * stay importable. Truncation is always announced, never silent — the same
 * rule `ReportPanel` follows when it analyses only the slowest N records.
 */
export const EXPORT_MAX_RECORDS = 2000;

/** The report's only outbound link — see `exportHtml.ts` for why it is the only one. */
export const REPO_URL = "https://github.com/liang-zhenxiang/cc-analyzer";

export function scopeLabel(scope: ExportScope): string {
  return scope === "all" ? "全部记录" : "当前筛选结果";
}

/**
 * A project is shown as its directory name, never as a path: the full path
 * carries the user name, and the report is meant to be forwarded.
 */
export function projectNameOf(cwd: string | undefined, fallback: string): string {
  if (!cwd) return fallback;
  const parts = cwd.split(/[\\/]/).filter((part) => part.length > 0);
  if (parts.length === 0) return fallback;
  const parent = parts[parts.length - 2]?.toLowerCase();
  // A session started *in* the home directory would put the user name into a
  // report meant to be forwarded, so those paths fall back to the project
  // label instead. (`/Users/me`, `/home/me`, `C:\Users\me`.)
  if (parent === "users" || parent === "home") return fallback;
  return parts[parts.length - 1];
}

export function formatLabel(format: ExportFormat): string {
  return format === "csv" ? "CSV" : "HTML 报告";
}

export function formatHint(format: ExportFormat): string {
  return format === "csv"
    ? "逐条记录，供 Excel 或脚本进一步分析。"
    : "自包含单文件，可离线打开、可直接分享。";
}

/**
 * Session titles are user text: they hold spaces, CJK, `/`, `:` and worse.
 * The default file name therefore ignores the title entirely and is built only
 * from the session id — ASCII, no separators, legal on every platform.
 */
export function exportId(sessionId: string): string {
  const cleaned = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase();
  return cleaned.length > 0 ? cleaned : "session";
}

export function exportFileName({
  sessionId,
  format,
  scope
}: {
  sessionId: string;
  format: ExportFormat;
  scope: ExportScope;
}): string {
  const id = exportId(sessionId);
  const suffix = scope === "all" ? "all" : "filtered";
  return format === "csv" ? `${id}-${suffix}.csv` : `cc-analyzer-${id}-${suffix}.html`;
}

/** The records actually written, capped at `EXPORT_MAX_RECORDS`. */
export function recordsForExport(input: ExportInput): {
  records: readonly SessionRecord[];
  truncated: boolean;
  /** Everything the chosen scope asked for, before the ceiling. */
  total: number;
} {
  const requested = input.scope === "all" ? input.allRecords : input.records;
  const truncated = requested.length > EXPORT_MAX_RECORDS;
  return {
    records: truncated ? requested.slice(0, EXPORT_MAX_RECORDS) : requested,
    truncated,
    total: requested.length
  };
}
