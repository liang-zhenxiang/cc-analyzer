# Round X 截图差异裁决（主会话独立取证）

**背景**：X4 在做 task-5（出「出血点」4 张图）时，`docs/screenshots/` 出现 **77 个 M + 5 个 ??**。
X4 主动回报而非擅自提交，并把差异量化——这是正确的处置。本文件是主会话的独立裁决。

## 结论：一并提交

77 张里混合了**三条互不相同**的成因。没有一条是「代码坏了」，但**合并提交是正确决定**——
因为 `check-screenshots.sh` 只校验文件名在场，**不校验字节内容**（`manifest.json` 里只有
文件名清单，无任何 hash），过期图会**静默通过 CI**。这正是 #196 那一类漂移。

### A. 真实 UI 变化（Round X 预期）
- 顶栏标签条新增第 4 个视图「出血点」
- 侧栏会话行新增「N 次压缩」徽章（X3 的特性），标题截断位置随之前移
- **取证**：`context-light.png` 中 delta>20 的像素聚成两块——
  `x≈284..292 / y≈302..317`（侧栏会话行，徽章所在处）与顶栏标签条。
  裁剪对照目视确认**主面板逐像素相同**。

### B. 日期滚动（生成时跨了本地午夜）
- HEAD 截图生成于 `2026-10-15T08:22:14Z` = **CST 2026-10-15 16:22**
- 本次重出图生成于 `2026-10-15T17:55:16Z` = **CST 2026-10-16 01:55**
- `web/e2e/fixtures.ts:117 recentActivityScenario()` 用 `new Date()`（本地日历日）
  把夹具时间戳平移到「最新活动日 = 昨天」，故日期相关视图的坐标轴整体前移一天：
  `usage-light` 当前 `10/1 10/4 10/7 10/10 10/13 10/14` vs HEAD `9/28 10/1 10/4 10/7 10/10 10/13`
- 这是 `recentActivityScenario` 的**既有设计**（`fixtures.ts:109-116` 注释明写「不平移，
  三天后相关断言就会假红」），**非本轮引入**。

### C. 纯抗锯齿噪声
- **对照锚点**：`monitor-dark.png` 是「监控未打开」空态——无日期、无会话行、无徽章，
  两版目视完全一致，却有 6225 px 差异，而 **delta>32 的像素数为 0**。
- 对比 `context-light.png`：delta>32 有 **1696** 个像素（真实内容变化）。
- **判据**：以「delta>32 的像素数」区分「真内容变化」与「AA 噪声」，可靠且可复现。

| 视图 | delta>32 | 判定 |
| --- | --- | --- |
| monitor-dark | 0 | 纯噪声（对照锚点） |
| analyzer-log-light | 185 | 噪声为主 + 小徽章 |
| settings-light | 185 | 同上 |
| usage-light | 1333 | 标签条 + 徽章 + 日期滚动 |
| context-light | 1696 | 标签条 + 徽章（主面板逐像素相同） |
| error-view-light | 2239 | 标签条 + 徽章 + 日期滚动 |

## 关键事实：README 引用的图是日期相关的
README.md / README.zh-CN.md 引用 4 张：`analyzer-log-light`、`bleed-light`、
**`pulse-light`**、**`usage-light`**。后两张是日期相关视图 → **HEAD 里 README 的图已经过期**。
故重出图并提交是修正而非引入问题。

## 遗留改进（记入下一轮，不在本轮做）
`manifest.json` 不存 hash → 过期截图静默通过 CI。加内容指纹（如 sha256）能让
「图与代码同代」变成可校验的事，而不是靠人记得。

---

# 附：本轮工作区卫生核查（主会话）

## 未跟踪文件分三类（12 项）

**A. 本轮真实交付（应提交）——8 项**
- `web/src/features/sessions/bleedModel.ts` / `bleedModel.test.ts`（X1，归因纯函数）
- `web/src/features/sessions/BleedView.tsx` / `.module.css` / `.test.tsx`（X2，视图）
- `web/e2e/selectors.ts` / `selector-probe.spec.ts`（X6，选择器单一权威 + 探针）
- `.trellis/` 下 3 项记录（本轮任务与设计文档）

**B. x4 task-1 的结构改造（3 项 M，待统一提交）**
- `scripts/check-screenshots.sh`、`scripts/check-screenshots-test.sh`、`web/e2e/screenshots.spec.ts`

