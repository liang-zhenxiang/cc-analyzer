# Journal - liangyuxiang (Part 1)

> AI development session journal
> Started: 2026-10-01

---



## Session 1: 四个用户报障 + 发布说明中文化（含真机复核抓到的自伤缺陷）
<!-- trellis-session: v=2 fp=9497c11a94afa825 -->

**Date**: 2026-10-01
**Task**: 四个用户报障 + 发布说明中文化（含真机复核抓到的自伤缺陷）
**Branch**: `main`

### Summary

四个报障各自成 PR 合并（#56/#57/#58/#59），真机复核又抓出 claude 候选可执行性判定的遗留缺陷并单独修复（#61）

### Main Changes

### 三个 Dependabot 之外的用户报障 + 发布语言规范

维护者一次报了四个问题，全部走 Trellis 闭环处理，拆成四个子任务并行派发给子 agent：

1. **发布说明全中文化**（#52 / PR #56）—— GitHub 原生变更清单自带的英文模板串
   （`What's Changed`、`New Contributors`、`Full Changelog`）由新的
   `scripts/format-release-notes.sh` 转换，分类标题交给仓库级 `.github/release.yml`；
   同时把 `CHANGELOG.md` 的 `[Unreleased]` 全部改写为中文——CHANGELOG 段落会被
   **原样**拼进发布说明，不同步改等于发布说明还是英文。规则沉淀在
   `.trellis/spec/guides/release-notes.md`。
2. **装了 claude CLI 仍报未找到**（#53 / PR #57）。
3. **记录详情面板**：不可收起、复制无反馈、复制摘要为空（#54 / PR #58）。
4. **实时监控**：改为显式打开 + 清掉文案里外部仪表盘的产品名（#55 / PR #59）。

**最值得记的一条**：修完 claude CLI 之后，用真机（真实文件系统 + 真实子进程 +
Finder/Dock 那种收窄的 PATH）复核，发现**自己的修复本身还有缺陷**（#60 / PR #61）：
版本管理器装的 `claude` 常是 shebang 为 `#!/usr/bin/env node` 的脚本，
窄 PATH 下找不到 `node` 时**进程照样启动、只是退出码 127**——旧代码只认
「启动命令失败」字样的错误，于是把这种死安装判成「已运行」并报 ready，
真正的执行要等到生成报告时才失败。修法是：绝对路径候选必须 `--help` 退出码为 0
才算可用，跑不通就继续试下一个；版本目录也改为按版本号新→旧排序后依次尝试。
**单测全绿但真机才炸**——这和 v0.2.1 那两次「本地全绿、发布才炸」是同一类问题。

流程上有一条教训：主会话清理临时验证文件时用了 `git checkout -- .`，
把子 agent 尚未提交的实现一并清掉了（它们被禁止 `git commit`，成果只在工作区里）。
靠让原 agent 按自己的上下文重写才恢复。此后清文件只用 `rm <确切路径>`。


### Git Commits

