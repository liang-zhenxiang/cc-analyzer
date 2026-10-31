import {
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_REJECT,
  SNAPSHOT_SCHEMA,
  SNAPSHOT_TOO_BIG,
  SNAPSHOT_V1_METRICS,
  SNAPSHOT_VERSION,
  buildSnapshotJson,
  parseSnapshotJson,
  snapshotJsonFileName,
  snapshotJsonText,
  type SnapshotSource
} from "./usageSnapshotJson";

const BASE = Date.UTC(2026, 0, 2, 3, 4, 5);

function source(overrides: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    totals: { input: 1_200, output: 3_400, cacheCreation: 560, cacheRead: 7_800 },
    messages: 42,
    sessions: 3,
    startMs: BASE,
    endMs: BASE + 6 * 86_400_000,
    generatedAt: BASE,
    ...overrides
  };
}

test("写入的 v1 结构带 schema 与 version，且六项指标一个不少", () => {
  const snapshot = buildSnapshotJson(source());

  expect(snapshot.schema).toBe(SNAPSHOT_SCHEMA);
  expect(snapshot.schema).toBe("cca.usage.snapshot");
  expect(snapshot.version).toBe(SNAPSHOT_VERSION);
  expect(snapshot.version).toBe(1);

  // 键名与行序一致：两次导出的文件 diff 起来，行序不该是噪音。
  expect(Object.keys(snapshot.totals)).toEqual(SNAPSHOT_V1_METRICS.map((metric) => metric.key));
  expect(snapshot.totals).toEqual({
    inputTokens: 1_200,
    outputTokens: 3_400,
    cacheCreationTokens: 560,
    cacheReadTokens: 7_800,
    messages: 42,
    sessions: 3
  });
});

test("区间写成 ISO 字符串，取的是页面那份窗口本身", () => {
  const snapshot = buildSnapshotJson(source());
  expect(snapshot.range.start).toBe(new Date(BASE).toISOString());
  expect(snapshot.range.end).toBe(new Date(BASE + 6 * 86_400_000).toISOString());
});

test("估算成本不进 v1（跨快照口径对不上，宁缺毋滥）", () => {
  const text = snapshotJsonText(buildSnapshotJson(source()));
  expect(text).not.toContain("cost");
  expect(text).not.toContain("usd");
  expect(text).not.toContain("价格");
});

test("往返：写出去的文本能被自己读回来，六个数字逐位相同", () => {
  const written = buildSnapshotJson(source());
  const parsed = parseSnapshotJson(snapshotJsonText(written));

  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  // 读方返回的是 `UsageSnapshot`（schemaVersion + 数值区间），写方写的是
  // `SnapshotJson`（version + ISO 区间）——两份形状故意不同：文件里的区间是
  // 给人读的 ISO 串，内存里的区间是毫秒数。比的是数字，不是对象全等。
  expect(parsed.snapshot.totals).toEqual({ ...written.totals, estimatedCostUsd: null });
  expect(parsed.snapshot.schemaVersion).toBe(written.version);
  expect(parsed.snapshot.generatedAt).toBe(written.generatedAt);
});

test("两空格缩进 + 末尾换行：版本库里 diff 得动", () => {
  const text = snapshotJsonText(buildSnapshotJson(source()));
  expect(text).toContain('\n  "schema"');
  expect(text.endsWith("\n")).toBe(true);
});

test("拒收：没有 schema 字段", () => {
  const result = parseSnapshotJson(JSON.stringify({ version: 1, totals: {} }));
  expect(result).toEqual({ ok: false, message: SNAPSHOT_REJECT });
});

test("拒收：schema 是别的字符串（别的应用导出的快照）", () => {
  const result = parseSnapshotJson(
    JSON.stringify({ schema: "someone-else.snapshot", version: 1, totals: {} })
  );
  expect(result).toEqual({ ok: false, message: SNAPSHOT_REJECT });
});

test("拒收：schema 对但版本是 2（口径可能已经变了，不猜）", () => {
  const result = parseSnapshotJson(
    JSON.stringify({ schema: SNAPSHOT_SCHEMA, version: 2, totals: {} })
  );
  expect(result).toEqual({ ok: false, message: SNAPSHOT_REJECT });
});

test("拒收：不是合法 JSON 时把解析器的第一行原样带出来", () => {
  const result = parseSnapshotJson("{ 这不是 json");
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.message.startsWith("文件不是合法 JSON（")).toBe(true);
});

test("拒收：超过 4MB 的文件不再尝试解析", () => {
  const result = parseSnapshotJson('{"schema":"x"}', SNAPSHOT_MAX_BYTES + 1);
  expect(result).toEqual({ ok: false, message: SNAPSHOT_TOO_BIG });
});

test("字段缺失不抛异常：读成 null，由界面印「—」而不是 0", () => {
  const result = parseSnapshotJson(
    JSON.stringify({
      schema: SNAPSHOT_SCHEMA,
      version: SNAPSHOT_VERSION,
      totals: { inputTokens: 10, outputTokens: "3400" }
    })
  );
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.snapshot.totals.inputTokens).toBe(10);
  // 字符串数字视为缺失：转换会把「导出时就坏了」伪装成正常。
  expect(result.snapshot.totals.outputTokens).toBeNull();
  expect(result.snapshot.totals.messages).toBeNull();
});

test("文件名按导出当天，不带时间戳（同一天两次导出只差内容）", () => {
  expect(snapshotJsonFileName(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe(
    "cca-usage-snapshot-2026-01-02.json"
  );
});
