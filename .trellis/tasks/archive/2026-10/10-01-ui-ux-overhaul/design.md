# CC Analyzer 视觉设计方向

日期 2026-10-01 · 输入：`prd.md`、`10-01-feature-parity/research/competitors.md` §5/§6、真实截图（1440×900）

---

## 1. 现状诊断

不是「不够现代」。每条都能指到具体行。

**1.1 页面不撑满视口，根因是 CSS。** `AppShell.module.css:2` 是 `min-height: 100vh`（可增长），
`.content` 只有 `flex: 1` 没有确定高度，于是 `SessionAnalyzerPage.module.css:5` 的
`min-height: 100%` 解析不出百分比基准。`.workspace`（同文件 :14-20）用
`grid-auto-rows: auto`，**没有任何一行是 `1fr`**，日志区永远拿不到剩余高度。旁证：
`web/src/lib/useViewportCap.ts` 的注释写着「the analyzer page grows with its content,
so a pane inside it would stretch the whole page instead of scrolling」——
**这是用 JS 给布局打补丁**。

**1.2 空状态是个 320px 虚线框，然后什么都没有。** `SessionAnalyzerPage.module.css:37-44`
的 `.empty`：`min-height: 320px` + `border: 1px dashed var(--border-strong)`。
既没撑满也没有内容——最坏的组合。

**1.3 控件高度 5 种，圆角 3 处硬编码。** `Button.module.css:6` = 30px、
`SessionList.module.css:48` = 28px、`SessionAnalyzerPage.module.css:64` = 26px、
`LogView.module.css:79` = 24px、`TreeView.module.css:201` = 22px。
另有 `FilterBar.module.css:70`、`MonitorPage.module.css:18`、`ReportPanel.module.css:35`、
`RecordDetailPanel.module.css:73` 各自手写按钮样式，**都不继承 `<Button>` 的 hover /
圆角 / 过渡**——这就是「按钮像浏览器默认」的直接原因。硬编码圆角：
`TreeView.module.css:92` 与 `TimelineTrack.module.css:30` 写死 `2px`，
`LogView.module.css:186` 写死 `3px`。

**1.4 「选中/激活」有 8 种视觉编码。** 实心强调色填充（`AppShell.module.css:59`、
`ReportPanel.module.css:39`、`MonitorPage.module.css:22`）、强调色文字
（`SessionList.module.css:57`）、强调色边框 + soft 底（同文件 :161、
`TimelineTrack.module.css:42`）、soft 底 + 强调色文字 + 600
（`SessionAnalyzerPage.module.css:74`）、inset 2px 竖条（`TreeView.module.css:212`）、
soft 底闪烁（`LogView.module.css:85`）。同一个概念要学 8 遍。`var(--accent)`
出现在 11 个文件共 15 处，**像素占比远超调研 §5 的 5% 上限**。

**1.5 强调色还在表达「成功」。** `StatusToast.module.css:21-23` 的
`.success { border-color: var(--accent) }`。而 tokens 里**根本没有 `--success` /
`--warning`**，语义色只有 `--danger`。

**1.6 类别色被借去表达非类别语义——最严重的一处。** `LogView.module.css:164-174`：
`.durationS { color: var(--cat-direct) }`、`.durationM { color: var(--cat-delegated) }`。
于是蓝色同时是「tool 执行」和「耗时 1–60 秒」，橙色同时是「subagent」和
「耗时 > 1 分钟」。**Okabe-Ito 是稀缺资产，这里被借去做了一个完全无关的维度。**

**1.7 深色主题漏了一整套类别色。** `tokens.css:54-80` 的 `[data-theme="dark"]`
**没有覆盖 `--cat-*`**。实测对 `--bg: #101418` 的对比度：`--cat-workflow #6d3bd4`
**2.95:1** ✗、`--cat-direct #0072b2` **3.70:1** ✗、`--cat-wait #6b7280` **3.97:1** ✗、
`--cat-delegated #d55e00` 4.96:1 ✓、`--cat-compute #009e73` 5.61:1 ✓、
`--cat-user #cc79a7` 6.27:1 ✓。前三条同时是时间线与树视图的 8px 色块
（`TimelineTrack.module.css:34-39`、`TreeView.module.css:88-121`），深色下看不见。
`--shadow-sm` 同样只定义了浅色值。

