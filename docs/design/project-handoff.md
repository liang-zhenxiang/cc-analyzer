# 项目接续（Issue #397）· UI/UX 设计规格

**一句话定位**：一个项目、一条时间序列、一串会话节点——回答「上次做到哪了」：每次会话**结束时**停在哪一步、两次之间隔了多久、这次开头有没有把上次结尾重新交代一遍。

作者：liangzhenxiang。日期：2026-11-28。本文只写视觉与交互规格，不含实现代码。所有尺寸以 **CSS px** 为单位；颜色以令牌名为准，文中出现的十六进制只是当前取值的参考，不复制进组件。

---

## 0 先对齐事实与口径

### 0.1 已核对的事实

| 事实 | 值 / 出处 |
| --- | --- |
| 卡片原语 | 表头 `min-height: 40px`、体内距 `var(--sp-3)`=12、`--r-md`、发丝边框、无阴影（`web/src/components/Panel.module.css`） |
| 用量页文档流 | 单列纵向 flex、卡间距 `var(--sp-3)`=12（`UsageOverviewPage.module.css:5-12`） |
| 「项目」档现状 | 只渲染 `ProjectMemoryPanel`，自带 `200px 左栏 + 右栏内容` 网格（`UsageOverviewPage.tsx:1234-1237`、`ProjectMemoryPanel.module.css:6-11`） |
| 现有项目 chip | 高 32（`--control-h-lg`）、选中 = 左缘 2px 竖条 + `--bg-hover`、名字省略、会话数等宽小字（`ProjectMemoryPanel.module.css:42-104`） |
| 窄窗 chip 条 | `≤1080px` 时左栏折到顶部、chip 横向滚动、选中改下缘 2px 竖条（`ProjectMemoryPanel.module.css:416-451`） |
| 回声口径 | `ECHO_THRESHOLD = 0.55`、`topicSignature` 汉字 bigram + 西文词、`jaccard`（`echoTopics.ts:31, 92-142`） |
| 回声的 prompt 截断 | `PROMPT_LIMIT = 200`（`echoTopics.ts:40, 262`） |
| 首条消息脱敏 | 规则表 1–10、折叠空白、trim、按码位截断；默认上限 80（`firstMessagePreview.ts`） |
| 活性阈值 | `LIVE_MS = 120_000`；「live」只说明最近 2 分钟有记录，**不代表会话正在运行**（`pulseModel.ts:24, 37-43`、`PulsePage.tsx:296`） |
| 项目名 | `formatProjectPath(label, cwd)` 取 cwd 的 basename；无 cwd 时退回去掉前导 `-` 的编码名（`lib/format.ts:206-211`） |
| 时间格式 | `formatShortStamp` = `MM-DD HH:mm`；`formatDuration` 用中文档位（`lib/format.ts:17-37, 144-148`） |
| 命令归一 | `normalizeCommand` 取首行、去引号内容、去前导环境变量、最多 3 个 token；命中凭据样式只留命令名（`projectMemory.ts:76, 94-118`） |
| 文件取径 | `projectMemory` 的 `filePathOf`：优先 `structuredResult.filePath`，兜底 `toolInput.file_path`；展示只取 `basename`（`projectMemory.ts:138-152`） |
| 横向滚动提示 | `ScrollArea` 在真的横向溢出时渲染一条常驻、占布局的 10px 提示（`ScrollArea.tsx:15-99`） |
| 字号档 | 90%–130%，只缩放字号与行高（`--fs-*` / `--lh-*`），间距与图形不缩放（`tokens.css:121-149`） |
| 窗口 | 最近 N 个本地自然日（含今天），`labWindow(days, now)` = `[今天零点-(N-1)天, 明天零点)`（`constellation.ts:53-61`）；接续卡左界相同、右界取 `now`，见 §0.4 |
| 日期算术 | 本地日必须用 `addLocalDays` / 日键差 `Math.round((dayStartOf(b)-dayStartOf(a))/86400000)`，不能 `+86_400_000`（DST） |
| 最小窗口 | 960 × 640（`src-tauri/tauri.conf.json`） |
| 截图 | `docs/screenshots/views.json` 已有 `memory`；`web/e2e/screenshots.spec.ts` 用 `roundDDScenario()` 截「项目记忆」 |
| 颜色纪律 | `--chart-*` 与 `--cat-*` 严禁互借；大面积填充只允许 `-soft`；强调色只做焦点环、链接、选中底；语义色三档见下 |

### 0.2 与既有卡的区隔（脚注里要能读出来）

| 本卡 | 已有近似物 | 区别 |
| --- | --- | --- |
| 项目接续 | 项目记忆（同档） | 记忆按**对象**读：反复用什么命令、碰哪些文件、踩过哪些坑；接续按**时间**读：最近几次会话的先后、间隔、结尾动作与开头重合 |
| 项目接续 | 回声（Lab） | 回声把所有项目的话题聚成组，回答「同一件事被做了几次」；本卡只在一个项目内，比较**相邻两次**会话的开头与结尾 |
| 项目接续 | 会话星系（F1） | 星系画跨项目的离散会话事件与模型颜色；本卡画**单个项目**的顺序，节点带最后动作，间距带时长 |
| 项目接续 | 项目流量河流图（#388） | 河流是逐日 token 的连续体量；本卡是逐会话的接续事实，**不画 token** |
| 项目接续 | 项目擂台（F2） | 擂台并排比较两个项目的日均与峰值；本卡是单项目的一条时间序列，不比较 |
| 项目接续 | 里程碑 | 里程碑是「第一次 / 最大值」；本卡是「最近几次」以及它们之间隔了多久 |

**与「项目记忆」的关系是本轮的核心判断**：两张卡共用一个项目切换条，谁也不自带第二个选择器。切换条在两张卡之上，负责「现在是哪个项目」；接续卡回答「这个项目最近怎么接上的」，记忆卡回答「这个项目一贯长什么样」。顺序是**时间 → 习惯**：先找回上下文，再看长期形状。两张卡的标题各指一个问题（接续 / 记忆），脚注各自声明口径，读者不会把它们读成同一张卡的两个视图。

### 0.3 数据契约（纯函数层）

建议模块 `web/src/features/usage/projectHandoff.ts`。组件不碰时钟、不做 I/O、零新增 Tauri 命令。

```
buildProjectHandoff(inputs, days, now, activeKey?) -> ProjectHandoff

ProjectHandoff = {
  window: { startTs: number; rightTs: number; days: number }  // rightTs = now（含）
  projects: HandoffProject[]        // 只含窗口内有「可定位时间」会话的项目
  activeKey: string | null          // 传入的 key 不在列表里时回退到 projects[0]
  track: HandoffTrack | null        // activeKey 为 null 时为 null
}

HandoffProject = {
  key: string                       // projectLabel（权威分组键）
  name: string                      // formatProjectPath 的 basename；同名项目追加「（2）」
  sessions: number                  // 窗口内可定位时间的会话数
  lastStartTs: number               // 最近一次会话的 startTs（进入 projects 即有值）
  unknownSessions: number           // 窗口内时间未知的会话数（口径见 0.4）
}

HandoffTrack = {
  project: { key: string; name: string } | null
  sessions: HandoffSession[]        // 全部窗口会话，按 startTs 升序；组件再截断
  emptyReason: "no-projects" | "no-sessions" | "single-session" | "all-unknown" | null
  unknownSessions: number
}

HandoffSession = {
  id: string                        // path:<path> 或 anonymous:<index>
  startTs: number                   // 窗口内首条记录
  endTs: number                     // 窗口内末条记录
  title: string                     // sessionTitle；无元数据时「未命名会话」
  lastAction: LastAction
  opening: MessagePreview | null    // 首条可用用户消息，已脱敏、截断 60
  closing: MessagePreview | null    // 末条可用用户消息，已脱敏、截断 60
  echo: EchoReading
  inProgress: boolean
  gapMs: number | null              // 与上一节点的 startTs 差；首节点为 null
  gapPx: number | null              // 由 gapMs 按 §2.2 算出的像素；首节点为 null
  gapLabel: string | null           // 「同日 · 2 小时后」等；首节点为 null
  meta?: SessionMeta                // 有则用于「打开会话」
}

LastAction =
  | { kind: "file"; verb: "改" | "读"; name: string; tool: string }
  | { kind: "command"; command: string; tool: "Bash" }
  | { kind: "tool"; tool: string }
  | { kind: "none" }

MessagePreview = { preview: string; redacted: boolean }

EchoReading =
  | { status: "scored"; score: number; percent: number | "lt1"; hit: boolean }
  | { status: "insufficient"; reason: "missing-opening" | "missing-closing" | "short-text" }
  | { status: "no-previous" }
```

- `visibleCount` 不在模型层：模型返回全部会话，组件按 `12` 截断；这样「显示全部」不需要重算，隐藏节点的回声分数也已经算好。
- `projects` 不包含「只有时间未知会话」的项目：它无法证明自己落在这个窗口里，放进切换条会显示一个永远是 0 的项目。它们的未知计数只在所属项目已有可定位会话时出现。
- `unknownSessions` 的判定：会话有记录，但窗口内没有一条 `timestamp` 是有限正数且 `missingTimestamp !== true`；且 `session.mtimeMs` 落在窗口内。没有 `SessionMeta.mtimeMs` 的手造输入不计——不能凭猜把它塞进某一天。
- 所有字符串（动作、标语、间隔）都由纯函数拼出；组件不拼句、不改词。测试断言整句，不只断言数字。

