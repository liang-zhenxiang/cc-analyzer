# PRD：N2 · 会话「改动文件」视图——这次会话到底动了哪些文件

> 任务对应 Issue #148（机会清单第 3 名，来源 CCHV Recent Edits；数据源是实机抽样
> 发现的、我们完全没读的记录类型 `file-history-snapshot`）。

## 问题

复盘一次会话时最先想问「这次到底动了哪些文件」，现在只能逐条翻日志表里的
Edit/Write/Read 工具调用。`file-history-snapshot` 记录落在 ParseCoverage 的
「未知类型」桶里，一个字没读。这是「只读分析」定位下完全安全的视图。

## 数据地基（已核实，`research/file-history-facts.md`，381 会话 / 967MB 全量实测）

- **`file-history-snapshot`**：仅 17% 会话有（09-07 起新版 Claude Code 才写）；
  结构 = `trackedFileBackups: {路径 → backupFileName/version/backupTime}`，
  **不含文件内容**（backupFileName 指向 `~/.claude/file-history/<sessionId>/` 的
  编辑前全文备份，49MB——不读）；写入时机是会话启动/resume/下一 turn，
  **编辑当下不写**（漏最后 turn 的编辑）；
- **重合度**：快照文件集 ⊆ Edit/Write 编辑集 98.7%（几乎不多算）但只覆盖 74%
  的编辑；意外发现 `file-history-delta`（逐文件事件流）1221 个文件 **100% 落在
  编辑集**（零噪音）但仅 10% 会话有；
- **定案：视图主体走 A 方案**（tool_use 聚合）——语义「实际动过」、覆盖 100%、
  历史会话可用、零新增解析（CCHV 的 Recent Edits 同路线，竞品已验证）；
  快照/delta 登记为已知类型即可，留作后续「改动前内容预览」增强（优先 delta）；
- **现有地基**：`parseJsonl.ts:41` 显式跳过两种类型；`structuredToolResult.ts`
  已提取 filePath + Write 的 created 标记；`reportPrompt.ts` 的 `fileMapSection()`
  是聚合雏形但含 Read（语义「接触过」≠「改动」）；
- **口径风险**：失败编辑（isError）要过滤；Bash 间接写文件两类数据源都看不见
  ——视图表述为「**通过文件工具改动**」，口径写在界面上。

## 功能需求

### F1 解析层登记（先做）

- `file-history-snapshot` / `file-history-delta` / `attachment` / `cost-state`
  登记为**已知类型**进 ParseCoverage 分桶，不再计入未知；具体字段先只取
  用得到的（不贪多）；
- 视图数据**不走快照**（研究报告定案 A 方案）：快照/delta 只登记不展开。

### F2 会话详情「改动」视图

- 会话详情新增「改动」标签页（或面板，形态由设计师裁决）���按文件聚合本会话的
  Read / Edit / Write——次数、首次/末次时间、Write 标注**新建**；
- 点文件 → 列出涉及它的记录 → **跳回日志视图定位**（复用现有定位机制，硬要求）；
- 路径**只显示项目内相对路径**（完整路径进悬停提示），与现有「项目显示末段、
  完整名进 title」的隐私约定一致；
- 空态（纯问答会话没有文件改动）要有真实内容。

### F3 聚合口径

- 「动过」的判定口径写在界面上（哪些工具算改动：Edit/Write/NotebookEdit 算，
  Read 算「看过」还是不算改动——设计时定死并在 UI 标注）。

## 验收

- 单元测试：解析登记（三种新类型不再进未知桶）、文件聚合纯函数
  （相对路径化、首末次时间、Write 新建标注、空会话）；
- e2e：双引擎覆盖新标签页可见性、点击跳转定位、空态；
- 真机 GUI 门禁：新视图进视图清单 + 几何事实；
- 归档截图：亮暗两主题 × 双引擎；
- 变异验证至少一条；现有测试零回归；lint 全绿。

## 不做（v1）

- 不做回滚 / 恢复文件内容（file-history-snapshot 只读展示）；
- 不做跨会话的文件维度聚合（那是后续轮次的事）；
- 不读快照里的文件内容正文（只取元信息）。