**1.8 字号阶梯没绑定角色。** `--fs-md: 14px` 同时是应用名、面板标题、会话标题、
报告标题、监控页标题、详情面板标题——**六个角色，同一级**。而分组头
（`SessionList.module.css:109`）和表头（`LogView.module.css:31`）都是 11px
`--text-tertiary`，**完全同级**，这就是「分组头和条目层次看不出来」。另：
`.chip`（`SessionHeader.module.css:30`）显示「总耗时 12.3s」却没有 `tabular-nums`。

**1.9 盒子套盒子。** 一屏内最多同时有 7 个 `1px solid var(--border)` + `--bg-subtle`
的矩形。浅色下 `--bg-subtle` 和 `--bg-elevated` **都是 `#ffffff`**，嵌套卡片之间
除了那圈边框没有任何层次——只能靠不断加边框来区分。

**1.10 顶栏没有品牌锚点。** `AppShell.tsx:55` 是裸的 `<strong>CC Analyzer</strong>`，
样式只有 `font-size: var(--fs-md)`。整个产品最显眼的文字用的是**浏览器默认字重的粗体**。

**1.11 顶栏高度是隐式契约。** `AppShell.module.css:13` 写死 52px，
`ThresholdsPanel.module.css:3` 用硬编码 `top: 58px` 对齐，`SessionList.module.css:11`
用 `calc(100vh - 76px)`。没有 `--topbar-h`，**改高度就静默错位**。

**1.12 唯一一处硬编码颜色。** `ThresholdsPanel.module.css:16` 的
`box-shadow: 0 12px 32px rgb(0 0 0 / 0.18)`。PRD 要求 grep 不到硬编码色值，这是唯一失败。

---

## 2. 三个方向

三者不是换配色，是对「这个产品是什么」的三种回答：**数据本身** / **每天的伙伴** / **一份结论**。

### A 仪器面板（Instrument）

> 给谁用：每天跑十几个会话、把工具当仪表盘看的重度用户。
> 一句话：像一台精密仪器——**颜色只出现在数据上**，界面骨架完全单色。

- **色彩**：骨架 100% 中性灰。唯一的「动作色」是墨色 `--ink`（浅色近黑 / 深色近白），
  主按钮用它而**不是强调色**。强调色（1 个，蓝）退到只做焦点环、链接、选中底，
  **像素占比 < 3%**。5 个类别色是界面上最响的颜色，因为没有装饰色与它们竞争。
  语义色补齐 success / warning。
- **排版**：4 级 + 1 保留级（11/12/13/15，空状态 20）。行高与字号成对绑定。
  数字一律 `tabular-nums`，标题 600 而非 700。
- **空间**：高密度。表格行 30px、会话行 54px、控件 24/28/32 三档。
  **层级只用背景台阶（`--bg` → `-subtle` → `-elevated` → `-inset`）+ 发丝边框**，
  不用阴影。圆角 2/4/8/12，不出现胶囊。
- **信息层级**：一屏只有一个「最重」的元素；次级信息靠降字重和颜色，
  **不靠缩小字号**（11px 是下限）。
- **差异**：cc-insight 是绿色卡片墙，OpenCovibe 铺功能面，claude-code-viewer 是聊天回放。
  A 谁都不像——把「时间维度的度量」做成唯一主角，骨架克制到近乎消失。
  类比：Chrome DevTools 的克制 + Linear 的完成度。
- **风险**：① 数据稀少的会话里整屏只有灰，会冷——靠空状态文案和类别色图例兜底，
  **不靠加装饰**；② 强调色 < 3% 意味着**选中态必须有非颜色的第二信号**，否则灰度
  截图和色弱用户下选中态消失；③ 发丝边框在 Windows 100% 缩放下会发虚，
  **层级不能只靠边框**；④ 首屏冲击力弱于 B。

### B 工位伴侣（Desk Companion）

> 给谁用：一天开十几次、同时也在写代码的普通开发者。
> 一句话：这是一个该让人**想打开**的工具，不是一个该让人敬畏的仪表。

- **色彩**：表面带色温（浅色极淡暖灰，深色暖调近黑），强调色可作品牌色大面积出现。
  类别色降饱和一档以免与暖底打架。语义色 4 个齐全。
- **排版 / 空间**：3 级（13/15/20），正文行高 1.6。中密度：表格行 36px、会话行 64px、
  圆角 8/12/16，**用极轻阴影表达层级**。