### 0.4 口径细节

**窗口与分组**

- 窗口左界与页面 KPI 相同：`addLocalDays(dayStartOf(now), -(days - 1))`；右界取 **`now`（含）**。记录时间 `< startTs` 或 `> now` 一律不进。右界不用 `labWindow` 的「明天零点」——接续卡不把今天尚未发生的记录算进来，这样与项目记忆的 `<= now` 同口径，两张卡的会话数不会因为一条未来时间戳对不上。
- **分组键是 `projectLabel`**（编码目录名），显示名 `formatProjectPath(label, projectPath ?? session.cwd)`；两个不同目录恰好同名时仍是两个项目。同名时按切换条排序追加 `（2）`、`（3）`，**不显示编码目录名**（那等于把用户路径换个写法展示）。
- 项目名为空 → `未命名项目`（与 `projectMemory` / `chronicle` 同口径）。
- 项目排序：`lastStartTs` 降序 → `sessions` 降序 → 显示名字典序 → `key` 字典序。同一输入每次得到同一顺序。
- 默认项目 = 排序后的第一个（最近有会话的那个），不是 token 最多的那个。「上次做到哪了」问的是最近，不是体量。

**会话与时间**

- 会话参与条件：窗口内至少一条可用记录（`timestamp` 有限、> 0、`missingTimestamp !== true`）。
- `startTs` / `endTs` 取**窗口内**首条 / 末条记录的时间。跨窗口起点的长会话按窗口内首条记录计——轨道是「这个窗口里的接续」，不是整段会话的历史；脚注要写明。
- 同一 `startTs` 的并列：按会话 id（`path:` / `anonymous:<index>`）字典序，保证每次顺序一致。
- 时间未知的会话**不参与轨道**，只在所属项目的脚注里计数，不猜顺序。

**最后动作**

- 取窗口内最后一条 `kind === "tool"` 的记录；不是最后一条记录（后面可能还有助手文本）。
- 文件路径双源与 `projectMemory.filePathOf` 同源：`structuredResult.filePath` 优先，兜底 `toolInput.file_path`；展示只取 `basename()`。
- 动词映射：`Edit` / `Write` / `MultiEdit` / `NotebookEdit` → `改`；`Read` → `读`；其他带 `file_path` 的工具 → `${tool} · ${basename}`；不带路径的工具 → `${tool}`。
- `Bash`：从 `toolInput.command` 走 `normalizeCommand`（最多 3 个 token、去引号、去环境变量前缀、命中凭据样式只留命令名）→ `Bash · npm run build`。
- 没有任何工具记录 → `{ kind: "none" }`，界面写 `无工具调用`，**不猜**它「大概在读文件」。
- 工具名缺失的工具记录 → `{ kind: "tool", tool: "未知工具" }`；不冒充 `Bash`。

**开头 / 结尾 / 重复交代**

- 候选用户消息：窗口内 `kind === "user"`、`text.trim()` 非空、`compactSummary` 不为真、`isInterrupt` 不为真、`commandName` 为空的记录。开头取第一条，结尾取最后一条。
  - 排除 `compactSummary`：它是压缩后由模型写的续接文本，不是用户说的话。
  - 排除 `isInterrupt`：`[Request interrupted by user]` 是操作结果，不是一句内容。
  - 排除 `commandName`：斜杠命令的包装文本不是用户交代的背景。
- 展示预览：`firstMessagePreview(text, 60)`；`null` 视为「这条会话没有用户消息」。
- 评分文本：`firstMessagePreview(text, 200)`（与回声的 `PROMPT_LIMIT` 同量级），再走 `topicSignature`。
- **样本充足**：两侧签名各至少 **4 个 token**。少于 4 个时不做判断（`short-text`）。理由：Jaccard 对极小集合过敏，「dd：fill-1」与「dd：fill-2」会得到 100%，那是夹具或口癖，不是重复交代。
- 评分：`jaccard(topicSignature(本次开头), topicSignature(上次结尾))`；`hit = score >= ECHO_THRESHOLD`（0.55）。
- 显示百分比：`Math.floor(score * 100)`；`score > 0` 且整数位为 0 时显示 `<1%`；`score === 0` 显示 `0%`。向下取整保证**显示值永不越过判定线**：命中一定显示 ≥ 55%，未命中一定显示 ≤ 54%。
- 「上一次」= 同一项目内、按 `startTs` 紧挨着的上一会话；即使它被 12 条截断隐藏，仍然参与评分（隐藏只影响画不画，不影响算不算）。
- 本次是窗口内该项目第一次会话 → `no-previous`；开头或上次结尾缺失 → `missing-opening` / `missing-closing`。

**间隔**

- `gapMs = current.startTs - previous.startTs`；不取结束到开始的空档（Issue 口径），脚注写明是**开始时刻之差**。
- 像素映射与文案是两件事：像素用 `gapMs` 取对数（§2）；文案按本地自然日表述（§2.4）。同一句文案可以对应略有差异的像素，像素不是尺子。
- 跨夏令时：日差用 `Math.round((dayStartOf(current) - dayStartOf(previous)) / 86_400_000)`，不用 `+86_400_000` 除法；时长用毫秒差（23/25 小时如实出现）。

**进行中**

- `inProgress = Math.max(0, now - endTs) <= 120_000`。与 Pulse 的 `LIVE_MS` 同值；负年龄（日志时间戳领先本机时钟）按 0 处理。
- 任何节点都可能命中（并行会话），不限于最后一个。
- 文案只写「进行中」，脚注定义：**最后一条记录距现在不超过 2 分钟；只说明日志刚被写入，不代表进程仍在运行**。不写「正在运行」。

**确定性**

- 同一输入、同一 `now` 每次得到同一组项目、同一顺序、同一组分数与像素。
- 纯函数不读 `Date.now()`；`now` 由页面传入。页面用 `readouts.now`（30 秒 tick）而不是挂载时刻——「进行中」必须会在 2 分钟后自己消失。

**隐私（红线）**

- 文件名只取 `basename`；命令只取前 3 个 token；**绝不出现绝对路径**。
- 开头/结尾只展示 `firstMessagePreview` 的结果，不展示原文；不提供「查看全文」。
- 编码目录名（`projectLabel`）不进任何可见文案与 `title`。
- 不新增网络请求、Tauri 命令、权限。

### 0.5 截断与「还有多少」

- 默认显示**最近 12 次**会话（从右往左数第 1–12 个，最右是最新）。
- 模型返回全部；组件只渲染可见的 12 个。表头读数 `40 次会话`、开关 `显示全部`、脚注 `另有 28 个更早的会话未画出`——三处同时说清总数与隐藏数。
- 展开后显示全部，开关变 `只看最近 12 次`；脚注的隐藏句消失。
- 收起时若当前选中的节点落在隐藏段，选中回到**最右（最新）**节点——不会出现「详情是 A、轨道上没有 A」。
- 为什么是 12：176px 节点 + 平均约 70px 间隔 ≈ 246px/次，12 次约 2,950px，1400 宽下约 2.1 屏、960 宽下约 2.6 屏；再多就把「最近」淹没在一条一万像素的轨道里。更早的会话用一次显式点击换回来，不丢数据。

---

## 1 版式与尺寸

### 1.1 位置与网格

「项目」档（`view === "memory"`）从北到南三块，整行宽度，共用同一个项目选择：

```
┌ 项目切换条（工具栏，40px）─────────────────────────────────────────┐
│ 项目  [cc-analyzer 12] [web 8] [api 3] …                             │
└──────────────────────────────────────────────────────────────────────┘
┌ Panel「项目接续」────────────────────────────────────────────────────┐
│ 表头：项目名 · 9 次会话 · 显示全部                                    │
│ 轨道（横向滚动，12 个节点）                                           │
│ 选中会话的接续读数（时间范围 / 开头 / 结尾 / 重合度 / 打开会话）        │
│ 脚注                                                                  │
└──────────────────────────────────────────────────────────────────────┘
┌ Panel「项目记忆」────────────────────────────────────────────────────┐
│ 表头：项目记忆                         会话 9 · token 12.4M · 最近活跃 │
│ 项目名（h3）+ 搜索 + 常用命令 / 热文件 / 坑与恢复                      │
└──────────────────────────────────────────────────────────────────────┘
```

- 接续卡 `span 12`（文档流里就是整行）；**不半宽**。时间轴需要宽度，半宽会把间隔标签和动作压成碎片。
- `data-probe="project-handoff"`；`data-lab-card` 不适用（不在 Lab）；`Panel title="项目接续" ariaLabel="项目接续" titleAs="h2"`。
- 切换条 `data-probe="handoff-toolbar"`、`role="group"`、`aria-label="项目"`。
- 记忆卡 `Panel title="项目记忆" ariaLabel="项目记忆" titleAs="h2"`；项目名在体内是 `h3`。原来的左栏 chip 提升为切换条，记忆卡不再自带第二个项目选择器。
- 页面 `gap: var(--sp-3)` 已有，三块之间不另写 margin。

