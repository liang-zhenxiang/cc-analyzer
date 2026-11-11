/**
 * 个性化强调色（Issue #322）。
 *
 * 与 `fontScale.ts` / `contrast.ts` 同一形状：只往根元素写一个属性
 * （`data-accent="<id>"`），四值色板全部由 `tokens.css` 的覆盖段承担。
 * 组件一行颜色都不用改——这正是「强调色只改令牌」值得成立的原因：
 * 全站 40 多处焦点环、选中态、链接都消费 `--accent` / `--ring`，
 * 换个属性就能整体换色，而不是逐处改样式。
 *
 * 默认蓝**不写属性**：`[data-accent]` 只表达「偏离默认」，于是
 * 「没设置」「非法值」「显式选蓝」三种状态在 DOM 上收敛成同一种形态。
 */
export const ACCENT_STORAGE_KEY = "cca-accent";

export type AccentId = "blue" | "teal" | "violet" | "amber" | "rose" | "green";

/**
 * 选择器里展示的六套色板。
 *
 * `swatch` 是色块圆点的填充色，**不是** `--accent` 本身：浅色档的 `--accent`
 * （如琥珀 #8a6100）在深色面板上会糊成一团黑，深色档的 `--accent`
 * （如 #edc14e）在白底上又淡得看不见。色块要在两套主题的面板底色上都读得出来，
 * 所以取两者之间的中间调；每一档都实测过（浅/深 > 2.7:1），它是装饰件，
 * 不承担语义，可访问文本由旁边的名称提供。
 */
export const ACCENT_PRESETS: ReadonlyArray<{
  id: AccentId;
  label: string;
  swatch: string;
}> = [
  { id: "blue", label: "品牌蓝", swatch: "#3f63d9" },
  { id: "teal", label: "青绿", swatch: "#168a9b" },
  { id: "violet", label: "紫罗兰", swatch: "#8a63e0" },
  { id: "amber", label: "琥珀", swatch: "#b98510" },
  { id: "rose", label: "玫红", swatch: "#d9508a" },
  { id: "green", label: "松绿", swatch: "#2e9a62" }
];

/** 白名单归一：持久化是外部数据，未知 / 空值一律回品牌蓝。 */
function normalize(raw: unknown): AccentId {
  return ACCENT_PRESETS.some((preset) => preset.id === raw) ? (raw as AccentId) : "blue";
}

/**
 * 读持久化。未设置、非法值、storage 不可用（隐私模式、配额拒绝）都回 `blue`。
 *
 * 这里不做「没选过」与「选过蓝」的区分——两档视觉完全一致，区分的唯一用处
 * 是跟随系统，而强调色没有系统偏好可跟随。
 */
export function readAccent(): AccentId {
  try {
    if (typeof localStorage === "undefined") return "blue";
    return normalize(localStorage.getItem(ACCENT_STORAGE_KEY));
  } catch {
    return "blue";
  }
}

/**
 * 把 `data-accent` 写到 `<html>`；`blue` 时**移除属性**，落回 `:root` 的默认令牌。
 *
 * 蓝色不写成 `data-accent="blue"`：`tokens.css` 里没有这一条规则，写上去只会
 * 产生一个「看起来设了、实际没覆盖」的假状态。
 */
export function applyAccent(id: AccentId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const next = normalize(id);
  if (next === "blue") root.removeAttribute("data-accent");
  else root.setAttribute("data-accent", next);
}

/** 启动时调用一次：读存储 → 应用 → 返回当前值（供首屏渲染的受控组件使用）。 */
export function initAccent(): AccentId {
  const accent = readAccent();
  applyAccent(accent);
  return accent;
}

/**
 * 显式选择：落盘 + 应用。
 *
 * 持久化失败**不阻断**本次会话的换色——与 `setFontScale` 同一条取舍：
 * 存不住是下次启动回默认，而不是这次点击没有效果。
 */
export function setAccent(id: AccentId): void {
  const next = normalize(id);
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(ACCENT_STORAGE_KEY, next);
    }
  } catch {
    // 持久化失败不影响本次会话的换色。
  }
  applyAccent(next);
}