- **信息层级**：靠留白分组（同类近、异类远），少用分隔线；空状态有图标 + 一句人话。
- **差异**：Raycast / Arc 那一支。开发者数据工具里几乎没人这么做，**记忆点最强**。
- **风险**：① **阴影在深色主题下不可见**（`--shadow-md` 现在是 `rgba(24,32,42,.08)`，
  深色底上等于没有），深浅两套主题的层级语言会分裂——这是结构性风险，不是调参能解决的；
  ② 行高 36px 意味着**一屏少看 17% 的行**，而日志表已有 9 列 + 300px 侧栏 + 360px
  详情栏，横向本来就紧；③ 暖色底会让 Okabe-Ito 的 `#D55E00` 橙显脏。
  **代价直接落在「不能牺牲密度」这条硬约束上。**

### C 报告优先（Report-first）

> 给谁用：更关心「这个项目哪里出问题、我该怎么改」而不是逐行读日志的人。
> 一句话：产出是一份**有观点的技术报告**，数据表是它的证据附件。

- **色彩 / 排版**：单色为主 + 一个品牌色；类别色只在图表里出现。正文 16px / 行高 1.7，
  标题 22/28，**排版本身就是层级**，用细分隔线而不是盒子分隔。
- **空间 / 层级**：低密度，宽栏 720px 居中。阅读顺序 = 重要性顺序，默认界面就是 AI 报告，
  会话列表退到窄栏。
- **差异**：**没有直接竞品这么做**。对标 Stripe Docs 与 Linear changelog。截图最适合传播，
  天然适配 PRD 的「README 要有代表产品气质的图」。
- **风险**：**与「信息密集的数据工具」正面冲突。** ① 报告异步生成，当主页意味着冷启动是
  一次空等；②「找上周三那个会话」这类最高频动作会变慢；③ 低密度在 1440×900 上一次只能
  显示约 25 行，而日志需要几百行。**它会为了好看牺牲密度——正是 PRD 明令禁止的。**

| 对照 | A | B | C |
|---|---|---|---|
| 强调色占比 | < 3% | 10–15% | 5–8% |
| 层级手段 | 背景台阶 + 发丝边框 | 阴影 + 色温 | 排版 + 留白 |
| 表格行高 | 30px | 36px | — |
| 深浅主题一致性 | **同一套语汇** | 需两套（阴影失效） | 同一套 |
| 首屏冲击力 | 弱 | 强 | 最强 |

---

## 3. 推荐 A，以及我放弃了什么

1. **A 的风险可控，B 和 C 的风险是结构性的。** B 的阴影层级在深色下必然失效——
   除非放弃「用阴影表达层级」这个前提本身，而那就不叫 B 了。C 的密度损失与 PRD 的硬约束
   直接冲突。A 的三个风险都有明确兜底。
2. **A 是当前问题的靶向解药。** 现状最刺眼的四条——8 种选中态、5 种控件高度、盒子套盒子、
   强调色滥用——**A 的设计前提（「颜色只承担语义」「层级只用台阶与发丝线」）让它们一起
   消失**。选 B 只是换个色调。
3. **A 保住了唯一稀缺的东西：数据上的颜色。** 只有骨架完全去色时，Okabe-Ito 才最响。
   Vercel 的单色 UI 之所以让绿/琥珀/红有力，正是因为没有任何其他颜色与它们竞争
   （调研 §5 原话）。B 的暖底和品牌色会稀释这个资产。

**明确放弃：** ① **放弃首屏的视觉冲击力**——A 的漂亮是「用三天后才觉得舒服」的那种漂亮，
README 那张图会比 B 朴素；这是为长期使用体验付的价，PRD 的语境是「要被反复打开的桌面工具」
而不是落地页。② **放弃消费级应用的讨喜感**——不做插画、不做空状态大图标、不做庆祝动效。
③ **放弃大圆角和卡片浮起**——上限 12px，**只有脱离文档流的浮层**（Toast、设置面板、
分段控件滑块）允许用阴影。④ **放弃一个独立的「品牌色」**——品牌识别靠字标排版
（15px/600/-0.01em），不靠颜色；这看着是退让，实际是把颜色预算全留给数据。

**从 B 拿一样东西**：空状态的**文案质量**。B 说「空状态要说人话」是对的，A 缺这块就会真的冷
——用 20px 主文案 + 一句具体指引，但**不加插画**。

---

## 4. 落地方案

### 4.1 token 表（全部写进 `web/src/styles/tokens.css`）

**表面 / 文字 / 边框**