### 1.2 卡内结构与高度

```
┌ Panel 40px ──────────────────────────────────────────────────────┐
│ 项目接续        cc-analyzer · 9 次会话 · 显示全部                  │
├ body padding 12 ──────────────────────────────────────────────────┤
│ 轨道（节点 72 + 标签带 20 + 茎 6 + 底 8 = 106）                    │
│ 接续读数（外距 8 + 边线 1 + 内距 8 + 头 18 + 4 + 引文 36 + 4 + 36 + 4 + 18）│
│ 脚注（--fs-xs / --lh-xs，2–4 行）                                  │
└───────────────────────────────────────────────────────────────────┘
```

| 部分 | 100% | 130% | 说明 |
| --- | --- | --- | --- |
| 表头 | 40 | 40 | 标题 + 读数 + 开关同排，总述不撑高 |
| 体内距 | 12 + 12 | 12 + 12 | `--sp-3` |
| 轨道 | 106（溢出加 14） | 125（溢出加 14） | 节点可因「进行中」折行长高 |
| 接续读数 | 约 137 | 约 170 | `min-height` 固定下限，长句可撑高 |
| 脚注 | 32–48 | 42–62 | 2–4 行，随条件追加 |
| **整卡** | **约 340–370** | **约 420–440** | 不设 `max-height`、无卡内纵向滚动 |

- 上表按 1400 宽、脚注 2 行、接续读数 2 行引文算；960 宽时脚注折 3 行，整卡 +16。
- 轨道有横向溢出时 `ScrollArea` 的提示条占 10px + 4px 间距；卡高增加 14，不强行预留。
- 节点高度由内容决定（`min-height: 72`），**不写死 `height`**：130% 或「进行中」折行时节点自己长高，轨道取最高节点。
- 不折叠整卡、不设手风琴。接续读数是**常驻区**：选中即更新，不做「点开才看」的第二层。理由是卡的全部价值在「一眼看到上次停在哪」，多一次点击就多一层摩擦。

### 1.3 项目切换条（工具栏）

```
高 40（上下内距 4 + chip 32）、--bg-subtle、1px --border、--r-md、内距 4 8
[项目]  [cc-analyzer  12] [web  8] [api  3] …………………………………………
        ↑ 选中：--bg-hover + 下缘 2px --accent + 名字 600
```

- 视觉标签 `项目`：`--fs-xs` / `--text-tertiary`，`margin-right: var(--sp-2)`；视觉隐藏的重复不需要（组已有 `aria-label`）。
- chip 沿用记忆左栏的几何：`min-height: 32`、`padding: 0 var(--sp-2)`、`gap: var(--sp-2)`、`--r-xs`、`--fs-sm`；名字 `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`；会话数 `--font-mono` / `--fs-xs` / `--text-tertiary` / `tabular-nums`。
- 未选中：透明底、`--text-secondary`；hover：`--bg-hover`、`--text`；选中：`--bg-hover`、`--text`、600、下缘 2px `--accent`。与窄窗记忆 chip 的「选中 = 下缘竖条 + 底色」同款。
- chip 最大宽 220（130% 下 240）；超出省略，`title` 只放显示名，不放编码目录名。
- 横向溢出用原生 `overflow-x: auto`；首尾各 8px 内距，让切边 chip 露出半截作为「还能滚」的线索（与记忆卡原窄窗 chip 条一致，不再造第二种滚动语言）。
- 切换条在两张卡之上，切换后两张卡同时换项目。**不允许**接续卡再带一个下拉、记忆卡再带一条左栏——那会出现「上面选 A、下面还是 B」。
- 键盘：每个 chip 是原生 `<button aria-pressed>`，各自进 Tab 序；不做 roving。项目数通常 < 20，且这里不是本卡承诺的「一个 Tab 止点」区域。

### 1.4 轨道几何

横向，从左到右按会话开始时间升序；最右是最新。单位是 CSS px。

```
┌ 标签带（BAND_H = --lh-xs + 4px）
│        同日 · 2 小时后        次日 · 26 小时后         3 天后
│ ────────●────────────────────●──────────────────────●────────  ← 基线 y = BAND_H
│         ┆ 6px 茎              ┆                      ┆
│      ┌───────┐            ┌───────┐              ┌───────┐
│      │ 节点   │ ← gapPx →  │ 节点   │ ← gapPx →    │ 节点   │
│      └───────┘            └───────┘              └───────┘
└ 底 8
```

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `NODE_W` | 176 | 节点宽；不随 `fontScale` 缩放（文字截断，几何不缩） |
| `NODE_MIN_H` | 72 | 节点最小高；内容多则长高 |
| `BAND_H` | `calc(var(--lh-xs) + 4px)` | 100% 20 / 130% 24.8；间隔标签住在这里 |
| `STEM_H` | 6 | 基线到节点顶的竖茎 |
| `TRACK_PAD_X` | 12 | 首节点左、末节点右的内距 |
| `TRACK_BOTTOM` | 8 | 节点底到轨道底 |
| `GAP_MIN` | 44 | 最小间隔像素 |
| `GAP_STEP` | 8 | 相隔时长每翻一倍增加的像素 |
| `GAP_MAX` | 140 | 最大间隔像素（安全网；90 天窗口最多约 132.6） |
| `RAIL_STROKE` | 1 | 基线 / 茎；高对比度仍 1 |
| `RING` | 6 | 重复交代标记的直径 |
| `LIVE_DOT` | 6 | 「进行中」实心点直径 |

**间距公式**：

```
hours  = max(1, gapMs / 3_600_000)
gapPx  = clamp(44 + 8 * log2(hours), 44, 140)

2 小时   → 52
6 小时   → 64.7
12 小时  → 72.6
1 天     → 80.7
3 天     → 93.3
1 周     → 103.5
1 个月   → 119.9
3 个月   → 132.6（90 天窗口的上界）
```

- 节点左边界：`x(0) = 12`；`x(i+1) = x(i) + 176 + gapPx(i)`。
- 首节点中心 = `12 + 88 = 100`；相邻节点中心距 = `176 + gapPx`。
- 基线从首节点中心画到末节点中心；每个节点一条 6px 竖茎落在中心。
- **间隔标签可以比 gapPx 宽**：标签住在节点上方的独立标签带里，居中于间隔点，允许向两侧超出间隔；相邻标签的中心距至少 `176 + 44 = 220`，最宽标签（130% 下「同日 · 23 小时 59 分后」约 180）也不会相撞。标签用 `--bg-subtle` 背景在基线上「打洞」，`padding: 0 4px`。
- 不画连续时间轴、不画纵向网格、不画「现在」线：这不是坐标轴，是节点序列；唯一的一根横向线是连接节点的基线。
- 轨道外层用 `ScrollArea`：真的横向溢出时底部出现一条 10px 常驻提示；不溢出时不存在。

### 1.5 节点几何

```
┌ 176 ┐ ← 1px --border；选中左缘 2px --accent
│ 09-28 14:32                 ← --fs-xs / mono / --text-tertiary
│ 修复导出按钮的禁用态         ← --fs-sm / 600 / --text / 单行省略
│ 改 export-button.tsx        ← --fs-xs / mono / --text-secondary
└─────┘
   ↑ 节点左缘中点、跨在边框上：6px 空心圆（命中重复交代时）
```

- 节点宽固定 176；`min-height: 72`；`padding: var(--sp-2)`；`border: 1px solid var(--border)`；`border-left: 2px solid transparent`（选中染色，不改变内容盒宽）；`border-radius: var(--r-sm)`；`background: transparent`。**节点本身不设 `overflow: hidden`**，否则左缘的空心圆会被裁掉；只有标题/动作的内层 `span` 做省略。
- 三行：时间 16（`--lh-xs`）、标题 18（`--lh-sm`）、动作 16（`--lh-xs`），行距 2，上下内距 8 → 70 + 边框 2 = 72。
- 时间行 `display: flex; align-items: center; gap: var(--sp-1); flex-wrap: wrap`：左 `MM-DD HH:mm`，右「进行中」徽标；放不下时徽标折到下一行，节点长高，不裁字。
- 标题：单行，`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`；全文进 `title`、`aria-label` 与详情头。
- 动作：单行，`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`；全文进 `title` 与 `aria-label`。动词/工具名 `--text-tertiary`，文件/命令 `--font-mono` / `--text-secondary`；`无工具调用` 用正文 `--text-tertiary`，不用 mono。
- 节点本身**不单独获得焦点**：整个轨道一个 Tab 止点，键盘游标与选中是同一个状态（见 §6）。
- 悬停：`background: var(--bg-hover)`、`border-color: var(--border-strong)`、指针 `pointer`；不弹浮层，只更新浏览器原生 `title`。
- 选中：`background: var(--bg-hover)`、`border-color: var(--border-strong)`、左缘 2px `--accent`、标题维持 `--text` / 600。
- 重复交代的空心圆跨在节点**左缘中点**：`position: absolute; left: -4px; top: 50%; transform: translateY(-50%)`，6×6（含 1.5px 边框，`box-sizing: border-box`）、`border: 1.5px solid var(--text-secondary)`、`border-radius: 50%`、`background: transparent`。它不压标签带（标签在 y 0–20，圆在节点垂直中线），边框线从圆孔里穿过；选中时左缘的 2px `--accent` 也从孔里穿过，不互相遮盖。选中或悬停时圆环变 `--text`。
- 「进行中」徽标：6px 实心 `--text` 圆点 + `进行中`（`--fs-xs` / 600 / `--text-secondary`），`gap: var(--sp-1)`；**不加底色、不加边框、不做呼吸动画**。它不是警报，是状态。

