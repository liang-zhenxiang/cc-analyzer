# Tauri 2 GUI 测试方案调研

> 调研时间：2026-10-01 · 环境：macOS Darwin 25.5（Apple Silicon）
> 本文是对**已落地的 `scripts/gui-test.sh`** 的评估与补强建议，不是从零方案。
> 标注「**已实测**」的结论是在本机跑过的；标注「**需实测验证**」的是未验证的推断。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| tauri-driver 能否用于 macOS | **不能**，官方只支持 Windows / Linux |
| `screencapture` 截图失败的原因 | TCC「屏幕录制」权限，判断正确 |
| 有没有免授权的截图途径 | **有** —— 应用截自己的 WKWebView，**已实测通过** |
| 现有断言是否够硬 | 主干够硬；RSS 阈值判别力低、缓存只验数量、缺崩溃/日志/隔离反向断言 |
| 真机截图能否做像素回归 | 不建议；像素回归放 Playwright 层 |
| GitHub macOS runner 跑真实 GUI | 截图不可行（TCC 无法授予），成本还高 |

---

## 1. 对现有 `scripts/gui-test.sh` 的评估

### 1.1 做得对的地方（不要动）

- **直接执行 `Contents/MacOS/cc-analyzer` 而不是 `open`** —— 这个判断是对的。
  `open` 经 LaunchServices 启动，环境变量不会透传，`HOME` 隔离直接失效。
  代价是窗口不激活到前台，但对**免截图的断言**没有影响。
- **`HOME` 指向临时目录** —— 隔离真实 `~/.claude`，符合「会话数据不出本机」的红线。
- **「缓存条目数与夹具一致」是最有价值的一条断言**。它一次性证明了
  webview → React → 桥接 → Rust → 文件系统 → 解析 → 写盘 整条链路，
  比任何单点探针都强。
- **`OUTSIDE == 0`** 这条反向断言很好，多数人不会写。
- `disown` 后再 `kill` 避免 bash 播报作业终止 —— 细节到位。

### 1.2 薄弱点与改法

| 现状 | 问题 | 建议 |
|---|---|---|
| `RSS > 20480` KB 判定 webview 已加载 | **判别力低**。已实测：一个只装了空白 `WKWebView` 的最小窗口进程 RSS = **69 MB**、16 线程。阈值 20 MB 几乎只能排除「进程完全没起来」，而且不同 macOS 版本基线漂移会误报 | 改为**相对增量**：`RSS(10s) - RSS(1s) > 20MB`；或直接换成 1.3 的 `takeSnapshot` 断言 |
| 缓存只验 `COUNT == 2` | 条目数对但内容是错的（解析 bug）测不出来 | 逐条比对字段，见 1.3-(f) |
| 固定 `sleep 1` × 10 等启动 | 慢且脆 | 改成条件轮询（文件存在即 break），已有缓存轮询就是这么做的，启动存活也可以 |
| 截图用 `screencapture -x`（无 `-l`） | 就算有权限，截的是**整个屏幕**（桌面 + 其它窗口），不是应用窗口 | 见 §2.3，改用 `-l <windowID>` |
| 没有检查崩溃报告 | 应用可能「优雅地崩了」但被误判为存活 | 见 1.3-(c) |
| 没有检查应用日志 | Rust `panic!` 会打到 stderr，被 `>"$APP_LOG"` 吞掉 | 见 1.3-(d) |

---

## 2. 免隐私权限的断言（可直接加）

### 2.1 编译一次性的窗口枚举 helper（**已实测**，零权限零依赖）

`osascript -l JavaScript` 调 `CGWindowListCopyWindowInfo` 在本机 Darwin 25.5 上桥接失效
（返回不可迭代的代理对象，`count` 为 `undefined`），**不要走 JXA**。用 Swift：