| token | 浅 | 深 | 依据 |
|---|---|---|---|
| `--bg` | `#F4F5F7` | `#0D0F12` | 深色由偏蓝的 `#101418` 改中性暖黑 |
| `--bg-subtle` | `#FFFFFF` | `#14161A` | 卡片 / 面板底 |
| `--bg-elevated` | `#FFFFFF` | `#1A1D21` | 嵌套面板、粘性表头 |
| `--bg-inset` | `#F1F3F5` | `#0A0B0D` | **新增**。输入框、代码块。当前输入框用 `--bg-elevated`，白卡上白对白，只靠边框——控件显得「默认」的原因之一 |
| `--bg-hover` | `#F1F3F5` | `#212429` | 深色由蓝味过重的 `#263040` 改中性 |
| `--bg-active` | `#E8EBEF` | `#2A2E34` | 按下态 |
| `--text` | `#16181B` | `#F0F2F5` | 去掉蓝偏 |
| `--text-secondary` | `#4A5260` | `#B4BCC6` | 白底 7.9:1 |
| `--text-tertiary` | `#6B7381` | `#8B939E` | 白底 4.78:1，**信息性文字的下限** |
| `--text-faint` | `#9AA1AC` | `#5C636D` | 2.6:1，**只放不需要读的装饰字**。当前 `.groupCount` 用它显示计数——计数是信息，必须升到 tertiary |
| `--border` | `rgba(16,24,40,0.10)` | `rgba(255,255,255,0.07)` | 半透明发丝线：在不同背景台阶上自动适配，一个 token 顶多个 |
| `--border-strong` | `rgba(16,24,40,0.18)` | `rgba(255,255,255,0.14)` | 控件描边 |

**动作色 / 强调色 / 语义色**

| token | 浅 | 深 | 依据 |
|---|---|---|---|
| `--ink` | `#16181B` | `#F0F2F5` | **主按钮填充色**，让强调色退出「动作」语义 |
| `--on-ink` | `#FFFFFF` | `#0D0F12` | 白底 17.8:1 |
| `--accent` | `#2952CC` | `#7FA8FF` | 6.62:1 / 8.18:1。现状 `#0f6fde` 与 `--cat-direct: #0072b2` 色相仅差 10°，会让「选中」和「tool 类别」混淆；新值差 22°、饱和度低一档 |
| `--accent-hover` | `#1F42AA` | `#9BBDFF` | |
| `--accent-soft` | `rgba(41,82,204,0.10)` | `rgba(127,168,255,0.16)` | **选中态唯一允许的强调色填充** |
| `--ring` | `rgba(41,82,204,0.45)` | `rgba(127,168,255,0.55)` | 焦点环 |
| `--success` / `-soft` | `#1F7A4D` / `rgba(31,122,77,0.10)` | `#4CC38A` / `rgba(76,195,138,0.14)` | **新增**。现在 `.success` 借用 `--accent`，语义冲突 |
| `--warning` / `-soft` | `#946200` / `rgba(148,98,0,0.10)` | `#E0A33E` / `rgba(224,163,62,0.14)` | **新增** |
| `--danger` / `-soft` | `#B3261E` / `rgba(179,38,30,0.10)` | `#F0776C` / `rgba(240,119,108,0.14)` | |
| ~~`--on-accent`~~ | — | — | **删除**。强调色不再做填充就没有消费者；留着会诱使后续代码重新拿它当填充色 |

> **不新增 `--info`**：`--accent` 就是信息色，再加一个会产生两个都「差不多对」的选择。

**类别色 / 代码高亮**（浅色 Okabe-Ito 一个不动；深色补覆盖，只调明度不动色相 → 色盲可区分性不变）

| token | 浅 | 深 |
|---|---|---|
| `--cat-direct` | `#0072B2` | `#4DA6E0`（原值仅 3.70:1） |
| `--cat-workflow` | `#6D3BD4` | `#9B7BF0`（原值仅 2.95:1） |
| `--cat-wait` | `#6B7280` | `#8A93A0`（原值仅 3.97:1） |
| `--cat-delegated` / `-compute` / `-user` | `#D55E00` / `#009E73` / `#CC79A7` | 不变（4.96 / 5.61 / 6.27:1 已合格） |
| `--code-comment` | `#69707D`（原 `#8A9199` 仅约 2.9:1，未达可读标准） | `#7F848E` 不变，其余代码 token 全部不动 |

