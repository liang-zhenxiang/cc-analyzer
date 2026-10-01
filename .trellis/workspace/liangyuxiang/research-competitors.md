# 竞品调研报告：Claude Code 用量/会话分析工具

> 调研日期：2026-10-01 · 调研人：竞品调研 agent
> 对象：cc-analyzer（Tauri 2 + React 离线桌面应用，解析本地 `~/.claude/projects` JSONL）
> 方法：WebSearch + GitHub 页面/README 抓取 + GitHub API（star/issue 数据）

---

## 一、逐项分析

### 1. ccusage（ccusage/ccusage，原 ryoppippi/ccusage）

- **定位**：`npx ccusage` 零安装即用的 CLI，从本地 JSONL 分析编码 agent 的 token 用量与成本
- **规模/活跃度**：⭐ 18.8k，857 forks，2026-10-01 仍在推送，MIT，生态最成熟
- **核心功能**（⟵ 标记 = cc-analyzer 目前没有的）：
  - daily / weekly / monthly / session 四种聚合报告 ⟵
  - `blocks`：Claude 5 小时计费窗口报告 + 活跃 block 监控 ⟵
  - `statusline`：Claude Code 状态栏 hook 集成（Beta）
  - 成本估算：内嵌 LiteLLM 定价快照（构建时锁定 + 定时 PR 自动更新），支持 `ccusage.json` 按模型覆盖价格，`--offline` 全离线 ⟵
  - `--breakdown` 按模型拆分成本、`--instances` 按项目分组、`--project` 过滤 ⟵
  - 支持 18 种 agent CLI（Codex、OpenCode、Gemini、Copilot、Grok 等）⟵（cc-analyzer 仅 Claude Code）
  - 缓存创建/缓存读取 token 分开统计
  - `--json` 机器可读输出
- **界面**：无图形界面——彩色终端表格，终端 <100 列自动切紧凑模式，`--compact` 便于截图分享
- **高频痛点**（按 reaction 排序的 issue）：
  - **数据准确性被反复投诉**：「Live token usage is *still* incorrect」(+16)、「Output token count is highly inaccurate」(+12)、「Live Blocks not accurate, Limit reached earlier」(+11)
  - statusline 造成无限进程派生 → 100% CPU (+10)
  - npx 分发可靠性：升级后模块找不到（+33、+22）、EUNSUPPORTEDPROTOCOL (+20)
  - sqlite 迁移后 OpenCode 数据消失 (+33)
- **对 cc-analyzer 的启示**：成本估算与 5h 窗口是用户最强的两类需求；准确性问题是头部工具的最大软肋，谁准谁赢。

### 2. Claude-Code-Usage-Monitor（Maciek-roboblog）

- **定位**：隐私优先的实时终端监控（Rich TUI），带预测与告警
- **规模/活跃度**：⭐ 8.7k，465 forks，v4.0.0（2026-06），2026-07 后推送放缓
- **核心功能**：
  - 5 小时限额窗口实时跟踪 + 窗口到期预测 ⟵
  - **订阅计划感知**：内置 Pro(~19k tok/$18) / Max5(~88k/$35) / Max20(~220k/$140) / Team 限额 ⟵
  - **P90 自动检测**：分析最近 192 小时历史为 Custom 计划智能推算限额 ⟵
  - burn rate（每分钟 token 速度）、多会话消耗模式分析、成本预测 ⟵
  - **Provenance 标签**：每个数值标注 official / local_estimate / experimental / unknown 置信级别 ⟵
  - 官方 statusline rate_limits 数据可用时优先采信，否则回退本地估算
  - 本地数据仓库（可选）：按项目/模型/天持久化，导出 CSV/JSON，超越 Claude 自身的 30 天清理 ⟵
  - `--once/--compact/--write-state` 机器可读输出 + 自动化退出码（10=接近限额、11=到达）
  - 多数据目录扫描（多账号不合并）
- **界面**：Rich 实时 TUI，进度条采用「WCAG 合规配色」，亮/暗背景自动检测，自适应布局，sparkline，emoji/表头/模型分布条可关
- **高频痛点**：macOS 白屏 (+21)、**周用量与周重置时间** (+20)、准确性（agents 未监控就不准 +11、限额重置时间不准 +11）、时区问题 (+9)、多账号 (+6)、「token 何时耗尽」缺日期时间上下文 (+6)
- **对 cc-analyzer 的启示**：计划感知 + burn rate + 预测是订阅用户的核心刚需；provenance 标签是化解「准确性信任危机」的优雅设计；周重置与多账号是被忽视的需求。

### 3. claudia → 已改名 opcode（getAsterisk/claudia → winfunc/opcode）

