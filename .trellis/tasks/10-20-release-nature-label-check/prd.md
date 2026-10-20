# PRD：发布说明性质标签校验

对应 GitHub Issue：#244

## 背景

`v0.28.0-beta.1` 发布后核对说明，发现本轮主题功能被分错了类：

```
### 持续集成与自动化
* feat(web): 监控台——把「外部仪表盘」做成自带仪表盘(Round Z)（#226）
```

根因已验证清楚：`.github/workflows/labeler.yml` 的「按标题前缀打性质标签」步骤
只在 `pull_request_target` 的 `opened / synchronize / reopened` 事件上运行。
合并于 #229 修复之前（或在该步骤上线前就合并）的 PR 从未重跑，因此只有路径标签；
`release.yml` 按标签分类时，`automation`（来自 `scripts/**`）排在 `documentation`
之前，功能 PR 就落进了「持续集成与自动化」。

现状对照（已验证）：

| PR | 标题 | 修复后标签 | 结果 |
| --- | --- | --- | --- |
| #230 / #231 / #233 | `fix*` | 含 `bug` | 正确归入「修复」 |
| #216 / #226 | `feat*` | 缺 `enhancement` | 落进自动化 / 文档 |

已做的临时处理：手工给 #216 / #226 补了 `enhancement`，并用
`releases/generate-notes` 干跑验证两者现在都归入「新功能」。

**这解决的是已经发生的那一次，没有解决下一次。**

## 目标

发布工作流在生成变更清单**之前**，检查区间内**标题前缀要求性质标签**的 PR 是否
真的带了（`enhancement` / `bug` / `security`）。缺失时**警告并列出 PR 编号**。

### 范围为什么收窄到「前缀要求标签的 PR」

初版验收写的是「区间内每个 PR 都至少带一个性质标签」，实现后拿真实数据一跑就暴露
了问题：25 个 PR 里报了 21 个缺失，其中绝大多数是 `chore(task): archive …`、
`docs(trellis): …`、`build(deps): …`、`ci(deps): …`。

这些前缀**本来就不该有性质标签**——项目自己的 `scripts/pr-nature-label.sh` 只给
`feat*` / `feature*` / `fix*` / `hotfix*` 打标签，其余前缀输出为空，`chore` 落到
「文档」或「其他变更」是 `.github/release.yml` 的预期行为。要求它们带标签等于
制造噪音，而噪音会被维护者直接忽略，校验就形同虚设。

因此判定标准改成：**该 PR 的标题前缀若在 `pr-nature-label.sh` 的映射里命中，
才要求它带性质标签**。前缀映射**直接复用那个脚本**，不内联第二份——两处映射
一旦分家，改了一处另一处就会静默漂移。

收窄后的真实数据结果：21 条噪音 → 1 条真实告警（`#229`，`fix(ci)` 却没有 `bug`；
它正是添加该步骤的那个 PR，自己赶不上自己，属于先有鸡后有蛋）。

**已知残余风险**：一个实际用户可感知、但标题写成 `chore` / `docs` 的 PR 会被
放过。这不归本校验管——标题类型是否如实反映改动性质，属于提交信息规范
（`scripts/check-commit-msg.sh` 与 review）的职责，让发布校验去猜会造成更多误报。

## 为什么是「警告」而不是「失败」

历史区间里必然存在无法补救的老 PR（merged、无法再触发 labeler）。硬失败会让
「重推 tag 补发」这条路被彻底堵死——而重推 tag 是发布幂等设计里明确支持的场景。
警告能让问题**显式暴露**，又不阻断发布。

## 验收标准

- [ ] 新增脚本 `scripts/check-release-pr-labels.sh`，输入为 `gh pr list
      --json number,title,labels` 的输出，输出**标题前缀要求性质标签却缺失**的
      PR 编号（前缀判定复用 `scripts/pr-nature-label.sh`）
- [ ] 映射脚本执行失败（非零退出、或输出为空）必须**报错退出 2**，不得被当成
      「这个 PR 不需要标签」——那种假绿会让校验永远显示通过
- [ ] 区间边界用 **UTC** 计算，且必须有上界（`prev_tag < mergedAt <= 当前 tag`）；
      只用下界会把 tag 之后、三平台构建期间合并的 PR 也算进本次发布
- [ ] 输出格式稳定可解析，且**不写入 `release-notes.md`**（发布说明面向用户，
      不该出现内部流程警告）
- [ ] `release.yml` 在生成变更清单后、拼装发布说明前调用它；命中时走
      `::warning::` 并列出编号，不改变发布结果
- [ ] 自测 `scripts/check-release-pr-labels-test.sh`，夹具覆盖：
      - 全部带性质标签 → 无输出、退出 0
      - 部分缺失 → 准确列出缺失编号
      - 全部缺失 → 全部列出
      - 空区间（无 PR）→ 无输出、退出 0
      - 同一 PR 带多个性质标签 → 不重复列出
- [ ] 自测接入 `ci.yml`，与 `pr-nature-label-test.sh` 同级
- [ ] CHANGELOG 的 `[Unreleased]` 记一条（工具链类，`Fixed` 或 `Changed`）
- [ ] `./scripts/lint.sh` 通过（zizmor 除外，本机 Docker 未启动）

## 不做

- **不给 labeler 加 `closed` 触发补跑**。它只能覆盖「合并时仍开着的事件流」，
  无法回溯已合并的老 PR；而且合并后改标签对已生成的说明没有追溯力。
- **不改 `.github/release.yml` 的分类顺序**。当前顺序是对的：`bug` 确实优先于
  `automation`（#233 同时有两个标签，正确归入「修复」证明了这一点）。
- **不改已发布的 `v0.28.0-beta.1`**。标签已补，晋升稳定版时说明会自动正确。

## 风险

- `generate-notes` 的输出是 Markdown，解析它不如直接查 API 稳。实现时优先
  调 `gh pr list`（结构化 JSON），把 `generate-notes` 只用于最终正文。
- 需要在 `release.yml` 里多一次 API 调用；失败不得影响发布，沿用现有
  「警告 + 继续」的降级风格。
