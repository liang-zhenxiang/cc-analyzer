# 设计决策：一致性收口与状态语言（Round H · 子任务 3）

> 角色：UI/UX 产品设计师（桌面应用 / 数据可视化方向）
> 依据：`prd.md` + `.trellis/workspace/liangyuxiang/design-critique.md`（Top10 的 1–4 已落地）
> 素材：**逐张目验** `docs/screenshots/` 下 `analyzer-{tree,log,report,empty}-{light,dark}`、
> `usage-{light,dark}`、`settings-{light,dark}`、`monitor-{light,dark}`（2026-10-03 01:25 重出版）；
> 通读 `web/src/styles/*.css`、`web/src/components/*`、`web/src/app/*`、
> `web/src/features/sessions/{SessionList,LogView,TreeView,RecordTable,SessionHeader,FilterBar,ReportPanel,TokenPanel,RecordDetailPanel,SessionAnalyzerPage}.{tsx,module.css}`、
> `web/src/features/usage/UsageOverviewPage.{tsx,module.css}`、全部 e2e 与相关单测。
>
> **本文件是设计规格，不含代码。所有尺寸/颜色/圆角/时长一律引用 `var(--*)`。**
> 与并行分支（表盘尺寸、表格横向滚动、`ScrollArea`）重叠的落点，只写「依赖既有约定」，
> 不在此判断其取值。

---

## 0. 先纠正三条过期前提（否则会照着错的目标施工）

动手前核实现状，发现评审报告的三条「现状证据」在本轮开工时已经失效。这不是挑错，
是**范围要改写**——照着过期证据施工会做出无人受益的改动。

| 评审说法 | 当前事实 | 结论 |
| --- | --- | --- |
| #9 状态灯常亮、无语义 | `features/sessions/sessionHealth.ts` 已实现三态 + `sessionHealthText`，`SessionHeader.tsx` 已接、`SessionHeader.module.css` 已有 `.active-today{--success}` / `.has-errors{--danger}`，并有 `sessionHealth.test.ts` | **PRD 功能需求 6 已完成** → 本轮只做复核（§B.6），不重做 |
| #7 「刷新会话列表」是文字按钮、挤压搜索框 | 已是 `IconButton label="刷新会话列表"` + `refresh` 图标（`SessionList.tsx`），搜索框已 `flex:1` 拿回全宽（截图 `analyzer-empty-*` 可见） | **PRD 功能需求 3 的主要部分已完成** → 只剩高度对齐与间距（§B.3） |
| #8 `components/Panel.tsx` 是死代码 | `UsageOverviewPage.tsx` 已有 **4 处真实消费者**（每日 Token / 按项目 / 按模型 / 活跃时段）；且 `--r-lg` 有 2 处消费者、`--warning` 有 4 处消费者 | **「死代码」判定不成立**、**`--r-lg`/`--warning` 已不是孤儿** → §B.5 与 §B.8 的范围据此收缩 |

因此本轮**真正剩下**的是：**统一分段控件（6 处，不是 4 处）× 统一加载语言 × 行密度令牌 ×
Panel 定性与 `ErrorBoundary` 收口 × 筛选 chip 化 × 微间距令牌 × 行内动作收口（§B.9）**。
这恰好是标题里的那件事：**收口**——不是加东西，是让已有的东西只存在一份。

> §B.9（行内动作密度）不是 PRD 原有条目，是维护者在初稿后**追加的设计输入**：
> H1 修好日志表横向可达后，原本被裁掉的行内按钮全时可见，暴露出"六行十二个按钮"的
> 常数噪声。它同样落在本轮主题上——**把重复的常数元素收敛掉**。

> 分段控件调用点实际是 **6 处**（PRD 写「四处」）：`AppShell.workspaceTabs`、
> `SessionList` 侧栏、`SessionAnalyzerPage.viewTabs`、`ReportPanel` tabs、
> **`UsageOverviewPage.rangeTabs`、`UsageOverviewPage.classTabs`**。
> 后两处是评审漏数的——`UsageOverviewPage.module.css` 里 `.rangeTabs, .classTabs` 共用同一段
> 逐字复制的 CSS。这也说明「靠注释维系一致性」已经漏过一次了。

---

## A. 设计基调

**确认「仪器面板」方向，不修正。** 现有纪律（骨架一律中性灰、颜色只出现在数据上、
发丝线 + 台阶替代阴影、文档流内零阴影、`tabular-nums` 全覆盖）是本项目最稀缺的资产，
本轮一个字不改。

本轮唯一的评判标准，逐条落到动作上：**每个视觉元素都承载信息**。
由此推出两个可执行的操作口径——

1. **只加信息，不加装饰。** 一切新增只允许三种来源：① 把已有但藏起来的信息露出来；
   ② 把同一概念的两套画法收敛成一套（收敛本身就是信息：用户不用再学第二遍）；
   ③ 把「正在取数」「按下生效」这类**状态**从「无表达」提到「有表达」。
2. **同一个概念只允许有一种画法。** 分段控件、加载态、行密度、多选开关——
   本轮做的全部是「同一概念的第 2/3/4 套画法」的删除。

**明确不做（本轮任何情况下都不做）：**

- 渐变、玻璃拟态、模糊背景、彩色主题、装饰性动效（呼吸光晕、粒子、进入位移）
- 任何「为了让界面好看」的改动——包括但不限于：给卡片加阴影、给标题加色、给图标加底色
- 整体视觉重设计、配色体系调整、字号档位增减（字号缩放/高对比度是 Issue #73）
- 新增页面、搬动主要区块位置（信息架构冻结）
- 借色：类别色 `--cat-*`、图表色 `--chart-*`、强调色 `--accent`、语义色
  `--success/--warning/--danger` 四套资产互不借用（tokens.css 已立此规，本轮重申）

---

## B. 逐条设计规格

### B.1 `SegmentedControl` 共享组件（PRD 功能需求 1）

#### 问题（现状证据）

六处 `role="tablist"` 各自手写 CSS，除侧栏一项外**逐字相同**：

| 调用点 | 文件:行 | 差异 |
| --- | --- | --- |
| 顶栏页面切换 | `AppShell.module.css:57` | `min-width: 88px`（唯一差异） |
| 侧栏列表视图 | `SessionList.module.css:47` | `button { flex: 1 }`（等分）、`margin: 0 var(--sp-3)` |
| 视图切换 | `SessionAnalyzerPage.module.css:76` | 无 |
| 报告范围 | `ReportPanel.module.css:29` | `tab:disabled`、标签动态（`节点分析：X`） |
| 用量·时间范围 | `UsageOverviewPage.module.css:22` | 无 |
| 用量·Token 类别 | `UsageOverviewPage.module.css:22` | 与上一行共用同一条规则 |

截图证据：`analyzer-tree-light` 顶栏、`analyzer-tree-light` 侧栏「时间线/项目」、
`analyzer-log-light` 的「日志视图/树视图」、`analyzer-report-light` 的「整会话分析/筛选后分析/…」、
`usage-light` 的「近 7 天/近 30 天/近 90 天」与「全部/输入/输出/缓存写入/缓存读取」——
六张面孔，同一张脸。四处的 `gap: 2px; padding: 2px` 也是这批 2px 字面量的大头（§B.8）。

#### 设计意图

一致性目前靠注释（「与顶栏的页面切换同一种画法」「同一套画法」）维系——**注释不是约束**，
它已经漏过一次（用量页两处）。抽成一个组件后，「同一个概念不学两遍」从**约定**变成**编译期事实**。
附带补齐 WAI-ARIA 的方向键导航：这是键盘用户对一组标签的默认预期。

#### 视觉规格（唯一一份，全部调用点共用）

根容器（`.root`）：
- `display: inline-flex`；`gap: var(--sp-05)`；`padding: var(--sp-05)`
- `border-radius: var(--r-sm)`；`background: var(--bg-inset)`
- 凹陷的槽 —— 与「抬起的滑块」构成一凹一凸。

项（`.item`，即 `<button role="tab">`）：
- `min-height: var(--control-h-sm)`；`padding: 0 var(--sp-3)`；`border: 0`；`border-radius: var(--r-xs)`
- `background: transparent`；`color: var(--text-tertiary)`
- `font: inherit`；`font-size: var(--fs-sm)`；`line-height: var(--lh-sm)`；`cursor: pointer`
- `transition: background-color var(--dur-hover) var(--ease-in-out), color var(--dur-hover) var(--ease-in-out)`

各态：

| 状态 | 规格 | 非颜色信号 |
| --- | --- | --- |
| **default** | 透明底 + `--text-tertiary` | — |
| **hover**（未选中、未禁用） | `color: var(--text)` | 文字对比提升 |
| **selected**（`[aria-selected="true"]`） | `background: var(--bg-subtle)`；`box-shadow: var(--shadow-sm)`；`color: var(--text)`；`font-weight: 600` | **阴影**（脱离文档流浮层唯一合法用途）+ **字重 600**——灰度截图下两者都还在 |
| **active/按下** | 不另加：选中即最终态，`transition` 由 `--dur-hover` 承担 | — |
| **focus-visible** | **不自绘**，交给全局 `:focus-visible`（`outline: 2px solid var(--ring)`，`global.css`） | 2px 环 |
| **disabled** | `opacity: 0.5`；`cursor: not-allowed` | 透明度 |

