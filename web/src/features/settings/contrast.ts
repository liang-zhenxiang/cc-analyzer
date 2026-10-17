import { useSyncExternalStore } from "react";

/**
 * 界面高对比度档（普通 / 高对比度）。
 *
 * 与 `fontScale.ts` 同构，但换的是一整套颜色而不是一个乘数：档位只做一件事——
 * 往根元素写 `data-contrast="high"`，颜色全部由 `tokens.css` 的两块
 * `[data-contrast="high"]` / `[data-theme="dark"][data-contrast="high"]` 承担，
 * 组件 CSS 一行都不用改（焦点环的宽度与偏移是仅有的例外，见 tokens.css）。
 *
 * 普通档**移除属性**而不是写 `"normal"`：真机探针按「属性取不到 = 普通」对账，
 * CSS 里 `[data-contrast="high"]` 也只命中一种状态，不会冒出第三个档位。
 *
 * 系统偏好（`prefers-contrast: more`）只在**没写过**时跟随；用户点过任何一档
 * 就算显式选择，此后系统再怎么变都不动。
 */
export const CONTRAST_KEY = "cca-contrast";

/** 两档，默认普通。档位是**白名单**：持久化里的未知值一律回落普通。 */
export const CONTRAST_MODES = ["normal", "high"] as const;
export type ContrastMode = (typeof CONTRAST_MODES)[number];
export const DEFAULT_CONTRAST: ContrastMode = "normal";

const HIGH_CONTRAST_QUERY = "(prefers-contrast: more)";

export function parseContrast(raw: unknown): ContrastMode {
  return raw === "high" || raw === "normal" ? raw : DEFAULT_CONTRAST;
}

function defaultStorage(): Pick<Storage, "getItem"> | null {
  try {
    // 隐私模式 / 无 storage 的环境里访问 localStorage 本身就可能抛异常。
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function defaultMediaQuery(): Pick<MediaQueryList, "matches"> | null {
  // jsdom、老引擎与 SSR 都没有 matchMedia：没有就按「系统无偏好」处理。
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(HIGH_CONTRAST_QUERY);
  } catch {
    return null;
  }
}

/**
 * 读过但**可能没写**：只认白名单，未写 / 非法 / 读抛异常都返回 null。
 *
 * 与 `parseContrast` 的区别正是这一档的全部语义：`null` 是「没选过」（继续跟随
 * 系统），而 `"normal"` 是「选过普通」（此后不再跟随）。
 */
export function readStoredContrast(
  storage: Pick<Storage, "getItem"> | null = defaultStorage()
): ContrastMode | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CONTRAST_KEY);
    return raw === "high" || raw === "normal" ? raw : null;
  } catch {
    return null;
  }
}

/** 只读系统偏好；`media` 可注入，便于单测构造「系统开了高对比度」这一档。 */
export function prefersHighContrast(
  media: Pick<MediaQueryList, "matches"> | null = defaultMediaQuery()
): boolean {
  return media?.matches === true;
}

/**
 * 三步判定的唯一出口：① 存储命中白名单就用它；② 没写过才看系统偏好；
 * ③ 连系统偏好都问不到就停在普通。
 */
export function resolveContrast(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
  media: Pick<MediaQueryList, "matches"> | null = defaultMediaQuery()
): ContrastMode {
  const stored = readStoredContrast(storage);
  if (stored !== null) return stored;
  return prefersHighContrast(media) ? "high" : "normal";
}

/** 启动入口：与 `resolveContrast` 同一个出口，名字照 `loadFontScale` 的形状对齐。 */
export function loadContrast(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
  media: Pick<MediaQueryList, "matches"> | null = defaultMediaQuery()
): ContrastMode {
  return resolveContrast(storage, media);
}

/**
 * 写到根元素上：`high` 时写 `data-contrast="high"`，普通档**删掉**该属性。
 * `root` 可注入，便于测试与将来在同一进程里跑多份界面。
 */
export function applyContrast(
  mode: ContrastMode,
  root: Pick<HTMLElement, "setAttribute" | "removeAttribute"> = document.documentElement
): void {
  if (mode === "high") root.setAttribute("data-contrast", "high");
  else root.removeAttribute("data-contrast");
}

let current: ContrastMode = DEFAULT_CONTRAST;
const listeners = new Set<() => void>();
// 系统偏好监听只挂一次；重复 init 不该叠出一串重复的 change 回调。
let watching = false;

function emit(): void {
  for (const listener of listeners) listener();
}

export function getContrast(): ContrastMode {
  return current;
}

export function subscribeContrast(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 显式选择：落盘 + 应用 + 通知。
 *
 * 注意与 `setFontScale` 的一处**有意差异**：值与当前相同时也要落盘。用户点过任何
 * 一档就算「显式选择」，若在系统 `more` 的机器上点「普通」却因为「值没变」而不写，
 * 这个选择就退化成了「继续跟随系统」——那正是这一步要钉住的语义。
 */
export function setContrast(mode: ContrastMode): void {
  const next = parseContrast(mode);
  try {
    localStorage.setItem(CONTRAST_KEY, next);
  } catch {
    // 持久化失败不影响本次会话的换挡。
  }
  if (next === current) return;
  current = next;
  applyContrast(next);
  emit();
}

/**
 * 启动时调用一次：解析 → 应用 → 挂上系统偏好监听。
 *
 * 监听只在「没有显式选择」时生效：用户选过就锁在本机选择上，系统再变也不动。
 */
export function initContrast(): ContrastMode {
  current = resolveContrast();
  applyContrast(current);
  watchSystemContrast();
  return current;
}

function watchSystemContrast(): void {
  if (watching) return;
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
  watching = true;
  const media = window.matchMedia(HIGH_CONTRAST_QUERY);
  // 老引擎只有 addListener；没有监听接口就只是不跟随，不影响显式档位。
  media.addEventListener?.("change", () => {
    if (readStoredContrast() !== null) return;
    const next = resolveContrast();
    if (next === current) return;
    current = next;
    applyContrast(next);
    emit();
  });
}

export function useContrast(): ContrastMode {
  return useSyncExternalStore(subscribeContrast, getContrast, () => DEFAULT_CONTRAST);
}

/** 测试用：把内存值拉回默认并允许重新 init（不动 localStorage）。 */
export function resetContrastForTest(mode: ContrastMode = DEFAULT_CONTRAST): void {
  current = mode;
  watching = false;
  emit();
}
