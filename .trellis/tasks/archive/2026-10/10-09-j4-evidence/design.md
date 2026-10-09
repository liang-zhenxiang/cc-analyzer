# Design：J4 · 证据链与门禁

> 视觉/几何锚点参照规范 §7 与既有门禁模式（事实在应用、断言在脚本）。

## 结构

- e2e 截图：`web/e2e/screenshots.spec.ts` 的视图矩阵加 `context`（含压缩）与
  `context-empty`；`scripts/check-screenshots.sh` 的 EXPECTED_VIEWS 同步；
  `docs/screenshots/manifest.json` 重生成。取图用 CCA_GUI_MOCK 环境夹具里的
  含压缩会话（把 `web/tests/fixtures/compact-session.jsonl` 纳入 e2e 的 mock 夹具树，
  具体挂载方式跟现有 sessions 夹具一致——先读 web/e2e/ 的夹具装载代码再动手）。
- 真机门禁：`scripts/gui-test.sh` CAPTURE_TARGETS 加「上下文」步（含压缩夹具的
  HOME 隔离树）；PROBE_JS 加锚点：context-curve（SVG 存在、viewBox 有界）、
  compaction-marks（命中区数量 = 事件数）、forensic-card（选中后 rect 在视口内）、
  dropped-list（窗口化垫片总高 = 行数 × 实测行高，防「假列表」）、
  coverage-chip（M>0 时存在）；Python 判定段加五条判据。
- 变异验证：门禁级 2 条（改坏锚点名 → 红；删 CAPTURE_TARGETS 条目 → 覆盖判定红）。

## 兼容

- gui-test.sh 的夹具树独立于 web/tests/fixtures——拷贝而非软链（Windows/CI 语义）。
- 归档截图数量变化要在 manifest 与 README（如有截图清单）同步说明。

## 回滚

单 PR revert；gui-artifacts/ 不进 git（既有纪律）。
