import { exportFileName, exportId, projectNameOf, EXPORT_MAX_RECORDS } from "./exportTypes";
import { buildExport } from "./exportPayload";
import { parseJsonlText } from "./parseJsonl";
import type { ExportBase, ExportInput } from "./exportTypes";
import type { SessionRecord } from "./types";
import basicFixture from "../../../tests/fixtures/session-basic.jsonl?raw";

const ID = "3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11";
const BASE = Date.UTC(2026, 0, 2, 3, 4, 5);

function parsedRecords(): SessionRecord[] {
  return parseJsonlText(basicFixture, "/tmp/session.jsonl").records;
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

function base(overrides: Partial<ExportBase> = {}): ExportBase {
  const records = parsedRecords();
  return {
    title: "标题里有 空格 / 斜杠: 冒号*问号?",
    sessionId: ID,
    projectName: "demo",
    startedAt: BASE,
    endedAt: BASE + 1000,
    records,
    allRecords: records,
    appVersion: "0.10.0-beta.2",
    ...overrides
  };
}

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return { ...base(), format: "html", scope: "filtered", generatedAt: BASE, ...overrides };
}

test("builds names that are legal on every platform", () => {
  const cases: Array<[Partial<ExportInput>, RegExp]> = [
    [{ format: "html", scope: "filtered" }, /^cc-analyzer-3d2a5442-filtered\.html$/],
    [{ format: "html", scope: "all" }, /^cc-analyzer-3d2a5442-all\.html$/],
    [{ format: "csv", scope: "filtered" }, /^3d2a5442-filtered\.csv$/],
    [{ format: "csv", scope: "all" }, /^3d2a5442-all\.csv$/]
  ];
  for (const [overrides, pattern] of cases) {
    const request = input(overrides);
    const name = exportFileName({
      sessionId: request.sessionId,
      format: request.format,
      scope: request.scope
    });
    expect(name).toMatch(pattern);
    // 会话标题常含中文、空格与 Windows 非法字符，默认名一个都不能带。
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(name).not.toMatch(/[\s/\\:*?"<>|]/);
  }
});

test("falls back when the session id is unusable", () => {
  expect(exportId("")).toBe("session");
  expect(exportId("中文-ID")).toBe("id");
  expect(exportId("ABCDEF12345")).toBe("abcdef12");
});

test("shows a project as its directory name, never as a path", () => {
  expect(projectNameOf("/Users/me/code/demo", "fallback")).toBe("demo");
  expect(projectNameOf("C:\\Users\\me\\code\\demo", "fallback")).toBe("demo");
  expect(projectNameOf("/Users/me/code/demo/", "fallback")).toBe("demo");
  expect(projectNameOf(undefined, "fallback")).toBe("fallback");
  expect(projectNameOf("/", "fallback")).toBe("fallback");
});

test("does not forward the user name when the session ran in the home directory", () => {
  // 家目录本身就是 cwd 时，最后一个路径段就是用户名——转发出去的报告不该带上它。
  expect(projectNameOf("/Users/liangzhenxiang", "repo-label")).toBe("repo-label");
  expect(projectNameOf("/home/bob", "repo-label")).toBe("repo-label");
  expect(projectNameOf("C:\\Users\\bob", "repo-label")).toBe("repo-label");
  expect(projectNameOf("/home/bob/projects/app", "repo-label")).toBe("app");
});

test("exports the whole session when the scope says all", () => {
  const filtered = [fakeRecord(1)];
  const all = Array.from({ length: 5 }, (_, index) => fakeRecord(index));
  const base = { records: filtered, allRecords: all };

  // 「全部记录」必须真的换一批记录——只改文件名与文案会导出一份自称完整的子集。
  const everyRow = buildExport(input({ ...base, format: "csv", scope: "all" }));
  expect(everyRow.recordCount).toBe(5);
  expect(everyRow.contents.trimEnd().split("\r\n")).toHaveLength(6);

  const filteredOnly = buildExport(input({ ...base, format: "csv", scope: "filtered" }));
  expect(filteredOnly.recordCount).toBe(1);
  expect(filteredOnly.fileName).toMatch(/-filtered\.csv$/);
  expect(everyRow.fileName).toMatch(/-all\.csv$/);
});

test("keeps the BOM on disk but out of the clipboard", () => {
  const payload = buildExport(input({ format: "csv" }));
  expect(payload.contents.charCodeAt(0)).toBe(0xfeff);
  expect(payload.clipboardText.charCodeAt(0)).not.toBe(0xfeff);
  expect(payload.clipboardText).toBe(payload.contents.slice(1));
  expect(payload.clipboardText.endsWith("\r\n")).toBe(true);
});

test("copies the HTML source verbatim", () => {
  const payload = buildExport(input({ format: "html" }));
  expect(payload.clipboardText).toBe(payload.contents);
  expect(payload.clipboardText.startsWith("<!doctype html>")).toBe(true);
  expect(payload.fileName).toMatch(/\.html$/);
});

test("counts the records it will actually write and flags the ceiling", () => {
  const small = buildExport(input());
  expect(small.recordCount).toBe(parsedRecords().length);
  expect(small.truncated).toBe(false);

  const many = Array.from({ length: EXPORT_MAX_RECORDS + 1 }, (_, index) => ({
    id: `r${index}`,
    fullId: `r${index}`,
    kind: "tool" as const,
    timestamp: BASE + index,
    durationMs: 1,
    text: "x",
    isError: false,
    raw: {}
  }));
  const capped = buildExport(input({ scope: "all", records: many.slice(0, 2), allRecords: many }));
  expect(capped.recordCount).toBe(EXPORT_MAX_RECORDS);
  expect(capped.truncated).toBe(true);
});
