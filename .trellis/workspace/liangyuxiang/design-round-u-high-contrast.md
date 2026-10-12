# 「高对比度档」设计规格（Round U）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-12 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（已锁定）：设置浮层新增「界面对比度」一节（普通 / 高对比度），持久化到 `cca-contrast`，
> 未知值回落普通；实现走**令牌层**——`tokens.css` 新增两块 `[data-contrast="high"]` 与
> `[data-theme="dark"][data-contrast="high"]`，`<html>` 上一个属性即全局换挡，组件颜色**一行不改**
> （焦点环宽度与分段控件选中态描边是仅有的两处例外，见 §4）。
> **本文件只描述设计与断言，不改任何源码。**

---

## 0. 语境与现状（写前逐字读过）

**读过的文件**：`gh issue view 73 --comments`（契约权威）、`web/src/styles/tokens.css`、
`web/src/styles/tokens.test.ts`、`web/src/styles/global.css`、`web/src/features/settings/fontScale.ts`
与 `fontScale.test.ts`、`web/src/features/settings/ThresholdsPanel.tsx` 与 `.module.css` 与 `.test.tsx`、
`web/src/components/SegmentedControl.tsx` 与 `.module.css`、`web/src/app/ThemeProvider.tsx`、
`web/src/App.tsx`、`web/index.html`、`web/playwright.config.ts`、`web/e2e/font-scale.spec.ts`、
`web/e2e/fixtures.ts`、`scripts/gui-test.sh`、`src-tauri/src/lib.rs`、
`.trellis/workspace/liangyuxiang/design-round-l-font-scale.md`（字号那轮的规格，本文件的格式与颗粒度照它）。

**逐条 grep 出来的既有事实**（后文反复引用，都是实测而不是印象）：

- `:focus-visible` 全站共 **30 个选择器 / 29 条规则**：22 条用 `outline` 画环（其中 3 条环同时带
  左缘竖条）、4 条用 `outline: none` + `box-shadow: inset 2px 0 0 var(--accent)` 的竖条、
  1 条只改底色与边框（`SessionHeader.module.css` 的 `.readouts`）、2 条是环下后代箭头的提高。
  焦点竖条总数 7（4 条纯竖条 + 3 条环与竖条并存）；另有 7 处同款竖条属于**选中态**，
  不在 `:focus-visible` 里（全仓库这类竖条共 14 处，见 §4.1 末段）。
- 环色只有**两个来源**：`--ring`（`global.css` / `Button` / `TextInput` 三处）与 `--accent`（其余 19 条）。
  于是「高对比度换环色」不需要动任何选择器——换掉这两个令牌即可。
- 环的**宽度** `2px` 与**偏移** `1px / 2px / -2px` 是字面量，令牌层换不动，这是 §4 要解决的全部内容。
- 分段控件的选中态是「`--bg-subtle` 底 + `--shadow-sm` + `font-weight: 600`」三通道；
  选中滑块与凹槽的对比度：浅色 **1.13:1**、深色 **1.12:1**。阴影在浅底上不构成边界。
- `--font-scale` 那轮已经确立范式：**一个根属性 + 令牌层换挡 + 预绘制脚本 + 设置里一节 radiogroup**。
  本轮完全照搬这条形状，不新造状态库。

### 0.1 与在途实现的对接（先看这条，免得写出第二套命名）

工作区里 `src-tauri/src/lib.rs` **已被改（未提交）**，里面已经在等这一档，本规格**沿用它的三处命名**：

| 在途事实（`src-tauri/src/lib.rs`） | 位置 | 本规格对应的实现要求 |
| --- | --- | --- |
| 动作 `对比度=高` / `对比度=普通` | `contrast_target` / `contrast_js` | 与 `字号=<档位>` 同一条动作协议 |
| 容器锚点 `data-probe="contrast-group"` | `contrast_js` 的第一优先选择器 | 设置面板那一节的外层 `<div>` 必须挂这个属性 |
| 兜底选择器 `[role="radiogroup"][aria-label="界面对比度"]` | `contrast_js` 的第二优先选择器 | 组的可访问名必须是 `界面对比度` |
| 探针事实 `contrast`（根元素 `data-contrast`，普通档取到 `""`） | `PROBE_JS` | 普通档**移除属性**，不是留 `"normal"` |

**一处偏差，需要维护者拍板（本文件按推荐值定稿）**：Issue #73 最新那条评论写的是
「设置面板新增**显示对比度**一节」，而 `contrast_js` 的兜底选择器已经按
`aria-label="界面对比度"` 写死。本规格取 **`界面对比度`**——理由是它与同面板紧邻的
`界面字号` 同构（都是「界面 + 一个可视属性」），两节读起来是一对；而 `显示对比度`
与 `界面字号` 不成对。若维护者坚持 `显示对比度`，必须**同时**改 `contrast_js` 的兜底
选择器与本节标题，两处只能有一个名字（同「一个主题只有一个权威」）。

工作区此刻**没有** `web/src/features/settings/contrast.ts`、没有 tokens 里的高对比度块、
没有 `web/e2e/contrast.spec.ts`——前端实现本轮从零开始，命名以本文件为准。

---

## 1. 实现约束

### 1.1 换挡载体：`data-contrast`（本轮唯一新增的根属性）

- 值只有两种：属性**存在且为 `high`**，或**属性不存在**（普通档）。不写 `data-contrast="normal"`。
  理由有二：① 探针事实 `getAttribute('data-contrast') || ''` 已经按「普通 = 空串」定了契约；
  ② 选择器 `[data-contrast="high"]` 只命中一种状态，CSS 里不需要 `:not()`，也不会出现
  「普通档残留一个属性、有人照着它写出第三档」。
- 不引入 `--contrast-level: 1` 之类的标量开关。字号那轮能用标量，是因为缩放本质是
  `calc(原值 × k)`；高对比度换的是**一整套颜色**，标量无处可乘——写成变量只会变成
  「一堆 `color-mix()` 凑色」，那正是对比度不可控的来源。
- 与 `--font-scale` 正交：`130% + 高对比度` 是常态，两条路径互不读写对方的键。
- **CSS 块顺序**（写在 `tokens.css` 末尾）：
  `:root` → `[data-theme="dark"]` → `[data-contrast="high"]` → `[data-theme="dark"][data-contrast="high"]`。
  深色高对比度那条有两个属性（特异性 0,2,0），一定压过单属性块（0,1,0），顺序**不是**正确性的
  依赖，但按这个顺序写，读的人不必去算特异性。
- 两块各自声明 `color-scheme`（浅块 `light`、深块 `dark`）：原生控件、滚动条与
  `accent-color` 的分支跟着走，否则深色高对比度下 `<progress>` 会拿到浅色系统控件。

### 1.2 覆盖范围

| 组 | 令牌 | 是否覆盖 |
| --- | --- | --- |
| 语义·文字 | `--text` / `--text-secondary` / `--text-tertiary` / `--text-faint` | 覆盖（4 条） |
| 语义·表面 | `--bg` / `--bg-subtle` / `--bg-elevated` / `--bg-inset` / `--bg-hover` / `--bg-active` | 覆盖（6 条） |
| 语义·边框 | `--border` / `--border-strong` | 覆盖（2 条） |
| 语义·动作与强调 | `--ink` / `--on-ink` / `--accent` / `--accent-hover` / `--accent-soft` / `--ring` | 覆盖（6 条） |
| 语义·确定性三档 | `--success(-soft)` / `--warning(-soft)` / `--danger(-soft)` | 覆盖（6 条） |
| 类别色 | `--cat-wait/-direct/-delegated/-compute/-user/-workflow` | 覆盖（6 条） |
| 图表色板 | `--chart-1…6` 与 `--chart-1-soft…6-soft` | 覆盖（12 条） |
| 终端调色板 | `--ansi-0…15` | **不覆盖**（理由与实算见 §3.4） |
| 代码高亮 | `--code-comment/keyword/string/number/function/type` | **不覆盖**（同上） |
| 层级语言 | `--shadow-sm` / `--shadow-md` / `--overlay` | **不覆盖**（同上） |
| 形与距 | `--font-scale` / `--fs-*` / `--lh-*` / `--sp-*` / `--r-*` / `--col-*` / `--control-h*` / `--topbar-h` / `--sidebar-w` / `--detail-w` / `--gauge-size*` / `--scrollbar-size` / `--dur-*` / `--ease-*` | **一律不得出现在两块里**（§1.3、§8.1 有守卫断言） |
| 焦点环几何 | `--focus-ring-width` / `--focus-ring-offset` / `--focus-ring-inset` | 覆盖（3 条，本轮新增） |

合计：浅色块与深色块各 **45 条自定义属性**（42 条颜色 + 3 条焦点环几何），外加一条
`color-scheme`。精确清单见 §2.1 / §2.2 的代码块，实现者照抄那两块即可，令牌名与顺序按代码块走。

### 1.3 红线：只动颜色与焦点环

**间距、字号、行高、控件尺寸、圆角、时长、列宽、图标尺寸一律不动。** 三条硬理由：