**C. 真正的临时垃圾——1 项**
- **`.tmp-report/rust-backend-report.md`**（35KB，`src-tauri/` 的 Rust 后端分析）
  - 从未被 git 跟踪（`git log --all -- .tmp-report/` 为空）
  - 全仓**零引用**（docs / scripts / .trellis 全无）
  - `.gitignore` **没有**任何规则覆盖它
  - 风险：`git add -A` 会把它带进仓库

## 处置
`.tmp-report/` 应删除或加进 `.gitignore`。**不能只删**——同类 scratch 目录下次还会出现，
所以正确修法是**在 `.gitignore` 里加规则**（与既有的 `docs/superpowers/` 同类，都是本地工作笔记）。

**已执行**：`.gitignore` 追加 `.tmp-report/` 与 `.tmp-*/`（后者兜住同类 scratch 目录）。
`git check-ignore -v .tmp-report/` 已确认命中。

---

# 补充：e2e 运行时在本机**不可判**（宿主 OS 故障，非代码问题）

Round X 收尾时全量 e2e 跑不起来。**这不是负载、不是选择器、不是本轮代码**，而是宿主
macOS 的 Mach bootstrap / launchd domain 退化。证据链（主会话独立取证）：

```
$ chrome-headless-shell --version
Google Chrome for Testing 153.0.8010.12          ← 二进制自身健康，rc=0

$ launchctl print system
Could not print domain: 141: Reentrancy avoided   ← 关键：141

$ pgrep -fl chrome
pgrep: Cannot get process list
sysmon request failed with error: sysmond service not found
```

Playwright **不含任何 spec 代码**的最小探针（launch → newPage → setContent → textContent）：

```
FAIL chromium: browserType.launch: Target page, context or browser has been closed  [26ms]
FAIL webkit  : browserType.launch: Target page, context or browser has been closed  [85ms]
```

**26ms / 85ms 即在 `launch` 阶段崩溃**，而当时 `uptime` 负载仅 **5.39**——饿死的进程是慢，
不会 26ms 就死，故**排除 CPU 争抢**。测试代码一行未执行。

`141` 与 Playwright 报的 `mach_port_rendezvous_mac.cc:159 ... unknown error code (141)`
是**同一个 Mach 错误码**：Chromium 无法在退化的 bootstrap domain 里注册 IPC 端口。
`kern.boottime` = `Wed Oct 14 03:43:29 2026`，已连续开机近 2 天。

**判据对照**（x7 做的对照实验，方法正确）：拿**与本轮无关、此前为绿**的
`context-view.spec.ts` 在同环境跑，**同样 0/4 全红、崩溃签名逐字相同** → 失败归因环境。

**影响与处置**：
- `bleed-view.spec.ts` 的运行时行为判为**不可判**，**不计为失败**（进程启动阶段即死，
  `0/7` 在统计上等价于没跑）。其**代码面**已通过静态门禁（真 `tsc` exit 0、U+FFFD=0、
  DOM 契约逐条对源码核对）。
- **重启机器后可复跑**（我未在会话内重启宿主）：
  `npm --prefix web run test:e2e -- bleed-view --trace=off`
  以及全量 `npm --prefix web run test:e2e --trace=off`。
- PR 中必须**如实披露**「e2e 运行时层未验证」，**不得冒充已验证**。

**教训（与负载假红的区分）**：Round X 中途确有一轮 webkit 大面积红是**负载**导致的
（当时 chromium 152 绿 / webkit 83 绿 75 红，12 倍不对称）。但**同一现象有两种成因**，
判据必须看**崩溃发生在哪个阶段**：
- 负载假红 → 死在**执行期**（`Navigation cancelled` / timeout），且两个引擎**不对称**
- 本例 OS 故障 → 死在 **`launch` 阶段**（26ms），两个引擎**同样死**，且 `launchctl`/`pgrep` 同时异常

只看「webkit 红得多」会误判成负载；**必须加一条「launch 阶段是否健康」的探针**。
这是本轮最值得沉淀的一条排障经验。

---

# 深挖：真机 GUI 路径**同样**被堵，且故障是**慢性的**（非本轮引入）

判「不可判」时我多问了一句：`./scripts/gui-test.sh` 驱动的是**真 Tauri 应用**（系统
WKWebView），**不经过 Playwright 自带的浏览器**——这条路径会不会仍然可用？实测**不可用**，
且证据把根因钉得更深：

