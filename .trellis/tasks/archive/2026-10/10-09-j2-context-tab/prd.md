# PRD：J2 · 会话详情「上下文」标签页——压力曲线与压缩取证

> 父任务：[Round J](../10-09-round-j-context/prd.md) · 前置：J1 先合（消费其解析产物）
> 视觉依据：[design-context-view.md](../10-09-round-j-context/research/design-context-view.md)（设计师规范，**冲突时以规范为准**，规范未覆盖处回退本 PRD）

## 要交付什么

会话详情页（SessionAnalyzerPage）的视图切换从「日志 / 树」扩为「日志 / 树 / 上下文」，
新增 **ContextView**：本轮的主角视图，把一次会话画成「上下文心电图」。

### F1 上下文压力曲线（主图）

- 数据：J1 的 `contextSeriesOf`（逐 assistant 消息 contextTokens，时间升序）；
- 自绘 SVG，复用 `charts/chartPrimitives` 的轴件与 1/2/5×10ⁿ 取整刻度；**不引入图表库**；
- 曲线形态、压缩事件标记、tooltip、坐标轴细节按设计师规范 A 节实现；
- 规范若提出「自设参考线」，必须走用户显式设置（设置里已有计费窗口自设先例），
  **绝不内置官方上下文上限数字**（无可靠来源——项目纪律）。

### F2 压缩事件取证卡片

- 点击曲线上的压缩标记 → 取证卡片（pre→post、dropped、durationMs、trigger、幸存 N/M）；
- 数字缺失（老日志）显示「未记录」，不显示 0；
- 卡片交互（打开位置、关闭方式、键盘）按设计师规范。

### F3 「被丢出上下文的内容」列表

- 数据 = 压缩点之前全部消息 − `survivedUuids`（J1 已给精确清单）；
- 每条显示：时间、类别（用户/LLM/工具）、摘要（复用现有 recordSummary）；
- **必须窗口化**（会话可达 5k+ 消息，复用 virtualWindow/measuredRows 模式）；
- 用户发言在视觉上突出（用户的约束被丢是这个功能的叙事核心）——细节按设计师规范。

### F4 空态与降级

- 无压缩的会话：曲线照画（它仍是逐消息上下文规模图），压缩区显示「0 次压缩���的如实读数——
  不是「空状态插画」而是「有数据的零」；
- 无任何 usage 的会话（纯工具会话/极老日志）：按设计师规范的降级方案；
- 子代理会话（isSidechain）：跟随现有子会话导航进入时同样可用。

### F5 标签切换与持久化

- `AnalyzerView` 扩 `"context"`；VIEW_STORAGE_KEY 的读取对未知值已有回落逻辑，沿用；
- e2e 与真机门禁的视图清单都要加「上下文」（J4 收口，但 e2e 用例本任务就要写）。

## 验收标准

- [ ] `npm --prefix web test`：ContextView 组件测试（含空态/降级/长列表窗口化取样）、
      contextSeries 消费正确性、键盘导航
- [ ] `npm --prefix web run test:e2e`：新增「上下文视图」用例（Chromium + WebKit 都跑），
      断言曲线 SVG 存在、压缩标记可点、取证卡片内容、被丢列表首条可达——用 J1 的共享夹具
- [ ] 设计师规范「明确不做什么」逐条核对
- [ ] `./scripts/lint.sh`、`npm --prefix web run build` 全绿；现有用例零回归
- [ ] 至少 2 个新断言做变异验证（改坏 → 红）
