import { CSV_BOM, csvOf } from "./exportCsv";
import { htmlReportOf } from "./exportHtml";
import { buildSessionArchive } from "./sessionArchive";
import { exportFileName, recordsForExport, type ExportInput } from "./exportTypes";
import type { ParsedSession } from "./types";

export type ExportPayload = {
  fileName: string;
  /** File contents — carries the CSV BOM where the format needs it. */
  contents: string;
  /** Clipboard text: identical, minus the CSV BOM (a pasted U+FEFF breaks parsers). */
  clipboardText: string;
  /** Rows actually written (after the ceiling). */
  recordCount: number;
  /** Rows the chosen scope asked for, before the ceiling. */
  totalRecords: number;
  truncated: boolean;
};

/** One export request rendered once — the dialog saves and copies the same bytes. */
export function buildExport(input: ExportInput & { parsed: ParsedSession }): ExportPayload {
  const { records, truncated, total } = recordsForExport(input);
  // 档案不吃作用域：它描述「这个会话是什么」，不是「我筛出了哪几行」。
  // 因此它既不受 `EXPORT_MAX_RECORDS` 截断，也不写 truncated 那行提示。
  const contents =
    input.format === "archive"
      ? buildSessionArchive(input.parsed)
      : input.format === "csv"
        ? csvOf(input)
        : htmlReportOf(input);
  return {
    fileName: exportFileName({
      sessionId: input.sessionId,
      format: input.format,
      scope: input.scope
    }),
    contents,
    clipboardText: contents.startsWith(CSV_BOM) ? contents.slice(CSV_BOM.length) : contents,
    recordCount: input.format === "archive" ? input.allRecords.length : records.length,
    totalRecords: total,
    truncated
  };
}