- **定位**：Claude Code 的完整 GUI 工具箱（不止分析，还包括操控）
- **规模/活跃度**：⭐ 22.4k，1.7k forks，AGPL-3.0，2026-09 仍活跃；**技术栈与 cc-analyzer 几乎相同**（Tauri 2 + React 18 + TS + Vite，Tailwind v4 + shadcn/ui，SQLite）
- **核心功能**：
  - 项目与会话管理：`~/.claude/projects/` 可视化项目浏览器、会话历史（日期/消息数）、**恢复会话**、跨会话智能搜索、会话洞察 ⟵
  - **用量分析仪表盘**：成本跟踪、按模型/项目/时间�� token 分析、可视化图表、导出 ⟵
  - 自定义 agent 创建与后台执行（带通知）
  - MCP 服务器管理
  - **时间机器/检查点**：会话版本化、可视化时间线、一键恢复到任意检查点、从检查点 fork 会话、diff 查看器 ⟵
  - CLAUDE.md 内置编辑器 + 实时预览
- **界面**：shadcn/ui 组件体系，深色为主的三栏布局（项目/会话列表 + 主工作区标签页），现代化桌面应用质感
- **高频痛点**：Plan mode 请求 (+50)、SSH 远程会话 (+34/+16)、claude-code-router 自定义模型 (+22)、**macOS 打包后 `env: node` 找不到** (+18/+16)、Windows 编译版 (+17)、其他 agent 支持 (+17)、**4K 屏 GUI 太小看不清** (+14)
- **对 cc-analyzer 的启示**：证明「Claude Code 桌面 GUI」赛道天花板很高；其痛点（打包环境、Windows、HiDPI）cc-analyzer 已用 Tauri 官方 bundler 解决——可作为差异化卖点；时间机器/检查点是分析类工具尚未覆盖的深水区。

### 4. Claude Code History Viewer / CCHV（jhlee0409/claude-code-history-viewer）

- **定位**：31 种 AI 编程助手的统一会话历史浏览器，桌面 + 无头服务器双模式，100% 离线——**与 cc-analyzer 架构定位最接近的直接竞品**
- **规模/活跃度**：⭐ 2.2k，235 forks，MIT，2026-10-01 仍活跃；同为 Tauri v2 + React + TS
- **核心功能**：
  - 会话浏览器：项目/会话导航，worktree 分组
  - **全局搜索**：跨全部工具的会话即时搜索 ⟵
  - 分析仪表盘：双模式 token 统计（计费 vs 会话）、成本明细、各工具分布图表 ⟵
  - Session Board：多会话像素视图、活动时间线 ⟵
  - Skill / Subagent 使用统计（最常用技能与子代理排行）⟵
  - Recent Edits：文件修改历史查看与恢复
  - 设置管理器（含 MCP 管理）
  - 实时监控：会话文件变更 SSE 推送即时更新
  - **一键全量备份归档**，防 Claude Code 自动清理丢失历史 ⟵
  - 导出 HTML / JSON（`--export` 支持 SSH/CI 无头使用）⟵
- **界面**：左侧项目树 + 工具筛选标签栏、多标签页（消息/分析/Token 统计/最近编辑/Session Board）、**ANSI 终端颜色原样渲染**、大历史**虚拟滚动**、右侧可折叠消息导航器；**无障碍完善**：键盘导航、字号 90%–130% 缩放、高对比度模式、屏幕阅读器语义；i18n 5 语言（含简/繁中文）
- **高频痛点**：搜索与侧栏 UX（宽度不可调、全局搜索结果与侧栏联动断裂）、worktree 删除后会话消失、希望显示 Claude 自动生成的会话标题、WSL 支持
- **对 cc-analyzer 的启示**：备份防清理是无 VPN 之外最朴素的刚需；中文本地化 + 无障碍是获取长尾用户的低成本方式；其 issue 显示「会话列表显示摘要标题而非 UUID」「全局搜索结果上下文联动」是易踩的 UX 细节。

### 5. phuryn/claude-usage

- **定位**：Python 标准库（零依赖）+ SQLite + Chart.js 的本地 Web 仪表盘，另有 VS Code 扩展版
- **规模/活跃度**：⭐ 2.2k，410 forks，MIT
- **核心功能**：每日用量/按小时分布/按项目统计图表、按模型筛选、日期范围下拉（URL 可收藏）、四类 token（input/output/cache write/cache read）按 Anthropic API 定价估算、**API/Pro/Max 计划感知进度条**、增量扫描器（路径+mtime）、30s 自动刷新
- **界面**：单页 Web，粘性分区导航 + 可折叠面板（状态跨刷新保留）；Docker 模式把 `~/.claude` **只读挂载**（值得借鉴的安全细节）
- **启示**：证明「图表 + 进度条」的 Web 仪表盘形态有需求；Docker 只读挂载的「数据只读」理念与 cc-analyzer 隐私优先契合。