```swift
// scripts/winid.swift —— 编译：swiftc -O scripts/winid.swift -o /tmp/cc-winid
import CoreGraphics
import Foundation
let want = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : nil
let l = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                   kCGNullWindowID) as? [[String: Any]] ?? []
for w in l where (w[kCGWindowLayer as String] as? Int) == 0 {
    let o = w[kCGWindowOwnerName as String] as? String ?? ""
    if want == nil || o == want! {
        let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
        print("\(w[kCGWindowNumber as String] as? Int ?? -1)\t\(o)\t\(b["Width"] ?? 0)x\(b["Height"] ?? 0)")
    }
}
```

**实测结论（重要，影响能写什么断言）：**

- `kCGWindowOwnerName`、`kCGWindowNumber`、`kCGWindowBounds` —— **无权限可读** ✓
- `kCGWindowName`（窗口标题）—— **无权限一律为 `<nil>`**，实测所有窗口（含自己启动的探针）
  都读不到。**所以不要写「断言窗口标题」这种检查，它必然失败。**

可加的断言：

```bash
# 窗口存在且尺寸合理（不依赖标题）
WID=$(/tmp/cc-winid "CC Analyzer" | head -1 | cut -f1)
[[ -n "$WID" ]] || bad "应用没有创建任何窗口"
```

### 2.2 进程线程数（比 RSS 稳）

WebKit 会拉起一整个线程池，实测最小 `WKWebView` 窗口进程 = **16 线程**。
一个没起 webview 的 Tauri 空壳只有个位数线程：

```bash
THREADS=$(ps -M "$APP_PID" | wc -l)          #  macOS: ps -M 每线程一行
[[ "$THREADS" -gt 8 ]] && ok "线程数 $THREADS，WebKit 线程池已启动"
```

### 2.3 完整可直接粘贴的补强清单

```bash
# (a) 崩溃报告 —— macOS 把崩溃写到这里，进程"存活"也可能已经崩过
CRASH=$(ls -t "${REAL_HOME}/Library/Logs/DiagnosticReports/"*.ips 2>/dev/null \
        | xargs grep -l "$BUNDLE_ID" 2>/dev/null | head -1)
[[ -z "$CRASH" ]] || bad "发现有崩溃报告：$CRASH"

# (b) 应用日志里不能有 panic / ERROR
if grep -qE 'panic|thread .* panicked|RUST_BACKTRACE' "$APP_LOG"; then
  bad "应用日志里有 panic"; sed -n '1,20p' "$APP_LOG" | sed 's/^/    /'
fi

# (c) 退出码（当前只 kill，没看退出码）
#     注意：SIGTERM 被杀时退出码是 143；应用主动处理了 SIGTERM 才是 0。
#     先用 kill -TERM，再 wait 取码：
kill -TERM "$APP_PID" 2>/dev/null || true
wait "$APP_PID"; RC=$?
[[ "$RC" == "0" || "$RC" == "143" ]] || bad "异常退出码 $RC"

# (d) 真实 HOME 未被写入（隔离的反向验证，比只信 HOME 变量更硬）
#     跑测试前后各取一次快照对比
snapshot_real_home() {
  find "${REAL_HOME}/.claude" -type f -exec stat -f '%N %m %z' {} + 2>/dev/null | sort | shasum -a 256
}
HOME_HASH_BEFORE=$(snapshot_real_home)
# … 跑应用 …
[[ "$(snapshot_real_home)" == "$HOME_HASH_BEFORE" ]] \
  || bad "真实 ~/.claude 被改动 —— 隔离失效"

# (e) 缓存内容逐字段比对（替换掉只数条目数）
python3 - "$CACHE_PATH" <<'PY'
import json, sys, pathlib
entries = json.loads(pathlib.Path(sys.argv[1]).read_text())["entries"]
bad = [p for p, v in entries.items() if not v.get("sessionId") or v.get("messages", 0) <= 0]
print("BAD", len(bad), bad[:3])
PY

# (f) 签名/打包完整性（打包回归的廉价哨兵）
codesign --verify --strict "$APP_PATH" 2>&1 | tail -2
```

