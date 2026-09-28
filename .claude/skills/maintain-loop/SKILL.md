---
name: maintain-loop
description: cc-analyzer 项目的维护闭环流程——规划、实现、发布、继续规划的完整循环，以及踩坑沉淀的硬规则。当需要在项目中继续迭代（新功能、修缺陷、补文档）、发布新版本、盘点未完成事项，或有人说「继续」「走维护流程」「按开源流程开发」时使用。
---

# 维护闭环（maintain-loop）

本项目（cc-analyzer，开发仓 `nicholyx/cc-analyzer`，项目本体
`liang-zhenxiang/cc-analyzer`）按真实开源项目的方式维护：
小批量提交、PR 驱动、CI 门禁、Issue 追踪、里程碑与版本发布。

**核心闭环**：`规划 → 实现 → 发布 → 继续规划`。每一轮迭代围绕一个主题，
走完一轮再开下一轮。下面是每个阶段的操作规范，以及踩过坑之后沉淀的硬规则——
**规则部分优先级最高**。

> 本 skill 假设项目基建（CI、治理文件、自动化）已就位。如果是**新项目**要从零落实
> 开源规范，先使用 `oss-bootstrap` skill 完成搭建，再回到这里进入日常迭代。

开始前，若对本项目的设计不熟，先读 `docs/ARCHITECTURE.md` 与 `docs/MAINTAINER_GUIDE.md`。

---

## 一、盘点现状（每轮开始与用户询问「还剩什么没做」时）

```bash
gh issue list --state open --json number,title
gh api repos/liang-zhenxiang/cc-analyzer/milestones --jq '.[] | "\(.title): 完成 \(.closed_issues) / 待办 \(.open_issues)"'
gh release list
gh run list --branch main --workflow=ci.yml --limit 3
git status --short && git log --oneline -3
```

检查点：本地与远端是否一致、main 的 CI 是否绿、`[Unreleased]` 是否积压了未发布的改动
（积压即说明「发布」这一步欠着，优先补上）。

## 二、规划

1. **建里程碑**：`gh api repos/liang-zhenxiang/cc-analyzer/milestones -f title="vX.Y.Z" -f state=open -f description="主题"`
2. **建 Issue**，每项一个，结构固定为：
   - **背景**：为什么（引用真实痛点，不写空话）
   - **期望**：做成什么样（带验收标准 checkbox）
   - **入手位置**：涉及哪些文件/函数
   - **难度**：简单 / 中等 / 中偏难，标注「适合首次贡献」
   - `--milestone "vX.Y.Z"`，打上 `enhancement` / `bug` / `documentation` 标签
3. **更新 README 路线图**：README 的 Roadmap 段落是路线图的单一事实来源，
   规划后把新条目写进去，完成后勾选。

## 三、实现

- **一个 Issue 对应一个分支、一个 PR**。分支名 `feat/*`、`fix/*`、`docs/*`、`chore/*`。
- **动手前先核实 Issue 的前提**。前提不成立时，在 Issue 里留言说明并改写范围，
  而不是硬着头皮实现错误的目标。
- 实现中偏离 Issue 计划（如发现了更严重的相关缺陷），先起一个独立 Issue 记录，再决定顺序。

### 设计原则（本项目已确立的判断，新功能必须延续，详见 docs/ARCHITECTURE.md）

- **解析失败不静默**：JSONL 解析警告单独收集并展示，跳过的事件要有痕迹。
  悄悄丢数据是最危险的——使用者会以为看到了全部。
- **会话文件按不可信输入对待**：子会话路径限定在会话树内；传给 React 的
  序列化经 helper 处理 bigint / 循环引用；非有限数值不吞窗口。
- **数据不出本机**：应用不内置遥测；报告生成把摘要交给使用者自己配置的
  本机 `claude` CLI，不内置 API 凭证。
- **大表必须窗口化 + 实测行高**：估算行高与真实 DOM 不同源（31px 估算 vs
  39px 实测的教训），滚动偏移会差出几千像素。
- **时长口径以时间区间并集为准**：简单求和会重复计数嵌套子会话；轮间等待
  单独成行，不摊进工具耗时。
- **版本号四处同步**：`web/package.json`、`src-tauri/Cargo.toml`、
  `src-tauri/tauri.conf.json`、`packaging/macos/Info.plist`。

### 测试策略

- 前端：Vitest + Testing Library，测试与实现同目录（`*.test.ts[x]`），
  JSONL 夹具放 `web/tests/fixtures/`。解析、时长、筛选、报告相关的改动
  **必须**带夹具用例。
- Rust：命令层保持薄，逻辑尽量留在前端可测的层；新增 Rust 逻辑在
  `src-tauri/src/` 内联 `#[cfg(test)]` 测试。
- **每条 CI 断言先在本地复现**再提交，包括 `bash -e` 语义下的行为
  （GitHub Actions 的 `run:` 默认 errexit）。
- **断言不要匹配状态词本身**——要匹配带图标或数值的具体行，否则断言恒真。

### bash 编码硬规则（兼容 macOS 自带 bash 3.2）