## 1) 真机 .app 直接 SIGABRT

```
$ open -a "dist-arm64/CC Analyzer.app"
error=Error Domain=NSOSStatusErrorDomain Code=-10827 "kLSNoExecutableErr: The executable is missing"

$ ./dist-arm64/CC Analyzer.app/Contents/MacOS/cc-analyzer
Abort trap: 6        ← SIGABRT，退出码 134，**零输出**
```

`-10827 kLSNoExecutableErr` 是**假象**：`Contents/MacOS/cc-analyzer` 明明存在
（21358624 字节、`-rwxr-xr-x`），`Info.plist` 的 `CFBundleExecutable` 也是 `cc-analyzer`。
直接跑同一二进制 → SIGABRT。**LaunchServices 只是把底层的启动失败报成了一个误导性的错。**

## 2) 决定性证据：WebKit 自己在本机反复崩溃

```
$ ls ~/Library/Logs/DiagnosticReports/ | grep -c WebKit
81
```

**81 份 `ExcUserFault_com.apple.WebKit.Networking.Development-*.ips`**，时间分布：

```
Oct  9:  2
Oct 10:  8
Oct 12: 19
Oct 13: 26
Oct 14: 11
Oct 16: 15
```

最近的崩溃详情（解析 `.ips` 正文）：

```
exception.type    = EXC_GUARD
exception.subtype = GUARD_TYPE_USER
exception.message = namespc 31 reason_code 0x0000000000000000
termination       = {"namespace": "WEBKIT", "flags": 518, "code": 0}
```

**`EXC_GUARD` / `GUARD_TYPE_USER` 是 macOS 的 guard 沙箱机制拒绝了 WebKit 所需的
Mach port 权利**——`namespc 31`、`termination.namespace = WEBKIT` 逐层对上。
这与前面的 `141`（`launchctl`: `Reentrancy avoided`；Chromium: `unknown error code (141)`）
**是同一件事的三个观测面**。

## 3) 结论：慢性宿主退化，**不是本轮引入**

- 崩溃跨 **Oct 9 → Oct 16 整整一周**，而 Round X 是 Oct 16 才动的 → **先于本轮存在**
- 两条运行时验证路径**同时被同一个故障堵死**：
  Playwright（自带 chromium/webkit 二进制）与真机 GUI（系统 WKWebView）
- **判为「运行时层本机不可判」是唯一诚实的结论**，且**不归因于本轮任何改动**

**处置**：重启宿主（或换一台干净机器）后按前述命令复跑。这是**人类 owner 的决策**，
我未在会话内重启机器。PR/发布说明中必须如实披露该层未验证。

**给后续排障的一条硬判据**（比「看负载」可靠）：
```
./web/node_modules/.bin/playwright 起不来时，先跑 5 行最小探针量 launch 耗时：
  毫秒级（<1s）失败 → 宿主基础设施故障（Mach/bootstrap/guard），重启才能修
  秒级或执行期失败 → 资源争抢或代码问题
再看 `ls ~/Library/Logs/DiagnosticReports/ | grep -c WebKit` 是否为长期非零——
  为真则说明这台机器的 WebKit 早已不可用，别在代码里找原因。
```

## 4) 顺带核实：U+FFFD 乱码的归因（我先前记错过一次）

> 注：本节**刻意引用**替换字符的转义写法 `\uFFFD` 作为证据（下文两处）。它**不是**
> 本文档被写坏——是「把病历写进病历」。U+FFFD 门禁上线后，这几处仍保持转义写法，
> 不需要给本节文件级豁免。

`web/e2e/screenshots.spec.ts` 里 `「工具与 skill」\uFFFD板` 的修复**不是 x6 做的**。
逐层追踪：

```
引入点:   a0c4749 (N3, #162) —— 这行写出来时就是坏的（'\uFFFD板' 首次出现）
仍在:     b7d3a37 (x4 的截图提交) :180 —— 穿过 x4 的提交，仍是坏的
已修复:   worktree :293 —— 修复夹在未提交的 227 插入 diff 里
归因:     **x4 的 task-5 declareView 重构（未提交部分）**
```

x6 自己纠正了我这条误记，理由是**行号方向矛盾**（`:180 → :293` 是向下 113 行，
而 x6 对该文件净变化是 −11 行）。**我复核后确认 x6 正确，已撤回对他的表扬。**

