import { describe, expect, it } from "vitest";
import { dataHealthReport } from "./dataHealth";

/** 全绿的基准输入：五项全过、score 100、grade 优。 */
const HEALTHY = {
  sessions: 3,
  totalRecords: 1000,
  unmatchedRecords: 0,
  truncatedLines: 0,
  parseWarnings: 0,
  missingUsage: 0
};

describe("dataHealth", () => {
  it("满分输入 → 五项全过、score 100、grade 优", () => {
    const report = dataHealthReport(HEALTHY);
    expect(report.checks).toHaveLength(5);
    expect(report.checks.every((check) => check.pass)).toBe(true);
    // 通过项不出 advice：没病不开药方。
    expect(report.checks.every((check) => check.advice === undefined)).toBe(true);
    expect(report.score).toBe(100);
    expect(report.grade).toBe("优");
  });

  it("截断行非零 → 单项挂 + advice 在场", () => {
    const report = dataHealthReport({ ...HEALTHY, truncatedLines: 2 });
    const check = report.checks.find((c) => c.id === "truncated-lines");
    expect(check?.pass).toBe(false);
    expect(check?.advice).toBeTruthy();
    // 4/5 过 → 80 分整十，仍是优（80 是优的下界）。
    expect(report.score).toBe(80);
    expect(report.grade).toBe("优");
  });

  it("未配对占比边界：正好 1% 判挂（≥ 阈值即挂），0.99% 过", () => {
    // 10/1000 = 1.00% → 挂。
    const atLimit = dataHealthReport({ ...HEALTHY, totalRecords: 1000, unmatchedRecords: 10 });
    expect(atLimit.checks.find((c) => c.id === "unmatched-ratio")?.pass).toBe(false);
    // 9/1000 = 0.9% → 过。
    const underLimit = dataHealthReport({ ...HEALTHY, totalRecords: 1000, unmatchedRecords: 9 });
    expect(underLimit.checks.find((c) => c.id === "unmatched-ratio")?.pass).toBe(true);
    expect(underLimit.score).toBe(100);
  });

  it("缺 usage 占比边界：正好 5% 判挂，4.9% 过", () => {
    // 50/1000 = 5% → 挂。
    const atLimit = dataHealthReport({ ...HEALTHY, totalRecords: 1000, missingUsage: 50 });
    expect(atLimit.checks.find((c) => c.id === "missing-usage")?.pass).toBe(false);
    // 49/1000 = 4.9% → 过。
    const underLimit = dataHealthReport({ ...HEALTHY, totalRecords: 1000, missingUsage: 49 });
    expect(underLimit.checks.find((c) => c.id === "missing-usage")?.pass).toBe(true);
  });

  it("解析警告非零 → 单项挂；三成通过项时 score 去尾到整十", () => {
    const report = dataHealthReport({
      ...HEALTHY,
      parseWarnings: 7,
      truncatedLines: 1,
      missingUsage: 100 // 10% ≥ 5% 挂
    });
    // 2/5 过 = 40 分。
    expect(report.score).toBe(40);
    expect(report.grade).toBe("关注");
    expect(report.checks.find((c) => c.id === "parse-warnings")?.pass).toBe(false);
  });

  it("score 去尾：99 分场景不存在，但 60/80 边界直接落档", () => {
    // 3/5 过 = 60 → 良（60 是良的下界）。
    const three = dataHealthReport({ ...HEALTHY, truncatedLines: 1, parseWarnings: 1 });
    expect(three.score).toBe(60);
    expect(three.grade).toBe("良");
  });

  it("零会话：会话数项挂、其余比率按 0 分母算不误伤", () => {
    const report = dataHealthReport({
      sessions: 0,
      totalRecords: 0,
      unmatchedRecords: 0,
      truncatedLines: 0,
      parseWarnings: 0,
      missingUsage: 0
    });
    const sessionCheck = report.checks.find((c) => c.id === "has-sessions");
    expect(sessionCheck?.pass).toBe(false);
    expect(sessionCheck?.advice).toContain("扫描");
    // 0/0 不当 1 算：比率项在空数据下全过，不给「占 NaN%」这种话。
    expect(report.checks.find((c) => c.id === "unmatched-ratio")?.pass).toBe(true);
    expect(report.score).toBe(80);
  });

  it("totalRecords 为零但会话非零：比率仍按 0 处理（没有分母就没有占比）", () => {
    const report = dataHealthReport({
      sessions: 2,
      totalRecords: 0,
      unmatchedRecords: 5,
      truncatedLines: 0,
      parseWarnings: 0,
      missingUsage: 3
    });
    // 分母护栏：5 条未配对没有总数可除，占比按 0（不挂），实际读数仍如实展示条数。
    expect(report.checks.find((c) => c.id === "unmatched-ratio")?.pass).toBe(true);
    expect(report.checks.find((c) => c.id === "missing-usage")?.pass).toBe(true);
  });

  it("actual 文案：非零计数给「条数 · 占比」，零计数给「无」", () => {
    const report = dataHealthReport({
      ...HEALTHY,
      totalRecords: 1000,
      unmatchedRecords: 25,
      missingUsage: 125
    });
    expect(report.checks.find((c) => c.id === "unmatched-ratio")?.actual).toBe("25 条 · 占 2.5%");
    expect(report.checks.find((c) => c.id === "missing-usage")?.actual).toBe("125 条 · 占 12.5%");
    expect(report.checks.find((c) => c.id === "truncated-lines")?.actual).toBe("无截断行");
  });
});
