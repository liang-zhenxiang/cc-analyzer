import { CSV_BOM, csvOf } from "./exportCsv";
import { htmlReportOf } from "./exportHtml";
import { exportFileName, recordsForExport, type ExportInput } from "./exportTypes";

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
export function buildExport(input: ExportInput): ExportPayload {
  const { records, truncated, total } = recordsForExport(input);
  const contents = input.format === "csv" ? csvOf(input) : htmlReportOf(input);
  return {
    fileName: exportFileName({
      sessionId: input.sessionId,
      format: input.format,
      scope: input.scope
    }),
    contents,
    clipboardText: contents.startsWith(CSV_BOM) ? contents.slice(CSV_BOM.length) : contents,
    recordCount: records.length,
    totalRecords: total,
    truncated
  };
}
