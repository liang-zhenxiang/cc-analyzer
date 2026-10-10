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


## Session 2026-10-02 · Round D：5h 计费窗口仪表（billing-window）

### What Happened

- **派发基础设施仍不可用**（tmux socket 僵死未恢复，探针失败），按 /goal
  授权与用户「继续下一个功能」的既有指令，Round D 全程主会话实现——
  第四次破例，且首次是完整功能轮。验收独立性补偿：引擎/预设/仪表/卡片
  四层各自独立测试文件，双引擎 e2e，真机 GUI --build 重建后截图 +
  视觉工具独立读数。
- **实现**：clusterBillingBlocks（ccusage blocks 口径：首条活动起算 5h、
  窗口闭后首条活动开新窗，开区间边界）+ burnRateOf（<30min 拒绝外推）
  + predictLimitReach（给具体时刻）；planLimits（四预设 + 自定义，存储
  镜像 thresholds 的 useSyncExternalStore 模式，不可信输入全回退 none）；
  Gauge 环形表盘；BillingWindowCard 挂用量总览顶部；设置面板新增
  「计费窗口」区（原生 select 最稳）。
- **实现中抓出的真 bug**：速率/预测最初复用「按定价快照估算」徽章——
  词不达意（它们不来自定价快照），新增 provenance 第四档「按消耗速度
  推算」。provenance 体系从三档扩到四档，语义纯度保住了。
- **自己被自己写的指南咬**：e2e 里 getByLabel("计费窗口") 子串命中
  「历史计费窗口消耗」——正是当天上午沉淀进 spec 的那个坑，按 spec 加
  exact 解决。指南写得对，写完自己再踩一遍才算真验证过。
- **网络这次断得更彻底**：github.com 直连与代理先后全断（代理进程本身
  也挂过），恢复后通道对调（代理 200/0.77s、直连死）。推送按指南走
  `-c http.proxy` 单命令代理。GUI 测试第一次跑没带 --build、截图字节与
  上轮完全相同——旧产物没有计费卡，重建后视觉确认才作数。
- **验证链**：480 单测（+22）→ 双引擎 e2e 26+26（+4）→ lint 16 项 →
  cargo fmt → GUI 真机 11/11（--build）→ 截图视觉确认（仪表/读数语义/
  徽章/协调性全对）→ README 引用的 usage-light.png 重出。

### Git Commits