**字号 / 间距 / 形状 / 动效**

| token | 值 | 依据 |
|---|---|---|
| `--fs-xs` `11px` / `--lh-xs` `16px` | 徽标、计数、列头、分组头 | 4 级 + 1 保留级。规则：任何 `font-size` 必须与同级 `line-height` 成对出现，**不得依赖全局 `line-height: 1.5`** |
| `--fs-sm` `12px` / `--lh-sm` `18px` | 表格与列表正文、控件文字 | |
| `--fs-base` `13px` / `--lh-base` `20px` | 界面正文、说明、**面板标题（+600）** | |
| `--fs-md` `15px` / `--lh-md` `22px` | **页面级标题**（顶栏字标、会话标题） | |
| `--fs-lg` `20px` / `--lh-lg` `28px` | **唯一用途：空状态主文案**。现状空状态是一句 11px 灰字占着 320px，这是它显得空的根因 | 改语义（原 16px 副标题） |
| `--sp-1..6` = 4/8/12/16/24/32 | **不变**。不引入 6px、10px 这类半步——半步是阶梯漂移的起点 | |
| `--topbar-h` `48px` | 替换 `AppShell:13` 的 52px、`ThresholdsPanel:3` 的 `top: 58px`、`SessionList:11` 的 `100vh - 76px` | |
| `--sidebar-w` `300px` / `--detail-w` `360px` | 替换 `SessionAnalyzerPage:3,11` 的硬编码 | |
| `--control-h-sm` `24px` / `--control-h` `28px` / `--control-h-lg` `32px` | 表格内联 / 默认 / 空状态 CTA | |
| `--row-h` `30px` | 表格行 | |
| `--r-xs` `2px` **新增**；`--r-sm` `4px`、`--r-md` `8px`、`--r-lg` `12px` 不变 | **刻意不采纳调研里的 6/12/16**：这里控件只有 24–32px 高，圆角超过高度的 1/6 就显成胶囊、压缩可用内边距。16px 上限在密集表格里不成立 | |
| `--shadow-sm` `0 1px 2px rgba(16,24,40,.08)` / 深 `0 1px 2px rgba(0,0,0,.4)` | **深色覆盖为新增**。规则：阴影**只用于脱离文档流的浮层**（Toast、设置面板、分段控件滑块）；文档流内的层级由背景台阶 + 发丝边框承担 | |
| `--shadow-md` `0 10px 30px rgba(16,24,40,.12)` / 深 `0 10px 30px rgba(0,0,0,.5)` | 同上 |
| `--dur-hover` `80ms`、`--dur-state` `140ms`、`--dur-enter` `220ms`、`--dur-layout` `360ms` | 见 4.4 |
| `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`、`--ease-in-out` `cubic-bezier(0.4, 0, 0.2, 1)` | **删除 `--transition`（160ms ease）**。保留它会与新的 `--dur-*` 形成两套并行体系——这正是 CLAUDE.md 警告的「漂移的规则比没有规则更危险」 |

**另需写进 `:root`**：`accent-color: var(--accent);`——否则原生 `<progress>`
（`SessionList.module.css:130`）和 checkbox 会用系统色。

### 4.2 token 增删

- **新增**：`--bg-inset`、`--ink`、`--on-ink`、`--success(-soft)`、`--warning(-soft)`、
  `--lh-xs/sm/base/md/lg`、`--topbar-h`、`--sidebar-w`、`--detail-w`、
  `--control-h-sm/-h/-h-lg`、`--row-h`、`--r-xs`、`--dur-*`×4、`--ease-out`、`--ease-in-out`
- **删除**：`--on-accent`（无消费者且有害）、`--transition`（被 `--dur-*` 取代）
- **改语义**：`--fs-lg` 从「16px 副标题」改为「20px 空状态主文案」
- **补深色覆盖**：`--cat-direct`、`--cat-wait`、`--cat-workflow`、`--shadow-sm`、`--shadow-md`

### 4.3 关键界面改法

**① 顶栏**（`AppShell.module.css` / `.tsx`）
- 高度 52 → **48px**（用 `--topbar-h`），底 `--bg-subtle`，底边 `1px solid var(--border)`。
- 左侧加 **18×18 品牌标记**，直接复用 `src-tauri/icons/icon.png`（`--r-xs`），右侧字标
  **13px / 600 / `--text` / `letter-spacing: -0.01em`**。**不新增图片资产。**
