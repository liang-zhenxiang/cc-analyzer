# Implement：J1 · 解析层——压缩记录与上下文规模

> 执行者注意：先读 `implement.jsonl` 列出的规范与 research 两份文档再动手。
> 分支：`feat/j1-parse-compact`（从最新 `main` 切）。**不提交，产出留在工作区**，由主会话验收后提交。

## 步骤

1. [ ] 类型先行：`web/src/features/sessions/types.ts` 增 `CompactEvent` / `ParseCoverage`
   / `ContextSample`（字段见 PRD F1–F3，数字缺失用 `number | null`）；
   `ParsedSession` 增 `compactEvents?`、`parseCoverage?`；`SessionRecord` 增 `compactSummary?`
2. [ ] `parseJsonl.ts`：
   - `system` 且 `subtype === "compact_boundary"` 在 SKIPPED 判断**之前**分流，
     从 `compactMetadata` 收敛字段（survivedUuids 取 `preservedMessages.uuids`，缺失回退 `allUuids`）；
   - `user` 且 `isCompactSummary === true` → 记录标记 + 事件回填 `summaryText`（截 2000 字符）/
     `summaryUuid`；**摘要的消息计数排除**在 `buildTurns`/统计口径处处理（找到现有
     「用户消息数」的计算点并排除，grep `userMessageCount\|消息数`）
   - 跳过与未知行计数：`ParseCoverage`（`totalLines`/`unparsableLines`/`unknownTypeCounts`）
3. [ ] 新文件 `web/src/features/sessions/contextSeries.ts`：`contextSeriesOf(records)` →
   `ContextSample[]`（只收带 usage 的 assistant，按 timestamp 升序）+
   `compactionAnchors(samples, compactEvents)` → 每事件的前/后样本索引
4. [ ] 夹具 `web/tests/fixtures/compact-session.jsonl`：按 PRD「夹具」节合成
   （2 次压缩 auto+manual、断崖 ≥10×、2 种未知 type、1 行坏 JSON、几百行）
5. [ ] 单测：`parseJsonl.test.ts` 增压缩解析组（字段全/缺/摘要排除/未知计数/坏行计数）；
   新建 `contextSeries.test.ts`（序列单调、断崖量级、锚点索引）
6. [ ] 全量验证（见下）+ 变异验证两条（见下）

## 验证命令（全绿才算完）

```bash
./scripts/lint.sh
npm --prefix web test
npm --prefix web run build
```

## 变异验证（做完把实现改坏、确认红、再改回）

1. 把 `logicalParentUuid` 挂靠改成 `parentUuid` → 断崖锚点测试必须红
2. 把「摘要排除用户统计」删掉 → 用户消息计数测试必须红

## 回滚点

每步一个逻辑单元；出问题 revert 工作区改动即可（未提交）。
