# Research: 跨会话错误分析的数据地基（Issue #146）

- **Query**: 扫描本机 `~/.claude/projects` JSONL 实测错误信号；盘点解析层现状；参考 sniffly
- **Scope**: mixed（本机数据实测 + 内部代码 + 外部竞品源码）
- **Date**: 2026-10-10
- **方法**: 两轮全库 Python 扫描（脚本在 /tmp，未入库）+ 解析层源码阅读 + sniffly 源码（stats.py / processor.py / constants.py / README）
- **脱敏说明**: 所有样本只保留平台固定文案前缀；路径、命令、待编辑文本、文件名一律替换为 ⟨路径⟩⟨命令⟩⟨待替换串⟩⟨文件名⟩ 占位

## 1. 本机实测数字

语料概况（扫描时点，活语料——本轮会话自身也在写入，两轮扫描间 381→382 个文件、825→828 条工具错误，数字有 ~0.4% 漂移）：

| 指标 | 值 |
|---|---|
| JSONL 文件（≈会话数） | 382 |
| 总行数 | 281,777 |
| 总体积 | 966 MB |
| assistant 行数（做分母用） | 77,155 |
| 语料时间窗 | 约 2026-09-07 → 2026-10-09（~33 天） |

### 1.1 API 错误（`isApiErrorMessage: true` 的 assistant 行）

| 指标 | 值 |
|---|---|
| 行数 | 65 |
| 涉及会话 | 28（占全部会话 7.3%） |
| `model` 全为 `<synthetic>` | 65/65 |
| 行内 `tool_result` 无匹配 `tool_use` | 0（另一信号通道同样干净） |

`apiErrorStatus` 分布与 `error` 枚举字段（两者交叉后完全对齐）：

| status | 行数 | `error` 枚举 | 占比 |
|---|---|---|---|
| 402 | 28 | `unknown` | 43.1%（连同 400 共 52.3%） |
| 无 status | 20 | `server_error` | 30.8% |
| 500 | 8 | `server_error` | 12.3%（server_error 合计 43.1%） |
| 400 | 6 | `unknown` | 9.2% |
| 401 | 3 | `authentication_failed` | 4.6% |
| **429 / 529** | **0** | — | 本机未观测到限流/超载 |

关键结构事实：

- 无 status 的 20 行全部集中在 4 天（09-07×6、10-04×6、10-03×5、10-07×3），content 文本均为 `API Error: Connection refused — a firewall or proxy may be blocking it (ConnectionRefused)` —— 是**传输层失败**，不是 HTTP 错误；`apiErrorStatus` 缺失是常态而非异常
- API 错误行的可分类文本有两层：`error` 枚举（`server_error` / `unknown` / `authentication_failed`）+ `message.content` 里的 `API Error: ⟨人读文本⟩` 块。**枚举+status 足够分类，文本只是补充**
- 新版行还带 `entrypoint`、`agentId`（子 agent 行）、`message.container/diagnostics` 等字段，与错误无关但确认了行结构在演化

### 1.2 工具错误（user 行 `tool_result` 块的 `is_error: true`）

| 指标 | 值 |
|---|---|
| 错误块数 | 825 |
| 涉及会话 | 201（占全部会话 **52.6%**） |
| `tool_use_id` 无法回溯工具名 | 0（100% 可归属） |
| 发生在 sidechain（子 agent）行 | 292（**35.4%**） |
| `isMeta` 行 | 0 |

工具分布（Top 10）：

| 工具 | 次数 | 占比 |
|---|---|---|
| Bash | 659 | 79.9% |
| Edit | 96 | 11.6% |
| WebFetch | 20 | 2.4% |
| Read | 17 | 2.1% |
| Write | 15 | 1.8% |
| Agent | 14 | 1.7% |
| ExitWorktree | 2 | |
| EnterWorktree | 1 | |
| AskUserQuestion | 1 | |

错误文本形态（脱敏采样，全部为**平台固定文案开头**，之后才是用户内容）：