| Hash | Message |
|------|---------|
| `a55fbb4` | feat(usage): 5 小时计费窗口仪表 (#82) |
| `107d5c7` | docs(usage): 重出 README 引用的用量总览截图 |

### Status

[OK] **Completed**（PR #82 待 CI）


## Session 2026-10-02 · Round E：全局搜索命令面板（global-search）

### What Happened

- **派发基础设施第三次探测仍僵死**，Round E 主会话实现（第五次破例，
  完整功能轮）。交付：searchIndex 纯逻辑（分组/排序/截窗/渐进单例）+
  SearchPalette 浮层 + useSearchIndex（与用量总览共享解析缓存单例——
  一个文件只解析一次）+ AppShell ⌘K/顶栏按钮 + AnalyzerPage 跳转。
- **本轮最难的一个缺陷**：Enter 真实键盘事件下渲染线程卡死。二分定位
  五轮（变体 A/B/C + 挂载计数 + effect 计数）才抓住：reveal effect 把
  openSession 放进 deps，AppShell 内联回调身份每次渲染都变 → effect
  重入 → openSession 连发；在真实键盘的同步离散提交路径里演变成重入
  风暴（合成 dispatchEvent 走异步优先级路径测不出来——这就是为什么
  evaluate 派发「看起来没问题」）。修法不是加锁，是**重构职责**：拆成
  「打开一次」（deps 仅请求）与「定位一次」两个幂等 effect。教训：
  effect 里调用「会 setState 的异步函数」时，deps 宁缺勿滥，用 ref 读
  最新值；事件合成与真实键的优先级差异足以让「测试通过」完全失真。
- **又踩了一遍自家的坑（第二次）**：getByRole('tab', {name:'会话分析'})
  命中「整会话分析」；region vs complementary 的面板角色记错。定位器
  规则已两次咬人——e2e 写新定位时 exact 是默认动作而不是补救。
- **验证链**：495 单测（+15）→ 双引擎 e2e 31+31（+4，含跳转联动命门）
  → lint → GUI 真机 11/11（--build）→ 顶栏视觉确认。

### Git Commits

| Hash | Message |
|------|---------|
| `e2db7a6` | feat(search): 全局搜索命令面板 (#85) |

### Status

[OK] **Completed**（PR #85 待 CI）


## Session 2026-10-02 · Round F：双渠道自动更新（auto-update）

### What Happened

- **目标**（用户原话要点）：beta 渠道 AI 自动发版；稳定版维护者「配一个 tag
  或点一下」晋升；设置里可选渠道；要把流水线配好并讲清怎么发稳定版。
- **实现**：tauri-plugin-updater（minisign 签名，公钥入仓/私钥仅 GitHub
  Secrets——gh secret set 写入后本地密钥材料即焚）；Rust 侧渠道 endpoint
  运行时拼（channel_endpoint 纯函数可测）+ PendingUpdate 状态 + 四命令；
  前端设置「软件更新」区 + 启动静默检查（挂在 NotificationProvider 内——
  AppShell 体内拿不到自家 Provider 的教训）；e2e mock 扩 updater 两态。
- **流水线**：release.yml 渠道感知（tag 形态分流）+ 签名产物上传 +
  make-updater-json.sh（一份映射两渠道共用）+ rolling release 刷新；
  promote-stable.yml 一键晋升（门禁→版本收敛→CHANGELOG 归档→打 tag→
  同步 PR）。
- **踩的坑**：
  1. 本地构建带 pubkey 无私钥必败——TAURI_BUILD_CONFIG overlay 关掉
     updater 产物（私钥不出 CI 是刻意的）；
  2. build.rs 命令清单治理测试当场拦住「注册了但清单没声明」（该项目
     测试设计者预期的样子）；
  3. 两次 Python 补丁把 bash if/fi 搞断 + 空数组展开撞 bash 3.2 set -u
     （项目硬规则第三次救场）；
  4. mod updater; 插进 cfg 属性与 mod gui_capture 之间，属性错挂。
- **验证**：500 前端 + 17 Rust + 双引擎 e2e 35+35 + lint（新 workflow
  过 actionlint/yamllint/zizmor）+ 真机 GUI 11/11（无更新源 404 场景
  的「失败不打扰」实证）。v0.9.0-beta.1 tag 已推，release.yml 首跑验证中。

### Git Commits

| Hash | Message |
|------|---------|
| `e90dc95` | feat(updater): 双渠道自动更新 (#88) |

### Status

[OK] **Completed**（beta 链路实跑验证中）

**Round F 续：beta 链路四跑通（三坑记录）**

- 一跑挂：`updater::app_version.toml` 文件名含 `::`，Windows 文件系统非法
  ——命令改顶层重导出裸名注册（PR #89）。
- 二跑挂：workflow 上传清单加了 *.sig/*.tar.gz，但构建脚本没收进 dist-*
  ——补 macOS/Windows 收集（PR #90）。
- 三跑「成功但残」：tauri 的 macOS 更新包上游名不带版本与架构，两架构
  同名互覆，live JSON 只剩 windows 平台——收集时规范命名（PR #91）。
- 四跑全通：三平台签名产物 + latest-beta.json（rolling release `beta`）
  可公网访问、三平台键齐全、sig 内容为真签名（非占位）。
- 过程教训：本地直推 main 被分支保护拦（规矩是对的）；修复一律走小 PR。
  残留小尾巴：无版本名的 CC-Analyzer.app.tar.gz 旧资产仍在（不影响
  JSON 与客户端，下轮清理收集路径即可）。

**Round F 终章：全链路模拟与五坑补遗**

- 晋升五坑全记录：①updater:: 文件名 Windows 非法 ②门禁缺 Tauri Linux 库
  ③Cargo.lock 刷新依赖 cargo 编译（改纯文本替换）④GITHUB_TOKEN 推 tag
  不触发 workflow（release.yml 加 dispatch + promote 显式触发）⑤dispatch
  需要 actions:write 权限。全部修复合并（#89/#93/#95/#96/#100）。
- 双渠道实况：v0.9.0-beta.1（prerelease）→ v0.9.0 → v0.9.1-beta.1 →
  v0.9.1（均 9 资产三平台签名齐全，rolling JSON 双渠道公网可访问）。
- 真实用户模拟：/Applications 安装 v0.9.0 → 设置→立即检查更新 → 真实
  GitHub 端点返回「发现新版本 0.9.1 + 安装并重启」（截图存证）。应用内
  一键安装的按钮级链路验证到此；「点击安装→替换→重启」的最后一步在
  本会话的 UI 自动化（capture 点击时序 / osascript AX 不可达）未能完成
  取证——引擎侧（tauri-plugin-updater 标准 download_and_install）与
  工件侧（tar.gz 内 plist=0.9.1、codesign 完好）均已独立验证。留给
  维护者第一次真实点击收口（若异常，错误文案会显示在更新区）。
- 挂载陷阱存档：hdiutil 指定 -mountpoint 若目录曾被占用会看到旧卷内容
  （v0.9.0 官方 dmg 被误判 0.3.0 的乌龙）——验 dmg 务必全新挂载点。
- promote 的自动同步 PR 在两次晋升中都未建成（仅 warning 不阻塞），
  手动补齐等价提交；#101 待修（gh pr create 失败原因待查日志）。


## Session 2026-10-02/03 · Round G：beta.2 发布与 capability 缺陷抢修

### What Happened

- **用户实测报缺陷**：装 0.9.0-beta.1 后设置里「当前版本 未知」。根因——
  四个 updater 自定义命令从未进 `capabilities`（只加了插件的 `updater:default`），
  `invoke` 全被拒。**整个自动更新功能自 v0.9.0-beta.1 起就是死的**，而
  构建/单测/e2e 全绿：mock 与 jsdom 不经过权限层，真机才有真相。
- **修复**（PR #102）：capability 补四条 `allow-*`；新增 Rust 回归测试
  `every_app_command_is_allowed_in_the_capability`（变异验证：删一条即失败）；
  顶栏加**版本徽章**（读 `package_info`，升级是否生效的第一眼证据；先行版
  带「Beta」标记）。
- **发布**：v0.10.0-beta.1（含修复）→ v0.10.0-beta.2（徽章标先行版）。
  beta 渠道 JSON 已指向 0.10.0-beta.2。
- **端到端验证**（探针构建，仅本地）：从 v0.10.0-beta.1 tag 构建带 gui-capture
  的应用，用应用**自己的 IPC** 调命令并把结果渲染/落盘：
  - `app_version` → `0.10.0-beta.1` ✓（权限已通）
  - `check_updates(beta)` → `available: true, version: 0.10.0-beta.2` ✓（真实端点）
  - `install_update` → 磁盘上的 .app 从 beta.1 变 beta.2 ✓（下载+验签+替换，两次成功）
  - `relaunch_app` → 重启后有新实例在跑 ✓
  - 失败路径也验了：一次网络抖动时 check 返回我们自己的中文错误文案
    （「更新检查失败：error sending request…」），不崩、不误导
- **教训**：spec 里早已写明第 5 步（capability），是我没照做且缺自动检查——
  知识在文档里，纪律要靠测试。已把失败模式与两个衍生坑（`::` 文件名、
  下划线文件名 vs 连字符标识符）写进 command-guidelines.md，并注明由测试强制。

## Session 2026-10-07/08 · Round I：证据与层级收口

### What Happened

- **开局盘点**：拉最新 main（v0.13.0-beta.1 字号缩放刚发）；并行派「竞品调研」与
  「UI/UX 设计评审」两个子 agent，产出 `.trellis/tasks/10-07-round-i-truth/research/`
  下的 competitors.md（全部带来源 URL、区分确认/推测）与 design-review.md
  （28 张归档截图逐张目验 + DOM 实测，还附 8 条已否证的自测结论，防止后人照着改）。
- **I1 表格列预算与失败语义**（PR #128）：table-layout fixed + --col-* 令牌、删 waterfall 列
  （信息降级为占比 tooltip）、行高收敛；实现者挖出一个 v0.11.0 起的隐性缺陷——
  `.container td` 基色按特异性盖掉 `.error` 等语义色，失败行从来就不是红的。
  **行高断言连红两次 CI**（Linux 与 macOS 的折叠边框归属差 1~2px），最终收敛为
  「探针 div 读 :root 的 --row-h，断言表头 ≥ 地板」——同引擎量两次，跨引擎差异抵消。
- **I2 错误态统一**（PR #129）：ErrorState 三档尺寸；原始错误串默认不进 DOM（红线）；
  错误与「没有匹配」不再同屏矛盾；监控空态端口取自后端不另写一份。
- **I3 用量总览首屏**（PR #133）：1492→876px，三块面板标题进首屏；紧凑表盘档；
  来源徽章降为圆点；Y 轴刻度取整；热力图补色阶图例；formatProjectPath/formatModelId；
  两页同宽。--chart-*-soft alpha 0.10→0.24（深 0.30）带对比度数值。
- **I4 周用量窗口**（PR #134）：滚动 7 天（绝对毫秒边界，DST 安全）+ 可选自设预算；
  预设一律不填周数字（没有来源就不编）；WeeklyWindow 无 resetAt；顺带修了
  自设上限重启丢失（持久化写 limitTokens、解析读 customLimitTokens）。

### 教训（已存记忆）

- 并行子 agent 共用一棵工作树而分支不同 → 改动串味；必须串行或先开 worktree
  （已存 subagent-shared-worktree-branches.md）。
- 网络通道会翻面：10-01 直连通、10-07 代理通；动手前先各测一次
  （已更新 liangyuxiang-proxy-github.md）。
- 像素断言与渲染差异纠缠：跨平台/跨引擎的折叠边框归属差 1~2px 无法用 CSS 抹平，
  判据要换成「同引擎内量两次」或几何关系。

**Round I 终章（2026-10-08）**

- 五个子任务全部合并：I1=#128（列预算/失败语义/搜索转义）、I2=#129（错误态统一/红线文案）、
  I3=#133（用量总览首屏 1492→876px）、I4=#134（滚动 7 天窗口）、I5=#135（证据链补全）。
- 收尾：#136 README 双语与 pitfalls.md 第 13 节（跨引擎像素断言）；v0.13.0-beta.3 已发布
  （三平台 9 产物、签名齐全、三段式说明：手写主题段 + PR 清单）。beta.2 由另一会话发布。
- 全链路验收数字：单测 741、e2e 154、lint 29、cargo test 18、真机门禁 140 项全绿；
  四个 P0 断言都做过变异验证（列宽/转义/红线/版本桩）。
- 维护者亲验：用量总览浅/深、限额区两种计划态、滚动下半屏、搜索浮层、错误态——
  均逐张看图；真机门禁亲自复跑。

**Round I 补遗（2026-10-09）**

- 实现者的迟到终报里有一处待裁决偏离，已裁决并写进归档 design.md：周预算对照
  **不挂 `estimated` 徽章**（该档文案是「按定价快照估算」，挂在自设数字上是假话），
  改行内文字「（预算为自设数字）」；推算照旧 `inferred`。一般规则：provenance
  的档位文案描述「依据是什么」，依据对不上就不挂。
- I3 那条红的 e2e 根因是测试缺 `page.goto("/")`（页面停在 about:blank），非实现缺陷。
- I3 的变异验证有个值得记住的细节：只把表盘调大而不恢复竖排时首屏用例不红
  （行高被右侧内容吸收），等效变异是恢复竖排布局——写这类断言时先想清楚
  「哪个形态才是回归的本体」。

## Session 2026-10-09 · Round J：上下文压力与压缩取证

### What Happened

- **选题**：复用 Round I 竞品调研（压缩取证是「用户明确抱怨 + 无竞品占位」空地），
  亲自扫本机 371 个真实 JSONL 验证数据地基（compact_boundary 带 pre/post/dropped/
  幸存 uuid 清单；assistant 消息 usage 四计数器齐全）→ research/jsonl-compact-facts.md。
- **设计师出场**：designer agent 产出 35KB 视觉规范（零新增令牌；颜色冲突全部
  ΔE 实测裁决——「色轮盘在两套主题下已铺满，压缩用几何与形状表达身份」是
  约束逼出来的正确答案）。J2/J3 实现逐条照它走。
- **四个子任务全部合并**：J1=#141（解析层，+14 用例）、J2=#142（上下文标签页，
  +29 用例 +4 e2e）、J3=#155（压缩行/用量面板/覆盖率，+26 用例 +10 e2e）、
  J4=#156（证据链 + 真机门禁 + 修真机缺陷）。
- **发布**：v0.14.0-beta.1（tag 已推，三平台构建）。
- 全链路验收数字：单测 812、e2e 172（双引擎）、lint 29、cargo 18、真机门禁 171，
  八条变异验证（六实现级 + 两门禁级）全部先红后绿。

### 教训（本轮新增，值得沉淀）

- **真机门禁抓到了 mock 永远看不见的缺陷**：选中态清空 effect 依赖 parsed 对象
  身份，真机后台重解析（缓存写回→刷新→新对象）数秒内抹掉用户刚点的选中；
  单测 810 绿、e2e 172 绿全放过它。mock 的盲区就是真机门禁的存在理由。
- **eval() 是单向黑盒**：门禁「点选」动作在真机上被 wry 的 eval 静默丢弃，
  无日志无回执。取证类动作必须走 evaluateJavaScript 带回执——归因能力是门禁的一部分。
- **像素对账三要素**：量同一个元素（ul 而不是带内边距的滚动容器）、不取整亚像素
  （35.39×82 累计差 32px 的假差异）、容忍 ±4px。
- **截图验证的 CDN 陷阱**：同名文件重传命中缓存，换文件名再送视觉评审。
- **沙箱可见性**：/var/folders 下的门禁现场跨 Bash 调用会「消失」，取证要在
  同一条命令里拷走（CCA_GUI_KEEP_WORK=1 留现场 + 立即 cp）。

## Session 2026-10-10 · Round N 接力收尾（中断恢复）

### What Happened

- **接力**：Round N（N1 错误规律 / N2 改动清单 / N3 工具普查 / N4 托盘读数）由并行会话
  推进，中断在 N3 的 PR #162（CI 绿但 CONFLICTING——main 已推进到 v0.17-beta）。
  本会话接手：解四类冲突（CAPTURE_TARGETS 步骤序列按语义合并、PROBE_JS 两块
  事实并接、门禁单测移植进 #163 搬好的新位置、截图取 main 后全矩阵重拍 64 张）。
- **真机验收抓到判据过时**：合并后全量门禁 323/325——「滚到底恰在视口内」这半条
  把加长页面后越顶 102px 的面板误判不可达；N3 作者对普查面板早写明「可达性才是
  不变量」，本会话把该原则统一到三块旧面板（#170），325/325 全绿。
- **发布**：v0.18.0-beta.1（N3 + 判据修正，三平台 9 产物）；任务树归档。

### 教训

- **中断恢复的合并冲突要按语义合，不能按行合**：门禁步骤序列（谁切标签页、
  谁不切）与测试位置（#163 搬家）都需要读两侧的意图再落笔；行级自动合并
  会给出编译不过或语义错序的结果。
- **门禁判据要跟内容形态一起演进**：「滚到底在视口内」在页面 < 2 视口高时
  与「一次可达」等价，页面变长后两者分叉——写判据时选等价面更宽的那个表述。
- **merge: 不是合法的提交类型**——冲突收口提交也要过 check-commit-msg，
  用 chore: 前缀。
