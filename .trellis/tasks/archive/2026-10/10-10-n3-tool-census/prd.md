# PRD：N3 · 工具 / skill / MCP 使用统计——我最常用的到底是哪几件

> 任务对应 Issue #153（机会清单第 8 名，来源 CCHV「Skill / Subagent usage statistics」）。

## 问题

「我装了 30 个 skill / 5 个 MCP server，到底哪些真的在用」是配置卫生问题、
agent 用户的高频自问。解析层已有 `SessionRecord.toolName`（含 `mcp__<server>__<tool>`）
与 `commandName`（slash 命令），但界面只有单会话的「子 agent 全量表」，
没有跨会话的使用排行。

## 数据地基（已核实，`research/tool-census-facts.md`，382 文件 / 36,660 次 tool_use 实测）

- **分布**：Bash 24,722（67.4%）、Edit 4,454、Read 4,344、Write 1,689——前四名占 96%，
  长尾极平，**Top-N 折尾是必须的形态**；
- **三形态确认**：skill = `Skill` 工具 `input.skill`（本机 25 个，含 `ns:name` 冒号
  命名空间）；MCP = `mcp__server__tool`（split("__") 恒 3 段；本机仅 1 server / 3 次，
  极稀——视图要能优雅处理「这一桶几乎为空」）；子 agent = `Agent` 工具
  `input.subagent_type`（本机 8 种，无 `Task`）；
- **sidechain 口径（最大坑）**：41.3% 的 tool_use 在内联 sidechain 行，被分流进
  `sidechainMessages` 而不进 `records`；现有用量聚合只吃 records，**只算主链会低估
  近一半**——聚合出「主链 / 含子 agent」两个口径；
- **解析层缺口小**：配对、错误、时长、截断全就位；缺的只是按名聚合 + 四桶分类
  纯函数；无跨文件双算风险（本机 childSessionPath 计数 0）。

## 功能需求

### F1 分桶聚合层（纯函数，可单测）

- 从会话集合聚合工具调用：按调用次数、涉及会话数、时间趋势；
- 分桶口径（可编码的判定规则）：① 内置工具（Bash/Edit/Read…）；② skill
  （识别规则以实测为准）；③ MCP 工具（`mcp__*` 前缀，server 与 tool 两级）；
  ④ 子 agent（Task/Agent 类）；未知形态落「其他」，不许丢数据；
- **与既有「子 agent 全量表」同一套口径**，不许两处各算一套。

### F2 统计视图（形态由设计师裁决）

- 按调用次数排行 + 涉及会话数 + 时间趋势（与用量页同区间选择器）；
- 每个条目可下钻到会话列表（点会话回到会话分析）；
- 分桶口径写在界面上（provenance 语言）；
- 空态（无数据区间）有真实内容。

## 验收

- 单元测试：分桶函数（含未知工具名、MCP 名里带 `__` 的边界、skill 识别规则）；
- e2e：双引擎覆盖视图可见性、下钻、空态；
- 真机 GUI 门禁 + 归档截图（亮暗 × 双引擎）；
- skill 识别规则的实机抽样证据进 PR 描述；
- 变异验证至少一条；现有测试零回归；lint 全绿。

## 不做（v1）

- 不做 MCP server 管理与编辑（写操作越出只读边界）；
- 不做「建议卸载哪些」（要判断就得猜）。