- 禁用 `declare -A`、`mapfile`、`wait -n`、`tac`。去重用 `awk '!seen[$0]++'`，倒序用数组下标循环。
- `printf '%s'` **不输出结尾换行**，配 `while IFS= read -r` 会**丢掉最后一段**（read 遇 EOF 返回非零）。
  必须写 `printf '%s\n'`。
- **空数组的 `"${arr[@]}"` 遍历前必须判长度**。`set -u` 下 bash 3.2（macOS 自带）
  会抛 unbound variable，bash 4.4+ 才改掉——而 CI 用 bash 5，这类缺陷**只在本地暴露**。
- 判断成败禁止管道接 `tail`/`head`：`if cmd | tail -1; then` 判断的是 `tail`
  的退出码。用 `if out="$(cmd 2>&1)"; then`，输出打印放在判断**之后**。
- `$(cmd)` 的退出码就是 cmd 的退出码；命令替换是子 shell，里面改全局变量传不回父进程。

### 修改 YAML 工作流的工具选择

- **无结构的简单替换**（如换版本注释）→ 脚本批量安全。
- **涉及缩进/块结构的插入**（如给 step 加 `with:`）→ **逐个手工 Edit**。
  批量脚本会算错 `with:` 与 `uses:` 的层级关系弄坏 YAML。
  判断依据：修改对象是「字符」还是「结构」。
- 每次改完工作流，跑 `./scripts/lint.sh`（**zizmor 已在其中**，与 CI 同源）。
  zizmor 基线 **0 findings**，豁免集中在 `.github/zizmor.yml`，每条有可验证的
  安全依据；clippy 基线 **0 warnings**（`-D warnings`）。新增 `uses:` 引用必须
  pin 到 commit SHA（注释保留版本号），所有 checkout 保持
  `persist-credentials: false`——这两条是供应链基线，别在后续改动中回退。

### 中文内容质量（高频踩坑）

- **每次编辑中文内容（代码注释、文档、Issue/PR 正文）后，全仓扫描 U+FFFD**：

  ```bash
  python3 -c "
  import pathlib
  bad=[str(p) for p in pathlib.Path('.').rglob('*') if p.is_file() and '.git' not in p.parts
       and 'node_modules' not in p.parts and 'target' not in p.parts and 'web/dist' not in p.parts
       and chr(0xfffd) in p.read_text(encoding='utf-8', errors='ignore')]
  print(bad if bad else 'OK')
  "
  ```

  多轮迭代中反复出现「写入时混入替换字符」，这条必须执行，不要省。
  （`web/dist/` 是构建产物，第三方 bundle 里的替换字符不算命中。）
- 排错文档保留**报错原文**（使用者拿报错搜索），并写明「什么情况下不该用这个方案」。
- **批量改中文文档用「按行索引」，别用长中文串做匹配锚点**。长句里混入一个替换字符
  就会静默匹配失败或匹配错位。更稳的做法：先用 `### 标题` 这类含 ASCII 的锚点定位，
  再按行号切片替换，写入前断言新内容不含 U+FFFD。
- **改完 Markdown 跑内链校验**（rglob 所有 md 的相对链接是否存在的十几行脚本），
  文档与代码同步演进：改了行为不改文档，等于没有改。

### 提交与 PR

- 提交信息遵循 Conventional Commits（校验脚本 `scripts/check-commit-msg.sh`，CI 会查
  PR 提交**和 PR 标题**）。正文写**为什么**，不只是改了什么。
- 提交前本地跑 `./scripts/lint.sh`（actionlint + yamllint + shellcheck + bash -n + zizmor）。
  它**不验提交信息规范**——标题在 PR 建立之前不存在，本地无从验证，仍要自己按规范写。
- PR 正文结构：为什么 → 做了什么 → 关键取舍（含被否掉的方案）→ 测试策略。
- **CHANGELOG**：每个用户可感知的改动都要记入 `[Unreleased]`，分类固定为
  Added / Changed / Deprecated / Removed / Fixed / Security，不自创分类。
  修复类条目写清「此前错在哪、有什么后果」。
- **往 [Unreleased] 插条目，锚点必须校验在正确段落里**。`lines.index('### Added')`
  找的是全文件第一个——版本刚发布后 `[Unreleased]` 是空壳，第一个「### Added」在
  **上一个已发布版本**的段下，新条目会错插进已发布段。插入前断言
  「锚点行号 > [Unreleased] 行号 且 < 下一个 ## [ 行号」，或先从 tag 版本恢复基准。
- **创建 PR / Issue 的正文写进临时文件，不要用嵌套 heredoc**。把
  `gh pr create --body-file - <<'EOF'` 放进 `$(...)`、同时外层又给循环加一个 heredoc 时，
  `-` 拿到的 stdin 会是空的——**PR 正文静默丢失**，`Closes #N` 一起消失。
  写成 `--body-file /tmp/pr-body.md`（先用 Write 落盘）不会踩这个。

## 四、CI 与合并

- CI 全绿才合并：`gh pr checks <N>` 或 `gh pr view <N> --json statusCheckRollup`。
  分支保护只盯**「CI 总览」**这一个 check。
