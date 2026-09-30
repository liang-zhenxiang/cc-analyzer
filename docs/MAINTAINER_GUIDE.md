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

## 依赖升级

三类依赖由 `.github/dependabot.yml` 盯着：Rust crates（`src-tauri`）、
npm 包（`web`）、工作流里的 GitHub Actions。每周一 06:00（Asia/Shanghai）
检查，新版本发布满 7 天（cooldown）才提 PR。

**分组规则**：同一生态的 minor / patch 合并成一个 PR；**major 不分组**，
一个依赖一个 PR —— 大版本必须由人判断，不能自动跟进。

**major 的处理原则是「不要逐个合并」**。互相牵制的依赖（vite 与
`@vitejs/plugin-react`、`vitest`；react 与 `@types/react`）单独升任何一个
都会在 `npm ci` 阶段挂 ERESOLVE，必须一次性协调升级。已经这样做过：

- `vite` 5 → 8，连带 `vitest` 2 → 5、`@vitejs/plugin-react` 4 → 6、
  jsdom 24 → 30（PR #13）
- `typescript` 5 → 7，单独一个 PR（#15）

升级后至少跑：

```bash
npm --prefix web test
npm --prefix web run build
npm audit                                          # 目标：0 vulnerabilities
cargo check --manifest-path src-tauri/Cargo.toml   # 版本号有改动时
```

升级过程中会遇到的报错（`manualChunks` 类型、vitest 5 的 `test` 字段、
jsdom 30 的可访问名称）见
[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md#依赖升级)。

**当前显式豁免**：`react`、`react-dom`、`@types/react`、`@types/react-dom`
的 major 更新在 `dependabot.yml` 里被 `ignore`。React 19 要求 `@types`
成套更换并适配 cleanup 返回值、ref 处理等语义，与安全无关，适合单独一轮。
真要升的时候先删掉那 4 条 `ignore`，再把四个包一起升——只升一半必然卡在
peer 依赖上。

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

> **启用时机**：必须在 CI 已经在本仓库跑过一次之后才启用，否则所有 PR 会
> 因「必需检查从未出现过」而卡死。注意 `contexts` 填的是**检查的显示名**
> （`CI 总览`），不是 job id。配置命令见 `oss-bootstrap` skill。

**当前状态（2026-09-30 核对）**：本项**尚未配置**——`GET
/branches/main/protection` 返回 404。需要 Admin 权限的维护者执行；
协作者的 CI 门禁靠「PR 检查红了就不合并」的自觉维持，属过渡状态。

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

### 仓库与权限

项目只有一个仓库 `liang-zhenxiang/cc-analyzer`，**所有开发都在这里进行**。

- 协作者需要 **Write** 权限（能推分支、开 PR）；**Maintain** 权限可以额外
  管理 Issue / 标签 / 合并 PR；**Admin** 权限才能改分支保护与仓库设置。
- 分支保护、网页端开关这类仓库级设置只有 Admin 能做——协作者发现「改不了」
  时先确认是不是权限层级的问题，而不是找绕过办法。
- 2026-09-30 前曾用一个 fork 仓库搭建基建（原因：当时上游无写权限），
  基建以 PR 形式合并进本仓库后该 fork 已退役，不再参与日常开发。
  本文档与 Issue 模板中的链接全部指向本仓库。

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
