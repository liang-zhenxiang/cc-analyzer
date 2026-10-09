# Implement：J4 · 证据链与门禁

> 分支：`feat/j4-evidence`（J3 合并后从 main 切）。不 commit。
> 这一步动的是门禁本身，改完必须**真跑一次** `./scripts/gui-test.sh --build` 验证。

## 步骤

1. [ ] e2e 截图矩阵：加 `context` / `context-empty` 视图 × 浅/深 × 双引擎；
       更新 check-screenshots.sh EXPECTED_VIEWS；重出图落 docs/screenshots/
2. [ ] 真机门禁：gui-test.sh CAPTURE_TARGETS + PROBE_JS 锚点 + Python 判据
       （曲线存在/命中区=事件数/取证卡在视口内/垫片高度正确/覆盖率 chip）
3. [ ] 夹具进隔离树：compact-session.jsonl 拷入 gui-test HOME 夹具
3. [ ] 门禁级变异验证 2 条 → mutation-check.md
4. [ ] 真跑 `./scripts/gui-test.sh --build` 全绿；维护者目验截图（主会话亲自看）

## 验证命令

```bash
./scripts/lint.sh && npm --prefix web run test:e2e && ./scripts/gui-test.sh --build
```
