/**
 * 提问画像（I5）：用户消息文本的形状读数——长度分布、代码块比例、中文占比。
 *
 * 分工边界（§4.4）：**提取由调用方做**——message.content 里 type === "text"
 * 的 text 拼接。本模块只吃纯文本数组，做统计几何。
 *
 * 口径（每条都有「为什么」）：
 * - 长度桶边界：<50 / 50–200 / 200–500 / 500–2000 / ≥2000 字符（派工单
 *   逐字）。桶区间**左闭右开**（[50,200)、[200,500)…），<50 与 ≥2000 各自
 *   兜住两端——「边界值归哪桶」必须可复现，写死在 LENGTH_BOUNDS；
 * - `codeBlockShare` = 含 ``` 的消息数 ÷ 总消息数（null 当 0 条——比例在
 *   分母为 0 时不是 0，是「不知道」）；
 * - `cjkShare` 分母**只算汉字与字母**（\p{Script=Han} 与 A-Za-z，§2-⑥
 *   拍板）：标点、数字、空白、代码块内容都不进分母——「中文 62%」才读得懂。
 *   代码围栏（```…``` 整段）剔除后再数字符；分母 0（全标点/数字或空）→ null；
 * - `medianLength` 长度取 Array.from(text).length（码位不是 UTF-16 单元，
 *   emoji 不重复计），偶数条取中间两值均值；0 条 → null。
 * - 空数组 → 整个返回 null（「没有用户消息」由界面表达）。
 */

/** 长度桶边界（左闭右开）；id 与 label 逐字来自派工单。 */
export const LENGTH_BOUNDS: ReadonlyArray<{
  id: string;
  label: string;
  /** 桶上界（不含）；最后一个桶上界为 Infinity。 */
  max: number;
}> = [
  { id: "lt50", label: "<50", max: 50 },
  { id: "50to200", label: "50–200", max: 200 },
  { id: "200to500", label: "200–500", max: 500 },
  { id: "500to2000", label: "500–2000", max: 2000 },
  { id: "ge2000", label: "≥2000", max: Number.POSITIVE_INFINITY }
];

export type LengthBucket = { id: string; label: string; count: number };

export type PromptProfile = {
  count: number;
  lengthBuckets: LengthBucket[];
  /** 含 ``` 的消息占比；0 条 → null。 */
  codeBlockShare: number | null;
  /** CJK 汉字 ÷（汉字+字母），代码块剔除后；分母 0 → null。 */
  cjkShare: number | null;
  /** 长度中位数（码位）；0 条 → null。 */
  medianLength: number | null;
};

/** 剔除成对代码围栏（``` 开头的行到下一个 ``` 行）：语言占比不该数代码。 */
function stripCodeFences(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join("\n");
}

/** 码位长度（Array.from）：emoji 不重复计、不劈开。 */
function codePointLength(text: string): number {
  return Array.from(text).length;
}

export function promptProfileOf(
  messages: ReadonlyArray<{ text: string }>
): PromptProfile | null {
  if (messages.length === 0) return null;

  const lengths = messages.map((message) => codePointLength(message.text));
  const lengthBuckets: LengthBucket[] = LENGTH_BOUNDS.map((bound) => ({
    id: bound.id,
    label: bound.label,
    count: 0
  }));
  for (const length of lengths) {
    const index = LENGTH_BOUNDS.findIndex((bound) => length < bound.max);
    // 最后一个桶 max=Infinity 必然命中；findIndex 失败按防御写进末桶。
    lengthBuckets[index >= 0 ? index : lengthBuckets.length - 1].count += 1;
  }

  const codeBlockCount = messages.filter((message) =>
    message.text.includes("```")
  ).length;

  // cjkShare：剔除代码围栏后，数汉字与字母。
  let han = 0;
  let letters = 0;
  for (const message of messages) {
    const prose = stripCodeFences(message.text);
    for (const char of prose) {
      if (/\p{Script=Han}/u.test(char)) han += 1;
      else if (/[A-Za-z]/.test(char)) letters += 1;
    }
  }

  // 中位数：排序取中间；偶数条取中间两值均值。
  const sorted = [...lengths].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianLength =
    sorted.length % 2 === 1
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

  return {
    count: messages.length,
    lengthBuckets,
    codeBlockShare: codeBlockCount / messages.length,
    cjkShare: han + letters > 0 ? han / (han + letters) : null,
    medianLength
  };
}