### 1.6 接续读数（选中区）

`margin-top: var(--sp-2); border-top: 1px solid var(--border); padding-top: var(--sp-2); min-height: 129px`（含外距时整段约 137）。

```
修复导出按钮的禁用态   09-28 14:32 → 16:05 · 1 小时 33 分        打开会话 →
开头       “把导出按钮的禁用态修好，然后补测试…”
结尾       “测试补完了，剩下截图基线…”
上次结尾   “把导出按钮的禁用态修好，然后补测试…”        ← 只在有可对比的上一次会话时出现
接续       本次开头与上次结尾重合 68%，达到阈值 55%。
```

**「上次结尾」这一行是必须的（修订于截图验收）**：评分比的是「本次开头」与**上一次会话的结尾**，而「开头 / 结尾」两行展示的都是本次会话。只给这两行时，读者看到两句话不同却写着「重合 100%」，无法用屏幕上的任何东西复算出这个数——这违背了本功能的全部前提。补一行上次结尾，两句话就在眼前，重合度变成可核对的事实。

- 头行：标题（`--fs-sm` / 600 / `--text`，单行省略，`flex: 1 1 240px`）、时间范围（`--fs-xs` / mono / `--text-tertiary`，`white-space: nowrap`）、`打开会话 →`（右端，`margin-left: auto`）。整行 `flex-wrap: wrap; row-gap: var(--sp-1)`，放不下时按钮折行。
- 时间范围：`start < end` 时 `MM-DD HH:mm → MM-DD HH:mm · formatDuration(end-start)`；`start === end` 时只写一个时刻，不写「0 毫秒」。进行中时在末尾加 ` · 进行中`。
- 引文三行（**上次结尾**仅在有可对比的上一次会话时出现）：标签列 44px（`开头` / `结尾` / `上次结尾`，`--fs-xs` / `--text-tertiary`），内容列 `minmax(0, 1fr)`；上一次会话缺失时该行不渲染，接续行此时是 `这是窗口内这个项目最早的一次会话。`；引文 `--fs-sm` / `--lh-sm` / `--text`，`overflow-wrap: anywhere`，**不设 `line-clamp`**——60 字预览在 960 宽、130% 下两行能放下，极端窄宽时让它折到第三行、整卡长高，绝不隐藏字符。数据层已经把文本截到 60 字，组件不再二次截断。
- 引文缺失：`没有用户消息`（`--text-tertiary`），不画引号。
- 接续行：`本次开头与上次结尾重合 68%，达到阈值 55%。` / `本次开头与上次结尾重合 31%，低于阈值 55%。` / `这是窗口内这个项目最早的一次会话。` / `样本不足：首条或上次末条用户消息缺失。` / `样本不足：两条消息都太短（各需至少 4 个话题词）。`
  - 百分比用 `--font-mono` / 600 / `--text`；正文 `--fs-sm` / `--text-secondary`；阈值 `--text-tertiary`。
  - 「样本不足」四个字用 `--warning`；这是全卡**唯一**的语义色。原因见 §4.3。
- 未命中（分数 < 55%）时**不**在轨道上放空心圆，但接续行仍报出真实分数与阈值——「没有标记」不等于「没有读数」。
- `打开会话 →` 是行内文字按钮：`--accent`、500、下划线 `currentColor`、`white-space: nowrap`；hover `--accent-hover`；焦点环 `--ring`。`onOpenSession` 缺省或没有 `SessionMeta` 时**不渲染**，不渲染 disabled 态（一个按不动的按钮会被当成坏了）。
- 读数区不设 `max-height`；头行或接续行折行时整卡长高，不裁字。

### 1.7 首屏预算

以 1400 × 900、页头 48、切换条 40、接续卡 360、记忆卡表头 40 计：

| 段 | 高度 |
| --- | --- |
| 顶栏 | 48 |
| 页内距 + 页头 + 卡间距 | 12 + 48 + 12 |
| 项目切换条 | 40 + 12 |
| **项目接续** | **360** + 12 |
| 记忆卡顶边落在 | **约 544** |

- 900 高下，记忆卡露出约 **356px**：表头、项目名、搜索与第一段命令可见。接续卡是这一档的第一个答案，占首屏是应该的。
- 960 × 640：页头可能折两行（约 76），接续卡顶边约 200、底边约 560，记忆卡只剩一条边。这是最小窗口的既有现实；不折叠接续卡来保记忆卡，因为本轮要回答的正是接续。
- 130% 下接续卡约 430，960 × 640 时记忆卡整张在首屏之外；页面整体滚动，不压缩字号、不裁字。
- 接续卡的高度不随会话数增长：12 条截断 + 固定读数区，40 次会话和 9 次会话一样高。

---

## 2 时间间距：对数映射

### 2.1 三种方案，为什么选对数

| 方案 | 2 小时 | 1 天 | 3 个月 | 问题 |
| --- | --- | --- | --- | --- |
| 线性（按毫秒） | ≈ 1px（1200px / 90 天） | ≈ 13px | 整幅 | 密集的一周被压成一点；稀疏的三个月吃掉全部宽度 |
| 等距节点 | 44px | 44px | 44px | 抹掉「隔了多久」——读者会把 2 小时和 3 个月读成同一件事，这比压缩更糟 |
| **对数（本方案）** | 52px | 81px | 133px | 有压缩，但顺序与倍数关系保留；精确值由文字承担 |

**对数不是「画得像」，是「排序不撒谎、倍数可读」**：相隔时长每翻一倍，横向多 8px。它满足四个约束：

1. **单调**：真实间隔更大，像素一定不小于更小的那个；永远不会把 3 天画得比 2 小时近。
2. **有界**：90 天窗口内最大约 132.6px，最小 44px；不会出现一个间隔把后面所有节点推出屏幕。
3. **不冒充尺子**：轨道没有连续时间轴、没有网格线、没有刻度；每个间隔都单独印出本地自然日文案。像素是**序数通道**（谁比谁远），文字是**数值通道**（到底多远）。
4. **可核对**：脚注写明「每翻一倍多 8px，不是等比例」；想看准确值就读节点之间的字，或用节点时刻自己减。

### 2.2 公式与上下限

```
hours  = max(1, gapMs / 3_600_000)
gapPx  = clamp(44 + 8 * log2(hours), 44, 140)
```

- `GAP_MIN = 44`：低于 1 小时一律 44px。低于 1 小时的真实间隔很少，且都印着准确文案（`同日 · 14 分钟后`）；最小值的意义是「节点必须分开」，不是「14 分钟等于 44 分钟」。
- `GAP_MAX = 140`：90 天窗口的实际最大值约 132.6，通常碰不到；它是将来把卡复用到更长窗口时的护栏。
- 像素只由 `gapMs` 算，不按日数取整；日数只影响文案。两者口径不同要在脚注里说清。
- 不做「每段固定宽度 + 间隔标签覆盖」的伪时间轴：那等于把等距方案换了个说法。

### 2.3 为什么它不会骗人

- **它没有声称自己是线性轴**。读者看到的是一条节点链，不是带刻度的坐标轴；每个间隔上方都有独立的时长标签。线只负责「先后」，标签负责「多久」。
- **它不会反转**。单测逐对断言：`gapA < gapB → gapPxA <= gapPxB`，并且在未触顶/触底时严格小于。
- **它不会隐藏极值**。最小的间隔仍然可点、可键盘到达；最大的间隔仍然把下一个节点留在屏幕内。
- **它把截断说在明处**。只画 12 条时，表头有总数、脚注有隐藏数；不假装「只有这 12 次」。
- **它把日级与毫秒级分开说**。像素按毫秒取对数；文案按本地自然日。一个「3 天后」可能对应 2 天 20 小时到 3 天 4 小时——这是日级表述的精度，不是谎报；要精确到分钟时，节点时刻可以直接相减。

### 2.4 间隔文案规则

设 `d = Math.round((dayStartOf(current) - dayStartOf(previous)) / 86_400_000)`（跨 DST 安全）：

| 条件 | 文案 | 例 |
| --- | --- | --- |
| `gapMs === 0` | `同时` | 同一毫秒开始的两条会话 |
| `d === 0` | `同日 · ${formatDuration(gapMs)}后` | `同日 · 2 小时后` / `同日 · 14 分钟后` |
| `d === 1` 且 `gapMs < 36h` | `次日 · ${formatDuration(gapMs)}后` | `次日 · 26 小时后` |
| `d === 1` 且 `gapMs >= 36h` | `1 天后` | 跨一个本地日但接近两天 |
| `d >= 2` | `${d} 天后` | `3 天后` / `37 天后` / `89 天后` |