**为什么滑块用 `--bg-subtle` 而不是更响的色**：深浅两主题下它与槽的关系是同一套——
浅色：滑块 `#ffffff` 比槽 `#f1f3f5` 亮；深色：滑块 `#14161a` 比槽 `#0a0b0d` 亮。
两个主题里滑块都与**顶栏背景同色**（浅/深都是），因此滑块的边界不靠"自己的一面"，
而靠**槽把它框出来**。这是刻意的：控件整体读作「一个凹陷的槽 + 一块抬起的滑块」，
在深浅两色下成立，无需任何主题分支。（§C 的验证方法据此写。）

**变体（只允许两个，别再加）：**
- `wide`（仅顶栏页面切换用）：`item { min-width: 88px }`。88px 保留在组件模块里并注明
  「顶栏专用」——它是宽度不是高度/颜色/圆角/时长，不违反 tokens 纪律。
- `equal`（仅侧栏列表视图用）：`item { flex: 1 }`，两项等分 276px。

#### 组件接口（实现者照抄即可）

```
components/SegmentedControl.tsx + SegmentedControl.module.css

type SegmentedItem<T extends string> = {
  value: T;
  label: ReactNode;      // ReportPanel 需要「节点分析：<label>」这种动态文案
  disabled?: boolean;
  title?: string;        // disabled 时解释原因（沿用「先在树视图选择一个节点」）
};

props {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;     // 必填：六个调用点各有一个 aria-label，逐个保留原文
  variant?: "default" | "wide" | "equal";   // 默认 default；wide/equal 见上
  className?: string;    // 仅用于外层布局（如顶栏的 grid 居中），不得覆盖控件内部样式
}
```

**接口纪律**：`className` 只许作用于根容器的外部定位，**禁止**用来覆盖
`.item` 的视觉（这正是 `Panel` 那段注释警告过的坑：外层选择器特异性会盖掉组件变体）。
需要新的视觉差异 → 加变体，不加 className 补丁。

#### 无障碍

- **可访问名**：项文本即名；六个 `aria-label` 原样保留——`页面切换`、`列表视图`、
  `视图切换`、`报告范围`、`时间范围`、`Token 类别`。
- **角色**：容器 `role="tablist"`，项 `role="tab"` + `aria-selected`（**保持不变**，
  e2e 全靠这两个，见 §C.1）。
- **roving tabindex**：选中项 `tabIndex={0}`，其余 `tabIndex={-1}`。
  Tab 键一次进入、一次离开整组，不在组内逐个停留。
- **方向键（全部六个调用点统一）**：
  - `ArrowRight` / `ArrowDown` → 下一项（**环绕**：末项 → 首项）
  - `ArrowLeft` / `ArrowUp` → 上一项（环绕）
  - `Home` → 首项；`End` → 末项
  - 移动时**跳过 `disabled` 项**；全部禁用时保持原位
  - 命中上述键一律 `preventDefault`，避免页面滚动
- **激活方式：自动激活（选中随焦点移动）。**
  理由：① 与 macOS 原生分段控件（`NSSegmentedControl`）的行为一致，本项目这套控件
  本就是照着原生分段控件画的；② 与 ARIA APG 对「激活成本低」的 tablist 的默认建议一致；
  ③ 六个调用点里五个是纯本地状态，切换成本为零。
- **非颜色信号**：选中 = 抬起面 + 阴影 + 字重 600（见上表）。

> **待定，需要维护者决策（1 处）**：顶栏「页面切换」是六个调用点里唯一会**切换页面组件**的
> 一个。自动激活意味着按住方向键划过「用量总览」会挂载 `UsageOverviewPage` 并触发
> `useUsageOverview` 的扫描（解析结果进共享缓存，重复进入不重复付费，但仍有一次批量解析）。
> **我的推荐：保持自动激活**（一个规格优于一处例外，且扫描成本被缓存吸收）。
> 若维护者实测认为划过时的扫描不可接受，**唯一备选**是把顶栏这一处改成手动激活
> （方向键只移动焦点，`Enter`/`Space` 才切换）——我不推荐，因为它会让「一个规格」
> 退回「一个规格 + 一处例外」，正是本轮要消灭的东西。

#### 验收怎么看

- 六处控件在浅/深两主题下**槽的圆角、内缩、项高、项间距完全一致**：
  并排看 `analyzer-tree-light` 顶栏 + `usage-light` 时间范围 + `analyzer-report-light` 报告范围，
  三个槽的左内边距、项与槽的间距应当同为 2px 级（`--sp-05`）。
- 顶栏「会话分析/用量总览/实时监控」三项等宽（`wide` 的 88px 生效）。
- 侧栏「时间线/项目」两项等宽各半。
- 仓库内不再出现 `gap: 2px; padding: 2px + border-radius: var(--r-sm) + background: var(--bg-inset)`
  这段组合（可 grep 验证）。

---

### B.2 统一加载态语言（PRD 功能需求 2）

#### 问题（现状证据）

三处加载三套说法，且**没有一处是"形"的表达**：

| 位置 | 现状 | 证据 |
| --- | --- | --- |
| 侧栏首载 | `<div>加载中…</div>`——**裸文本、无 class、无样式** | `SessionList.tsx:241`（连 `styles.*` 都没挂） |
| 会话头读数 | 四个数值位各显示 `…` | `SessionHeader.tsx:72/77/85/97`，按钮 `disabled` + `opacity: .55` |
| 主区（表格首载） | 文案 `正在解析会话… 34%` | `SessionAnalyzerPage.tsx:354` |

另有两处同族但**不属本轮三处**的状态：`UsageOverviewPage`「正在扫描会话列表…」、
`MonitorPage`「正在探测监控仪表盘 / 第 N/3 次尝试」（见下方「不适用 skeleton 的情况」）。

#### 设计意图

加载是桌面工具最高频的状态。**「正在取数」应当由内容的形状表达，而非由一句话请求用户等待。**
用户扫一眼就知道"这里将会出现一列会话/一张表/五个读数"，视线不需要读文字、
布局也不会在数据到达时塌缩重排（skeleton 的尺寸即最终尺寸，这是它比文案更值钱的地方）。
"…" 尤其糟：它同时表达"加载中"和"没有值"和"内容为空"，是三种含义的一种写法。

#### 视觉规格

**新原语**：`components/Skeleton.tsx` + `Skeleton.module.css`，两个导出，别做第三个：

```
SkeletonBar({ width?: "short" | "mid" | "wide" | "value" })   // 单个条，aria-hidden
Skeleton({ variant: "list" | "table", rows: number, label: string })  // 块容器，role="status"
```

条（`.bar`）：
- `background: var(--bg-hover)`；`border-radius: var(--r-sm)`
- 呼吸动画：`animation: cca-breathe var(--dur-pulse) var(--ease-in-out) infinite alternate`

宽度档（**全部用相对单位，避免 px 字面量**）：`short → 30%`、`mid → 55%`、
`wide → 100%`、`value → 3em`；高度档：`--lh-xs` / `--lh-base` / `--lh-md`（按所替代的文本级）。

**新增两条 token（`tokens.css`，与 `--dur-*` 同组）**：
- `--dur-pulse: 1400ms` —— 呼吸一个来回的时长。**必须新增而不是写字面量**：
  tokens.css 明令「时长必须是 token」，且现有四档（80/140/220/360ms）都是**过渡**语汇，
  呼吸是**循环**语汇，混进去会让 `--dur-*` 失去"过渡时长"的语义。
  1400ms 的依据：慢到不抢注意力，快到能看出"在动"。
- 呼吸关键帧 `@keyframes cca-breathe { from { opacity: 0.55 } to { opacity: 1 } }`
  写进 `styles/animations.css`（**必须**，因为 CSS Modules 会给模块内的 `@keyframes` 改名，
  定义与引用必须在同一模块作用域；`Skeleton.module.css` 顶部 `@import` 它，沿用既有约定）。

**`prefers-reduced-motion` 下的静止形态**：不做特殊处理，靠 `global.css` 的全局归零规则
（`animation-duration: 0.01ms !important; animation-iteration-count: 1 !important`）。
设计上必须保证：**动画只负责"变暗"这一段，条的基色 `--bg-hover` 本身就是静止可见的形态**，
动画结束后元素回到 base style（不设 `animation-fill-mode`）。
因此 reduced-motion 下看到的是**一条稳定的 `--bg-hover` 实心条**——可辨、不闪、不消失。
**禁止**把条的基色设成透明再靠动画点亮（那在 reduced-motion 下会变成空白）。

#### 三处用法

**① 侧栏首载**（`SessionList`）
- 把 `{loading ? <div>加载中…</div> : null}` 换成
  `<Skeleton variant="list" rows={6} label="正在加载会话列表" />`。
- `variant="list"`：每行 = 一条 `mid`（标题位，55%）+ 一条 `short`（元信息位，30%），
  行内 `gap: var(--sp-1)`，行 `padding: var(--row-pad-y) var(--row-pad-x)`
  （**依赖 §B.4 的行密度令牌**——本规格与 B.4 有依赖，实现时 B.4 先落地）。
  行数与 `.sessionRow` 的 54px 节奏对齐，使列表出现时**不发生高度跳变**。
- 容器 `role="status"` + `aria-label="正在加载会话列表"`；内部条 `aria-hidden`。
  **不保留可见文案**——形状已经说明了一切。
- 与既有的「标题补全进度」条（`progress` + `role="status"`）**是两件事，不要合并**：
  `loading` = 列表本身还没有 → skeleton；`progress` = 列表已有、标题在补 → 保留现有的
  确定进度条（它是真实的可度量信息，不是加载占位）。两者可同时出现，互不冲突。

