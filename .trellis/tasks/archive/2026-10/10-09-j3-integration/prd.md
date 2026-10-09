# PRD：J3 · 三处集成——压缩行、用量统计、解析覆盖率

> 父任务：[Round J](../10-09-round-j-context/prd.md) · 前置：J1 先合；与 J2 串行（同触 sessions 区域）
> 视觉依据：[design-context-view.md](../10-09-round-j-context/research/design-context-view.md) B/C/D 节

## F1 日志表第七种行类型：「压缩边界」

- LogView 行模型（user/LLM/tool/agent/workflow/wait）增 `compact` 类别；
- 该行是 system 记录不是消息：按设计师规范与消息行视觉区分；
- 可展开：展开后显示取证卡片的紧凑版（pre→post/dropped/trigger/duration + 摘要消息正文首段）；
- 摘要消息（isCompactSummary）不再单独渲染为普通 user 行——它并入边界行（展开态），
  避免同一事件在表里出现两行；
- 行为必须跟着现有的行虚拟滚动、键盘导航、高亮/筛选联动走（grep logRows.ts 的类别注册点）。

## F2 用量总览「压缩统计」面板

- 数据：周期内（跟随页面现有 7/30/90 天选择器）压缩次数、auto/manual 分布、累计丢弃 token；
- 摆放与体例按设计师规范 C 节（现有两列网格的语言）；
- 「压缩 = 上下文整体重读」的叙事文案按规范，不得出现无来源的数字断言；
- 无压缩时按规范处理（不出现空面板，也不是硬塞 0）；
- 聚合进 `usageAggregations.ts`（纯函数），从 compactEvents 逐会话汇总。

## F3 解析覆盖率提示

- 位置与形态按设计师规范 D 节；
- 数据：J1 的 ParseCoverage；`unknownTypeCounts` 非空或 `unparsableLines > 0` 才出现；
- 「复制报告」按钮：未知类型分布 + 行号样例进剪贴板（纯本地，无上传——红线）；
- 复制的文本里**不得包含用户路径**（隐私红线：会话数据不出本机之外还有「用户路径不进 UI/产物」
  的既定纪律，报告里目录名按既有 formatProjectPath 规则脱敏）。

## 验收标准

- [ ] 单测：压缩行注册与渲染、摘要并入、聚合纯函数（含空周期）、覆盖率出现/不出现条件、
      复制文本脱敏
- [ ] e2e：日志表出现压缩行并可展开；用量总览压缩面板在夹具周期���数字正确；
      覆盖率提示出现且复制按钮可点（剪贴板桩）
- [ ] 现有 LogView/usage 全部用例零回归（特别是行高与列预算的既有断言）
- [ ] `./scripts/lint.sh`、`npm --prefix web test`、`npm --prefix web run build`、
      `npm --prefix web run test:e2e` 全绿
- [ ] 至少 2 个新断言做变异验证