- **Bash**: `Exit code ⟨N⟩` ⏎ ⟨stdout/stderr 原文——任意内容，不可靠⟩
- **Edit**: `<tool_use_error>String to replace not found in file. String: ⟨待替换串⟩`；`File has been modified since read, either by the user or by a linter…`；`File does not exist. Note: your current working directory is ⟨路径⟩`
- **Read**: `File does not exist… Did you mean ⟨文件名⟩?`；`File content (1.8MB) exceeds maximum allowed size (256KB)…`
- **Write**: `InputValidationError: The parameter 'file_path' type is expected as 'string'…`；`File has not been read yet…`；`This session is isolated in the worktree ⟨路径⟩…`
- **WebFetch**: `Unable to verify if domain github.com is safe to fetch…`；`Socket is closed`
- **Agent**: `Teammates cannot spawn other teammates — the team roster is flat…`；`Failed to create teammate pane: tmux: terminal_exited`
- **AskUserQuestion**: `The user doesn't want to proceed with this tool use…`（全库仅 1 例）

**结构化关键事实（补测验证）**：错误行的 `toolUseResult` 字段是**字符串**，成功行才是对象（`stdout/stderr/interrupted/…` dict）。因此 `extractStructuredToolResult` 对错误行返回 null（`structuredToolResult.ts:19-21` 只接受对象）——错误 Bash 的退出码**只存在于 `toolResult` 文本头部的 `Exit code N`**，没有结构化字段。

### 1.3 集中度与时间分布

集中度（跨会话视图是否有意义的直接证据）：

- Top 5 会话只占全部工具错误的 **19.4%**（最多 34 条/会话）；≥10 条的会话 19 个，≥50 条的 0 个
- **长尾分布**——不是「一个坏会话」的噪音，规律确实跨会话存在

爆发日形态（有，且分母很关键）：

| 日期 | 工具错误 | assistant 行 | 每千条 assistant 错误数 |
|---|---|---|---|
| 09-14 | 131 | 5,210 | **25.1**（真异常，约基线 2.5 倍） |
| 09-30 | 100 | 11,845 | 8.4（原始数像爆发，归一后是基线） |
| 10-01 | 77 | 6,812 | 11.3 |
| 基线日（10-06 / 09-17 等） | 24–30 | 2,600–2,700 | 9–11 |
| 全库均值 | 825 | 77,155 | 10.7 |

API 错误同样有爆发日：10-03×11、09-23×8、09-14×7、09-07×6（且 09-07 全是无 status 的连接拒绝）。**趋势图有价值，但必须带分母**——原始计数会把「忙一天」误报成「错一天」（09-30 就是反例）。这实证了 Issue #146 里「分母必须写在界面上」的要求。

### 1.4 不可靠信号的排除

- 全库子串命中 `429`×7,525、`529`×5,287 —— 几乎全是普通内容里的数字（token 数、行号），**关键字扫描错误文本不可作为错误信号**
- `rate limit`×149、`overloaded`×22、`context length`×13 等命中同样多来自对话引用的文档/代码
- `"level":"error"` 行全库为 **0**——不存在第三个错误通道
- 唯一可靠信号就是两个结构化标志：`isApiErrorMessage` 与 `tool_result.is_error`，加固定前缀 regex

## 2. 建议错误分类法（基于实测）

两级结构：先按**来源**（API / 工具），再按判定规则细分。判定规则优先级：结构化字段 > status/枚举 > 文本固定前缀。

### 第一级：API 错误（`isApiErrorMessage: true`）

| 类别 | 判定规则 | 本机占比 |
|---|---|---|
| 用量/额度限制 | `apiErrorStatus == 402`（枚举 `unknown`） | 43.1% |
| 服务端/传输错误 | status 500，或无 status + 枚举 `server_error`（文本含 `Connection refused` → 细分网络） | 43.1% |
| 认证失败 | status 401 / 枚举 `authentication_failed` | 4.6% |
| 请求格式错误 | status 400 / 枚举 `unknown` | 9.2% |
| 限流（预留） | `status == 429` | 0%（本机未观测，API 语义上常见，必须预留） |
| 超载（预留） | `status == 529` 或文本 `overloaded` | 0%（同上） |

