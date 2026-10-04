# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Changed

- **版本徽章标出先行版**：版本号带 `-`（如 `0.10.0-beta.2`）时徽章显式加「Beta」标记并用警示色描边——装的是稳定版还是先行版应当一眼可辨，而不是让人去比对版本号里有没有 `-beta`。
- **令牌收尾**：新增微间距 `--sp-05` / `--sp-15`、行密度 `--row-pad-x` / `--row-pad-y` / `--row-pad-y-tight`、呼吸时长 `--dur-pulse`；把组件里的 2px / 3px / 6px 间距字面量统一收进 `--sp-05` / `--sp-15`（三张数据表的行内边距留给后续的 H3b 行密度令牌）；`--r-lg`（浮层专用）与 `--warning`（非确定信息）保留并补注释说明分工。
- **报告范围分段控件的项内边距与其余五处对齐**（8px → 12px），六处分段控件外观完全一致。


### Added
- **先行版 v0.11.0-beta.1（本轮主题）**：把分析结果带出应用——新增**会话导出**（自包含的单文件 HTML 报告，或给 Excel/脚本用的 CSV），并让**工具输出按终端原色渲染**（ANSI 转义、256 色与真彩色、回车覆盖写的进度行）。这一版先行版就是给这两条链路做真机验证的靶点；稳定版会在维护者试用后从它晋升。

- **终端输出按原色渲染**：`Bash` 这类工具的输出在 transcript 里是**带 ANSI 转义序列的原文**（`\u001b[31m` 红字、`\u001b[1m` 加粗、256 色与真彩色、用 `\r` 覆盖写的进度行）。此前这些字节被当普通文本打进 `<pre>`——用户看到的是 `[31m` 乱码，进度行读成 `10%55%100%`。现在工具输出与详情面板按转义语义渲染：16 个基本色走主题调色板（浅/深各一套，对白底与深底分别为 4.52–14.65 / 4.50–16.91），256 色与真彩色原样呈现，加粗 / 暗淡 / 斜体 / 下划线 / 删除线 / 反显各自成立，回车按终端的**覆盖**语义处理（`abcdef\rXY` → `XYcdef`，`10%\r50%\r100%` → `100%`），而 `\r\n` 仍按行尾处理——把它也当成回写会把整行静默清空。
  - **表格、剪贴板与导出仍是纯文本**：日志表摘要、「复制摘要」、CSV 与 HTML 报告一律剥掉转义序列——表格里带控制字符既占宽度又搜不到，粘进终端或表格软件就是乱码；Bash 结构化结果里的「stdout N 字符」也改为按可见字符计数（此前把转义字节也算进去了）。
  - **会话内容是不可信输入**：颜色值只在解析器里按白名单拼成 `var(--ansi-N)` 或 `rgb(r g b)`，正文里的任何字符串都不会进 `style` 属性；越界的真彩色分量直接丢弃而不是夹取（不发明一个终端没显示过的颜色）。
  - 真机门禁新增一条不变量：**任何视图渲染出来的文字里不得出现 ESC 控制字节**（探针的 `escaped_text == 0`）；夹具 `session-ansi.jsonl` 提供带颜色、进度回车与 OSC 标题的真实样本，端到端另有「日志表是纯文本」与「展开面板有颜色」两条断言。

- **导出会话报告与记录数据**：会话页头部新增「导出」——把一个会话导成**单文件 HTML 报告**或 **CSV**。浮层里选格式与范围（当前筛选结果 / 全部记录）、看清将导出多少条记录，然后「保存…」或「复制到剪贴板」。
  - **HTML 报告是门面资产**：自包含（零外链、零脚本、系统字体栈、内联字标），自带「由 CC Analyzer 生成 + 仓库地址」的落款；浅色/深色跟随系统，打印时自动去底色并重复表头；会话内容一律转义，报告里只出现项目目录名、不出现完整路径。
  - **CSV 给脚本与 Excel**：UTF-8 BOM（Windows Excel 打开中文不再乱码）、CRLF 行尾、最小引号、固定 13 列；以 `=` `+` `-` `@` 开头的摘要自动加前导单引号，避免表格软件把会话文本当公式执行（CWE-1236）；剪贴板那条路径不带 BOM——粘贴结果里多一个不可见字符会让脚本解析报错。
  - **两个范围导的是两批数据**：选「当前筛选结果」导出筛选命中的那批记录，选「全部记录」导出整会话，浮层读数与产物条数逐条对应（记录级计数；表格会把相邻的「用户+LLM」合并成一行，故条数可能略多于屏幕行数）；超过 2000 条时明示「仅导出前 2000 条」，不静默截断。
  - **真机门禁覆盖到浮层**：默认取图清单新增「导出 → 关闭导出窗口」两步，几何探针新增一条不变量——浮层必须存在、宽 ≤480px 且完整落在窗口内。顺带查明并记录：`WKWebView.createPDF`
    **不渲染 `position: fixed` 的浮层**（实测导出浮层与设置面板都不入图），所以浮层类视图的证据是几何探针，脚本会打印提示，别对着截图找浮层。
  - 浮层复用既有的浮层语言（`--r-lg` + `--shadow-md` + 遮罩），键盘可达：Esc 关闭并把焦点还给「导出」，Tab 在浮层内环绕，两个分段控件各占一次 Tab；浮层内的反馈就地呈现——浮层开着时 toast 会被遮罩压在下面，用户看不见。