- 工作区切换改**分段控件**：容器 `--bg-inset` + `--r-sm` + `padding: 2px`，无边框；
  选中项 `--bg-subtle` + `--shadow-sm` + `--text` + 600；未选中 `--text-tertiary`。
  **删掉 `background: var(--accent)` 的实心填充。**
- 右侧两个按钮改 **32×32 图标按钮**（透明底，hover `--bg-hover`）。需新增
  `web/src/components/Icon.tsx`——**内联 SVG path，零依赖，约 6 个图标**（太阳/月亮/设置/
  刷新/搜索/关闭）。这不是引入图标库，但确实是一处新代码，实施时需明确确认。
  **若不接受新增组件**：保留文字按钮，去掉边框、`color: var(--text-secondary)`、
  高度 `--control-h`。

**② 会话列表**（`SessionList.module.css`）
- 搜索框改 `--bg-inset` 底 + `--control-h` + `--r-sm`。
- 时间线/项目 tab 改分段控件（同顶栏），**去掉 `color: var(--accent)`**。
- **分组头**：11px / **600** / **`--text-secondary`**（原 tertiary），`letter-spacing: 0.02em`，
  高 32px，上方留 8px，**加 `position: sticky; top: 0; z-index: 1;
  background: var(--bg-subtle)`**。列表是 flat 渲染 + 上下 spacer 的虚拟滚动
  （`SessionList.tsx:245-268`），sticky 可用。这是把「分组」与「条目」分开的最强手段，
  长列表下也真有价值。计数从 faint 升到 **tertiary**。注意 `.groups` 的 `padding-top`
  要挪到 spacer 上，否则 sticky 头上方会露出 8px 滚动带。
- **会话行**：62 → **54px**（带状态行 80 → **72px**），`padding: 8px 10px`，`gap: 2px`。
  **必须同步改 `SessionList.tsx:15-16` 的 `SESSION_ROW_HEIGHT` / `_WITH_STATUS`，
  以及 `GROUP_ROW_HEIGHT`（38 → 32）**——虚拟滚动靠这些常量算偏移，不同步会错位。
- **选中态**：去掉 `border-color: var(--accent)`，改为 `background: var(--accent-soft)` +
  `box-shadow: inset 2px 0 0 var(--accent)` + 标题 600。用 inset 阴影而非边框，选中前后
  不位移，并与 `TreeView .nodeSelected` 统一。hover 加
  `transition: background-color var(--dur-hover) var(--ease-in-out)`。

**③ 日志视图**（`LogView.module.css`）
- 表头底色改 **`--bg-inset`**（原 `--bg-elevated`，在白卡上无台阶），11px / 600 /
  `--text-tertiary` / `letter-spacing: 0.02em`，高 `--row-h`；底边改
  `1px solid var(--border-strong)`，比行分隔线强一档，滚动时能分开。
- 行：`padding: 6px 10px`，12px，行高 30px。**同步改 `LogView.tsx:24` 的
  `ROW_HEIGHT = 31` → 30。**
- **修掉颜色语义冲突**：`.durationS` / `.durationM` 不再用 `--cat-direct` /
  `--cat-delegated`，改为**用时重与文字色阶**：`<1s` → `--text-tertiary`；
  `1–60s` → `--text-secondary`；`>60s` → `--text` + `font-weight: 600`。
- `.kind` 徽标：`--r-xs`，`background: var(--bg-inset)`，`border: 0`，**左边框 2px 用
  `var(--row-color)`**。行上已挂着 `.user/.llm/.tool/…`（`LogView.tsx:263` 的
  `styles[row.kind]`），`--row-color` 现成可用，类别色因此进入每一行，扫读性提升明显，
  **且不需要改 DOM 结构**。
- `.selected` 保留 `--accent-soft`，但**同时加 600 字重**作为非颜色信号。

**④ 空状态**（统一到 `EmptyState`，三档尺寸）
- **删除** `SessionAnalyzerPage.module.css:37-44` 的虚线框、`ReportPanel.module.css:59-70`
  的带边框 `.placeholder`。当前有 **7 种**「这里没有东西」的画法（`EmptyState.container`、
  `SessionAnalyzerPage .empty`、`LogView .empty`、`RecordTable .empty`、
  `ReportPanel .placeholder`、`TreeView .detailEmpty`、`MonitorPage .center`），
  统一成一个组件三个尺寸。
