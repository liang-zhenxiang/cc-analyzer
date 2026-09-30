# 测试踩坑记录

> 每条都是**真实发生过的**：附现象、根因、修法与防复发手段。
> 新增踩坑时往下追加，不要把旧条目删掉——它们的价值就在于「下次别再犯」。
>
> 判断一条坑值不值得记：**它会不会换个地方再来一次？** 会，就记。

---

## 1. 测试抓到的真实缺陷：CSS 特异性压过了组件自己的样式

**现象**：端到端用例「选中会话后日志视图与树视图都能渲染」卡在点击上超时。
Playwright 报 `<span class="_groupCount_">` **拦截了指针事件**。

**为什么不是测试写错了**：用 `elementFromPoint` 直接验证过——在会话按钮的
**几何中心**取点，返回的确实是一个不属于该按钮的 `span`。

**根因**：`SessionList.module.css` 里那条会话按钮样式写成了不分对象的
`.groups button`（特异性 `0,1,1`），位置又在 `.groupToggle`（`0,1,0`）之后，
于是**静默覆盖**了折叠按钮自己的 `display: flex`。连锁反应：

1. 折叠按钮变成纵向网格，`▼`、分组名、计数被拆成三行，高度从 22px 涨到 78px
2. 它所在的 `.groupRow` 只有 38px，超出部分**溢出到下面第一条会话上**
3. 计数徽标正落在第一条会话按钮内部，而它属于折叠按钮——
   **点击被接走，触发的是分组折叠**

**修法**：把会话按钮的规则**收窄到会话行**（`.sessionRow` / `.sessionRowWithStatus`），
而不是给 `.groupToggle` 补特异性和它对抗。根因不在折叠按钮上——
`.groups button` 本来就是照着会话按钮写的，只是顺手把所有按钮都选了进去。
收窄之后，往 `.groups` 里再加按钮不会再重蹈覆辙。

**防复发**：
- 写后代选择器时问一句「这个选择器还会命中谁」
- **改 CSS 后跑端到端**。这类缺陷单元测试永远抓不到——jsdom 不做布局，
  `elementFromPoint` 也没有意义

---

## 2. bash 3.2：变量展开紧邻全角字符会解析错

**现象**：`./scripts/build-macos.sh bogus` 打印
`line 30: ARCH?: unbound variable` 并以 1 退出——而不是它设计好的
「不支持的架构：bogus（请用 x86_64 或 aarch64）」和退出码 2。

**根因**：那行写的是 `"$ARCH（请用…）"`，变量名后面**紧挨着一个全角字符**。
macOS 自带 bash 3.2 会把该多字节字符的首字节吞进变量名，于是去找一个叫
「ARCH + 半个汉字」的变量，`set -u` 下当场中止。

**bash 4+ 与 CI 的 bash 5 都不会这样解析**——所以它**只在本地 macOS 暴露**，
最容易在「本地随便跑一下就过去了」的时候漏掉。

**修法**：加花括号消歧，`"${ARCH}（…）"`。

**防复发**：`scripts/lint.sh` 第 8 项会扫出所有 `$VAR` 紧跟非 ASCII 字符的写法。
该检查**跳过整行注释**——因为说明这条规则本身就需要能写出反例。

> 这是本项目第三个「本地 / CI 表现不一致」的坑。前两个是 Windows runner 的
> 默认 shell 是 PowerShell、以及 `.ps1` 缺 UTF-8 BOM。共同教训是：
> **判据不是「本地跑通了吗」，而是「这个差异只在某个环境成立吗」。**

---

## 3. Playwright 的用例会被 vitest 捡去跑

**现象**：新增 `web/e2e/*.spec.ts` 后，`npm test` 开始报一堆看不懂的错。

**根因**：Vitest 默认的 `include` 是 `**/*.{test,spec}.?(c|m)[jt]s?(x)`，
而 Playwright 的用例也叫 `.spec.ts`。它们需要真实浏览器和一个跑着的预览服务器，
在 jsdom 里只会以一种与真实原因毫无关系的方式失败。

**修法**：在 `web/vite.config.ts` 里显式收窄：

```ts
test: { include: ["src/**/*.test.{ts,tsx}"] }
```

**防复发**：两套测试用同名后缀是业界惯例，冲突是必然的——
**靠显式收窄，不要靠默认值**。

---

## 4. 新增的测试目录不在类型检查范围内

**现象**：`e2e/` 与 `playwright.config.ts` 编译不过也**不会报错**，
因为 `tsconfig.json` 的 `include` 只有 `["src", "vitest.setup.ts", "vite.config.ts"]`。

**修法**：把 `e2e` 与 `playwright.config.ts` 纳入 `include`。

**连带影响**：e2e 文件要用 `node:fs` / `process.env`，于是要装 `@types/node`。
装之前先确认它不会污染应用代码——本项目应用侧用的是 `window.setTimeout`，
所以不会有 `NodeJS.Timeout` 那类问题。**换一个项目就要重新确认这一点。**

---

## 5. 手写的类型 stub 会遮蔽真实类型

**现象**：装了 `@types/node` 之后，`playwright.config.ts` 里的 `process.env`
仍然报 `Property 'env' does not exist on type '{ cwd(): string }'`。

