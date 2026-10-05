# 「本地归档」设计规格（Round K）

> 角色：UI/UX 产品设计师（桌面工具 / 数据可视化）
> 日期：2026-10-05 ｜ 状态：待工程评审 ｜ 面向读者：实现子 agent + 主会话验收者
> 范围（已锁定）：设置浮层新增「本地归档」一节（开关 + 一行状态读数 + 「立即归档」按钮）；
> 会话列表给归档来源的会话一个不喧哗的标记。**本文件只描述设计与断言，不改任何源码。**

## 0. 语境与现状

写前逐字读过：`web/src/styles/tokens.css`、`features/settings/ThresholdsPanel.tsx` + `.module.css`、
`features/sessions/SessionList.tsx` + `.module.css`、`features/usage/UsageOverviewPage.tsx`、
`features/usage/ProvenanceBadge.tsx` + `.module.css` + `provenance.ts`、
`components/`（`Button`/`TextInput`/`Icon`/`SegmentedControl`/`Skeleton`/`StatusToast`/`EmptyState`）、
`app/NotificationProvider.tsx`、`app/AppShell.tsx`（浮层挂载点与 z-index）、`lib/format.ts`、
`api/types.ts`（`FsBridge` 的能力边界）、`.trellis/workspace/liangyuxiang/design-critique.md`。

分支上已有纯逻辑 `web/src/features/archive/archiveIndex.ts`（未跟踪）。本设计**直接对齐它的形状**，不另起命名：

| 本设计要的东西 | 现成资产 | 怎么用 |
| --- | --- | --- |
| 状态读数三要素 | `ArchiveFootprint { count, bytes, lastArchivedAt }` | `archiveFootprint(index)` 直接喂读数行 |
| 谁需要归档 | `planArchive(sessions, index)` | 「立即归档」的待办 + 完成文案的两个数 |
| 增量判据 | `needsArchive`（mtime **或** size 变过） | 幂等基础，UI 不重写 |
| 归档来源的会话 | `archivedSessions(...)` 产出 `archived: true` | 列表标记**只**认这个布尔位 |
| 以源为准 | 该函数跳过源仍在扫描结果里的条目 | 标记只出现在「源已不存在」的行 |
| 缺的那一半 | `archiveStore.ts`（文件 I/O）**尚不存在** | 见 §7 |

已确立、不得违反：① 骨架中性灰、颜色只给数据；文档流内零阴影，阴影只给浮层。
② 主按钮用 `--ink`，强调色退出动作语义。③ 设置浮层是贴顶栏的 `--r-md` 浮动面板（无遮罩、
无焦点陷阱），不是 `--r-lg` 模态——新一节要长得像「阈值设置」的兄弟。④ 诚实标注
（`ProvenanceBadge` 的语言）：每个数字说清来源；「不联网、不动原始文件」必须在界面上**看得见**。

## 1. 信息架构与交互流

### 1.1 位置

「本地归档」是设置浮层里的第四节，DOM 排在「软件更新」之后，同构：`.sectionTitle` + `.note` + 控件区。
不加新浮层、不加新入口。建议（不强制）：DOM 加进 `ThresholdsPanel.tsx`、新类名进
`ThresholdsPanel.module.css`，复用既有 `.sectionTitle/.note/.field/.label/.control/.hint`；
只有「读数行」与「进度行」需要新类名。

### 1.2 状态机（开关开 → 首次归档 → 进度 → 完成）

```
[默认 OFF，index 空]
   │ 拨开开关
   ▼
[ON] 立即触发一次归档（首次＝全量：空 index 下 planArchive 全 pending）
   ├ pending 非空 ▶ [进行中] 读数行形态 C；逐文件复制并落 index
   │                 ├ 全成功 ▶ [完成] 读数行回形态 B + 播报「本次归档 N 个会话」
   │                 └ 失败   ▶ [失败] 见 §1.6
   └ pending 为空 ▶ [完成]「已是最新，无需归档」
```

- **首次即全量**：打开开关就是「开始为我保留这些记录」的意图，不做第二次点击才生效。
- **增量**：之后只用 `planArchive`，`needsArchive` 为真的才复制。
- **幂等**：重复点永远安全；已是最新时零复制、零改动。

### 1.3 重复点击与并发

