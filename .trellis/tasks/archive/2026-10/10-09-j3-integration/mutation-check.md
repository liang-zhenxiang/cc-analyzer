# J3 变异验证记录

> 实现分支 `feat/j3-integration`。每条变异：改动 → 跑目标测试 → 确认红 → 还原 → 确认回绿。

## 变异 1：删掉「摘要折叠不成行」

- **位置**：`web/src/features/sessions/logRows.ts` 的 `buildLogRows`——
  把 `const messageRecords = records.filter((record) => record.compactSummary !== true);`
  改成 `const messageRecords = records;`（摘要消息重新以用户行进表）。
- **预期红**：「压缩摘要不再单独成行」这条产品行为失去保护。
- **结果**（`npx vitest run src/features/sessions/logRows.test.ts`）：

  ```
  × folds the isCompactSummary message into the band row instead of a user row
  Tests  1 failed | 19 passed (20)
  ```

- **还原后**：26/26 全绿（与 compactionStats 同跑）。

## 变异 2：compactionStats 跨会话累计改直读

- **位置**：`web/src/features/usage/compactionStats.ts` 的 `droppedTokens`——
  把 `Σ (preTokens − postTokens)` 改成 `Σ (event.droppedTokens ?? 0)`（把日志里
  的**会话内累计值**再累计一遍，数据约束 #4 明令禁止的口径）。
- **预期红**：累计丢弃被重复计数（测试夹具下 1450 变 1750）。
- **结果**（`npx vitest run src/features/usage/compactionStats.test.ts`）：

  ```
  × sums per-event pre − post, never the cumulative counters (data constraint 4)
  × treats events with missing pre/post as count-only, not as a guess
  × ranks top sessions by dropped tokens and caps at three
  Tests  3 failed | 3 passed (6)
  ```

- **还原后**：26/26 全绿（与 logRows 同跑）。

## 结论

两条变异都被新断言当场抓住，且各自只红在对应行为上（其余用例不受牵连）——
断言不是恒真。
