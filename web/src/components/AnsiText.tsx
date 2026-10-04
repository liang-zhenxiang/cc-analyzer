import { useMemo } from "react";
import { cssColorFor, parseAnsi } from "../lib/ansi";
import styles from "./AnsiText.module.css";

/**
 * Terminal output, rendered with the colours it was written with.
 *
 * Transcripts keep the escape sequences Claude Code captured from the tools, so
 * a `Bash` result arrives full of `\u001b[31m`. Printing those bytes as text is
 * what the log view did before this component existed — the user read `[31m`
 * confetti instead of the red error line the tool printed.
 *
 * Only two things are configurable per span, and both are built here from a
 * parsed model: colour values come from `cssColorFor` (validated numbers or a
 * theme variable, never a raw string from the transcript), and the attribute
 * flags come from this module's own classes. A crafted session cannot reach the
 * `style` attribute.
 */
export function AnsiText({ text }: { text: string }) {
  const spans = useMemo(() => parseAnsi(text), [text]);

  return (
    <>
      {spans.map((span, index) => {
        const { fg, bg, inverse } = span.style;
        const foreground = cssColorFor(fg);
        const background = cssColorFor(bg);
        // 暗淡（SGR 2）只该压暗前景。整段 `opacity` 会把背景色和反显色块一起洗淡，
        // 所以：能加 alpha 的数值色直接给 alpha；命名色（`var(--ansi-N)`）没有
        // alpha 通道，此时**且仅当**没有背景色时才退回整段透明度——有背景的场合
        // 宁可不压暗，也不去改一块本该实心的底色。
        const dimmed = span.style.dim ? dimForeground(foreground) : foreground;
        const useDimOpacity = Boolean(span.style.dim) && !background && dimmed === foreground;
        // 反显是「交换前景与背景」：只设了一边时，另一边取页面默认色，
        // 否则反显会渲染成没有背景的普通文本。
        const style = {
          color: inverse ? (background ?? "var(--bg-subtle)") : dimmed,
          background: inverse ? (foreground ?? "var(--text)") : background
        };
        const classes = [
          span.style.bold ? styles.bold : "",
          useDimOpacity ? styles.dim : "",
          span.style.italic ? styles.italic : "",
          span.style.underline ? styles.underline : "",
          span.style.strike ? styles.strike : ""
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <span key={index} className={classes || undefined} style={style}>
            {span.text}
          </span>
        );
      })}
    </>
  );
}

/**
 * SGR 2 applied to a resolved colour. `rgb(r g b)` gains an alpha channel;
 * anything else (a theme variable) is returned untouched — see the caller.
 */
function dimForeground(color: string | undefined): string | undefined {
  const match = /^rgb\((\d+) (\d+) (\d+)\)$/.exec(color ?? "");
  if (!match) return color;
  return `rgb(${match[1]} ${match[2]} ${match[3]} / 0.62)`;
}