- `formatDuration` 是既有中文档位（`2 小时` / `1 天 3 小时` / `14 分钟`），不另造一套。
- `d >= 2` 不换算成「周 / 个月」：`37 天后` 是精确的本地日数，`约 1 个月` 不是。
- 跨年窗口（90 天跨 12 月）只影响节点时刻的年份省略，不影响日差；节点时刻沿用 `formatShortStamp` 的 `MM-DD HH:mm`，顺序与日差文案足以读出跨年。
- 文案里的「后」统一表示「比上一会话的开始晚多久」；脚注写明是**开始时刻之差**，不是空闲空档。

---

## 3 节点、密度与截断

### 3.1 节点里放什么

| 行 | 内容 | 令牌 / 字号 | 截断 |
| --- | --- | --- | --- |
| 1 | 开始时刻 `MM-DD HH:mm`；右侧「进行中」徽标 | `--fs-xs` / mono / `--text-tertiary` | 不截断；徽标放不下折行 |
| 2 | 会话标题（`sessionTitle`，无元数据时「未命名会话」） | `--fs-sm` / 600 / `--text` | 单行省略；全文进 `title` / `aria-label` / 详情头 |
| 3 | 最后动作：`改 foo.ts` / `读 bar.ts` / `Bash · npm test` / `Grep` / `无工具调用` | `--fs-xs` / mono / `--text-secondary`；动词与工具名 `--text-tertiary` | 单行省略；全文进 `title` / `aria-label` |

- 节点**不**放 token、模型、消息数、费用：那些是其他卡的职责；这里只回答「什么时候、做了什么」。
- 标题的省略是视觉截断，不是数据截断；`sessionTitle` 原值不改。
- 动作里的文件名只取 basename，命令只取前 3 个 token；这是隐私红线，也是「一行放得下」的原因。
- 没有工具调用时印 `无工具调用`，不用「暂无」或「—」：前者是事实，后者像缺数据。

### 3.2 密度与截断

- 默认 12 条，最近的在最右；打开卡片时轨道自动滚到右端，第一眼看到的就是「上次」。
- 表头：`{total} 次会话`；`total > 12` 时旁边一枚文字开关 `显示全部` / `只看最近 12 次`。数字 mono 600 `--text`，量词 `--text-tertiary`。
- 脚注在 `hidden > 0` 时追加：`另有 {hidden} 个更早的会话未画出，点「显示全部」展开。`
- 展开/收起时保持当前选中节点的屏幕位置：展开时把新增内容宽度加到 `scrollLeft`，收起时若选中落在隐藏段则回到最右节点。不做「展开后跳回开头」。
- 卡内 Tab 序：表头开关 → 轨道 → 读数区 `打开会话`（仅在有回调时），共三个停点；轨道本身仍然只有一个 Tab 止点。
- 不做「每次只显示 5 个 + 分页」：分页会让「间隔」在页与页之间断开；12 条 + 一次性展开保住了相邻关系。

### 3.3 单会话与无工具

- 窗口内该项目只有 1 个可定位会话：**不画轨道**。卡内写：

  ```
  这个项目在窗口内只有一次会话，没有接续可看。
  09-28 14:32 · 修复导出按钮的禁用态 · 最后动作 改 export-button.tsx    [打开会话 →]
  ```

  标题 `--fs-sm` / 600；说明 `--fs-sm` / `--text-secondary`；事实行 `--fs-xs` / mono / `--text-tertiary`（标题用正文）；按钮同 §1.6。整卡约 192 高。
- 项目没有任何工具调用：轨道照画，每个节点的动作位写 `无工具调用`；不回退成「暂无数据」，也不从消息里猜动作。
- 1 个可定位会话 + N 个时间未知：单会话块下方脚注追加 `另有 N 个会话没有可用时间戳。`
- 0 个可定位会话：`EmptyState size="inline"` + 一句 `这个项目在窗口内没有可定位时间的会话`；不画空轨道。这种项目通常不进切换条；这是数据在选中后变化时的安全态。

### 3.4 脚注定稿

基础句（`--fs-xs / --lh-xs / --text-tertiary`，960 宽约 3 行；不收起、不进 `title`）：

> 节点之间是相邻两次会话的开始时刻之差；间距按相隔时长取对数（每翻一倍多 8px），不是等比例，文字里的本地自然日间隔才是准确值。节点左缘中点的空心圆表示本次开头与上次结尾重合达到 55% 阈值。「进行中」= 最后一条记录距现在不超过 2 分钟，只说明日志刚被写入，不代表进程仍在运行。文件名只取 basename，命令只取前 3 个 token，消息已脱敏并截断 60 字。

条件追加：

- `hidden > 0` → `另有 {hidden} 个更早的会话未画出，点「显示全部」展开。`
- `unknownSessions > 0` → `另有 {unknown} 个会话没有可用时间戳，未画在轨道上。`
- 单会话 / 全未知态：轨道与空心圆的句子不适用，脚注只保留隐私句 `只读本机日志；文件名只取 basename，命令只取前 3 个 token，消息已脱敏并截断 60 字。`
- `no-previous` / 样本不足不另加脚注：读数行已经说清。

---

## 4 重复交代：事实、不是警报

### 4.1 形态

- **轨道上的标记**：节点左缘中点、跨在边框上的 6px **空心圆**（§1.5）。它只表示「本次开头与上次结尾的重合达到了 55% 阈值」；不印百分比，不做徽标。
- **读数区的一行**：`接续` 行给出精确百分比与阈值（§1.6）。这是主通道；空心圆只是索引。
- **可访问名**：节点的 `aria-label` 末尾带上同一句（命中时 `开头与上次结尾重合 68%`；未命中时 `开头与上次结尾重合 31%`；样本不足时 `重合度样本不足`）。空心圆自身 `aria-hidden`，避免同一句被念两遍。

### 4.2 为什么不是警报

- 重合可能是**好事**：接着上次的任务继续，本来就会重新提一遍背景。把它画成红色/琥珀色等于替用户下判断。
- 它也不是「不确定信息」：分数是确定的 Jaccard 读数，所以不用 `--warning` 标分数。
- 它更不是「确定的正常读数」，所以不用 `--success` 给绿点——那会把「高重合」说成「健康」。
- 结论：**分数用正文墨色，标记用中性形状**。全卡唯一的语义色留给「样本不足」（未知），见 §4.3。

### 4.3 颜色

| 部件 | 令牌 | 说明 |
| --- | --- | --- |
| 空心圆（命中） | `--text-secondary` 1.5px；高对比度 2px | 选中/悬停 `--text` |
| 百分比数字 | `--text` / mono / 600 | 与正文同色，不另给颜色 |
| 阈值文字 | `--text-tertiary` | 次要说明 |
| `样本不足` | `--warning` | 只染这四个字；理由是分数无法确定，不是「你做得不好」 |
| 未命中 | 无标记 | 读数行仍写出分数与阈值 |

- 不使用 `--danger` / `--success` / `--chart-*` / `--cat-*` / `--accent` 给分数上色。

### 4.4 文案定稿

| 状态 | 文案 |
| --- | --- |
| 命中 | `本次开头与上次结尾重合 68%，达到阈值 55%。` |
| 未命中 | `本次开头与上次结尾重合 31%，低于阈值 55%。` |
| 分数极低 | `本次开头与上次结尾重合 0%。` / `本次开头与上次结尾重合 <1%。` |
| 无上一次 | `这是窗口内这个项目最早的一次会话。` |
| 缺消息 | `样本不足：首条或上次末条用户消息缺失。` |
| 文本太短 | `样本不足：两条消息都太短（各需至少 4 个话题词）。` |

- 不出现「你」「重复劳动」「浪费」「又」「应该」。只说两段文字的重合与阈值。
- 百分比向下取整，所以显示值不会与阈值打架：命中显示 55–100，未命中显示 0–54。
- 脚注补一句口径：`重合度按本次首条用户消息与上次末条用户消息的前 200 字计算（话题签名 Jaccard，阈值 55%）；它只比较文字，不评价内容质量。`

---

## 5 颜色映射

### 5.1 全卡颜色表

| 部件 | 令牌 | 规格 |
| --- | --- | --- |
| 卡面 / 表头 | `--bg-subtle` | `Panel` 原语 |
| 切换条底 | `--bg-subtle` + 1px `--border` | `--r-md` |
| chip 未选中 | 透明 + `--text-secondary` | hover `--bg-hover` |
| chip 选中 | `--bg-hover` + 下缘 2px `--accent` + `--text` 600 | 与记忆 chip 同款 |
| 节点底 | 透明 | 1px `--border`；hover/选中 `--bg-hover` |
| 节点边框 | `--border`；hover/选中 `--border-strong` | 高对比度 `--border` 实色 |
| 选中竖条 | `--accent` 2px | 左缘 |
| 标题 | `--text` / 600 | 选中不变 |
| 时刻 | `--text-tertiary` / mono | 等宽 |
| 动作 | `--text-secondary`；动词/工具 `--text-tertiary` | 文件/命令 mono |
| `无工具调用` | `--text-tertiary` | 正文，不用 mono |
| 基线 / 茎 | `--border-strong` 1px | **高对比度改 `--border`**（与星系的泳道线同款） |
| 间隔标签 | `--text-tertiary` / mono | 背景 `--bg-subtle`，在基线上打洞 |
| 空心圆 | `--text-secondary` 1.5px | 高对比度 2px；选中 `--text` |
| 「进行中」点 | `--text` 实心 6px | 文字 `--text-secondary` 600 |
| 焦点环 | `--ring` / `--focus-ring-width` | 高对比度 3px 自动 |
| 打开会话 | `--accent` / 500 | hover `--accent-hover` |
| 样本不足 | `--warning` | 仅四字 |
| 脚注 | `--text-tertiary` | `--fs-xs` |