### 6. 其他生态（简述）

| 工具 | 形态 | 亮点 |
| --- | --- | --- |
| jimdawdy-hub/claude-usage-tracker | Web | 跨多机汇总、订阅成本 vs API 成本对比 |
| ksred/cctrack | 单二进制 | 按 session/project/model 计花费 + 实时仪表盘 |
| AeternaLabsHQ/claude-code-stats | 自托管 | 生成 HTML 仪表盘，「订阅到底值多少钱」叙事 |
| xiufengsun/TokenTracker | 本地优先原生应用 | 31 种工具的 token/成本追踪 |
| Javis603/token-monitor | 桌面小组件 | 43+ 工具的实时限额 widget |
| VS Code 扩展（agsoft.claude-history-viewer、growthjack.claude-code-usage、Backscroll 等） | 编辑器内 | 状态栏监控、diff 查看、live 会话状态（工作中/等权限/完成） |
| Waybar 模块 / Obsidian 插件 / ESP32 仪表盘 | 生态外设 | 消费 monitor 的 `--write-state` 状态文件 |

**生态共性结论**：这个赛道已形成「CLI 分析（ccusage）→ TUI 实时监控（monitor）→ 桌面 GUI（opcode/CCHV/cc-analyzer）→ 外设显示（statusline/waybar/widget）」的分层；各层通过 JSONL 本地数据与机器可读输出解耦。

---

## 二、横向对比

| 能力 | cc-analyzer | ccusage | monitor | opcode | CCHV | phuryn |
| --- | :-: | :-: | :-: | :-: | :-: | :-: |
| 离线/隐私优先 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 会话浏览/详情 | ✅ | ❌ | ❌ | ✅ | ✅ | 部分 |
| token 计数 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **成本估算** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **天/周/月趋势** | ❌ | ✅(表格) | 部分 | ✅ | 部分 | ✅(图表) |
| **按项目/模型分布** | ❌ | ✅ | 部分 | ✅ | ✅ | ✅ |
| **5h 限额窗口** | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| **订阅计划感知** | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ |
| **burn rate/预测** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| 实时监控 | ✅(外链仪表盘) | 部分 | ✅ | ❌ | ✅(SSE) | ✅(30s) |
| 全局搜索 | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 导出 | 报告(调CLI) | JSON | CSV/JSON | ✅ | HTML/JSON | ❌ |
| 备份防清理 | ❌ | ❌ | ✅(仓库) | ❌ | ✅ | ❌ |
| 图形界面（原生桌面） | ✅ | ❌ | ❌ | ✅ | ✅ | ❌(Web) |
| 报告生成（调 claude CLI） | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

cc-analyzer 的独特点：**原生桌面 GUI + 报告生成（LLM 深度分析）+ 仪器面板风格**。空白点集中在：成本、趋势图表、限额窗口、计划感知、搜索、导出、备份。

---

## 三、借鉴建议清单（按 用户价值 × 差异化 排序，共 10 条）

> 原则：cc-analyzer 是离线桌面应用、隐私优先、仪器面板（instrument panel）风格 UI。
> 所有借鉴均为「吸收能力、按自己的风格重做」，不是照抄界面。

1. **5 小时限额窗口仪表盘**（来源：Claude-Code-Usage-Monitor + ccusage `blocks`）
   借鉴：把会话按 5h 计费窗口聚类，展示当前窗口消耗、剩余、窗口关闭倒计时。
   改造：CLI 只能打印数字，cc-analyzer 可以做成真正的**仪表盘**——表盘式进度仪表、窗口时间轴、多窗口历史。数据完全可从本地 JSONL 时间戳推导，零网络。这是订阅用户每天看几十次的信息，且 monitor 的核心痛点恰恰是「不准」，用桌面应用的计算余量做准它。

2. **订阅计划感知 + burn rate 预测**（来源：monitor）
   借鉴：Pro/Max5/Max20/Team 限额预设；按当前消耗速度预测「限额何时耗尽」并给告警阈值。
   改造：设置页选计划（或用 P90 历史检测自动推荐），限额仪表叠加上述 5h 窗口仪表盘；预测给出具体日期时间（monitor 用户明确抱怨过只有时长没有时刻）。注意 monitor 的教训：**时区和每日重置时刻要做成显式配置**。

3. **Token 成本估算面板**（来源：ccusage）
   借鉴：LiteLLM 定价快照内嵌 + 本地 JSON 可覆盖 + 定时更新机制；四类 token（input/output/cache write/cache read）分开计价。
   改造：作为 Token 计数面板的升级——每条会话/每天显示「虚拟 API 成本」与「按订阅摊销」两种口径，明确标注「估算非账单」。ccusage 被骂的最多的就是数字不准，cc-analyzer 应引入 **provenance 标签**（见第 5 条）把「估算」变成设计语言而非缺陷。