- **遮罩令牌 `--overlay`**：两个浮层共用同一遮挡浓度，`SearchPalette` 里全仓唯一一处颜色字面量随之归零；深色下遮罩加深，浮层与背后的边界更清楚。

- **共享分段控件 `SegmentedControl`**：顶栏页面切换、侧栏列表视图、视图切换、报告范围、用量时间范围与 Token 类别六处此前各自手写一份逐字相同的 CSS；现在共用同一个组件（凹陷槽 + 抬起滑块），并补齐方向键导航（←/→/↑/↓/Home/End、环绕、跳过禁用项、自动激活）与 roving tabindex。一致性从「靠注释维系」变成编译期事实。
- **加载态统一为骨架 `Skeleton`**：侧栏首载的一列灰条、会话头未到达的读数位、主区解析期间的表格剪影，此前分别是「加载中…」「…」和一句百分比文案；现在共用同一个骨架原语（`--bg-hover` 圆角条 + 呼吸动画），系统开启「减弱动态效果」时静止但**可见**；主区的确定型进度百分比保留。

- **真机 GUI 测试现在会判定界面布局**：`./scripts/gui-test.sh` 在真机窗口尺寸下增加几何不变量断言——页面无横向溢出、计费表盘有界且含于卡片、记录表末列可达；每张真机截图都会打印实测数值，布局回归会**自动失败并指出是哪条不变量破了**，而不是等人在截图里用眼睛找。新增多视图取图（`CCA_GUI_CAPTURE_TAB` 支持逗号分隔的多个目标，默认覆盖 会话分析 → 用量总览 → 实时监控），取图仍走 WebKit 自渲染、不需要屏幕录制权限。面向贡献者：改了 CSS 跑一次 `./scripts/gui-test.sh --build` 即可拦住被撑爆的表盘、被裁切的列这类问题。

- **顶栏版本徽章**：应用名旁显示当前运行版本（点击复制「CC Analyzer vX.Y.Z」）。版本号取自 Rust 的 `package_info()`——编译进二进制的真实版本，不是前端常量，所以它不可能「显示新版本而实际还是旧的」；自动更新把应用换掉之后，顶栏数字随笔就变，是升级是否生效的第一眼证据。
- **复制 resume 命令**：会话详情头部新增按钮，一键复制 `cd "<项目目录>" && claude --resume <会话 ID>`——粘进终端就能接着聊，不用自己翻 UUID、也不用回忆那个会话在哪个目录。命令自带项目目录是因为 Claude Code 按目录组织会话，只带 ID 的命令从别的目录执行会「找不到会话」；老会话缺目录时降级为只带 ID 的命令，并在旁边明示需在项目目录下执行——降级是可见的，不静默给一条会失败的命令。会话缺少可用 ID 时按钮禁用并说明原因。命令只进剪贴板，应用不把它写进任何日志。


### Fixed

- **真机 GUI 门禁不再偶发「截图过、探针缺」的假红**：`./scripts/gui-test.sh` 的几何探针此前**拿「该视图的取图 PDF 已落盘」当开关**。默认视图是启动后第一张、最容易慢（正赶上应用最忙的时刻），一旦它的图比应用自己的等待上限更晚落盘，应用就把这份探针整个跳过——而脚本那边同一张图还在等、最终算作「截图通过」，于是表现为「只有默认视图探针缺失」的间歇性失败。`10s` 的应用等待对上脚本从启动算起更晚才开始的等待，中间本就存在一个「截图过、探针缺」的窗口。现在**探针不再拿 PDF 当开关**（等到就等快照对齐，等不到也照常取），并对求值瞬时失败做有限重试——重试只针对求值失败，布局回归仍会正常写出 JSON 并判失败，不会被吞掉。同时补上定位能力：应用侧每条取图 / 探针日志都带**文件名与相对时间**，脚本在探针缺失时打印**路径、最后修改时间、脚本等待时长与相关日志行**，直接区分「应用没写出来」与「脚本等太短」；`CCA_GUI_KEEP_WORK=1` 可保留整个现场（应用日志、PDF、探针 JSON）供事后归因。
- **用量总览的计费窗口表盘不再撑满整屏**：表盘此前会随窗口宽度等比放大成一个占满内容区的巨环（README 首图就是这个破损状态），把读数行、KPI 与趋势图都挤到首屏之外。现在表盘保持固定的圆形尺寸，读数紧挨着它排布，打开用量总览第一眼就能看到完整仪表盘。
- **记录表右端列不再被硬切**：日志表在窗口不够宽时，最右侧一列会被窗口边缘切掉，且静止时看不出「还能向右滚」。现在较宽的窗口下所有列完整可见；窗口较窄时，表格底部给出一条常驻、静止可见的横向滚动提示，最右列可以滚到。
- **会话标题清掉 IDE 注入的标签**：在 VS Code / JetBrains 里开的会话，首条消息前会带 `<ide_opened_file>` / `<ide_selection>` 提示，此前会被当成标题显示，列表里看到的是一整段标签而不是用户自己说的话。现在这些标签与命令标签、系统提醒一并清洗。



## [0.9.0] - 2026-10-02

本轮主题：双渠道自动更新——beta 全自动发版与稳定版人工晋升。

### Added

