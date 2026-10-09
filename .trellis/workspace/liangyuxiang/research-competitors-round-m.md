# 竞品调研报告 · Round M（第二轮）

> 调研日期：2026-10-09 · 对象：cc-analyzer（Tauri 2 + React 离线桌面应用，解析本地 `~/.claude/projects` JSONL）
> 方法：GitHub 检索 API（按 star 排序 + 关键词多路检索）+ 逐个抓 README/发布说明 + 本地实机 JSONL 抽样核对
> 上一轮：`research-competitors.md`（2026-10-01）。**那一轮列的 10 条建议到本轮已全部落地**（限额窗口、计划感知、成本估算、趋势图表、provenance、归档、全局搜索、会话标题 + resume、导出、无障碍与性能包只差高对比度）。
> 所以这一轮只回答一个问题：**现在还有什么值得做、而我们没做。**

---

## 一、赛道变化（与 10-01 相比）

1. **头部放缓、腰部涌现**：ccusage 最后发布 09-27，Claude-Code-Usage-Monitor 停在 06-27；而 **sniffly**（⭐1.3k，Claude Code 分析仪表盘）、**agent-sessions**（⭐0.9k，macOS 原生应用）、**Claude-Usage-Tracker**（⭐3.6k，macOS 菜单栏）都在持续发版。竞争重心从「CLI 分析」转向**桌面/菜单栏形态**——正是我们的主场。
2. **「分析」正在从用量走向质量**：sniffly 把 **错误分析（error breakdown）** 放在第二位（第一位是用量统计）。这说明用户不只想看「花了多少」，还想看「哪里做错了」。
3. **多 agent 已成红海**：CCHV 支持 31 家、cass 支持 31 家、agent-sessions 支持 16 家。继续深耕 Claude Code 反而更聚焦（维持上一轮的判断）。
4. **备份从「本地留档」升级到「跨机器/云端」**：akeep（Git-like commits + S3/R2/Git 后端 + age 客户端加密）、chronicle（跨机器双向同步 + `$HOME` 路径规范化 + grow-only CRDT）。我们只有单机归档。
5. **桌面形态的外延被做完了**：菜单栏读数、Dynamic Island（刘海 HUD）、statusline、VS Code 状态栏、Waybar/Obsidian/ESP32。我们目前只有一个「浮窗模式」。
6. **服务端模式出现**：CCHV 加了 `--serve` WebUI（token 鉴权 + Docker + systemd）。这条与我们的隐私红线冲突，不跟进，但它说明「团队共享」有需求。

---

## 二、逐个竞品（只记本轮新增/变化的判断）

### chiphuyen/sniffly（⭐1.3k，本地 Web 仪表盘）
- **做对的地方**：① **错误分析**——把 Claude Code 出错的原因归类聚合成图表，口号是「看清它在哪儿犯错，你就能少犯错」；② **指令回看**——把你的历史指令按时间走一遍，方便自己复盘或把 prompt 分享给同事；③ 可分享的仪表盘。
- **启示**：错误分析是**我们已经解析、但没聚合**的数据（`isError`、工具失败、失败状态列都已在手）。这是本轮最值得抄的作业——不是抄界面，是把「会话内的红字」变成「跨会话的规律」。

### jazzyalex/agent-sessions（⭐0.9k，macOS 原生应用，16 种 agent）
- **做对的地方**：① 搜索范围明确包含 **tool calls / command output / errors / file paths / 图片引用**（我们只索引 user/assistant 文本）；② **Quota Meter 浮窗** + 「**哪个会话在烧配额**」的按会话归因；③ Session Info 侧栏「诚实说明每个来源的记录限度」——与我们的 provenance 是同一种态度。
- **启示**：搜索覆盖面是**可验证的差距**；「按会话归因配额」正好接在我们已有的两层限额卡后面。

### hamed-elfayome/Claude-Usage-Tracker（⭐3.6k，macOS 菜单栏）
- **做对的地方**：菜单栏常驻读数（会话/周/按模型的剩余量）、多账号 profile 与终端启动器、Dynamic Island 实时 HUD、Keychain 保管凭据、14 种语言。
- **启示**：**常驻读数**是菜单栏应用的看家本领，而我们作为桌面应用用的是**托盘/菜单栏能力**（Tauri 原生支持），却没做——这是形态优势没用上。

### jhlee0409/claude-code-history-viewer（CCHV，⭐2.2k，最接近的直接竞品）
- **新动向**：v1.30 加「Claude Code 自动标题」与「区分我的提示词 / agent 更新 / 注入上下文」；v1.31 加「自定义 resume 参数」；新增 `--serve` 服务端模式（鉴权 + Docker）；核心表里的 **Skill / Subagent 使用统计**与 **MCP 管理**。
- **启示**：自动标题我们**已经有了**（读 `ai-title`）；「我的提示词 vs agent 更新」我们已有等价能力（记录类型分类）；**skill / MCP 使用统计我们没有**——而工具调用数据我们早就在解析。