- `tokens.css` 零 diff；模块 CSS 里没有十六进制颜色。
- 没有 `opacity` / `fill-opacity` / `color-mix`；没有 `box-shadow`（文档流内不用阴影）。
- 颜色不是唯一通道：选中还有左竖条 + 字重；进行中还有文字；重复还有读数行；焦点还有环。

### 5.2 深色

- 节点边框 `--border`（白 0.07）在 `--bg-subtle #14161a` 上偏淡，但 hover/选中立刻升到 `--border-strong`（白 0.14）；标题与动作的墨色是主要边界，边框只是分组。
- 基线 `--border-strong` 在深底可见；间隔标签 `--text-tertiary #8b939e` 在 `#14161a` 上约 5.5:1。
- 空心圆 `--text-secondary #b4bcc6` 约 8:1；「进行中」实心点 `--text` 约 13:1。
- 切换条底 `--bg-subtle` 与页面 `--bg #0d0f12` 形成一档台阶；chip 选中 `--bg-hover #212429` 再上一档。
- 没有 `@media (prefers-color-scheme)`：主题由 `data-theme` 决定。

### 5.3 高对比度

- 基线（以及悬停/选中节点边框）普通 `--border-strong`，高对比度改 `--border`（两块高对比度主题里它是实色灰，比半透明线更适合作为结构线）；普通节点边框始终 `--border`。
- 空心圆加粗到 2px；「进行中」点保持 6px（实心纯墨色已经够）。
- 焦点环 3px（由 `--focus-ring-width` 自动给）。
- 选中竖条 `--accent`（浅 #0b3f9c / 深 #8ab4ff）。
- `样本不足` `--warning`（浅 #7a4f00 / 深 #ffc75e）。
- 不依赖色相：选中靠竖条+底色+字重，进行中靠文字，重复靠读数行，焦点靠环。

---

## 6 交互与可达性

### 6.1 悬停

- 节点：`--bg-hover` + `--border-strong`；原生 `title` = `09-28 14:32 · 标题 · 最后动作 …`（命中时追加 `· 开头与上次结尾重合 68%`）。**不改变**读数区，避免指针扫过时下方文字闪烁。
- 间隔标签：无交互，指针 `default`；`title` 可给 `相隔 ${formatDuration(gapMs)}`（精确时长）作为补充。
- 轨道空白：无交互。
- 指针离开节点：回到透明底；选中态不受影响。

### 6.2 点击与选中

- 点击任意节点：选中该项，读数区更新；**不移动 DOM 焦点**（`onMouseDown` 阻止默认聚焦），键盘焦点仍由 Tab 进入。与河流图 / 回声同一约定。
- 点击已选中的节点：保持选中（不取消）；始终有一项被选中，读数区不会空。
- 点击读数区的 `打开会话 →`：调用 `onOpenSession(session.meta)`；没有回调或没有 meta 时不渲染该按钮。
- 点击切换条 chip：切换当前项目；接续卡默认选中该项目最右（最新）节点；记忆卡同步切换，并清空记忆卡里的搜索词（沿用现行为）。
- 切换项目 / 窗口 / 数据后：若原来选中的会话仍在，保留；否则选最右节点。若当前项目消失，页面回退到排序第一的项目。

### 6.3 键盘

- **整个轨道一个 Tab 止点**：外层 `div` `role="listbox"`、`tabIndex={0}`、`aria-orientation="horizontal"`。节点是 `role="option"`，不各自进 Tab 序（WKWebView 里大量可聚焦子元素不可靠，也会毁掉键盘体验）。
- Tab 进入时：若没有选中，选最右（最新）节点；焦点环画在选中节点上。
- 键位：

| 键 | 行为 |
| --- | --- |
| `←` / `→` | 上一 / 下一会话；选中、读数区与 live region 一起更新；`preventDefault` |
| `Home` / `End` | 跳到最早 / 最新会话 |
| `Enter` | 打开当前会话（仅 `onOpenSession` 与 meta 都存在时）；`preventDefault` |
| `Tab` | 不拦截；下一个停点是读数区的「打开会话」（若存在） |

- 方向键移动后把当前节点滚进视野：`scrollIntoView({ block: "nearest", inline: "nearest" })`；不做平滑动画。
- 不接管 `Space`（避免与页面滚动冲突），不接管 `Esc`（本卡没有可取消的浮层/选中）。
- 节点点击与方向键共用同一个 `selectedId`；不存在「键盘游标」与「选中」两套状态。

### 6.4 焦点环

- 轨道 `:focus-visible` 时，选中节点画 `outline: var(--focus-ring-width) solid var(--ring)`，`outline-offset: var(--focus-ring-offset)`，圆角 `--r-sm`。
- 轨道外层 `:focus { outline: none }`，避免浏览器默认 outline 与节点环重复。
- 环不裁切：节点上方有 `BAND_H + STEM_H`（100% 约 26、130% 约 31）、左右各 12px 内距、下方 8px；滚动容器纵向留出 3px 环位。
- 焦点离开：环消失，选中与读数保留。

### 6.5 ARIA

- 卡片：`Panel ariaLabel="项目接续"` → `region`「项目接续」。
- 切换条：`role="group" aria-label="项目"`；chip `<button aria-pressed>`；`title` 只放显示名。
- 轨道：`role="listbox" aria-label="项目接续轨道（可交互）"`、`tabIndex=0`、`aria-activedescendant={选中节点 id}`、`aria-describedby="键盘说明 脚注"`。
- 节点：`role="option"`、`id`、`aria-selected`、`aria-label` = `09-28 14:32，标题，最后动作 改 foo.ts`，命中时追加 `，开头与上次结尾重合 68%`，进行中追加 `，进行中`。
- 读数区：`role="group" aria-label="接续读数"`；引文与接续行是普通文本，不做 live；避免方向键移动时把两段 60 字引文整段朗读。
- live region：视觉隐藏的 `role="status" aria-live="polite"`，在选中变化时播报一句：
  - `已选 09-28 14:32 的会话：修复导出按钮的禁用态；最后动作 改 export-button.tsx；本次开头与上次结尾重合 68%。`
  - 无上一次：`已选 …；这是窗口内这个项目最早的一次会话。`
  - 样本不足：`已选 …；重合度样本不足。`
  - 展开/收起：`已显示全部 40 次会话。` / `只看最近 12 次会话。`
- 视觉 `title` 是增强，读屏走 `aria-label` 与 live region；不把同一句放进两处可见文本。
- 颜色不是唯一通道：选中、进行中、重复、缺失都有文字或形状的第二通道。

### 6.6 横向滚动

- 轨道用 `ScrollArea`；真的溢出时底部有 10px 常驻提示，静止可见（macOS 覆盖式原生滚动条不可靠）。
- 打开卡片、切换项目、切换窗口、显示条数变化后，滚到**右端**（最新）。用户正在看中间时改变窗口宽度，不强制拉回右端。
- 键盘移动会把节点滚进视野；鼠标不劫持纵向滚轮（触控板横向、Shift+滚轮走原生）。
- 不出现页面级横向滚动；轨道自己滚。

---

## 7 空态

| 条件 | 渲染 | 文案 |
| --- | --- | --- |
| 窗口内没有任何项目 | **接续卡与切换条都不渲染** | 项目记忆卡的页面级空态已经在说话（`这个窗口还没有项目记忆`） |
| 窗口内只有 1 个可定位会话 | 卡照渲染，不画轨道 | `这个项目在窗口内只有一次会话，没有接续可看。` + 时刻 / 标题 / 最后动作 / `打开会话` |
| 项目没有任何工具调用 | 轨道照画 | 每个节点动作位 `无工具调用` |
| 有会话但全部时间未知 | 卡照渲染，`EmptyState size="inline"` | `这个项目在窗口内没有可定位时间的会话` + `N 个会话缺少有效时间戳，画不出先后顺序。` |
| 选中项目在数据变化后消失 | 不渲染接续卡；切换条回退到第一项 | 无 |
| 首条/末条用户消息缺失 | 轨道照画 | 引文位 `没有用户消息`；接续行 `样本不足：…` |
| 扫描中、还没有数据 | 不渲染；数据到达后自动出现 | 不造骨架（与项目记忆同源同进度） |

- 空态优先于轨道：单会话 → 不画一条没有间隔的轨道；全未知 → 不画空轨道。
- 不为了「稳定高度」留空节点、空基线或占位文案。
- 单会话块与页面级空态是两种尺寸：前者是卡内说明，不用 `EmptyState size="page"` 的品牌标记。

---

## 8 响应式、字号档、主题

### 8.1 宽度

