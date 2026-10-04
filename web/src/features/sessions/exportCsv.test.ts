import { parseJsonlText } from "./parseJsonl";
import { recordSummary } from "./recordSummary";
import { CSV_BOM, CSV_COLUMNS, CSV_NEWLINE, csvEscape, csvOf, isoWithOffset } from "./exportCsv";
import { EXPORT_MAX_RECORDS, type ExportBase, type ExportInput } from "./exportTypes";
import type { SessionRecord } from "./types";
import basicFixture from "../../../tests/fixtures/session-basic.jsonl?raw";
import tokenFixture from "../../../tests/fixtures/session-token-usage.jsonl?raw";

const PATH = "/Users/secretuser/.claude/projects/-repo-demo/session.jsonl";
const BASE = Date.UTC(2026, 0, 2, 3, 4, 5);

function base(overrides: Partial<ExportBase> = {}): ExportBase {
  const parsed = parseJsonlText(basicFixture, PATH);
  return {
    title: "导出夹具",
    sessionId: "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11",
    projectName: "demo",
    startedAt: BASE,
    endedAt: BASE + 60_000,
    records: parsed.records,
    allRecords: parsed.records,
    appVersion: "0.10.0",
    ...overrides
  };
}

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return { ...base(), format: "csv", scope: "filtered", generatedAt: BASE + 120_000, ...overrides };
}