| Hash | Message |
|------|---------|
| `ce6ff6c` | docs(release): 发布说明全中文化并沉淀规范 (#56) |
| `2ede794` | fix(sessions): 装了 claude CLI 仍报「未找到」 (#57) |
| `f39fa68` | fix(web): 记录详情面板可收起、复制有反馈、摘要不再为空 (#58) |
| `02a1e70` | fix(monitor): 实时监控改为显式打开并清理误导性命名 (#59) |
| `1e63f19` | fix(sessions): 候选须真能执行才算可用，版本目录按新到旧排序 (#61) |

### Status

[OK] **Completed**


## Session 2026-10-01/02 · Round B：用量总览仪表盘（usage-dashboard）

### What Happened

- **Round A 先补发布欠账**：[Unreleased] 积压 #58–#63 → v0.4.0（PR #64，tag 推送前
  按规矩 ls-remote 防双发布；坏 runner 卡 apt 25 分钟，cancel + rerun --failed 只重跑该 job）。
- **Round B 主题由两路并行调研定盘**：竞品调研 agent（ccusage 18.8k⭐ / opcode 22.4k⭐ /
  monitor 8.7k⭐ / CCHV / phuryn）+ UI/UX 设计师 agent 评审（结论「界面差最后一步——
  仪器还没通电」）。功能空白（成本/趋势/分布）与视觉语言（读数行、图表色板）各取所长，
  融合成「用量总览」仪表盘 + provenance 置信徽章（把竞品的「数字不准」危机变成
  「诚实仪表」品牌语言）。调研与评审全文落盘 workspace，后续路线图建成 Issue #66、#68–#73。
- **实现全走子 agent**：impl-core（夹具/聚合/定价/图表）、impl-infra（--chart-* 色板 +
  CCA_GUI_CAPTURE_TAB 真机取图钩子）、impl-page（页面/hook/接线/E2E/文档）。
  主会话只做验收：亲读全部交付代码，返工 3 处（StackedBar %8→%6 引用不存在的
  chart-7/8、柱体大面积实色违反「只许 soft」、热力阶梯顶格 1.0）。
- **验收教训两则**：
  1. GUI 真机截图起初全 0——gui-test.sh 装的是 1 月旧夹具，30 天窗口恒空：
     功能没错，但验证等于没测数据路径。修法：夹具统一时间平移到「最新活动日=昨天」
     （与 e2e recentActivityScenario 同策略，spec 双双沉淀）。
  2. 两张截图颜色统计相同差点误判「没切标签」——统计巧合（两页共享中性骨架），
     视觉确认才作数。颜色方差能证「非空白」，证不了「内容正确」。
- **tmux 面板基础设施中途损坏**（Could not determine current tmux pane/window），
  派发 trellis-check 失败三次。检查环由主会话亲自完成（逐文件审读 + 全量门禁），
  gui-test.sh 的夹具平移修复也由主会话破例代写（约 40 行，测试基建非产品代码，
  偏离已在此记录）。踩坑：node -e 脚本传负数参数要 `--` 分隔（node: bad option: -1）；
  单引号 JS 模板字面量触发 SC2016 误报，按仓库惯例带理由 disable。
- **网络抖动全天**：代理出口被 GitHub 403 限流（EOF / SSL_ERROR_SYSCALL），直连
  200/0.3s。沉淀 .trellis/spec/guides/network-and-proxy.md（措辞刻意不绝对——
  不是人人有代理，结论永远以两通道实测为准）。
- **验证图片边界**：gui-artifacts/ 一直 gitignore；PR 里顺手重出的 24 张旧界面截图
  属噪音，按用户意见回退，只留 README 引用的 4 张 usage 新图。

### Git Commits

| Hash | Message |
|------|---------|
| `819dff1` | chore(release): 发布 v0.4.0 (#64) |
| `574c11e` | feat(usage): 新增「用量总览」仪表盘——趋势、分布、热力与估算成本 (#67) |
| `ca8a57a` | chore(assets): 回退顺手重出的旧界面截图，PR 只保留 README 引用的 usage 新图 |

### Status

[OK] **Completed**（PR #67 待合并后走 v0.5.0 发布轮）


## Session 2026-10-02 · Round C：「通电」界面精修（electrify）

### What Happened

- **派发基础设施中断**：agent-team 的 tmux socket（/tmp/orca-claude-agent-teams/…）报
  stale or unauthorized，新子 agent 全部派不出去（试了 3 次）。Round C 按 /goal 的
  自主推进授权由主会话亲自实现（偏离记录在案），验收独立性以三层测试门禁 +
  视觉分析工具的独立读数补偿。
- **实现内容**（按评审 Top 项）：首屏读数行（SessionHeader 重写，读数行按钮化接管
  TokenPanel 展开）、sessionHealth 三态纯函数（错误优先于「今天」：可行动的胜过
  氛围性的）、TimelineTrack 通电（刻度读数、悬停准线+时刻气泡、块宽按时长映射
  封顶 15%、Shift+←/→）、useRowNavigation 共享 hook 接三表（RecordTable/LogView/
  TreeView 各自的行结构适配：虚拟窗口的 visible 序号、树的递归扁平化）、侧栏
  刷新改 IconButton。
- **两个跨层级的坑，都已沉淀**：
  1. **IconButton 的 title/label 打破 e2e 选择器假设**：`button[title]` 先命中带
     title 的刷新钮（把「点击会话」变成「点击刷新」），且 `getByLabel("会话列表")`
     子串匹配命中「刷新**会话列表**」引发 strict mode 冲突。二分定位（stash/分半
     还原）耗了五轮——教训：可访问名与定位器的耦合是隐式契约，改 label 就该
     grep 测试。修法 exact + :has(strong)。
  2. **纵向空间预算**：读数行 + 独立刻度轴共占 ~54px，CI 的 CJK 回退字体更宽
     （换行→更高），720px 视口下表格被压到 min-height 地板——恰好 240.00px 被
     `toBeGreaterThan(240)` 拦下。修法是把空间还回去（刻度并入轨道底部、
     gap/padding 各收一档），而不是放宽断言。布局不变量测试第一次真正咬人。
- **验证链**：451 单测 → 双引擎 e2e（23×2，新增 keyboard-nav 流）→ lint/fmt →
  GUI 真机 11/11 → README 主图重出并经视觉确认（读数行落地，9.2/10）。
  CI WebKit 的布局用例先后拦下两版（换行版、独立轴版），第三版过。
- **流程修正**：本轮 task.py start 在切好分支之后执行（上轮记录的 branch=main
  元数据错误不再重现）；发布分支提交改用显式文件清单，杜绝 add -A 卷入工件。

### Git Commits

| Hash | Message |
|------|---------|
| `cb5116f` | feat(usage): 用量总览仪表盘 (#67) |
| `3c18a5a` | feat(sessions): 「通电」精修轮 (#76) |
| `f168c2d` | chore(release): 发布 v0.6.0 (#77) |

### Status

[OK] **Completed**（PR #77 待 CI，合并后打 tag 即收官）
