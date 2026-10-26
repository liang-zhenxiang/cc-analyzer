/**
 * 命令面板的纯逻辑层：动作表 + 模糊匹配打分 + 键盘导航索引。
 *
 * 这里没有 React、没有 `Date.now()`、没有 I/O——三件事都能被单测直接钉住：
 * ① 查询怎么打分（子序列 + 连续命中 + 词首命中）；② 空查询保留注册顺序；
 * ③ 移动高亮时跳过不可用项、并且绕回两端。
 *
 * 动作本身是**既有能力的入口**，不新造功能：拿不到的（用量档内切档、导出快照、
 * 归档仓库）留在表里标 `disabled`，面板如实显示「不可用」——把看不见的能力
 * 假装成看得见的入口，比少一条命令更糟。
 */

export type CommandGroup = "视图" | "用量" | "外观" | "动作";

export type CommandAction = {
  /** 稳定 id：既是 `data-probe` 锚点前缀，也是 `aria-activedescendant` 的来源。 */
  id: string;
  title: string;
  group: CommandGroup;
  /** 只参与匹配、不显示的别名（例如「主题 外观 深色」里的英文名）。 */
  keywords?: string;
  /** 展示用快捷键标签，不参与匹配。 */
  shortcut?: string;
  /** 一句话说明（也用作不可用的原因），渲染在标题下方。 */
  detail?: string;
  disabled?: boolean;
  run?: () => void;
};

/** 打分常数写在这里，单测按它们反推比值，不在测试里重抄魔数。 */
const BASE_SCORE = 100;
const PREFIX_BONUS = 12;
const CONSECUTIVE_BONUS = 8;
const WORD_START_BONUS = 6;
/** 命中位置越靠后扣得越多，但设上限：长标题不该被位置罚到 0 分。 */
const START_PENALTY = 1;
const START_PENALTY_CAP = 40;

const WORD_SEPARATOR = /[\s·：:，,、/]/u;

/**
 * 归一化查询：小写 + 去掉所有空白。
 *
 * 去空白是让「主题 深色」和「主题深色」等价——用户按不按空格是手速问题，
 * 不该改变结果。匹配本身是**子序列**（顺序敏感、不要求连续），所以它不等于
 * 词袋匹配：「外观深色」要求「外→观→深→色」这一串在 haystack 里按序出现。
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/gu, "");
}

/** `null` = 不匹配；数字越大越靠前。空查询对每个动作都是 0 分。 */
export function scoreCommand(query: string, action: CommandAction): number | null {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return 0;

  // 分组名放进 haystack 的**末尾**：只输入「外观」「视图」这类控制词也能列出该组，
  // 但排在标题后面，不会抢走标题前缀命中的加分。
  const haystack = `${action.title} ${action.keywords ?? ""} ${action.group}`.toLowerCase();
  if (haystack.length === 0) return null;

  let score = BASE_SCORE;
  let cursor = -1;
  let previous = -2;

  for (const char of needle) {
    let found = -1;
    for (let index = cursor + 1; index < haystack.length; index += 1) {
      if (haystack[index] === char) {
        found = index;
        break;
      }
    }
    // 子序列失败：这条动作不出现，而不是以 0 分排在最后。
    if (found < 0) return null;

    if (found === previous + 1) score += CONSECUTIVE_BONUS;
    if (found === 0) score += PREFIX_BONUS;
    else if (WORD_SEPARATOR.test(haystack[found - 1])) score += WORD_START_BONUS;
    score -= Math.min(found, START_PENALTY_CAP) * START_PENALTY;

    previous = found;
    cursor = found;
  }

  return score;
}

/**
 * 过滤 + 排序。同分按注册顺序（稳定），所以空查询就是原样一张表——
 * 注册顺序已经把命令按用途分好组了，不需要再加一层分组标题。
 */
export function filterCommands(
  actions: readonly CommandAction[],
  query: string
): CommandAction[] {
  if (normalizeQuery(query).length === 0) return [...actions];

  const scored: { action: CommandAction; order: number; score: number }[] = [];
  actions.forEach((action, order) => {
    const score = scoreCommand(query, action);
    if (score !== null) scored.push({ action, order, score });
  });
  scored.sort((left, right) => right.score - left.score || left.order - right.order);
  return scored.map((entry) => entry.action);
}

/** 环形索引：两端绕回；空列表返回 -1（没有可高亮的位置）。 */
export function nextIndex(current: number, length: number, delta: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : length - 1;
  return (current + delta + length * 2) % length;
}

/**
 * 移动高亮并跳过不可用项。一圈都是不可用时返回 -1——调用方据此把焦点留在输入框、
 * Enter 什么也不做，而不是把「不可用」当成一个可以执行的选项。
 */
export function stepHighlight(
  actions: readonly CommandAction[],
  current: number,
  delta: number
): number {
  if (actions.length === 0) return -1;
  let index = current;
  for (let step = 0; step < actions.length; step += 1) {
    index = nextIndex(index, actions.length, delta);
    if (!actions[index].disabled) return index;
  }
  return -1;
}

/** 过滤后高亮的落点：第一条可用动作；一条都没有则 -1。 */
export function firstEnabledIndex(actions: readonly CommandAction[]): number {
  return stepHighlight(actions, -1, 1);
}

/** 只有 `run` 存在且未禁用的动作才可执行。 */
export function isRunnable(action: CommandAction): boolean {
  return action.disabled !== true && typeof action.run === "function";
}