- `page`：**无边框、无底色**，内容在主区垂直居中。品牌标记 32px（opacity .9）+ 20px/600
  主文案 + 13px `--text-tertiary` 说明。
  > 强烈建议加一个**可选**但高价值的东西：**最近 5 条会话的快捷入口**（复用页面已有的
  > `sessions`）。当前「选择一个会话开始分析」下面什么都没有，是空状态显得空的第二个
  > 原因。这是新代码，实施时需确认。
- `panel`：无边框无底色，13px `--text-tertiary` 居中，上下 `var(--sp-5)`。
  `inline`：单行 11px `--text-faint`。

**⑤ 按钮**（`Button.module.css` + 收敛手写样式）

| variant | 底 | 边 | 字 | hover |
|---|---|---|---|---|
| `secondary`（默认） | `--bg-subtle` | `--border-strong` | `--text` | 底 `--bg-hover`，**边 `--text-faint`**（不是 accent） |
| `primary` | **`--ink`** | `--ink` | **`--on-ink`** | `opacity: 0.88` |
| `ghost`（新增） | 透明 | 无 | `--text-secondary` | 底 `--bg-hover` |
| `danger` | 透明 | `--border-strong` | `--danger` | 底 `--danger-soft`，边 `--danger` |

- 高度 `--control-h`，`padding: 0 10px`，`--r-sm`，过渡用 `--dur-hover` / `--ease-in-out`。
- **hover 不再是 `border-color: var(--accent)`**——现状让 hover 和 focus 长得几乎一样。
- 手写按钮样式全部换成 `<Button variant="ghost">`：`FilterBar.module.css:69`、
  `SessionAnalyzerPage.module.css:63`、`MonitorPage.module.css:17`、`LogView.module.css:78`、
  `TreeView.module.css:200`、`RecordDetailPanel.module.css:72`、`SessionList.module.css:47`。
  `.track > button`（时间线标记）保留自有样式，改用 `--r-xs`。
- `ThresholdsPanel.module.css:16` 的硬编码阴影换成 `--shadow-md`。

**⑥ 布局**（`AppShell.module.css` / `SessionAnalyzerPage.module.css`）
- `.shell` 的 `min-height: 100vh` → **`height: 100dvh`**；`.content` 补 `min-height: 0`。
- `.workspace` 的 `grid-auto-rows: auto` → 显式
  `grid-template-rows: auto auto auto minmax(0, 1fr) auto`，让日志区吸收剩余高度。
- 完成后**删除 `web/src/lib/useViewportCap.ts` 及 `LogView.tsx` 里的调用**——
  它是布局缺陷的补丁，布局修好就不该留着。
- `.page` 用 `--sidebar-w` / `--detail-w`，`gap` 由 `--sp-3` → **`--sp-4`**。

### 4.4 动效规范

| 场景 | 时长 | 缓动 | 属性 |
|---|---|---|---|
| hover（背景/边框/文字） | `--dur-hover` | `--ease-in-out` | 仅颜色类 |
| 焦点环出现 | `--dur-state` | `--ease-in-out` | `outline-color` |
| 浮层进入（Toast、设置面板） | `--dur-enter` | `--ease-out` | `opacity` + `translateY(4px)` |
| 浮层离开 | `--dur-state` | `--ease-in-out` | 仅 `opacity`（不做位移） |
| 布局变化（详情栏、侧栏折叠） | `--dur-layout` | `--ease-out` | `grid-template-columns` |
| 进度条 | — | `linear` | `width` |

**该动**：hover / 焦点 / 选中；浮层进出；详情栏展开。

**不该动**：① **数字不做补间**——耗时、占比、token 数在数值变化时不许有动画，
滚动数字会让人读错；② **表格行 hover 不做位移或缩放**——行要对齐成网格，
位移会破坏扫描线；③ **瀑布图 / 时间线不做入场动画**——每次切会话都重放会拖慢感知速度；
④ **列表不做逐项 stagger**——虚拟滚动下未渲染的行不参与，只会看起来像卡顿；
⑤ `prefers-reduced-motion: reduce` 下所有非必要过渡归零。

**必须改的一处**：`LogView.module.css:88-99` 与 `TreeView.module.css:59-70` 各有一份完全
相同的 `flash` 关键帧，时长 **1.6s**——远超 80–150ms 的交互语汇，每次跳转都拖一下。
改为 **600ms / `--ease-out` / 只动背景色**，两处合并到一处共享定义。它做的是「看这里」，
是一次性提示而非过渡，所以 600ms 合理，1.6s 不合理。