- **双渠道自动更新**：设置新增「软件更新」——可选稳定版（默认，维护者人工晋升）或 Beta（AI 每轮功能自动发版的先行渠道），支持「立即检查」与一键「安装并重启」。更新包经 minisign 签名校验；更新检查只是一次对 GitHub 发布页的 GET，不上传任何数据（SECURITY.md 有完整说明）。
- **发布流水线配套**：`vX.Y.Z-beta.N` tag 自动发布 prerelease 并刷新 beta 渠道更新源；新增 **Promote Stable** 工作流——维护者在 Actions 页面填一次 beta tag，即完成「全量门禁 → 版本收敛 → 稳定版发布 → stable 更新源刷新 → 版本同步 PR」。晋升出的稳定版代码与被试用的 beta 完全一致，不会夹带未验证提交。

## [0.8.0] - 2026-10-02

本轮主题：全局搜索命令面板——「上次那段对话在哪」从此一个 ⌘K 的事；跳转联动（搜得到即跳得到）是本轮验收命门。

### Added

- **全局搜索（⌘K / Ctrl+K 命令面板）**：跨全部项目、全部会话的消息级检索。顶栏搜索按钮或快捷键唤起居中面板，结果按 项目 → 会话 分组、命中词截窗展示片段与相对时间；↑↓ 选择、Enter 跳转——应用自动切回「会话分析」、打开目标会话、定位该记录并展开详情面板。竞品 CCHV 被骂得最多的是「搜得到、跳不过去」，本轮把跳转联动当验收命门。
  - 索引复用与用量总览共享的解析缓存（一个文件只解析一次），后台渐进构建、面板内显示「构建中 N / M」进度，纯内存不落盘——搜索历史不留痕。
  - 大小写不敏感子串匹配，v1 刻意不做模糊/拼音/正则：先解决「找不到」，再优化「找得快」。

## [0.7.0] - 2026-10-02

本轮主题：5 小时计费窗口仪表——竞品调研里订阅用户「每天看几十次」的信息，此前只能在应用外获得；CLI 竞品只能打印数字，这里做成真正的仪表盘。

### Added

- **5 小时计费窗口仪表**（「用量总览」页顶部）：当前窗口的消耗表盘、开启时刻与关闭倒计时、按消耗速度外推的限额到达时刻——竞品调研里订阅用户「每天看几十次」的信息，此前只能在应用外获得。窗口聚类与 ccusage 的 `blocks` 同口径（首条活动起算 5 小时，窗口关闭后的首条活动开新窗），纯本地推导、零网络。
  - **订阅计划感知**：设置里可选 Pro / Max 5× / Max 20× / Team / 自定义。限额是社区整理的估算值（明示非官方、标注整理时间）；**未选计划时只显示消耗、不显示百分比**——没有分母就没有比率，不猜。
  - **burn rate 预测给出具体时刻**（如「10-02 13:00」）而非抽象时长——monitor 用户抱怨最多的就是「只剩 2 小时」不知道是几点；窗口运行不足 30 分钟时明示「样本不足」，不外推。
  - provenance 徽章体系新增第四档「按消耗速度推算」：速率与预测不来自定价快照，此前复用「估算」徽章是词不达意，新档让每个数字继续说对自己的来源。

### Changed

- 「按模型分布」堆叠条的段填充改走图表规格的低饱和档（`-soft` 填充 + 各段实色细描边），悬停改往足额方向提亮——与柱状图的画法统一为同一语言。

## [0.6.0] - 2026-10-02

本轮主题：「通电」界面精修——UI/UX 专业评审的结论是「界面差最后一步：仪器还没通电」，本轮把刻度、读数、状态灯补齐，只加信息不加装饰。

### Added

- **会话首屏读数行**：总耗时 / 输入 / 缓存读取 / 输出 / 记录数五个读数，以 15px 等宽大数字并排在会话标题下方——此前这些「用户打开应用要回答的问题」以最小字号、最弱对比藏在 chip 里，Token 数字更是要点一下才看得见。读数行整体可点击，直接展开 Token 计数面板；原 chips 降级为次级元信息（项目、相对时间）。
- **时间轨道「通电」**：底部新增时间刻度轴（起止时刻 + 两个中间刻度），鼠标悬停显示 1px 准线与时刻气泡，拖选时实时显示选区起止与时长——「有网格无刻度、拉选不知选到哪」这两个盲区同时补上；轨道上的记录块从固定 8px 宽改为**按记录时长映射**（30 秒与 30 毫秒不再同宽，超长记录封顶 15% 防吞轨）；新增 Shift+←/→ 键盘微调选区终点。
- **三张数据表的行级键盘导航**：记录表 / 日志视图 / 耗时树支持 ↑↓ 移动焦点行、Home/End 跳首末、Enter/Space 选中——与鼠标点击走同一处理路径。键盘逻辑抽成共享 `useRowNavigation`，三处复用一套实现（同类画法复制三份迟早漂移）。焦点行复用选中态的竖条视觉，不新增装饰。

### Changed

- **会话状态灯语义化**：从「常亮绿点」改为三态——今天的会话绿色、含失败记录红色（优先于「今天」：坏了比新更该被看见）、更早的会话灰点；每个状态附带屏幕阅读器可读文案，不只靠颜色区分。
- **侧栏「刷新会话列表」从文字按钮改为图标按钮**：刷新是低频动作，不再挤压搜索框宽度；可访问名保留全称。

