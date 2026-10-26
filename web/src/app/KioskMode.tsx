import { useSyncExternalStore, type ReactNode } from "react";
import {
  DEFAULT_FONT_SCALE,
  getFontScale,
  type FontScale,
  parseFontScale,
  setFontScale
} from "../features/settings/fontScale";
import styles from "./KioskMode.module.css";

/**
 * 大屏模式（Kiosk）：给挂在第二块屏幕上看的那台机器用。
 *
 * 它**只做两件事**：收起应用外壳（顶栏——工作区标签与页头控件行都在里面），
 * 把界面字号提到既有白名单的最高档（130%）。不做全屏锁定、不拦鼠标、不改滚动：
 * 这是「看起来更大」，不是「不让动」。
 *
 * 于是它没有自己的视觉语言：字号走 `fontScale.ts` 的既有档位（不新造 1.25 这种
 * 白名单外的值，也不直接改 `tokens.css` 的 px），字形与间距照旧——放大的只是字。
 *
 * 状态写 localStorage `cca-kiosk`（"on" / 其它）。进入时把当时的字号记到
 * `cca-kiosk-scale`，退出时还回去；用户在大屏里自己动过字号则不覆盖他的选择。
 */
export const KIOSK_KEY = "cca-kiosk";
const KIOSK_SCALE_KEY = "cca-kiosk-scale";

/** 大屏档：既有档位里的最高档（130%），不是新档。 */
export const KIOSK_FONT_SCALE = 1.3;

/** 白名单：只认我们写下去的 `"on"`，别的值一律当关闭。 */
export function parseKiosk(raw: unknown): boolean {
  return raw === "on";
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadKiosk(
  storage: Pick<Storage, "getItem"> | null = defaultStorage()
): boolean {
  if (!storage) return false;
  try {
    return parseKiosk(storage.getItem(KIOSK_KEY));
  } catch {
    return false;
  }
}

/** 写到根元素上；普通档**移除属性**而不是写 `"off"`（与主题 / 对比度同款）。 */
export function applyKiosk(
  on: boolean,
  root: Pick<HTMLElement, "dataset"> = document.documentElement
): void {
  if (on) root.dataset.kiosk = "on";
  else delete root.dataset.kiosk;
}

let current = false;
const listeners = new Set<() => void>();

export function getKiosk(): boolean {
  return current;
}

export function subscribeKiosk(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setKiosk(next: boolean): void {
  const value = Boolean(next);
  if (value === current) return;
  current = value;
  applyKiosk(value);

  const storage = defaultStorage();
  if (value) {
    // 记住进入前的档位，再把字号提到大屏档。
    try {
      storage?.setItem(KIOSK_SCALE_KEY, String(getFontScale()));
      storage?.setItem(KIOSK_KEY, "on");
    } catch {
      // 持久化失败不影响本次会话的大屏效果。
    }
    setFontScale(KIOSK_FONT_SCALE);
  } else {
    // 没存过档位（例如清过 localStorage）就退回默认档，而不是留在 130%。
    let saved: FontScale = DEFAULT_FONT_SCALE;
    try {
      saved = parseFontScale(storage?.getItem(KIOSK_SCALE_KEY));
      storage?.setItem(KIOSK_KEY, "off");
      storage?.removeItem(KIOSK_SCALE_KEY);
    } catch {
      saved = DEFAULT_FONT_SCALE;
    }
    // 只有「字号还停在我们的档位上」才复原：用户在大屏里自己调过就别抢他的选择。
    const untouched = Math.abs(getFontScale() - KIOSK_FONT_SCALE) < 0.001;
    if (untouched) setFontScale(saved);
  }

  for (const listener of listeners) listener();
}

export function toggleKiosk(): void {
  setKiosk(!current);
}

/** 启动时调用一次：读持久化 → 写根元素 → 同步内存值。 */
export function initKiosk(): boolean {
  current = loadKiosk();
  applyKiosk(current);
  return current;
}

export function useKiosk(): boolean {
  return useSyncExternalStore(subscribeKiosk, getKiosk, () => false);
}

/** 测试用：把内存值拉回默认（不动 localStorage 与字号档）。 */
export function resetKioskForTest(on = false): void {
  current = on;
  for (const listener of listeners) listener();
}

/**
 * 大屏容器：`data-kiosk` 的落点，也是真机探针的锚点（`data-probe="kiosk-root"`）。
 * 外壳的收起规则在 `AppShell.module.css`（只有那里能选到顶栏），这里只管容器本身。
 */
export function KioskRoot({ children }: { children: ReactNode }) {
  const kiosk = useKiosk();
  return (
    <div className={styles.root} data-kiosk={kiosk ? "on" : undefined} data-probe="kiosk-root">
      {children}
      {/* 大屏收起了所有控件，得留一条「怎么出去」的线索；`pointer-events: none`
          保证它一像素都不挡交互。 */}
      {kiosk ? <p className={styles.hint}>Esc 退出大屏</p> : null}
    </div>
  );
}