**② 表格首载**（`SessionAnalyzerPage` 解析中）
- **诚实说明一个事实**：三张数据表**没有独立的"首载"状态**。它们只在
  `parsed` 非空后才挂载（`SessionAnalyzerPage.tsx:349` 的分支），解析期间工作区里
  根本没有表格。所以 PRD 说的"表格首载"，在设计上应当落地为**主区在解析期间的表格剪影**：
  用 `<Skeleton variant="table" rows={8} label="正在解析会话" />` 占住表格将要出现的形状。
- **保留进度数字**：在剪影上方保留一行 `--fs-xs` + `--text-tertiary` 的
  `正在解析会话 34%`（`role="status"`）。理由：**确定型进度是信息，不是装饰**——
  skeleton 说"有内容要来"，百分比说"还差多远"。两者不冲突，砍掉数字是丢信息。
  （注意：文案里不再需要 `…`，百分比本身已表明未完成。）
- 未选中会话时的「选择一个会话开始分析」**不动**（那是空态不是加载态，
  且 `smoke.spec` 的布局不变量用例量着它的垂直居中）。

**③ 会话头读数**（`SessionHeader`）
- 四个数值位在 `parsed === null` 时，把 `…` 换成 `<SkeletonBar width="value" />`
  （`width: 3em`、`height: var(--lh-md)`，与 `.readoutValue` 的 `--fs-md/--lh-md` 同高）。
- 「总耗时」标签保留（标签是结构不是占位）。
- 读数按钮：`disabled` 保持，另加 `aria-busy={!parsed}`；`aria-label="会话读数"` 不变。
- 去掉 `…` 后**不能**让按钮变成无可访问内容的空按钮——可访问名仍来自 `aria-label`，安全。

#### 不适用 skeleton 的情况（PRD 要求说明理由）

- **`MonitorPage`「正在探测监控仪表盘 / 第 N/3 次尝试」→ 保持文案。**
  理由：这不是"取数"，是**带重试的探测**，结果可能是**失败**（探测失败时直接落到
  「监控仪表盘未连接」）。skeleton 承诺的是"内容即将出现在这里"；在可能永远没有内容的
  位置上摆一个内容剪影是**撒谎**。而且 `第 N/3 次尝试` 是真实进度信息。
- **`UsageOverviewPage`「正在扫描会话列表…」→ 保持文案（本轮不做）。**
  理由：首帧 `progress.total === 0`，此时连"有几个会话"都不知道，剪影的行数就是编的。
  等 `total > 0` 后它已经渲染真实内容了（KPI 行 + 图表）。属于**建议本轮不做**（见 §C.3）。
- **表格行自身的解析测量**（`measuredRows`）→ 不涉及。行在得到测量前已有
  `ESTIMATED_ROW_HEIGHT` 兜底，是尺寸估算不是加载态，加骨架反而闪。

#### 验收怎么看

- 断网/慢盘下重进应用：侧栏出现的是一列**灰条**而不是「加载中…」四个字。
- 会话头在读数到达前，四个数值位是四条等宽灰条（`usage-light` 里有读数的样子 → 未加载时应有四条 `3em` 条）。
- 主区在解析中出现 8 行表格剪影 + 一行百分比，且剪影结束后**页面高度不跳**。
- 系统开启「减弱动态效果」后：所有骨架**静止**、**可见**、**不闪**（截图对比两次渲染应完全一致）。

---

### B.3 侧栏工具栏重排（PRD 功能需求 3）

#### 问题（现状证据）

「刷新」改 `IconButton` 与「搜索框拿回全宽」**已经落地**。真正剩下的是一个**对齐缺陷**：

- `TextInput` 高 `--control-h`（28px）——`TextInput.module.css:4`
- `IconButton` 高 `--control-h-lg`（32px）——`Button.module.css:78`（`.icon { width/min-height: var(--control-h-lg) }`）
- 二者同行（`SessionList.module.css:18` 的 `.toolbar`，`align-items: center`）

截图证据：`analyzer-empty-light` 侧栏工具栏——搜索框与右侧 ↻ 图标**高度不等**，
图标是 32px 方框、输入框 28px，同一条线上差 4px，看着像没对齐。

#### 设计意图

工具栏是"一个输入 + 一个动作"，两者是同一档控件，应当等高。等高之后
`align-items: center` 才真正让它们共基线，而不是"各自居中导致顶底都不齐"。

#### 视觉规格

- `.toolbar`：**保持** `display: flex; align-items: center; gap: var(--sp-2); padding: var(--sp-3)`
  与 `border-bottom: 1px solid var(--border)`。
- `.search`：**保持** `flex: 1; min-width: 0`（搜索框吸收全部剩余宽度，已是目标态）。
- **新增 `IconButton` 的 `size` 变体**（`Button.tsx` / `Button.module.css`）：
  - `size?: "sm" | "md"`，默认 `"md"`（保持 32px，顶栏三个图标按钮不受影响）。
  - `"sm"` → `width: var(--control-h); min-height: var(--control-h)`（28px）。
  - **为什么加变体而不是在 `SessionList.module.css` 里覆盖**：覆盖会重演
    `ReportPanel` 注释里的旧伤（外层选择器特异性压过组件变体，把 primary 变成白底白字）。
    而且 28px 是 `--control-h` 这一档的既有语义，不是新尺寸。
- `SessionList` 的刷新按钮改用 `<IconButton size="sm" label="刷新会话列表">`。
- `label="刷新会话列表"` **不改**（`IconButton` 强制 label = 可访问名 + tooltip，两条都靠它）。
- 搜索框 `placeholder="搜会话 ID 或目录…"` **一字不改**（`smoke.spec:102` 用它定位）。

#### 无障碍

- 可访问名：刷新按钮 = `刷新会话列表`（`aria-label` + `title` 双绑，`IconButton` 既有行为）。
- 键盘：Tab 顺序 = 搜索框 → 刷新按钮 → 侧栏标签组 → 列表项。**不新增快捷键**。
- 命中区：28px 见方 ≥ 24px 最小命中区要求（`--control-h-sm`）。**不缩到 24px**：
  工具栏是低频点击区但不是触屏区，28px 与输入框等高带来的视觉收益更大。

#### 已知遗留（记录，不在本轮修）

`.search input { padding-left: calc(var(--sp-2) + 14px + var(--sp-1)) }` 里的 `14px`
是搜索图标尺寸（`Icon size={14}`）的字面量。图标尺寸目前无 token 体系，
token 化图标尺寸超出本轮范围（§C.3）。加注释说明「改图标 size 时此处同步」即可。

#### 验收怎么看

- `analyzer-empty-light` / `-dark` 侧栏工具栏：搜索框与 ↻ 的**上下边缘齐平**。
- 搜索框宽度 = 侧栏内容宽 − 图标 28px − `--sp-2`，即约 240px（不再是约 150px）。
- 顶栏的搜索/设置/主题三个图标按钮**仍是 32px**（没被改动波及）。

---

### B.4 行密度令牌（PRD 功能需求 4）

#### 问题（现状证据）

三张数据表三种行内边距，同为主数据表，切换视图时"呼吸感"会跳：

| 表 | 现状 | 文件:行 |
| --- | --- | --- |
| 记录表 `RecordTable` | `7px 9px` | `RecordTable.module.css:22` |
| 日志表 `LogView` | `6px 10px` | `LogView.module.css:20` |
| 耗时树 `TreeView` | `4px 9px 4px 8px` | `TreeView.module.css:54` |

纵向差 3px/行，一屏 20 行就是 60px 的位移——用户在「日志视图 ↔ 树视图」之间切换时，
整个表格的行会明显往上/往下跳一次。

#### 设计意图

行密度是**视图级属性**，不是组件级属性。用户切换视图看的是**同一批记录的不同切面**，
切面之间不该换一套密度语言。立令牌的另一个收益：以后要提供"紧凑/舒适"密度开关，
改一处即可。

#### 视觉规格（`tokens.css` 新增，与 `--row-h` 同组）

```
--row-pad-x: 10px;        /* 行水平内边距：三表统一 */
--row-pad-y: 6px;         /* 行垂直内边距：表格类（单行/双行内容） */
--row-pad-y-tight: 4px;   /* 行垂直内边距：树（行内有展开箭头+色块+进度条，需更紧） */
```

取值理由：
- **横向取 10px**（取 `LogView` 现值）：满足三表中最宽的那个，且 `--row-pad-x` 与
  表头 `padding: 0 10px`（`TreeView.module.css:21` 图例头已是 10px）对齐——
  表头与数据行的左右边距本来就该相同，现在树视图是 9 vs 10，差 1px 的错位。
- **纵向取 6px**：`LogView` 的现值，且 6 + `--lh-sm`(18) = 30 = `--row-h`，
  与表头高度一致（数据行 = 表头高度，是最省的密度自洽关系）。
- **树用 4px（= `--row-pad-y-tight`）**：树行内含 24px 的展开按钮与 10px 的进度条，
  6px 纵向会把它撑到 34px/行，一屏少两行；4px 让其回到 30px 档。
  **不用 `calc()` 表达 4px**：`calc(var(--row-pad-y) - 2px)` 会重新引入 `2px` 字面量，
  正中 tokens 纪律的枪口；第三档令牌比 calc 更诚实（这是对评审建议的一处修正）。

应用：
- `RecordTable`：`.container th, .container td { padding: var(--row-pad-y) var(--row-pad-x) }`
- `LogView`：同上（现值即目标值，本次只是换成令牌）
- `TreeView`：`.row { padding: var(--row-pad-y-tight) var(--row-pad-x) }`
- **不动 `--row-h`（30px，表头高）**，也不动 `ESTIMATED_ROW_HEIGHT` 等 TS 侧虚拟化估算
  （它们由测量兜底，改了反而要重新标定）。