1. 高对比度解决的是**对比度**，不是尺寸；尺寸一起变，密度语言（表头 = 数据行、行高 30）
   与仪器比例（表盘 140×140、占比条 6px）会一起乱掉——这是字号那轮已经付过学费的教训。
2. `--col-*` 是按 **130% 字号档**实测出来的列预算（`tokens.css` 逐条写了量到多少 px），
   `--gauge-size` 是 SVG 的几何，真机门禁的行高账（`--row-h` = `8 + 16×档位`）也挂在上面。
   动尺寸等于同时推翻三处独立的实测账。
3. 高对比度用户常常是**同时**开 130% 字号的。两条路径都动尺寸，就会得到
   `130% × 对比度放大` 的乘法结果，没有人验证过那个组合。

允许动的东西只有两处，都在本轮范围里：**焦点环的宽度与偏移**（§4.1 的三个新令牌）、
**分段控件选中态的 1px 描边**（§4.4，`box-sizing: border-box`，外框尺寸逐像素不变）。

---

## 2. 两块令牌表

### 2.1 浅色高对比度 `[data-contrast="high"]`

```css
/* 高对比度（浅色底）：把「氛围」全部换成「边界」。
   表面塌成纯白，层级交给 --border / --border-strong 的发丝线与更深的边框；
   文字提到纯黑，次要文字也过 7:1；所有 -soft 从半透明改成不透明的浅色——
   高对比度要的是确定的边界，不是叠出来的氛围。
   逐条对比度见 .trellis/workspace/liangyuxiang/design-round-u-high-contrast.md §3.3。 */
[data-contrast="high"] {
  color-scheme: light;

  --bg: #ffffff;
  --bg-subtle: #ffffff;
  --bg-elevated: #ffffff;
  --bg-inset: #eef1f5;
  --bg-hover: #e7ecf2;
  --bg-active: #d8e0ea;

  --text: #000000;
  --text-secondary: #1f2b3a;
  --text-tertiary: #33414f;
  --text-faint: #4a5866;

  --border: #6b7280;
  --border-strong: #3f4854;

  --ink: #000000;
  --on-ink: #ffffff;

  --accent: #0b3f9c;
  --accent-hover: #062c73;
  --accent-soft: #d7e2fb;
  --ring: #0b3f9c;

  --success: #0a5a33;
  --success-soft: #d5ecdf;
  --warning: #7a4f00;
  --warning-soft: #f7e6c4;
  --danger: #a11208;
  --danger-soft: #fbdbd8;

  --cat-wait: #4b5563;
  --cat-direct: #005b8f;
  --cat-delegated: #a33d00;
  --cat-compute: #00705a;
  --cat-user: #9c2f6f;
  --cat-workflow: #4b21a8;

  --chart-1: #1c567f;
  --chart-1-soft: #d2dde5;
  --chart-2: #00606e;
  --chart-2-soft: #ccdfe2;
  --chart-3: #45631a;
  --chart-3-soft: #d8decf;
  --chart-4: #7a5200;
  --chart-4-soft: #e3dbc9;
  --chart-5: #5a3fa8;
  --chart-5-soft: #ded9ee;
  --chart-6: #932a56;
  --chart-6-soft: #ead7df;

  /* 焦点环：颜色来自上面的 --ring / --accent，这里只把「形」加粗并让环离开控件。 */
  --focus-ring-width: 3px;
  --focus-ring-offset: 2px;
  --focus-ring-inset: -4px;
}
```

### 2.2 深色高对比度 `[data-theme="dark"][data-contrast="high"]`

```css
/* 高对比度（深色底）：页面塌成纯黑、文字提到纯白。
   三档表面（subtle / elevated / inset）保留，因为终端输出、代码块与表格凹槽
   都靠它们分层；但边框全部从不透明白升成实色灰——
   「层级从背景台阶改为描边承担」这条在深色下尤其重要，纯黑叠纯黑是读不出来的。
   --bg-elevated 取 #1a1a1a 是实算出来的上限：再亮一档，未覆盖的终端调色板
   （--ansi-0 #7d8492）与代码注释（--code-comment #7f848e）就掉到 4.5 门槛之下，见 §3.4。 */
[data-theme="dark"][data-contrast="high"] {
  color-scheme: dark;

  --bg: #000000;
  --bg-subtle: #121212;
  --bg-elevated: #1a1a1a;
  --bg-inset: #000000;
  --bg-hover: #262626;
  --bg-active: #343434;

  --text: #ffffff;
  --text-secondary: #dcdcdc;
  --text-tertiary: #c4c4c4;
  --text-faint: #a8a8a8;

  --border: #767676;
  --border-strong: #9e9e9e;

  --ink: #ffffff;
  --on-ink: #000000;

  --accent: #8ab4ff;
  --accent-hover: #b9d0ff;
  --accent-soft: #16264a;
  --ring: #8ab4ff;

  --success: #6ee7a0;
  --success-soft: #0d2a1b;
  --warning: #ffc75e;
  --warning-soft: #2e230a;
  --danger: #ff9d94;
  --danger-soft: #331412;

  --cat-wait: #c0c0c0;
  --cat-direct: #6cb6ff;
  --cat-delegated: #ff9a4d;
  --cat-compute: #3fd39a;
  --cat-user: #ff9ecb;
  --cat-workflow: #b795ff;

  --chart-1: #7cb8f0;
  --chart-1-soft: #394c5d;
  --chart-2: #5fd0dd;
  --chart-2-soft: #2e4f53;
  --chart-3: #a3d97a;
  --chart-3-soft: #3f4e34;
  --chart-4: #ffd166;
  --chart-4-soft: #54492d;
  --chart-5: #c9a6f7;
  --chart-5-soft: #50455f;
  --chart-6: #ff9dc4;
  --chart-6-soft: #5f414d;

  --focus-ring-width: 3px;
  --focus-ring-offset: 2px;
  --focus-ring-inset: -4px;
}
```

### 2.3 值的来源（哪几条是被实算约束出来的，不是手感）