> 关于 (f)：Tauri 本地构建默认 ad-hoc 签名，`--verify` 应当通过。
> 若项目改过 `signingIdentity`，**需实测验证**该命令的预期输出。

---

## 3. 截图：TCC 判断正确，但有免授权通路（**本节是核心**）

### 3.1 你的 TCC 判断是准确的

`screencapture` 是**独立进程**，TCC 授权对象是「调用方进程」（终端 / iTerm / 父 App），
不是被截的 App。授权只能由使用者在「系统设置 → 隐私与安全性 → 屏幕录制」手动完成，
脚本无法自行申请。`launchctl managername = Aqua` 只说明有窗口服务器会话，
**不等于**有屏幕录制权限 —— 两者是独立的。判断正确，脚本里「明确跳过并说明原因」
的做法也是对的（比假装通过好）。

补充一条**已实测**的坑：`CGWindowListCreateImage` 在本机 SDK 里已经被标记为
`unavailable: Please use ScreenCaptureKit instead.` —— **直接编译不过**。
网上大量旧代码片段用它，现在会编译失败，不要照抄。ScreenCaptureKit 同样受 TCC 约束。

### 3.2 免授权通路：应用截自己（**已实测通过**）

**WKWebView 的 `takeSnapshot` 不需要任何权限** —— 它渲染的是自己的内容，
不属于「屏幕录制」。本机实测（当前**没有**屏幕录制权限的 shell 里跑）：

```
TAKESNAPSHOT_OK 600x400                    ← 权限齐全时这里会失败，但它是 OK
产物：PNG 1200x800（Retina 2x），sd=46.2，colors=249
```

对照：同一台机器上 `screencapture -x` 报 `could not create image from display`。
**结论：截图通路确实存在，且不需要用户手动授权。**

### 3.3 落地到 Tauri 的三条路线

**路线 A —— 前端自截（跨平台、零原生代码，推荐先做）**

渲染完成后用 `html2canvas` 把 DOM 画到 canvas，再经桥接写盘：

```ts
// web/src/features/…/e2eCapture.ts —— 仅在 E2E 构建里引入
import html2canvas from 'html2canvas'
import { invoke } from '@tauri-apps/api/core'

export async function captureForE2E(path: string) {
  const canvas = await html2canvas(document.body, { backgroundColor: '#fff' })
  const dataUrl = canvas.toDataURL('image/png')
  await invoke('write_e2e_screenshot', { path, dataUrl })
}
```

优点：macOS / Windows / Linux 通用，不需要 objc2，不需要权限。
缺点：它重绘 DOM，**不反映真实合成**（`backdrop-filter`、部分混合模式、原生标题栏会丢失）。
对「判断是不是白屏」这个目的**完全够用**。

**路线 B —— 原生 `takeSnapshot`（真像素，仅 macOS，需实测验证）**

在 Rust 侧拿窗口的 `WKWebView` 调 `takeSnapshotWithConfiguration:completionHandler:`。
Tauri v2 有 `WebviewWindow::ns_window()` 返回 `*mut c_void`，
再取 `contentView` 在子视图树里找 `WKWebView`。示意骨架（**未在本项目编译验证**）：

```rust
#[cfg(target_os = "macos")]
fn capture(window: &tauri::WebviewWindow, path: &std::path::Path) -> Result<(), String> {
    // 需要依赖：objc2, objc2-app-kit, objc2-web-kit, objc2-foundation
    // 1. window.ns_window() -> *mut c_void  ->  &NSWindow
    // 2. ns_window.contentView()            -> NSView
    // 3. 深度优先遍历 subviews，找 isKindOfClass:WKWebView
    // 4. WKWebView.takeSnapshotWithConfiguration:completionHandler:
    //    回调里把 NSImage 转 PNG 写盘（回调在任意线程，用 channel 回传）
    // 5. 若 1 秒内没回调 -> 返回 Err，避免测试挂死
    todo!("需实测验证：objc2 版本 API、回调线程、Retina 缩放")
}
```