> **依赖既有约定**：`LogView.module.css` / `RecordTable.module.css` 正被并行分支
> （表盘尺寸 + 表格横向滚动 + `ScrollArea`）修改。本规格**只确定令牌名与取值**；
> 实现时以并行分支合入后的现状为准，做**纯令牌替换**，不重排这两张表的其它属性。
> `TreeView` 的左侧 8px 由 TSX 内联 `paddingLeft: depth * 16 + 8` 覆盖（`TreeView.tsx:217`），
> CSS 里的左值本就是死值——替换时保留内联缩进不动。

#### 无障碍

纯尺寸改动，不影响语义。**保持** `vertical-align: top`（`LogView` 现为 `top`，
`RecordTable` 也为 `top`）——行内内容是多行摘要时不垂直居中，避免基线漂移。

#### 验收怎么看

- 同一会话在「日志视图」与「树视图」之间切换，**表格首行相对表格顶边的距离一致**，
  切换时行不跳。
- 三张表的左内容边距相同（不再出现 9 vs 10 的错位），且与表头文字左边距相同。
- 记录表行高从 32px（7+18+7）降到 30px，与 `--row-h` 表头等高。

---

### B.5 `Panel` 定性与 `ErrorBoundary` 收口（PRD 功能需求 5）

#### 问题（现状证据）

- **`Panel` 不是死代码**：`UsageOverviewPage.tsx` 有 4 处消费者
  （每日 Token 消耗 / 按项目分布 / 按模型分布 / 活跃时段 7×24）。
- 但仍有**五处手写 `.panel`**：`TokenPanel.module.css:1`、`ReportPanel.module.css:1`、
  `RecordDetailPanel.module.css:1`、`LogView.module.css`（`.container`）、
  `TreeView.module.css`（`.container`），外加浮层 `ThresholdsPanel.module.css:1`（性质不同）。
- **面板表面色已经分裂**：`components/Panel.module.css` 的 `.panel` 是 `--bg-elevated`、
  `.header` 是 `--bg-subtle`（深色下 = 亮底深头）；而 `TokenPanel`/`ReportPanel` 都是
  `--bg-subtle` 整面、无独立表头底色。同一屏（`settings-light` 里可见 Token/报告卡）
  两种卡片的"头/身"明暗关系是**反的**。
- **`ErrorBoundary` 的按钮是全局 CSS 里的第 6 套按钮画法**：
  `global.css:65` 手写 `padding/border/border-radius/background/color`，绕过 `Button` 组件。

#### 设计意图

「同样的卡片」不该有两种表面关系，否则用户在深色下会把「亮底深头」读成另一种卡片语义。
把 `Panel` 定为**唯一卡片原语**，并让它的表面关系与另外两张真正的面板
（`TokenPanel`/`ReportPanel`）一致：**一个 `--bg-subtle` 面 + 发丝边框 + 表头行（无独立底色）**。
`global.css` 里藏控件样式是"硬编码的第二个入口"——删掉它，让按钮只有一个来源。

#### 视觉规格

**`components/Panel.module.css` 两处改动**（浅色下视觉零变化，深色下可见）：
- `.panel { background: var(--bg-subtle) }`（原 `--bg-elevated`）
- `.header { background: transparent }`（删除原有的 `--bg-subtle`）
- 其余保持：`.panel` 的 `border: 1px solid var(--border)` / `--r-md` / `display:flex` / `overflow:hidden`；
  `.header` 的 `min-height: 40px` / `padding: 0 var(--sp-3)` / `border-bottom: 1px solid var(--border)`；
  `.body { padding: var(--sp-3) }`。

**`components/Panel.tsx` 增两个 props**（迁移所必需，不可省）：
- `ariaLabel?: string` —— 让 `<section>` 保留「Token 计数」「会话分析报告」这类可访问名
  （e2e 用 `getByRole("region", { name })` 定位，见 §C.1）。
- `titleAs?: "h2" | "h3"`，默认 `"h2"` —— `RecordDetailPanel` 若将来迁移需要 h3。

**迁移范围（明确收敛，不追求"五处全迁"）**：

| 卡片 | 本轮动作 | 理由 |
| --- | --- | --- |
| `UsageOverviewPage` 的 4 处 | **已在用 `Panel`**，不动 | — |
| `TokenPanel` | **迁移到 `Panel`** | 结构完全吻合：`section aria-label` + `h2` 标题 + 头部两枚 provenance 徽标（进 `actions` 槽）+ 表格体 |
| `ReportPanel` | **不迁移** | 它的 header 是「标题 + 分段控件 + 6 个按钮」的控件簇，`Panel` 的 `header` 是 `[h2][actions]` 两端对齐，塞进去会打架；强行适配等于给 `Panel` 加一堆特例 |
| `RecordDetailPanel` | **不迁移** | 它是右栏 `aside`（`<dl>` + 滚动 + 多处 `<section>`），不是 title+body 结构 |
| `TreeView` / `LogView` | **不迁移** | 它们是**表格卡片**：粘性表头沉到 `--bg-inset`（比数据行深），是"表头"这个概念的另一种约定，与"面板表头"不同类。二者已互相一致（`TreeView.module.css:10` 注释明说） |
| `ThresholdsPanel` | **不迁移** | 它是脱离文档流的浮层（`--bg-elevated` + `--shadow-md` + `--r-lg`），属浮层语言，不是卡片语言 |

> **对 PRD 的一次范围修正**：PRD 要求「五处手写同构 `.panel`」，但**这五处并不同构**
> （上面逐条给了证据）。强行统一会为了形式一致性而给 `Panel` 塞进 4 种特例，
> 反而制造更深的耦合。**验收标准「不存在有测试但无消费者的组件」已经满足**
> （`Panel` 有 5 处消费者：用量 4 + 迁移后的 TokenPanel）。
> 请维护者确认这一收敛——**我的推荐：接受**，并在 `Panel.tsx` 顶部注释里写清
> 「哪些卡片该用它、哪些不该」，避免下一轮再把 `ReportPanel` 当漏网之鱼。

**`ErrorBoundary` 收口**：
- `<button type="button" onClick={…}>重试</button>` → `<Button type="button" variant="danger">重试</Button>`
  （`Button` 已有 `danger` 变体：`color: var(--danger)`、hover `--danger-soft` 底）。
- 删除 `global.css:65-73` 的 `.error-boundary button { … }` **整块**。
- **保留** `.error-boundary` / `.error-boundary pre`（它们是布局与排版，不是控件样式）。
- 视觉变化（可接受，记录在案）：按钮描边由 `--danger` 变为 `--border-strong`
  （hover 才变 `--danger`）。这是 `danger` 变体的既定口径，本次以「按钮只有一个来源」
  优先于「这一颗按钮描边更红」。

#### 无障碍

- `Panel` 的 `h2`/`h3` 由 `titleAs` 决定，保证文档大纲层级正确（`TokenPanel` 在页面里是 h2 级）。
- `Panel` 加了 `ariaLabel` 后，`<section aria-label>` 成为 landmark region——
  **只在调用方确实需要被定位时才传**（`TokenPanel`、`ReportPanel` 需要；用量页 4 处不传）。
- `Button` 自带 `:focus-visible` 2px ring 与 `:disabled` 0.5 透明度，`ErrorBoundary` 的
  「重试」在启用态下键盘可见焦点，比原来手写的（无 focus 样式）更好。

#### 验收怎么看

- 深色下（`settings-dark`、`usage-dark`）：所有卡片的头/身**同一个面**，
  只用一条发丝线分隔；不再有"亮底深头"的卡片。
- `usage-light` 的 4 张卡片与 `settings-light` 里展开的 Token 卡，**圆角、边框、内边距、
  标题字号（`--fs-base`/600）完全一致**。
- `global.css` 里不再有任何 `button { … }` 选择器（可 grep）。
- 触发一次渲染异常（或临时抛错）：出现的是与全站同款的 `Button`（描边/hover/focus 一致）。

---

### B.6 状态灯语义化（PRD 功能需求 6）——**复核，不重做**

#### 问题（已解决，此处仅存档口径）

原缺陷：`SessionHeader` 的 8px 圆点常亮 `--success`，不表示任何状态。
截图 `analyzer-tree-light` 中标题「解释这段代码」左侧的圆点即该灯。

#### 已落地的规格（复核用）

- 三态：`has-errors → --danger`、`active-today → --success`、`idle → --text-faint`。
- 优先级：**错误压过新鲜度**（今天跑过又失败 → 红而非绿），
  理由已在 `sessionHealth.ts` 注释中写明（"recent" 是环境，"broken" 是可行动的）。
- 可访问文本：`含失败记录 / 今日活跃 / 历史会话`（`sessionHealthText`），
  经 `.srOnly` 提供给屏幕阅读器——**颜色之外有文字**，色弱与高对比场景可辨。
- 灯本体 `aria-hidden="true"`（语义由 srOnly 文本承担）。

#### 本轮唯一建议的微调（可选，低风险）

当前是「`aria-hidden` 的灯 + 独立 srOnly 文本」两个节点。建议合并为一个：
`<span role="img" aria-label={sessionHealthText(health)} title={sessionHealthText(health)} className={…} />`。
收益：**鼠标用户也能读到状态**（`title` 悬停提示），而现状对鼠标用户完全不表达——
一个放大镜用户看不出"这个灰点是什么意思"。
代价：屏幕阅读器读法由"一段文本"变为"一个图像角色"，信息量不变。