可靠性：**高**。全部信号来自结构化字段（status + 枚举），文本只用于网络错误细分。

### 第二级：工具错误（`tool_result.is_error`）

| 类别 | 判定规则（工具 × 文本前缀） | 本机占比 |
|---|---|---|
| Bash 非零退出 | Bash × `^Exit code \d+`（只认头部，stderr 不再细分） | 66.1% |
| Bash 环境/权限失败 | Bash × `command not found` / `Permission denied` / `No such file or directory` | ~2% |
| 超时 | 任意工具 × `Command timed out` / `timed out` | 5.5% |
| Edit 串未命中 | Edit × `String to replace not found` | 7.0% |
| 文件状态冲突 | Edit/Write × `File has been modified since read` / `File has not been read yet`；Read/Write × `File does not exist` / `exceeds maximum allowed` | ~4% |
| 输入校验失败 | 任意 × `InputValidationError` | ~1% |
| 网络抓取失败 | WebFetch × `Unable to verify` / `Socket is closed` | 2.4% |
| 平台规则拒绝 | Agent/Enter/ExitWorktree × 固定文案（`Teammates cannot spawn` / worktree 隔离） | ~2% |
| 用户拒绝 | `user doesn't want to proceed`（**按 Issue #146 口径不算失败**，需在聚合里显式排除） | 0.1% |
| 其他 | 兜底桶（并监控未匹配率） | ~9% |

可靠性：**中高**。错误文本头部全部是平台固定模板（实测采样无一例外），regex 可靠；不可靠的是 Bash 的 stderr 正文——所以分类只到「非零退出」层，不深入归因。未匹配率约 9%（bash_other 76 条），主要是我首轮规则的覆盖缺口，正式实现时可压到 5% 以内。

## 3. 解析层现状与跨会话聚合缺口

### 现状（已有什么）

| 数据 | 位置 | 说明 |
|---|---|---|
| API 错误标志 | `parseJsonl.ts:506,541-552` | `record.isError`（来自 `isApiErrorMessage`）+ `record.apiError = {kind, status}`（kind=行内 `error` 枚举，status 可为 null） |
| API 错误人读文本 | `record.text` / `contentBlocks` | `API Error: …` 块进了普通文本，未单独成字段 |
| 工具错误标志 | `parseJsonl.ts:626` | `pending.isError = block.is_error === true`，挂在 tool record 上 |
| 工具错误文本 | `parseJsonl.ts:627-630` | `toolResult`（≤5KB 截断 + `resultTruncated` 标志） |
| 工具名/时间戳 | `SessionRecord` | `toolName`、`timestamp` 都在 record 上，`tool_use_id` 回溯失败会告警并丢弃（`parseJsonl.ts:620-622`；实测全库 0 例） |
| sidechain 分流 | `parseJsonl.ts:524-528,575-578` | 子 agent 记录进 `sidechainMessages`，不进主 `records` |
| 单会话健康度 | `sessionHealth.ts:24-34` | 三态布尔：任何 `record.isError` → `has-errors` |
| 会话列表元数据 | `metadataScanner.ts:3-4` | 只扫头部 8MB / ≤500 事件，取 cwd/首条提示等，无错误字段 |

### 缺口清单（聚合需要、解析层还没给的）