另：`grep -rn $'\ufffd' web/e2e/` **零命中**——`web/e2e/` 下已无 U+FFFD 残留。

全仓普查：**24 个已跟踪文件在 HEAD 带 U+FFFD**，8 个在 `web/` 出货源码。
**逐条核过 `web/` 下全部 10 处都在注释里**，无一落在能进 UI 的字符串字面量
→ **外观债，非用户可见缺陷，不阻塞本轮**。但 `scripts/lint.sh` **没有任何 U+FFFD 检查**
（已 grep 确认），即**缺少门禁才是根因**。已起草 Issue：加门禁 + 清存量**必须同一 PR**
（分开会让中间那次 CI 必红）。

---

# Round X 收口状态（截至 2026-10-16 03:37 CST）

## 本地已全绿

```
npm --prefix web test             113 files / 1317 tests passed
./web/node_modules/.bin/tsc       exit 0        （真 tsc；npx tsc 在本机假通过）
npm --prefix web run build        成功
cargo fmt --check                 exit 0
cargo clippy -D warnings          exit 0
cargo check                       exit 0
cargo test                        76 passed / 0 failed
./scripts/lint.sh                 通过 29 · 失败 0 · 跳过 0
./scripts/check-screenshots.sh    ✓ 80 张（20 视图 × 2 主题 × 2 引擎）
./scripts/check-screenshots-test.sh  通过 17 · 失败 0（5 个注入故障全部如预期失败）
```

`src-tauri/` 本轮**零改动**（`git status --short src-tauri/` 为空），故 Rust 侧门禁与 main 同。

## 未验证的一层（必须如实披露）

**e2e 运行时层**：本机不可判。宿主 macOS 的 Mach bootstrap / launchd domain 退化，
Playwright 自带的 chromium/webkit 与真机 WKWebView **两条路径同时被堵死**：

- `chrome-headless-shell --version` → 正常（二进制健康）
- 但 `launch` 在 **26ms / 85ms** 阶段崩溃（当时负载仅 5.39 → 排除 CPU 争抢）
- `launchctl print system` → `Could not print domain: 141: Reentrancy avoided`
- `~/Library/Logs/DiagnosticReports/` 有 **81 份** WebKit `EXC_GUARD` 崩溃（Oct 9 → Oct 16，
  **早于本轮**，是慢性宿主退化）
- 真机 `.app` 直接跑 → `Abort trap: 6`（退出码 134，零输出）
- 对照组：与本轮无关的既有 spec `context-view.spec.ts` 同环境**同样全红、签名逐字相同**
- 与网络无关：`--no-sandbox --disable-gpu` 仍失败

**复跑命令（宿主重启后）**：
```
npm --prefix web run test:e2e -- bleed-view --trace=off
npm --prefix web run test:e2e --trace=off
./scripts/gui-test.sh --build
```

## 推送被网络阻断（非代码问题）

```
git ls-remote --heads origin  → Could not resolve host: github.com
nslookup github.com           → 20.205.243.166（DNS 能解析）
ping 1.1.1.1                  → 100% packet loss（TCP 不通）
curl https://www.google.com   → 000
```

**分支 `feat/context-bleed` 已就绪，领先 `origin/main`（395f2a2）5 个提交**：

```
b7d3a37 chore(screenshots): 重出 Round X 截图基线并新增出血点视图
e3ccdee feat(web): 上下文出血点——把「这次会话哪里烧钱」变成可执行的整改清单
5b135bd test(e2e): 会话条目选择器收敛为单一权威，并补出血点标签页覆盖
c88ab00 docs: 记入上下文出血点，并忽略智能体临时产物目录
88f978e docs(trellis): Round X 选题、设计规格与截图差异裁决记录
```

**网络恢复后要做**：① `git push -u origin feat/context-bleed`；② 建 PR（标题
`feat(web): 上下文出血点——把「这次会话哪里烧钱」变成可执行的整改清单`），
**body 中必须如实披露 e2e 运行时层未验证及原因**；③ 提交已起草的 U+FFFD 门禁 Issue
（`/tmp/mojibake-issue.md`，**该文件在网络中断时未成功创建到仓库，需重新写**）。