| 值 | 为什么是这个数 |
| --- | --- |
| 浅色 `--border: #6b7280` | 它要在**两种底**上都 ≥3：白底 4.83:1、`--bg-inset`(#eef1f5) 4.27:1。再浅一档（#767676）在白底 4.54 够、在凹槽底只有 3.98，余量太薄 |
| 浅色 `--text-faint: #4a5866` | 它在浅色主题里是「只放装饰字」的 2.6:1 档；高对比度下装饰字也要读得出来，取 7.29:1（仍低于 `--text-tertiary` 的 10.45，层级靠比值差保留） |
| 浅色 `--accent-soft: #d7e2fb` | 从 `rgba(41,82,204,0.1)` 改成不透明浅蓝：选中底上的正文 16.16:1、强调色文字压在同一底上 7.33:1，两个方向都过 |
| 深色 `--bg-elevated: #1a1a1a` | **上限**：`--ansi-0` / `--code-comment` 在该底上 4.63:1，再亮一档（#1f1f1f）掉到 4.39:1，低于终端文本 4.5 的门槛 |
| 深色 `--border: #767676` | 黑底 4.62:1、`--bg-elevated` 上 3.83:1，两种底都过 3 |
| 深色 `--ring: #8ab4ff` | 黑底 10.05:1、`--bg-elevated` 8.33:1、选中行底 `--bg-hover` 7.24:1——环可能压在四种底上，这是最低的那一档 |
| 深色 `--bg-hover: #262626` / `--bg-active: #343434` | 状态底不是文字/边框/图形，不受 3:1 约束，但要比现状更明显：黑底 1.39:1 / 1.69:1，高于现深色主题的 1.23:1 / 1.41:1（`#212429` / `#2a2e34` 叠在 `#0d0f12` 上） |

---

## 3. 实测对比度

### 3.1 公式与门槛

用 **WCAG 2.1 相对亮度**（`tokens.test.ts` 里已有的 `luminance` / `contrast` 两个辅助函数就是这条，
本轮复用，不写第二份）：

```
通道归一化 c = 分量 / 255
通道线性化 = c ≤ 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4
L = 0.2126·R + 0.7152·G + 0.0722·B
对比度 = (L_亮 + 0.05) / (L_暗 + 0.05)
```

门槛按契约分三档：**正文文字 ≥ 7:1**、**次要文字 ≥ 4.5:1**、**边框与图形 ≥ 3:1**。
终端调色板与代码高亮的既有门槛是 4.5:1（`tokens.test.ts` 已经钉住），本轮不降。

### 3.2 复现脚本（可直接 `node` 跑，规格里的每个数字都由它产出）

```js
// 用法：node hc-table.mjs
const chan = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => chan(Number.parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const cr = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const L = {
  bg: "#ffffff", elevated: "#ffffff", inset: "#eef1f5", hover: "#e7ecf2",
  text: "#000000", secondary: "#1f2b3a", tertiary: "#33414f", faint: "#4a5866",
  border: "#6b7280", borderStrong: "#3f4854", accent: "#0b3f9c", ring: "#0b3f9c",
  success: "#0a5a33", warning: "#7a4f00", danger: "#a11208",
  accentSoft: "#d7e2fb", successSoft: "#d5ecdf", warningSoft: "#f7e6c4", dangerSoft: "#fbdbd8",
  cat: ["#4b5563", "#005b8f", "#a33d00", "#00705a", "#9c2f6f", "#4b21a8"],
  chart: ["#1c567f", "#00606e", "#45631a", "#7a5200", "#5a3fa8", "#932a56"],
  chartSoft: ["#d2dde5", "#ccdfe2", "#d8decf", "#e3dbc9", "#ded9ee", "#ead7df"]
};
const D = {
  bg: "#000000", elevated: "#1a1a1a", inset: "#000000", hover: "#262626",
  text: "#ffffff", secondary: "#dcdcdc", tertiary: "#c4c4c4", faint: "#a8a8a8",
  border: "#767676", borderStrong: "#9e9e9e", accent: "#8ab4ff", ring: "#8ab4ff",
  success: "#6ee7a0", warning: "#ffc75e", danger: "#ff9d94",
  accentSoft: "#16264a", successSoft: "#0d2a1b", warningSoft: "#2e230a", dangerSoft: "#331412",
  cat: ["#c0c0c0", "#6cb6ff", "#ff9a4d", "#3fd39a", "#ff9ecb", "#b795ff"],
  chart: ["#7cb8f0", "#5fd0dd", "#a3d97a", "#ffd166", "#c9a6f7", "#ff9dc4"],
  chartSoft: ["#394c5d", "#2e4f53", "#3f4e34", "#54492d", "#50455f", "#5f414d"]
};

for (const [name, P] of [["浅色高对比度", L], ["深色高对比度", D]]) {
  console.log(`\n### ${name}`);
  const row = (label, fg, bg, need) =>
    console.log(`${label}: ${cr(fg, bg).toFixed(2)} (门槛 ${need})`);
  row("正文 vs --bg", P.text, P.bg, "7");
  row("正文 vs --bg-elevated", P.text, P.elevated, "7");
  row("正文 vs --bg-inset", P.text, P.inset, "7");
  row("次要 vs --bg", P.secondary, P.bg, "4.5");
  row("次要 vs --bg-elevated", P.secondary, P.elevated, "4.5");
  row("三级 vs --bg-elevated", P.tertiary, P.elevated, "4.5");
  row("装饰 vs --bg-elevated", P.faint, P.elevated, "4.5");
  row("--border vs --bg", P.border, P.bg, "3");
  row("--border vs --bg-elevated", P.border, P.elevated, "3");
  row("--border-strong vs --bg", P.borderStrong, P.bg, "3");
  row("--border-strong vs --bg-elevated", P.borderStrong, P.elevated, "3");
  row("--accent vs --bg", P.accent, P.bg, "4.5");
  row("--ring vs --bg", P.ring, P.bg, "3");
  row("--ring vs --bg-elevated", P.ring, P.elevated, "3");
  row("--ring vs --bg-hover", P.ring, P.hover, "3");
  row("--success vs --bg", P.success, P.bg, "4.5");
  row("--warning vs --bg", P.warning, P.bg, "4.5");
  row("--danger vs --bg", P.danger, P.bg, "4.5");
  P.cat.forEach((c, i) => row(`--cat-${i + 1} vs --bg-elevated`, c, P.elevated, "3"));
  P.chart.forEach((c, i) => row(`--chart-${i + 1} vs --bg-elevated`, c, P.elevated, "3"));
  P.chartSoft.forEach((c, i) => row(`--chart-${i + 1}-soft vs --bg-elevated`, c, P.elevated, "面积底"));
  row("正文 vs --accent-soft", P.text, P.accentSoft, "4.5");
  row("正文 vs --warning-soft", P.text, P.warningSoft, "4.5");
  row("正文 vs --danger-soft", P.text, P.dangerSoft, "4.5");
  row("正文 vs --success-soft", P.text, P.successSoft, "4.5");
  row("环形强调色 vs --accent-soft", P.accent, P.accentSoft, "4.5");
}
```

### 3.3 实测结果（浅色高对比度）

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| 正文 `--text` vs `--bg` | `#000000` | `#ffffff` | **21.00** | 7 |
| 正文 vs `--bg-elevated` | `#000000` | `#ffffff` | **21.00** | 7 |
| 正文 vs `--bg-inset` | `#000000` | `#eef1f5` | **18.54** | 7 |
| 次要 `--text-secondary` vs `--bg` | `#1f2b3a` | `#ffffff` | **14.34** | 4.5 |
| 次要 vs `--bg-inset` | `#1f2b3a` | `#eef1f5` | **12.65** | 4.5 |
| 三级 `--text-tertiary` vs `--bg-elevated` | `#33414f` | `#ffffff` | **10.45** | 4.5 |
| 三级 vs `--bg-inset` | `#33414f` | `#eef1f5` | **9.22** | 4.5 |
| 装饰 `--text-faint` vs `--bg-elevated` | `#4a5866` | `#ffffff` | **7.29** | 4.5 |
| `--border` vs `--bg` | `#6b7280` | `#ffffff` | **4.83** | 3 |
| `--border` vs `--bg-inset` | `#6b7280` | `#eef1f5` | **4.27** | 3 |
| `--border-strong` vs `--bg` | `#3f4854` | `#ffffff` | **9.27** | 3 |
| `--border-strong` vs `--bg-inset` | `#3f4854` | `#eef1f5` | **8.18** | 3 |
| `--accent` vs `--bg`（链接文字） | `#0b3f9c` | `#ffffff` | **9.52** | 4.5 |
| `--accent-hover` vs `--bg` | `#062c73` | `#ffffff` | **13.00** | 4.5 |
| `--ring` vs `--bg`（焦点环） | `#0b3f9c` | `#ffffff` | **9.52** | 3 |
| `--ring` vs `--bg-inset` | `#0b3f9c` | `#eef1f5` | **8.41** | 3 |
| `--ring` vs `--bg-hover`（选中行底） | `#0b3f9c` | `#e7ecf2` | **8.02** | 3 |
| `--success` vs `--bg` | `#0a5a33` | `#ffffff` | **8.32** | 4.5 |
| `--warning` vs `--bg` | `#7a4f00` | `#ffffff` | **7.13** | 4.5 |
| `--danger` vs `--bg` | `#a11208` | `#ffffff` | **8.06** | 4.5 |
| `--on-ink` vs `--ink` | `#ffffff` | `#000000` | **21.00** | 7 |
| `--cat-wait` vs `--bg-elevated` | `#4b5563` | `#ffffff` | **7.56** | 3 |
| `--cat-direct` vs `--bg-elevated` | `#005b8f` | `#ffffff` | **7.26** | 3 |
| `--cat-delegated` vs `--bg-elevated` | `#a33d00` | `#ffffff` | **6.51** | 3 |
| `--cat-compute` vs `--bg-elevated` | `#00705a` | `#ffffff` | **6.06** | 3 |
| `--cat-user` vs `--bg-elevated` | `#9c2f6f` | `#ffffff` | **6.89** | 3 |
| `--cat-workflow` vs `--bg-elevated` | `#4b21a8` | `#ffffff` | **10.09** | 3 |
| `--chart-1…6` vs `--bg-elevated` | 逐条 | `#ffffff` | **7.82 / 7.25 / 6.88 / 6.92 / 7.75 / 7.76** | 3 |
| `--chart-1-soft…6-soft` vs `--bg-elevated` | 逐条 | `#ffffff` | **1.38 / 1.38 / 1.38 / 1.38 / 1.38 / 1.37** | 面积底（§3.5 豁免） |
| 正文 vs `--accent-soft` | `#000000` | `#d7e2fb` | **16.16** | 4.5 |
| `--accent` vs `--accent-soft` | `#0b3f9c` | `#d7e2fb` | **7.33** | 4.5 |
| 正文 vs `--success-soft` | `#000000` | `#d5ecdf` | **16.89** | 4.5 |
| 正文 vs `--warning-soft` | `#000000` | `#f7e6c4` | **17.07** | 4.5 |
| 正文 vs `--danger-soft` | `#000000` | `#fbdbd8` | **16.23** | 4.5 |
| 选中滑块 `--bg-subtle` vs 凹槽 `--bg-inset` | `#ffffff` | `#eef1f5` | **1.13** | 靠 §4.4 的 1px 描边补到 8.18 |
| 悬停台阶 `--bg-hover` vs `--bg` | `#e7ecf2` | `#ffffff` | **1.19** | 状态底（§3.4） |
| 按下台阶 `--bg-active` vs `--bg` | `#d8e0ea` | `#ffffff` | **1.33** | 状态底（§3.4） |

### 3.4 实测结果（深色高对比度）

