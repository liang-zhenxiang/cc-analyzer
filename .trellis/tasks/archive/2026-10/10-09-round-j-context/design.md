# Design：Round J · 上下文压力与压缩取证

## 叙事主张

一次 Claude Code 会话的上下文像一条不断攀升的曲线——写代码、读文件、跑测试，
每一步都把更多内容压进模型的工作记忆。**压缩（compact）是这条曲线上的除颤事件**：
pre→post 的断崖让会话得以继续，代价是旧消息被摘要替代、
「四十轮前的约束」从此不在上下文里。没有任何竞品把这画出来；我们有逐消息 usage
和精确到 uuid 的幸存清单，可以**指名道姓**而不是猜测。

这轮把三件事连成一条叙事链：**上下文怎么涨（压力曲线）→ 断崖在哪（压缩事件）→
什么被丢了（取证）**，再把它接进既有的两处舞台（日志表、用量总览），
最后用解析覆盖率守住「我们没假装看懂了所有行」的信任底线。

## 边界与契约

- J1 产出的数据契约（CompactEvent / ContextSample / ParseCoverage）是本轮的**唯一权威定义**，
  J2/J3 只消费不自造；契约变更必须回改 J1 的类型与测试；
- UI 全部走既有令牌与共享原语（Panel/Skeleton/EmptyState/SegmentedControl/chartPrimitives），
  设计师规范给的「新增令牌」进 tokens.css 浅/深两套，不许组件内写死颜色；
- 会话数据不出本机、用户路径不进 UI/产物、无来源的数字不显示（null 显示「未记录」）——
  三条红线在 J3 的「复制报告」处最容易被无意踩到，check 阶段单独核对。

## 数据流（全链）

```
会话 JSONL ──parseJsonl──> records + compactEvents + parseCoverage
                                │
        ┌───────────────────────┼──────────────────────────┐
   contextSeries.ts        LogView 行模型              usageAggregations
   （压力序列+锚点）        （compact 行，J3）          （压缩统计，J3）
        │                                                   │
   ContextView（J2 主角视图）                    UsageOverviewPage 压缩面板
        │
   解析覆盖率提示（J3，ParseCoverage）
```

## 兼容与回滚

- 解析层改动全部是「新增可选字段 + system 分流前置」，既有消费者零改动（J1 验收含全量回归）；
- 每个 J 任务独立分支独立 PR，revert 单个 PR 即回滚该件；
- 旧日志（无 compactMetadata）全链降级为「未记录」，不阻塞任何视图。

## 发布形状

J1–J4 合入 main 后走先行版 `v0.14.0-beta.1`（新功能minor 版本号 +1，beta 渠道），
稳定版晋升维持「维护者试用后人工决策」的既有节奏，不由本轮自动触发。