> **待定，需要维护者决策（2 处）**：是否做这处微调。**我的推荐：做**——
> 零成本、纯增信息、不动颜色语义。若维护者认为 `role="img"` 会改变 SR 读序，保持现状亦可接受。

#### 验收怎么看

- 今天有活动的会话：绿点；含失败记录：红点；更早的会话：灰点——
  三种会话同时出现在侧栏里，逐条对比（`analyzer-tree-light` 侧栏下滑可见多条）。
- 键盘/读屏：Tab 到会话标题区域，能听到「含失败记录」等文案。
- 深浅两主题下三色都可辨（`--success/--danger/--text-faint` 在 `--bg-subtle` 上）。

---

### B.7 筛选控件统一为 chip-toggle（PRD 功能需求 7）

#### 问题（现状证据）

`FilterBar` 里「同一个多选开关」概念用了两种控件：

| 组 | 现状 | 文件 |
| --- | --- | --- |
| 记录类型（可多选） | 原生 `<input type="checkbox">` ×6 | `FilterBar.tsx:82-92` |
| 状态 | `Button variant="ghost"` + `aria-pressed` ×2 | `FilterBar.tsx:96-105` |

可见差异（截图 `analyzer-tree-light`、`settings-light` 的筛选条）：
左边的复选框是**小方块**、右边 成功/失败 是**28px 高的描边按钮**；
两种点击手感、两种命中区、两种视觉重量，还共用一行。**表单感与仪器气质相悖**。

#### 设计意图

「多选开关」是一个概念。用户点「工具」和点「失败」时，脑子里的动作是同一个
（切换一个筛选条件）；界面不应当让他用两套肌肉记忆。统一后，
筛选条从"一堆表单控件"变成"一排可拨的开关"，与「仪器面板」的读数-开关语言同频。

#### 视觉规格（chip-toggle，`.chip`）

结构：**保留 `<fieldset><legend>`**（`legend` 是可见的组标签，也是组的可访问名来源）。
组内每一项：

- 元素：`<button type="button" aria-pressed={on}>` （**沿用既有先例**，
  `FilterBar.module.css:73` 已在状态组用 `aria-pressed` 表达按下态）
- 尺寸：`min-height: var(--control-h-sm)`；`padding: 0 var(--sp-2)`；`border-radius: var(--r-sm)`
- 排版：`font-size: var(--fs-sm)`；`line-height: var(--lh-sm)`；`font: inherit`；`cursor: pointer`
- 组内间距：`gap: var(--sp-1)`

| 状态 | 规格 | 非颜色信号 |
| --- | --- | --- |
| **default** | `background: var(--bg-inset)`；`border: 1px solid var(--border)`；`color: var(--text-secondary)` | — |
| **hover** | `background: var(--bg-hover)`；`border-color: var(--border-strong)`；`color: var(--text)` | 亮度提升 |
| **pressed**（`[aria-pressed="true"]`） | `background: var(--accent-soft)`；`border-color: var(--accent)`；`color: var(--text)`；`font-weight: 600`；`box-shadow: inset 2px 0 0 var(--accent)` | **2px 内嵌左竖条**（本项目既定的色弱信号，见 `SessionList.module.css:198` 注释）+ **字重 600** |
| **focus-visible** | 不自绘，交给全局 ring | 2px 环 |
| **disabled** | 本组件无禁用项，不定义 | — |

**为什么沿用 `inset 2px 0 0` 而不是自创一个"选中勾"**：本项目已经用
「`--accent-soft` 底 + 2px 内嵌竖条」表达过三种"按下/选中"（侧栏会话行、三张表的焦点行、
状态筛选按钮）。**再加第四种画法（勾选符号）等于增加一门要学的语言**——
本轮的目标是减少语言，不是增加。竖条在 24px 高的 chip 上贴左内缘，圆角会自然裁切，成立。

#### 无障碍

- **可访问名必须逐字不变**（e2e/单测与用户可见文案都靠它）：
  - 记录类型：`用户`、`LLM`、`工具`、`Agent`、`workflow`、`等用户`
  - 状态：`成功`、`失败`
- 组名：`legend` 保留 `记录类型（可多选）` 与 `状态`（原样）。
- 按下态：`aria-pressed="true|false"`（不是 `aria-checked`——它们是按钮，不是复选框）。
- 键盘：Tab 依次经过每个 chip；`Space`/`Enter` 切换（`<button>` 原生行为）。
  **不做 roving tabindex**——这些开关彼此独立，"一次 Tab 穿过整组"会让漏选更容易。

#### 必须同步的测试改动（PRD 明确允许，需在 PR 里说明）

- `FilterBar.test.tsx:12` `screen.getByLabelText("用户")` **会失效**——
  checkbox 换成 `button` 后，`getByLabelText` 不再匹配（label 包裹关系消失）。
  改为 `screen.getByRole("button", { name: "用户" })`。
- `FilterBar.test.tsx:60` 的 `getByRole("button", { name: "失败" })` **不受影响**（本就是按钮）。
- e2e：**已核实无任何用例选择筛选 chip**（grep `aria-pressed|checkbox|记录类型` 于 `e2e/` 为空）
  → e2e 风险为零。
- **可访问名一个字都不改**，因此即便将来有 e2e 加入，选择器也稳定。

#### 验收怎么看

- `analyzer-tree-light` / `-dark` 筛选条：六个类型 chip 与两个状态 chip
  **同高、同圆角、同内边距、同间距**；不再出现方块复选框。
- 点「工具」与点「失败」：**反馈完全一致**（同一个 `--accent-soft` 底 + 2px 竖条）。
- 「记录类型（可多选）」「状态」两个 legend 文字仍在。
- 未按下与按下的 chip 在**灰度截图**下可区分（靠竖条与字重）。

---

### B.8 令牌收尾（PRD 功能需求 8）

#### 问题（现状证据，已重新核实）

| 项 | 评审说法 | 当前事实 | 结论 |
| --- | --- | --- | --- |
| `--r-lg` | 全仓无消费者 | `SearchPalette.module.css:20`（命令面板）、`StatusToast.module.css:18`（Toast）两处消费者 | **保留**，补注释说明分工 |
| `--warning` | 只在 `TokenPanel.unknown` 用了一次 | 4 处：`ProvenanceBadge`（estimated/inferred）、`VersionBadge`（beta 徽章）、`UsageOverviewPage`（kpiNote）、`TokenPanel`（unknown） | **保留**，补注释确立语义 |
| 微间距字面量 | 25 处 2px/3px/6px | grep 实为 **46 处**含 2px/3px/6px，其中约 7 处是描边宽度（见下） | **分类处理后**收进令牌 |

#### 设计意图

`tokens.css` 自立"不得出现字面量"的规矩时只点了颜色/高度/圆角/时长四项，**间距漏立**。
不补这一条，规矩就只剩一半，而"差一步"的纪律比"没有"更容易腐化
（它让人按错误前提行动——以为已经全部 token 化了）。

#### 视觉规格

**① `--r-lg` 与 `--warning`：保留，并写清分工（改的是注释，不是值）**

- `--r-lg`: 在 tokens.css 补一句「**脱离文档流的浮层专用**（命令面板、Toast）。
  文档流内的卡片一律 `--r-md`；`--r-lg` 让"浮起来"在形状上也有信号」。
  这正好解释了它为什么只有两个消费者——**这不是巧合，是分工**。
- `--warning`: 确立语义为「**非确定信息**」——估算的成本、未知的定价、先行版（beta）、
  未被定价的模型。与 `--danger`（确定的错误）、`--success`（确定的读数）并列成三档"确定性"。
  这也解释了 `ProvenanceBadge` 里 `.inferred`（推算档）与 `.estimated`（估算档）
  **共用同一档描边色**（"都是非读自日志，差异在文案而非颜色等级"）——与已有注释一致。
- **两者都不删**。删掉反而要向这两处调用点引入新概念。

**② 新增两档微间距令牌（`tokens.css`，并入 `--sp-*` 序列）**

```
--sp-05: 2px;   /* 半档：分段控件的槽内缩、chip/控件微调 */
--sp-15: 6px;   /* 一倍半档：fieldset 底内距、徽标左内距、详情行距 */
```

**外加一条纪律（写进 tokens.css 头部注释）**：
> 间距（`gap` / `padding` / `margin`）**必须**来自 `--sp-*` 档位；
> `--sp-05`(2) / `--sp-1`(4) / `--sp-15`(6) / `--sp-2`(8) / `--sp-3`(12) /
> `--sp-4`(16) / `--sp-5`(24) / `--sp-6`(32) 即全部合法档位，**不得新造其它数值**。
> **描边宽度与图形尺寸不受此约束**（见下）。

**③ `3px` 归并掉**：`FilterBar.module.css:40` 的 `gap: 3px`（label 内文字与控件间距）
是**全仓唯一**一处 3px 间距 → 改为 `var(--sp-1)`（4px）。1px 的视觉差不可见，
换来的是档位表里少一个数。

**④ 明确不做 token 化的字面量（写进注释，避免下轮再被当漏网）**

- `box-shadow: inset 2px 0 0 var(--accent)`（选中竖条，约 7 处）
- `outline: 2px solid var(--ring)`（焦点环，`global.css` / `Button` / `TextInput`）
- `border-left: 2px solid`（`LogView` 类型徽标）、`border-left: 3px`（`ReportMarkdown` 引用条）
- `height: 6px`（`LogView` 占比条）、`top: 2px/6px`（`TimelineTrack`）、`min-width: 2px`
- `width: 8px / 10px`（`TreeView` 色块、`usage` 图例色块）

