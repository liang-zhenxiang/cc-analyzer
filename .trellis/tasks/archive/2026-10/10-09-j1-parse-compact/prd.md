# PRD：J1 · 解析层——压缩记录与上下文规模

> 父任务：[Round J](../10-09-round-j-context/prd.md) · 前置：无（本轮第一步）
> 数据依据：[jsonl-compact-facts.md](../10-09-round-j-context/research/jsonl-compact-facts.md)（真实 JSONL 实测）

## 要交付什么

在现有会话解析层（`web/src/features/sessions/parseJsonl.ts` 及配套）之上，新增三类**纯数据**能力。
本任务**不碰任何 UI**——J2/J3 消费这些数据。

### F1 压缩事件列表

从 `type: "system", subtype: "compact_boundary"` 记录解析：

```ts
type CompactEvent = {
  id: string;            // boundary uuid
  timestamp: number;     // 记录 timestamp（ms）
  trigger: "manual" | "auto" | string;  // 原样保留，未知值不映射
  preTokens: number;
  postTokens: number;
  droppedTokens: number; // cumulativeDroppedTokens，原样取，不自己累加
  durationMs: number;
  survivedUuids: string[];   // preservedMessages.uuids（若缺失回退 allUuids，再缺失为空数组）
  summaryText: string | null; // 紧随其后的 isCompactSummary 消息正文（截断到合理长度存内存即可）
  summaryUuid: string | null;
};
```

硬约束（来自实测）：
- `parentUuid` 为 null，消息链挂靠用 `logicalParentUuid`——不得因 parentUuid 缺失把边界当孤儿丢弃；
- `isCompactSummary: true` 的 user 消息**不得**计入用户发言统计/行数里的「用户消息」；
  行模型里它属于压缩边界的一部分（J3 再决定行的画法，这里只保证数据可达）；
- 字段缺失（老版本日志没有 compactMetadata）时优雅降级：仍产出事件，数字字段允许为 null，
  类型里如实标注，**不许造 0 冒充实测**。

### F2 逐消息上下文规模序列

对每条带 usage 的 assistant 记录产出：

```ts
type ContextSample = {
  uuid: string;
  timestamp: number;
  contextTokens: number;  // input_tokens + cache_read_input_tokens + cache_creation_input_tokens
  outputTokens: number;   // 供 J2 显示「本次生成」用
  model: string | null;
};
```

序列按时间升序；压缩后 contextTokens 应出现断崖——这是 J2 曲线的核心叙事，不需要在本层验证，
但**单测要有一条断言真实夹具里压缩点前后样本量级关系成立**（防字段名抄错导致曲线画平）。

### F3 未知记录类型计数

解析时统计：总行数、JSON 解析失败行数、已知类型行数、按 `type` 分桶的未知/未处理类型计数
（`compact_boundary` 从本任务起算已知）。产出：

```ts
type ParseCoverage = {
  totalLines: number;
  unparsableLines: number;
  unknownTypeCounts: Record<string, number>; // type 缺失时键为 "(missing)"
};
```

现状是静默丢弃（已核实：全仓只有 slash 命令名里出现 "compact"）——本任务把它变成计数。

## 夹具（进 `web/tests/fixtures/`，单测与 e2e 共用）

合成一个会话 JSONL：
- ≥ 2 次压缩（一次 auto、一次 manual），带完整 compactMetadata（pre/post/dropped/duration/preservedMessages）；
- 压缩摘要消息（isCompactSummary: true，正文以真实开头语开头）；
- 若干带 usage 的 assistant 消息（压缩前后量级差 ≥ 10×，制造可见断崖）；
- 2~3 行未知类型（如 `type: "future-widget"`）与 1 行坏 JSON；
- 行数规模适中（几百行，e2e 也要用它）。

## 验收标准

- [ ] `npm --prefix web test` 全绿，新增单测覆盖：字段全的边界、字段缺的边界、
      summary 不计入用户统计、断崖量级关系、未知行计数、坏行计数
- [ ] `npm --prefix web run build`（tsc -b）通过，无 any/@ts-ignore
- [ ] 现有全部测试不红（特别是 parseJsonl.test.ts / logRows.test.ts / tokenTotals.test.ts）
- [ ] `./scripts/lint.sh` 通过
- [ ] 对「summary 不计入用户统计」与「断崖量级」两条断言做变异验证（改坏实现必须红）