注意点（都**需实测验证**）：`takeSnapshot` 只截 **web 内容**，不含原生标题栏；
返回值是 `NSImage`，尺寸是点而非像素（实测底层是 2x）；
未显示的窗口能否快照、窗口被遮挡时是否降级，均未验证。

**路线 C —— 维持现状**：`screencapture` + 用户手动授权一次。
留在开发机上是合理的，但不能作为 CI 依赖。

### 3.4 顺带修掉现有截图的另一个问题

现在用的是 `screencapture -x`（无 `-l`），**截的是整个屏幕**，会把桌面和其它窗口
一起截进来，即使拿到权限也不是「应用窗口截图」。有权限时应改成：

```bash
WID=$(/tmp/cc-winid "CC Analyzer" | head -1 | cut -f1)
screencapture -x -o -l "$WID" "$SHOT"     # -l 指定窗口, -o 去掉窗口阴影
```

判断截图是不是白屏，用一个像素统计小工具（**已实测**）：

```swift
// scripts/pngstat.swift —— 输出 {"w","h","mean","sd","colors"}
// 实测标定：纯白图 sd=0.0, colors=1；有内容图 sd=87.5, colors=3
```

判定建议：`sd > 5 且 colors > 50` 视为渲染成功。
用「连续两帧 PNG 的 sha256 相同」等渲染稳定，比固定 `sleep` 可靠：

```bash
PREV=""
for _ in $(seq 1 20); do
  screencapture -x -o -l "$WID" "$OUT/shot.png" 2>/dev/null || break
  CUR=$(shasum -a 256 "$OUT/shot.png" | cut -d' ' -f1)
  [[ -n "$PREV" && "$CUR" == "$PREV" ]] && break
  PREV="$CUR"; sleep 0.7
done
```

---

## 4. tauri-driver / WebdriverIO 在 macOS 上能否使用

**不能。** 官方文档（`v2.tauri.app/develop/tests/webdriver/`）明确：

- **Windows** —— 走 `msedgedriver`，版本必须与系统 Edge 匹配，不匹配会**挂起**
- **Linux** —— 走 `WebKitWebDriver`（Debian 系需装 `webkit2gtk-driver`）
- **macOS** —— **不支持**，因为 WKWebView 没有 WebDriver 实现

「官方推荐什么」：**在 macOS 上没有官方 WebDriver 方案**。官方页面把 macOS 排除在外，
并未给出替代品。社区替代均不成熟：

| 方案 | 状态 |
|---|---|
| `@wdio/tauri-service` | 声称支持 macOS，底层走 Appium Mac2 Driver，**需实测验证** |
| `tauri-plugin-webdriver`（第三方） | 把 W3C WebDriver server 嵌进 App，**需实测验证** |
| CrabNebula Cloud | 商业托管服务，有 macOS WebDriver 支持 |

**建议**：不要为 macOS 引入 WebDriver。原因不只是驱动缺失 —— 即使能跑，
它替换掉了真实的 React 渲染路径，而本项目 `v0.2.1` 连挂两次的问题恰恰在
「Tauri 外壳能否承载前端」，WebDriver 覆盖不到。现有的真机冒烟 + Playwright 分工更贴合。

---

## 5. 视觉回归怎么做才稳

**核心取舍：像素比对放在 Web 层，真机层只做「非空白」判定。**

真机截图受 **DPI（Retina 2x）、窗口尺寸、系统深浅色主题、字体渲染版本、
窗口是否被遮挡**影响，在本机稳定、在 CI 上必炸。**不要做真机像素基线。**

分层建议：

| 层 | 工具 | 跑在哪 | 内容 |
|---|---|---|---|
| L1 | Vitest + RTL（已有） | 每次 PR | 组件逻辑、桥接契约 |
| L2 | Playwright + `vite preview` + 假 Bridges | 每次 PR（CI 主力） | 真实浏览器渲染、键盘、**视觉回归** |
| L3 | `scripts/gui-test.sh` 真机 .app | 仅本机 / nightly | 启动、整链路、**非空白判定** |