## [0.5.0] - 2026-10-02

本轮主题：用量总览仪表盘——竞品调研显示成本与趋势是所有同类工具的标配而本项目两者皆无，本轮补上这块最大的功能空白，并以「来源徽章」把估算的诚实度做成设计语言。

### Added

- **第三个标签页「用量总览」**：回答订阅用户每天都要问、此前只能在应用外回答的问题——最近 7 / 30 / 90 天烧了多少 token、都花在哪些项目和模型上、什么时段最活跃。一页给出 KPI 读数行（Tokens 总量 / 会话数 / 消息数 / 估算成本）、按天趋势柱状图（四类 token 计数可切换）、按项目与按模型分布、7×24 活跃时段热力图。图表全部手绘 SVG——零新增运行时依赖，聚合在本机渐进完成，数百会话下也是已分析的部分先呈现（「已分析 37 / 128 个会话」），二次进入命中解析缓存即时出图。
- **仪表盘上每个数字都带来源徽章**（读自日志 / 按定价快照估算 + 快照日期）。头部竞品被用户骂得最多的恰恰是「数字不准」，所以「估算非账单」在这里被做成设计语言而不是角落里的小字免责声明：tokens、会话、消息数标「读自日志」，估算成本标「按定价快照估算」并明示快照日期。成本按内嵌的离线定价快照逐模型计价（升级即整表替换，应用永不联网取价）；遇到快照未收录的模型，读数旁直接写「部分会话未知价」并给出未计入的量，绝不静默按 0 计。

## [0.4.0] - 2026-10-01

本轮主题：让既有功能真正可靠——claude CLI 探测覆盖各 Node 版本管理器且必须可执行才算可用、实时监控改为显式打开、详情面板与复制交互补齐反馈；真机 GUI 测试升级为窗口内截图校验，发布说明全面中文化。

### Added

- 真机 GUI 测试现在**截取应用自己的窗口**，不再把截图记为「已跳过」。它不再需要 macOS 的「屏幕录制」权限，因为它根本不读屏幕：`WKWebView.createPDF` 是**让 WebKit 渲染它正在显示的那一页**，全程不经过窗口服务器。该能力挂在 `gui-capture` 这个 Cargo feature 后面，**发布构建不启用**，由 `scripts/gui-test.sh` 驱动。截图的判定是「有没有内容」而不是「文件在不在」——macOS 在真的拒绝读屏时会返回一张尺寸正确、像素全透明的位图，所以「文件出现没有」这种检查在一张透明 PNG 上照样通过。测试改为统计不同颜色的数量：空白截图过不了，真实界面能过。
- `./scripts/build-macos.sh --help` 现在打印用法并以 0 退出。此前它会落到「未知架构」分支并报「不支持的架构：--help」，读起来像是你传了一个架构进去。
- 发布说明的**中文化转换**：新增 `scripts/format-release-notes.sh` 与仓库级 `.github/release.yml`。GitHub 原生变更清单自带的英文模板串（`What's Changed`、`New Contributors`、`Full Changelog`、`by @user in …`）在拼装发布说明时被转成中文，`### ` 那一层的分类标题则由 `.github/release.yml` 直接配成中文——配置能解决的就不靠后处理去猜，猜错是静默的。`.github/workflows/ci.yml` 增加 `release-notes-test` 任务，用夹具逐字比对转换结果，并验证幂等与空输入降级；转换逻辑若只写在 `release.yml` 的 `run:` 里，唯一的验证方式就只剩「发一次版，用人眼看」。

### Changed

- `./scripts/lint.sh` 现在**拒绝任何参数**，不再默默忽略。它不接受任何选项，所以在此之前 `./scripts/lint.sh --help`（或任何打错的旗标）会一声不吭地把整套检查跑完，看起来像参数被接受了。它仍然没有 `--help`：一页只写着「跑所有检查」的说明是凑数，而拒绝一个参数是实话。
- macOS 构建包装脚本（`build-arm64-macos.sh`、`build-intel-macos.sh`）现在**拒绝架构参数**，不再丢弃它。`build-arm64-macos.sh x86_64` 以前会构建出 aarch64 产物，而调用者以为生效的是 Intel。它们的 `--help` 转发给 `build-macos.sh` 并附一行说明自己的预设，帮助文本因此只有一个来源，不会漂移。
- `./scripts/gui-test.sh --help` 打印一段 19 行的用法摘要，不再把整整 42 行头部注释连同 `#` 前缀一起倒出来。提取方式不再依赖行号——那正是早先那一版不再显示用法段的原因。
- **`CHANGELOG.md` 的条目改用中文书写。** 发布说明会把 CHANGELOG 中该版本的段落**原样**拼进去，所以 CHANGELOG 的正文就是发布说明的正文——写英文等于发一版英文说明。规则与边界（历史条目不回改）见 `.trellis/spec/guides/release-notes.md`，`AGENTS.md` 与 `docs/MAINTAINER_GUIDE.md` 只做引用。

