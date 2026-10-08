# Round I 竞品调研

调研日期：2026-10-07
调研人：产品调研子 agent
数据来源：`gh api` 直查 GitHub 公开 API、Hacker News Algolia API、WebSearch/WebFetch。
**所有星数与 👍 数都是 2026-10-07 当天的快照**，会变。

> 标注约定：**【确认】**＝有可点开的来源 URL 支撑；**【推测】**＝我的判断/外推，没有直接来源。
> 本报告刻意区分这两类。凡是我没验证的，一律标【推测】。

---

## 1. 现状盘点（先确认我们站在哪里）

以下全部读自仓库自身，不是凭描述（`README.md`、`CHANGELOG.md`、`web/src/features/usage/`）。

**已具备**（`README.md` Features 段 + `CHANGELOG.md`）：

- 会话浏览器（时间线 / 项目分组）、日志表（user / LLM / tool / agent / workflow / wait 行模型 + 耗时、占比、waterfall 列）
- 耗时树（agent / workflow 子会话图）
- 用量总览（7/30/90 天趋势、按项目、按模型、7×24 热力图，每个数字带来源徽章）
- **5 小时计费窗口卡片**（消耗表盘、窗口开关时间、按消耗速率推算触达上限时刻）
- ⌘K 全局搜索、会话导出（单文件 HTML / CSV）、本地归档、字号缩放 90–130%
- AI 分析报告（本地 `claude` CLI）、双渠道自动更新、实时监控嵌入、ANSI 原色渲染

**代码层面的关键事实**（决定后续「成本」估算是否成立）：

- `web/src/features/usage/billingWindow.ts` 一个文件 —— **全应用只有「5 小时」这一种窗口**
- `web/src/features/usage/planLimits.ts` 的 `PLAN_PRESETS` 是**单个标量** `limitTokens`
  （文件注释自己写着：预设主要参考 Claude-Code-Usage-Monitor 的计划模型，Anthropic 未公布官方数字）
- `BillingWindowCard.tsx` 一张卡片 —— 加第二张窗口卡片有现成的表盘/徽章/读数原语可复用
- 全仓 `grep -riE "weekly|每周|周用量" web/src` **零命中** —— 没有「周」的概念，7/30/90 天只是**消耗趋势**，不是**限额窗口**

**GitHub Issue 现状**（`gh issue list --state all`）：开着的 5 条全是 CI / 依赖 / 技术债
（#127、#118、#106、#80、#73、#19），**没有任何一条用户侧功能请求积压**。
含义：路线图是我们自己定的，没有「用户已经喊了但我们没做」的账 —— 所以本轮方向必须靠外部证据推。

---

## 2. 竞品逐条

### 2.1 CLI 用量分析（体量最大的一层）