- 合并用 `gh pr merge <N> --squash --delete-branch`。
- 判断成败一律 `if out="$(cmd 2>&1)"`；merge / push 之后必须复核远端真实状态
  （`gh pr view N --json state`、`git ls-remote --tags origin vX.Y.Z`）。

### CI 故障排查

- **Rust job 报 `frontendDist ... path doesn't exist`**：cargo 检查依赖 web/dist
  产物（artifact 传递），job 的 needs / download 步骤被改动后常见。
  本地对应「先 `npm --prefix web run build` 再 cargo」。
- **「CI 总览」job 卡 in_progress 而 run 汇总显示 success**：GitHub 状态不一致。
  `gh pr close <N> && gh pr reopen <N>` 重新触发即可恢复。
- **分支保护拒绝合并、提示 not up to date**：`git rebase main` 后
  `git push --force-with-lease`。
- **`gh run view --log` 的输出混着源码行**：过滤 `[36;1m`（ANSI 回显）再看实际输出。
- **日志只显示 `exit code 2` 没有任何输出**：多半是 `set -e` 下某条命令失败导致整个
  步骤中断。「故意要失败的命令」（造失败数据）必须包在 `set +e` / `set -e` 之间。
- **网络抖动是常态**：`gh` / `git push` 失败就重试，模式：

  ```bash
  for i in 1 2 3 4 5; do
    if out="$(<命令> 2>&1)"; then echo "$out" | tail -1; break; fi
    echo "第 ${i} 次失败，重试..."; sleep 5
  done
  ```

  注意非幂等操作的重复执行风险（见发布幂等）。
- **`gh` 只认 `origin`**：分支推在别的 remote 上时加 `--head <owner>:<branch>`。

## 五、发布

1. 从最新 main 切 `chore/release-vX.Y.Z` 分支。
2. **版本号四处同步**：`web/package.json`、`src-tauri/Cargo.toml`（跑
   `cargo check` 刷新 `Cargo.lock`）、`src-tauri/tauri.conf.json`、
   `packaging/macos/Info.plist`。
3. 把 CHANGELOG 的 `[Unreleased]` 归入 `[X.Y.Z] - 日期`，段首加一句话概述
   本轮主题；`[Unreleased]` 恢复为空壳。
4. 提交信息 `chore(release): 发布 vX.Y.Z`，建发布 PR 并走完整 CI。
5. squash merge 后**先查远端没有同名 tag** 再打标签并推送：
   `git ls-remote --tags origin vX.Y.Z`（应为空）→
   `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`
6. `release.yml` 自动执行：三平台构建（macOS ARM64 / Intel / Windows）→
   三段式发布说明（CHANGELOG 手写段 + GitHub 原生 PR 清单 + 可选 AI 摘要，
   未配 `ANTHROPIC_API_KEY` 走降级路径，不影响发布）→ 创建 Release 并上传产物。
7. 验证：`gh release view vX.Y.Z` 确认说明与产物齐全、
   `gh run list --workflow=release.yml` 确认成功。

### 发布幂等

网络抖动时 `git push` 可能「显示失败、远端已成功」，重试会重复推送 tag →
触发两次发布工作流。工作流已做「先查后建」（已存在改走 edit 并 `--clobber`
补传产物），**推送 tag 前先用 `git ls-remote --tags` 确认不存在**。

tag 打错时修复顺序：删远端 tag（`git push origin :refs/tags/vX.Y.Z`）→ 删错误
release（`gh release delete`）→ 确认 main 含归档提交 → 重推 tag → 验证
release 内容。

## 六、发布后：继续规划

- 更新 README 路线图：本轮条目勾选完成。
- 建下一版本里程碑与 Issue（回到第二步）。

---

## 红线（来自 docs/MAINTAINER_GUIDE.md，任何时候不得违反）

- `${{ }}` 表达式不直接写进 `run:`，一律经 `env:` 中转（表达式注入）
- `pull_request_target` 的工作流**绝不 checkout PR 代码**
- 不在日志中输出 Secret；会话内容、用户路径视同敏感数据，引用前先剔除
- 所有 `uses:` 保持 SHA pin、所有 checkout 保持 `persist-credentials: false`
- zizmor 基线 0 findings、clippy 基线 0 warnings，豁免必须有据
- 不提交生成产物（`web/dist/`、`target/`、`dist-*`、`node_modules/`）
- release 构建不引入任何缓存路径

## 快速命令参考

| 操作 | 命令 |
| --- | --- |
| 本地全量静态检查 | `./scripts/lint.sh` |
| 前端测试 / 构建 | `npm --prefix web test` / `npm --prefix web run build` |
| Rust 检查 | `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo check`（manifest-path 见 CONTRIBUTING.md） |
| 提交信息预检 | `./scripts/check-commit-msg.sh --message "..."` |
| 建里程碑 | `gh api repos/liang-zhenxiang/cc-analyzer/milestones -f title=... -f state=open` |
| 合并 PR | `gh pr merge <N> --squash --delete-branch` |
| 发布 | tag `vX.Y.Z` 推送即触发 release.yml |
| 乱码扫描 | 见「中文内容质量」一节的 python 命令 |