1. **无错误分类字段**：record 上没有 `errorKind`/`errorCategory`；聚合层要么重新对 `toolResult` 文本跑 regex，要么解析时打标（建议后者，避免每视图重扫）
2. **Bash 退出码无结构化**：错误行 `toolUseResult` 是字符串 → `structuredResult` 为 null；退出码只在 `toolResult` 文本头部（见 1.2 结构化事实）
3. **API 错误 message 未入 `apiError` 结构**：`apiError` 只有 kind+status；`Connection refused` 等细分靠 `record.text` 里捞
4. **无会话级错误摘要**：没有 `apiErrorCount` / `toolErrorCount` / 错误率；`sessionHealth` 是布尔且**把 API 错误与工具错误混为一谈**（`sessionHealth.ts:29` 只看 `record.isError`）
5. **无跨会话扫描路径**：全量解析是按会话按需的，`metadataScanner` 只读头部；跨会话聚合需要新的轻量全库扫描（或复用全量解析结果）+ 类似 `metadataCache` 的 mtime 失效缓存
6. **sidechain 归属未定**：35.4% 的工具错误在 `sidechainMessages` 里；聚合只遍历 `records` 会丢三分之一的数据，必须显式决定并入或单列
7. 分母不缺：record 级 `timestamp` 与会话 record 数现成，按天/按会话归一可行

与 Issue #146 v1 的衔接：v1 的三个切面（按工具失败率、按会话/项目失败密度、按时间趋势 + 下钻）所需的 `isError`+`toolName`+`timestamp`+会话归属**全部已在 record 上**，解析层不阻塞 v1；上表缺口是 v2（错误分类、API 错误细分）的准备工作。

## 4. sniffly 参考要点（≤3）

1. **分类是手工维护的正则表**：`constants.py` 的 `ERROR_PATTERNS` 共 14 类（User Interruption / Command Timeout / File Not Read / File Modified / File Too Large / Content Not Found / No Changes / Permission Error / Tool Not Found / Wrong Tool / Code Runtime Error / Port Binding / Syntax Error / Notebook Cell Not Found / Other Tool Errors），first-match-wins + `Other` 兜底；源码注释自认「Claude 改格式就要更新」——文案漂移是它公开承认的维护成本。展示形态：error-type 饼图 + 每日错误率（errors ÷ assistant_messages ×100，与我们的分母结论一致）+ 每工具 error rate。口号：「See where Claude Code makes mistakes so that you avoid these mistakes」——教育用户避坑的口吻，不是系统监控
2. **它不区分 API 错误**：`processor.py` 只看 `tool_result.is_error`，把 `API Error: Request was aborted.` 归入 User Interruption；而我们的 JSONL 有独立的 `isApiErrorMessage` + status + 枚举通道，单列 API 错误是天然的差异化点
3. **隐私立场与我们相同**（全本地、无遥测、分享是显式 opt-in），不构成威胁面

## 5. 结论：可行性与最大风险

**可行，且数据比预期更规整。** 三个实证支撑：52.6% 的会话含工具错误（聚合视图有料）；长尾分布（top5 仅 19.4%，规律真跨会话）；爆发日存在且带分母后可判真伪（09-14 是真异常、09-30 是假警报）。两个结构化标志 100% 可归属（unmatched=0、API 行全带 synthetic 标记），分类判定可完全建立在结构化字段 + 平台固定文案前缀上。

**最大风险：错误文案是 Claude Code 的未承诺接口。** 版本升级改一句措辞，regex 分类就静默漏桶。缓解：判定优先级固定为「结构化字段 > status/枚举 > 文本前缀」，文本规则只匹配固定开头（不匹配 stderr 正文），`其他` 桶保留**未匹配率指标**自我监控（超出阈值说明文案又漂了）。

次风险两个：**口径**——「等用户输入」不算失败需在聚合里显式排除（实测有 AskUserQuestion 拒绝 1 例，sniffly 也把它归为中断而非失败）；**sidechain**——35.4% 的工具错误在子 agent 记录里，聚合只看主 records 会静默丢数据。

## Caveats

- 单机样本：重度个人使用（33 天 / 382 会话 / 966MB）；429/529 本机未观测，分类法只能按 API 语义预留，占比无法实测
- 活语料：数字取自 2026-10-10 扫描时点，两轮间有 ~0.4% 漂移（活跃会话正在写入）
- 建议分类法的占比来自我首轮规则的实测分布，`其他` 桶 ~9% 主要是规则覆盖缺口而非数据不可分
- sniffly 结论基于其 main 分支源码（README + stats/processor/constants），未运行其产品