理由：这些是**描边宽度与图形尺寸**，不是"间距档位"。把它们塞进 `--sp-*`
会让间距序列混入非间距值（"6" 同时是"行距"和"条高"，语义立刻烂掉）。
纪律的价值在于边界清晰——**"间距必须 token、描边与图形尺寸不受限"**是一条可执行的线；
"什么都必须 token"不是（它会催生 `--bar-w-2: 2px` 这种为 token 而 token 的产物）。

#### 验收怎么看

- `grep -rnE "(gap|padding|margin)[^;]*: [^;]*\b(2px|3px|6px)\b" web/src --include=*.css`
  **除 `tokens.css` 外应无命中**（除组件内已注明豁免的图形尺寸）。
- 报表/筛选/侧栏在浅深两主题下**几何零变化**（纯令牌替换，不应有像素位移）。
- `tokens.css` 头部注释的纪律条目与既有四项并列，读起来是同一份规矩。

---

### B.9 行内动作密度与表格信息层级（维护者追加输入）

> 触发：H1 修好日志表横向可达后，**原本被裁掉、用户根本看不见**的两个行内动作
> （「展开」+「在树视图定位」）现在全时可见——六行十二个按钮挂在表格右端。

#### 问题（现状证据）

- `LogView.tsx:352-374` 的 `.actions` 单元格每行渲染 1–2 个 `Button`：
  「展开/收起」常驻，「在树视图定位」在 `primary` 存在时常驻。
- 截图 `analyzer-report-light`：日志表最右侧两列各排一列同款描边按钮，六行共 12 颗。
- `RecordTable.tsx:200-211` 同样每行一颗「展开」，六行六颗。

#### 设计意图：行内动作的层级模型（本轮的核心判断）

一行数据能承载的动作有三层，**每层只允许一个控件**：

| 层级 | 动作 | 归属 | 现状 |
| --- | --- | --- | --- |
| **主操作** | 选中这条记录 | **行本身**（整行可点 → 打开右侧详情栏） | 已由行承载 ✅ |
| **次操作** | 就地展开原始载荷 | 行尾的一个**展开器** | 现在是描边文字按钮 ❌ |
| **低频动作** | 在树视图定位 | **展开后的详情内** | 现在挤在行尾 ❌ |

**判断依据（沿用 §A 的唯一标准）**：一个在**每一行都长得一样、且不携带行级信息**的控件，
重复 N 次不产生 N 份信息——它产生 N 份视觉噪声。当前行尾的两个按钮正是这一类：
「在树视图定位」在六行上完全相同，它的存在只回答"这个功能存在"，不回答"这一行有什么"。
按"每个视觉元素都承载信息"的标准，它**不配占据扫描视图（折叠态）的常驻位置**。

反过来说，**不能靠"藏"来解决**：藏起来等于把"不产生信息"换成"不产生可达性"，
两个都不是好设计。正确的解法是**给它一个承载上下文的、常驻可达的家**——
而不是让它消失。

#### 规格 R1：展开器由文字按钮改为图标切换器（LogView + RecordTable）

- 元素：`<button type="button">`，字形子节点 `▼`（展开态）/ `▶`（收起态）。
- 视觉（**复用本项目已有的展开器画法**，即 `TreeView.module.css:73` 的 `.toggle`）：
  - `width: var(--control-h-sm)`；`height: var(--control-h-sm)`；`padding: 0`
  - `border: 0`；`background: transparent`；`color: var(--text-tertiary)`
  - `font-size: var(--fs-xs)`；`line-height: var(--lh-xs)`；`cursor: pointer`
  - **不引入图标库**：`▶`/`▼` 是字形，`Icon.tsx` 里没有、也不需要新增 SVG。
- 各态：
  | 状态 | 规格 |
  | --- | --- |
  | default | `color: var(--text-tertiary)` |
  | hover | `color: var(--text)`（**新增**：`TreeView` 的 `.toggle` 现在没有 hover 态，是个缺口，随手补上并统一） |
  | focus-visible | 全局 2px ring（不自绘） |
  | disabled | 不需要（展开器无禁用态） |
- **可访问名保持 `展开` / `收起` 不变**（用 `aria-label`）。
  理由：① 该按钮位于表格行内，屏幕阅读器会连同列头（`<th aria-label="行操作">`）报读，
  上下文已经足够；② **改名会无谓地打掉 4 处既有单测**
  （`LogView.test.tsx:86/174`、`RecordTable.test.tsx:48`、`SessionAnalyzerPage.test.tsx:117`
  全部用 `getByRole("button", { name: "展开" })`）。
  ③ `TreeView` 用的是带上下文的 `展开 <节点名>`——那是 `role="tree"` 里需要自证的场景；
  两处**画法统一、命名按上下文各取合适**，不强行统一，避免连锁改测。
- `aria-expanded={expanded}` 保留（它是状态的机器可读形态，字形是它的视觉形态——两者同源）。
- `title` = `展开` / `收起`（tooltip，鼠标用户可读）。

**收益**：行尾从一个 28px 描边按钮缩到 24px 无边框字形，六行同款按钮的"按钮墙"消失；
且 `▼/▶` 本身**携带状态**（折叠/展开），比一个恒定的"展开"边框框更有信息。

#### 规格 R2：「在树视图定位」移入**展开后的详情**（不是删除，不是悬停）

- 位置：该行**展开后**的详情区**顶部**，作为一条动作条（右对齐，
  `justify-content: flex-end`，`gap: var(--sp-2)`，
  与下方 payload 分区之间用 `var(--sp-3)` 分隔）。
  - **必须在顶部**：展开区里的 `<pre>` 最高 240px，动作条放底部会被推到折叠区外看不见。
  - **右对齐**：与表格右侧的动作列同侧，展开时视线不需要横跨整行。
- 渲染条件：**仅当该行有记录**（`primary` 存在）时渲染。与今天的条件一致——
  因此「等用户/轮间间隙」这类无记录行展开后**不会**出现该按钮
  （`LogView.test.tsx:169` 的否定断言语义继续成立）。
- 视觉：`Button` 默认（secondary）变体，**与右栏详情面板里的那颗完全同款**——同一动作同一长相。
- `RecordDetailPanel` 里既有的「在树视图定位」（`RecordDetailPanel.tsx:207`）**保留不动**。
  两者不是"有害的重复"：它们的**触发路径不同**（`选中该行` vs `就地展开该行`）、
  **上下文不同**、且任一时刻只会有其中一处可见；而本轮要消灭的是
  "六行十二个按钮**同时并存**"的常数噪声。文档层面的口径是：
  > **同一个动词可以有两处上下文入口，但必须共用同一种画法。**

#### 规格 R3：明确不做「悬停才出现」

**不做。** 理由逐条对齐维护者给的约束：

- **发现性**：hover 揭示把"功能存在"这个事实本身藏进了一个用户不会主动试探的状态。
  用户不会悬停一个"看起来什么都没有"的单元格。
- **键盘可达性**：`focus-within` 虽然能给键盘等价呈现，但**它仍要求用户先把焦点移进那一行**
  ——在用户不知道那里有东西之前，他不会移进去。
- **触摸/触控板**：hover 在有触控板的 macOS 上可用，但 Tauri 应用不保证永远只有这一种输入。
- 本项目**没有任何一处**用 hover 揭示功能（hover 一律只做**反馈**：`--bg-hover` 底、
  边框变色）。引入第一处会破坏这条纪律——而本轮的主题正是**减少例外**。

#### 表格信息密度判断（列级，只判断不删列）

以日志表（`LogView`，9 列）与记录表（`RecordTable`，7 列）为准，按"用户实际会不会读"分四档：

| 档 | 列 | 判断依据 |
| --- | --- | --- |
| **一眼扫读**（每行必读） | `时间`、`类型`、`操作 / 摘要` | 这三列回答"什么时候、谁、干了什么"，是定位异常的主路径；`类型` 还带类别色边（`LogView.module.css:62`），扫读时靠色带跳读 |
| **判读**（中频） | `耗时`、`状态` | `耗时` 是本工具存在的理由，常读；`状态` **只在异常时被读** |
| **按需**（低频、数值宽） | `提示词 / 输出` | 只有在查 token 消耗时读；数值本身很宽，是列宽的消耗大户 |
| **多半不被读** | `占比`（百分比文字部分）、`记录ID`（`RecordTable`） | 见下两条 |

**最重要的一条观察（不删，只记）：`耗时` / `占比` / `waterfall` 是同一个量的三种表达。**

- `耗时` = 数值（4.70s）
- `占比` = 相对时间轴的百分比（87.5%）+ 一条 `shareTrack` 进度条
- `waterfall` = 同一相对位置画成横向条

三列同屏，等于**每行把同一件事说三遍**。这在"仪器面板"语言里是**冗余而非丰富**：
真正丰富的表达是三个**不同维度**并排（例如"耗时 / token / 类型"），
而这里是同一维度的三次转述。
**→ 建议后续讨论（产品决策，本轮不删任何列）**：是否保留其中一列作为主表达、
另外两列降级为 hover/tooltip。

**第二条（同上，不删只记）**：`占比` 列里 `shareTrack`（56px 进度条）与
`shareText`（"87.5%"）也是同一信息的两次表达。
百分比数字的价值在于**精确**、进度条的价值在于**一眼可比**，两者都有理由存在，
但当前各占一份固定宽度（`min-width: 42px` + 56px），这是列宽偏紧的一个来源。
**→ 建议后续讨论。**