- 整行宽度；「项目」档不是网格，不需要 `span`。
- `≤1080px`：切换条继续横向滚动；接续卡与记忆卡整行，不塌成两列（本来就是单列）。
- 960 内容区约 636px：节点 176、间隔 44–140，轨道横向滚动；读数区引文两行能放下 60 字；表头项目名最多 140px（130% 180px）后省略，计数与开关仍在同一行。
- 极窄（浏览器 e2e < 900px）：表头允许 `flex-wrap: wrap`，项目名独占一行，计数与开关在下一行；读数区头行折成两行。桌面最小 960 不会触发，这是给浏览器测试与未来尺寸的兜底。
- 不出现页面级横向溢出；轨道与切换条各自滚。

### 8.2 130% 字号档

| 位置 | 100% | 130% | 防护 |
| --- | --- | --- | --- |
| 节点宽 | 176 | **176（不缩放）** | 标题/动作截断；全文进 `title` / `aria-label` / 详情头 |
| 节点标题 | 12px，约 12 个汉字 | 15.6px，约 9 个 | 单行省略；不靠缩字号 |
| 节点动作 | 11px mono，约 18 个拉丁字符 | 14.3px，约 14 个 | 单行省略；basename + 3 token 通常够 |
| 时间行 | `09-28 14:32` 约 73 + 徽标 50 | 约 95 + 徽标 67 | 放不下时徽标折行，节点长高，不裁字 |
| 间隔标签 | 11px，最宽约 140 | 14.3px，最宽约 180 | 标签带独立，可比间隔宽；相邻中心距 ≥ 220，不撞 |
| 引文 | 12/18，两行 | 15.6/23.4，两行 | 60 字在 960 下两行可容；不设行夹，极端窄宽可折第三行 |
| 读数区 | 约 137 | 约 170 | `min-height: 129`；130% 下内容自然撑到约 170，长句再长高 |
| 整卡 | 约 340–370 | 约 420–440 | 不设 `max-height`，页面滚动 |
| 切换条 | 40 | 40 | chip 32；名字省略 |

- 最容易破的三处：节点宽跟着字号放大（整条轨道失去密度语言）、间隔标签按 gapPx 写死宽度（130% 下被裁）、时间行不换行（徽标撞出节点）。
- 130% 下**不减少可见条数**：12 是数据/密度规则，不是字号妥协；要更多用「显示全部」。
- 130% 下标题/动作的省略更早发生，但全文仍在 `title`、`aria-label` 与详情头，信息不丢。

### 8.3 深色 / 高对比度

- 组件里没有主题分支，全部由令牌承担。
- 深色：节点边框 `--border` 作分组，hover/选中升 `--border-strong`；基线 `--border-strong`；间隔标签 5.5:1；空心圆 8:1；进行中点 13:1。
- 高对比度：基线/茎改 `--border` 实色；空心圆 2px；焦点环 3px；`样本不足` 的 `--warning` 在高对比度两套主题下都 ≥ 7:1。
- 个性化强调色只影响 `--accent` / `--ring`（选中竖条、打开会话、焦点环），不会带走墨色与 `--warning`。

---

## 9 验收清单

### 9.1 单元测试（`projectHandoff.test.ts`）

- [ ] 分组：按 `projectLabel`，不是显示名；不同 label 同名时是两个项目；同名显示追加 `（2）`；空名 → `未命名项目`。
- [ ] 窗口：`startTs` 含、`rightTs`（now）含；`> now` 不含；窗口内首末记录决定 `startTs/endTs`；跨窗口起点的会话按窗口内首条记录计。
- [ ] 排序：项目 `lastStartTs` 降序 → `sessions` 降序 → 名称 → key；会话 `startTs` 升序 → id；同一输入两次结果完全一致。
- [ ] 末动作：`Edit`/`Write` → `改 <basename>`；`Read` → `读 <basename>`；`Bash` → `Bash ·` 前 3 个 token；命中凭据样式只留命令名；无工具 → `none`；工具名缺失 → `未知工具`；任何输出不含 `/` 绝对路径。
- [ ] 时间未知：有记录但无有效时间戳 + `mtimeMs` 在窗口 → 计数；mtime 在窗口外 → 不计；无 meta → 不计；时间未知会话不进 `sessions`、不算间隔、不影响排序。
- [ ] 间隔文案：`同时`；同日 `2 小时后`；次日 `26 小时后`；`3 天后`；`37 天后`；跨 DST 的日差用 `Math.round`（23/25 小时不位移）。
- [ ] 像素映射：`gapPx` 单调不减；`<1h` 钳到 44；`>=` 上界钳到 140；`gapPx` 永不为负/NaN；90 天窗口内最大约 132.6。
- [ ] 回声：命中恰好 0.55；未命中 0.549；显示向下取整（命中≥55，未命中≤54）；`score>0` 且 <1% 显示 `<1%`；0 显示 `0%`。
- [ ] 样本不足：任一侧 <4 个话题 token → `short-text`；缺开头/上次结尾 → 对应 reason；窗口内第一条 → `no-previous`。
- [ ] 消息筛选：`compactSummary` / `isInterrupt` / `commandName` 记录不参与；`firstMessagePreview` 的 60/200 两个上限都走既有脱敏规则；原文不出现在结果里。
- [ ] 进行中：120_000ms 含；120_001ms 不含；负年龄按 0 → 进行中；非最后节点也可命中。
- [ ] 空态：0 项目 → `no-projects`；1 会话 → `single-session`；0 可定位 + N 未知 → `all-unknown`。
- [ ] 截断：40 个会话模型仍返回 40；隐藏数由组件计算（12 vs 40）。
- [ ] 文本：无 `NaN` / `Infinity` / `undefined`；无绝对路径、无编码目录名、无完整消息。

### 9.2 组件测试（`ProjectHandoffPanel.test.tsx`）

探针契约（e2e / 组件测试共用，避免两套定位）：

| 探针 | 挂在哪 | 值 |
| --- | --- | --- |
| `data-probe="project-handoff"` | 卡片根 | 固定 |
| `data-probe="handoff-toolbar"` | 切换条 | 固定 |
| `data-handoff-project` | 每个 chip | `project.key` |
| `data-probe="handoff-track"` | 轨道 listbox | 固定 |
| `data-handoff-node` | 每个节点 | `session.id` |
| `data-handoff-selected` | 选中节点 | 存在即选中 |
| `data-handoff-gap` | 每个间隔标签 | `gapMs` |
| `data-handoff-echo` | 命中空心圆 | 取整百分比 |
| `data-handoff-live` | 进行中徽标 | 固定 |
| `data-handoff-hidden` | 卡片根 | 隐藏数 |
| `data-probe="handoff-detail"` | 读数区 | 固定 |
| `data-probe="handoff-opening"` / `"handoff-closing"` | 两段引文 | 固定 |
| `data-probe="handoff-echo-line"` | 接续行 | 固定 |
| `data-probe="handoff-open-session"` | 打开会话 | 固定 |
| `data-probe="handoff-toggle"` | 显示全部/收起 | 固定 |
| `data-probe="handoff-count"` | 表头总数 | 固定 |
| `data-probe="handoff-empty"` | 空态根 | `single-session` / `all-unknown` / `no-sessions` |
| `data-probe="handoff-live-region"` | live region | 固定 |

- [ ] 渲染 `region`「项目接续」；`data-probe="project-handoff"`；切换条 chip 数与项目数一致，`aria-pressed` 正确。
- [ ] 默认选中**最右**节点；读数区显示该会话的时间范围、两段引文、接续行。
- [ ] 节点数 = `min(12, total)`；`data-handoff-hidden` = `total - 节点数`；点开关 → 节点数 = total；再点 → 回到 12。
- [ ] 间隔标签数 = 可见节点数 - 1；文案与夹具一致（同日/次日/N 天后）。
- [ ] 命中节点有 `data-handoff-echo`，未命中没有；接续行仍显示未命中的百分比。
- [ ] 点击第 2 个节点 → `data-handoff-selected` 移动；读数区更新；焦点没有跳到别处。
- [ ] 键盘：轨道内只有一个 `tabIndex=0`；`ArrowLeft/Right` 移动选中；`Home/End` 首末；`Enter` 调用 `onOpenSession` 一次；无回调时 `打开会话` 不渲染。
- [ ] `aria-activedescendant` 指向选中节点；`aria-label` 含时刻、标题、动作；命中时含百分比。
- [ ] 单会话夹具：`data-handoff-empty="single-session"`，无 `handoff-track`，有最后动作与打开按钮；`0 可定位 + N 未知` → `all-unknown`。
- [ ] 无工具夹具：节点动作是 `无工具调用`，不画 `—`。
- [ ] 无项目：组件返回 `null`；切换条也不渲染。
- [ ] CSS：模块 CSS 剥掉注释后无 `--danger` / `--success` / `--chart-` / `--cat-` / `color-mix` / `opacity` / `fill-opacity` / 十六进制颜色；`--warning` 只出现在 `.sampleWarning`；节点没有固定 `height`（有 `min-height`）；卡内无纵向滚动容器；无 `box-shadow`。
- [ ] 130%：给根元素加 `--font-scale: 1.3`，节点时间行的徽标可折行、不裁切；间隔标签不重叠；表头不横向溢出；引文仍是完整 60 字预览（不设行夹）。
- [ ] 切换项目：默认选新项目最右节点；记忆卡搜索被清空（页面级测试）。

