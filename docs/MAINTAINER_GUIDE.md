# 维护者手册

日常迭代、发布、仓库配置的完整清单。写在这里的事情都是「换一台机器或
重建仓库时需要重做」的——它们不在代码里。

## 日常迭代循环

一轮迭代 = 规划 → 实现 → 发布：

1. **规划**：开里程碑（`vX.Y.Z`）与 Issue；Roadmap 类事项维护在 README 的
   路线图一节。
2. **实现**：一个 Issue 一个分支一个 PR（`feat/*`、`fix/*`、`docs/*`、
   `chore/*`）。PR 必须 CI 全绿后 squash 合并——合并后 PR 标题就是提交
   信息，所以标题要遵循 [约定式提交规范](../CONTRIBUTING.md#commit-message-convention)。
3. **发布**：见下一节。

用户可感知的每个改动都要在合入时记入 [`CHANGELOG.md`](../CHANGELOG.md) 的
`Unreleased` 段，分类固定为 Added / Changed / Deprecated / Removed / Fixed /
Security，不自创分类。

## 发布流程

1. 从最新 `main` 切 `chore/release-vX.Y.Z` 分支。
2. **版本号四处同步**（缺一不可，见仓库配置清单）：
   - `web/package.json`
   - `src-tauri/Cargo.toml`（同步执行 `cargo check` 刷新 `Cargo.lock`）
   - `src-tauri/tauri.conf.json`
   - `packaging/macos/Info.plist`
3. 把 CHANGELOG 的 `Unreleased` 归入 `[X.Y.Z] - 日期`，段首写一句本轮主题；
   `Unreleased` 恢复为空壳。
4. 提交 `chore(release): 发布 vX.Y.Z`，建发布 PR，CI 绿后 squash 合并。
5. **推送 tag 前先确认远端没有同名 tag**（网络抖动时 push 可能「显示失败、
   远端已成功」，重推会触发两次发布工作流）：

   ```bash
   git ls-remote --tags origin vX.Y.Z   # 应为空
   git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
   ```

6. `release.yml` 自动执行：三平台构建（macOS ARM64 / macOS Intel / Windows）
   → 组装三段式发布说明（CHANGELOG 手写段 + GitHub 原生 PR 清单 + 可选
   AI 摘要）→ 创建 Release 并上传产物。
7. 验证：`gh release view vX.Y.Z` 确认说明齐全、产物在列；
   `gh run list --workflow=release.yml` 确认运行成功。

**发布幂等**：tag 重复推送触发第二次工作流时，「先查后建」逻辑会改走
`gh release edit` 更新说明并 `--clobber` 补传产物，不会 422。

## 仓库配置清单

以下配置不在代码里，重建仓库或换组织时需要重做。

### 分支保护（Settings → Branches → main）

- ✅ Require status checks: **「CI 总览」**（这是 `ci-summary` 的显示名，
  只盯这一个 check——增删检查项不用改保护规则）
- ✅ Require branches up to date
- ✅ Dismiss stale reviews / Require conversation resolution
- ❌ Allow force pushes / Allow deletions
- 单人维护阶段 `required_approving_review_count: 0`：不强制他人审批，
  CI 仍是硬门禁

### 仓库标签

`gh label create <名> --color <色> --description <说明>`，至少包括
`frontend`、`tauri`、`packaging`、`automation`、`ci`、`documentation`、
`governance`、`dependencies`（labeler.yml 会用到）以及 `stale`、`pinned`、
`security`、`good first issue`、`help wanted`、`accepted`、`blocked`、
`work-in-progress`（stale.yml 的豁免名单用到）。

### Secrets

| Secret | 必需？ | 用途 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 可选 | release.yml 的 AI 摘要；不配置走降级路径，发布不受影响 |

### Fork / upstream 双仓运作

- `liang-zhenxiang/cc-analyzer` 是**项目本体**（文档与 Issue 模板中的链接
  都指向它）；`nicholyx/cc-analyzer` 是功能开发仓，基建与 CI 在这里先跑通。
- PR 面向 upstream 提交；fork 上的 `main` 保持与 upstream 可快进同步。
- **fork 仓库的限制**：Issues 与 Discussions 无法在 fork 上启用（GitHub
  限制，只能在 upstream 用）；依赖 PR 触发的工作流（welcome / stale 的
  issue 侧）在 fork 上不会生效，属预期。
- Scorecard 评分按仓库独立：两边合并后各自跑各自的公开评分。

### 网页端开关（需手动确认）

- Settings → General → Pull Requests → **Allow auto-merge**：建议开启，
  配合 `gh pr merge --auto` 使用。
- Settings → Actions → General → Workflow permissions：建议设为
  **Read repository contents and packages permissions**（默认最小权限，
  各工作流已显式声明所需权限）。
- Discussions：upstream 上按需开启（承接使用提问后，SUPPORT.md 的分流
  路径可加上 Discussions 一项）。

## 项目红线

任何时候不得违反：

- `${{ }}` 表达式不直接写进 `run:`，一律经 `env:` 中转（表达式注入）
- `pull_request_target` 的工作流**绝不 checkout PR 代码**；要 checkout
  就改用 `pull_request` 并放弃写权限
- 不在日志中输出 Secret；会话内容、用户路径视同敏感数据，Issue 与日志
  引用前先剔除
- 所有 `uses:` 保持按 commit SHA pin（注释保留版本号，Dependabot 会更新）；
  所有 checkout 保持 `persist-credentials: false`
- zizmor 基线 **0 findings**，豁免集中在 `.github/zizmor.yml` 且每条有
  可验证的安全依据；clippy 基线 **0 warnings**（`-D warnings`），确需豁免
  在代码处写明依据
- 不提交生成产物（`web/dist/`、`target/`、`dist-*`、`node_modules/`）
- release 构建不引入任何缓存路径（产物完整性优先于构建速度）

## 检查速查

| 场景 | 命令 |
| --- | --- |
| 本地静态检查（推送前） | `./scripts/lint.sh` |
| 前端测试 / 构建 | `npm --prefix web test` / `npm --prefix web run build` |
| Rust 检查 | `cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo check`（manifest 见 CONTRIBUTING.md） |
| 提交信息预检 | `./scripts/check-commit-msg.sh --message "..."` |
| CI 状态 | `gh run list --branch main --workflow=ci.yml --limit 3` |