**根因**：`web/src/node.d.ts` 手写了三个最小声明——`node:fs` 的 `readFileSync`、
`node:path` 的 `resolve`、以及 `declare const process: { cwd(): string }`。
**它把真的 `process` 类型盖掉了。**

**关键判断**：这个文件**全仓无人引用**。它是早期为了让某处能编译过而留下的，
后来用途消失但文件没删。

**修法**：直接删掉。

**防复发**：类型 stub 是「临时的」里最容易变成永久的。加了 stub 就在旁边
写清楚为什么需要它、什么时候可以删。

---

## 6. 选择器写宽了，断言会「看起来像功能坏了」

**现象**：断言「列表里有 5 条会话」，实际拿到 **6** 个元素。

**根因**：用的是 `button:has(strong)`。会话条目里有 `<strong>`（标题），
**分组折叠按钮里也有**（分组名）。于是把折叠按钮一起算进来了。

**修法**：改用 `button[title]`——会话条目带 `title={cwd ?? path}`，
这是给用户看的路径提示，语义正好，也不会误伤。

**教训**：断言失败时，**先怀疑选择器，再怀疑功能**。这次幸亏多看了一眼截图
（截图里清清楚楚是 5 条会话），否则很容易去「修」一个不存在的缺陷。

---

## 7. macOS 不让脚本自己截图

**现象**：`screencapture -x out.png` 报 `could not create image from display`，
退出码 1。所有变体（`-D 1`、`-m`、`-R`）都一样。

**根因**：不是没有显示器——`launchctl managername` 是 `Aqua`，
`who` 显示用户已登录控制台，`system_profiler` 也报了一块内置屏。
真正的原因是 **macOS 的屏幕录制权限（TCC）**：截取屏幕内容需要使用者
在「系统设置 → 隐私与安全性 → 屏幕录制」里手动勾选对应终端，
**这是安全边界，脚本无法自行申请**。

**修法（设计上的取舍，不是绕过）**：
- 真机 GUI 测试把截图当作**尽力而为**：拿不到就记为**跳过**（不计入通过），
  并打印开启方式——**不能悄悄算通过**
- 界面视觉验证走 Playwright 的截图，它截的是 Chromium 渲染结果，
  **不需要任何系统权限**，也能进 CI
- 真机那一层改为断言「应用真的跑通了链路」（见 `gui-tests.md`），
  这类证据不需要权限，而且比一张截图更硬

**防复发**：遇到「平台不允许自动化」时，**不要去找绕过安全边界的方法**，
而是重新问「我到底想验证什么」，换一种能被允许的证据。

> **补记（实测，别再试一遍）**：「进程总该能截自己的窗口吧」这个直觉**是错的**。
> 用 `dlsym` 在运行时取 `CGWindowListCreateImage`、对一个在完整 `NSApp.run()`
> 循环里绘制好的自家窗口截图，拿到的是**尺寸正确、像素全透明**（`rgba(0,0,0,0)`）的图。
> 危险之处在于它**不报错**——`if image != nil` 会通过，然后产出一张空白 PNG。
> macOS 缺权限时给的是「一个窗口形状的洞」，不是错误。
>
> **正确的出路在 2026-10-01 找到了**：不要「读屏幕」，改让 **WebKit 渲染它自己**。
> `WKWebView.createPDF` 走的是渲染管线而非截屏通道，因此完全不受 TCC 限制。
> 应用侧只需暴露一个 `gui-capture` feature（发布构建不启用），
> 由 `scripts/gui-test.sh` 驱动取图。实测产出的是真实窗口内容。
> 详见 [`gui-tests.md`](./gui-tests.md)。

---

## 8. 用 `open` 启动 .app 传不进环境变量

**现象**：想让真机测试用隔离的 `HOME`，于是 `HOME=/tmp/x open -a App.app`——
应用照旧读到了使用者真实的 `~/.claude`。

**根因**：`open` 通过 LaunchServices 启动应用，**不继承当前 shell 的环境变量**。

**修法**：直接执行 bundle 里的可执行文件：

```bash
HOME="$ISOLATED" "dist-arm64/CC Analyzer.app/Contents/MacOS/cc-analyzer"
```

Tauri 应用照样能找到自己的资源。

**为什么这条重要**：隔离失效意味着**测试会去读使用者真实的会话数据**——
那是敏感数据，踩的是项目红线，不只是测试写法问题。

---

## 9. `readonly X="$(cmd)"` 会把退出码吃掉

**现象**：shellcheck 报 SC2155；更实际的是 `mktemp` 失败时脚本会带着空路径继续跑。

**修法**：先赋值，再 `readonly`：

```bash
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX")"
readonly WORK_DIR
```

---

## 10. bash 会播报后台作业的终止，看着像失败

**现象**：测试输出里混进一行

```
./scripts/gui-test.sh: line 256: 83505 Terminated: 15   HOME=... "$BIN" ...
```

它不是失败，是 bash 在回收被 kill 的后台作业。但混在测试输出里极像失败。

**根因**：`kill` 之后若有别的命令（哪怕只是 `sleep`），bash 会趁机回收作业并播报。
紧接 `wait` 则不会——所以「kill 完立刻 wait」的写法看不出这个问题。

**修法**：**kill 之前先 `disown`**，作业表里没有它，也就没有播报。

**教训**：测试脚本的输出是要给人看的。**任何「不是失败却长得像失败」的东西
都要消掉**，否则真正的失败会被淹没。