### 4.5 必须避免

1. **为了「卡片感」把行高从 30px 提到 40px+。** 一屏少看 30% 的行，在数据工具里这是
   最贵且不可逆的代价。
2. **用阴影表达文档流内的层级。** 深色下阴影不可见，两套主题的语言会分裂。
3. **给数字加动画、给列表加 stagger 入场。** 见 4.4。
4. **圆角超过 12px 或做胶囊按钮。** `--r-lg` 是上限。
5. **用 `--cat-*` 表达非类别语义。** `durationS/durationM` 就是现成反例。
6. **在 `--text-faint` 上放需要读的信息。** 2.6:1 只够放装饰。
7. **引入任何 UI 组件库或图标库。** 内联 SVG path 不算。
8. **组件里写死颜色、圆角、高度、时长。** 这四类都必须是 token——PRD 只提了颜色，
   但圆角（`TreeView:92` 的 `2px`）和高度（5 种）的漂移危害相同，而且更难发现。
9. **把强调色当填充色用。** 唯一例外是 `--accent-soft` 的选中底。
10. **新增 token 只给一套值。** 漏写会静默继承浅色值——`--shadow-sm` 现在就是这样。

---

## 5. 验收清单

截图可验证。建议 Playwright 在 **1440×900** 下截 `analyzer` / `monitor` 两个 tab
各浅色 + 深色，另加一张「已选会话、日志视图、带筛选」。

**结构**
- [ ] 页面内容底部到达视口下沿，**不存在 y > 1000 的连续空白带**
- [ ] 未选会话时主区空状态**垂直居中**，无虚线框，无 320px 固定高盒子
- [ ] 选中会话后日志表格底部贴合视口，**页面本身不出现滚动条**（只有表格内部滚动）
- [ ] 设置面板顶部与顶栏底边间距 = `var(--sp-2)`，且改 `--topbar-h` 后仍对齐

**色彩**
- [ ] `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" web/src --include="*.module.css"` 为**空**
- [ ] 顶栏、侧栏、日志表头、报告面板上**没有任何实心强调色填充**
- [ ] 全屏截图里强调色像素 **< 5%**（粗略判据：只有焦点环、选中行底、链接）
- [ ] 深浅两套主题下，5 个类别色（时间线色块、树视图色块）**都清晰可辨**
- [ ] `--cat-direct` 的蓝（tool）与选中态的蓝**肉眼可分**

**排版**
- [ ] 截图中字号不超过 **5 种**（11/12/13/15/20）
- [ ] 侧栏分组头（如「更早」）比会话行标题**颜色更深**，两者一眼可区分
- [ ] 会话标题与面板标题**不是同一个字号**（15 vs 13）
- [ ] 顶栏字标不是浏览器默认粗体（字重 600、字距 -0.01em、左侧有品牌标记）

**控件**
- [ ] 同屏所有按钮高度只有 **24 / 28 / 32** 三种取值
- [ ] 至少 4 个原先手写的按钮（筛选栏、视图 tab、行内操作、空态 CTA）hover 表现一致
- [ ] 输入框有可见凹陷底色（`--bg-inset`），不是只靠边框
- [ ] `secondary` 按钮 hover 时**边框不变蓝**

**数字**
- [ ] 会话头部「总耗时」在会话间切换时**数字不左右跳动**（tabular-nums）
- [ ] 日志表「耗时」列的档位区分靠字重/色阶，**不靠类别色**
- [ ] 日志表「类型」列每行左侧有类别色标记

**动效**
- [ ] `grep -rn "1.6s" web/src` 为空
- [ ] 快速 hover 侧栏会话行、表头、按钮，**过渡时长一致**（无一处「啪」地跳变）
- [ ] 系统开启「减弱动态效果」后，界面无任何位移/淡入

**主题**
- [ ] 每个主要界面（会话分析空态 / 日志视图 / 树视图 / 报告面板 / 实时监控 / 设置面板）
      都有**浅色 + 深色**两张截图，共 12 张
- [ ] 深色下没有任何「浅色主题残留」（白底卡片、黑色阴影、过亮的强调色填充）

**不回归**
- [ ] `npm --prefix web test`、`npm --prefix web run build`、`./scripts/lint.sh` 全绿
- [ ] 改行高常量后，长列表滚到底部**没有错位或空白**（虚拟滚动对齐）