#### 降级建议（**只降视觉层级，不删任何信息**）

**① 状态列的「正常」降为 `--text-tertiary`**

- 现状：`LogView.tsx:349` 的 `正常` 无 class → 默认 `--text`，与"操作·摘要"同重。
  于是 6 行里有 5 行挂着一个和主信息一样响的「正常」。
- 改为：非异常值用 `--text-tertiary`；异常值保持 `--danger`（并在 600 字重下）。
- 效果：**扫读时异常自己浮出来**——一列从"6 个等重的词"变成"只有失败在亮"。
  这是**增加信息**（异常的信号强度提升），不是减少信息。
- **禁止用 `--text-faint`**：tokens.css 与 `SessionList.module.css:147` 的注释都立过规矩——
  `--text-faint` 是 2.6:1 的**装饰**位，而"这条记录没失败"是需要读的状态信息。
  用 `--text-tertiary` 是这一档能给出的最低可读层级。
- 同一改动同步到 `RecordTable` 的状态列（`RecordTable.tsx:197`），理由同上——
  同一概念在两张表里不该两种写法。

**② 「—」与「正常」两种"无异常"写法（同一列内）→ 统一，但属内容改动，标注后议**

`statusLabel`（`LogView.tsx:395`）对 `na` 返回「—」、对 `ok` 返回「正常」。
同一列里两种"没有异常"的表达，扫读时会让人以为" —" 缺失了什么。
**→ 建议后续讨论**（涉及状态语义，超出视觉轮范围）。

#### 无障碍

- 展开器：`aria-expanded` + `aria-label="展开"/"收起"` + `title` 三件套；
  字形 `▼/▶` 需 `aria-hidden`（它是 `aria-expanded` 的视觉对应，不重复朗读）。
- 「在树视图定位」移入展开区后：仍是一个带文字标签的 `Button`，
  键盘路径为 **Tab 进表格 → ↑↓ 移动行焦点 → Tab 到行内展开器 → Enter 展开 →
  Tab 进入展开区 → Enter 激活**。全程不依赖鼠标，且**每一步都有可见焦点**。
- 行尾动作列的列头 `<th aria-label="行操作" />` 保持不变（空列头 + 可访问名，既有约定）。

#### 验收怎么看

- `analyzer-report-light` / `-dark` 日志表右端：**每行只剩一个 ▼/▶ 字形**，
  不再有"展开""在树视图定位"两列描边按钮。
- 展开任意一行：动作条出现在**展开区顶部**（右对齐），含「在树视图定位」，
  与右栏详情里那颗**长得一模一样**。
- 展开「等用户」这类无记录行：**没有**动作条（只有等待区间说明）。
- 键盘：Tab 到行内展开器时**看得见焦点环**，Enter 展开后 Tab 能进入展开区。
- 状态列：正常值明显比"操作·摘要"轻，失败值仍清楚可辨；**灰度截图**下失败仍然突出。
- hover 任意一行：除 `--bg-hover` 底色外**不出现任何新控件**（验证没有引入 hover 揭示）。

---

## C. 风险与取舍

### C.1 最容易打破既有 e2e 选择器的地方

按风险排序（**已逐条 grep 核实**）：

| 风险 | 具体 | 规避 |
| --- | --- | --- |
| 分段控件抽组件 | 13 处 e2e 调用 `getByRole("tab", { name })` + `aria-selected`（`smoke` / `usage-overview` / `keyboard-nav` / `screenshots` / `billing-window` / `search-palette` / `facade-visual`） | **组件必须保留** `role="tablist"` / `role="tab"` / `aria-selected`；**六个调用点的 tab 文案一字不改**（`日志视图`/`树视图`/`时间线`/`项目`/`会话分析`/`用量总览`/`实时监控`/`近 N 天`/`缓存读取`/报告四档）。`search-palette.spec:46` 用了 `exact: true`，改文案会直接挂 |
| roving tabindex | 组件内非选中项变 `tabIndex={-1}` | e2e 全部用 `role` 点击/断言，不依赖 `tabIndex`；`screenshots.spec` 亦然 |
| `TokenPanel` 迁 `Panel` | `smoke.spec:79` `getByRole("region", { name: "Token 计数" })`、`:85` `getByRole("rowheader", { name: 标签 })`、`:88` `toContainText("usage.input_tokens")`、`:91` `toContainText("成本未知 · 未收录该模型定价")` | `Panel` 必须支持 `ariaLabel` → `<section aria-label="Token 计数">`；表格结构（`<th scope="row">`）与两句文案**原样搬入 `Panel` 的 body** |
| `FilterBar` 单测 | `FilterBar.test.tsx:12` `getByLabelText("用户")` | 同步改为 `getByRole("button", { name: "用户" })`，PR 里注明 |
| `LogView` 行内动作（§B.9） | `LogView.test.tsx:110` 直接点行内「在树视图定位」；`SessionAnalyzerPage.test.tsx:559` 用 `getAllByRole("button", { name: "在树视图定位" })[0]`——**此刻没有任何行是展开的，动作移入展开区后匹配数为 0** | 两处都改为「先展开该行 → 再点展开区里的按钮」；`LogView.test.tsx:169` 的否定断言语义不变（无记录行不渲染该动作）。**展开器改名会额外打掉 4 处**（`LogView.test.tsx:86/174`、`RecordTable.test.tsx:48`、`SessionAnalyzerPage.test.tsx:117`）→ 故 §B.9 R1 规定**可访问名保持「展开/收起」不变**，恰好规避这 4 处 |
| 空态/布局不变量 | `smoke.spec:166-211` 量「选择一个会话开始分析」的居中与表格内部滚动 | **不动**未选中会话的空态分支；`ScrollArea` 由并行分支负责，本规格不碰 |
| 会话定位选择器 | `button[title]:has(strong)`（多处） | 侧栏 `SessionButton` 的 `title` 与 `<strong>` 结构不动；`IconButton` 带 `title` 所以工具栏图标会被这个选择器算进来——**已由既有注释交代**，本轮新增 `IconButton size` 不改变其 `title` |

### C.2 深浅两主题容易失衡的地方