- 进行中：按钮 `disabled` + `正在归档…` + `aria-busy="true"`；不得启动第二个任务（并发写同一个 index 会互相覆盖）。
- 完成后可再点，即一次增量，语义与首次相同。运行中把开关拨到 OFF **不中断**本次
  （半途停下无意义，且它幂等；跑完更干净），本次跑完后不再自动归档。

### 1.4 开关关掉时，归档数据怎么办：**保留**（判断与理由）

**判断：关闭只停止「今后的归档」；已归档的副本一律保留，列表标记照旧显示。**

1. 归档存在的唯一理由是活得比 `~/.claude` 久——源被清理后它就是那些会话**唯一的副本**；
   一个读作「停止自动备份」的开关顺手删掉历史，是文案与后果严重不符的破坏性行为。
2. 关闭的语义是偏好，不是删除；破坏性动作必须**显式命名**（一个写着「删除归档」的按钮 + 二次确认）。
3. 关掉就删会让列表凭空少东西（源已清理、只靠归档存在的会话会消失），在分析器里先被读成「我的数据出问题了」。
4. 实现也更安全：删除要新增破坏性 I/O（`FsBridge` 现在没有删除能力），保留则零新增。

落地：OFF 时读数行照常显示形态 B，hint 补一句 `关闭只停止后续归档，已归档的副本会保留。`；
「立即归档」`disabled`（`title="先开启本地归档"`）。「删除归档」不在本轮范围。

### 1.5 归档中切页面 / 关掉设置浮层

任务状态**必须住在 React 组件之外**（模块级 store，形如 `features/settings/thresholds.ts`）：
`AppShell` 是 `settingsOpen ? <ThresholdsPanel/> : null`，关掉浮层面板就卸载，状态放 `useState` 会当场丢，
再打开看到「什么都没发生」。切到用量 / 监控或关浮层：任务**继续跑**，不暂停；
回来显示进度或结果；列表标记随 index 逐条出现，不需要手动刷新。

### 1.6 失败（磁盘满 / 权限不足）

| 项 | 规定 |
| --- | --- |
| 位置 | 读数行**正下方**一行，`role="alert"`，`--danger`；就地，不弹新浮层 |
| 文案 | `归档失败：{原因}`（原因用桥返回的字符串原样拼，不吞不翻译） |
| 建议 | 原因含空间 / 权限关键词时按 §4 追加一句；判不出来就不加，不编 |
| 读数行 | 回退到上一次成功的形态 B——「已归档多少」仍是真话 |
| 按钮 / 开关 | 按钮回 `立即归档` 可重试；开关保持 ON（环境问题，不是用户改了偏好） |
| 已完成文件 | 保留（每文件独立落 index），重试是增量的，不从头再来 |
| 附加反馈 | 设置浮层无遮罩，toast（z-index 30 > 面板 20）可见，故同时发一条 error toast |

### 1.7 源文件仍在时以源为准

标记的唯一触发条件是 `session.archived === true`。`archivedSessions` 已跳过 `sourcePath` 仍在扫描结果里的条目，
所以**只要有源文件，行就不带标记**，读的字节也永远来自 `~/.claude`。UI 侧禁止用路径嗅探自行推断。

## 2. 视觉规格

### 2.1 布局简图

```
设置浮层 ThresholdsPanel（既有骨架，不改）：fixed；top calc(--topbar-h + --sp-2)；right --sp-4；
  z-index 20；width min(420px, calc(100vw - --sp-4*2))；--bg-elevated / --r-md / --shadow-md
┌──────────────────────────────────────────────────────────┐
│ 阈值设置                                      [×]        │ .header  h2 --fs-base/600
│ 控制报告与日志表的规模……                                 │ .note  --fs-xs/tertiary
│  …（阈值设置 / 计费窗口 / 软件更新 三节，本文不改）…      │
│ 本地归档                                ← .sectionTitle  │ --fs-base/600，margin-top --sp-3
│ Claude Code 会清理约 30 天前的会话；归档把副本留在本机，  │ .note
│ 让更早的记录仍能统计。                                    │
│ 启用本地归档    [ ]                     ← .field/.label  │ --fs-sm/600 + 原生 checkbox
│ 在本机复制，不联网，不改动 ~/.claude 的原始文件。        │ .hint  --fs-xs/tertiary
│ 已归档 128 个会话 · 上次归档 昨天 · 占用 3.2MB           │ .readout（新）role="status"
│ ── 1px --border ──                                       │ .actionRow 上边线
│ [立即归档]   正在归档 12/128 ▓▓▓▓▓▓░░░░░                │ Button secondary + .progress（新）
└──────────────────────────────────────────────────────────┘
```