L2 的视觉回归用 Playwright 原生能力：

```ts
// web/e2e/visual.spec.ts
import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })

test('会话列表视觉基线', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('session-list')).toBeVisible()
  await expect(page).toHaveScreenshot('session-list.png', {
    maxDiffPixelRatio: 0.01,          //  容忍抗锯齿
    animations: 'disabled',           //  关动画，否则永不稳定
  })
})
```

要点：

1. **`deviceScaleFactor: 1`** —— 否则同一条基线在 Retina 与非 Retina 上不一致。
2. **`animations: 'disabled'`** —— 动画是截图抖动的主要来源。
3. 固定字体：在测试模式注入 `font-family: -apple-system` 之类的本地系统字体，
   不要依赖网络字体（CI 上拉不到会退化成 fallback，整页位移）。
4. **基线只在单一平台生成与比对**（建议 Linux + Chromium，与 CI 一致）。
   跨平台共用基线必然失败。
5. 生成/更新基线：`npx playwright test --update-snapshots`，`*.png` 提交进仓库，
   review 时**截图 diff 就是 PR 的一部分**。
6. 深浅色：分别用 `colorScheme: 'light' / 'dark'` 各跑一份，别混。

---

## 6. GitHub macOS runner 上跑真实 GUI

**结论：截图不可行，不建议投入。**

- **TCC 无法授予**。这是长期未解问题（`actions/runner-images#7792`、`#8951`）。
  runner 是无人值守 VM，权限弹窗无人点击；改 `TCC.db` 需要 `sudo` 且系统库受限，
  社区多次尝试均未成功。macOS 13/14/15 的 runner 上行为还不一致。
- runner 有窗口服务器会话，**「启动 GUI 应用」本身通常可以**（**需实测验证**），
  但**截不到图** —— 而这正是本节的目的。
- **成本**：macOS runner 按 10× 分钟数计费，是 Linux 的 10 倍；一次真实 GUI 冒烟
  （含构建）在 macOS 上要 10–20 分钟。

**建议**：
- **GitHub 托管 CI 只跑 L1 + L2**（L2 用 `ubuntu-latest`，成本 1×，且截图稳定）。
- **L3 留在开发机**，用 `npm run gui:test` 在发布前手动跑一次，或挂到 self-hosted runner
  （自建机器可以预先授予 TCC，这是唯一能让 L3 上 CI 的途径）。
- 若一定要在 CI 留痕，让 CI 跑 L2 的 Playwright 截图作为视觉证据 —— 它本来就更稳定。

---

## 7. 需要实测验证的清单

1. 路线 B（objc2 + `takeSnapshot`）在真实 Tauri 窗口上的可用性与 API 细节；
   `takeSnapshot` 对**被遮挡 / 未显示**窗口的行为。
2. `codesign --verify --strict` 在本项目 ad-hoc 签名产物上的预期退出码。
3. `@wdio/tauri-service` 在本项目的实际可用性（若决定尝试）。
4. Windows 侧能否用 WebView2 + CDP 接 Playwright：
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
   配合 `chromium.connectOverCDP('http://localhost:9222')`。
5. GitHub `macos-latest` runner 上「启动 .app 但不截图」这条降级路径是否稳定。

---

## 8. 立即可做的三件事（按性价比排序）

1. **加免权限断言**：崩溃报告、日志 panic、真实 HOME 反向校验、缓存字段比对（§2.3）。
   成本低、纯增益，直接补进 `scripts/gui-test.sh`。
2. **把 RSS 阈值换成更强的判据**：线程数（> 8）+ RSS 增量，或直接上 `takeSnapshot`（§2.2 / §3.3 路线 A）。
3. **修 `screencapture` 的窗口定位**，并用「双帧 sha 稳定 + pngstat 非空白」替换
   现在的「截完就算」；同时把 TCC 跳过路径保留为降级（§3.4）。
