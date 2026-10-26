/**
 * Token 等价物（D10）：把一串 token 数翻译成日常量级，让人对「这个月烧了多少」
 * 有体感。它是修辞，不是计量——所以每条换算都必须带 note 说明依据，界面也不
 * 应该把它当精确数字展示。
 *
 * 数字取整到整单位（Math.floor）：0.4 杯咖啡不该被说成「1 杯」；不足一个单位
 * 的条目仍然返回（count = 0），由界面决定显示与否。
 *
 * 常量来源与量级：
 *   - coffee：按一次「深度推理」≈150 万 token 的粗估（长链思考 + 多轮工具往返
 *     的常见量级），不是官方口径；
 *   - novel：按 12 万字中文小说、约 1 token ≈ 1 字的经验换算；
 *   - movie：按每分钟 4K 电影的字幕文本约 8k token（台词 + 描述）估；
 *   - carbon：每 3 万 token ≈1g CO₂e 的生命周期排放量级，来自公开的 LLM 推理
 *     能耗研究量级（只用于科普类比，不能当审计数字）。
 */

export type EquivalentSeed = {
  id: string;
  /** 单位名（界面和 count 拼起来读，如「1,666 杯咖啡」）。 */
  label: string;
  tokensPerUnit: number;
  /** 依据说明——每条都必须写清「按什么估」，不许裸数字。 */
  note: string;
};

export type EquivalentCount = {
  id: string;
  label: string;
  /** 完整单位数（向下取整）；不足一个单位时为 0。 */
  count: number;
  /** 千分位、最多一位小数的展示串。 */
  formatted: string;
};

export const EQUIVALENTS: readonly EquivalentSeed[] = [
  {
    id: "coffee",
    label: "杯咖啡",
    tokensPerUnit: 1_500_000,
    note: "按一次深度推理≈150 万 token 估"
  },
  {
    id: "novel",
    label: "本长篇小说",
    tokensPerUnit: 120_000,
    note: "按 12 万字中文小说"
  },
  {
    id: "movie",
    label: "分钟 4K 电影字幕",
    tokensPerUnit: 8_000,
    note: "按每分钟 8k token 字幕量估"
  },
  {
    id: "carbon",
    label: "克 CO₂e（估算）",
    tokensPerUnit: 30_000,
    note: "按每 3 万 token ≈1g 生命周期排放的公开研究量级"
  }
];

const FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0
});

/**
 * 给定 token 总量，按 EQUIVALENTS 逐条换算。纯函数：非有限数/负数按 0 处理
 * （不 throw；输入来自界面，脏值不该炸页面）。
 */
export function equivalentsFor(tokens: number): EquivalentCount[] {
  const safe = Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
  return EQUIVALENTS.map((seed) => {
    const count = Math.floor(safe / seed.tokensPerUnit);
    return {
      id: seed.id,
      label: seed.label,
      count,
      formatted: FORMATTER.format(count)
    };
  });
}
