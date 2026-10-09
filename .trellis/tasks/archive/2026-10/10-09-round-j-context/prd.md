# PRD：Round J · 上下文压力与压缩取证

> 创建于 2026-10-09 · 上一轮：Round I（证据与层级收口，v0.13.0-beta.1~3，稳定版待晋升）
> 依据：维护者本轮指令（界面美观第一、敢于创新、测试全补齐、真机截图验证、设计师参与）；
> `.trellis/tasks/archive/2026-10/10-07-round-i-truth/research/competitors.md`（竞品调研 §3.5/§4-#2）；
> 本任务 `research/jsonl-compact-facts.md`（真实 JSONL 实测，2026-10-09）。

## 本轮主题

**把「压缩」从不可见变成可指认。**

Claude Code 的会话在上下文接近上限时会被压缩（compact）：旧消息被摘要替代，
`preTokens → postTokens` 断崖式下降。用户的两类真实痛苦（竞品调研 §3.5，HN 原文在手）：

1. **「限额来得莫名其妙」**（claude-code#16157 👍695）——压缩要把整个上下文重新读一遍再生成摘要，
   是订阅限额消耗的大头，但没有任何工具把它画出来；
2. **「压缩之后我的约束丢了」**（olejorgenb）——「compaction rewrites those files in place.
   … when a session gets compacted you cannot tell what was dropped — which matters if the agent
   silently lost the constraint you gave it forty turns ago.」

调研结论：**这是唯一「用户明确抱怨 + 无成熟工具占位 + 我们的数据原语齐备」的方向**
（§4-#2，⭐ 成本中/价值高）。本轮把它做成 CC Analyzer 的招牌差异功能。

## 已验证的数据地基（research/jsonl-compact-facts.md）

- `compact_boundary` 系统记录带 `preTokens/postTokens/cumulativeDroppedTokens/durationMs/trigger`
  与**精确到 uuid 的幸存消息清单**（`preservedMessages.uuids`）——「丢了什么」可以点名，不用猜；
- 每条 assistant 消息的 usage 都有 `input_tokens/cache_read_input_tokens/cache_creation_input_tokens`
  ——逐消息上下文规模可算，压力曲线的数据源齐备；
- 摘要消息 `isCompactSummary: true`、`compact_boundary.parentUuid` 为 null（挂靠用 `logicalParentUuid`）。

## 范围

| 子任务 | 主题 | 优先级 | 依赖 |
| --- | --- | --- | --- |
| J1 | 解析层：压缩记录、逐消息上下文规模、未知行计数（含夹具与单测） | P0 | — |
| J2 | 会话详情「上下文」标签页：压力曲线 + 压缩取证（**本轮主角**） | P0 | J1 先合 |
| J3 | 日志表压缩边界行 + 用量总览压缩统计 + 解析覆盖率 | P1 | J1 先合；与 J2 串行（同动 sessions 区域） |
| J4 | 证据链与门禁：新视图截图归档、真机几何事实、变异验证 | P1 | 收尾，等 J1–J3 |

实现顺序 J1 → J2 → J3 → J4（J2/J3 同触 `features/sessions/`，按记忆教训不并行）。

## 功能需求

### F1 解析层（J1）

- 从会话 JSONL 解析出：压缩事件列表（时刻、trigger、pre/post/dropped、duration、幸存 uuid 清单）、
  逐 assistant 消息的上下文规模序列、未知记录类型计数（按 type 分桶）；
- 压缩摘要消息（`isCompactSummary`）不得计入「用户发言」类统计；
- 测试夹具：造一个含 2 次压缩（auto + manual）、幸存清单、未知类型的合成 JSONL 进 `web/tests/fixtures/`。

### F2 上下文标签页（J2，按设计师规范实现）

- 会话详情新增「上下文」标签：上下文压力曲线（自绘 SVG，无新库）、压缩事件可点击、
  取证卡片（pre→post/dropped/duration/trigger/幸存 N/M）、「被丢出上下文的内容」窗口化列表；
- 空态（无压缩会话）有真实内容（曲线本身仍在，压缩数为 0 如实显示）；
- 一切视觉细节以 `.trellis/tasks/10-09-round-j-context/research/design-context-view.md` 为准。

### F3 三处集成（J3）

- 日志表第七种行类型「压缩边界」，视觉与消息行可区分、可展开取证卡片；
- 用量总览「压缩统计」面板（周期内压缩次数、累计丢弃、auto/manual），回答「限额去哪了」；
- 解析覆盖率提示（未知行 > 0 才出现），复制报告进剪贴板、不上传。

### F4 证据链（J4）

- 归档截图加「上下文（含压缩）/ 上下文（空态）」视图 × 浅/深 × 双引擎；
- 真机门禁新几何事实（曲线存在、压缩标记可点、取证卡片可达、列表窗口化垫片正确）；
- 至少 4 个断言做变异验证（改坏实现必须红）。

## 非目标（本轮不做）

- 不猜官方上下文上限（没有可靠来源，宁可不自设参考线——除非设计师给出站得住的替代方案）；
- 不做「按提问质量打分」「效率评分」（竞品调研 §5 明确否决）；
- 不动实时监控、多机同步等红线区；
- 不引入第三方图表库。

## 跨子任务验收标准（父任务负责）

- [x] 四层门禁全绿：`./scripts/lint.sh`、`npm --prefix web test`、`npm --prefix web run test:e2e`、
      `./scripts/gui-test.sh --build`
- [x] 新增断言全部做过变异验证；禁止「永远为真」的断言
- [x] 真机取图由维护者**亲自目验**：上下文标签页（含压缩/空态）、日志表压缩行、用量总览压缩面板，浅/深色无布局缺陷
- [x] 设计师规范里的「明确不做什么」逐条核对未被违反
- [x] CHANGELOG `[Unreleased]` 中文条目齐备，发一个先行版 beta tag 验证发布链路
