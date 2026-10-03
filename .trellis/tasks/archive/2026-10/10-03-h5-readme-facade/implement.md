# 实施计划：H5 README 门面补全

> 依赖 PRD：[`prd.md`](./prd.md) · 分支建议：`docs/readme-facade`
> 本任务**不碰代码**，只改文档；因此与其他子任务无文件冲突，可在任意窗口做。

## 0. 先建一份「能力 ↔ 依据」对照表（动手写之前）

README 的每条能力都必须能溯源。边读边列：

| 能力 | 依据（写进 PR） |
| --- | --- |
| 5 小时计费窗口 + 订阅计划 + burn rate 预测 | `CHANGELOG.md` v0.7.0；`docs/USAGE.md` §用量总览 第 6 条 |
| 全局搜索 ⌘K | `CHANGELOG.md` v0.8.0；`docs/USAGE.md` §快捷键与全局搜索 |
| 双渠道自动更新 | `CHANGELOG.md` v0.9.0；`docs/USAGE.md` §软件更新 |
| 首屏读数行 / 时间刻度轴 / 三表键盘导航 | `CHANGELOG.md` v0.6.0 |
| 复制 resume 命令 | `CHANGELOG.md` `[Unreleased]`；PR #108 |
| 骨架加载态 / 分段控件一致 | `CHANGELOG.md` `[Unreleased]` |

**直接从 `CHANGELOG.md` 抄事实，不要凭印象写。** 它是本项目最完整的能力清单。

## 1. 改哪几处（中英各一份，逐处对齐）

1. **功能特性 / Features**：补齐上表能力。计费窗口放在**显眼位置**（见 PRD 需求 2），
   不要埋在清单中段。
2. **首图 caption / alt**：`usage-light.png` 的画面里有计费窗口卡片，描述要跟上。
3. **路线图 / Roadmap**：删已完成项，换成真实开放 Issue（#70 / #71 / #73 / #19）。
   链接到 Issue 而不是写自由文本，这样路线图会随 Issue 关闭而失准得可见。
4. **推送前的检查 / Development**：补 `npm --prefix web run test:e2e` 与
   `./scripts/gui-test.sh`。
   - **注意仓库的「同一主题只有一个权威位置」规矩**：命令清单若在 `AGENTS.md`
     与 README 各写一份，迟早漂移。做法二选一（在 PR 里说明选了哪个、为什么）：
     - README 只给「最常用的三条 + 指向 `AGENTS.md` 的链接」，细节留在 AGENTS.md；或
     - README 保留完整清单，并显式声明「`AGENTS.md` 是权威，此处为其摘要」。
5. **两版同步**：中文与英文逐一对照，章节顺序必须一致。

## 2. 可选：为「结构一致性」加自动检查

仓库已声明「两份 README 结构一致」，但没有任何检查。若要加：

- 比对两份 README 的**标题序列**（层级 + 顺序），不一致就失败。
- **必须跳过围栏代码块**：README 的 bash 示例里有 `# macOS Apple Silicon` 这类注释行，
  朴素地 grep `^#` 会把它们当成标题（本项目已踩过同类坑）。
- 位置：`scripts/check-readme-parity.sh` + `scripts/check-readme-parity-test.sh`（自测含变异），
  按仓库既有做法接进 `scripts/lint.sh` 与 CI。
- **判断成本收益**：若认为不值，在 PR 里说明理由，并给出**人工核对结论**
  （逐节对照的结果），不要既不检查也不说明。

## 3. 自查

```bash
./scripts/check-screenshots.sh      # README 引用的图必须存在且在清单内
./scripts/lint.sh
```

逐条核对 PRD 的验收标准，特别是：
- 两版**章节顺序**一致（贴出对照结果）
- 每条新增能力都有 `CHANGELOG.md` 或代码依据（贴出对照表）
- 没有出现「最强大」「第一名」这类不可验证的话
- 没有新增竞品对比表

## 4. 提交

- 分支 `docs/readme-facade`，提交信息
  `docs: README 补齐 v0.6–v0.10 的能力，修正路线图与推送前检查`。
- **不需要** CHANGELOG 条目：CHANGELOG 记的是用户可感知的**产品**变化，
  而 README 本身是文档（本仓库既有做法：`docs:` 提交不写 CHANGELOG）。

## 回滚点

- 纯文档改动，回滚零成本。唯一有连带的是「文档索引」与路线图里的链接——
  改完请点一遍确认链接可达（至少确认文件存在、Issue 编号存在）。