- **分段控件滑块**：浅色下滑块 `--bg-subtle`(#fff) 与顶栏背景同色，靠**槽**（`--bg-inset`）
  框出来才可见；深色下同理（滑块 #14161a = 顶栏，槽 #0a0b0d 更暗）。
  → 验证方法：两主题下**只看槽的边界**是否能读出一个"凹陷的控件"。
  若深色下滑块"消失进顶栏"，不要加边框——先检查槽的 `--bg-inset` 是否真的比顶栏深。
- **骨架条**：`--bg-hover` 在浅色 (#f1f3f5 on #fff) 与深色 (#212429 on #14161a) 的对比度不同，
  深色下更"亮"一点 → 呼吸幅度 (0.55→1) 在深色下观感更强。两主题都要看，**以深色为准调幅度**。
- **chip 的 pressed 态**：`--accent`(`#2952cc`) 描边在浅色 `--bg-inset` 上清楚；
  深色下 `--accent` 是 `#7fa8ff`，在 `--bg-inset`(#0a0b0d) 上很亮 → 深色下 chip 会更"跳"。
  可用 `--accent-soft` 的填充承担主视觉、描边保持 `--border-strong`；
  **两主题各出一张筛选条截图对比后再定**（这是唯一需要"看"而不是"算"的一处）。
- **`Panel` 表面 lowered**：深色下 4 张用量卡从 `--bg-elevated`(#1a1d21) 改为
  `--bg-subtle`(#14161a)，会与 `--bg`(#0d0f12) 更接近 → 卡片边界变弱。
  验证方法：`usage-dark` 里卡片边框（`--border` = rgba(255,255,255,0.07)）是否仍能读出一张卡。
  若太弱，**在深色下把 `.panel` 表面改为 `--bg-elevated` 而把 `.header` 保持 transparent**
  ——即保留"深色下卡片比页底亮一档"的既有台阶，只去掉"头比身高一档"的分裂。
  （这是本次唯一一处可能需要按主题分叉的地方，**推荐优先试单值方案**。）

### C.3 建议本轮不做（附理由）

**理由分三类：不在 PRD 范围 / 收益低于风险 / 缺少真实用户证据。**

| 不做项 | 理由 |
| --- | --- |
| `TimelineTrack` hover 准线 + 时间气泡 + 块宽按时长映射（评审 #2 余项） | 不在本轮 PRD 的 7 条功能需求内；`TimelineTrack` 本轮未列入改动面。**另开 Issue**，它值得单独一轮（时间轴是另一个信息层级问题，混进一致性轮会失焦） |
| 类别色 `--cat-*` 的 `-soft` 变体、对比度脚本、`--chart-*` 扩展（评审 #4 余项） | 前置依赖已经就位（`--chart-*` 已存在），但没有消费方——**没有图要画就先不加色**，否则又是"无消费者的资产" |
| `Toast` 离场过渡（评审 5 余项） | 不在 PRD 范围；且这是动效，本轮基调"不加装饰性动效"，需要单独论证它对"信息"的贡献 |
| `ReportPanel` / `RecordDetailPanel` / `TreeView` / `LogView` 迁移到 `Panel` | 见 §B.5 的证据：这四处**不同构**，强迁会制造特例耦合。`Panel` 的"死代码"前提已不成立 |
| 图标尺寸 token 化（`Icon size={14}` 与 `.search input` 里的 `14px`） | 图标尺寸没有档位体系，token 化要先把 6 个图标尺寸收敛成 2 档——那是一次独立的重构，不在"令牌收尾"范围 |
| `UsageOverviewPage` 首帧 skeleton | 见 §B.2：`progress.total === 0` 时行数是编的；扫得很快，收益低 |
| `aria-controls` / `role="tabpanel"` 完整接线 | 六个调用点多数没有对应的 panel 容器，接线要新增 DOM 与 id；e2e 全靠 `role=tab`，接线是纯风险无收益 |
| 筛选 chip 的 roving tabindex | 独立开关用 Tab 逐个穿过是正确语义，见 §B.7 |
| 密度切换开关（紧凑/舒适） | 令牌立起来之后是自然下一步，但**没有用户证据说需要**。先把三表统一，观察是否需要第二档 |
| **hover / focus-within 才显示行内动作** | 见 §B.9 R3：同时伤发现性与键盘可达性；且本项目**从无 hover 揭示功能的先例**（hover 一律只做反馈），引入第一处会破坏"减少例外"的本轮主题 |
| 删除 `耗时` / `占比` / `waterfall` 中任一一列，或删除 `记录ID` 列 | §B.9 已判断它们确有冗余（`耗时`/`占比`/`waterfall` 是同一个量的三种表达），但**删列/改列序是产品决策**，且本轮冻结信息架构 → 只记「建议后续讨论」，不在本轮执行 |
| 统一「—」与「正常」两种无异常写法（§B.9） | 涉及状态语义（是不是真的"没有异常"），超出视觉轮范围 → 记录后议 |

---

## D. 验收清单（设计师视角）

维护者拿着这一节去**目验截图**即可判断本轮是否达标。分四组。

### D.1 一致性（这是本轮的主题，权重最高）

- [ ] **分段控件六处一个样**：并排 `analyzer-tree-{light,dark}` 顶栏、
      `usage-{light,dark}` 时间范围、`analyzer-report-{light,dark}` 报告范围——
      槽的圆角、内缩、项高、项间距一致；看不到"另一套分段控件"。
- [ ] **顶栏三项等宽、侧栏两项等宽**（`wide` / `equal` 变体生效）。
- [ ] **三张表同一种行呼吸**：`analyzer-log-{light,dark}` 与 `analyzer-tree-{light,dark}`
      在**同一会话**下，一屏的行数、行高、左内容边距一致；两视图来回切换，行不上下跳。
- [ ] **筛选条两个组一个样**：六个类型 chip 与 成功/失败 chip 同高同圆角；
      **看不到任何方块复选框**（`analyzer-tree-*` 的筛选条）。
- [ ] **卡片只有一个"头/身"关系**：`usage-*` 的 4 张卡与 `settings-*` 里展开的 Token 卡，
      表面同色、只用发丝线分隔；深浅两主题各看一遍。
- [ ] **仓库级**：`grep` 不到逐字复制的分段控件 CSS；`global.css` 里 `grep` 不到 `button` 选择器。

### D.2 状态语言（加载、按下、状态灯）

- [ ] **加载只有一种形**：侧栏首载是一列灰条（不是「加载中…」）；会话头读数未到达时
      是四条 `3em` 灰条（不是「…」）；主区解析中是表格剪影 + 百分比。
- [ ] **骨架在 reduced-motion 下静止**：开启系统"减弱动态效果"，骨架**可见**且**不动**
      （拍两张间隔 1s 的截图，像素应一致）。
- [ ] **按下只有一种反馈**：筛选 chip、侧栏会话行、表格焦点行的"选中/按下"都用
      `--accent-soft` 底 + 2px 内嵌竖条——**灰度截图**下仍可区分按下与未按下。
- [ ] **状态灯三态可辨**：侧栏同时存在绿点（今天活跃）、红点（含失败）、灰点（更早）
      三条会话，逐条对照 `analyzer-tree-{light,dark}`。
- [ ] **方向键可用**：聚焦任一标签组，`←/→/Home/End` 能在组内移动（并切换选中项），
      Tab 一次进、一次出整组。六处控件都能这样。

### D.2b 行内动作与信息层级（§B.9）

- [ ] **行尾不再有按钮墙**：`analyzer-report-{light,dark}` 日志表每行右端只有一个
      `▼/▶` 字形，看不到「展开」「在树视图定位」两列描边按钮。
- [ ] **展开器携带状态**：折叠行显示 `▶`、展开行显示 `▼`，且字形与 `aria-expanded` 同步。
- [ ] **低频动作有家且同款**：展开任意行，动作条出现在**展开区顶部、右对齐**，
      其中的「在树视图定位」与右栏详情里那颗**长相完全一致**。
- [ ] **无记录行不渲染该动作**：展开「等用户」行，只有等待区间说明，没有动作条。
- [ ] **没有引入 hover 揭示**：鼠标悬停任意行，除 `--bg-hover` 底色外不出现任何新控件。
- [ ] **纯键盘能走完全程**：Tab 进表格 → ↑↓ 移到目标行 → Tab 到展开器（**焦点环可见**）
      → Enter 展开 → Tab 进展开区 → Enter 触发定位。全程无鼠标。
- [ ] **状态列有层级**：正常值明显轻于「操作 / 摘要」（`--text-tertiary`），
      失败值保持显眼；灰度截图下失败仍突出。
- [ ] **未删任何信息列**：`时间/类型/操作·摘要/提示词·输出/耗时/占比/waterfall/状态`
      与 `记录ID/时间/类型/操作·摘要/耗时/状态` 列数不变。

### D.3 几何与对齐

- [ ] **侧栏工具栏齐平**：搜索框与 ↻ 上下边缘齐平（`analyzer-empty-{light,dark}`）。
- [ ] **顶栏图标按钮未被波及**：仍是 32px 见方。
- [ ] **表头与数据行左对齐**：三表表头文字的左边距 = 数据行内容的左边距（不再是 9 vs 10）。
- [ ] **行高自洽**：记录表数据行高 = 表头高（30px）。
- [ ] **卡片圆角/边框/内边距一致**：`--r-md` + 1px `--border` + `--sp-3`，全站卡片一致；
      `--r-lg` **只出现在浮层**（命令面板、Toast、设置浮层）。

### D.4 令牌与流程

- [ ] **`tokens.css` 是唯一来源**：新增/引用的每一个尺寸都能在 tokens.css 找到
      （`--sp-05` / `--sp-15` / `--row-pad-x` / `--row-pad-y` / `--row-pad-y-tight` / `--dur-pulse`）。
- [ ] **间距字面量清零**：`grep -rnE "(gap|padding|margin)[^;]*: [^;]*\b(2px|3px|6px)\b" web/src --include='*.css'`
      在 `tokens.css` 外无命中（**已就地注明的「形」尺寸**除外）。
      **唯一例外**：三张数据表的行内边距（`LogView` 的 `padding: 6px 10px` 等）由 H3b 的 §B.4
      统一为 `--row-pad-*`，不在 H3a 范围内——该条在 H3a 合并后仍有这 1 处命中，H3b 合并后归零。
- [ ] **`--r-lg` / `--warning` 保留且注释说明分工**（不是删掉）。
- [ ] **三处加载态共用同一个骨架原语**（`components/Skeleton.*`，无第二份实现）。
- [ ] **六处分段控件共用同一个组件**（`components/SegmentedControl.*`，无第二份实现）。
- [ ] **无"有测试无消费者"组件**：`Panel` 现有 5 处消费者。
- [ ] **截图全套重出**：`docs/screenshots/` 浅/深 × chromium/webkit 全部 9 个视图
      （`analyzer-empty/log/tree/report`、`usage`、`settings`、`monitor`）；
      若 README 有描述画面的文字，同步更新。
- [ ] **单测/e2e/lint 全绿**，既有用例一条不少（唯一允许的改动：`FilterBar.test.tsx`
      的类型 chip 选择器 `getByLabelText("用户")` → `getByRole("button", { name: "用户" })`）。
- [ ] **CHANGELOG `[Unreleased]`** 有中文条目，分类取 `Changed`（一致性/密度/加载语言的
      收敛都是行为可见的变更）；新增 `SegmentedControl`/`Skeleton` 两个组件可另记 `Added`。

---

## 附：需要维护者决策的四处（汇总）

| # | 决策点 | 我的推荐 | 若否决的备选 |
| --- | --- | --- | --- |
| 1 | 分段控件是**自动激活**（方向键即切换）还是手动激活 | **自动激活**（统一，符合 macOS 原生分段控件与 ARIA APG 默认；扫描成本被解析缓存吸收） | 仅顶栏改手动激活——**不推荐**，会破坏"一个规格" |
| 2 | 是否给状态灯加 `role="img" aria-label title`，让鼠标用户也能读到状态 | **做**（零成本、纯增信息） | 保持现状的 `aria-hidden` + srOnly 文本 |
| 3 | `Panel` 迁移范围收敛为「只迁 `TokenPanel`」，不追"五处全迁" | **接受**（五处确实不同构，`Panel` 已非死代码，验收标准已满足） | 强行全迁——需给 `Panel` 加 4 种特例，**不推荐** |
| 4 | 行内动作的处置（§B.9）：**图标展开器 + 「在树视图定位」移入展开区** | **推荐**。满足"不悬停、不隐藏、键盘可达"三条约束，并消除六行十二按钮的常数噪声；代价是 2 处单测改为「先展开再点」 | ① 只把「在树视图定位」留在右栏详情（**不推荐**：日志视图用户必须跳出视线，且右栏本来就已有该按钮，等于全靠右栏）；② hover/focus-within 揭示（**明确不推荐**，见 §B.9 R3） |