**下一轮候选**（已记录的遗留）：
1. 出血点从 3 类扩到 7 类（设计师文档已给完 7 类规格；4 类是 `countOnly`）
2. `useBleedCounts` 从 `SessionAnalyzerPage.tsx` 挪到独立文件
3. `manifest.json` 加 sha256 内容指纹（让「图与代码同代」可校验，是 #196 最后一块）
4. U+FFFD 门禁 + 清 24 个文件的存量乱码

---

# 收口完成（2026-10-16 08:2x CST）

网络恢复（经代理 `127.0.0.1:56134`），下列全部落地：

| 项 | 结果 |
| --- | --- |
| PR #209 `feat(web): 上下文出血点` | **MERGED**（21/21 checks pass） |
| PR #210 `chore(release): 发布 v0.26.0-beta.1` | **MERGED**（21/21） |
| Issue #207（本轮功能） | CLOSED |
| Issue #196（截图清单硬编码） | CLOSED |
| Issue #208（U+FFFD 门禁） | 新建，OPEN |
| Tag `v0.26.0-beta.1` → Release | **success**，8 个产物（macOS ARM64/Intel + Windows NSIS），发布说明中文、无英文模板串泄漏 |

## 本机 e2e 不可判的问题——CI 替我回答了

我在本机跑不了的 `端到端测试` 在 CI 上 **pass（5m50s）**；`视觉基线一致性` 也
**pass**——后者正是能抓住「77 张 PNG 与代码不同代」的那道门，它绿了，独立印证了
我逐像素取证的结论（那 76 张 M 是 Round X 的预期视觉变化）。

## 收尾时挖出一个会拖死发布的缺陷（#210 一并修掉）

重写 CHANGELOG 后跑 `./scripts/extract-changelog-section.sh` **挂死**。查明是
**长期潜伏**的性能缺陷，不是本次引入：

`[[ -n "${var//[[:space:]]/}" ]]` —— bash 3.2（macOS 自带）做多字节全量替换是
**二次**复杂度。实测：3.8 KB→0.6 s、7.6 KB→4 s、15 KB→17 s、30 KB→114 s、
59 KB→十几分钟。

**后果**：`release.yml` 调用它的那一步**没有超时**，`set -euo pipefail` 下就是作业
挂死到 GitHub 6 小时上限——**发布永远产不出产物，且看不到任何失败**。ASCII 同尺寸
瞬间返回、夹具最大只有 487 字节 → 自测一直全绿，直到段落攒够才够到阈值。

**修法**：非空判定交给 `grep -q '[^[:space:]]'`（线性）。自测脚本里同款两处一并换掉。

**回归测试按「会失败」而非「会跑」设计**（这一点我走了弯路，见下）：
1. 夹具必须**跨过阈值**（13 KB 中文）
2. 每个用例**有时限**——macOS 没有 `timeout(1)`，用轮询实现 `run_bounded`；
   没有上界的话回归不表现为「失败」而表现为「CI 卡住」，排查要绕远路
3. 失败信息直接点出「疑似二次复杂度回归」，而不是只报「不匹配」

**变异验证**：改回旧写法 → 23 s 内退出并报 `✗ large-multibyte …（超过 20 秒上限）`，
9/1；改回新写法 → 10/0 且整份套件 **1 s**。

**真机证据**：CI 上该步骤实际耗时 **36 毫秒**
（`2026-10-16T00:16:49.2847268Z` → `…49.3207967Z`），对照旧代码外推的十几分钟。

### 我在这一步走的弯路（值得记）

我一开始把 16 KB 夹具的返回值误判为「挂死」，因为我在 6–12 秒就把它杀了。
真相是 **26 秒内会返回**——不是无穷，是二次。这直接导致我的**第一次变异验证
假通过**：测试绿了，我差点当成「检测器有效」。是坚持「变异必须真的把它变红」
才逼出了真相——测量取代假设。

另：`pkill -9 -f extract-changelog` 在自己的测量脚本里会**误杀**同一命令行的其它
进程，制造假绿。测量脚本要避免用宽泛的 pkill。

## 下一轮候选

1. 出血点从 3 类扩到 7 类（设计文档已给完 7 类规格；4 类只能 `countOnly`）
2. `useBleedCounts` 从 `SessionAnalyzerPage.tsx` 挪到独立文件
3. `manifest.json` 加 sha256 内容指纹（#196 最后一块）
4. **#208 U+FFFD 门禁 + 清 24 个文件存量乱码**
