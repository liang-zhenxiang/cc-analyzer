import { describe, expect, test } from "vitest";
import { CSV_BOM, CSV_EOL, csvFileName, toCsv } from "./csvExport";

describe("toCsv", () => {
  test("表头 + 数据行，以 CRLF 分隔且末行也带换行", () => {
    expect(toCsv(["项目", "token"], [["cc-analyzer", 1234]])).toBe(
      `项目,token${CSV_EOL}cc-analyzer,1234${CSV_EOL}`
    );
  });

  test("含逗号的字段加引号", () => {
    expect(toCsv(["a"], [["x,y"]])).toBe(`a${CSV_EOL}"x,y"${CSV_EOL}`);
  });

  test('含双引号的字段加引号且内部双写', () => {
    expect(toCsv(["a"], [['他说"你好"']])).toBe(`a${CSV_EOL}"他说""你好"""${CSV_EOL}`);
  });

  test("含换行（\\n 与 \\r\\n）的字段加引号", () => {
    expect(toCsv(["a"], [["第一行\n第二行"]])).toBe(`a${CSV_EOL}"第一行\n第二行"${CSV_EOL}`);
    expect(toCsv(["a"], [["x\r\ny"]])).toBe(`a${CSV_EOL}"x\r\ny"${CSV_EOL}`);
  });

  test("数字原样输出，不补千分位、不四舍五入", () => {
    expect(toCsv(["n"], [[1234567], [0.000123], [-3.5]])).toBe(
      `n${CSV_EOL}1234567${CSV_EOL}0.000123${CSV_EOL}-3.5${CSV_EOL}`
    );
  });

  test("null → 空串（不加引号）；空串字段同样不加引号", () => {
    expect(toCsv(["a", "b"], [[null, ""]])).toBe(`a,b${CSV_EOL},${CSV_EOL}`);
  });

  test("非有限数是空串，不是 NaN 文本", () => {
    expect(toCsv(["a"], [[Number.NaN], [Number.POSITIVE_INFINITY]])).toBe(
      `a${CSV_EOL}${CSV_EOL}${CSV_EOL}`
    );
  });

  test("表头里的逗号也转义，列数不错位", () => {
    const csv = toCsv(["输入,输出", "tokens"], [[1, 2]]);
    expect(csv.split(CSV_EOL)[0]).toBe('"输入,输出",tokens');
  });

  test("只有表头时输出表头 + 换行；完全空输入输出空串", () => {
    expect(toCsv(["a", "b"], [])).toBe(`a,b${CSV_EOL}`);
    expect(toCsv([], [])).toBe("");
  });

  test("BOM 常量是 U+FEFF，拼接后位于首字节", () => {
    expect(CSV_BOM).toBe("\uFEFF");
    expect(CSV_BOM.charCodeAt(0)).toBe(0xfeff);
    expect((CSV_BOM + toCsv(["a"], [])).startsWith("\uFEFF")).toBe(true);
  });
});

describe("csvFileName", () => {
  test("cc-analyzer-<slug>-<YYYY-MM-DD>.csv，日期按本地时区补零", () => {
    expect(csvFileName("top-calls", new Date(2026, 0, 5, 9, 30).getTime())).toBe(
      "cc-analyzer-top-calls-2026-01-05.csv"
    );
  });

  test("文件名不含路径与用户名", () => {
    const name = csvFileName("models", Date.UTC(2026, 9, 27));
    expect(name).not.toContain("/");
    expect(name.startsWith("cc-analyzer-models-")).toBe(true);
  });
});