- **实时监控改为显式打开**：切到「实时监控」标签页不再探测、不再内嵌 iframe，点「打开监控」才开始连接；连上后工具栏提供「关闭监控」，可回到未打开状态。此前是挂载即探测，而那个仪表盘服务不在本仓库内、多数人根本没在跑它——每次切标签都要先白等近两秒的失败重试。
- **用户可见文案里不再出现外部仪表盘的产品名**。失败提示过去会写到「可能被旧 cc-monitor 占用」——那既是别人家服务的名字（本项目叫 CC Analyzer），也是在猜一个我们并不知道的原因。现在只陈述事实：探测了哪个地址、试了几次、该服务不在本仓库内需另行启动。`README`（中英）、`docs/USAGE.md`、`docs/TROUBLESHOOTING.md`、`docs/LOCAL_DEVELOPMENT.md` 与 `docs/ARCHITECTURE.md` 同步更新。

### Fixed

- **装好了 `claude` CLI 却报「未找到」**。两个原因叠在一起：候选安装位置表只列了 `~/.claude/local`、`/opt/homebrew/bin` 这类固定路径，**不含任何 Node 版本管理器**（nvm、volta、fnm、asdf、mise、pnpm、yarn），所以找不到；更要紧的是解析出来的路径**只被拼进错误文案**，真正执行时仍然硬编码 `claude`——PATH 里没有就照样启动失败，改文案并不能修好它。现在候选表覆盖各版本管理器的 shim 与**按版本号分目录**的安装（后者靠枚举目录，而不是猜版本号），解析出的命令会真的交给执行侧，且探测与执行用的是同一条命令。若 CLI 在磁盘上但跑不起来，报的是「找到了却无法执行」（并带出每个候选的失败原因），不再是「没找到」。
  - 候选里「存在」与「能跑」是两件事，把它们混为一谈正是这个缺陷的另一半：版本管理器装的 `claude` 常是 shebang 为 `#!/usr/bin/env node` 的脚本，而窄 PATH 下找不到 `node` 时**进程照样启动、只是退出码 127**——既没有「启动失败」的字样，又确实跑不起来。现在绝对路径候选必须 `--help` 退出码为 0 才算可用，跑不通就继续试下一个，不会再把一个已死的安装当成 ready 交给执行侧、等到生成报告时才失败。
  - 版本目录（`~/.nvm/versions/node/*` 这类）改为**按版本号新→旧排序**后依次尝试。此前顺序由文件系统的枚举顺序决定，同一套候选在不同机器上可能挑中不同的版本——而用户看到的行为差异会归因到别处。

- **右侧「记录详情」面板无法收起**：面板头部新增关闭按钮（可访问名「收起详情」），收起后能重新选中记录再打开，选中状态不受影响。
- **复制按钮没有任何反馈**：复制成功与失败现在都会给出提示（复用应用既有的通知机制）；失败时另外保留一条就地可见的错误，后者不会被三秒后消失的 toast 带走。
- **「复制摘要」复制不到任何数据**：按钮过去复制的是 `record.text`，而它**可以合法为空串**（只有工具结果、没有文本的记录就是如此），写进剪贴板等于什么都没复制，还一声不吭。现在摘要按「最能代表这条记录的一段文本」取值——文本非空时原样取用，为空则回退到工具调用、工具输出、结构化结果或 Workflow 摘要；确实取不到内容时按钮置灰并说明原因，绝不静默写空串。

## [0.3.0] - 2026-10-01

本轮主题：工程化与体验升级——接入 Trellis 工程框架、建立三层测试网、界面按「仪器面板」重做、新增 Token 计数面板。

### Added

