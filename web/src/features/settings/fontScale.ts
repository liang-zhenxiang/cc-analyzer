import { useSyncExternalStore } from "react";

/**
 * 界面字号缩放（90%–130%）。
 *
 * 只做一件事：把档位写进根元素的 `--font-scale`，并持久化。所有缩放都发生在
 * `tokens.css` 的字号/行高令牌里（`calc(原值 * var(--font-scale))`），组件 CSS
 * 一行都不用改——这也是为什么它值得做成一个旋钮而不是逐处调样式。
 *
 * 不缩放间距、图标与表盘：那些是「形」不是「字」，跟着放大只会把密度语言与
 * 仪器比例一起搞乱。
 */
export const FONT_SCALE_KEY = "cca-font-scale";

/** 五档，默认 100%。档位是**白名单**：持久化里的未知值一律回落 100%。 */
export const FONT_SCALES = [0.9, 1, 1.1, 1.2, 1.3] as const;
export type FontScale = (typeof FONT_SCALES)[number];
export const DEFAULT_FONT_SCALE: FontScale = 1;

export function parseFontScale(raw: unknown): FontScale {
  const value = typeof raw === "number" ? raw : Number.parseFloat(String(raw ?? ""));
  const match = FONT_SCALES.find((scale) => Math.abs(scale - value) < 0.001);
  return match ?? DEFAULT_FONT_SCALE;
}

export function loadFontScale(storage: Pick<Storage, "getItem"> = localStorage): FontScale {
  try {
    return parseFontScale(storage.getItem(FONT_SCALE_KEY));
  } catch {
    // localStorage 可能不可用；默认档位照样能用。
    return DEFAULT_FONT_SCALE;
  }
}

export function formatFontScale(scale: FontScale): string {
  return `${Math.round(scale * 100)}%`;
}

/** 写到根元素上；`root` 可注入，便于测试与将来在同一进程里跑多份界面。 */
export function applyFontScale(
  scale: FontScale,
  root: Pick<HTMLElement, "style"> = document.documentElement
): void {
  root.style.setProperty("--font-scale", String(scale));
}

let current: FontScale = DEFAULT_FONT_SCALE;
const listeners = new Set<() => void>();

export function getFontScale(): FontScale {
  return current;
}

export function subscribeFontScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setFontScale(scale: FontScale): void {
  const next = parseFontScale(scale);
  if (next === current) return;
  current = next;
  applyFontScale(next);
  try {
    localStorage.setItem(FONT_SCALE_KEY, String(next));
  } catch {
    // 持久化失败不影响本次会话的缩放。
  }
  for (const listener of listeners) listener();
}

/** 启动时调用一次：读持久化 → 写根元素 → 同步内存值。 */
export function initFontScale(): FontScale {
  current = loadFontScale();
  applyFontScale(current);
  return current;
}

export function useFontScale(): FontScale {
  return useSyncExternalStore(subscribeFontScale, getFontScale, () => DEFAULT_FONT_SCALE);
}

/** 测试用：把内存值拉回默认（不动 localStorage）。 */
export function resetFontScaleForTest(scale: FontScale = DEFAULT_FONT_SCALE): void {
  current = scale;
  for (const listener of listeners) listener();
}
