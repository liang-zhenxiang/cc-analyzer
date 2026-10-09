# Design：J1 · 解析层——压缩记录与上下文规模

## 边界

只动 `web/src/features/sessions/` 的解析与派生层 + `web/tests/fixtures/`。不碰 UI、
不动 `usage/` 聚合（那是 J3）。产物是纯数据与纯函数，J2/J3 消费。

## 数据流

```
parseJsonl.ts（现有，逐行）
  ├─ system+compact_boundary → 不再走 SKIPPED_EVENT_TYPES 静默丢弃，
  │    新增分支产出 CompactEvent（挂 logicalParentUuid 对应记录之后）
  ├─ user+isCompactSummary → SessionRecord.kind 保持 "user"（行模型不动），
  │    新增标记 compactSummary: true；统计口径在派生层排除
  └─ 其余未知/跳过行 → ParseCoverage 计数（按 type 分桶）
ParsedSession（types.ts）
  ├─ + compactEvents: CompactEvent[]
  ├─ + parseCoverage: ParseCoverage
  └─ records 不变形（新增可选字段向后兼容）
contextSeries.ts（新文件，纯函数）
  └─ contextSeriesOf(records, compactEvents) → ContextSample[]（时间升序）
       + 每个压缩事件在序列中的前后索引（供 J2 定位断崖）
```

## 关键决策

1. **CompactEvent 放 ParsedSession 顶层而不是塞进 records**：压缩是会话级事件流，
   与行模型正交；塞进 records 会迫使他处过滤。摘要消息的 uuid 存进事件（`summaryUuid`），
   正文截 2000 字符防超长会话内存膨胀。
2. **缺字段用 null 不用 0**（types 里 `number | null`）：老日志没有 compactMetadata 时，
   0 会冒充实测值——违反项目的 provenance 纪律。J2 的 UI 按 null 显示「未记录」。
3. **未知行计数在跳过处就地累加**，不额外扫一遍：`SKIPPED_EVENT_TYPES` 里的已知跳过
   不算未知；只有「既不认识、也没被显式跳过」的 type 才进 `unknownTypeCounts`。
   JSON 坏行单独计 `unparsableLines`。
4. **contextSeriesOf 是派生函数而非解析时产物**：records 已带 usage，派生函数可被
   J2 直接调用、可单测、不增加 ParsedSession 体积。
5. **夹具放 `web/tests/fixtures/compact-session.jsonl`**：单测、e2e、（J4 的）真机门禁
   共用同一份——三处对同一份真相断言，防「测试各自造数据互相漂移」。

## 兼容性

- `ParsedSession` 新增字段全部可选/新增键，既有消费者（usage 聚合、导出、报告）零改动；
- `isCompactSummary` 消息此前被当普通 user 行渲染——本任务只加标记不改渲染（J3 决定行的画法），
  但**派生层的用户消息计数要排除它**，单测守住。

## 回滚

纯增量改动，revert 单个 commit 即回滚；夹具文件独立无依赖。