### eunomia-bpf/akeep（Git-like 备份）与 geekmuse/chronicle（跨机器同步）
- **做对的地方**：akeep 把会话历史当**版本库**（commit/diff/log、压缩去重、S3/R2/Git 后端、age 客户端加密、完整性校验）；chronicle 解决**不同机器 `$HOME` 路径不同**的合并，用 grow-only CRDT 保证 JSONL 只增不减。
- **启示**：我们已有「本地归档」，缺的是**把归档搬到另一台机器**。完整同步是大事，但 v1 可以只做「导出加密归档包 / 导入合并」——不联网、不引入服务端，与「会话数据不出本机默认」兼容。

### Dicklesworthstone/coding_agent_session_search（cass，⭐1.2k）
- **做对的地方**：统一的**索引层**（31 种 agent 的会话进同一个可搜索时间线），Rust 实现、覆盖率高。
- **启示**：不跟多 agent，但它印证「搜索是这个赛道的刚需入口」——值得把我们的搜索做**更全**（见机会 2）。

---

## 三、横向对比（本轮更新）

图例：✅ 有 · 🟡 部分/弱 · ❌ 无

| 能力 | cc-analyzer | sniffly | agent-sessions | ccusage | monitor | opcode | CCHV | 菜单栏 Tracker |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 原生桌面 GUI | ✅ | 🟡(Web) | ✅ | ❌ | ❌(TUI) | ✅ | ✅ | ✅(菜单栏) |
| 会话浏览与详情 | ✅ | 🟡 | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| token / 成本 / 趋势 / 分布 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5h + 周两层限额与预测 | ✅ | ❌ | ✅ | 🟡 | ✅ | ❌ | ❌ | ✅ |
| **按会话的配额归因** | ❌ | ❌ | ✅ | ❌ | 🟡 | ❌ | ❌ | 🟡 |
| **菜单栏 / 托盘常驻读数** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **跨会话错误分析** | ❌ | ✅ | 🟡 | ❌ | ❌ | ❌ | ❌ | ❌ |
| 全局搜索 | 🟡(仅对话文本) | 🟡 | ✅(含工具输出/错误/路径) | ❌ | ❌ | ✅ | ✅ | ❌ |
| **会话改动文件视图** | ❌ | 🟡 | 🟡 | ❌ | ❌ | 🟡 | ✅(Recent Edits) | ❌ |
| **用量总览导出/分享** | ❌(只导出会话) | ✅ | 🟡 | 🟡(JSON) | 🟡 | ✅ | 🟡 | ❌ |
| **skill / MCP 使用统计** | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 | ✅ | ❌ |
| 本地归档防清理 | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| **跨机器搬运/同步** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | 🟡 | 🟡 |
| 多账号 / 多配置目录 | ❌ | ❌ | 🟡 | ❌ | ✅ | ❌ | ❌ | ✅ |
| 高对比度档 | ❌(#73) | ❌ | 🟡 | ❌ | 🟡 | ❌ | ✅ | 🟡 |
| 多 agent 支持 | ❌(刻意) | ❌ | ✅(16) | ✅(18) | 🟡 | 🟡 | ✅(31) | ✅ |
| 服务端 / 云端 | ❌(红线) | 🟡 | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |

**空白点（我们与全场都缺，或只有一家有的）**：跨会话错误分析（只有 sniffly）、按会话的配额归因、菜单栏常驻、会话改动文件视图、用量总览的对外快照、skill/MCP 统计、跨机器搬运。

---

## 四、机会清单（已开 Issue，按 用户价值 × 差异化 排序）

> 原则同上一轮：**吸收能力、按我们的仪器面板风格重做**，不照抄界面；一切数据来自本地 JSONL，默认零上传。

| # | 机会 | 来源 | 为什么是我们的菜 | Issue |
| --- | --- | --- | --- | --- |
| 1 | 跨会话错误分析：把「会话里的红字」变成「跨会话的规律」 | sniffly 错误分析 | `isError` / 工具失败 / 状态列**都已解析在手**，只是没聚合；分析器的主场 | #146 |
| 2 | 搜索覆盖面补齐：工具输出、错误文本、文件路径 | agent-sessions / cass | 现有索引只收 user/assistant 文本；解析层早就有工具结果与路径 | #147 |
| 3 | 会话「改动文件」视图（含 `file-history-snapshot`） | CCHV Recent Edits | 实机抽样里 `file-history-snapshot` 是**我们完全没读**的记录类型 | #148 |
| 4 | 用量总览导出为单文件 HTML 快照 | sniffly 可分享仪表盘 | 单文件 HTML 的机器与隐私规则我们**已经有了**（会话导出），扩到仪表盘 | #149 |
| 5 | 菜单栏 / 托盘常驻限额读数 | 菜单栏 Tracker / agent-sessions | Tauri 原生托盘能力没用上；订阅用户一天看几十次 | #150 |
| 6 | 按会话的配额归因（谁在烧 5h 窗口） | agent-sessions | 接在已有两层限额卡后面，数据现成 | #151 |
| 7 | 加密归档包导出 / 导入（跨机器搬运） | akeep / chronicle | 我们已有本地归档；**不做同步服务**，只做可搬运的加密包 | #152 |
| 8 | 工具 / skill / MCP 使用统计 | CCHV | 工具调用数据早就在解析；skill 与 MCP 工具名可直接从工具名分桶 | #153 |

Issue 直达：[#146](https://github.com/liang-zhenxiang/cc-analyzer/issues/146) · [#147](https://github.com/liang-zhenxiang/cc-analyzer/issues/147) · [#148](https://github.com/liang-zhenxiang/cc-analyzer/issues/148) · [#149](https://github.com/liang-zhenxiang/cc-analyzer/issues/149) · [#150](https://github.com/liang-zhenxiang/cc-analyzer/issues/150) · [#151](https://github.com/liang-zhenxiang/cc-analyzer/issues/151) · [#152](https://github.com/liang-zhenxiang/cc-analyzer/issues/152) · [#153](https://github.com/liang-zhenxiang/cc-analyzer/issues/153)

**次级候选（本轮不开 Issue，留档备用）**

- **多配置目录（多账号）只读支持**：`CLAUDE_CONFIG_DIR` 多 profile 用户目前看不到全部会话。工作量中等，但涉及「一个应用读多份数据源」的口径问题（分组、归档、限额窗口都要各自独立），**等有真实用户提出来再做**——竞品里做这件事的是菜单栏形态（可常驻显示多个 profile），与我们的定位不完全重合。
- **会话里的图片附件查看**：实机抽样有 `attachment` 记录类型，我们没读；但样本量与用户需求都还不清楚。
- **实时「Claude 正在做什么」HUD**：需要文件监听 + 增量解析，与现有「实时监控」的边界要重新画，暂不启动。

---

## 五、明确不跟进（写清理由，避免反复讨论）

| 方向 | 为什么不跟 |
| --- | --- |
| 多 agent CLI 支持（18–31 家） | 已是红海，且会把解析与口径摊薄；我们的差异化是「把 Claude Code 这一件事做到可信、好看」。 |
| 内嵌会话操控 / agent 执行 / 时间机器回滚 | opcode 主场，且与「只读分析器、默认零上传」的定位冲突。我们只做到「复制 resume 命令」。 |
| 服务端模式 / 团队共享链接 | CCHV 的 `--serve` 需要鉴权与运维，且与我们「会话数据不出本机」的红线正面冲突。分享只做**用户自己搬运的单文件**。 |
| 云端自动同步 | akeep/chronicle 已做；我们只做「导出加密包 + 导入合并」，把「谁把它放到哪」交给用户。 |
| statusline / hook 集成 | CLI 生态位，且 ccusage 在 hook 上翻过车（无限派生子进程、100% CPU）。 |

---

## 六、来源

- https://github.com/chiphuyen/sniffly （⭐1.3k，错误分析 / 可分享仪表盘）
- https://github.com/jazzyalex/agent-sessions （⭐0.9k，16 agent 搜索 + Quota Meter + 按会话归因）
- https://github.com/hamed-elfayome/Claude-Usage-Tracker （⭐3.6k，macOS 菜单栏多 profile）
- https://github.com/jhlee0409/claude-code-history-viewer （⭐2.2k，CCHV；31 provider + 服务端模式 + skill 统计 + Recent Edits）
- https://github.com/eunomia-bpf/akeep （Git-like 备份 / S3·R2·Git 后端 / age 加密）
- https://github.com/geekmuse/chronicle （跨机器双向同步 / 路径规范化 / CRDT）
- https://github.com/Dicklesworthstone/coding_agent_session_search （cass；31 agent 统一索引）
- https://github.com/ccusage/ccusage · https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor · https://github.com/winfunc/opcode · https://github.com/phuryn/claude-usage （上一轮已覆盖，本轮只复核发布节奏）
- 本地实机 JSONL 抽样（`~/.claude/projects`，2026-10-09）：顶层 `type` 分布实测含 `attachment` / `file-history-snapshot` / `ai-title` / `cost-state` / `last-prompt` / `mode` / `permission-mode` / `atis-latch`