### 9.3 e2e（Chromium + WebKit）

- [ ] 新夹具 `handoffScenario()`：项目 `handoff` 有 4–5 个会话，包含同日上午 2 小时、次日、3 天后；动作覆盖 `改` / `读` / `Bash` / `无工具调用`；至少一对命中（≥55%）与一对未命中；最后一条 2 分钟内 → 进行中；另一个项目只有 1 个会话。
- [ ] `memory` 档：切换条可见；选 `handoff`；`[data-handoff-node]` 数 = 5；动作文案含 `改 export-button.tsx`、`Bash · npm test`、`读 README.md`、`无工具调用`；无 `/Users`、`/repo` 绝对路径。
- [ ] 间隔标签文案与夹具一致（至少断言 `同日 · 2 小时后`、`次日 ·`、`3 天后` 这类稳定片段）；`data-handoff-gap` 数值与 `startTs` 差一致。
- [ ] 命中节点有 `data-handoff-echo`；点它 → 读数区含 `重合 68%`、两段引文；再点未命中节点 → 无空心圆、读数区含 `低于阈值`。
- [ ] `Enter` / 点 `打开会话` → 会话分析打开；焦点不留在 `<body>`（沿用既有握手）。
- [ ] 键盘：Tab 进入轨道 → 焦点环在选中节点；`Home` / `End` / `ArrowLeft` / `ArrowRight` 工作；节点滚动进视野。
- [ ] `显示全部` → 节点数 = total；`只看最近 12 次` → 回到 12；被隐藏的选中项回落到最右。
- [ ] 单会话项目 → `data-handoff-empty="single-session"`，无轨道。
- [ ] 130%：节点/标签/表头不重叠；轨道可横向滚动；页面无横向溢出；卡高仍由内容决定。
- [ ] 深色 / 高对比度：切主题后基线仍可见、空心圆可辨；模块没有语义色（组件测试守）；焦点环可见。
- [ ] 切换窗口 7 / 30 / 90：卡片重算；7 天只有 1 个会话时走单会话态；90 天节点仍最多 12（或展开）。

### 9.4 截图与真机

- [ ] `docs/screenshots/views.json` 在 `memory` 后新增 `memory-handoff`。
- [ ] `web/e2e/screenshots.spec.ts` 增加 `V_MEMORY_HANDOFF = declareView("memory-handoff")`，用 `handoffScenario()` 对 `[data-probe="project-handoff"]` 做元素截图（light/dark × Chromium/WebKit）。
- [ ] `memory` 页面截图因新增切换条与接续卡重出 4 张 PNG；确认 900 高下仍在首屏露出记忆卡表头。
- [ ] `docs/screenshots/manifest.json` 与 PNG 由截图脚本重出；`./scripts/check-screenshots.sh` 通过。
- [ ] `./scripts/gui-test.sh --build` 全绿；用量页「项目」档无横向溢出、无卡内纵向滚动条。

### 9.5 门禁与红线

- [ ] `tokens.css` 零 diff；`ProjectHandoffPanel.module.css` 无十六进制颜色。
- [ ] 没有引用 `--chart-*`、`--cat-*`；语义色只有 `--warning`（样本不足）。
- [ ] 没有 `color-mix`、`opacity` / `fill-opacity` 叠层、`box-shadow`。
- [ ] 零新增 Tauri 命令、零网络请求、零新增权限；组件只吃 `inputs / days / now / activeKey / onOpenSession`。
- [ ] 任何文案不含绝对路径、编码目录名、完整消息；文件名只 basename，命令前 3 token。
- [ ] `./scripts/lint.sh`、`npm --prefix web test`、`npm --prefix web run build`、`cargo fmt --check`、`cargo clippy -D warnings`、`cargo check`、`cargo test` 全绿。
- [ ] `CHANGELOG.md` 的 `[Unreleased]` → Added，中文条目。

---

## 10 实现落点

**新增**

- `web/src/features/usage/projectHandoff.ts` — 窗口裁剪、项目索引、会话排序、末动作、间隔文案、像素映射、回声评分、进行中、未知时间（纯函数）。
- `web/src/features/usage/projectHandoff.test.ts`
- `web/src/features/usage/ProjectHandoffPanel.tsx` + `.module.css` + `.test.tsx`
- `web/src/features/usage/ProjectSwitchStrip.tsx` + `.module.css`（或与面板同文件；切换条是独立可测组件）
- `web/e2e/project-handoff.spec.ts`

**修改**

- `UsageOverviewPage.tsx`：`activeProjectKey` 状态；`buildProjectHandoff(inputs, days, readouts.now, activeProjectKey)`；`view === "memory"` 时渲染 `<ProjectSwitchStrip>` + `<ProjectHandoffPanel>` + `<ProjectMemoryPanel activeKey={handoff.activeKey}>`；把 `onOpenSession` 传下去。
- `ProjectMemoryPanel.tsx` / `.module.css`：移除左栏 rail 与 `activeProject` 状态；接收 `activeKey` 与 `activeName`（**用 handoff 的 `name`，含同名后缀**，否则同名项目在两张卡里显示不同名字）；按 key 找记忆（找不到显示空态，**不退回第一个项目**）；内容包进 `Panel title="项目记忆"`；项目名改为体内 `h3`；搜索在切换 key 时清空；chip 样式提升到切换条，不复制第二套。外层不再保留第二个 `aria-label="项目记忆"` 的 `section`，避免两个同名 landmark。
- `projectMemory.ts` / 测试：分组键从显示名改为 `projectLabel`；`ProjectMemory` 增加 `key`（并保留 `project` 作为显示名）；同名时页面按排序追加 `（2）`；因为切换条接管了项目列表，构建时不要再截在 8 个项目（传 `maxProjects: Number.POSITIVE_INFINITY` 或去掉该上限），否则第 9 个项目会在记忆卡里找不到。
- `web/e2e/fixtures.ts`：`handoffScenario()`。
- `web/e2e/screenshots.spec.ts`、`docs/screenshots/views.json`、`docs/screenshots/manifest.json`、4 张 `memory` PNG + 4 张 `memory-handoff` PNG。
- `CHANGELOG.md` 的 `[Unreleased]`。

**复用而不是重写**

- `labWindow`、`dayStartOf`、`addLocalDays`（`constellation.ts` / `usageAggregations.ts`）。
- `formatProjectPath`、`formatShortStamp`、`formatDuration`（`lib/format.ts`）。
- `firstMessagePreview`（脱敏 + 截断；60 与 200 两个上限）。
- `topicSignature`、`jaccard`、`ECHO_THRESHOLD`（`echoTopics.ts`）。
- `normalizeCommand`、`filePathOf`（从 `projectMemory.ts` 导出或抽到共享模块；不要复制第二套取径/归一规则）。
- `basename`（`lib/path.ts`）。
- `Panel`、`EmptyState`、`ScrollArea`。
- 120s 活性阈值：与 `pulseModel.LIVE_MS` 同值；跨 feature import 不合适时在 `projectHandoff.ts` 定义同名常量并注释同源，不要写两个不同的秒数。

---

## 11 最容易出错的三个点

1. **把间距画成线性轴，或把节点画成等距**
   线性会让密集的一周挤成一个点、稀疏的三个月吃掉全幅；等距会直接抹掉「隔了多久」，比线性更糟。必须用 `44 + 8×log2(hours)` 的对数映射，并在脚注写明「每翻一倍多 8px，不是等比例」；精确值由间隔标签与节点时刻承担。日差用 `Math.round` 的本地日键，不要 `+86_400_000`，否则 DST 日会错一天。

2. **把「重复交代」画成警报，或用语义色**
   68% 是确定的文字重合，不是错误、不是不确定信息、也不是「健康读数」。用 6px 中性空心圆 + 接续行正文墨色；`--danger` / `--success` 一律不用，`--warning` 只染「样本不足」四个字。文案只写「本次开头与上次结尾重合 68%」，不写「你在重复劳动」——一旦上色或下判断，这张卡就从事实变成训话。

3. **两个项目选择器，或分组键用显示名**
   接续卡自带下拉、记忆卡自带左栏，选中不同步时用户会看到「上面 A、下面 B」。必须把项目 chip 提升为两张卡之上的唯一切换条，两张卡都吃同一个 `activeKey`。分组键用 `projectLabel`，显示名只用于展示：两个 worktree 同名时按显示名合并会算错账，切换条的项目数也会和记忆卡对不上；同名项目追加 `（2）`，不显示编码目录名。另：模型返回全部会话、组件只截 12 条；隐藏节点仍要参与回声评分，否则第一条可见节点的「上次」会算错。

> 其余容易漏的：`进行中` 只按 120s 判，脚注写明「日志刚写过，不代表进程在运行」；时间未知的会话不猜时间、只计数；窗口右界是 `now`（含），不把未来时间戳算进来；文件名只 basename、命令只前 3 token；单会话不画一条没有间隔的轨道；切换条在 960 下不能把表头挤出横向溢出。
