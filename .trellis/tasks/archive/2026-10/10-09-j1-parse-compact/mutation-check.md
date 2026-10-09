# J1 变异验证记录（2026-10-09）

> implement.md 末尾要求的两条变异验证。方法：改坏实现 → 只跑相关测试文件确认变红 →
> 改回 → 全量复跑确认全绿。命令均为 `npx vitest run <files>`（web/ 目录下）。

## 变异 1：logicalParentUuid 挂靠改成 parentUuid

改动点：`web/src/features/sessions/parseJsonl.ts` 的 `consumeCompactBoundary` 中

```diff
-    logicalParentUuid: optionalString(value.logicalParentUuid) ?? null
+    logicalParentUuid: optionalString(value.parentUuid) ?? null
```

实测结果（boundary 记录的 `parentUuid` 在真实日志里恒为 null，因此事件挂靠点全部丢失）：

```text
× anchors each cliff at the logical parent's sample   ← implement.md 点名的断崖锚点测试
× keeps at least a 10x drop across every compaction cliff
× parses both compactions from the fixture with full metadata
× keeps a boundary without compactMetadata, with numbers null
Tests  4 failed | 42 passed (46)
```

红的机理分两类：
- `parseJsonl.test.ts` 直接断言 `logicalParentUuid: "cs-asst-049"`，变异后为 null，立即红；
- `contextSeries.test.ts` 的锚点用例断言 `anchor.beforeIndex === samples.findIndex(uuid === event.logicalParentUuid)`，
  变异后期望值变成 findIndex(null) = -1，而实现回退到时间戳定位仍给出 49，-1 ≠ 49 → 红。
  这条断言逐字表达「锚点必须挂在 logicalParentUuid 指向的样本上」，不是恒真式。

改回后：两个文件 46 用例全绿。

## 变异 2：删掉「摘要排除用户消息统计」

改动点：`web/src/features/usage/usageAggregations.ts` 的 `aggregateSession` 中

```diff
-    if (record.compactSummary === true) continue;
```

实测结果：

```text
× marks compact summaries and keeps them out of message statistics
Tests  1 failed | 38 passed (39)
```

红的机理：夹具 `compact-session.jsonl` 有 120 轮 user+assistant（240 条）加 2 条压缩摘要；
断言 `aggregate.messages).toBe(240)`。删除排除后摘要按 user 行计入，messages 变 242 → 红。

改回后：全量 `npm --prefix web test` 755 用例全绿。

## 结论

两条变异均使目标测试变红，改回后全绿。断言对实现真实敏感，非恒真。
