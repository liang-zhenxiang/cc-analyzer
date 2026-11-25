/**
 * 标签宽度估算与截断——成本树图（Issue #359）与项目流量河流图（Issue #388）
 * 共用的排版口径。
 *
 * 这里只有纯计算：调用方把通道宽度与像素字号算好再传进来（项目名与会话标题
 * 的内边距不同，不能在公共函数里写死）。估算规则与两处的排版、测试用的是
 * 同一套，所以「标签是否越界」可以在 jsdom 里直接核对。
 */

/** CJK / 全角标点按 1.0em，其余按 0.62em——与标签截断的宽度估算保持一致。 */
function charWidth(char: string, fontSize: number): number {
  return /[^\x00-\xff]/.test(char) ? fontSize : fontSize * 0.62;
}

/** 一段文字的估算宽度（与 `fitLabel` 的截断口径一致），供排版与测试核对。 */
export function textWidth(text: string, fontSize: number): number {
  return [...text].reduce((sum, char) => sum + charWidth(char, fontSize), 0);
}

/**
 * 标签截断：`maxWidth` 由调用方按矩形宽与左右内边距算好（项目名与会话标题的
 * 内边距不同，不能在这里写死）。
 *
 * 返回 `null` 表示「整条不画」——截断后少于 3 个字符时，剩下的信息量还不如
 * 留白；半个省略号只会让人以为标签坏了。
 */
export function fitLabel(text: string, maxWidth: number, fontSize: number): string | null {
  if (!(maxWidth > 0) || !(fontSize > 0)) return null;
  const chars = [...text];
  const fullWidth = chars.reduce((sum, char) => sum + charWidth(char, fontSize), 0);
  if (fullWidth <= maxWidth) return text;

  const ellipsisWidth = charWidth("…", fontSize);
  let used = 0;
  let kept = "";
  for (const char of chars) {
    const width = charWidth(char, fontSize);
    if (used + width + ellipsisWidth > maxWidth) break;
    kept += char;
    used += width;
  }
  if ([...kept].length < 3) return null;
  return `${kept}…`;
}
