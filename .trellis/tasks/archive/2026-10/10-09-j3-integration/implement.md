# Implement：J3 · 三处集成

> 分支：`feat/j3-integration`（J2 合并后从 main 切）。不 commit。
> 规范 §3/§4/§5 + §9 红线自查。

## 步骤

1. [ ] 压缩行：logRows 注册 + LogView 带行渲染 + 展开 + FilterBar chip +
       RecordDetailPanel 呈现 + 单测（入序/折叠摘要/筛选/键盘同权）
2. [ ] 用量面板：compactionStats 纯函数 + 单测（周期裁剪、auto/manual、top3、
       跨会话累计口径——**单会话 pre−post 求和**，写清为什么不直读累计值）+
       CompactionPanel 组件 + 0 次态 + e2e
3. [ ] 覆盖率 chip：ParseCoverageChip + popover + 复制报告（脱敏断言：文本不含
       `/Users/`、不含夹具绝对路径）+ 单测（M=0 不渲染 / M>0 渲染 / 复制文本）
4. [ ] e2e（双引擎）：压缩行出现并可展开、摘要不在表里单独成行、用量面板数字、
       chip 点击弹卡、复制按钮（剪贴板桩）
5. [ ] 全量四层命令 + 变异验证 ≥2（删折叠逻辑 → 「摘要不成行」断言红；
       跨会话累计改直读 → compactionStats 单测红）→ `mutation-check.md`

## 验证命令

```bash
./scripts/lint.sh && npm --prefix web test && npm --prefix web run build && npm --prefix web run test:e2e
```