- A **Trellis engineering framework** integration ([mindfold-ai/Trellis](https://github.com/mindfold-ai/Trellis)) under `.trellis/`, so specs are split by layer instead of living in one monolith, planning is written to files instead of scrolling out of a conversation, and work state carries across sessions via a SessionStart hook. Trellis is AGPL-3.0 and this project is MIT: `NOTICE` states per-path which files come from its templates, records that **no Trellis code is compiled into any released artifact**, and gives the removal path. The hooks it installs (which run on every session) are reviewed and documented in `SECURITY.md` — they make no network requests. Trellis's own generic thinking guides were removed from `.trellis/spec/` because their examples are about Trellis's codebase, not this one.
- `scripts/lint.sh` now also checks **Python syntax in the auto-executed hooks** and the validity of `.claude/settings.json`. A syntax error in either fails silently — the hook prints one line to stderr and the session simply loses its injected context, while the developer believes the rules still apply.

- A **real-app GUI smoke test** (`./scripts/gui-test.sh`). It launches the packaged `.app` — not a simulation — and verifies the whole chain actually runs by asserting that the app **scans the session files and writes its metadata cache**, which requires webview → React → bridge → Rust → filesystem → parse → write to all have worked. It runs against an isolated `HOME`, so a test run never touches the real `~/.claude` session data. Window screenshots additionally need macOS's Screen Recording permission, which only the user can grant; without it the script reports the screenshot as *skipped* with instructions rather than passing quietly.
- An **end-to-end test suite** (Playwright) that drives the real production bundle in a real browser. It stubs the Tauri bridge at the boundary the app actually calls — `window.__TAURI_INTERNALS__` — so no application code is test-aware and no stub ships in a release. It found the group-toggle click bug above on its first run. It runs in CI as the `web-e2e` job, which uploads screenshots, video and traces when it fails.
- A **token panel** on the session page, opened from a chip beside 总耗时 in the session header. It reports the four counters Claude Code writes to every transcript — `input_tokens`, `cache_creation_input_tokens` (split into its 5-minute and 1-hour TTL tiers), `cache_read_input_tokens` and `output_tokens` — as four rows that are **never summed into one figure**, each labelled with the log field it was read from and its share of the session total. A single total would say nothing: across real sessions cache reads run an order of magnitude above input tokens, so one merged "input" number hides which of the two a session actually spent. The panel states **no cost** — this app ships no price table, and the routed third-party models these sessions run on have no authoritative offline price — and says so ("成本未知 · 未收录该模型定价") rather than printing a figure it cannot stand behind.

### Changed

- **The interface was rebuilt around a single design intent**, chosen after the previous layout was written off as "functional but without a point of view". The direction is an *instrument panel*: colour appears only on data, the chrome is monochrome, and there is exactly one accent used for focus rings, links and selection — under 3% of pixels. Category colours (the existing Okabe-Ito, colour-blind-safe palette) are now the loudest thing on screen because nothing decorative competes with them. Depth comes from background steps and hairline borders rather than shadows, which is also why the two themes finally share one visual vocabulary instead of two.
- The shell is now a **fixed-height app frame** (`100dvh` + internal scrolling) instead of a page that grew with its content. That removed `web/src/lib/useViewportCap.ts` entirely — a hook that measured the viewport in JavaScript to cap a pane's height, a workaround for the layout being content-driven. The log table now scrolls inside its own pane, which is also what the new end-to-end assertion checks.
- The empty state is a centred brand mark, headline and a concrete next step ("pick a session on the left, or filter by ID/directory in the search box") instead of a large dashed rectangle that mostly announced its own emptiness.
- The top bar gained a brand mark and wordmark, a segmented control for the workspace switch, and icon buttons for settings and theme; session and group headers gained contrast and a sticky group header so the grouping survives long scrolls.
- New shared tokens for motion (`--dur-*`, `--ease-*`) replace the single `--transition`, so timing is a decision rather than a default; `--on-accent` was removed as it had no consumers.

### Fixed

- `./scripts/build-macos.sh` printed a bash error instead of its usage message when given an unsupported architecture. The message was written as `"$ARCH（请用…）"` — a variable expansion immediately followed by a full-width character. macOS's own bash 3.2 swallows the first byte of that character into the variable name, so `set -u` aborts with `ARCH?: unbound variable` and the intended guidance never prints (the exit code was 1 instead of the designed 2). bash 4+ and CI's bash 5 parse it fine, so this only ever surfaced locally. Both instances in the tree are fixed with braces (`"${ARCH}（…）"`), and `scripts/lint.sh` now rejects the pattern so it cannot return silently.
- The log table's token column was headed **输入 / 输出 tok** while its first number was `input_tokens + cache_creation + cache_read`. On a cached session that sum is mostly cache reads, so the column showed the largest number in the session under the name of one of the smallest counters in it — and the record detail panel, reading the same value, printed a different "输入" for the same record. The column now reads **提示词(含缓存) / 输出 tok**, with a hover breakdown naming the three counters it adds up; the field behind it was renamed from `input` to `prompt` so the next consumer cannot re-apply the old label. The exported report table carries the same corrected heading.
- Clicking the first session of a group collapsed the group instead of selecting that session. `SessionList.module.css` carried an unscoped `.groups button` rule that also matched the group collapse toggle; being more specific than `.groupToggle`, it silently overrode the toggle's `display: flex`. The toggle then laid out as a vertical grid, overran its fixed 38px row by 40px, and its count badge came to rest on top of the first session — where it absorbed the click. Found by the new end-to-end suite, which could not click the session for the same reason a user could not. The session-button rules are now scoped to the session rows, so adding another button under `.groups` cannot bring this back.

## [0.2.2] - 2026-09-30

本轮主题：修正发布产物的文件名——本地产物、文档与用户下载到的三处名字此前互不一致。

### Fixed

- Release artifact names now use hyphens (`CC-Analyzer_<version>_<arch>.dmg`, `CC-Analyzer_<version>_x64-setup.exe`) instead of the product name's spaces. Tauri names files after `productName` ("CC Analyzer"), and **GitHub replaces spaces with dots when publishing a release** — so the local build, the documentation, and the file users actually downloaded were three different names. The packaging scripts and the release workflow now normalise to hyphens.
- Fixed the release pipeline failing on Windows for two separate reasons, both of which only surface there: the build steps used bash syntax while the Windows runner defaults to PowerShell, and `build-windows.ps1` carried non-ASCII comments without a UTF-8 BOM, which PowerShell 5.1 mis-decodes into `Missing closing '}' in statement block`. `scripts/lint.sh` now rejects a non-ASCII `.ps1` that lacks a BOM, so the second one cannot come back silently.

## [0.2.1] - 2026-09-30

本轮主题：打包与项目身份统一——三平台改走 Tauri 官方打包流程，Windows 增加 NSIS 安装程序，版权署名与维护者名单规范化。

### Added

- Windows releases now include an **NSIS installer** (`CC-Analyzer_<version>_x64-setup.exe`) next to the portable zip. It installs into the user profile with a Start menu entry and an uninstaller, and needs no administrator rights.
- The project-root `package.json` supplies the build toolchain (`@tauri-apps/cli`, pinned by `package-lock.json`) with `npm run build:macos*` / `build:windows` entries, so packaging no longer relies on a globally installed CLI.

### Changed

- All three platforms now build through Tauri's official bundler (`tauri build`), which makes `identifier`, `copyright`, `publisher` and installer shape a single source of truth in `src-tauri/tauri.conf.json`. Two things follow for users: the macOS dmg now carries an `Applications` shortcut, and the copyright field is populated in the bundles themselves (`NSHumanReadableCopyright` on macOS, the installer's version info on Windows).
- Copyright now reads **Copyright 2026 CC Analyzer** rather than individual names — in `LICENSE`, `NOTICE`, and the packaged bundles. Maintaining a project-name copyright keeps the attribution stable as maintainers change; the people responsible are listed separately in `MAINTAINERS.md`, `src-tauri/Cargo.toml`, `web/package.json` and `.github/CODEOWNERS`.
- The macOS bundle identifier changed from `com.flydiy.cc-analyzer` to `io.github.liang-zhenxiang.cc-analyzer` — derived from the project's GitHub identity instead of a domain the project does not own. App data (metadata cache, thresholds, theme) lives under the new identifier's application-support directory; an existing 0.2.0 install keeps its data under the old directory, so the new build recreates titles and settings on first launch.

### Removed

- The `packaging/` directory is gone. It held a hand-written `Info.plist` and a copy of the app icon, both only needed by the old hand-rolled bundler. Tauri now generates the plist from `tauri.conf.json` (verified key-for-key, plus `NSHumanReadableCopyright`) and reads the icon from `src-tauri/icons/`, whose `icon.icns` was byte-identical to the copy. This also drops the version file that had to be kept in sync by hand: releases now bump three places instead of four.

## [0.2.0] - 2026-09-30

本轮主题：开源规范基建——CI 门禁、治理文件、自动化工作流、发布流水线与文档体系全部落地，并包含此前积累的全部功能改动；发布前把前端工具链升到当前主版本，清空依赖审计告警。

### Added

- Open-source infrastructure: a four-layer CI (static checks, build & test, commit conventions, workflow security scanning) with a single `CI 总览` summary check, plus automated workflows for PR labeling, first-contributor welcome, stale cleanup, OSSF Scorecard scoring, and tag-triggered releases that build and attach macOS (ARM64/Intel) and Windows artifacts with three-part release notes.
- Project governance and documentation: YAML-form issue templates, CODEOWNERS, SUPPORT.md, a threat model in SECURITY.md, and the docs set (USAGE, ARCHITECTURE, TROUBLESHOOTING, MAINTAINER_GUIDE) alongside a restructured bilingual README.
- `./scripts/lint.sh` as the single local entry point for every static check CI runs, and `./scripts/check-commit-msg.sh` for Conventional Commits validation (also enforced in CI for PR commits and titles).
- Rebuilt the frontend as a maintainable React, TypeScript, and Vite project under `web/`.
- Added Vitest and React Testing Library coverage for JSONL parsing, duration aggregation, filtering, reports, and UI workflows.
- Added Apple Silicon macOS and Windows portable packaging support.
- Added session metadata extraction and an isolated v2 metadata cache for the React UI.
- Added recursive Agent and Workflow session graph resolution with graph-backed durations and record details.
- Added a duration tree view with a persisted log/tree switch, per-node drill-in, and node-scoped report generation.
- Added a merged log view with token/error columns, structured-result panels, and two-way locating between the log and tree views.
- Added structured report prompts (overview, buckets, slow tools, errors, subagents, workflows, parallelism, file map, evidence) with truncation budgets, node-scoped analysis, and cancellable runs backed by a new `cancel_lines` command.
- Reports now render as Markdown via `react-markdown` + `remark-gfm` (tables, code fences, lists), with raw HTML left inert and links opened as `target="_blank" rel="noreferrer"`.
- The session list shows title-completion progress, remembers the timeline/project choice, and collapses project groups.
- The realtime monitor page retries the local dashboard three times, keeps the iframe theme in sync via `postMessage`, and enters float mode when the dashboard asks for it.
- Float mode can be left again: the `float` plugin gained an `exit` command (`plugin:float|exit`, backed by the new `float:allow-exit` permission) and the top bar shows an 退出浮窗 button while the window is floating.
- Large sessions stay responsive: the log table windows past 120 rows, parsed child sessions are cached by mtime/size, parsing yields to the event loop every 2000 lines, and the report detail table is capped at 400 rows.

### Changed

- The project ships as **CC Analyzer** (`cc-analyzer`): the Tauri product name and bundle identifier (`com.flydiy.cc-analyzer`), the Rust crate/lib (`cc-analyzer` / `cc_analyzer`), the npm package names (`cc-analyzer`, `cc-analyzer-web`), the packaging artifact names, the top-bar title, and the frontend `localStorage` keys (`cca-*`) all use it.
- The macOS bundle identifier is `com.flydiy.cc-analyzer`; app data (metadata cache, thresholds, theme) is stored under that identifier's application-support directory.
- Enhanced JSONL parsing to preserve system turn durations, sidechains, assistant block aggregation, structured tool results, skipped events, and parser warnings.
- Corrected duration breakdown to union local tool intervals, account for inter-turn gaps, prefer child-session and workflow time ranges, and clip intervals to the selected window.
- Changed Tauri production assets to `web/dist/`.
- Packaging scripts now build the web frontend before compiling Rust.
- Added a `cancel_lines` Tauri command that kills a running `run_lines` child process when the user stops a report.
- Expanded contributor workflow and Pull Request guidance.
- Session titles are now scanned incrementally from JSONL heads and stored in `meta-cache-v2.json`.
- Subagent discovery now uses the session's own directory (`<project>/<sessionId>/subagents`), matching Claude Code's real layout; the parent directory is still scanned as a fallback.
- Log rows now follow one row model: inter-turn waits become `等用户` gap rows, a model response that started exactly one tool folds into an `LLM+工具` row, and model rows show the gap since the previous activity.
- The log view gained 占比 and waterfall columns (scaled to the selected time range), duration colouring by magnitude, and single-line rows with ellipsis.
- Log filtering now works on rows: row kinds (用户/LLM/工具/Agent/workflow/等用户), 成功/失败 status, 高于/低于/区间 duration comparison, and free-text search over command, path and summary.
- Added a session header (标题 · 总耗时 · 项目 · 相对时间 · 打开位置), relative time / size / project metadata in the session list, and 今天/昨天/本周/本月/更早 date grouping with collapsible sections.
- Report prompts now follow a fixed skeleton (角色 / 口径 / 输出格式 / 质量硬约束 / 待分析数据), add a 筛选后分布 table and a three-part 文件地图 (主文件, 子 agent 文件, 深挖线索), cap the record table at the slowest 300 rows, and the report panel shows that cap plus an 打开 claude 终端继续追问 action.
- The tree view gained a 仅分析所选时间块 toggle, a node detail panel, and a 用 claude 分析此子agent action that analyses the child session itself.
- Float mode now relaxes the window's minimum size while floating and restores it on exit, so the 420×620 float window is not clamped by the normal 960×640 minimum on platforms that enforce it for programmatic resizes.
- The monitor page only accepts `enter-float` messages from the loopback dashboard origin on the probed port, so a foreign origin can no longer switch the window into float mode.
- Report generation now hard-probes the `claude` CLI first: when the process cannot be started (typically a narrowed GUI PATH), the error names the install locations that exist on disk and how to fix the PATH instead of failing midway through a run.
- The hard-coded report/parse/log budgets (prompt size, detail rows, slow tools, subagents, parse chunk, log window) are now a persisted setting, editable from the new 设置 panel in the top bar.
- Report code fences are syntax highlighted via `rehype-highlight` (raw HTML stays inert), using app-palette token colours that follow the light/dark theme.
- The session list renders only the visible rows of a long list (group headers and session rows are height-aware), and the sidebar is capped to the viewport so the list scrolls inside it instead of stretching the page.
- The record table used by the detail panel (including the embedded child-session and workflow-agent previews) windows its rows too, measuring real row heights and falling back to the running average for rows that have not been rendered yet.
- Session groups are now ordered explicitly (newest session first, groups ordered by their newest member) and collapsed-group keys of projects or date buckets that no longer exist are pruned from storage.
- Child-session paths taken from a session file are now scoped to the session tree before the app reads them, so a crafted JSONL cannot make it read arbitrary files.
- Session list rows keep every line on one line with an ellipsis and gained more padding, so long project slugs no longer wrap into the clipped part of the fixed-height row.
- Fixed the report panel's generate button rendering as an empty white box: a header rule forced its background to the elevated colour while the primary variant kept white text.
- The analyzer workspace sizes its rows from the blocks it renders (each pane carries its own minimum) instead of a fixed grid template, and both the log table and the tree are capped to the viewport so they scroll internally rather than stretching the page.
- Transcript payloads are serialised with a helper that survives bigints, repeated references and unserialisable values, so a hostile `record.raw` can no longer blank a panel; non-finite `durationMs` values no longer swallow a whole window.
- The log table windows on measured row heights instead of a 31px guess (real rows measure 39px, so the scrollbar and scroll offsets were off by thousands of pixels), counts an expanded panel's real height, and caps itself to the viewport so the windowed rows can actually be scrolled to.
- Frontend toolchain upgraded: Vite 8, Vitest 5, `@vitejs/plugin-react` 6, and jsdom 30. `web/vite.config.ts` now takes `defineConfig` from `vitest/config`, uses the function form of `manualChunks` (the object shorthand was removed with the Rollup upgrade), and one virtual-list assertion no longer depends on the whitespace behaviour the older jsdom inserted between inline elements.
- TypeScript moved from 5.9 to 7.0 in `web/`; `tsc -b` and the Vite build pass unchanged.

### Security

- `npm audit` is back to zero known vulnerabilities. The advisories covering the Vite dev server and the Vitest UI (1 critical, 1 high, 3 moderate) are only patched in Vite 8 / Vitest 5, so the frontend toolchain had to move majors to clear them.

### Notes

- Desktop development still starts with `cargo run --manifest-path src-tauri/Cargo.toml`.
- Frontend changes must be built into `web/dist/` before launching the packaged/debug desktop app unless using a separately configured dev server.
- Report generation uses the local `claude` CLI.
- The realtime monitor tab depends on an external dashboard at `localhost:8090`; that service is not included in this repository.
- The React UI reads only `meta-cache-v2.json`; it does not migrate or overwrite the earlier `meta-cache.json`. The first launch rescans missing titles, then reuses entries with matching file size and modification time.

## [0.1.4] - 2026-09-20

### Added

- Intel macOS x86_64 application bundle and DMG packaging.
- Tauri 2 backend with the Rust command layer the web UI calls.
- Local packaging script for reproducing the macOS bundle.