会话行（既有 54px 行高不变）：

```
▌ 修复导出浮层的键盘陷阱   [归档]      ← .titleLine（新）flex gap --sp-1；strong --fs-base/600 + 徽标 --fs-xs
  2小时前 · 184KB · cc-analyzer        ← 既有 span  --fs-xs/tertiary tabular
```

### 2.2 用到的 token（逐项，全部已存在）

| 用途 | 变量 |
| --- | --- |
| 浮层底 / 描边 / 圆角 / 阴影 | `--bg-elevated`、`--border-strong`、`--r-md`、`--shadow-md`（全部沿用，不新增） |
| 分区标题 / 说明 / hint | 标题 `--fs-base`+`--lh-base`+`--text`（`margin-top: var(--sp-3)`）；`--fs-xs`+`--lh-xs`+`--text-tertiary`（说明与 hint） |
| 开关标签 / 读数行 | 标签 `--fs-sm`+`--lh-sm`+`--text`(600)；读数数值 `--text`(600)+`tabular-nums`；分隔符与文字 `--text-tertiary` |
| 读数行与按钮行的发丝线 | `--border`（`border-top`，沿用 `.footer` 画法） |
| 按钮 / 进度条 / 失败行 | `Button`（`secondary`，自带 `--control-h`/`--r-sm`/`--ring`）；原生 `<progress>` `height:4px` + `accent-color: var(--accent)`；`--danger`（配 `role="alert"`） |
| 列表徽标 | 底 `--bg-inset`、描边 `--border`、圆角 `--r-xs`、字 `--text-secondary`+`--fs-xs`+`--lh-xs` |
| 间距 / 时长 | 仅 `--sp-05/--sp-1/--sp-15/--sp-2/--sp-3/--sp-4`（不用 `--sp-5/--sp-6`）；`--dur-hover`+`--ease-in-out` 由 `Button`/行 hover 自带，本节不重写；入场沿用既有 `cca-enter` |

**新令牌：0 个。** Toggle 用原生 `<input type="checkbox">`（`:root` 已把 `accent-color` 指向 `--accent`），
与 `ThresholdsPanel` 里「启动时自动检查」逐字同款；不自造 switch 控件（`components/` 里没有 Switch，
造一个等于新开一种布尔控件的画法）。**没有新颜色、新高度、新圆角、新时长。**

### 2.3 分区与对齐

- 标题 / 说明 / 开关行：完全复用 `.sectionTitle` / `.note` / `.field`（label 在上、控件在下、hint 最下）。
  `.field` 现有 `gap: 4px` 是既有字面量（等于 `--sp-1`）；新节沿用该类不新增，若顺手改它，请改成 `var(--sp-1)`。
- 读数行：上下各 `--sp-2`，与按钮行之间用 `1px var(--border)` 上边线分开。
  **读数行不套 `--bg-inset` 底**：`--text-tertiary` 在 `--bg-inset` 上浅色主题只有 **4.30:1**（低于正文门槛），
  放在面板 `--bg-elevated` 上是 4.78:1（浅）/ 5.45:1（深），合格；同时省一层填充，颜色预算留给数据。
- 按钮行：`<Button>` 与进度条同行，`gap: var(--sp-2)`，左对齐（不是右对齐 footer——它是随时可点的执行按钮）。

### 2.4 状态（默认 / 悬停 / 进行中 / 完成 / 失败）

| 状态 | 视觉 | 断言点 |
| --- | --- | --- |
| 默认（OFF，未归档） | 开关未勾选；读数行形态 A；按钮 `disabled` | `checkbox.checked === false`；按钮 `disabled === true` |
| 悬停 | 交给组件：`Button:hover` 走 `--bg-hover` + 描边变 `--text-faint`。**本节 CSS 不写任何 `:hover`** | 新规则里不出现 `:hover` |
| 进行中 | 读数行形态 C；下方出现 `<progress>`；按钮 `正在归档…`+`disabled`+`aria-busy="true"` | `getByRole("progressbar")` 存在，`value`/`max` 随进度更新 |
| 完成 | 读数行回形态 B（数值更新）；live region 短暂播报完成文案后回形态 B | 完成后 `progressbar` 从 DOM 移除；读数匹配 `/已归档 \d[\d,]* 个会话/` |
| 已是最新 | 播报 `已是最新，无需归档`；按钮 2 秒内显示 `已是最新` 再回 `立即归档` | `pending.length === 0` 时零写调用 |
| 失败 | 读数行下方 `role="alert"` 一行 `--danger`；读数行保持形态 B；按钮可重试 | `getByRole("alert")` 文本以 `归档失败` 开头 |
| 徽标（列表） | `--bg-inset` 底 + `1px var(--border)` 描边 + `--r-xs`；`--fs-xs`、`--text-secondary` | 徽标 `height === 16px`，所在行高仍 `=== 54px` |