/** A minimal RFC 4180 reader — the only way to prove the escaping round-trips. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function fakeRecord(index: number): SessionRecord {
  return {
    id: `r${index}`,
    fullId: `r${index}`,
    kind: "tool",
    timestamp: BASE + index,
    durationMs: 1,
    text: `记录 ${index}`,
    isError: false,
    raw: {}
  };
}

test("writes a UTF-8 BOM before a header that itself carries none", () => {
  const csv = csvOf(input());
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  expect(csv.charCodeAt(0)).toBe(0xfeff);

  const header = csv.slice(CSV_BOM.length).split(CSV_NEWLINE)[0];
  expect(header).toBe(CSV_COLUMNS.join(","));
  expect(header.charCodeAt(0)).not.toBe(0xfeff);
  expect(header).toBe(
    "record_id,timestamp,timestamp_ms,kind,tool,model,duration_ms,is_error,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,summary"
  );
});

test("uses CRLF everywhere and ends with exactly one terminator", () => {
  const csv = csvOf(input());
  expect(csv).not.toMatch(/[^\r]\n/);
  expect(csv.endsWith(`${CSV_NEWLINE}`)).toBe(true);
  expect(csv.endsWith(`${CSV_NEWLINE}${CSV_NEWLINE}`)).toBe(false);
});

test("writes one line per record plus the header", () => {
  const parsed = parseJsonlText(tokenFixture, PATH);
  const csv = csvOf(input({ records: parsed.records }));
  const rows = parseCsv(csv.slice(CSV_BOM.length));
  expect(rows).toHaveLength(parsed.records.length + 1);
  expect(rows[0]).toEqual([...CSV_COLUMNS]);
});

test("raises the row count past the ceiling only up to the ceiling", () => {
  const records = Array.from({ length: EXPORT_MAX_RECORDS + 3 }, (_, index) => fakeRecord(index));
  const csv = csvOf(input({ scope: "all", records, allRecords: records }));
  const rows = parseCsv(csv.slice(CSV_BOM.length));
  expect(rows).toHaveLength(EXPORT_MAX_RECORDS + 1);
});

test("round-trips a summary holding commas, quotes and newlines", () => {
  const hostile = JSON.stringify({
    type: "user",
    sessionId: "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11",
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/repo/demo",
    message: { role: "user", content: '含逗号, 和"引号" 与换行\n第二行' }
  });
  const parsed = parseJsonlText(hostile, PATH);
  const original = recordSummary(parsed.records[0]);
  expect(original).toContain("\n");

  const rows = parseCsv(csvOf(input({ records: parsed.records })).slice(CSV_BOM.length));
  expect(rows).toHaveLength(2);
  // 字段内的换行统一成 CRLF（见 csvEscape）：文件里不该出现裸 \n。
  expect(rows[1][12]).toBe(original.replace(/\r\n|\r|\n/g, CSV_NEWLINE));
});

test("keeps numbers unquoted and parses as numbers", () => {
  const parsed = parseJsonlText(tokenFixture, PATH);
  const rows = parseCsv(csvOf(input({ records: parsed.records })).slice(CSV_BOM.length));
  for (const row of rows.slice(1)) {
    expect(String(Number(row[6]))).toBe(row[6]);
    for (const index of [8, 9, 10, 11]) {
      if (row[index] === "") continue;
      expect(row[index]).toMatch(/^\d+$/);
    }
    expect(["true", "false"]).toContain(row[7]);
  }
});

test("leaves missing counters empty rather than writing a placeholder", () => {
  const rows = parseCsv(csvOf(input({ records: [fakeRecord(1)] })).slice(CSV_BOM.length));
  const row = rows[1];
  expect(row[4]).toBe("");
  expect(row[5]).toBe("");
  expect([null, "", "null", "N/A", "-"]).toContain(row[8]);
  expect(row[8]).toBe("");
});

test("never writes NaN into a numeric column", () => {
  const broken = { ...fakeRecord(1), durationMs: Number.NaN };
  const rows = parseCsv(csvOf(input({ records: [broken] })).slice(CSV_BOM.length));
  expect(rows[1][6]).toBe("");
  expect(csvOf(input({ records: [broken] }))).not.toContain("NaN");
});

test("never leaks the session path or the user name", () => {
  const csv = csvOf(input());
  expect(csv).not.toContain(PATH);
  expect(csv).not.toContain("secretuser");
});

test("is deterministic for one input", () => {
  expect(csvOf(input())).toBe(csvOf(input()));
});

test("quotes only when the field needs it", () => {
  expect(csvEscape("plain")).toBe("plain");
  expect(csvEscape("a,b")).toBe('"a,b"');
  expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  // 字段内的换行统一成 CRLF——文件里不该混着两种行尾。
  expect(csvEscape("line\nbreak")).toBe('"line\r\nbreak"');
  expect(csvEscape("line\rbreak")).toBe('"line\r\nbreak"');
  expect(csvEscape(" padded ")).toBe('" padded "');
});

test("defuses spreadsheet formulas before they reach a shared sheet", () => {
  // CWE-1236：摘要来自会话任意文本，而这份 CSV 就是发给别人用 Excel 打开的。
  expect(csvEscape("=1+1")).toBe("'=1+1");
  expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)");
  expect(csvEscape("+1")).toBe("'+1");
  expect(csvEscape("-2+3")).toBe("'-2+3");
  // 不加引号规则之外的字段原样保留（前导空格另有引号规则）。
  expect(csvEscape("正常文本")).toBe("正常文本");
  expect(csvEscape("2+3")).toBe("2+3");
});

test("never prefixes a numeric column with the formula guard", () => {
  const rows = parseCsv(csvOf(input({ records: [fakeRecord(1)] })).slice(CSV_BOM.length));
  expect(rows[1][6]).toMatch(/^\d+$/);
  expect(rows[1][7]).toMatch(/^(true|false)$/);
});

test("treats a negative token counter as unknown, like the report does", () => {
  const corrupt: SessionRecord = {
    ...fakeRecord(1),
    usage: { inputTokens: 5, outputTokens: -3, cacheReadTokens: -100 }
  };
  const rows = parseCsv(csvOf(input({ records: [corrupt] })).slice(CSV_BOM.length));
  expect(rows[1][9]).toBe("");
  expect(rows[1][10]).toBe("");
});

test("exports the readable text of terminal output, not its escape codes", () => {
  const ESC = "\u001b";
  const record = {
    ...fakeRecord(1),
    text: `${ESC}[1;31m✗ build failed${ESC}[0m\n${ESC}[32m✓ 12 passed${ESC}[0m`
  };
  const csv = csvOf(input({ records: [record] }));
  expect(csv).not.toContain(ESC);
  const rows = parseCsv(csv.slice(CSV_BOM.length));
  // 字段内的换行按 RFC 4180 统一成 CRLF（见 csvEscape）。
  expect(rows[1][12]).toBe("✗ build failed\r\n✓ 12 passed");
});

test("keeps both lines of a CRLF-terminated tool result", () => {
  // 回归：CRLF 被当成「回到行首重写」时，这类输出会被整段清空。
  const record = {
    ...fakeRecord(1),
    text: "",
    toolResult: "first line\r\nsecond line\r\n"
  };
  const rows = parseCsv(csvOf(input({ records: [record] })).slice(CSV_BOM.length));
  // 摘要原样保留工具的尾换行（只是把行尾统一成 CRLF），不额外改写内容。
  expect(rows[1][12]).toBe("first line\r\nsecond line\r\n");
});

test("stamps local ISO offsets that parse back to the same instant", () => {
  const iso = isoWithOffset(BASE);
  expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  expect(Date.parse(iso)).toBe(BASE);
});