| 组合 | 前景 | 底色 | 比值 | 门槛 |
| --- | --- | --- | --- | --- |
| 正文 `--text` vs `--bg` | `#ffffff` | `#000000` | **21.00** | 7 |
| 正文 vs `--bg-elevated` | `#ffffff` | `#1a1a1a` | **17.40** | 7 |
| 正文 vs `--bg-inset` | `#ffffff` | `#000000` | **21.00** | 7 |
| 次要 `--text-secondary` vs `--bg` | `#dcdcdc` | `#000000` | **15.31** | 4.5 |
| 次要 vs `--bg-elevated` | `#dcdcdc` | `#1a1a1a` | **12.69** | 4.5 |
| 三级 `--text-tertiary` vs `--bg-elevated` | `#c4c4c4` | `#1a1a1a` | **9.98** | 4.5 |
| 装饰 `--text-faint` vs `--bg-elevated` | `#a8a8a8` | `#1a1a1a` | **7.32** | 4.5 |
| `--border` vs `--bg` | `#767676` | `#000000` | **4.62** | 3 |
| `--border` vs `--bg-elevated` | `#767676` | `#1a1a1a` | **3.83** | 3 |
| `--border-strong` vs `--bg` | `#9e9e9e` | `#000000` | **7.84** | 3 |
| `--border-strong` vs `--bg-elevated` | `#9e9e9e` | `#1a1a1a` | **6.50** | 3 |
| `--accent` vs `--bg`（链接文字） | `#8ab4ff` | `#000000` | **10.05** | 4.5 |
| `--accent-hover` vs `--bg` | `#b9d0ff` | `#000000` | **13.53** | 4.5 |
| `--ring` vs `--bg`（焦点环） | `#8ab4ff` | `#000000` | **10.05** | 3 |
| `--ring` vs `--bg-elevated` | `#8ab4ff` | `#1a1a1a` | **8.33** | 3 |
| `--ring` vs `--bg-hover`（选中行底） | `#8ab4ff` | `#262626` | **7.24** | 3 |
| `--success` vs `--bg` | `#6ee7a0` | `#000000` | **13.60** | 4.5 |
| `--warning` vs `--bg` | `#ffc75e` | `#000000` | **13.58** | 4.5 |
| `--danger` vs `--bg` | `#ff9d94` | `#000000` | **10.50** | 4.5 |
| `--on-ink` vs `--ink` | `#000000` | `#ffffff` | **21.00** | 7 |
| `--cat-wait` vs `--bg-elevated` | `#c0c0c0` | `#1a1a1a` | **9.57** | 3 |
| `--cat-direct` vs `--bg-elevated` | `#6cb6ff` | `#1a1a1a` | **8.10** | 3 |
| `--cat-delegated` vs `--bg-elevated` | `#ff9a4d` | `#1a1a1a` | **8.27** | 3 |
| `--cat-compute` vs `--bg-elevated` | `#3fd39a` | `#1a1a1a` | **9.11** | 3 |
| `--cat-user` vs `--bg-elevated` | `#ff9ecb` | `#1a1a1a` | **9.12** | 3 |
| `--cat-workflow` vs `--bg-elevated` | `#b795ff` | `#1a1a1a` | **7.26** | 3 |
| `--chart-1…6` vs `--bg-elevated` | 逐条 | `#1a1a1a` | **8.26 / 9.57 / 10.58 / 12.07 / 8.52 / 9.01** | 3 |
| `--chart-1-soft…6-soft` vs `--bg-elevated` | 逐条 | `#1a1a1a` | **1.96 / 1.96 / 1.95 / 1.96 / 1.95 / 1.95** | 面积底（豁免） |
| 正文 vs `--accent-soft` | `#ffffff` | `#16264a` | **14.89** | 4.5 |
| `--accent` vs `--accent-soft` | `#8ab4ff` | `#16264a` | **7.13** | 4.5 |
| 正文 vs `--success-soft` | `#ffffff` | `#0d2a1b` | **15.39** | 4.5 |
| 正文 vs `--warning-soft` | `#ffffff` | `#2e230a` | **15.43** | 4.5 |
| 正文 vs `--danger-soft` | `#ffffff` | `#331412` | **16.81** | 4.5 |
| 选中滑块 `--bg-subtle` vs 凹槽 `--bg-inset` | `#121212` | `#000000` | **1.12** | 靠 §4.4 的 1px 描边补到 7.84 |
| 悬停台阶 `--bg-hover` vs `--bg` | `#262626` | `#000000` | **1.39** | 状态底（豁免） |
| 按下台阶 `--bg-active` vs `--bg` | `#343434` | `#000000` | **1.69** | 状态底（豁免） |

### 3.5 四条豁免（每条都有数字与理由，不是「就这样吧」）

1. **`-soft` 面积底**（浅 1.37–1.38 / 深 1.95–1.96）。它们是柱、面积、热力格的大面积填充，
   **边界与读数由实色描边和实色文字给**（同一批图表画法在 `tokens.css` 顶部就写明了
   「大面积填充只允许 -soft，实色只给描边、点、小徽标」），所以不适用 3:1。取值的依据是
   **与现状同一档**：浅色现状（`rgba(solid, 0.24)` 叠白底）是 1.32–1.41，本轮取 1.37–1.38；
   深色现状（`rgba(solid, 0.30)` 叠 `#14161a`）是 1.79–2.05，本轮取 1.95–1.96。
   从半透明改成不透明之后的实际好处是**比值不再随叠加底漂移**——现在它只由令牌值决定。
2. **状态底 `--bg-hover` / `--bg-active`**（浅 1.19 / 1.33，深 1.39 / 1.69）。WCAG 的 3:1
   针对「识别控件与状态所必需的信息」；这里的悬停/按下底是**冗余**通道（同一状态另有
   `--border` 与焦点环两个信号），所以不设 3:1。两块都**高于**现状（浅 1.02 / 1.10，
   深 1.23 / 1.41），属于「更明显但仍不喧宾夺主」的一档。
3. **`--ansi-0…15` 与 `--code-*`：不覆盖，但要证明换底之后不会变差**。
   实测：浅色高对比度的 `--bg-elevated` 与浅色主题同为 `#ffffff`，ANSI 16 档最低 **4.52**、
   代码高亮最低 **4.87**，与原校验逐字相同；深色高对比度的 `--bg-elevated` 是 `#1a1a1a`
   （比原 `#1a1d21` 更暗），ANSI 最低从 **4.50 升到 4.63**、代码高亮从 **4.50 升到 4.64**。
   也就是说这两套「别人的颜色」在换挡后只会更好读。**代价**：深色高对比度的 `--bg-elevated`
   被这条锁死在 `#1a1a1a` 而不能再亮——这就是 §2.3 那一行的由来，改动它必须重跑本条实算。
4. **`--shadow-*` 与 `--overlay` 不覆盖**。阴影在纯白/纯黑上本来就不构成边界，高对比度下
   层级改由 `--border` / `--border-strong` 承担（浅 4.83 / 9.27，深 4.62 / 7.84）；遮罩是
   「压暗背景」的量，不是内容色，不参与上表任何门槛。**已知后果**：深色高对比度下浮层与
   页面底色同为黑，浮层的分离完全靠 `--border-strong`（7.84:1）——这是刻意的，
   文档流内的层级语言（背景台阶）在深色高对比度下本来就被拆掉了。

---

## 4. 焦点环

### 4.1 统一做法（一处换挡，30 个选择器一行不改颜色）

**结论先写**：颜色**零改动**——环色只有 `--ring` 与 `--accent` 两个来源，两块高对比度令牌表
已经把这两个令牌换成实色高比值（浅 `#0b3f9c` 9.52:1 / 深 `#8ab4ff` 10.05:1），
于是 30 个选择器全部自动拿到高对比环。**不加任何 `[data-contrast="high"] :focus-visible`
覆盖规则**——那会与 CSS Modules 的 `.foo:focus-visible` 打特异性官司（0,2,0 对 0,2,0，
胜负取决于打包顺序），还会把 4 条 `outline: none` 的竖条变体与 3 条 `-2px` 内嵌变体一起打坏。

**要改的只有「形」**：在 `:root` 新增三个令牌，把 22 条 `outline` 规则里的宽度与偏移
换成令牌；高对比度块只覆盖这三个令牌的值。

```css
/* :root 里新增（照 --font-scale 的位置，放在字号令牌之后） */
  /* 焦点环的几何：颜色只有 --ring 与 --accent 两个来源（与主题无关地复用），
     宽度与偏移走这三个令牌——高对比度只改令牌值，30 处 :focus-visible 选择器
     一行都不用动。--focus-ring-inset 是「环画在控件内部」那五处（全宽输入框、
     整行按钮）用的负偏移。 */
  --focus-ring-width: 2px;
  --focus-ring-offset: 1px;
  --focus-ring-inset: -2px;
```

