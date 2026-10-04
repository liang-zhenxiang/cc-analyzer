import { recordSummary } from "./recordSummary";
import { rowKind } from "./logRows";
import { recordsForExport, type ExportInput } from "./exportTypes";
import type { SessionRecord } from "./types";

/**
 * UTF-8 BOM, written once at the head of the file.
 *
 * Windows Excel decodes a BOM-less UTF-8 CSV with the system ANSI code page,
 * which turns every CJK summary into mojibake — the one genuinely fatal trap in
 * this format, and the BOM is a free fix for it. It never reaches the clipboard
 * (see `buildExport`): pasted text is parsed by scripts, and a leading U+FEFF
 * breaks `JSON.parse` and friends.
 */
export const CSV_BOM = "\uFEFF";

/** RFC 4180's conservative line ending — what Excel writes and expects. */
export const CSV_NEWLINE = "\r\n";

/**
 * The column list, fixed and authoritative: scripts index by position, so the
 * order is part of the contract, not a formatting detail. `summary` sits last
 * because it is the column most likely to need quoting; keeping it at the end
 * means its escaping can never shift another column's position.
 */
export const CSV_COLUMNS = [
  "record_id",
  "timestamp",
  "timestamp_ms",
  "kind",
  "tool",
  "model",
  "duration_ms",
  "is_error",
  "input_tokens",
  "output_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "summary"
] as const;

/**
 * Spreadsheet formula injection (CWE-1236): a field starting with `=`, `+`, `-`,
 * `@` or a control character is *evaluated* when the file is opened in Excel or
 * Sheets. Summaries carry session text — file contents, tool output, anything
 * the user once pasted — and the CSV is meant to be forwarded, so this is a real
 * write path into someone else's spreadsheet. The mitigation is the OWASP one:
 * a leading apostrophe, which spreadsheets read as "plain text" and hide.
 *
 * It applies only where a formula could start (never to a number column: those
 * are clamped or dropped before escaping), and it is announced to the user in
 * the dialog and in `docs/USAGE.md` rather than silently rewriting values.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Minimal quoting: a field is wrapped only when it has to be. Quoting every
 * numeric field would make Excel and scripts read numbers as text.
 *
 * Line breaks inside a field are normalised to CRLF: RFC 4180 lets a record
 * carry them, but a file that mixes bare LF with CRLF terminators trips naive
 * splitters — and the rule "every `\n` in this file belongs to a `\r\n`" is
 * only true if embedded breaks follow the same convention.
 */
export function csvEscape(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value;
  const needsQuotes = /[",\r\n]/.test(guarded) || /^\s|\s$/.test(guarded);
  if (!needsQuotes) return guarded;
  const normalised = guarded.replace(/\r\n|\r|\n/g, CSV_NEWLINE);
  return `"${normalised.replace(/"/g, '""')}"`;
}

/**
 * Local ISO 8601 with an explicit offset (`2026-01-02T11:04:08+08:00`).
 *
 * `toISOString()` would say `Z`, which is unambiguous but reads in UTC — the
 * timestamps in the report are local, and `timestamp_ms` is the column scripts
 * should actually compute with.
 */
export function isoWithOffset(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number, width = 2) => String(Math.abs(value)).padStart(width, "0");
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes < 0 ? "-" : "+";
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return (
    `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  );
}

function numeric(value: number | undefined): string {
  // A negative counter is corrupt input, not a reading: report it as unknown,
  // the same way the HTML report drops the whole token cell.
  return value === undefined || !Number.isFinite(value) || value < 0 ? "" : String(value);
}

/** Milliseconds as an integer column; a non-finite value is unknown, not `NaN`. */
function milliseconds(value: number): string {
  return Number.isFinite(value) ? String(Math.max(0, Math.round(value))) : "";
}

function rowOf(record: SessionRecord): string[] {
  return [
    record.fullId,
    isoWithOffset(record.timestamp),
    String(record.timestamp),
    rowKind(record),
    record.toolName ?? "",
    record.model ?? "",
    milliseconds(record.durationMs),
    record.isError ? "true" : "false",
    numeric(record.usage?.inputTokens),
    numeric(record.usage?.outputTokens),
    numeric(record.usage?.cacheReadTokens),
    numeric(record.usage?.cacheCreationTokens),
    recordSummary(record)
  ];
}

/**
 * The CSV file, BOM included. Rows keep the page's order — the export is a
 * snapshot of what the user was looking at, not a re-sorted view.
 */
export function csvOf(input: ExportInput): string {
  const { records } = recordsForExport(input);
  const lines = [CSV_COLUMNS.join(",")];
  for (const record of records) {
    lines.push(rowOf(record).map(csvEscape).join(","));
  }
  return `${CSV_BOM}${lines.join(CSV_NEWLINE)}${CSV_NEWLINE}`;
}