| 项目 | ★ | 形态 | 数据源 | 备注 |
| --- | --- | --- | --- | --- |
| [ccusage/ccusage](https://github.com/ccusage/ccusage) | **18,897** | CLI（`npx ccusage`） | 本地 JSONL | 生态事实标准，[官网 ccusage.com](https://ccusage.com)，已扩到 Codex / OpenCode / Copilot / Amp |
| [getagentseal/codeburn](https://github.com/getagentseal/codeburn) | **11,344** | TUI（Ink） | 本地 JSONL + Cursor `state.vscdb` | 「跨 37 种工具，**by model, project, and task**」；[HN 112 分 27 评](https://news.ycombinator.com/item?id=47759035) |
| [Maciek-roboblog/Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) | **8,733** | Python Rich TUI | 本地 JSONL + `--statusline` | 5 小时窗口仪表盘 + 计划预设 + 预测告警的鼻祖型工具 |

### 2.2 GUI / 菜单栏（与我们形态最接近的一层）

| 项目 | ★ | 形态 | 备注 |
| --- | --- | --- | --- |
| [winfunc/opcode](https://github.com/winfunc/opcode)（原 `getAsterisk/claudia`） | **22,419** | Tauri 桌面 GUI | 会话管理 + 自建 agent；不是分析器，但是「Tauri + 会话」这条路的规模证明 |
| [sirmalloc/ccstatusline](https://github.com/sirmalloc/ccstatusline) | **13,202** | Claude Code statusline | 高度可定制状态栏，纯终端内嵌 |
| [Iamshankhadeep/ccseva](https://github.com/Iamshankhadeep/ccseva) | **806** | macOS 菜单栏（Swift） | 「**weekly & 5-hour limits**」+ OAuth 端点取真实限额 |
| [CodeZeno/Claude-Code-Usage-Monitor](https://github.com/CodeZeno/Claude-Code-Usage-Monitor) | **572** | Windows 任务栏 | Windows 侧的对位实现 |
| [karanb192/hindcast](https://github.com/karanb192/hindcast) | **10** | macOS 本地会话浏览器 | 自称「ccusage alternative」，时间线 scrubber + 成本 |
| [WiseeCarrot/claude-transcript-viewer](https://github.com/WiseeCarrot/claude-transcript-viewer) | **0** | **Tauri/Rust 桌面** | 与我们的架构几乎同构（JSONL → 时间线 + 全文搜索），**0 星** |

**会话浏览器这一层没人赢**（我搜到十余个同类仓库，最高 10 星，多数 0–3 星）。
**【推测】**原因不是没人要，而是这一类工具做不出「打开就想用」的手感 —— 这正是 CC Analyzer 已经投过资的地方（仪器面板语言、真机几何门禁、字号缩放）。

### 2.3 云端 / 代理型（红线相关）

| 项目 | ★ | 为什么**不**是我们的对手 |
| --- | --- | --- |
| [snipeship/ccflare](https://github.com/snipeship/ccflare) | 1,050 | 是要把 API 流量**导过它**的代理，不是读日志 |
| Langfuse / Helicone / Arize Phoenix / Braintrust / OpenLLMetry / LiteLLM dashboard | — | 面向 **API 付费方**的可观测性，需要 SDK 埋点或网关；订阅制用户根本没有这些数据 |
| ccusage 官方社区页列的 Straude / viberank / CCWarriors / Token Battle | — | **排行榜，全部要求把用量上传到服务器**（见 [community-projects.md](https://github.com/ccusage/ccusage/blob/main/docs/guide/community-projects.md)） |

**云与代理这一整层对我们不是竞品，是「不可选项」**——见第 5 节。

---

## 3. 真实用户抱怨（证据在 URL 上，不在我的转述里）

### 3.1 「限额来得莫名其妙」是压倒性的第一痛

- [anthropics/claude-code#16157](https://github.com/anthropics/claude-code/issues/16157) — *Instantly hitting usage limits with Max subscription*，**👍695**
- [anthropics/claude-code#38335](https://github.com/anthropics/claude-code/issues/38335) — *Max plan session limits exhausted abnormally fast since March 23, 2026 (CLI usage)*，**👍476**
- [anthropics/claude-code#41930](https://github.com/anthropics/claude-code/issues/41930) — *Critical: Widespread abnormal usage limit drain across all paid tiers*，**👍97 / 108 评论**。原文（我读了全文）：「**For some users, a single "hello" consumes 2% of their session. That is not a degraded experience — that is a broken product.**」并且投诉 Anthropic「No blog post. No email to subscribers. No status page entry.」

**【确认】**用户真正缺的不是「再一个数字」，而是**能自己验证限额去哪了的东西**——这恰好是本地日志能独有提供的。

### 3.2 「数字不准」——所有用量工具被投诉最多的一条

ccusage 按 👍 排序的 issues 头部几乎全是准确性问题（`gh api` 拉取，2026-10-07）：

| # | 👍 | 标题 |
| --- | --- | --- |
| [288](https://github.com/ccusage/ccusage/issues/288) | 16 | *Live token usage is **still** incorrect*（live 的 burn rate 算了缓存 token，token 计数没算） |
| [705](https://github.com/ccusage/ccusage/issues/705) | 12 | *Output token count is highly inaccurate.* |
| [483](https://github.com/ccusage/ccusage/issues/483) | 11 | *Live Blocks not accurate, Limit reached earlier* |
| [487](https://github.com/ccusage/ccusage/issues/487) | 8 | *Inaccurate Live Token Usage Monitor Data* |
| [298](https://github.com/ccusage/ccusage/issues/298) | 7 | *shows normal usage, but limit is reached in claude. Why it is misleading?* |
| [331](https://github.com/ccusage/ccusage/issues/331) | 5 | live 的 USAGE 表盘上限给得太大，快撞限额了表针也不动 |

CCUM 侧同样：
[#212](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/212) *monitor dosnt look accurate*（👍6，**开着**）、
[#137](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/137) *It is not accurate anymore without Claude Agents monitoring!*（👍10）、
[#106](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/106) *Limit reset time not accurate*（👍11）。

**【确认】**「估算 vs 读数」的混淆是全行业的通病。
**【推测但把握高】**CC Analyzer 的**来源徽章**（读自日志 / 估算）+「窗口不足 30 分钟就说数据不足」这套克制设计，
在同层竞品里我没找到对位物，这是现成的差异化资产——**该被当成卖点讲，而不只是内部纪律**。

### 3.3 「周限额」——被反复要求、我们完全没有

- [CCUM#167](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/167) — *Add Weekly Usage and Weekly Reset Day/Time*，**👍13**（该仓库按 👍 排的第二名）
- [CCUM#163](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/163) — *Calculate weekly Opus-hours*，👍4
- CCSeva 的 README 卖点直接写着「Native Swift rewrite + ccusage v20, **weekly & 5-hour limits**」（[Iamshankhadeep/ccseva](https://github.com/Iamshankhadeep/ccseva)）
- ccusage 侧：[#483](https://github.com/ccusage/ccusage/issues/483)、[#483 同族](https://github.com/ccusage/ccusage/issues/483) 及 *weekly limit* 相关 issue 反复出现

**【确认】**Claude 的订阅已经是**两层限额（5 小时滚动 + 周）**，而 CC Analyzer 只做了 5 小时那一层。
`planLimits.ts` 里也只有一个标量 `limitTokens`。

### 3.4 「多机 / 多账号」——用户反复要，但**我们不能做**

- [ccusage#222](https://github.com/ccusage/ccusage/issues/222) — *Feature Request: Accurate Claude Code Usage Tracking Across Multiple Devices*，👍8。原文：「usage data remains fragmented across different machines, leading to an incomplete overview」
- [ccusage#14](https://github.com/ccusage/ccusage/issues/14) — *Add support for multiple Claude Code instances running at the same time*，👍4
- [ccusage#287](https://github.com/ccusage/ccusage/issues/287) — 要求「opt-in sync daemon，多机推送到一个 hub」，👍0（**没被社区顶起来**）
- [anthropics/claude-code#18435](https://github.com/anthropics/claude-code/issues/18435)（多账号，**👍859**）、[#36151](https://github.com/anthropics/claude-code/issues/36151)（**👍750**）

**【确认】**需求真实存在。**【确认】**ccusage 至今没做（#222 是 closed）——**不是没想到，是与「纯本地」冲突**。
**【推测】**ccusage#287 只得 0 👍 说明：**用户愿意喊「多机」，但不愿意为此跑一个同步服务**。我们没有输在这里。

### 3.5 「压缩（compaction）之后发生了什么」——真空中

- HN 评论 [olejorgenb](https://news.ycombinator.com/item?id=49222802)（原文引用）：
  > *Claude Code and Codex persist sessions as JSONL, and **compaction rewrites those files in place. There is no version history, so when a session gets compacted you cannot tell what was dropped** — which matters if the agent silently lost the constraint you gave it forty turns ago.*
- HN 帖 [*Auto-compaction felt fine. The invoice didn't*](https://news.ycombinator.com/item?id=46851021)：
  > *I let Claude Code context accumulate and **burned $2,000+ in tokens — without noticing any quality drop** … The only thing that went wrong was the bill.*
- HN 帖 [*Context Gateway – Compress agent context before it hits the LLM*](https://news.ycombinator.com/item?id=47367526)，**97 分 / 64 评**（同一焦虑的另一侧回应）
- [Show HN: Claude Code Context Analyzer](https://news.ycombinator.com/item?id=48471407) → [manavgup/context-analyzer](https://github.com/manavgup/context-analyzer)：唯一一个正面做「上下文被什么吃掉」的，体量极小

**【确认】**「会话什么时候被压缩了 / 压缩丢了什么」是一个**有人明确抱怨、且没有成熟工具接手**的问题。
**【推测】**我们做这件事的成本被低估了有利因素：`parseJsonl` 已经在做行级解析，压缩边界在 JSONL 里是可识别的记录类型。

### 3.6 「同时跑好几个会话，看不见谁在忙」

- HN 评论 [Stargx](https://news.ycombinator.com/item?id=47314376)（原文）：
  > *I've been running 3–4 Claude Code sessions simultaneously and kept hitting the same problem: **no way to see which session is thinking vs idle vs waiting for input, no visibility into context window usage across sessions.***

**【确认】**抱怨存在（单条，样本小）。**【推测】**这是「实时监控」象限，不是「分析」象限，与 CC Analyzer 的定位有偏移。

### 3.7 「按任务看钱花在哪」——竞品给出的市场验证

- [getagentseal/codeburn](https://github.com/getagentseal/codeburn) 的定位就是 `by model, project, and task`，**11,344 ★**
- 该项目的 HN 顶部评论（[Isolated_Routes](https://news.ycombinator.com/item?id=47759035)）：
  > *An interesting next iteration would be to add a functionality that **evaluates a user's work for inefficiencies and suggests where they can improve cut cost.***
- HN 评论 [steve_luo](https://news.ycombinator.com/item?id=47514002)，`ccusage_go` 作者：
  > *Data showed **97.7% cache overhead vs 2.3% actual compute.***

**【确认】**「钱花在什么活动上」有市场（CodeBurn 用 11k 星证明了）。
**【确认】**同帖的 `halostatue` 立刻指出 CodeBurn 的 Cursor 支持是坏的、`Normal_gaussian` 说它的活动分类可疑（"it has 1 turn of planning for me in the last 30 days"）——**分类准确性是这类功能的软肋**。

### 3.8 「别让我为了看个数字装一堆东西」

- HN 评论 [simonw](https://news.ycombinator.com/item?id=44610925)：
  > *Maybe this kind of thing would be better written in Deno? Deno has mechanisms for allow-listing the exact files the process can access — in this case you would want to give it **read-only access to the log files in the ~/.claude directory and nothing else**.*
- HN 评论 [thebestmoshe](https://news.ycombinator.com/item?id=44610925)：
  > *does anyone have thoughts on the security aspect. Getting people used to just running code like this that has **full access to the system** is slightly concerning.*
- HN 评论 [dhorthy](https://news.ycombinator.com/item?id=49023196)：
  > *I'm always afraid of building against these **internal JSONL apis that claude code uses since they change all the time** / not a formal product interface.*

**【确认】**（1）用户对 `npx` 跑读日志的工具有真实的安全顾虑；（2）「JSONL 格式会变」是这类工具的结构性风险，用户自己说出来了。
**【推测】**第（1）条对 CC Analyzer 是**被浪费的资产**——我们是签名安装包 + Tauri capability 显式白名单 + 零网络，比 `npx` 安全得多，但 README 只在最后一行提了「Local-first & private」。
**【推测】**第（2）条是产品机会：既然格式会变，**「这次解析有多少行没看懂」应该是可见的**，而不是静默丢弃。

### 3.9 周边但值得记录

- CCUM[#132](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/132) 要「按币种显示成本」（👍3，**开着**）；生态已有 [scx](https://github.com/yamamutami/scx) 做这件事
- CCUM[#31](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/31) 要 brew；[#94](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/94) 要多账号（👍6）
- CCUM[#55](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/55) *Unreadable in light mode*（👍5）、[#75](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor/issues/75) *blank terminal under MacOS*（**👍19**，该仓库最高）
  → **【确认】连体量最大的 TUI 竞品，被顶得最高的问题之一是「看不清」**。这正好印证维护者「界面美观度优先」的判断方向是对的，不是洁癖。
- 「Wrapped / 年度回顾」有持续的个人项目群（[Dylan-Nihilo](https://github.com/Dylan-Nihilo/claude-code-wrapped) 22★、[jarrodwatts](https://github.com/jarrodwatts/ccwrapped) 5★ 等），**没有一个做大**
- opcode 的头部需求是**远程 SSH（👍34）、Windows 支持（👍17）、多 CLI agent（👍15）**——用户想要「离开本机」和「多工具」，二者都与我们的红线或定位不符

---

## 4. 候选功能与优先级（价值 ÷ 成本）

成本按「在这个仓库里要动多少东西」估：**低**＝复用一个已有原语；**中**＝新增一个 feature 模块 + 测试；**高**＝要动解析层或新增运行时能力。
每项后面都写了**为什么是这个项目**，不是「别人有」。

### ⭐ #1 每周限额窗口（7 天滚动）——成本 中 / 价值 高

**做什么**：在现有 5 小时卡片旁增一个周窗口读数（本周已消耗、周窗口重置时刻、按当前速率推算的触达时刻），
沿用同一套来源徽章与「数据不足就说不足」的克制规则。

**为什么是 CC Analyzer**：
- 我们的 `billingWindow.ts` 已经把「窗口聚类 + burn rate + 触达推算」这套算法写通并测过，**周窗口是同一算法换一个窗口长度**——成本主要在 UI 与测试，不在重造轮子
- 竞品里 CCUM 的第二高请求、CCSeva 的头号卖点都是它，**我们却是唯一只有半套的**
- `planLimits.ts` 的 `limitTokens` 需要从标量扩成「5 小时 / 周」两档——这是**已识别的、边界清楚的改动**
- 与既有定位同频：README 首页那句话（「人们整天在看的永远是那三个数」）在加了周限额之后**依然成立**，只是从三个数变五个

**风险**：周限额的社区估算值比 5 小时更不可靠 → 必须继续走「预设只是参考、可用自定义、不选计划就不显示百分比」的既有纪律。

### ⭐ #2 压缩取证：把「会话什么时候被压缩、丢了什么」画出来——成本 中 / 价值 高

**做什么**：在时间线/日志表上标出压缩边界；给出「压缩前 / 后的上下文规模」对比；
点到某个边界能看到「这一段之后，以下内容不再出现在上下文里」。【推测】JSONL 里的压缩摘要记录是天然锚点。

**为什么是 CC Analyzer**：
- **我们的行模型天然容纳它**——既然已经有 user / LLM / tool / agent / workflow / wait 六种行，第七种「压缩边界」行不会破坏语言
- 我们有耗时树和时间轴刻度，压缩边界是**时间轴上的事件**，与既有可视化同构
- 这是**只有本地日志分析器能做的事**：菜单栏工具（CCSeva 类）和排行榜类永远做不了；CLI 工具（ccusage）的表格形态也装不下
- 用户抱怨已确认存在且无成熟工具接手（§3.5），而它的价值叙事极强：**「你四十轮之前给的那条约束，是在这里被丢掉的」**
- 【推测】与我们已有的 AI 报告天然互补：「为什么这次会话后期变蠢了」现在有一个可指认的答案

**风险**：压缩记录的具体字段需要先验证（见第 6 节待验证事项），**动手前必须先看真实 JSONL**，不能按 HN 的转述实现。

### ⭐ #3 「这次解析有多少行没看懂」——格式漂移可见化——成本 低 / 价值 中高

**做什么**：扫描完成后，如果遇到无法识别的记录类型/字段，**显式显示**「本会话共 N 行，其中 M 行是当前版本不认识的类型」，
并在设置里给一条「报告无法解析的行」的复制按钮（内容进剪贴板，不上传）。

**为什么是 CC Analyzer**：
- 用户亲口说出了这个风险（§3.8 `dhorthy`：「these internal JSONL apis … change all the time」）。**全行业把它当负债，我们可以把它变成信任资产**
- 与我们既有的**来源徽章**是同一种设计语言：宁可标出来，也不假装完整
- 成本极低——解析器已经在逐行读，只是现在静默丢弃
- 它是**所有其他功能的信誉兜底**：有了它，「不准」类投诉（§3.2）才有归因路径

### #4 成本归因：钱花在哪类活动上——成本 中高 / 价值 中

**做什么**：把 token 按活动归类（实现 / 探索读文件 / 计划思考 / 用户对话 / subagent），在用量总览里给一个分布。

**为什么是 CC Analyzer**：我们已有按项目、按模型两个维度 + 缓存读取读数，加第三个维度是**同一个图表原语**；CodeBurn 用 11k 星验证了市场。

**但排在 #4，理由要说清楚**：同帖立刻有人质疑其分类准确性（§3.7），而**这个项目的性格是不允许给一个自己站不住的分类**。
**【推测】**如果做，必须走**纯规则 + 公开规则**（例：「本轮无 tool 调用的 LLM 记录」算思考），并且**不叫「效率评分」**——
一旦开始给用户的提问方式打分（claudescope 那类 "prompt health scoring"），就违背了项目「宁可说数据不足」的克制。

### #5 成本本地化（币种 / 单位）——成本 低 / 价值 低

**做什么**：成本显示支持选择币种与固定汇率。

**为什么是 CC Analyzer**：我们有 `pricingSnapshot.ts`（离线价格快照 + 标注日期）这个现成结构，加一层显示换算很便宜。

**但只值第 5**：CCUM#132 只有 👍3，生态里 [scx](https://github.com/yamamutami/scx) 已经做了。
它**不会带来一个用户**，属于 QoL 补丁。**【推测】**如果汇率要联网取就**不应该做**（破红线）；固定汇率手填可以。

### #6 常驻 CLI：把总览结论吐给 statusline / 脚本——成本 中高 / 价值 中

**做什么**：随应用附带一个轻量可执行，输出一行 JSON / 紧凑文本（当前窗口、周窗口、触达预测），
供用户自己的 statusline 或脚本消费。

**为什么是 CC Analyzer**：这是 ccstatusline（**13,202 ★**）与 CCUM v4 的 `--statusline` / `--once` 验证过的集成点，
而我们的**深度分析**是 statusline 永远给不了的。**GUI 与 CLI 是补集不是竞争**。

**为什么不在前三**：需要新增一个 Rust binary target 并改动打包脚本，而打包**不被 CI 覆盖**——
按仓库规矩这是「只有发布时才会炸」的那一类改动，成本被系统性低估。

### #7 Wrapped / 年度回顾（可分享、纯本地）——成本 中 / 价值 中（**获客**向）

**做什么**：一键生成一张可分享的年度/月度回顾图或单文件 HTML。

**为什么是 CC Analyzer**：我们已经能导出**自包含单文件 HTML**（零外链、零脚本、转义），
**「可分享」这条链路已经铺好了**，Wrapped 只是换一套排版与叙事。持续有个人项目在做（§3.9）且没一个做大。

**红线处理**：产物必须是**本地文件**，由用户自己决定发不发——**应用绝不代传**。这与服务端排行榜（§2.3）是本质区别。

**降权理由**：它是一次性新鲜感，且**与维护者「精致优先」的取向有张力**——
Wrapped 做不好就是廉价海报。**要么做得很好看，要么不做。**

### #8 归档自动化——成本 低 / 价值 中（**留存**向）

**做什么**：设置里给归档一个「每天/每周自动跑一次」的开关（现在只有手动「立即归档」）。

**为什么是 CC Analyzer**：归档已实现且幂等、增量、默认关闭——加个定时器是**很小的改动**。
Claude Code 约 30 天清理，**用户晚一天打开应用就永久损失一天数据**；
自动归档直接保护了 #2 / #4 / #7 全部功能的数据底座。

**降权理由**：这是留存不是获客，且它解决的是「用户还没养成习惯」的问题——
**【推测】**优先级取决于我们是否先把「值得每天打开」的功能做出来。

---

## 5. 不建议做（及理由）

| 不做 | 理由 |
| --- | --- |
| **多机同步 / 云端仪表盘 / 排行榜**（Straude、viberank、CCWarriors、Token Battle、ccusage#222/#287） | **直接违反「会话数据不出本机」红线**。需求是真的（👍8），但 ccusage#287 的同步守护进程只拿到 0 👍 说明**用户不愿为此跑服务**。替代：把归档做成可迁移的目录导出，让用户**自己**用任何方式搬运 |
| **代理 / 网关型观测**（ccflare 1,050★、LiteLLM、Helicone、Langfuse、Phoenix、Braintrust、OpenLLMetry） | 前提是**把 API 流量导过它**。我们的用户是订阅制，数据源是日志不是请求管道；这条路要求用户改自己的接入方式，且必然联网 |
| **多账号切换**（anthropics#18435 👍859 / #36151 👍750） | 那是 Claude Code 自己的职责。一个读日志的分析器**在原理上做不到**切换账号，硬做只会变成不可靠的猜测 |
| **按提问质量给用户打分**（claudescope 的 "prompt health scoring"、claude-code-session-analyzer 的 "scores your AI collaboration patterns"） | 结论不可证伪，且与项目「每个数字带来源徽章 / 宁可说数据不足」的克制气质**正面冲突**。维护者把精致排在功能数量之前，这类恰恰是「功能数量的味道」 |
| **远程 SSH / 多 CLI agent 支持**（opcode 👍34 / 👍15） | 远程访问破红线；多 agent 支持要把解析层扩成多套 schema，而 §3.8 已确认**单套 schema 的漂移就是风险**。先把自己的日志吃透 |
| **毫秒级实时 tail** | 成本高（需要文件监听 + 增量渲染 + 活跃会话检测），收益低——我们被选择是因为「事后看清」，不是因为「实时」。实时监控已经以「嵌入用户自建面板」的方式存在 |
| **Wrapped 作为核心功能** | 它是获客插件，不是能力。**只能作为 #7 那种形态存在**，绝不能让它在 README 里占据与「5 小时窗口」同等的分量 |
| **联网取汇率 / 联网校验价格** | 破红线。成本本地化只能用手填固定汇率（见 #5） |
| **为「来源徽章」之外再加一套自动精度修正** | 现状已经是「宁可标不确定，也不猜」。**改成猜会毁掉唯一的信任资产** |

---

## 6. 动手前必须先验证的事（否则上面全作废）

1. **压缩记录的真实形态** —— 打开 `~/.claude/projects/**/*.jsonl`，确认真实存在压缩边界记录、字段名与形态。
   #2 完全建立在这一条上。**若不存在可识别的锚点，#2 降级或放弃。**
2. **周限额在日志里有没有可推算的锚点** —— 若无任何本地证据，周窗口只能靠消耗量 + 用户手填阈值，
   那么必须**明确标为估算**（沿用既有徽章纪律），且不能假装知道官方重置时刻。
3. **「无法解析的行」目前是什么行为** —— 读 `parseJsonl` 现有实现，确认现在是静默丢弃还是已有计数。
   若已计数，#3 的成本会从「低」降到「很低」，可以顺手进任意一轮。
4. **周窗口的单位** —— Claude 的周限额是否按 token 还是按「Opus-hours」计价（CCUM#163 提了这个），
   决定了 UI 用「消耗量」还是「时长」表达。

---

## 7. 一句话结论

**本轮最该做的是「每周限额窗口」——它是唯一一个「用户反复要、竞品都做了、而我们算法与 UI 原语已就绪、只差把窗口从 5 小时扩到 7 天」的方向，
成本是中等而不是高，做完 README 首页那句「人们整天在看的那几个数」会直接从三个变五个。**
紧接其后的「压缩取证」价值更高但**必须先看真实 JSONL 才能定**，且它是真正无人占位的空地。