| 现状（逐类 grep 得来） | 处数 | 高对比度处置 |
| --- | --- | --- |
| `outline: 2px solid var(--ring)` + `outline-offset: 1px` | 3（`global.css`、`Button`、`TextInput`） | `2px` → `var(--focus-ring-width)`；`1px` → `var(--focus-ring-offset)` |
| `outline: 2px solid var(--accent)` + `outline-offset: 1px` | 11 | 同上 |
| `outline: 2px solid var(--accent)` + `outline-offset: 2px` | 3（`ContextView`、`ErrorTrendChart`、`ParseCoverageChip` 的 `.chip`） | 只换宽度；**偏移保持字面量 2px**（见 §4.5） |
| `outline: 2px solid var(--accent)` + `outline-offset: -2px` | 5（`SearchPalette` 的 `.input`、`ChangedFilesView` 三条、`ErrorEventList` 的 `.row`） | `2px` → `var(--focus-ring-width)`；`-2px` → `var(--focus-ring-inset)` |
| `outline: none` + `box-shadow: inset 2px 0 0 var(--accent)`（左缘竖条） | 焦点指示共 7 条规则，其中 4 条只有竖条（`RecordTable`、`LogView`、`TreeView`、`DroppedList`） | `inset 2px` → `inset var(--focus-ring-width)`（高对比度下 3px 竖条） |
| `SessionHeader` 的 `.readouts:focus-visible`（只改 `border-color` / `background`） | 1 | **不动**（见 §4.5） |
| `:focus-visible` 下的后代箭头提高（`.row:focus-visible .arrow`） | 2 | **不动**（它们不画环） |

高对比度下的观感：**3px 环 + 2px 底色间隙**。间隙是这套做法里最容易被忽略的一半，
下一节说明为什么它必须跟着一起加。

**容易混进这一批的另一类竖条**：全仓库 `box-shadow: inset 2px 0 0 var(--accent)` 共 14 处，
另外 7 处属于**选中态**（`.selected` / 展开行），不是焦点指示。这 7 处本轮**只让颜色跟着
`--accent` 换挡，宽度不动**——它们是「选中」语义，改宽度等于顺手改了一个不在本轮的交互语言。

### 4.2 为什么偏移要和宽度一起加（实算）

浅色高对比度下 `--ink` 是纯黑（主按钮的底），而 `--ring` 是深蓝 `#0b3f9c`。
两者直接相贴时的对比度只有 **2.21:1**——环压在黑按钮上等于把按钮「画大三像素」，
低视力用户分辨不出那是一圈焦点环。把 `outline-offset` 从 1px 提到 2px 之后，
环与控件之间留出 2px 的**页面底色**（浅色 21:1 / 深色 21:1），环的两侧边界因此都成立：
外侧 9.52:1（浅）/ 10.05:1（深），内侧由底色间隙 21:1 保证。这就是「宽度与偏移成对加」的原因。

内嵌变体（`--focus-ring-inset: -4px`）不需要间隙：那五处的底是输入框与整行的自身底色
（浅色白底 / 深色黑底），环与底天然是 9.52:1 / 10.05:1。`-4px` 与 3px 宽度配对的账：
环画在离边缘 4px 处、向外 3px，于是完整落在控件内部且与边线留 1px——
比 2px 宽度 + `-2px` 的现状（环贴着边线）更容易看清。

### 4.3 分段控件的选中态（本轮唯一的组件 CSS 例外）

实测选中的滑块与凹槽只有 **1.13:1（浅）/ 1.12:1（深）**，靠的是 `--shadow-sm` 与 600 字重；
阴影在两块高对比度底上都不构成边界。因此给选中项补一条 **1px `--border-strong` 描边**。

**画法用内描边 `box-shadow: inset 0 0 0 1px`，不用 `border`（维护者裁决）**。本节初稿写的是
`border: 1px solid` + `box-sizing: border-box` 保证外框不变，但这个前提不成立：`.item` 是
**内容自适应宽度**，`border-box` 只在显式给了宽高时保住外框，实线边框会把控件撑大
——实测 Chromium `60×36 → 62×38`、WebKit `58.55×36 → 60.55×38`，而
`inset 0 0 0 1px` 在同样两端跨档 `delta = 0`。若改用「基础态预留 1px 透明边框」来抵消，
会让**全站所有分段控件常驻 +2px**（顶栏、用量页 tablist、设置面板的每一档），
截图的既有几何判据全部要重基；接受 +2px 则直接破「高对比度只动颜色」这条红线。
所以裁决是内描边：保留原有的 `--shadow-sm`，只叠加一条 1px 内阴影。

```css
/* SegmentedControl.module.css，紧跟既有的选中态规则之后 */
/* 高对比度：阴影在纯白/纯黑上不构成边界，选中与未选中的分界改由 1px 内描边承担。
   用 inset 而不是 border：.item 是内容自适应宽度，border 会把外框撑大 2px。 */
:global([data-contrast="high"]) .item[aria-selected="true"],
:global([data-contrast="high"]) .item[aria-checked="true"] {
  box-shadow: var(--shadow-sm), inset 0 0 0 1px var(--border-strong);
}
```

- 分界从 **1.13 → 8.18**（浅，描边 vs 凹槽）/ **1.12 → 7.84**（深）。
- 特异性 (0,3,0) 压过既有选中态规则的 (0,2,0)，不依赖文件顺序。
- 外框尺寸不变（内描边不占布局，`min-height` 与居中文字照旧），所以 **几何断言必须仍然逐像素通过**——
  这是本轮验收里的一条硬断言（§8.4），也是「只动颜色」这句话的可验证形式。
- 副产物：顶栏与用量页的 `tablist` 分段在高对比度下也拿到同一条描边，
  「当前是哪个页面」在纯黑/纯白底上第一次有了边界。这是想要的。

### 4.4 不动的两处

1. **已带 2px 偏移的三处**（`ContextView.chartWrap`、`ErrorTrendChart.chartWrap`、
   `ParseCoverageChip.chip`）：它们本来就是环与控件之间有间隙的宽档，且其中两处是图表容器——
   偏移再加一档会撞到相邻区块（图表的容器就是它的可视边界）。高对比度下它们拿到
   3px 宽 + 2px 偏移，间隙照旧成立。
2. **`SessionHeader` 的 `.readouts:focus-visible`**：它没有环，靠 `border-color` 与
   `background` 双信号（既有一处刻意如此，避免在读数行外面再套一圈）。高对比度下
   这两个值分别变成 `--border`（4.83:1）与 `--bg-hover`（1.19 台阶），是一条**已有**的
   弱信号，本轮不改它的形状——把它改成环会动到读数行的几何（§1.3 红线）。
   如实记账：这一处在高对比度下仍然是最弱的一处焦点提示，留给后续的键盘可达性专项。

---

## 5. `prefers-contrast: more` 的默认语义

契约原文：「`prefers-contrast: more` 默认启用、用户显式选择优先（与主题跟随系统同款语义；
显式选过就以本地选择为准）」。落到代码上就是 **`resolveContrast` 的三步判定**。

### 5.1 判定顺序（`web/src/features/settings/contrast.ts`）

```
1. 存储优先：localStorage["cca-contrast"] 命中白名单 {"normal","high"} → 用它。
   （用户点过任何一档就算「显式选择」，此后系统偏好不再影响结果。）
2. 系统次之：未写 / 值非法 / 读抛异常 → matchMedia("(prefers-contrast: more)").matches
   为真则 high，否则 normal。
3. 环境兜底：matchMedia 不存在（jsdom、老引擎、SSR）→ normal。
```

**「显式选择」的边界写清楚**：在系统 `more` 的环境里，用户点「普通」，`cca-contrast` 就写上
`"normal"`，此后即使系统是 `more` 也停在普通。这不是 bug，是本条的**直接后果**——
该用户的选择比系统更具体。要改回跟随，清掉那个键即可（v1 不给控件加「跟随系统」第三档，
见 §9）。

### 5.2 模块接口（照 `fontScale.ts` 的形状，逐条对齐）

```ts
export const CONTRAST_KEY = "cca-contrast";
export const CONTRAST_MODES = ["normal", "high"] as const;
export type ContrastMode = (typeof CONTRAST_MODES)[number];
export const DEFAULT_CONTRAST: ContrastMode = "normal";

/** 白名单：未知值一律回落 normal（持久化里的值永远不可信）。 */
export function parseContrast(raw: unknown): ContrastMode;
/** 读过但可能没写：只认白名单，未写 / 非法 / 抛异常 → null（「没有显式选择」）。 */
export function readStoredContrast(storage?: Pick<Storage, "getItem">): ContrastMode | null;
/** 只读系统偏好，media 可注入，便于单测。 */
export function prefersHighContrast(media?: Pick<MediaQueryList, "matches">): boolean;
/** 三步判定的唯一出口（§5.1）。 */
export function resolveContrast(storage?, media?): ContrastMode;
export function loadContrast(storage?): ContrastMode;
/** 写根属性：high 时 setAttribute("data-contrast", "high")，normal 时 removeAttribute。 */
export function applyContrast(mode: ContrastMode, root?: Pick<HTMLElement, "dataset" | "removeAttribute">): void;
export function setContrast(mode: ContrastMode): void;   // 显式选择：落盘 + 应用 + 通知
export function initContrast(): ContrastMode;            // 启动一次：解析 → 应用 → 挂监听
export function subscribeContrast(listener: () => void): () => void;
export function getContrast(): ContrastMode;
export function useContrast(): ContrastMode;             // useSyncExternalStore
export function resetContrastForTest(mode?: ContrastMode): void;
```

