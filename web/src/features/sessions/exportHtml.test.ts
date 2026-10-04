import { escapeHtml, htmlReportOf } from "./exportHtml";
import { parseJsonlText } from "./parseJsonl";
import { EXPORT_MAX_RECORDS, type ExportBase, type ExportInput } from "./exportTypes";
import type { SessionRecord } from "./types";
import basicFixture from "../../../tests/fixtures/session-basic.jsonl?raw";

const PATH = "/Users/secretuser/.claude/projects/-repo-demo/session.jsonl";
const BASE = Date.UTC(2026, 0, 2, 3, 4, 5);
const ID = "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11";

function base(overrides: Partial<ExportBase> = {}): ExportBase {
  const parsed = parseJsonlText(basicFixture, PATH);
  return {
    title: "修复导出",
    sessionId: ID,
    projectName: "demo",
    startedAt: BASE,
    endedAt: BASE + 56_000,
    records: parsed.records,
    allRecords: parsed.records,
    appVersion: "0.10.0",
    ...overrides
  };
}

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return { ...base(), format: "html", scope: "all", generatedAt: BASE + 120_000, ...overrides };
}

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function recordsFromJsonl(...lines: string[]): SessionRecord[] {
  return parseJsonlText(lines.join("\n"), PATH).records;
}

function userLine(content: string): string {
  return JSON.stringify({
    type: "user",
    sessionId: ID,
    timestamp: "2026-01-02T03:04:05.000Z",
    cwd: "/repo/demo",
    message: { role: "user", content }
  });
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

test("is a self-contained document with no script, link or image", () => {
  const html = htmlReportOf(input());
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).toContain('<meta charset="utf-8">');
  expect(html).toContain('<meta name="color-scheme" content="light dark">');
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("style-src 'unsafe-inline'");
  expect(html).not.toContain("<script");
  expect(html).not.toContain("<link");
  expect(html).not.toContain("src=");
});

test("links out exactly once, to the repository", () => {
  const html = htmlReportOf(input());
  const hrefs = html.match(/href="/g) ?? [];
  expect(hrefs).toHaveLength(1);
  expect(html).toContain('href="https://github.com/liang-zhenxiang/cc-analyzer"');
  expect(html).toContain("由 CC Analyzer 生成");
  expect(html).toContain("数据未上传");
});

test("carries the app's dark-mode and print stylesheets", () => {
  const html = htmlReportOf(input());
  expect(html).toContain("@media (prefers-color-scheme: dark)");
  expect(html).toContain("@media print");
  const fontFamily = html.match(/--font-sans:[^;]+;/)?.[0] ?? "";
  for (const key of ["system-ui", '"PingFang SC"', '"Microsoft YaHei"']) {
    expect(fontFamily).toContain(key);
  }
});

test("prints the session title once and drops the readout order nowhere", () => {
  const document = parse(htmlReportOf(input()));
  const headings = document.querySelectorAll("h1");
  expect(headings).toHaveLength(1);
  expect(headings[0].textContent).toBe("修复导出");

  const labels = Array.from(document.querySelectorAll(".readout dt")).map((node) => node.textContent);
  expect(labels).toEqual(["总耗时", "输入", "缓存读取", "输出", "记录数"]);
  expect(document.querySelectorAll(".readout")).toHaveLength(5);
});

test("summarises the session with the same six figures as the app", () => {
  const document = parse(htmlReportOf(input()));
  const facts = Array.from(document.querySelectorAll(".facts dt")).map((node) => node.textContent);
  for (const label of ["总耗时", "输入", "缓存读取", "输出", "记录数", "成本估算"]) {
    expect(facts).toContain(label);
  }
  expect(facts).toHaveLength(12);
});

test("renders one table row per record with the fixed eight columns", () => {
  const parsed = parseJsonlText(basicFixture, PATH);
  const document = parse(htmlReportOf(input({ records: parsed.records })));
  const headers = Array.from(document.querySelectorAll("thead th")).map((node) => node.textContent);
  expect(headers).toEqual(["时间", "类型", "操作 / 摘要", "提示词", "输出", "耗时", "占比", "状态"]);
  expect(document.querySelectorAll("tbody tr")).toHaveLength(parsed.records.length);
  expect(document.querySelector("tfoot")).toBeNull();
});

test("announces what the record ceiling left out", () => {
  const records = Array.from({ length: EXPORT_MAX_RECORDS + 7 }, (_, index) => fakeRecord(index));
  const document = parse(htmlReportOf(input({ records, allRecords: records })));
  expect(document.querySelectorAll("tbody tr")).toHaveLength(EXPORT_MAX_RECORDS);
  const foot = document.querySelector("tfoot tr")?.textContent ?? "";
  expect(foot).toMatch(/另有 7 条记录未列出/);
}, 30_000);

test("says a cost is unknown instead of pricing it at zero", () => {
  const records = recordsFromJsonl(
    JSON.stringify({
      type: "assistant",
      sessionId: ID,
      timestamp: "2026-01-02T03:04:05.000Z",
      message: {
        id: "m1",
        model: "gpt-5",
        content: [{ type: "text", text: "hi" }],
        usage: { input_tokens: 10, output_tokens: 5 }
      }
    })
  );
  const html = htmlReportOf(input({ records, allRecords: records }));
  const document = parse(html);
  const unknown = Array.from(document.querySelectorAll(".facts dd.unknown")).map(
    (node) => node.textContent
  );
  expect(unknown).toContain("未知");
  expect(html).not.toContain("$0.0000");
  expect(document.querySelector(".estimate-note")?.textContent).toMatch(/未收录定价/);
});

test("reports no token record rather than a zero cost", () => {
  const records = recordsFromJsonl(userLine("只是文字"));
  const document = parse(htmlReportOf(input({ records, allRecords: records })));
  expect(document.querySelector(".estimate-note")?.textContent).toContain("没有 token 记录");
});

test("escapes session text instead of trusting it", () => {
  const hostile = userLine('<img src=x onerror=alert(1)> 注入');
  const records = recordsFromJsonl(hostile);
  const html = htmlReportOf(
    input({ records, allRecords: records, title: '<script>alert(1)</script>' })
  );
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script");
  expect(html).toContain("&lt;img");
  expect(html).toContain("&lt;script&gt;");
  expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
});

test("keeps the session path, the user name and raw payloads out of the report", () => {
  const html = htmlReportOf(input());
  expect(html).not.toContain(PATH);
  expect(html).not.toContain("secretuser");
  // The raw transcript object is never printed, and the project shows up as a
  // directory name rather than a path.
  expect(html).not.toContain("parentUuid");
  expect(html).not.toContain("toolUseResult");
  expect(html).toContain("项目 <code>demo</code>");
});

test("labels the scope it exported", () => {
  const filtered = parse(
    htmlReportOf(input({ scope: "filtered", records: [fakeRecord(1)], allRecords: Array.from({ length: 9 }, (_, i) => fakeRecord(i)) }))
  );
  expect(filtered.querySelector(".facts")?.textContent).toContain("共 9 条中的 1 条");

  const all = parse(htmlReportOf(input({ scope: "all", records: [fakeRecord(1)], allRecords: Array.from({ length: 9 }, (_, i) => fakeRecord(i)) })));
  expect(all.querySelector(".facts")?.textContent).toContain("全部记录（9 条）");
});

test("prints no NaN when a duration is missing", () => {
  const records = [{ ...fakeRecord(1), durationMs: Number.NaN }];
  const html = htmlReportOf(input({ records, allRecords: records }));
  expect(html).not.toContain("NaN");
  expect(parse(html).querySelector("tbody tr")?.textContent).toContain("0ms");
});
