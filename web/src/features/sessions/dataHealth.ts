/**
 * 数据体检（H9，Round HH）：把「这批日志读得干不干净」折成一张体检单。
 *
 * 口径立场：本模块**只做口径与评级，不做任何扫描或解析**——五个数字
 * （会话数、记录数、未配对数、截断行、解析警告、缺 usage 记录）全部由
 * 调用方从扫描与解析层拿来。这里回答的唯一问题是：这些数字合在一起，
 * 应该给用户亮绿灯（优）、黄灯（良）还是红灯（关注）。
 *
 * 检查项（五项，各占 20 分）：
 * ① 截断行 = 0 —— 文件被外接截断（进程被杀、磁盘满）会丢尾部记录，
 *    数量非零时后面的比率都建立在残缺数据上，所以它是硬门槛。
 * ② 未配对 tool_result 占比 < 1% —— 少量未配对是正常磨损（会话续写、
 *    工具结果跨文件），占比高说明解析层漏了大块配对。
 * ③ 解析警告 = 0 —— parseJsonlText 的 warnings 数组长度（非对象事件、
 *    缺时间戳等）。警告意味着有行读不进来，属于数据缺口。
 * ④ 缺 usage 的 assistant 记录占比 < 5% —— 与 replayModel 的
 *    eventsWithoutUsage 同口径思想：没有 usage 读数的事件不折成零，
 *    而是被数出来单独示警。
 * ⑤ 会话数 > 0 —— 空数据不是「健康」，是无从谈起；体检单要明说。
 *
 * 比率裁决：题目写「占比 < 1% / < 5%」，边界值（正好 1%、正好 5%）
 * **判挂**——检查的名字是「低于阈值」，贴着上限过关等于把噪声当正常；
 * 判挂的口径与 advice 文案都按「≥ 阈值即挂」写死，测试钉同一条。
 *
 * 分母护栏：totalRecords = 0 时占比一律按 0 处理（0/0 不是 1，是「没有
 * 数据可算」），此时 ②④ 只能跟着 ⑤（会话数）一起给出结论。
 *
 * 评分与评级：score = 通过项 / 5 × 100，去尾到整十（Math.floor(x/10)*10，
 * 79 分不算 80——「差一分就优」不构成放宽的理由）；grade：≥80 优、
 * ≥60 良、否则关注。
 *
 * advice 只给未通过项，中文一句话、不带命令行——用户是 GUI 使用者，
 * 让他「去终端跑 xxx」等于没说。
 */

export type HealthInput = {
  /** 扫描到的会话数（>0 才有「体检」可言）。 */
  sessions: number;
  /** 全部会话的记录总数（比率的分母）。 */
  totalRecords: number;
  /** 未配对的 tool_result 记录数（解析层配对失败的残渣）。 */
  unmatchedRecords: number;
  /** 文件尾部截断的行数（进程被杀 / 磁盘满留下的残行）。 */
  truncatedLines: number;
  /** parseJsonlText 收集的解析警告条数。 */
  parseWarnings: number;
  /** 没有 usage 读数的 assistant 记录数（eventsWithoutUsage 同思想）。 */
  missingUsage: number;
};

export type HealthCheck = {
  /** 稳定 id，界面层用它做 key / probe，不参与文案。 */
  id: string;
  /** 检查项中文名（界面直接展示）。 */
  label: string;
  /** 是否通过。 */
  pass: boolean;
  /** 实际读数的中文一句话（如「3 条 · 占 1.2%」），通过的项也是它。 */
  actual: string;
  /** 未通过时的建议（中文一句话，不带命令行）。 */
  advice?: string;
};

export type HealthReport = {
  /** 三档评级。 */
  grade: "优" | "良" | "关注";
  /** 0–100 整十分数。 */
  score: number;
  /** 五项检查（顺序固定：截断 → 未配对 → 警告 → 缺 usage → 会话数）。 */
  checks: HealthCheck[];
};

/** 占比阈值（判挂口径：**≥ 阈值即挂**，见文件头说明）。 */
const UNMATCHED_LIMIT = 0.01;
const MISSING_USAGE_LIMIT = 0.05;

/** 占比百分数文本：一位小数去尾（1.25% 写 1.2%，0 显示 0%）。 */
function pctText(ratio: number): string {
  return `${(Math.floor(ratio * 1000) / 10).toString()}%`;
}

export function dataHealthReport(input: HealthInput): HealthReport {
  // 分母护栏：没有记录时占比按 0 算（0/0 不是 1），结论交给「会话数」项。
  const denominator = input.totalRecords > 0 ? input.totalRecords : 0;
  const unmatchedRatio = denominator > 0 ? input.unmatchedRecords / denominator : 0;
  const missingUsageRatio = denominator > 0 ? input.missingUsage / denominator : 0;

  const checks: HealthCheck[] = [
    {
      id: "truncated-lines",
      label: "无截断行",
      pass: input.truncatedLines === 0,
      actual:
        input.truncatedLines === 0
          ? "无截断行"
          : `${input.truncatedLines} 行 · 文件尾部可能缺记录`,
      advice:
        input.truncatedLines === 0
          ? undefined
          : "有会话文件在写入中途被截断，尾部记录已丢失；这类数据只能不完整地读，重要结论别只依赖这一窗。"
    },
    {
      id: "unmatched-ratio",
      label: "未配对工具结果占比低于 1%",
      pass: unmatchedRatio < UNMATCHED_LIMIT,
      actual:
        input.unmatchedRecords === 0
          ? "无未配对记录"
          : `${input.unmatchedRecords} 条 · 占 ${pctText(unmatchedRatio)}`,
      advice:
        unmatchedRatio < UNMATCHED_LIMIT
          ? undefined
          : "未配对的工具结果偏多，多发生在会话被续写或拆分成多个文件时；若数字持续增长，可检查日志目录是否漏扫了上游文件。"
    },
    {
      id: "parse-warnings",
      label: "无解析警告",
      pass: input.parseWarnings === 0,
      actual:
        input.parseWarnings === 0
          ? "无解析警告"
          : `${input.parseWarnings} 条警告`,
      advice:
        input.parseWarnings === 0
          ? undefined
          : "有日志行解析失败（非对象事件、缺时间戳等）；少量警告可忽略，大量出现说明日志格式与解析器预期不符。"
    },
    {
      id: "missing-usage",
      label: "缺 usage 的助手消息占比低于 5%",
      pass: missingUsageRatio < MISSING_USAGE_LIMIT,
      actual:
        input.missingUsage === 0
          ? "无缺 usage 记录"
          : `${input.missingUsage} 条 · 占 ${pctText(missingUsageRatio)}`,
      advice:
        missingUsageRatio < MISSING_USAGE_LIMIT
          ? undefined
          : "不少助手消息没有 token 读数（多见于旧版本日志或中转服务）；这些记录不折算成零，成本与用量图会标注「部分未知」。"
    },
    {
      id: "has-sessions",
      label: "至少有一个会话",
      pass: input.sessions > 0,
      actual: input.sessions > 0 ? `${input.sessions} 个会话` : "没有会话",
      advice:
        input.sessions > 0
          ? undefined
          : "还没有读到任何会话；先选择 Claude 的日志目录并完成一次扫描，体检单才有对象。"
    }
  ];

  const passed = checks.filter((check) => check.pass).length;
  // 去尾到整十：79 分不进位到 80——「差一分就优」不构成放宽理由。
  const score = Math.floor((passed / checks.length) * 100 / 10) * 10;
  const grade: HealthReport["grade"] = score >= 80 ? "优" : score >= 60 ? "良" : "关注";

  return { grade, score, checks };
}