两条实现细则：

- `applyContrast` 的普通档走 `root.removeAttribute("data-contrast")`（不是写 `"normal"`）——
  探针事实与真机断言都按「空串 = 普通」对账（§0.1）。
- `setContrast` 与 `setFontScale` 同款：值没变就不通知（避免无谓重渲染），落盘失败
  （storage 抛异常）不影响本次会话生效。

### 5.3 跟随系统的生命周期（只在一个状态下跟随）

```
initContrast():
  mode = resolveContrast()
  applyContrast(mode)
  若 typeof matchMedia === "function":
      media = matchMedia("(prefers-contrast: more)")
      media.addEventListener("change", () => {
        if (readStoredContrast() !== null) return;   // 用户显式选过 → 不再跟随
        applyContrast(resolveContrast());            // 仅跟随态下重解析并应用
      })
```

这条要**单独测**：① 无存储 + 系统 `more` → 应用 high；② 系统从 `more` 变成 `no-preference`
→ 回到普通；③ 用户点过 `普通` 之后，再把系统改成 `more` → **不动**。

### 5.4 预绘制脚本（`web/index.html`）

照 `--font-scale` 那段的形状，在**模块脚本之前**追加第三段 `try/catch` 内联脚本，
内容与 `resolveContrast` 的三步判定逐条对应：

```html
<!-- 预绘制对比度：与 --font-scale 同款。命中白名单才采用；没写过才看系统偏好。 -->
<script>
  (() => {
    const root = document.documentElement;
    try {
      const saved = localStorage.getItem("cca-contrast");
      if (saved === "high") { root.dataset.contrast = "high"; return; }
      if (saved === "normal") return;
      if (window.matchMedia("(prefers-contrast: more)").matches) {
        root.dataset.contrast = "high";
      }
    } catch {
      // storage / matchMedia 不可用时停在普通档：这与 resolveContrast 的兜底一致。
    }
  })();
</script>
```

注意：**必须是 `dataset.contrast` 赋值（等于 `data-contrast`），且只在 high 时赋值**；
写成 `root.dataset.contrast = "normal"` 会让「普通档无属性」这条契约失效，真机断言随之变假绿。

`web/src/App.tsx` 里紧跟 `initFontScale()` 调一次 `initContrast()`（同样带注释说明
「index.html 负责第一帧不闪，这里把内存 store 同步到同一档」）。

---

## 6. 设置面板那一节

### 6.1 位置与布局简图

放在 **「界面字号」之后、「提示词上限」之前**（面板内的**第二个**分区）。理由与字号那节相同：
这不只是「再加一个开关」，而是两节一组的「看得清」偏好；把对比度排到「软件更新」「本地归档」
之后，需要它的人要先滚过几段读不清的文字——那是自相矛盾。

```
设置浮层（既有骨架：--bg-elevated / --r-md / --shadow-md）
┌──────────────────────────────────────────────────────┐
│ 阈值设置                                          [×] │
│ 控制报告与日志表的规模，改动立即生效并保存在本机。    │
│ 界面字号                                ← 第一节（不改） │
│ [ 90% ][ 100% ][ 110% ][ 120% ][ 130% ]              │
│ 12:04:08 · LLM · claude-sonnet-4 · 3.00s             │
│ 提示词 17 / 输出 34 · 2.7% · 正常                     │
│ 界面对比度                              ← 本轮新增     │
│ 提高文字、边框与图形的对比度，不改字号与间距。默认跟随系统设置。 │
│ [      普通      ][     高对比度     ]  ← radiogroup  │
└──────────────────────────────────────────────────────┘
```

### 6.2 文案定稿（逐字照抄）

| 位置 | 原文 |
| --- | --- |
| 分区标题 | `界面对比度` |
| 说明句 | `提高文字、边框与图形的对比度，不改字号与间距。默认跟随系统设置。` |
| 档位 1 | `普通` |
| 档位 2 | `高对比度` |

**不加 `（默认）` 的视觉隐藏标记**（字号那节给 100% 加了，这节不加）：默认档取决于系统偏好，
在 `prefers-contrast: more` 的机器上「普通」并不是默认。把默认说清楚的责任交给说明句里那句
「默认跟随系统设置」。**不加 `title` 提示**（两档都能看得见、都可用，没有需要解释的禁用态）。

### 6.3 控件与可访问性

| 项 | 规定 |
| --- | --- |
| 形态 | 复用 `SegmentedControl`，`variant="equal"`（两项等分）、`role="radiogroup"` |
| 可访问名 | `ariaLabel="界面对比度"`——与可见标题**逐字相同**（同「界面字号」「启用本地归档」的约定：视觉名与朗读名不得分叉） |
| 状态 | 每项 `role="radio"` + `aria-checked`（`SegmentedControl` 在 `radiogroup` 模式下已如此，不额外写 `aria-selected`） |
| 键盘 | 组件自带：Tab 一次进 / 一次出，`←/→/↑/↓` 环绕切换并即时生效，`Home/End` 到首末档 |
| 焦点 | 切档后焦点停在新档位的按钮上（组件 `focusAt` 已实现）；不得重挂载控件——`AppShell` 里是 `settingsOpen ? <ThresholdsPanel /> : null`，store 更新不得换 `key` |
| live region | **不新增**。切档是用户直接操作且立即在屏幕上生效，`aria-checked` 的变化 AT 会自己播报；再加一个 `role="status"` 就是重复播报 |
| 确认框 | **不加**。可逆、非破坏、单点；对「已经看不清屏幕才来开对比度」的人是又一次阅读成本 |
| 预览 | **不做预览行**（字号那节有，因为它要展示「密度」）。对比度是全局即时效果，做一行样例只会造出「样例 vs 实际」两处真相 |

### 6.4 锚点与真机动作（与在途门禁逐字对齐）

| 用途 | 值 |
| --- | --- |
| 容器锚点（真机 `contrast_js` 的第一优先选择器） | `<div data-probe="contrast-group">`——包在分段控件外面 |
| 兜底选择器（第二优先） | `[role="radiogroup"][aria-label="界面对比度"]` |
| 真机动作 | `对比度=高` / `对比度=普通`（与 `字号=<档位>` 同一条动作协议，档位文字按 `indexOf(wanted) === 0` 前缀匹配，故 `高` / `普通` 即可） |
| 真机事实 | `contrast`：`document.documentElement.getAttribute('data-contrast') \|\| ''` |
| e2e 定位 | `page.locator('[data-probe="contrast-group"]')` 与 `getByRole("radiogroup", { name: "界面对比度" })` 二者皆可，推荐后者（可访问名本身是要验的东西之一） |

`字号=` 现有的实现是「全文档扫 `[role="radiogroup"] [role="radio"]` 再按文案匹配」，
新增的 2 枚 radio 文案是 `普通` / `高对比度`，与五个百分比档**不重叠**，所以既有动作不受影响；
反过来，新动作**必须**用 `contrast-group` 收窄作用域（在途 `contrast_js` 已如此实现）——
否则全文档扫描会先撞上字号那五档。这条要写进 PR。

### 6.5 CSS 落点

- 新增 `.preferenceSection { display: flex; flex-direction: column; gap: var(--sp-15); }`，
  把字号那节的 `.fontScaleSection` 一并换过来（两节共用同一条「一条偏好 + 一枚分段控件」骨架，
  三行声明重复两份不如一个名字；`.fontScaleSection` 只被 `ThresholdsPanel.tsx` 与
  `.module.css` 引用，测试里没有它，改名安全）。
- 说明句复用既有的 `.note`（`--fs-xs` + `--text-tertiary`）。
- **本节不新造颜色 / 高度 / 圆角 / 时长 / 间距字面量**，不覆写分段控件的内部样式。

---

## 7. 状态表

| 场景 | 根元素 | 设置面板 | 屏上效果 | 备注 |
| --- | --- | --- | --- | --- |
| 首启、系统无偏好、无存储 | 无 `data-contrast` | 「普通」`aria-checked="true"` | 浅色主题原样 | 默认态 |
| 首启、系统 `prefers-contrast: more`、无存储 | `data-contrast="high"` | 「高对比度」选中 | 首帧即高对比度 | 预绘制脚本负责第一帧；模块脚本只同步内存值 |
| 用户点「高对比度」 | `data-contrast="high"` + 落盘 `"high"` | 「高对比度」选中 | 全站换挡，焦点留在该档 | 不关面板、不移动焦点、不重置滚动 |
| 用户点「普通」 | 属性被**移除** + 落盘 `"normal"` | 「普通」选中 | 回到普通档 | 此后不再跟随系统（§5.1） |
| 跟随态下系统从 more 变 no-preference | 属性被移除 | 「普通」选中 | 回普通档 | 只在「没有显式选择」时发生 |
| 显式选过之后再改系统 | 不变 | 不变 | 不变 | 显式优先 |
| 切主题（light ↔ dark） | `data-contrast` 不变 | 不变 | 换到对应主题的高对比度表 | 两个块各自独立，不互相继承 |
| 存储不可用（隐私模式 / 抛异常） | 按系统偏好或普通 | 正常可选 | 本次会话生效 | 落盘失败不影响生效（同字号那节） |
| 存储里是未知值（如 `"max"`、`""`、`"normal "`） | 按系统偏好或普通 | 对照实际生效档选中 | 原样 | 白名单外一律当没写过 |