## 3. 列表标记的设计

### 3.1 结论：文字徽标，不是图标

选**文字徽标**，文案 `归档`。`Icon.tsx` 只有 6 个图标且没有 archive；加图标要扩 `IconName` + 画 SVG，
而项目对图标的规矩是「图标永远与旁边的文字同义」——行内孤零零一个图形没有 tooltip 的位置
（`title` 已被路径占用），还得让用户学第二个符号。徽标语言已经存在：`ProvenanceBadge` 就是
「细描边 + 小字 + `--r-xs` + `--bg-inset`」的文字小牌，复用即可，用户不用学新东西。

### 3.2 位置与 DOM

**标题行内、标题文字之后**，作为标题行唯一允许的第二个元素：

```jsx
<button type="button" className={styles.row} …>
  <span className={styles.titleLine}>
    <strong>{sessionTitle(session)}</strong>
    {session.archived ? (
      <span className={styles.archiveTag} title="来自本地归档副本">
        归档<span className={styles.srOnly}>，来自本地归档副本</span>
      </span>
    ) : null}
  </span>
  {…可选状态行…}
  <span className={styles.meta}>
    {formatRelativeTime(…)} · {formatBytes(…)} · {session.projectLabel}
  </span>
</button>
```

不放在：行首（会和选中竖条、未来的状态灯抢位置）、元信息行（那一行是时间 / 体积 / 项目，
加一个词就把它变成第二个语义层）。

### 3.3 为什么它不该抢注意力

- **会话列表里没有邻居可抢**：状态灯（`.dot` 8px 圆点）住在 `SessionHeader`（右主区），不在侧栏行内；
  类型徽标住在记录表 / 树 / 日志，也不在会话行。侧栏里可能被抢的只有标题、元信息行、分组头计数。
- **它是全中性的**：只用 `--bg-inset`/`--border`/`--text-secondary`，**不碰** `--success`/`--danger`/
  `--accent`/`--cat-*`。`--success` 已被状态灯占去表达「今天活跃」；标记若也用彩色，会被读成第二种状态灯——
  而「这份记录来自哪」是**来源**，不是**健康度**。
- **量级低一档**：`--fs-xs` + `--text-secondary`（不加粗）对标题的 `--fs-base` + 600 + `--text`；第一眼先落标题。
- **不可点、不参与交互**：无 hover、无 focus、不是 `<button>`，Tab 序列里不多出停靠点。

### 3.4 对比度依据（实测，非估算）

| 组合 | 浅色 | 深色 |
| --- | --- | --- |
| 徽标字 `--text-secondary` on 徽标底 `--bg-inset` | **7.08:1** | **10.27:1** |
| 读数行数字 `--text` / 小字 `--text-tertiary` on 面板 `--bg-elevated` | 17.79:1 / 4.78:1 | 15.08:1 / 5.45:1 |
| 失败行 `--danger` on 面板 `--bg-elevated` | 6.54:1 | 6.09:1 |

