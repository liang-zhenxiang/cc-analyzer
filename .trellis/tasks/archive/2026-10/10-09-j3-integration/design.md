# Design：J3 · 三处集成

> 视觉权威：[`design-context-view.md`](../10-09-round-j-context/research/design-context-view.md)
> §3（压缩行）、§4（用量面板）、§5（覆盖率）、§6/§7/§8/§9。冲突以规范为准。

## F1 压缩边界行（规范 §3）

- `logRows.ts` 行模型注册第七类 `compact`：通栏带行（`colspan=8`），按边界时间戳入序；
  合成模式参照 `buildGapRows`（wait 行）——从 records 摘出 isCompactSummary 消息折叠进
  展开区，不再单独渲染为 user 行；
- `LogView.module.css` 新增带行样式：`--bg-inset` 底 + 上边框 `--border-strong`，
  时间 `--font-mono`，`◆ 压缩 #k（自动|手动）` `--text-secondary` 600；
- RecordDetailPanel 能呈现 system 记录（数字栏同取证卡口径）；
- FilterBar 第七个 chip「压缩」（纯文字，无色）；键盘导航/选中/hover 与消息行同权；
- 展开区三块：压缩摘要（pre 纯文本）/ 幸存消息清单 / 原始事件（safeStringify）；
  展开区动作位「在上下文视图定位」→ 切 context 标签并选中 #k（J2 的选中态经
  一个模块级 store 或页面 state 传递——用页面 state + 回调，不新增 store 层）。

## F2 用量压缩面板（规范 §4）

- `usage/compactionStats.ts` 纯函数：周期内（aggregateRange 同口径）压缩次数、
  auto/manual 计数、累计丢弃（各会话 pre−post 之和，**不用** cumulativeDroppedTokens
  累加跨会话——跨会话累计值直接相加会重复计数；单会话内读元数据原值）、
  触发会话 top3（按丢弃量）；
- `CompactionPanel`（usage 侧）：board 第三行整行；三 KPI 读数 + StackedBar
  （chart-1/chart-4）+ 图例 + top3 文本清单（行可点 → openSession）+ 叙事句；
  0 次时 inline 文字不画空图。

## F3 解析覆盖率 chip（规范 §5）

- `ParseCoverageChip`：viewBar 右侧；M=0 不渲染；M>0 琥珀点 + 文字；
- 弹出卡（无遮罩 popover，Esc/外点关闭，焦点还触发元素）：类型分布表（mono 名 +
  计数 + 占比条）+「复制报告」（bridges.clipboard，短式标识，无绝对路径）；
- 数据从 ParsedSession.parseCoverage 来；UI 不硬编码类型清单。

## 依赖与兼容

- 依赖 J1（数据）与 J2（「在上下文视图定位」目标存在）；LogView 行数/行高断言
  既有用例必须保持绿——压缩行出现在含压缩夹具时行序断言要新增而非改旧。

## 回滚

单 PR revert；三件相互独立，revert 任何一件不影响另两件的数据层。
