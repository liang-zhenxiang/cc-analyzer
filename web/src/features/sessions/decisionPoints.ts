/**
 * I6 决策点回顾（Round II）：从按时间序的会话行里挑出「用户改变方向」的
 * 瞬间——重做、加码追问、隔夜换题。
 *
 * 口径（宁缺勿滥）：三条判据按序命中即归类，一条 user 行最多算一次决策。
 * 判定对象只有 user 行（kind === "user"），工具行/助手行不参与——决策
 * 是人的动作，不是系统的。纯短确认（"好的""继续"）即使偶然命中判据也
 * 一律排除：它们是节奏，不是决策。
 *
 * 输出按 timestamp 升序（输入本身按时间序，过滤后天然有序，这里不重排，
 * 保持「输入的顺序就是输出的顺序」的直白性）。首条 user 不可能是决策点
 * ——没有「上一条」做对照，escalate/redirect 都无从谈起，restart 虽然逻辑
 * 上不依赖上一条，但会话的第一句话谈不上「重做」。
 */

/** 一条 user 行的最小投影（LogRow 的字段子集，避免耦合表格层）。 */
export type DecisionRow = {
  kind: string;
  summary: string;
  timestamp: number;
};

/** 一个被认出的决策点。 */
export type DecisionPoint = {
  /** 该 user 行在输入 rows 里的下标（界面层跳转定位用）。 */
  index: number;
  timestamp: number;
  /** summary 前 60 字符（按 Unicode 码点截，emoji 不截半）+「…」。 */
  excerpt: string;
  /** 命中的判据。 */
  reason: "redirect" | "escalate" | "restart";
};

/** restart 判据：转折/重做词（① 最先判——说出口的否定最响）。 */
const RESTART_PATTERN = /不对|不是这样|改一下|换成|重新|重来|撤销|回滚|算了/;

/** redirect 判据：指令动词开头（长间隔后的新指令 ≈ 换方向）。 */
const REDIRECT_PREFIX =
  /^(帮我|请|能|可以|继续|然后|接下来|现在|再|对比|检查|实现|修复|添加|删除|重构|写|跑)/;

/** 短确认排除表：这些是节奏，不是决策——即使命中别的判据也不算。 */
const SHORT_CONFIRM_PATTERN = /^(好的?|ok|OK|嗯|继续|go|Go|👍|是的?|对)$/;

/** escalate：长追问的绝对阈值（字符数，按码点数）。 */
const ESCALATE_MIN_LENGTH = 80;

/** escalate：比上一条 user 长的相对阈值（上一条长度为基准）。 */
const ESCALATE_GROWTH_RATIO = 1.5;

/** redirect：与上一条 user 的间隔阈值（严格大于才算，10 分钟）。 */
const REDIRECT_GAP_MS = 10 * 60 * 1000;

/** excerpt 上限（码点数）。 */
const EXCERPT_LENGTH = 60;

/** 按码点数取前 n 个字符（Array.from 不把 emoji/生僻字截成半截）。 */
function takeExcerpt(text: string): string {
  const chars = Array.from(text);
  if (chars.length <= EXCERPT_LENGTH) return text;
  return `${chars.slice(0, EXCERPT_LENGTH).join("")}…`;
}

/** 按码点数长度（与 Array.from 同口径，避免 UTF-16 代理对计双）。 */
function lengthInCodePoints(text: string): number {
  return Array.from(text).length;
}

export function decisionPointsOf(rows: ReadonlyArray<DecisionRow>): DecisionPoint[] {
  const points: DecisionPoint[] = [];
  let previous: { row: DecisionRow; index: number } | null = null;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.kind !== "user") continue;

    // 短确认先排除：节奏词撞上判据（比如隔了 40 分钟的「继续」）不算决策。
    const text = row.summary;
    if (SHORT_CONFIRM_PATTERN.test(text.trim())) {
      previous = { row, index };
      continue;
    }

    let reason: DecisionPoint["reason"] | null = null;

    // 首条 user 不可能是决策点：没有「上一条」做对照（escalate/redirect
    // 无从谈起），会话的第一句话也谈不上「重做」。
    if (previous === null) {
      previous = { row, index };
      continue;
    }

    // ① restart：转折/重做词。说出口的否定最响，先判。
    if (RESTART_PATTERN.test(text)) {
      reason = "restart";
    }
    // ② escalate：长且比上一条长至少 50%（追问补充细节）。首条无基准不触发。
    else if (
      previous !== null &&
      lengthInCodePoints(text) >= ESCALATE_MIN_LENGTH &&
      lengthInCodePoints(text) >= lengthInCodePoints(previous.row.summary) * ESCALATE_GROWTH_RATIO
    ) {
      reason = "escalate";
    }
    // ③ redirect：指令动词开头 + 与上一条 user 间隔 > 10 分钟（严格大于：
    // 恰好 10 分钟是密集工作里的喘息，不判换方向）。
    else if (
      previous !== null &&
      REDIRECT_PREFIX.test(text.trim()) &&
      row.timestamp - previous.row.timestamp > REDIRECT_GAP_MS
    ) {
      reason = "redirect";
    }

    if (reason !== null) {
      points.push({ index, timestamp: row.timestamp, excerpt: takeExcerpt(text), reason });
    }

    previous = { row, index };
  }

  return points;
}