---

## 8. 验收矩阵（每条都能被断言）

### 8.1 令牌层（`web/src/styles/tokens.test.ts` 新增守卫）

- [ ] 两块选择器存在：`/^\[data-contrast="high"\] \{/m` 与
      `/^\[data-theme="dark"\]\[data-contrast="high"\] \{/m` 都能在**剥过注释**的
      `tokens.css` 里找到（复用文件顶部已有的注释剥离与 `block` 读取写法）。
      **坑**：现有的 `block(selector)` 用 `indexOf`，若写成 `block('[data-contrast="high"] {')`，
      它也会命中深色块选择器的尾巴（`[data-theme="dark"][data-contrast="high"] {` 里含这段子串）。
      守卫必须用**行首锚定**的正则取起点，并把浅色块写在深色块**之前**。
- [ ] 两块各自覆盖：`--text` / `--text-secondary` / `--text-tertiary` / `--bg` / `--bg-inset` /
      `--border` / `--border-strong` / `--accent` / `--ring` / `--success` / `--warning` / `--danger` /
      `--cat-wait…--cat-workflow`（6）/ `--chart-1…--chart-6`（6）/ `--chart-1-soft…--chart-6-soft`（6）。
- [ ] 两块的令牌名集合**逐字相同**（`[...dark]\sort()` 与 `[...light].sort()` 相等）：
      深色块漏一条、浅色多一条都会红——防「只改了一个主题」。
- [ ] 颜色形状：两块里凡名字匹配
      `^--(text|bg|border|accent|ring|ink|on-ink|success|warning|danger|cat-|chart-)` 的声明，
      值必须是 `#rrggbb`（6 位十六进制）。`rgba(` / `rgb(` / `color-mix(` / 关键字颜色一律红。
      `--shadow-*` / `--overlay` 不在其列（它们是层级语言，见 §3.5 第 4 条），
      但**建议也不写**（保持继承）。
- [ ] 尺寸禁令：两块里不得出现 `--fs-` / `--lh-` / `--sp-` / `--row-` / `--col-` /
      `--control-h` / `--topbar-h` / `--sidebar-w` / `--detail-w` / `--r-` / `--gauge-size` /
      `--scrollbar-size` / `--dur-`。`--focus-ring-*` 是**允许**的（§4.1）。
- [ ] 焦点环几何：`:root` 定义了 `--focus-ring-width: 2px` / `--focus-ring-offset: 1px` /
      `--focus-ring-inset: -2px`；两块各覆盖为 `3px` / `2px` / `-4px`。
- [ ] **算术守卫**（真算，不是文本匹配）：用文件里已有的 `luminance` / `contrast` 辅助，
      对两块各断言：`text/bg ≥ 7`、`text-secondary/bg ≥ 4.5`、`text-tertiary/bg-elevated ≥ 4.5`、
      `border/bg ≥ 3`、`border-strong/bg ≥ 3`、`ring/bg ≥ 3`、六个 `cat-*` 与六个 `chart-*`
      对 `bg-elevated` 各 `≥ 3`。取不到 6 位十六进制时给一条明确的失败消息
      （「高对比度块里 --border 不是 #rrggbb，算术守卫无法求值」）。
- [ ] 终端调色板跨档不回归：两块高对比度块里的 `--bg-elevated`（浅 `#ffffff` / 深 `#1a1a1a`）
      下，对应主题的 16 档 `--ansi-*` 全部 `≥ 4.5`（浅 4.52 / 深 4.63）。
      这条把 §2.3 里那个「上限」钉住：谁把深色高对比度的 elevated 调亮，它会先红。
- [ ] 焦点环回潮守卫（建议，扫源码）：遍历 `src/**/*.module.css` 与 `src/styles/global.css`，
      不得再有 `outline: 2px solid var(--ring|--accent)`、
      `outline-offset: 1px`、`outline-offset: -2px`、`inset 2px 0 0 var(--accent)` 的字面量
      （一律走 `var(--focus-ring-*)`）。仓库已有 `readdirSync` 扫 CSS 的先例
      （`features/usage/billingReadouts.test.ts`）。
- [ ] 尺寸未被顺手改：`--sp-2` / `--control-h` / `--topbar-h` / `--gauge-size` / `--col-time`
      的值与改动前逐字相同（一张「不许动的令牌」快照表）。

### 8.2 状态模块（`contrast.test.ts`，照 `fontScale.test.ts` 的形状）

- [ ] `parseContrast`：`"high"` / `"normal"` 命中；`"max"` / `"HIGH"` / `""` / `null` / `123` → `normal`。
- [ ] `readStoredContrast`：命中返回该值；未写 / 非法 / `getItem` 抛异常 → `null`（**不是** `normal`，
      两者语义不同：前者「没选过」，后者「选过普通」）。
- [ ] `resolveContrast`：① 存储 `high` + 系统 more → `high`；② 存储 `normal` + 系统 more → `normal`；
      ③ 无存储 + 系统 more → `high`；④ 无存储 + 系统 no-preference → `normal`；
      ⑤ 无存储 + `matchMedia` 缺失 → `normal`。
- [ ] `applyContrast("high", root)` → `root` 上出现 `data-contrast="high"`；
      `applyContrast("normal", root)` → 属性被**移除**（`hasAttribute` 为 false，不是留 `"normal"`）。
      两向都要测，只测一向会漏掉残属性。
- [ ] `setContrast`：落盘 + 应用 + 通知订阅者；同值不重复通知；storage 抛异常时不抛错且仍然生效。
- [ ] `index.html` 预绘制（JSDOM，照 `fontScale.test.ts` 的两条）：预置 `cca-contrast = "high"`
      → 根元素有属性且为 `high`；预置 `"max"`（非法）→ 根元素**没有**属性；预置无键但
      `beforeParse` 里把 `matchMedia` 打桩成 `matches: true` → 根元素有属性（系统跟随在首帧就生效）。

### 8.3 组件（`ThresholdsPanel.test.tsx` 新增 describe）

- [ ] `getByRole("radiogroup", { name: "界面对比度" })` 存在，恰有 2 项，文案依序 `普通` / `高对比度`。
- [ ] 默认（无存储、无系统偏好）：`普通` 的 `aria-checked="true"`、`高对比度` 为 `false`；
      根元素**没有** `data-contrast` 属性。
- [ ] 点「高对比度」：根元素 `data-contrast="high"`、`localStorage["cca-contrast"] === "high"`、
      该档 `aria-checked="true"`；点回「普通」→ 属性被移除、键为 `"normal"`。
- [ ] 容器上有 `data-probe="contrast-group"`，且它是「界面对比度」这一节的控件外框。
- [ ] 说明句逐字等于 §6.2 的原文（防有人改成「更深、更清晰」这类没有数字的话）。
- [ ] 它是面板内的**第二个**分区标题，位于「界面字号」之后、「提示词上限」之前
      （既有那条「界面字号是第一个」的断言保持不变）。
- [ ] 本节内 `[role="status"]` / `[role="alert"]` 计数为 0（不新增 live region）；
      交互后不出现新的 `role="dialog"`（无确认框）。
- [ ] 键盘：焦点在某一档上按 `ArrowRight` → 选中切换且 `document.activeElement` 是新的那一档；
      切换前后 radiogroup 是**同一个 DOM 节点**（`isSameNode`）。
- [ ] 视觉纪律：`ThresholdsPanel.module.css` 的本节规则里不出现颜色字面量、不出现 `px` 间距、
      不覆写 `:hover`；`SegmentedControl.module.css` 新增的高对比度规则只出现
      `inset 0 0 0 1px` 内描边与 `--border-strong`（维护者裁决，见 §4.3；不许带
      `border` / `padding` / `width` / `min-height`，也不许丢掉原有的 `--shadow-sm`）。

### 8.4 端到端（`web/e2e/contrast.spec.ts`，Chromium + WebKit，跑生产构建产物）

- [ ] **默认档**：打开设置 → 组存在、2 项、`普通` 选中；`document.documentElement.hasAttribute("data-contrast")` 为 false；
      `getComputedStyle(document.documentElement).getPropertyValue("--text").trim() === "#16181b"`（普通浅色的值）；
      无横向溢出（`scrollWidth <= clientWidth`）。
- [ ] **切到高对比度**：点「高对比度」→ 根元素属性 `high`；计算值 `--text` `#000000`、`--bg` `#ffffff`、
      `--border` `#6b7280`、`--ring` `#0b3f9c`；取一个用 `var(--text-tertiary)` 的可见元素，
      其 `color` 计算值为 `rgb(51, 65, 79)`；仍无横向溢出。
