# Implement：Round J · 执行计划

> 主会话是调度者与验收者：实现派子 agent，验收亲自做（读 diff、跑命令、看截图）。
> 实现一律在 worktree `.claude/worktrees/round-j`（主工作树被另一会话占用，见记忆
> subagent-shared-worktree-branches）。J 任务**串行**合并，J2/J3 不得并行。

## 阶段

1. [x] 盘点：拉最新 main、CI 绿、无积压 PR；真实 JSONL 验证压缩记录（research/jsonl-compact-facts.md）
2. [x] 设计师规范（research/design-context-view.md）与任务树（J1–J4 PRD）
3. [ ] J1 解析层 → PR → 合并
4. [ ] J2 上下文标签页（等设计师规范定稿 + J1 合并）→ PR → 合并
5. [ ] J3 三处集成 → PR → 合并
6. [ ] J4 证据链与门禁（含真机 GUI + 截图目验）→ PR → 合并
7. [ ] 收尾：README/文档、CHANGELOG、`v0.14.0-beta.1` 先行版、journal

## 每个 J 任务的固定节奏

派 trellis-implement（prompt 首行 Active task）→ 子 agent 全绿自检 →
主会话亲自：读 diff、复跑四层门禁里适用的层、变异验证抽查 → trellis-check 复核 →
提交（约定式提交，中文 CHANGELOG 条目）→ 推分支 → PR → CI 绿 → squash 合并。

## 回滚点

- 每个 PR 独立可 revert；
- 发布层回滚 = 删 tag（先行版允许，正式版不允许——沿用既有纪律）。

## 当前状态（滚动更新）

- 2026-10-09：J1 合并（#141，755 用例全绿，变异验证 2 条）。
- 2026-10-09：设计师规范落盘（research/design-context-view.md，35KB，零新增令牌、
  颜色全经 ΔE 实测裁决）。
- 2026-10-09：J2 合并（#142，784 用例、e2e 162 双引擎全绿，变异验证 2 条）。
  **维护者视觉验收**：4 张截图（浅/深 × 主视图/取证卡）经 AI 视觉逐项核对——
  Y 轴取整刻度、两 chip 数字与夹具吻合、取证卡数字齐全、清单虚拟滚动生效，
  8.5/10 × 2；三个打磨点（滚动条对比/分隔线/峰值避让）已记入 J4 PRD。
  注意教训：截图验证时 CDN 按文件名缓存旧图，重拍后要换文件名再送审。
- 2026-10-09：J3 合并（#155，810 用例、e2e 172 双引擎全绿，变异验证 2 条；越界改动
  exportHtml/reportPrompt/StackedBar 均有规范依据）。维护者视觉验收：带行通栏+◆双信号
  可辨、展开三块齐全；用量面板 8.5/10，数字与夹具逐项吻合（2 次 / 224,779 / 1 会话）。
- 2026-10-09：并行会话的 Round M 调研合并（#154，开 Issue #146-#153），与 Round J
  无冲突且与覆盖率 chip 互补。J3 合并前两次 BEHIND/BLOCKED，均按既定纪律等待+同步解决。
- 2026-10-09：J4 进行中（j4-impl agent）——截图矩阵、真机门禁锚点、三个打磨点。
  合并后主会话亲自跑 `./scripts/gui-test.sh --build` 做真机验收。
