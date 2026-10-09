# PRD：J4 · 证据链与门禁——新视图的截图与真机事实

> 父任务：[Round J](../10-09-round-j-context/prd.md) · 前置：J1–J3 全合，收尾任务

## F1 截图归档矩阵扩展

- `web/e2e/screenshots.spec.ts` 与 `docs/screenshots/manifest.json`、
  `scripts/check-screenshots.sh` 的 EXPECTED_VIEWS 增加视图：
  - `context`（含压缩的会话，曲线 + 取证卡片打开态）
  - `context-empty`（无压缩会话）
  - 日志视图换用含压缩行的夹具后补一张（或确认现有 analyzer-log 仍成立并说明）
- 视图 × 浅/深 × Chromium/WebKit 全矩阵，与既有 37 张同规格。

## F2 真机门禁新几何事实

- `scripts/gui-test.sh` 的 CAPTURE_TARGETS 增「上下文」目标（含压缩夹具）；
- PROBE_JS 增锚点收集：曲线 SVG 存在且尺寸有界、压缩标记可点、取证卡片打开后
  在视口内、被丢列表窗口化垫片高度 = 估算总高（防「假列表」）、压缩行展开后内容可达；
- Python 判定段加对应断言；
- 夹具：真机门禁用 HOME 隔离夹具（cwd=/repo/demo 那套）——需要往夹具目录
  加含压缩的会话 JSONL（与 J1 共享同一份 `web/tests/fixtures/compact-session.jsonl`，
  拷入门禁夹具树）。

## F3 变异验证汇总

- 汇总 J1–J3 各自的变异验证记录，再补至少 2 条**门禁级**变异：
  改坏 PROBE_JS 锚点名 → 门禁必须红；删 CAPTURE_TARGETS 条目 → 覆盖判定必须红。

## 验收标准

- [ ] `./scripts/gui-test.sh --build` 全绿，产物截图归档进 gui-artifacts/
- [ ] `npm --prefix web run test:e2e` 全绿且新视图截图落盘、check-screenshots.sh 通过
- [ ] 维护者亲自目验新视图截图（浅/深 × 含压缩/空态）
- [ ] 门禁变异验证记录进 `.trellis/tasks/10-09-j4-evidence/mutation-check.md`

## 附：J2 视觉评审（2026-10-09，维护者亲验）遗留的三个打磨点

评审结论 8.5/10（浅/深同分），功能与排版达标。以下三点是打磨级意见，J4 顺手处理
（改 CSS 即可，不另开任务）：

1. 被丢清单滚动条在浅色下与轨道���比不足——提高 thumb 对比一档（走既有滚动条令牌）；
2. 取证卡与清单之间的分隔线偏浅——从 `--border` 升到 `--border-strong` 一级即可；
3. 峰值直标与曲线描边在密集区有轻微重叠——避让距离 4px → 7px（`peakLabelPlacement`
   的 clearance 或偏移常量，改纯函数常量并跑既有单测）。