**形状靠描边，不靠填充**：`--bg-inset`(#f1f3f5) 与行底 `--bg-subtle`(#ffffff) 只差 **1.11:1**，
而浅色主题下 `--bg-hover` 与 `--bg-inset` **同值**——行一 hover 徽标底就完全消失。因此
`1px var(--border)` 是徽标唯一的形状信号，实现时必须保留（也是 `ProvenanceBadge` 既有画法）。

### 3.5 高度不变量（虚拟列表硬约束）

`SessionList.tsx` 的 `SESSION_ROW_HEIGHT = 54` 与 CSS `.sessionRow { height: 54px }` 互相镜像；
行内多一行内容会被 `overflow: hidden` 从底部切掉，并让虚拟滚动错位。因此徽标**内联进标题行**，
不能作为 `button` 的第四个 grid 子元素（会多出一行 grid row）。标题行 = `--lh-base`(20)（徽标 16 ≤ 20）；
20 + gap `--sp-05`(2) + 元信息 `--lh-xs`(16) = 38；38 + padding 8×2 = **54**。徽标 `height: var(--lh-xs)` 就是为这条服务。

> **选择器陷阱（最容易做错的一条）**：`SessionList.module.css` 有一条通配行内所有 `span` 的规则
> `.groups .sessionRow button span { color: var(--text-tertiary); font-size: var(--fs-xs) }`（特异性 `0,2,2`）。
> 直接给徽标写 `.archiveTag`（`0,1,0`）会被它盖掉；标题行的包装 `span` 也会被它染成灰色小字（连带把标题带灰）。
> 落地时把这条规则收窄到元信息行（`.meta`），徽标规则写成
> `.groups .sessionRow button .archiveTag, .groups .sessionRowWithStatus button .archiveTag`（`0,3,1` > `0,2,2`）。
> 这个坑在文件注释里已被记录过一次，不要重蹈。

## 4. 文案（所有用户可见字符串，逐条列全）

全部中文，读数用 `tabular-nums`；`{…}` 为占位符，`·` 是 U+00B7 中点（与 `SessionList` 元信息行同一分隔符）。

| 位置 | 文案 |
| --- | --- |
| 分区标题 | `本地归档` |
| 分区说明（`.note`） | `Claude Code 会清理约 30 天前的会话；归档把副本留在本机，让更早的记录仍能统计。` |
| 开关标题（`.label`，也是可访问名） | `启用本地归档` |
| 开关 hint（**信任文案，必须逐字实现**） | `在本机复制，不联网，不改动 ~/.claude 的原始文件。` |
| 开关关闭时的追加 hint | `关闭只停止后续归档，已归档的副本会保留。` |
| 读数行形态 A（未归档） | `尚未归档任何会话` |
| 读数行形态 B（已归档） | `已归档 {count} 个会话 · 上次归档 {相对时间} · 占用 {体积}` |
| 读数行形态 C（进行中） | `正在归档 {done}/{total} …` |
| 完成播报（确有复制 / 无待办） | `本次归档 {n} 个会话` / `已是最新，无需归档` |
| 按钮：默认 / 进行中 / 刚完成 / 关闭时 | `立即归档` / `正在归档…` / `已是最新`（仅无待办，约 2 秒后回退）/ 文案不变但 `disabled`，`title="先开启本地归档"` |
| 错误：通用 / 空间不足 / 权限不足 | `归档失败：{原因}` / `归档失败：{原因} 请清理磁盘空间后重试。` / `归档失败：{原因} 请检查归档目录的读写权限后重试。` |
| 列表徽标 | 可见文字 `归档`；`title` 与屏幕阅读器补充文字 `来自本地归档副本` |

读数占位符口径：`{count}` 用 `toLocaleString("en-US")`；`{相对时间}` 用既有 `formatRelativeTime`；
`{体积}` 用既有 `formatBytes`；读数整行 `title` 给出精确时间 `formatDateTime(lastArchivedAt)` 与归档根目录路径。

## 5. 无障碍

### 5.1 开关

| 项 | 规定 |
| --- | --- |
| 元素 / role | 原生 `<input type="checkbox">`（隐式 role `checkbox`），与「启动时自动检查」同款。**不写 `role="switch"`**：本应用的布尔控件语言就是 checkbox，单点改 switch 会造出第二种画法 |
| 可访问名 | 由包裹的 `<label>` 提供，等于 `启用本地归档`；**不要**再写 `aria-label` 覆盖它，否则视觉文字与朗读文字分叉 |
| 状态 / 焦点 | `checked` 反映真实开关态，不靠样式类模拟；焦点环交给全局 `:focus-visible`，本节不重写 |

### 5.2 进度与结果的播报

| 项 | 规定 |
| --- | --- |
| 进度与完成 | 读数行（形态 A/B/C）是**唯一**的 `role="status" aria-live="polite"` 容器；运行中播报形态 C，切回 B 播报最新数字，完成瞬间内容为 §4 的短句，约 2 秒后回形态 B |
| 原生进度条 | `<progress value={done} max={total}>`（隐式 `role="progressbar"`，自带 `aria-valuenow`）是**视觉**补充；文字读数才是朗读主路径，不要让它成为唯一进度来源 |
| 失败 | 单独一行 `role="alert"`（隐式 assertive），文本以 `归档失败` 开头；它本身就是 live region，**不再**套一层 |
| 不重复播报 | 同一事件只由一个容器播报；toast 与就地 alert 内容相同可接受（一个给 AT、一个给视觉），但读数行不得再复述失败 |

### 5.3 焦点顺序与二次确认

- 设置浮层**不是模态**（无遮罩、无焦点陷阱）：Tab 按 DOM 顺序走 `… 软件更新 → 启用本地归档 → 立即归档 →` 页面其余部分。
- 归档开始 / 结束**不移动焦点**（后台任务抢焦点会打断用户）；按钮 `disabled` 时退出 Tab 序列是可接受的——
  它上面紧邻的开关就是启用它的唯一前置动作。
- **二次确认：不需要**。开关两个方向都可逆、非破坏（不删、不动原始文件），滥用确认只会制造无人阅读的噪音。
  反过来立一条底线：将来若加「删除归档」，必须是 `Button variant="danger"` + 确认弹层，并明说
  「删除不可恢复，且源文件已被清理的会话将消失」。本轮不做该动作。

## 6. 验收清单（每条都能被断言）

### 6.1 入口与结构

- [ ] 设置浮层内存在标题为 `本地归档` 的 `.sectionTitle`，且 DOM 中位于「软件更新」一节之后
- [ ] 该节是设置浮层（`aria-label="阈值设置"`）的后代，**不产生**第二个 `role="dialog"`
- [ ] 设置浮层内不存在 `role="switch"` 元素（开关是 checkbox）

### 6.2 开关

- [ ] `getByRole("checkbox", { name: "启用本地归档" })` 存在，初始 `checked === false`
- [ ] 勾选后 `checked === true`，并触发一次归档（mock 桥收到的待复制集合 = `planArchive` 对空 index 的 pending 全集）
- [ ] 该 label 的 `textContent` 含 `在本机复制，不联网，不改动 ~/.claude 的原始文件。`（逐字，含结尾句号）
- [ ] 该 label 的 `textContent` 含 `关闭只停止后续归档，已归档的副本会保留。`
- [ ] 关闭开关时不发生任何删除 / 卸载调用（mock 桥的方法调用集合里没有删除类方法；`FsBridge` 本身也不提供删除）

### 6.3 读数行三种形态

- [ ] `count === 0 && lastArchivedAt === null` 时读数行文本 `=== "尚未归档任何会话"`
- [ ] `count === 128`、`lastArchivedAt` 为昨天、`bytes === 3355443` 时文本匹配 `/^已归档 128 个会话 · 上次归档 .+ · 占用 3\.2MB$/`
- [ ] 运行中文本匹配 `/^正在归档 \d+\/\d+ …$/`
- [ ] 读数行是 `role="status"`，且全节内 `[role="status"]` 数量为 1（不含 toast 容器）
- [ ] 面板宽 420px 时读数行只有一行：`readout.getClientRects().length === 1`
- [ ] 三个数值各自 `font-variant-numeric === "tabular-nums"` 且 `font-weight === "600"`
- [ ] `title` 等于 `formatDateTime(lastArchivedAt)` 的结果，且包含归档根目录路径

### 6.4 按钮与状态

- [ ] 默认态文本 `立即归档`、`disabled === false`；开关 OFF 时 `disabled === true` 且 `title === "先开启本地归档"`
- [ ] 运行中文本 `正在归档…`、`disabled === true`、`aria-busy === "true"`
- [ ] 运行中 `getByRole("progressbar")` 存在，`value` 随每个文件完成递增、`max === total`；完成后 `queryByRole("progressbar") === null`
- [ ] 本次 `pending.length === 0` 时按钮 2 秒内文本为 `已是最新`，之后回到 `立即归档`
- [ ] 连续两次点击且 index 已是最新时，第二次运行**零**写调用，读数行文本 `=== "已是最新，无需归档"`

### 6.5 失败路径

- [ ] 桥抛「no space left on device」时出现 `getByRole("alert")`，文本以 `归档失败：` 开头且含 `请清理磁盘空间后重试。`
- [ ] 桥抛权限错误时 `[role="alert"]` 文本含 `请检查归档目录的读写权限后重试。`
- [ ] 失败后按钮 `disabled === false` 且文本 `立即归档`；开关仍 `checked === true`
- [ ] 失败后读数行仍是形态 B 文本（不是失败文案），且 `[role="progressbar"]` 不存在
- [ ] 失败后 `notify` 被调用一次且 tone === `"error"`

### 6.6 运行中切页面 / 关浮层

- [ ] 运行中卸载 `ThresholdsPanel`（`rerender` 去掉该节点）后，mock 桥仍被继续调用到完成
- [ ] 重新挂载后读数行显示完成后的形态 B（模块级 store 保留了结果）
- [ ] 运行中切换 `AppShell` 的 tab（analyzer → usage → monitor）不调用任何取消接口
- [ ] 运行中把开关拨到 OFF 后本次仍跑完（桥调用次数与不关闭时一致），且之后不再自动触发

### 6.7 列表标记

- [ ] `{ archived: true }` 的行内存在 `getByText("归档")`；`{ archived: false }` 的行内不存在
- [ ] 归档行与非归档行的 `getBoundingClientRect().height` 严格相等，且（无状态行时）`=== 54`
- [ ] 徽标 `getBoundingClientRect().height === 16`，且 `badgeRect.right <= buttonContentRect.right`、行 `scrollWidth <= clientWidth`
- [ ] DOM 结构成立：`button > .titleLine > strong + .archiveTag`
- [ ] 徽标 computed `color === --text-secondary` 解析值、`font-size === "11px"`（证明未被通配 `span` 规则命中）
- [ ] 纯逻辑断言：`archivedSessions(index, new Set([sourcePath]))` 不返回该条目（源文件仍在 ⇒ 不带 `archived` 位）

### 6.8 令牌与几何纪律

- [ ] 新增 / 修改的 `.module.css` 中不出现颜色字面量（`#`、`rgb(`、`hsl(`）与 `border-radius`/`transition-duration` 的 `px`/`ms` 字面量
- [ ] 所有 `padding`/`gap`/`margin` 值形如 `var(--sp-*)`、`0` 或 `auto`
- [ ] 本节不引入 `box-shadow`（文档流内零阴影）、不使用 `--r-lg`
- [ ] 徽标 `border-radius` computed `=== "2px"`（`--r-xs`），设置面板仍是 `--r-md`

## 7. 工程依赖与「不做」清单

### 7.1 需要补齐 / 新增

1. **`archiveStore.ts`**（缺的那一半）：文件 I/O + 模块级任务 store。逐个文件复制、**每完成一个就落盘 index**
   （失败可续跑、进度不空转）；不提供删除能力；状态（idle/running/done/error + done/total）存在模块作用域，
   面板卸载后仍可读，暴露成 `useArchive()` 之类的 hook。
2. **`SessionMeta` 增加 `archived?: boolean`**：`archivedSessions()` 已产出该字段，类型必须跟上（当前 `metadataCache.ts` 没有）。
3. **`SessionList` 增加 `.titleLine` / `.meta` 类并收窄通配 `span` 选择器**（见 §3.5）。
4. **设置浮层新一节**：DOM 加进 `ThresholdsPanel.tsx`，新类名进 `ThresholdsPanel.module.css`。

### 7.2 明确不做（写进 PR 描述）

- 不做「删除归档 / 清空归档」（见 §5.3 底线）；不做开关的二次确认。
- 不联网；不改动 `~/.claude` 下任何文件（只读源文件 + 写 app data 目录）。
- 不做加密 / 压缩 / 自定义归档目录 / 容量上限 / 按项目选择性归档。
- 不把归档目录做成可编辑的设置项（本轮只读展示）。
- 不给会话行加图标、加彩色或加 hover 态；不改 `SessionAnalyzerPage` 的解析入口（两类会话走同一条渲染链）。

### 7.3 给实现者的一句话

这一节的全部重量压在三个地方：**开关的任何方向都不许破坏数据**（关掉只停、不删；不动 `~/.claude`），
**状态住在组件之外**（否则关掉浮层进度就没了），**标记是内联进标题行的一枚中性文字牌**
（不新增一行、不占颜色、不与标题抢第一眼）。三件事做完，「一眼相信它只在本机复制」就是界面自己说出来的。
