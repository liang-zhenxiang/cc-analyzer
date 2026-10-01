# 记录详情面板可收起与复制反馈

## Goal

右侧「记录详情」面板（`web/src/features/sessions/RecordDetailPanel.tsx`）
有三个问题：

1. **无法收起**。面板由 `SessionAnalyzerPage` 在 `selectedRecord` 非空时渲染,
   样式类 `styles.withDetail` 会占掉右侧一整列，但面板内部**没有关闭控件**，
   用户只能靠点别的记录来换内容，无法把这一列腾出来。
2. **复制没有反馈**。`runAction()` 只在**失败**时设置 `actionError`；
   成功时什么都不发生，用户不知道有没有复制成功。
3. **「复制摘要」复制不到数据**。按钮执行的是
   `clipboard.writeText(record.text)`。`SessionRecord.text` 是
   `string` 类型但**可以合法为空串**（`parseJsonl.ts` 里多处赋 `text: ""`，
   例如只有 tool_result 没有文本的记录）。空串写进剪贴板 = 用户**看起来**
   什么都没复制到，且没有任何提示。

## Requirements

1. **可收起**：面板头部提供关闭按钮，点击后收起详情列（`withDetail` 布局还原）。
   收起后能从列表重新选中记录再次打开（不能把选中状态搞坏）。
   关闭按钮需要可访问名（沿用项目里 `IconButton` 的 `label` 约定）。
2. **复制有反馈**：复制成功与失败都要有反馈。项目已有
   `useNotifications()`（`web/src/app/NotificationProvider.tsx`，
   `notify(message, tone)`，tone 为 `success | error`），直接复用,
   不要另造一套 toast。
3. **「复制摘要」要有内容**：
   - 摘要取「最能代表这条记录的一段文本」，`record.text` 为空时**回退**到
     有意义的替代（例如工具名 + 输入/输出摘要，或结构化结果的第一段），
     而不是写空串。
   - 若确实取不到任何可用文本，按钮应**禁用或明确提示「无可复制内容」**,
     不能静默写空串。
4. 其余复制按钮（复制 ID / 复制会话 ID / 复制路径）同样接入成功反馈。
5. 不改动 `RecordDetailPanel` 已有的安全判断（`childPathInScope` 那段
   「只在允许读取的目录内才提供打开」的逻辑必须原样保留）。

## Acceptance Criteria

- [ ] 单元测试：点击关闭按钮会触发 `onClose`（或把选中记录清空的等价回调）
- [ ] 单元测试：复制成功后出现成功提示（断言 toast 文本），
      复制失败（mock 抛错）时出现错误提示
- [ ] 单元测试：`record.text` 为空串时，
      **写进剪贴板的内容非空**（回退文本）；若真的无内容可复制，
      断言按钮为 disabled 或出现「无可复制内容」提示——**不允许断言空串被写入**
- [ ] 单元测试：`record.text` 非空时原样复制，不被回退逻辑改写
- [ ] 端到端（Playwright）：打开一条记录 → 详情面板出现 → 点关闭 → 面板消失
- [ ] `npm --prefix web test` 与 `npm --prefix web run test:e2e` 全绿

## Notes

- 「摘要」的语义要写清在测试名里，避免下一个人以为它等于 `record.text`。
- 收起按钮不要用「删除」语义的图标；用 `close`（Icon 里已有）。

## 关联

- GitHub Issue: #54（`fix(web): 记录详情面板无法收起、复制无反馈、复制摘要为空`）