4. **用量趋势与分布图表**（来源：ccurage daily/weekly/monthly + phuryn Chart.js + opcode analytics）
   借鉴：按天/周/月聚合的柱状/折线趋势、按项目与按模型的分布图、按小时的热力分布。
   改造：用仪器面板风格重绘——示波器式折线、频谱式分布条，保持深浅色主题一致；入口放在现有 Token 面板旁作为「分析」标签页。桌面 GUI 的图表表现力是 ccusage（纯表格）给不了的，这是形态优势。

5. **Provenance 置信标签**（来源：monitor）
   借鉴：每个关键数值标注来源（official / estimated / inferred）。
   改造：与仪器面板美学天然契合——仪表读数旁的精度徽章（如 ±、~、✓），成本与限额预测全部标注。把竞品的「准确性信任危机」转化为 cc-analyzer 的「诚实仪表」品牌语言。

6. **本地数据仓库：备份/归档防清理**（来源：CCHV 一键备份 + monitor warehouse）
   借鉴：Claude Code 会自动清理约 30 天前的历史，跨月分析必须自己留档。
   改造：cc-analyzer 增加可选的「仓库」目录（默认关闭、用户显式开启），首次全量归档 + 之后增量（按 mtime）；归档数据并入会话浏览器与趋势图，实现跨月/跨年分析。纯本地、零上传，与隐私红线完全兼容，且是 CLI 工具难以优雅做到的事。

7. **全局搜索**（来源：CCHV + opcode smart search）
   借鉴：跨项目、跨会话的消息级全文搜索。
   改造：搜索框常驻顶栏，结果按 项目 > 会话 > 消息 三级分组，点击结果**左侧树同步定位并展开**（CCHV 的教训：搜索结果与侧栏联动断裂是高频差评）；可复用现有 JSONL 解析层建内存索引，会话量不大时无需引入搜索引擎依赖。

8. **会话摘要标题 + resume 命令复制**（来源：CCHV issue #601 + opcode）
   借鉴：会话列表显示首条用户消息摘要（或 Claude 自动生成的标题）而非 UUID 文件名；详情面板提供「复制 `claude --resume <session-id>` 命令」按钮。
   改造：cc-analyzer 保持只读定位，不内嵌恢复执行（与 opcode 的边界差异），只做「一键复制命令」把用户送回终端；摘要标题沿用现有报告生成能力可加「为本会话生成标题」的轻量入口。

9. **结构化导出 CSV / JSON / HTML**（来源：CCHV `--export` + monitor CSV/JSON）
   借鉴：分析结果可导出为表格与自包含 HTML。
   改造：现有「报告生成（调 claude CLI）」是叙事型输出，补一档**数据型输出**：会话清单/用量汇总导出 CSV（给表格党）与单文件 HTML（给分享党，内嵌仪器面板风格图表）；导出前弹隐私确认（剔除路径等敏感字段，符合项目红线）。

10. **无障碍与性能细节包**（来源：CCHV）
    借鉴：大历史虚拟滚动、ANSI 转义颜色原样渲染、字号缩放（90%–130%）、高对比度模式、键盘导航。
    改造：cc-analyzer 的详情面板渲染长会话时引入虚拟滚动；终端输出（tool result）做 ANSI 渲染；设置页加字号与对比度档位。这类「看不见但用到就回不去」的细节是 CCHV 在同类桌面竞品里口碑的来源，也最贴仪器面板的「专业仪表」气质。

**不建议跟进的方向**（差异化低或越界）：多 agent CLI 支持（18 家在卷，cc-analyzer 深耕 Claude Code 反而聚焦）；内嵌会话操控/agent 执行（opcode 主场，且与 cc-analyzer「只读分析器」的隐私定位冲突）；statusline hook（CLI 生态位，且 ccusage 在此翻过车）。

---

## 四、来源

- https://github.com/ccusage/ccusage （原 ryoppippi/ccusage，⭐18.8k）
- https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor （⭐8.7k）
- https://github.com/winfunc/opcode （原 getAsterisk/claudia，⭐22.4k）
- https://github.com/jhlee0409/claude-code-history-viewer （⭐2.2k）
- https://github.com/phuryn/claude-usage （⭐2.2k）
- https://github.com/jimdawdy-hub/claude-usage-tracker · https://github.com/ksred/cctrack · https://github.com/AeternaLabsHQ/claude-code-stats · https://github.com/xiufengsun/TokenTracker · https://github.com/Javis603/token-monitor
- VS Code Marketplace：agsoft.claude-history-viewer · growthjack.claude-code-usage · doorsofperception.claude-code-history · filips.backscroll · ShahadIshraq.vscode-claude-sessions
- star/issue 数据：GitHub API（经 gh CLI，2026-10-01 抓取）