- [ ] **几何不变量**（这条是「只动颜色」的可验证形式）：切档前后，同一枚 `role="radio"` 按钮的
      `getBoundingClientRect()` 宽高**逐字相等**（±0.5px）；设置浮层自身的 `width` / `padding` 不变。
- [ ] **持久化**：`page.reload()` 后根元素仍 `high`、组里「高对比度」仍选中；
      再点「普通」→ 属性消失、`--text` 回 `#16181b`、`localStorage["cca-contrast"] === "normal"`。
- [ ] **跟随系统**：`await page.emulateMedia({ contrast: "more" })` + 清空存储 → 首屏根元素即 `high`、
      「高对比度」选中；点「普通」后 `await page.emulateMedia({ contrast: "no-preference" })`
      再 `{ contrast: "more" }`，根元素属性始终不存在（显式选择优先）。
- [ ] **深色高对比度**（可选但建议）：种下 `cca-theme=dark` + 切高对比度 → `--bg` `#000000`、
      `--text` `#ffffff`、`--bg-elevated` `#1a1a1a`；同时确认 130% 字号下无横向溢出（两条路径正交）。
- [ ] 顺手回归：既有 `font-scale.spec.ts` 与 `update-settings.spec.ts` 全绿（设置面板多了一节，浮层更高，
      既有用例若依赖「面板内第一个/最后一个控件」需改成按名取）。

### 8.5 真机门禁（`scripts/gui-test.sh` + `src-tauri/src/lib.rs`）

- [ ] 动作：`对比度=高` 插在 `字号=130%` **紧跟之后**（此后每个视图都在 130% + 高对比度下复验一遍），
      末尾在 `字号=100%` 之后加 `对比度=普通`（**清理**：WebKit 的 localStorage 不受 HOME 隔离，
      不恢复就把高对比度留给使用者的真实应用与下一次运行——同字号那轮的教训）。
- [ ] 判据：`label.startswith("对比度=")` → 目标 `高` 时 `data.contrast == "high"`；
      目标 `普通` 时 `data.contrast == ""`；同时把动作回执里 `已切界面对比度 <档>` 当作点击真的发生的证据
      （脚本侧已有收集 console 的通道）。
- [ ] **不新增几何判据**，理由写进脚本注释：高对比度只换颜色，**几何不变量必须逐条与普通档相同**——
      既有的横向溢出、会话行不裁字、表头 = 数据行、表盘有界、记录表末列可达、面板滚一次可达
      六类判定在高对比度下继续跑，它们本身就是「换挡没动尺寸」的断言。
- [ ] 真机**不新增**截图清单条目：`docs/screenshots/` 只重出设置面板那两张 × 两主题
      （`settings-*.png` 与 `settings-below-*.png`）——高对比度默认关闭，其余视图的截图不受影响；
      重出后要人工看图确认新那一节在两种主题下都读得清、按钮不挤行、分级不变。
- [ ] 真机**不做**的事：不去点导出、不去改系统偏好（改系统偏好会污染使用者的机器）；
      `prefers-contrast` 的跟随只在 e2e 用 `emulateMedia` 验。

---

## 9. 明确不做（三条 + 各自动机）

1. **导出文档（会话报告 / 用量快照）本轮不跟。** 它们是**独立的自包含文档**：各自的调色板
   内联在 `exportShell.ts` 与 `usageSnapshot.ts` 的 `<style>` 里，靠 `prefers-color-scheme`
   决定深浅——`[data-contrast]` 是**宿主文档**的属性，不跨文档，也不在导出时被读取。
   要让它们跟，得再建一套「导出高对比度调色板 + 打印矩阵」，而那两份文档的读者是**别人**
   （发出去的文件），对方看不出这台机器选的是哪一档。这是独立的一件事，留待后续 Issue。
2. **`forced-colors: active`（Windows 高对比度）本轮不处理。** 那条路径要求把全部颜色改写成
   系统色关键字（`Canvas` / `CanvasText` / `ButtonFace` / `Highlight`…），并且要保证**自绘图形**
   （折线、柱、占比条、热力格、表盘）在系统色下仍有边界——因为浏览器不会替 SVG 与
   `background` 填色做映射。它与「令牌层换挡」是两套机制，混在同一轮里写会让规则互相覆盖、
   而且无法用同一批评据验收。留待独立 Issue。
3. **不动任何尺寸类令牌**（§1.3 的三条理由）、**不给 `MonitorPage` 的 iframe 与导出 HTML 转发**
   （同字号那轮的边界：跨文档要另立协议）、**不加第三档「跟随系统」控件**（默认语义已经由
   `resolveContrast` 承担，多一个档位就多一个「当前到底跟不跟」的状态要解释）、
   **不做色觉障碍（色盲）档**（类别色已经整体按 Okabe-Ito 挑过，单独的色觉档是另一个主题）。

---

## 10. 实现者清单

按改动顺序，逐文件：

1. `web/src/styles/tokens.css`
   - `:root` 新增三个焦点环几何令牌（`--focus-ring-width: 2px` / `--focus-ring-offset: 1px` /
     `--focus-ring-inset: -2px`），位置紧跟字号令牌之后，注释写清「颜色只有 --ring / --accent 两个来源」。
   - 文件末尾按 §1.1 的顺序追加两块高对比度块（**浅色块在前**），代码逐字照 §2.1 / §2.2，
     并把 §2.3 的实算约束写进注释（尤其深色 `--bg-elevated` 那条上限）。
2. 焦点环的「形」替换（§4.1 的四类替换，共 26 条规则）：`global.css`、
   `components/Button.module.css`、`components/TextInput.module.css`、
   `features/search/SearchPalette.module.css`、`features/sessions/ContextView.module.css`、
   `features/sessions/ParseCoverageChip.module.css`、`features/sessions/CompactionPanel.module.css`、
   `features/sessions/ChangedFilesView.module.css`、`features/sessions/RecordTable.module.css`、
   `features/sessions/LogView.module.css`、`features/sessions/TreeView.module.css`、
   `features/sessions/DroppedList.module.css`、`features/sessions/SessionHeader.module.css`（不动，
   仅核对）、`features/usage/ErrorEventList.module.css`、`features/usage/ErrorTrendChart.module.css`、
   `features/usage/ToolCensusPanel.module.css`、`features/usage/ErrorRankList.module.css`、
   `features/usage/CompactionStatsPanel.module.css`、`features/usage/BillingWindowCard.module.css`。
3. `web/src/components/SegmentedControl.module.css`：追加 §4.3 的高对比度选中态描边
   （`:global([data-contrast="high"])` 前缀，只写 `border`）。
4. `web/src/features/settings/contrast.ts`（新）：§5.2 的全部导出 + §5.1 的三步判定 + §5.3 的监听。
5. `web/src/features/settings/contrast.test.ts`（新）：§8.2 全部条目。
6. `web/index.html`：追加 §5.4 的第三段预绘制脚本。
7. `web/src/App.tsx`：`initContrast()`（紧跟 `initFontScale()`）。
8. `web/src/features/settings/ThresholdsPanel.tsx`：新增 `ContrastSection`（位置、文案、锚点照 §6），
   插在 `<FontScaleSection />` 之后；`.fontScaleSection` 改名 `.preferenceSection` 并两节共用。
9. `web/src/features/settings/ThresholdsPanel.module.css`：`.preferenceSection`（三条声明）。
10. `web/src/features/settings/ThresholdsPanel.test.tsx`：§8.3 的九条。
11. `web/src/styles/tokens.test.ts`：§8.1 的十条守卫（含算术守卫与焦点环回潮扫描）。
12. `web/e2e/contrast.spec.ts`（新）：§8.4 的六条（Chromium + WebKit）。
13. `scripts/gui-test.sh`：CAPTURE_TARGETS 插 `对比度=高` 与末尾的 `对比度=普通` + §8.5 的判据。
    （`src-tauri/src/lib.rs` 的在途改动已就位，本轮只需核对锚点与动作名一致。）
14. 文档：`CHANGELOG.md`（`[Unreleased] → Added`，中文条目）、`README.md` / `README.zh-CN.md`
    的功能条目（双语）、`docs/USAGE.md` 的设置一节加「界面对比度」一段（写清「不改字号与间距」
    与「默认跟随系统」两条事实）。
15. `docs/screenshots/settings-*.png` 与 `settings-below-*.png` × 两主题重出（只这四张）。

**一句话**：这一轮的全部重量压在三个地方——**两块令牌表要逐条实算达标**（不是「更深、更清晰」）、
**焦点环的颜色零改动而形走令牌**（否则 30 个选择器会打一场特异性官司）、
**`prefers-contrast: more` 只在「没写过」时跟随**（写过了就以本机选择为准，两向都要清干净）。
三件事做完，「高对比度」才是一个真能用的档，而不是一张只在白底截图上好看的图。
