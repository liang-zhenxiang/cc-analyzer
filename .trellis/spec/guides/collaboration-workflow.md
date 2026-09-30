# 协作流程：Trellis 与本项目既有流程的融合

> 本文只回答一个问题：**Trellis 引入之后，两套流程怎么协同。**
> 其余主题各有唯一权威位置，见文末「权威分工表」——改规则时只改权威那一处，
> 不要在多个文件里各写一份。

---

## 为什么是融合，不是二选一

本项目原本有一套流程（写在 `AGENTS.md` 与 `.claude/skills/maintain-loop/`）：
以 GitHub Issue / PR / CI / Release 为载体，围绕**一个版本**展开。

Trellis 带来的是另一套：以 `.trellis/tasks/` 为载体，围绕**一个任务**展开。

两者不是竞争关系，而是**不同粒度**：

| | 管什么 | 载体 |
| --- | --- | --- |
| Trellis | 一个任务**内部**怎么想清楚、怎么做完 | `.trellis/tasks/<task>/` |
| 本项目既有流程 | 任务**之间**怎么流转、怎么上车、怎么发版 | GitHub Issue / PR / Release |

硬要二选一会各丢一半价值。只用 Trellis：产物进不了 CI 门禁和发布流水线，
规划得再漂亮也发不出去；只用既有那套：需求探索的过程留在会话里，
会话一压缩就没了，下一个接手的人只看得到结果、看不到取舍。

---

## 粒度对应关系

| Trellis 阶段 | 本项目对应的动作 |
| --- | --- |
| **Phase 1 Plan** — `prd.md`（`design.md` / `implement.md` 用于复杂任务） | 对应 GitHub Issue 的「背景 / 期望 / 入手位置 / 难度」四段。复杂任务额外落 `design.md` 与 `implement.md` |
| **Phase 2 Execute** — `trellis-implement` → `trellis-check` | 在 `feat/*` 分支上实现；`trellis-check` 要跑的东西与我们的「提交前检查」是同一套：`./scripts/lint.sh` + 前端测试 + Rust 三件套 |
| **Phase 3 Finish** — 更新 spec → 提交 | 更新 `CHANGELOG.md` 的 `[Unreleased]` → 提交 → 开 PR → **CI 全绿** → squash 合并 |
| —— | **发布**：Trellis 不管发布，仍走既有的 `chore/release-vX.Y.Z` 流程 |

**关键分歧点：Trellis 的 Finish 不等于发布。**
任务收尾到「PR 已合并」为止。发布是独立的一轮，由 tag 触发，
节奏由维护者决定——不要让每个任务都触发一次发版。

---

## 什么时候建 Trellis 任务

Trellis 的默认规则是「每次动手前先问要不要建任务」。本项目已经**预先授权**，
所以按下面的判据自行决定，不要再问：

| 情形 | 建任务？ |
| --- | --- |
| 会改代码或配置，且不是一行修复 | **建** |
| 需要跨会话完成（今天做不完） | **建** |
| 需要先调研/选型再动手 | **建**（把调研结论写进 `research/`） |
| 纯答疑、纯解释、不落盘 | 不建 |
| 改错别字、改一个常量 | 不建，直接改 |

**一个 GitHub Issue 对应一个 Trellis 任务**，两者标题对齐。这不是形式主义：
Issue 是给协作者看的门面，任务目录是自己用的工作台——
PRD 里的取舍、调研笔记、被否掉的方案放在工作台，不往 Issue 里堆。

任务完成后用 `/trellis:finish-work` 归档；
归档前确认 `CHANGELOG.md` 已更新、PR 已合并。

---

## 与本项目红线的交界

Trellis 的部分默认行为**必须让位于本项目红线**（红线全文见 `AGENTS.md`
「项目红线」一节，那是唯一权威）。两处需要特别说明：

- **Trellis 的 journal 自动提交**（`session_auto_commit`）默认开启，
  会自行 `git add` + `git commit`。本项目的提交信息受 CI 校验
  （Conventional Commits），且提交必须能追溯到 Issue——
  所以**只用它记录 `.trellis/workspace/` 下的日志**，
  不要把业务改动交给它提交。
- **`.trellis/scripts/` 与 `.claude/hooks/` 是被自动执行的代码**
  （SessionStart / UserPromptSubmit / PreToolUse）。
  改动这两处等同于改动会在每次会话静默运行的代码，
  必须按 `SECURITY.md` 的说明走审查，不能当作普通文档改动。

---

## 权威分工表（改规则前先看这里）

| 主题 | 唯一权威位置 | 怎么加载 |
| --- | --- | --- |
| 新会话该知道的一切（流程摘要 + 红线 + CI 坑） | `AGENTS.md`「Open-Source Workflow」 | **自动**（每次会话） |
| 执行细节、bash 编码硬规则、完整踩坑史 | `.claude/skills/maintain-loop/SKILL.md` | 按需 |
| 从零搭开源基建 | `.claude/skills/oss-bootstrap/SKILL.md` | 按需（基建已就位） |
| **Trellis 与本项目流程的映射** | **本文** | 按需 |
| Trellis 自身的阶段机制（prd/design/implement、任务状态机） | `.trellis/workflow.md` | 由 hook 每轮注入摘要 |
| 分层编码约定（前端） | `.trellis/spec/frontend/` | 按需 |
| 分层编码约定（后端 / Tauri） | `.trellis/spec/backend/` | 按需 |
| 发布步骤与仓库配置清单 | `docs/MAINTAINER_GUIDE.md` | 按需 |
| 版本号同步点（3 处） | `AGENTS.md` + `docs/MAINTAINER_GUIDE.md` | —— |

**为什么要有这张表**：同一个主题写在两个地方，两份就会漂移；
漂移的规则比没有规则更危险，因为它让人按错误的前提行动。
新增规则前先查这张表——**能挂到已有权威位置的就挂过去，不要新起一份**。

---

## 常见误用

- **把 Trellis 任务当 Issue 用**：任务目录不入 PR 讨论，Issue 里也不抄 PRD 全文。
  两者各有读者，重复维护必然漂移。
- **每个任务都发一次版**：发布是版本级的动作，不是任务级的。
  多个任务合并进一个 `[Unreleased]`，攒够了再发。
- **绕过 CI 直接合并**：Trellis 的 `trellis-check` 是本地自检，
  **不能替代 CI**。分支保护只认「CI 总览」这一个 check。
- **在 `.trellis/spec/` 里重抄 AGENTS.md**：规范要引用，不要复制。
