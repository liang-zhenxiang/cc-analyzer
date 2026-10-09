#!/usr/bin/env bash
#
# gui-test.sh —— 真机 GUI 冒烟测试
#
# 它**真的启动打包后的应用**，不是模拟、不是 jsdom，然后验证它确实跑起来了。
#
# 为什么这样做而不是只靠 Playwright：Playwright 测的是浏览器里的界面代码，
# 「Tauri 外壳能不能正确承载它」不在覆盖范围内——而那正是 v0.2.1 连挂两次的地方。
#
# 判定依据（都不需要任何隐私权限）：
#
#   1. 进程启动后持续存活，没有崩溃退出
#   2. **应用在自己的数据目录里写出了元数据缓存**，且条目与夹具一一对应
#      —— 这一条很有力：它意味着 webview 加载 → React 挂载 → 调用桥接 →
#      Rust 读文件系统 → 会话解析 → 写缓存，整条链路真的走通了
#   3. **应用把自己的 webview 渲染成了一张不空白的图**
#      —— 这一条直接证明 webview 加载 → React 挂载 → 渲染完成
#   4. **界面布局满足几何不变量**（无横向溢出 / 表盘有界且含于卡片 / 记录表末列可达）
#      —— 应用侧只收集「原始几何事实」（`CCA_GUI_PROBE`，用
#      `evaluateJavaScript:completionHandler:` 取回，双向拿得到返回值），
#      阈值与判定留在这里；事实在应用、断言在脚本。这条把「人眼看截图找布局回归」
#      变成了「自动失败并指出是哪条不变量破了」。
#
# 内存占用只**记录**、不判定。这里曾经写的是「RSS > 20MB 即 webview 已加载」，
# 那是过度声称：实测一个只装了空白 WKWebView 的最小窗口进程，RSS 就有
# 69MB / 16 线程——空白 webview 本身就远在阈值之上，挡不住「webview 没加载」。
# 详见下面「记录：进程内存占用」那一步的注释。
#
# 取图走的是应用**自己的 webview**（`CCA_GUI_CAPTURE`，见 src-tauri/src/lib.rs
# 的 gui_capture 模块），不经过截屏通道，因此不需要「屏幕录制」权限；
# 取不到图算失败而不是跳过。界面视觉验收请用
# `npm --prefix web run test:e2e` 产出并人工过目的截图。
#
# **隔离**：通过把 HOME 指向临时目录，应用只会看到我们放进去的夹具，
# 不会去读使用者真实的 ~/.claude 会话数据。这是有意的——会话内容属于敏感数据。
#
# **失败时要能一次定位**：探针缺失算失败（不是跳过），但失败信息不止说「没有产出」——
# 它会打印探针**路径与最后修改时间**、脚本等待了多久，以及应用日志里与这份探针**相关
# 的行**（应用侧每条探针日志都带文件名），据此直接区分「应用没写出来」与「脚本等太短」。
# 想连整个现场一起留下（应用日志、PDF、探针 JSON）就设 `CCA_GUI_KEEP_WORK=1`，
# 此时临时工作目录不会被删，路径会打印出来。门禁是间歇性失败过的，缺了现场就无法归因。
#
# **前提**：产物必须带 `gui-capture` feature。没有它，应用不会渲染自身 webview，
# 取图那步必然失败——而发布产物**不带**该 feature（见 src-tauri/Cargo.toml），
# 所以 `npm run build:macos:*` 产出的常规产物不能直接拿来跑。
# 脚本会在**启动应用之前**先验证这一点，缺了就直接给指引并退出。
#
# 用法：
#   ./scripts/gui-test.sh                # 用已有产物跑（产物需带 gui-capture feature）
#   ./scripts/gui-test.sh --build        # 先构建（自动带 gui-capture）再跑
#   ./scripts/gui-test.sh --app <path>   # 指定 .app
#   CCA_GUI_CAPTURE_TAB=用量总览 ./scripts/gui-test.sh
#                                        # 覆盖「视图清单」：逗号分隔的目标，应用依次
#                                        # 点击并在每步取一张图，各走相同的转 PNG + 非空白
#                                        # 与几何判定。**单个值沿用旧文件名 -tab.pdf**。
#
# 默认的视图清单是「会话分析 → 切成 130% 界面字号 → 打开首个会话 → 日志视图 → 终端转义夹具会话 →
# 日志视图 → 导出 → 关闭导出窗口 → 压缩夹具会话 → 上下文 → 点选第 2 枚压缩事件 chip →
# 改动夹具会话 → 改动 → 点选首个文件行 →
# 用量总览 → 视图=用量 → 滚到底 → 点选工具普查榜首行 → 近 7 天 → 错误档 → 滚到底 → 全局搜索（开）→ 全局搜索（关）→
# 实时监控 → 字号恢复 100%」；每张图都配一份
# 几何探针 JSON（`CCA_GUI_PROBE`），脚本据它判定
# **布局不变量**：无横向溢出、表盘有界且含于卡片、记录表末列可达、会话行不裁字、
# 两层限额读数在卡内、用量页三块面板滚一次可达、上下文曲线有界且命中区与压缩次数一致、
# 取证卡在视口内、被丢清单不是假列表、错误档趋势有界且事件列表是真列表、
# 改动文件列表是真列表且展开区可达、工具普查四栏清单是真列表且下钻区可达。目标既可写
# 可访问名/可见文本（标签页），也可写会话 cwd
# （会匹配按钮的 `title`）、`字号=<档位>` / `视图=<用量页子视图名>` / `滚动=<选择器>` /
# `点选=<CSS 选择器>` 四种动作。
# **前两步显式切回「会话分析」与「日志视图」**——应用会把当前
# 标签页与分析器子视图记进 WebKit 的 localStorage（位于真实 ~/Library/WebKit，不受 HOME
# 隔离），不先切回去，会话点击会落空、树视图也没有记录表。
#
# 退出码：0 没有失败项／1 有检查项失败（取不到图、探针缺失、布局不变量破坏都计失败）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly PROJECT_ROOT
cd "$PROJECT_ROOT"

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

usage() {
  # 帮助文本是**字面量**，不从头部注释里抽。
  #
  # 旧实现是 `sed -n '2,/^$/p' "$0"`：把整整 42 行头部注释连 `# ` 前缀一起倒出来，
  # 九成是设计取舍与踩坑记录，使用者要看的「用法」段被埋在中间（第 36 行），
  # 读起来还像没处理的源码。
  # 再往前它写的是 `sed -n '2,30p'`——**按行号**取材：头部注释一长过 30 行，
  # 「用法」段就被静默截断，`--help` 一个字都不提它（#49 修掉了那一版）。
  # 字面量不依赖任何行号，头部怎么增删都不会截断或漏掉用法。
  # 代价：头部注释里的「用法」段与这里有一份重复，改一处时要记得改另一处
  # （那份是给读代码的人看的，这份是 `--help` 的输出）。
  cat <<'EOF'
gui-test.sh —— 真机 GUI 冒烟测试

真的启动打包后的 .app（不是模拟），断言整条链路走通：进程存活 → 读出会话
→ 写出元数据缓存 → 把自己的 webview 渲染成一张非空白的图。

用法：
  ./scripts/gui-test.sh                # 用已有产物跑（产物需带 gui-capture feature）
  ./scripts/gui-test.sh --build        # 先构建（自动带 gui-capture）再跑
  ./scripts/gui-test.sh --app <path>   # 指定 .app
  CCA_GUI_CAPTURE_TAB=用量总览 ./scripts/gui-test.sh
                                       # 覆盖「视图清单」：逗号分隔的目标，应用依次点击
                                       # 各取一张图。单个值沿用旧文件名 -tab.pdf。
  CCA_GUI_KEEP_WORK=1 ./scripts/gui-test.sh
                                       # 失败时留下整个现场（应用日志、PDF、探针 JSON），
                                       # 不删临时工作目录，并把路径打印出来。
  -h, --help                           # 显示帮助

默认视图清单：会话分析 → 切成 130% 界面字号 → 打开首个会话 → 日志视图 → 终端转义夹具会话 →
日志视图 → 导出 → 关闭导出窗口 → 压缩夹具会话（/repo/compact-demo）→ 上下文 → 点选第 2 枚压缩
事件 chip → 改动夹具会话（/repo/changed-demo）→ 改动 → 点选首个文件行 → 用量总览 → 视图=用量 →
滚到底 → 点选工具普查榜首行 → 近 7 天 → 错误档 → 滚到底 → 全局搜索（开）→ 全局搜索（关）→ 实时监控 →
字号恢复 100%。
每张图都配一份几何探针 JSON，脚本据它判定布局不变量（无横向溢出 / 表盘有界且含于卡片 /
记录表末列可达 / 文字里无 ESC 转义字节 / 两层限额读数在卡内 / 用量页三块面板滚一次可达 /
上下文曲线有界且命中区与压缩次数一致 / 取证卡在视口内 / 被丢清单不是假列表 / 错误档趋势
有界且事件列表是真列表 / 改动文件列表是真列表且展开区可达 / 工具普查四栏清单是真列表且下钻区可达）。

`字号=<档位>`（如 `字号=130%`）是一个动作目标：先在设置浮层里把界面字号切到该档，
再取图与探针——用它验证「放大字号后布局仍然成立」。默认清单末尾会切回 100%，
因为 WebKit 的 localStorage 不受 HOME 隔离，不恢复会把这个偏好留给下一次运行与使用者。
`滚动=<选择器>`（如 `滚动=main`）、`视图=<用量页子视图名>`（如 `视图=用量`，重置 N1 的
「用量|错误」分段状态——它记在不受 HOME 隔离的真实 WebKit localStorage 里，不重置时上次
停在错误档的残留会让用量档的判定整段落空）与 `点选=<CSS 选择器>`（如 `点选=[data-probe='compact-event-2']`）
也是动作目标：第一种把滚动容器滚到底，第二种显式切换用量页子视图，第三种点击通用扫描够不着的
控件（可访问名带动态数字的，靠组件上的 data-probe 稳定属性定位）。选择器里不能含逗号（目标清单以逗号分隔）。

探针缺失算失败（不是跳过）。失败时会打印探针路径、最后修改时间、脚本等待时长，以及应用
日志里与这份探针相关的行，用来区分「应用没写出来」还是「脚本等太短」。

前提：产物必须带 `gui-capture` feature，否则取图那步必然失败。发布产物**不带**
它，所以 `npm run build:macos:*` 产出的常规产物不能直接拿来跑——请用 --build。

隔离：HOME 指向临时目录，应用只看得见我们放进去的夹具，不会读使用者的真实会话。

退出码：0 没有失败项；1 有检查项失败（取不到图、探针缺失、布局不变量破坏都计失败）。

设计取舍与判定依据见本脚本头部注释。
EOF
}

BUILD=0
APP_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1; shift ;;
    --app) APP_PATH="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf '%s未知参数：%s%s\n' "$C_RED" "$1" "$C_RESET" >&2; exit 2 ;;
  esac
done

# 产物目录按架构区分
if [[ -z "$APP_PATH" ]]; then
  case "$(uname -m)" in
    arm64) APP_PATH="dist-arm64/CC Analyzer.app" ;;
    *)     APP_PATH="dist-intel/CC Analyzer.app" ;;
  esac
fi

readonly BUNDLE_ID="io.github.liang-zhenxiang.cc-analyzer"
# 先赋值再 readonly：写成 `readonly X="$(cmd)"` 会把 cmd 的退出码吃掉（SC2155），
# mktemp 失败时脚本会带着空路径继续往下跑。
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cca-gui-test.XXXXXX")"
readonly WORK_DIR
readonly HOME_DIR="${WORK_DIR}/home"
readonly ARTIFACT_DIR="${PROJECT_ROOT}/gui-artifacts"
readonly CAPTURE_PDF="${WORK_DIR}/app-capture.pdf"
# 几何探针落点（第一张图的）。多视图的探针文件名规则与取图一致，见下面「截图」段。
readonly CAPTURE_PROBE="${WORK_DIR}/app-probe.json"
readonly APP_LOG="${WORK_DIR}/app.log"
# 逐份等几何探针落盘的上限（秒）。探针是异步写出的，「PDF 到了」不等于「JSON 也到了」。
# 要盖过应用侧的重试预算（PROBE_ATTEMPTS × (PROBE_EVAL_TIMEOUT_MS + PROBE_RETRY_MS)，
# 见 src-tauri/src/lib.rs），否则应用还在重试、脚本已经判失败。
readonly PROBE_TIMEOUT_SECS=25

APP_PID=""
PASSED=0
FAILED=0
SKIPPED=0
declare -a FAILED_NAMES=()
declare -a SKIPPED_NAMES=()

cleanup() {
  # 只杀**本轮记录的** PID。绝不 `pkill -f "CC Analyzer"` 这类宽匹配：使用者可能正从
  # /Applications 打开着同名应用，误杀是真实伤害。APP_PID 只在「启动应用」那一步被填。
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    # 先 disown 再 kill：否则 bash 会在回收这个后台作业时往 stderr 打一行
    # "Terminated: 15 <完整命令行>"。那不是失败，但混在测试输出里极像失败。
    disown "$APP_PID" 2>/dev/null || true
    kill "$APP_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  # 默认删掉工作目录；`CCA_GUI_KEEP_WORK=1` 时留下**整个现场**（应用日志、PDF、探针
  # JSON），供事后定位。门禁是间歇性失败过的，缺了应用日志就无法归因（实测踩过）。
  if [[ -z "${CCA_GUI_KEEP_WORK:-}" ]]; then
    rm -rf "$WORK_DIR"
  else
    printf '  %s现场已保留（CCA_GUI_KEEP_WORK=1）：%s%s\n' "$C_YELLOW" "$WORK_DIR" "$C_RESET"
  fi
}
# 任何退出路径都要清理：正常结束（EXIT）、Ctrl-C（INT）、被调用方/agent 中断
# （TERM/HUP）。**信号处理器只 `exit`**，让清理统一由 EXIT trap 走一遍——只挂 EXIT
# 时，被信号打断的脚本不会走到它，后台 app 会泄漏成 PPID=1 的孤儿实例（实测过 6 个），
# 累积污染后续运行的环境与内存基线。自测见 scripts/gui-test-shutdown-test.sh。
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; PASSED=$((PASSED + 1)); }
bad()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1"; FAILED=$((FAILED + 1)); FAILED_NAMES+=("$1"); }
# 只陈述事实、不参与判定的行。用它而不是 ok 或 skip：ok 会把「其实什么都没
# 证明」说成「检查通过」，skip 会让人以为这项本该检查、只是这次没跑成。
note() { printf '  %s·%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
skip() { printf '  %s⚠ 跳过：%s%s\n' "$C_YELLOW" "$1" "$C_RESET"; SKIPPED=$((SKIPPED + 1)); SKIPPED_NAMES+=("$1"); }
step() { printf '\n%s▶ %s%s\n' "$C_BOLD" "$1" "$C_RESET"; }

# 目标名 → 文件名片段，必须与 src-tauri/src/lib.rs 里 `gui_capture::slug_of` **逐字一致**：
# 保留字母数字（含中文），其余折叠成单个 `-`，空结果回退 `tab`。两边不一致会表现为
# 「脚本一直等不到取图文件」——看起来像取图失败，其实是名字对不上。
slug_of() {
  python3 -c '
import sys
out = []
pending = False
for ch in sys.argv[-1]:
    if ch.isalnum():
        if pending and out:
            out.append("-")
        pending = False
        out.append(ch)
    else:
        pending = True
print("".join(out) or "tab")
' -- "$1"
}

# 把取图 PDF 转成 PNG 并做非空白判定。两个取图检查（首屏、指定标签页的第二张）
# 共用同一份判定——「与第一张完全相同的检查」要靠同一份代码，不能靠复制粘贴
# 再各改各的，否则迟早漂移成两套标准。
# 用法：check_capture_pdf <pdf路径> <png产物路径> <检查项文案前缀>
check_capture_pdf() {
  local pdf="$1" png="$2" label="$3"
  local out variance distinct varval

  if out="$(sips -s format png --out "$png" "$pdf" 2>&1)"; then
    ok "${label}已转换为 PNG：gui-artifacts/${png##*/}"
  else
    bad "${label}PDF 转 PNG 失败（${out}）"
  fi

  # **空白检测**：这是本项检查里最重要的一条。
  # 缺屏幕录制权限时 macOS 会给你一张「尺寸正确、内容全空」的图而不报错，
  # 光看「文件生成了吗」会被骗过去（挑图时实测过：那张图的像素全是 rgba(0,0,0,0)）。
  #
  # 判据用**不同颜色数**而不是方差：真实界面有几百种颜色，纯色图只有 1 种。
  # 方差曾经用过，但它对「大片同色背景 + 少量文字」的界面不敏感——
  # 一个完全正常的浅色界面算出来只有 167，而阈值定高了就会误报。
  if [[ -f "$png" ]]; then
    variance="$(python3 - "$png" <<'PY' 2>/dev/null || echo "ERR"
import sys, zlib, struct, pathlib

# 只用标准库解 PNG：够读出像素做方差判断，不引入图像依赖。
raw = pathlib.Path(sys.argv[1]).read_bytes()
pos, width, height, idat = 8, 0, 0, b""
while pos < len(raw):
    length = struct.unpack(">I", raw[pos:pos+4])[0]
    kind = raw[pos+4:pos+8]
    body = raw[pos+8:pos+8+length]
    if kind == b"IHDR":
        width, height, depth, color = struct.unpack(">IIBB", body[:10])
        if depth != 8 or color not in (2, 6):
            print("UNSUPPORTED"); raise SystemExit(0)
    elif kind == b"IDAT":
        idat += body
    elif kind == b"IEND":
        break
    pos += 12 + length

data = zlib.decompress(idat)
channels = 3 if color == 2 else 4
stride = width * channels
step = max(1, (width * height) // 20000)  # 抽样，别把大图整张算一遍
samples, prev, i = [], bytearray(stride), 0
rows = []
offset = 0
for _ in range(height):
    ftype = data[offset]
    line = bytearray(data[offset+1:offset+1+stride])
    offset += 1 + stride
    for x in range(stride):  # 还原 PNG 行滤波
        a = line[x-channels] if x >= channels else 0
        b = prev[x]
        c = prev[x-channels] if x >= channels else 0
        if ftype == 1: line[x] = (line[x] + a) & 0xFF
        elif ftype == 2: line[x] = (line[x] + b) & 0xFF
        elif ftype == 3: line[x] = (line[x] + ((a + b) >> 1)) & 0xFF
        elif ftype == 4:
            p = a + b - c
            pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
            pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[x] = (line[x] + pr) & 0xFF
    rows.append(bytes(line))
    prev = line

ys = range(0, height, max(1, height // 200))
xs = range(0, width, max(1, width // 200))
colors, flat = set(), []
for y in ys:
    row = rows[y]
    for x in xs:
        px = row[x * channels: x * channels + channels]
        colors.add(px)
        flat.append(px[0])
mean = sum(flat) / len(flat)
var = sum((v - mean) ** 2 for v in flat) / len(flat)
print(f"{len(colors)} {var:.1f}")
PY
)"
    distinct="${variance%% *}"
    varval="${variance##* }"
    case "$variance" in
      ERR|UNSUPPORTED|"")
        skip "${label}无法解析截图做空白检测（结果 = ${variance:-空}）" ;;
      *)
        # 真实界面抽样出几百种颜色；空白图只有 1 种。
        # 阈值取 20：足够把「纯色」和「有内容的界面」分开，又不依赖具体配色。
        if [[ "$distinct" =~ ^[0-9]+$ ]] && [[ "$distinct" -gt 20 ]]; then
          ok "${label}截图非空白（${distinct} 种颜色，方差 ${varval}）—— 拿到的确实是渲染后的界面"
        else
          bad "${label}截图疑似空白（仅 ${distinct} 种颜色）—— 文件生成了但内容为空"
        fi ;;
    esac
  fi
}

# 等一份探针 JSON 落盘。与 capture_one 里等 PDF 同一纪律：带超时，超时即失败，
# 绝不把「等不到」算成通过或跳过。返回 0 表示已落盘。
wait_for_probe() {
  local path="$1" i
  for ((i = 0; i < PROBE_TIMEOUT_SECS; i++)); do
    [[ -f "$path" ]] && return 0
    sleep 1
  done
  [[ -f "$path" ]]
}

# 探针缺失时的归因：**区分「应用没写出来」与「脚本等太短」**，并给出探针路径与最后
# 修改时间。依据是应用日志里**带文件名**的 `gui-probe:` / `gui-capture:` 行——应用侧
# 每条探针日志都带文件名，脚本才能精确归因，而不是笼统地说「没有产出」。
diagnose_missing_probe() {
  local label="$1" path="$2" name probe_lines
  name="$(basename "$path")"
  printf '  %s  探针缺失诊断 · %s（%s）%s\n' "$C_YELLOW" "$label" "$name" "$C_RESET"
  if [[ -e "$path" ]]; then
    printf '    文件存在但脚本判定为缺失，最后修改：%s\n' "$(stat -f '%Sm' "$path" 2>/dev/null)"
  else
    printf '    文件不存在；脚本已等待 %s 秒（超时 %s 秒）仍未见\n' \
      "$PROBE_TIMEOUT_SECS" "$PROBE_TIMEOUT_SECS"
  fi
  probe_lines="$(grep -F -- "gui-probe: " "$APP_LOG" 2>/dev/null | grep -F -- "$name" || true)"
  if [[ -n "$probe_lines" ]]; then
    printf '    应用日志（与 %s 相关）：\n' "$name"
    printf '%s\n' "$probe_lines" | sed 's/^/      /'
    if grep -qF -- "$name 已写出" <<<"$probe_lines"; then
      printf '    %s→ 归因：应用已写出该探针，脚本仍未在路径上等到 —— 脚本侧（路径 / 时序）%s\n' \
        "$C_YELLOW" "$C_RESET"
    else
      printf '    %s→ 归因：应用侧求值 / 写盘失败（重试已用尽），文件从未写出%s\n' \
        "$C_YELLOW" "$C_RESET"
    fi
  else
    printf '    应用日志里没有 gui-probe: %s 的任何行 —— 应用没走到取这份探针这一步\n' "$name"
    grep -F -- "gui-capture: " "$APP_LOG" 2>/dev/null | tail -20 | sed 's/^/      /' || true
    printf '    %s→ 归因：应用侧没有产出（取图 / 线程可能提前停了），见上面 gui-capture 行%s\n' \
      "$C_YELLOW" "$C_RESET"
  fi
  printf '    现场（应用日志等）：%s\n' "$APP_LOG"
}

printf '%s' "$C_BOLD"
cat <<'BANNER'
╭──────────────────────────────────────────────╮
│  CC Analyzer · 真机 GUI 冒烟测试             │
╰──────────────────────────────────────────────╯
BANNER
printf '%s' "$C_RESET"

# ---------------------------------------------------------------------------
step "准备隔离环境"
# ---------------------------------------------------------------------------
if [[ "$BUILD" == "1" ]]; then
  printf '  %s$ 构建中（npm run build:macos:*，启用 gui-capture）…%s\n' "$C_BLUE" "$C_RESET"
  # 带 `gui-capture` feature 构建：让应用能把自己的 webview 渲染成图。
  # 这个 feature 只影响这次构建，发布产物依旧不带它（见 Cargo.toml）。
  # TAURI_BUILD_CONFIG 关掉更新包签名产物：私钥只在 CI Secrets 里，
  # 本地构建带它必然失败（v0.9.0 引入更新渠道时踩过）。
  case "$(uname -m)" in
    arm64)
      TAURI_BUILD_FEATURES=gui-capture TAURI_BUILD_CONFIG=scripts/local-build.conf.json \
        npm run --silent build:macos:arm64
      ;;
    *)
      TAURI_BUILD_FEATURES=gui-capture TAURI_BUILD_CONFIG=scripts/local-build.conf.json \
        npm run --silent build:macos:intel
      ;;
  esac
fi

if [[ ! -d "$APP_PATH" ]]; then
  printf '  %s✗ 找不到应用产物：%s%s\n' "$C_RED" "$APP_PATH" "$C_RESET"
  # 这里不推荐 `npm run build:macos:arm64`：它产出的产物**不带** gui-capture
  # feature，照做会正好掉进下面那道预检拦下的坑里。
  printf '  %s  先跑 ./scripts/gui-test.sh --build（它会带上取图所需的 gui-capture feature）%s\n' "$C_YELLOW" "$C_RESET"
  exit 1
fi

BIN="${APP_PATH}/Contents/MacOS/cc-analyzer"
if [[ ! -x "$BIN" ]]; then
  printf '  %s✗ 产物里没有可执行文件：%s%s\n' "$C_RED" "$BIN" "$C_RESET"
  exit 1
fi

# --- 预检：产物里必须编入了 `gui-capture` feature ---------------------------
# 取图靠应用自己的 `gui_capture` 模块，而该模块受 feature = "gui-capture" 门控
# （见 src-tauri/src/lib.rs）。发布产物**不带**这个 feature，于是拿一个正常的
# `npm run build:macos:*` 产物来跑，会一路走到取图那步才报「应用没有产出取图
# PDF」——使用者什么都没做错，错在这道前提没写在明处。所以在这里先判、先给指引。
#
# 判据：`CCA_GUI_CAPTURE` 这个字符串只出现在受门控的 `gui_capture` 模块里
# （`std::env::var("CCA_GUI_CAPTURE")`）。feature 没开时整个模块不参与编译，
# 可执行文件里也就不会有这段字节序列。
#
# 用 `grep -a` 直接扫可执行文件，**不要**图省事写成 `strings -a "$BIN" | grep -q`：
# 本脚本开了 `set -o pipefail`，而 `grep -q` 一命中就退出，`strings` 随即收到
# SIGPIPE（退出码 141），pipefail 于是把整条管道判为失败——一个**带** feature 的
# 产物会被判成「没带」，恰好是这道预检最不该出的错。实测过，同一个产物：
# `strings -a "$BIN" | grep -q …` 报 NOT FOUND，`grep -aq …` 报 FOUND。
if ! grep -aq 'CCA_GUI_CAPTURE' "$BIN"; then
  printf '  %s✗ 产物不含 gui-capture feature：%s%s\n' "$C_RED" "$APP_PATH" "$C_RESET"
  printf '  %s  它渲染不了自身 webview，取图那步必然失败，所以在这里先停下。%s\n' "$C_YELLOW" "$C_RESET"
  printf '  %s  请用 --build 重新构建，或确认产物是用 TAURI_BUILD_FEATURES=gui-capture 构建的。%s\n' "$C_YELLOW" "$C_RESET"
  exit 1
fi

printf '  应用：%s\n' "$APP_PATH"

# 夹具：把单测用的 JSONL 放进隔离家目录的 Claude Code 布局里。
#
# 时间戳统一平移到「最新活动日 = 昨天」：夹具里的日期是写死的（1 月、9 月…），
# 而「用量总览」的统计窗口相对今天——不平移，真机截图永远只能验证空态，
# 非零读数与图表在真机上等于没测。全部文件共用同一个偏移（按全部夹具里最新的
# timestamp 算一次）：若每个文件各自平移到昨天，会话之间的相对日期就失真了。
# 策略与 web/e2e/fixtures.ts 的 recentActivityScenario 一致，理由见那边的注释。
FIXTURE_SRC="${PROJECT_ROOT}/web/tests/fixtures"
readonly SESSION_UUID="3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11"

# shift_fixture_jsonl <偏移天数>：stdin 读 JSONL，stdout 写平移后的内容。
# node 一行实现（构建本脚本的前置就依赖 node）：正则替换 "timestamp":"ISO"，
# 保留当天时刻，只动日期；不匹配 timestamp 的行原样通过。
shift_fixture_jsonl() {
  # `--` 必不可少：偏移是负数（如 -1），没有它 node 会把数字当选项解析
  # （`node: bad option: -1`），这正是本函数最常见的调用形态。
  # SC2016 在此为误报：脚本里的 ${...} 是 JS 模板字面量，本来就不该被 shell 展开。
  # shellcheck disable=SC2016
  node -e '
    const offset = Number(process.argv[1]);
    let text = "";
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => {
      process.stdout.write(text.replace(
        /"timestamp":"([^"]+)"/g,
        (match, iso) => {
          const date = new Date(iso);
          if (Number.isNaN(date.getTime())) return match;
          date.setUTCDate(date.getUTCDate() + offset);
          return `"timestamp":"${date.toISOString()}"`;
        }
      ));
    });
  ' -- "$1"
}

# 全部夹具里最新的 timestamp 与「昨天 00:00 UTC」的日差 = 共用偏移。
# （compact-session 的字段冒号后带空格，匹配不到 timestamp——它是会话内视图
# 的夹具，不进任何时间窗，平移与否不影响判定。）
FIXTURE_OFFSET="$(cat "${FIXTURE_SRC}"/session-basic.jsonl \
  "${FIXTURE_SRC}"/session-subagent.jsonl \
  "${FIXTURE_SRC}"/usage-dashboard-days.jsonl \
  "${FIXTURE_SRC}"/usage-dashboard-models.jsonl \
  "${FIXTURE_SRC}"/compact-session.jsonl \
  "${FIXTURE_SRC}"/error-session.jsonl \
  "${FIXTURE_SRC}"/changed-files-session.jsonl \
  "${FIXTURE_SRC}"/tool-census-session.jsonl \
  | node -e '
    const TS = /"timestamp":"([^"]+)"/g;
    let text = "", newest = 0;
    process.stdin.on("data", (chunk) => { text += chunk; });
    process.stdin.on("end", () => {
      let hit;
      while ((hit = TS.exec(text)) !== null) {
        const time = Date.parse(hit[1]);
        if (!Number.isNaN(time) && time > newest) newest = time;
      }
      const yesterday = new Date();
      yesterday.setUTCHours(0, 0, 0, 0);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const dayMs = 86_400_000;
      // 四舍五入而不是截断：时间戳带时刻，截断会把「今天凌晨的活动」
      // 平移到未来。 newest 固定在昨天或更早，偏移恒为负或零。
      const offset = -Math.round((newest - yesterday.getTime()) / dayMs);
      process.stdout.write(String(offset));
    });
  ')"
readonly FIXTURE_OFFSET
printf '  夹具时间平移：%s 天（最新活动日 → 昨天）\n' "$FIXTURE_OFFSET"

install_fixture() {
  local source="$1" project="$2" name="$3"
  local dir="${HOME_DIR}/.claude/projects/${project}"
  mkdir -p "$dir"
  shift_fixture_jsonl "$FIXTURE_OFFSET" <"$source" >"${dir}/${name}.jsonl"
}

install_fixture "${FIXTURE_SRC}/session-basic.jsonl" "-repo-demo" "${SESSION_UUID}"
install_fixture "${FIXTURE_SRC}/session-subagent.jsonl" "-repo-demo" "3d2a5442-9c65-4b28-9c30-bb3d1a1b2a22"
install_fixture "${FIXTURE_SRC}/usage-dashboard-days.jsonl" "-repo-usage-days" "dash-days-0001"
install_fixture "${FIXTURE_SRC}/usage-dashboard-models.jsonl" "-repo-usage-models" "dash-models-0002"
# 终端转义夹具：日志表里若把 `\u001b[31m` 当文本渲染，探针的 escaped_text 会立刻非零。
install_fixture "${FIXTURE_SRC}/session-ansi.jsonl" "-repo-ansi" "3d2a5442-9c65-4b28-9c30-bb3d1a1b8a88"
# 压缩夹具（Round J）：上下文标签页的门禁步骤靠它——2 次压缩（auto + manual）
# 出曲线断崖与取证卡，future-widget / quantum-latch 未识别行出覆盖率 chip。
# 与 web/e2e 共用同一份 tests/fixtures/compact-session.jsonl（拷贝而非软链，
# Windows/CI 语义），挂在 /repo/compact-demo 与 e2e 的 compactScenario 同名。
install_fixture "${FIXTURE_SRC}/compact-session.jsonl" "-repo-compact-demo" "compact-session"
# 错误夹具（Round N / N1）：错误档的门禁步骤靠它——两个自然日、API 错误 3 +
# 工具错误 4（含一条 sidechain 失败）、一次被排除的 AskUserQuestion 拒绝。
# 与 web/e2e 的 errorScenario 共用同一份 tests/fixtures/error-session.jsonl。
install_fixture "${FIXTURE_SRC}/error-session.jsonl" "-repo-error-demo" "error-session"
# 改动夹具（Round N / N2）：改动标签页的门禁步骤靠它——3 个文件（cwd 内含
# 新建/失败/子链的 A、仅查看的 B、项目外的 C），文件 A 下钻清单 7 条。
# 与 web/e2e 的 changedFilesScenario 共用同一份 tests/fixtures/changed-files-session.jsonl。
# **时间戳刻意比 error-session 的最新（2026-10-03）早 13 天**，两个原因：
# 1. 共用平移偏移取全部夹具里最新者——本夹具若更新，error-session 会被整体
#    平移出「近 7 天」窗口，错误档的 7 条期望失配；
# 2. 平移只改绝对位置、不改相对间距——本夹具若只早两三天，平移后自己会落进
#    「近 7 天」窗口，它那条 is_error 的 Edit 就成了错误档的第 8 条。
#    （两个方向都是真���门禁抓到过的；13 天 > 窗口 7 天 + 舍入余量。）
install_fixture "${FIXTURE_SRC}/changed-files-session.jsonl" "-repo-changed-demo" "changed-files-session"
# 工具统计夹具（Round N / N3）：「工具与 skill」面板的门禁步骤靠它——主链 13 次
# tool_use（Skill 裸名 + ns:name、MCP 3 段名 + 2 段防御名、Agent 带
# totalToolUseCount）+ sidechain 2 次。与 web/e2e 的 toolCensusScenario 共用
# 同一份 tests/fixtures/tool-census-session.jsonl。最新时间戳（10-03 12:00:14Z）
# 刻意早于 error-session 的最新（10-03 12:50Z）：共用平移锚点不变，错误档的
# 7 条期望照旧成立；窗内工具调用 = 本夹具 + error-session（+30 天档的
# changed-files，其 Edit/Read/Write 与前两者重类不重名），榜单行数恒为
# Top-6 + 折尾（8 类内置），榜首恒为 Bash（7 次并列时按名字稳定排序胜出）。
install_fixture "${FIXTURE_SRC}/tool-census-session.jsonl" "-repo-census-demo" "tool-census-session"
# 归档夹具：源文件**不在**隔离家目录里（模拟 Claude Code 已清理），只有副本与索引。
# 应用若真的把副本并回列表并解析，元数据缓存里会出现一条**键为副本路径**的条目——
# 这是「归档 → 发现 → 解析 → 缓存」整条真机链路的直接证据。
ARCHIVE_ROOT="${HOME_DIR}/Library/Application Support/${BUNDLE_ID}/archive"
mkdir -p "${ARCHIVE_ROOT}/-repo-gone"
cat >"${ARCHIVE_ROOT}/-repo-gone/cleaned-up-0001.jsonl" <<'JSONL'
{"type":"user","sessionId":"cleaned-up-0001","cwd":"/repo/gone","timestamp":"2026-01-05T09:00:00.000Z","uuid":"gone-user-1","parentUuid":null,"isSidechain":false,"message":{"role":"user","content":"三个月前的那次重构"}}
{"type":"assistant","sessionId":"cleaned-up-0001","timestamp":"2026-01-05T09:00:05.000Z","uuid":"gone-llm-1","parentUuid":"gone-user-1","isSidechain":false,"message":{"id":"gone-msg-1","role":"assistant","model":"claude-sonnet-4","content":[{"type":"text","text":"那次我们把解析器拆成了两层。"}],"usage":{"input_tokens":30,"output_tokens":20}}}
JSONL
cat >"${ARCHIVE_ROOT}/archive-index.json" <<JSON
{
  "version": 1,
  "entries": {
    "${HOME_DIR}/.claude/projects/-repo-gone/cleaned-up-0001.jsonl": {
      "sourcePath": "${HOME_DIR}/.claude/projects/-repo-gone/cleaned-up-0001.jsonl",
      "archivePath": "${ARCHIVE_ROOT}/-repo-gone/cleaned-up-0001.jsonl",
      "projectLabel": "-repo-gone",
      "sessionId": "cleaned-up-0001",
      "sizeBytes": 512,
      "mtimeMs": 1767603605000,
      "archivedAt": 1790000000000
    }
  }
}
JSON
printf '  隔离家目录：%s\n' "$HOME_DIR"
printf '  夹具会话：9 个（另有 1 个只剩归档副本的会话）\n'

CACHE_PATH="${HOME_DIR}/Library/Application Support/${BUNDLE_ID}/meta-cache-v2.json"

# ---------------------------------------------------------------------------
step "启动应用"
# ---------------------------------------------------------------------------
# 直接跑 bundle 里的可执行文件而不是 `open`：`open` 走 LaunchServices，
# 不会把自定义的 HOME 传进去，隔离就失效了。
# CCA_GUI_CAPTURE 让应用在渲染完成后把自己的 webview 渲染成 PDF（见 lib.rs 的
# gui_capture 模块）。这是**唯一**一条不需要「屏幕录制」权限的真机取图途径。
# CCA_GUI_PROBE 让应用在每张图之后额外取回一份几何事实。
#
# 采集计划（视图清单）：默认视图先取一张，然后按顺序点击每个目标各取一张。
# **第一个目标固定是「会话分析」**：应用会把上次所在的标签页记进 WebKit 的
# localStorage，而那份存储落在使用者真实的 ~/Library/WebKit（不受 HOME 隔离影响），
# 于是应用未必从「会话分析」启动——不先显式切回去，后面的会话点击会落空。
# 会话条目没有稳定的可访问名，靠它的 `title`（即 cwd）匹配；夹具会话的 cwd 固定为
# /repo/demo（见 web/tests/fixtures/session-basic.jsonl）；改夹具要同步改这里。
# 可用环境变量 CCA_GUI_CAPTURE_TAB 覆盖（逗号分隔），此时不做「视图覆盖」判定。
if [[ -n "${CCA_GUI_CAPTURE_TAB:-}" ]]; then
  COVERAGE=0
  IFS=',' read -r -a CAPTURE_TARGETS <<< "$CCA_GUI_CAPTURE_TAB"
else
  COVERAGE=1
  # 「日志视图」单独点名：分析器子视图也被记进那份 localStorage，不显式切回日志视图，
  # 打开会话后可能停在树视图——树视图没有记录表，末列可达那条就无从判定。
  # 「导出」紧跟日志视图：它只在会话打开且解析完成时才渲染，离开会话页就没了；
  # 后面立刻点「关闭导出窗口」，否则浮层的遮罩会挡住余下三个视图的点击。
  # `/repo/ansi` 必须在「日志视图」之后再点一次：上一步已经把子视图切成日志，
  # 但换会话不会自动回到日志视图，而终端转义那条不变量只在日志表里才有内容。
  # `滚动=main` 紧跟「用量总览」：用量页的下半屏（按项目 / 按模型 / 活跃时段
  # 三块面板）在 main 内部滚动，不滚过去永远取不到——判定脚本靠「上一步是
  # 用量总览」把三块面板的可达性判定挂在这一步上。
  # 「全局搜索」出现两次是开与关：顶栏按钮是 toggle，第二次点击同一个按钮
  # 即关闭浮层（探针在第两次点击前取证）。搜索浮层是 position: fixed，
  # createPDF 不画它，证据是那一步的几何探针（dialog 事实带 label）。
  #
  # `字号=130%` 紧跟第一张之后：此后**每一个视图都在 130% 下重新验一遍**，
  # 而它自己那一步停在会话列表上，正好拿到「放大后会话行不裁字」的几何事实。
  # 末尾的 `字号=100%` 是**清理**：WebKit 的 localStorage 不受 HOME 隔离，不切回来
  # 就把 130% 留给了使用者的真实应用与下一次运行。
  #
  # 上下文三步（Round J）插在「关闭导出窗口」之后：打开 /repo/compact-demo
  # （2 次压缩的夹具会话）→ 切「上下文」标签页（曲线 + 断崖 + 覆盖率 chip 的
  # 几何都在这一步判定）→ `点选=` 第 2 枚压缩事件 chip（取证卡打开态：卡片
  # 在视口内、被丢清单不是假列表）。chip 的可访问名带动态数字，通用扫描够
  # 不着，所以用 `点选=<data-probe 选择器>` 动作（同 `滚动=` 的动作协议）。
  # 插在导出之后是为了不动「导出只在会话打开时渲染」那串依赖；这三步全在
  # 会话分析页内完成，不影响后面的顶栏标签页。
  #
  # 错误档三步（Round N / N1）插在用量总览滚到底之后：「近 7 天」先把区间
  # 切到确定档（区间记忆落在**不隔离**的 WebKit localStorage 里，不点它柱数
  # 就不确定），「错误」切进分段档（趋势 SVG + 事件列表的几何在这一步判定），
  # 再一次「滚动=main」把事件面板滚进视口（可达性判定挂在「上一步是错误」上，
  # 同用量页三块面板的判法）。
  #
  # 「视图=用量」紧跟「用量总览」：N1 的「用量|错误」分段把选择也记进那份
  # 不隔离的 localStorage，上一次运行停在错误档时，点「用量总览」标签页只会
  # 得到错误档——表盘与三块面板根本不渲染。每次显式重置回用量档，门禁自愈
  # （同「前两步显式切回会话分析」的对策，只是对象换成了子视图状态维度）。
  #
  # 改动两步（Round N / N2）插在上下文三步之后：打开 /repo/changed-demo
  # （3 个文件的夹具会话）→ 切「改动」标签页（文件列表真列表的账目在这一步
  # 判定）→ `点选=` 首个文件行里的按钮（展开区可达 + 记录数与夹具一致）。
  # 「改动」这个二字名走通用按名点击是安全的：通用扫描先扫 tablist，而全部
  # tablist 里含「改动」二字的只有分析器子视图这一枚标签；文件行的可访问名
  # 虽也含「改动 N」，但它在第二扫描域（普通按钮），永远轮不到。
  # 点选目标写 `… button` 后缀：data-changes-file 挂在 li 上（行高账由 li 承载），
  # 而 toggle 的 click 在行按钮上——点 li 不会触发 React 的 onClick。
  #
  # 工具普查点选（Round N / N3）插在「滚动=main」之后、「近 7 天」之前：滚到底
  # 让「工具与 skill」面板进视口，`点选=` 榜首行（data-tool-census-row，挂行按钮
  # 上）打开下钻区（下钻在场、会话行是真列表的账目在这一步判定）。榜首恒为
  # Bash（夹具账见 install_fixture 处的注释），可访问名带动态数字，按稳定属性点。
  CAPTURE_TARGETS=("会话分析" "字号=130%" "/repo/demo" "日志视图" "/repo/ansi" "日志视图" "导出" "关闭导出窗口" "/repo/compact-demo" "上下文" "点选=[data-probe='compact-event-2']" "/repo/changed-demo" "改动" "点选=[data-changes-file='src/web/foo.ts'] button" "用量总览" "视图=用量" "滚动=main" "点选=[data-tool-census-row='Bash']" "近 7 天" "错误" "滚动=main" "全局搜索" "全局搜索" "实时监控" "字号=100%")
fi

# 逐项计算输出文件名：默认视图 `app-capture.pdf`；单个目标沿用旧名 `app-capture-tab.pdf`；
# 多个目标各用 `app-capture-<slug>.pdf`。同名目标第 2 次及以后再追加 `-<序号>`
# （「全局搜索」开与关就是同名的两次点击，不去重的话第二次会覆盖第一次的图与探针）。
# 探针 JSON 同规则、后缀换 .json。这套规则与 src-tauri/src/lib.rs 的
# tab_output_path / probe_output_path 一一对应。
#
# 计数不用关联数组（`declare -A` 是 bash 4+ 的，macOS 自带 bash 3.2 直接报
# invalid option——同 pitfalls 里「只在本地 macOS 暴露」的那一类）：数一遍已见
# 目标列表就够了，清单就十几个名字。结果走全局变量而不是命令替换——
# `$(count_seen …)` 在子 shell 里跑，数组追加传不回父 shell，第二次会被
# 算成第一次，脚本就和应用侧的 `-2` 文件名对不上了。
SEEN_TARGETS=()
SEEN_COUNT_OUT=0
count_seen() {
  local target="$1" n=0 item
  for item in ${SEEN_TARGETS[@]+"${SEEN_TARGETS[@]}"}; do
    [[ "$item" == "$target" ]] && n=$((n + 1))
  done
  SEEN_TARGETS[${#SEEN_TARGETS[@]}]="$target"
  SEEN_COUNT_OUT=$((n + 1))
}

declare -a CAPTURE_LABELS=("默认视图")
declare -a CAPTURE_PDFS=("$CAPTURE_PDF")
declare -a CAPTURE_SHOTS=("${ARTIFACT_DIR}/app-window.png")
declare -a CAPTURE_PROBES=("$CAPTURE_PROBE")
for _target in "${CAPTURE_TARGETS[@]}"; do
  [[ -n "$_target" ]] || continue
  count_seen "$_target"
  _nth="$SEEN_COUNT_OUT"
  if [[ ${#CAPTURE_TARGETS[@]} -eq 1 ]]; then
    _suffix="-tab"
  else
    _suffix="-$(slug_of "$_target")"
  fi
  if [[ "$_nth" -gt 1 ]]; then
    _suffix="${_suffix}-${_nth}"
  fi
  CAPTURE_LABELS+=("$_target")
  CAPTURE_PDFS+=("${WORK_DIR}/app-capture${_suffix}.pdf")
  CAPTURE_SHOTS+=("${ARTIFACT_DIR}/app-window${_suffix}.png")
  CAPTURE_PROBES+=("${WORK_DIR}/app-probe${_suffix}.json")
done
GUI_TAB_LIST="$(IFS=,; echo "${CAPTURE_TARGETS[*]}")"

if [[ -n "$GUI_TAB_LIST" ]]; then
  HOME="$HOME_DIR" CCA_GUI_CAPTURE="$CAPTURE_PDF" \
    CCA_GUI_CAPTURE_TAB="$GUI_TAB_LIST" CCA_GUI_PROBE="$CAPTURE_PROBE" \
    "$BIN" >"$APP_LOG" 2>&1 &
else
  HOME="$HOME_DIR" CCA_GUI_CAPTURE="$CAPTURE_PDF" CCA_GUI_PROBE="$CAPTURE_PROBE" \
    "$BIN" >"$APP_LOG" 2>&1 &
fi
APP_PID=$!
printf '  PID %s\n' "$APP_PID"
printf '  视图清单：%s\n' "${CAPTURE_LABELS[*]}"

# ---------------------------------------------------------------------------
step "断言：进程存活且没有崩溃"
# ---------------------------------------------------------------------------
ALIVE=1
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  if ! kill -0 "$APP_PID" 2>/dev/null; then ALIVE=0; break; fi
done

if [[ "$ALIVE" == "1" ]]; then
  ok "启动后持续存活 10 秒，未崩溃"
else
  bad "应用在 10 秒内退出了"
  printf '  %s  应用输出：%s\n' "$C_YELLOW" "$C_RESET"
  sed -n '1,20p' "$APP_LOG" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
step "记录：进程内存占用（不判定）"
# ---------------------------------------------------------------------------
# 这一条**只记录**，不参与通过/失败。
#
# 它原来是「RSS > 20MB ⇒ webview 已加载」的断言，那是过度声称。实测反例：
# 一个只装了空白 WKWebView 的最小窗口进程，RSS 就有 69MB / 16 线程——空白
# webview 本来就远在 20MB 之上，所以这个阈值挡不住「webview 没加载」，它
# 唯一能挡的是「进程连 WebKit 都没起来」，而那件事上一条「存活 10 秒」基本
# 已经覆盖了。
#
# 把阈值调高也救不回来：无论定多少，RSS 都分不出「我们的界面加载了」和
# 「一个空白 webview 挂在那儿」——两者是同一个量级。真想判它，得换判据
# （线程数、RSS 增量、渲染结果），而那属于另一件事，不该在这里偷偷换掉。
#
# 真正能证明 webview 加载 → React 挂载 → 渲染完成的，是下面「应用渲染自身
# 窗口」那一条：那张图是 WebKit 亲自画出来的界面。内存数字留在这里，只是
# 出问题时多一个诊断量。
if [[ "$ALIVE" == "1" ]]; then
  RSS_KB="$(ps -o rss= -p "$APP_PID" 2>/dev/null | tr -d ' ')"
  if [[ -n "$RSS_KB" ]]; then
    note "常驻内存 $((RSS_KB / 1024)) MB —— 不判定（空白 webview 也有 69MB）"
  else
    note "读不到常驻内存（进程可能已退出）"
  fi
fi

# ---------------------------------------------------------------------------
step "断言：应用读到了会话并写出缓存"
# ---------------------------------------------------------------------------
# 这条是整套测试里最有价值的一条：它要求
# webview → React → 桥接 → Rust → 文件系统 → 解析 → 写盘 整条链路都通。
CACHE_OK=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if [[ -f "$CACHE_PATH" ]]; then CACHE_OK=1; break; fi
  sleep 1
done

if [[ "$CACHE_OK" == "1" ]]; then
  ok "元数据缓存已生成：${CACHE_PATH#"$HOME_DIR"/}"

  CACHE_REPORT="$(python3 - "$CACHE_PATH" "$HOME_DIR" <<'PY' 2>&1
import json, sys, pathlib
cache, home = pathlib.Path(sys.argv[1]), sys.argv[2]
try:
    data = json.loads(cache.read_text(encoding="utf-8"))
except Exception as exc:
    print(f"PARSE_FAIL {exc}")
    raise SystemExit(0)
entries = data.get("entries") or {}
paths = list(entries)
outside = [p for p in paths if not p.startswith(home)]
archive_prefix = home + "/Library/Application Support/io.github.liang-zhenxiang.cc-analyzer/archive/"
archived = [p for p in paths if p.startswith(archive_prefix)]
print(f"COUNT {len(paths)}")
print(f"OUTSIDE {len(outside)}")
print(f"ARCHIVED {len(archived)}")
PY
)"
  COUNT="$(printf '%s\n' "$CACHE_REPORT" | grep '^COUNT ' | awk '{print $2}')"
  OUTSIDE="$(printf '%s\n' "$CACHE_REPORT" | grep '^OUTSIDE ' | awk '{print $2}')"

  if [[ "${COUNT:-}" == "10" ]]; then
    ok "缓存条目数 = 10（9 个夹具 + 1 个归档副本）"
  else
    bad "缓存条目数 = ${COUNT:-解析失败}，期望 10"
    printf '  %s  %s%s\n' "$C_YELLOW" "$CACHE_REPORT" "$C_RESET"
  fi

  # 归档链路的真机证据：应用必须把「源已被清理、只剩副本」的会话也发现并解析掉，
  # 缓存里因此会出现一条**键为归档副本路径**的条目。
  ARCHIVED="$(printf '%s\n' "$CACHE_REPORT" | grep '^ARCHIVED ' | awk '{print $2}')"
  if [[ "${ARCHIVED:-0}" == "1" ]]; then
    ok "归档副本被当作会话发现并解析（缓存里有一条副本路径的条目）"
  else
    bad "归档副本没有被发现（缓存里副本路径的条目数 = ${ARCHIVED:-解析失败}，期望 1）"
    printf '  %s  %s%s\n' "$C_YELLOW" "$CACHE_REPORT" "$C_RESET"
  fi

  if [[ "${OUTSIDE:-1}" == "0" ]]; then
    ok "全部条目都在隔离家目录内（没有读到使用者的真实会话）"
  else
    bad "有 $OUTSIDE 条缓存指向隔离目录之外 —— 隔离失效，测试碰到了真实数据"
  fi
else
  bad "15 秒内没有生成元数据缓存 —— 会话发现链路没走通"
  printf '  %s  应用输出：%s\n' "$C_YELLOW" "$C_RESET"
  sed -n '1,20p' "$APP_LOG" | sed 's/^/    /'
fi

# ---------------------------------------------------------------------------
# 逐视图取图：每张都走同一份「转 PNG + 非空白」判定（check_capture_pdf）。
# 取不到任何一张都计失败而不是跳过。
#
# 应用在渲染完成后会把**自己的 webview** 渲染成 PDF（`gui_capture` 模块）。
# 这条路走的是 WebKit 自身的渲染，**不经过截屏通道**，所以不需要「屏幕录制」权限。
#
# 早先这里用的是 `screencapture`，它必然失败——实测过，连「进程截自己的窗口」
# 都只能拿到一张尺寸正确但像素全透明的图。详见 .trellis/spec/testing/gui-tests.md。
# ---------------------------------------------------------------------------
mkdir -p "$ARTIFACT_DIR"

capture_one() {
  local label="$1" pdf="$2" shot="$3" title="$4"
  step "$title"
  rm -f "$shot"

  local waited=0
  for _ in {1..15}; do
    [[ -f "$pdf" ]] && { waited=1; break; }
    sleep 1
  done

  if [[ "$waited" != "1" ]]; then
    bad "${label}：应用没有产出取图 PDF——gui_capture 没跑起来或该视图没截到"
    sed -n '1,30p' "$APP_LOG" | sed 's/^/    /'
  else
    ok "${label}已渲染：$(wc -c < "$pdf" | tr -d ' ') 字节"
    check_capture_pdf "$pdf" "$shot" "$label"
  fi
}

capture_one "${CAPTURE_LABELS[0]}" "${CAPTURE_PDFS[0]}" "${CAPTURE_SHOTS[0]}" \
  "截图：应用真实窗口（默认视图）"

for _i in "${!CAPTURE_TARGETS[@]}"; do
  [[ -n "${CAPTURE_TARGETS[$_i]}" ]] || continue
  _slot=$((_i + 1))
  capture_one "「${CAPTURE_TARGETS[$_i]}」" "${CAPTURE_PDFS[$_slot]}" "${CAPTURE_SHOTS[$_slot]}" \
    "截图：点击「${CAPTURE_TARGETS[$_i]}」后"
done

# ---------------------------------------------------------------------------
step "断言：界面布局不变量（真机几何探针）"
# ---------------------------------------------------------------------------
# 应用侧只收集**原始几何事实**（`CCA_GUI_PROBE` 指向的 JSON，每张图一份），阈值与
# 判定在这里——事实在应用、断言在脚本。判据取几何关系（是否溢出、是否包含、是否
# 可达），与渲染引擎差异无关，绝不断言具体像素坐标或颜色。
#
# 先**逐份**等探针落盘：探针与取图都是异步回调，「PDF 到了」不等于「JSON 也到了」。
# 等不到的，在断言前先打一段归因诊断（路径 / 最后修改时间 / 应用日志里与这份探针相关
# 的行），把「应用没写出来」和「脚本等太短」直接分开——门禁要能一次定位，而不是只说
# 「没有产出」。缺失本身仍由下面的断言记为**失败**，这里只是把现场说清楚。
declare -a PROBE_MISSING=()
for _i in "${!CAPTURE_PROBES[@]}"; do
  if ! wait_for_probe "${CAPTURE_PROBES[$_i]}"; then
    PROBE_MISSING+=("${CAPTURE_LABELS[$_i]}::${CAPTURE_PROBES[$_i]}")
  fi
done
for _entry in "${PROBE_MISSING[@]:-}"; do
  [[ -n "$_entry" ]] || continue
  diagnose_missing_probe "${_entry%%::*}" "${_entry#*::}"
done

declare -a PROBE_ENTRIES=()
for _i in "${!CAPTURE_PROBES[@]}"; do
  PROBE_ENTRIES+=("${CAPTURE_LABELS[$_i]}::${CAPTURE_PROBES[$_i]}")
done

PROBE_STATUS=0
PROBE_REPORT="$(COVERAGE="$COVERAGE" python3 - "${PROBE_ENTRIES[@]}" <<'PY' 2>&1
import json
import os
import pathlib
import sys

GAUGE_MAX_WIDTH = 200
# 导出浮层的宽度上限来自设计规格（`min(480px, 100%)`）；真机窗口更窄时它自己
# 会收缩，所以只判「不超过上限且完整落在窗口内」，不判具体像素。
EXPORT_DIALOG_MAX_WIDTH = 480
EXPORT_DIALOG_LABEL = "导出"
# 浮层靠探针里 dialog 事实的 label 分流：导出浮层的可访问名来自
# aria-labelledby（指向标题 id「export-dialog-title」），搜索浮层是 aria-label
# 「全局搜索」。两种都是 [role=dialog][aria-modal]，不分流就会拿搜索浮层
# 去套导出浮层的 480px 上限。
EXPORT_DIALOG_TAG = "export-dialog-title"
SEARCH_DIALOG_LABEL = "全局搜索"
# 用量页下半屏的三块面板。「滚动=main」那一步（且上一步是用量总览）判定
# 它们滚一次可达；「用量总览」那一步判定它们真的渲染了出来。
USAGE_PANEL_TITLES = ["按项目分布", "按模型分布", "活跃时段（周 × 小时）"]
# 上下文标签页（Round J）。夹具 compact-session.jsonl（挂 /repo/compact-demo）
# 有 2 次压缩（auto + manual），future-widget/quantum-latch 共 3 行未识别——
# 「上下文」那一步据此判曲线命中区个数与覆盖率 chip 的在场。
CONTEXT_TAB_LABEL = "上下文"
CONTEXT_EVENT_COUNT = 2
# 错误档（Round N / N1）。门禁清单里「错误」前先点了「近 7 天」，趋势柱因此
# 是确定值；事件数 = 夹具 error-session 的 7 条（其余在窗夹具都没有错误信号）。
ERROR_TAB_LABEL = "错误"
ERROR_WINDOW_DAYS = 7
ERROR_EVENT_COUNT = 7
# 改动标签页（Round N / N2）。夹具 changed-files-session.jsonl（挂
# /repo/changed-demo）有 3 个文件（A cwd 内含新建/失败/子链、B 仅查看、C 项目外），
# 文件 A 的下钻清单 7 条——「改动」与「点选=」两步据此判文件列表的真列表账目
# 与展开区可达。
CHANGES_TAB_LABEL = "改动"
CHANGES_FILE_COUNT = 3
CHANGES_RECORD_COUNT = 7
# 工具与 skill 面板（Round N / N3）。夹具账（任意区间档 7/30/90 都成立）：
# 窗内工具调用来自 tool-census-session 与 error-session（changed-files 只在
# 30/90 天档入窗，且其 Edit/Read/Write 与前两者重类不重名）——内置工具恒
# 8 类 → 主榜 7 行（Top-6 + 折尾），榜首恒为 Bash（并列 7 次时按名字稳定
# 排序胜出）；skill 恒 3 行、子 agent 恒 1 行、MCP 恒 2 行。
CENSUS_PANEL_TITLE = "工具与 skill"
CENSUS_RANK_LABEL = "内置工具调用排行"
CENSUS_RANK_ROWS = 7
CENSUS_TOP_ROW = "Bash"
coverage = os.environ.get("COVERAGE") == "1"
seen_gauge = 0
seen_table = 0
seen_rows = 0
seen_billing = 0
seen_usage_panels = 0
seen_census = 0
seen_context = 0
seen_error = 0
seen_changes = 0

# 「滚动=main」的判定要知道滚的是哪个页面：清单是有序的，靠上一步的 label
# 把动作与页面挂上钩（默认清单里它紧跟「用量总���」）。自定义清单把它用在
# 别处时，三块面板的判定不适用，退化为 NOTE。
prev_label = None

for arg in sys.argv[1:]:
    label, _, path = arg.partition("::")
    probe = pathlib.Path(path)
    if not probe.is_file():
        print(f"BAD|{label}：几何探针没有产出（{probe}）")
        continue
    try:
        data = json.loads(probe.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - 解析失败就是失败
        print(f"BAD|{label}：探针 JSON 解析失败（{exc}）")
        continue

    doc = data.get("document") or {}
    sw, cw = doc.get("scrollWidth"), doc.get("clientWidth")
    if isinstance(sw, int) and isinstance(cw, int):
        if sw <= cw + 1:
            print(f"OK|{label}：文档无横向溢出（scrollWidth {sw} ≤ clientWidth {cw}）")
        else:
            print(f"BAD|{label}：文档横向溢出（scrollWidth {sw} > clientWidth {cw}）")
    else:
        print(f"NOTE|{label}：探针缺少文档宽度，跳过横向溢出判定")

    main = data.get("main")
    if isinstance(main, dict) and isinstance(main.get("scrollWidth"), int) \
            and isinstance(main.get("clientWidth"), int):
        msw, mcw = main["scrollWidth"], main["clientWidth"]
        if msw <= mcw + 1:
            print(f"OK|{label}：主内容区无横向溢出（main scrollWidth {msw} ≤ clientWidth {mcw}）")
        else:
            print(f"BAD|{label}：主内容区横向溢出（main scrollWidth {msw} > clientWidth {mcw}，overflowX={main.get('overflowX')}）")

    # 终端转义序列被当文本渲染 = 用户看到乱码（ANSI 保真的真机判据）。
    escaped = data.get("escaped_text")
    if isinstance(escaped, int):
        if escaped == 0:
            print(f"OK|{label}：渲染出来的文字里没有终端转义字节")
        else:
            print(f"BAD|{label}：界面上出现了 {escaped} 个 ESC 控制字节——终端转义没被解析，用户看到的是乱码")
    else:
        print(f"NOTE|{label}：探针缺少 escaped_text，跳过终端转义判定")

    for el in data.get("elements") or []:
        if el.get("name") != "gauge":
            continue
        seen_gauge += 1
        rect = el.get("rect") or {}
        card = el.get("card") or {}
        width, height = rect.get("width"), rect.get("height")
        if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
            print(f"BAD|{label}：表盘矩形缺失")
            continue
        inside = True
        if isinstance(card.get("width"), (int, float)) and isinstance(card.get("height"), (int, float)):
            inside = (
                rect.get("x", 0) >= card.get("x", 0) - 1
                and rect.get("y", 0) >= card.get("y", 0) - 1
                and rect.get("x", 0) + width <= card.get("x", 0) + card["width"] + 1
                and rect.get("y", 0) + height <= card.get("y", 0) + card["height"] + 1
            )
        if width <= GAUGE_MAX_WIDTH and inside:
            print(f"OK|{label}：表盘有界且含于卡片（{width:.0f}×{height:.0f}px ≤ {GAUGE_MAX_WIDTH}px，卡片内）")
        else:
            print(f"BAD|{label}：表盘失界（宽度 {width:.0f}px，阈值 {GAUGE_MAX_WIDTH}px，含于卡片={inside}）")

    for tbl in data.get("tables") or []:
        seen_table += 1
        container = tbl.get("container") or {}
        ccw, csw = container.get("clientWidth"), container.get("scrollWidth")
        overflow_x = container.get("overflowX")
        right = container.get("right")
        last = tbl.get("lastColumnRight")
        if not isinstance(ccw, int) or not isinstance(csw, int):
            print(f"BAD|{label}：记录表容器几何缺失")
            continue
        reachable = (
            isinstance(last, (int, float))
            and isinstance(right, (int, float))
            and last <= right + 1
        )
        scrollable = overflow_x in ("auto", "scroll") and csw > ccw + 1
        if reachable:
            print(f"OK|{label}：记录表末列未越界（末列右边界 {last:.0f} ≤ 容器右边界 {right:.0f}）")
        elif scrollable and tbl.get("hasScrollHint"):
            print(f"OK|{label}：记录表末列可横向滚达（scrollWidth {csw} > clientWidth {ccw}，有滚动提示）")
        else:
            print(f"BAD|{label}：记录表末列被裁切（末列右边界 {last}，容器右边界 {right}，overflowX={overflow_x}，可滚动={scrollable}，提示={tbl.get('hasScrollHint')}）")

    export_seen = 0
    search_seen = 0
    viewport = data.get("viewport") or {}
    for el in data.get("elements") or []:
        if el.get("name") != "dialog":
            continue
        dialog_label = el.get("label") or ""
        rect = el.get("rect") or {}
        width, height = rect.get("width"), rect.get("height")
        if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
            print(f"BAD|{label}：浮层（{dialog_label or '未命名'}）矩形缺失")
            continue
        inside = (
            isinstance(viewport.get("width"), (int, float))
            and isinstance(viewport.get("height"), (int, float))
            and rect.get("x", 0) >= -1
            and rect.get("y", 0) >= -1
            and rect.get("x", 0) + width <= viewport["width"] + 1
            and rect.get("y", 0) + height <= viewport["height"] + 1
        )
        if dialog_label == EXPORT_DIALOG_TAG:
            export_seen += 1
            if width <= EXPORT_DIALOG_MAX_WIDTH + 1 and inside:
                print(f"OK|{label}：导出浮层有界且完整在窗口内（{width:.0f}×{height:.0f}px ≤ {EXPORT_DIALOG_MAX_WIDTH}px）")
            else:
                print(f"BAD|{label}：导出浮层失界（宽 {width:.0f}px，上限 {EXPORT_DIALOG_MAX_WIDTH}px，在窗口内={inside}）")
        elif dialog_label == SEARCH_DIALOG_LABEL:
            search_seen += 1
            if inside:
                print(f"OK|{label}：搜索浮层完整在窗口内（{width:.0f}×{height:.0f}px）")
            else:
                print(f"BAD|{label}：搜索浮层超出窗口（{width:.0f}×{height:.0f}px，在窗口内={inside}）")
        else:
            print(f"NOTE|{label}：出现未识别的浮层（label={dialog_label}），只记录几何")

    # 目标就是「导出」/「全局搜索」时，浮层出现是这一步的全部意义——没出现比
    # 尺寸错了更严重。「全局搜索」在默认清单里连点两次（开与关）：第二次点击
    # 时浮层应当已经关上（上一步还是「全局搜索」），不算缺失。
    if label == EXPORT_DIALOG_LABEL and export_seen == 0:
        print(f"BAD|{label}：探针里没有导出浮层——点击没有打开它，或面板整个没渲染出来")
    if label == SEARCH_DIALOG_LABEL and search_seen == 0 and prev_label != SEARCH_DIALOG_LABEL:
        print(f"BAD|{label}：探针里没有搜索浮层——顶栏按钮没有打开它，或浮层整个没渲染出来")
    # 浮层是 `position: fixed`，而 `WKWebView.createPDF` **不会把它画进 PDF**：
    # 实测「导出」这一步的 PDF 只比前一张多 117 字节（480×424 的浮层若入图不可能
    # 只差这么点），设置面板同样不入图。所以这张截图的证据价值是「它背后的视图」，
    # 浮层本身由上面的几何不变量与端到端断言负责——别对着截图找浮层。
    if export_seen > 0 or search_seen > 0:
        print(f"NOTE|{label}：浮层是 position: fixed，createPDF 不渲染它——这张截图看的是背后的视图，浮层证据是上面的几何不变量")

    # 限额区（5 小时卡 + 周用量层）：两层限额的读数都要在卡内，卡要在内容区里。
    # 「含于内容区」横向对着 main 的视口矩形判；纵向不判视口位置（卡片可以滚到
    # 视口外），判的是它含于 main 的滚动内容（docTop 落在 [0, scrollHeight]）。
    for el in data.get("elements") or []:
        if el.get("name") != "billing":
            continue
        seen_billing += 1
        card = el.get("card") or {}
        if not isinstance(card.get("width"), (int, float)) or not isinstance(card.get("height"), (int, float)):
            print(f"BAD|{label}：计费窗口卡矩形缺失")
            continue
        problems = []

        def billing_contains(inner, what):
            if not isinstance(inner, dict) or not isinstance(inner.get("width"), (int, float)) or not isinstance(inner.get("height"), (int, float)):
                problems.append(f"{what}矩形缺失")
                return
            if not (
                inner.get("x", 0) >= card.get("x", 0) - 1
                and inner.get("y", 0) >= card.get("y", 0) - 1
                and inner.get("x", 0) + inner["width"] <= card.get("x", 0) + card["width"] + 1
                and inner.get("y", 0) + inner["height"] <= card.get("y", 0) + card["height"] + 1
            ):
                problems.append(f"{what}不完全在卡片内")

        billing_contains(el.get("weekly"), "周用量层")
        for value_index, value in enumerate(el.get("values") or []):
            billing_contains(value, f"限额读数#{value_index + 1}")
        main_rect = data.get("mainRect") or {}
        if isinstance(main_rect.get("x"), (int, float)) and isinstance(main_rect.get("width"), (int, float)):
            if not (
                card.get("x", 0) >= main_rect["x"] - 1
                and card.get("x", 0) + card.get("width", 0) <= main_rect["x"] + main_rect["width"] + 1
            ):
                problems.append("卡片横向超出内容区")
        main_info = data.get("main") or {}
        scroll_top, scroll_height = main_info.get("scrollTop"), main_info.get("scrollHeight")
        if isinstance(scroll_top, int) and isinstance(scroll_height, int):
            card_doc_top = card.get("y", 0) + scroll_top
            if card_doc_top < -1 or card_doc_top + card.get("height", 0) > scroll_height + 1:
                problems.append(f"卡片纵向超出内容区（docTop {card_doc_top:.0f}，高 {card.get('height', 0):.0f}，scrollHeight {scroll_height}）")
        if problems:
            for problem in problems:
                print(f"BAD|{label}：两层限额几何破坏——{problem}")
        else:
            values_count = len(el.get("values") or [])
            print(f"OK|{label}：两层限额的读数都在卡片内、卡片含于内容区（周用量层 + {values_count} 个读数）")

    # 用量页的面板标题：在「视图=用量」步骤判定「三块面板真的渲染了出来」——
    # 不能挂在「用量总览」标签页本身：N1 的「用量|错误」分段把选择记进真实
    # WebKit 的 localStorage，上一次运行停在错误档时，点进标签页渲染的是错误
    # 档（表盘与三块面板都不在），显式重置（视图=用量）之后的判定才有意义。
    # 滚动一步（且上一步是用量总览或视图=用量）判定「滚一次就能到达」——面板
    # 被懒加载吞掉、或页面重新长过一屏都会在这里红。docTop 是标题在滚动内容
    # 里的位置。
    panels = data.get("panels") or []
    if label == "视图=用量":
        titles = {p.get("title") for p in panels}
        missing = [t for t in USAGE_PANEL_TITLES if t not in titles]
        if missing:
            print(f"BAD|{label}：用量面板没有渲染出来（缺：{'，'.join(missing)}）")
        else:
            seen_usage_panels += 1
            print(f"OK|{label}：三块用量面板都在文档里（标题齐全）")
        # 工具与 skill 面板（N3）同档在场：面板标题 + 体首行双读数（夹具保证
        # 窗内必有工具调用，全空态在这里就是失败——面板没接上聚合）。
        census = data.get("toolCensus") or {}
        census_total = census.get("total") or ""
        if census.get("view") is not True or CENSUS_PANEL_TITLE not in titles:
            print(f"BAD|{label}：工具与 skill 面板没有渲染出来（探针锚点或面板标题缺失）")
        elif not (census_total.startswith("共 ") and " 主链 " in census_total and "子 agent 占 " in census_total):
            print(f"BAD|{label}：工具与 skill 的体首行双读数缺失或形状不对（{census_total!r}）")
        else:
            seen_census += 1
            print(f"OK|{label}：工具与 skill 面板在场，体首行双读数齐全（{census_total}）")
    elif label.startswith("滚动=") and prev_label in ("用量总览", "视图=用量"):
        problems = []
        main_info = data.get("main") or {}
        scroll_top, client_height = main_info.get("scrollTop"), main_info.get("clientHeight")
        viewport_height = (data.get("viewport") or {}).get("height")
        for title in USAGE_PANEL_TITLES:
            hit = next((p for p in panels if p.get("title") == title), None)
            if hit is None:
                problems.append(f"面板「{title}」不在文档里")
                continue
            doc_top, top = hit.get("docTop"), hit.get("top")
            if isinstance(scroll_top, int) and isinstance(client_height, int) and isinstance(doc_top, (int, float)) and doc_top > scroll_top + client_height + 1:
                problems.append(f"「{title}」滚一次到不了（docTop {doc_top:.0f} > scrollTop {scroll_top} + clientHeight {client_height}）")
            if isinstance(viewport_height, (int, float)) and isinstance(top, (int, float)) and (top < -1 or top > viewport_height + 1):
                problems.append(f"「{title}」滚到底后仍不在视口内（top {top:.0f}，视口高 {viewport_height:.0f}）")
        # 工具与 skill（N3）滚一次可达 + 主榜清单是真列表（行高测 li，账目与
        # <ul> 自己的 scrollHeight 对——被丢清单的判法）。此处不判「滚到底后
        # 在视口内」：面板常高约 300px，若上方内容把它顶出最终视口，那是页面
        # 变长的自然结果，可达性（docTop）才是这里的不变量。
        census = data.get("toolCensus") or {}
        census_hit = next((p for p in panels if p.get("title") == CENSUS_PANEL_TITLE), None)
        if census_hit is None or census.get("view") is not True:
            problems.append(f"面板「{CENSUS_PANEL_TITLE}」不在文档里（探针锚点缺失）")
        else:
            doc_top = census_hit.get("docTop")
            if isinstance(scroll_top, int) and isinstance(client_height, int) and isinstance(doc_top, (int, float)) and doc_top > scroll_top + client_height + 1:
                problems.append(f"「{CENSUS_PANEL_TITLE}」滚一次到不了（docTop {doc_top:.0f} > scrollTop {scroll_top} + clientHeight {client_height}）")
            rank = next((l for l in census.get("lists") or [] if l.get("label") == CENSUS_RANK_LABEL), None)
            if rank is None:
                problems.append("主榜清单没有产出滚动几何（data-tool-census-list）")
            else:
                rows, row_h = rank.get("rows"), rank.get("firstRowHeight")
                scroll_h = rank.get("listScrollHeight")
                if rows != CENSUS_RANK_ROWS:
                    problems.append(f"主榜 {rows!r} 行，期望 {CENSUS_RANK_ROWS}（Top-6 + 折尾，夹具账）")
                if not isinstance(row_h, (int, float)) or row_h <= 0 or not isinstance(scroll_h, int):
                    problems.append(f"主榜行高/总高缺失（firstRowHeight={row_h!r}，scrollHeight={scroll_h!r}）")
                elif abs(scroll_h - rows * row_h) > 4:
                    problems.append(f"主榜总高 {scroll_h}px ≠ {rows} 行 × {row_h:.1f}px——声称的行数没有对应的内容高度")
        if problems:
            for problem in problems:
                print(f"BAD|{label}：{problem}")
        else:
            seen_usage_panels += 1
            if census_hit is not None:
                seen_census += 1
            print(f"OK|{label}：滚一次到底后三块面板与工具普查主榜全部可达（scrollTop {scroll_top} / scrollHeight {main_info.get('scrollHeight')}）")
    elif label.startswith("滚动="):
        print(f"NOTE|{label}：上一步不在用量页（是 {prev_label}），跳过三块面板的可达性判定")

    # 界面字号：动作目标（`字号=<档位>`）必须真的把根元素变量切过去。
    font_scale_raw = data.get("font_scale")
    font_scale = None
    if isinstance(font_scale_raw, str):
        try:
            font_scale = float(font_scale_raw)
        except ValueError:
            font_scale = None
    if label.startswith("字号="):
        expected = label.split("=", 1)[1]
        want = {"90%": "0.9", "100%": "1", "110%": "1.1", "120%": "1.2", "130%": "1.3"}.get(expected)
        if want is not None and font_scale_raw == want:
            print(f"OK|{label}：界面字号已切到 {expected}（根元素 --font-scale={font_scale_raw}）")
        else:
            print(f"BAD|{label}：字号没切过去（根元素 --font-scale={font_scale_raw!r}，期望 {want!r}）")

    # 上下文标签页（Round J）：曲线 SVG 存在且 viewBox 有界、压缩命中区数量与
    # 夹具的压缩次数一致、M>0 的会话上覆盖率 chip 真的在场。
    if label == CONTEXT_TAB_LABEL:
        ctx = data.get("context") or {}
        chart = ctx.get("chart")
        if not isinstance(chart, dict):
            print(f"BAD|{label}：上下文视图没有产出曲线 SVG——标签页没切过去，或整块没渲染")
        else:
            problems = []
            try:
                vb = [float(part) for part in (chart.get("viewBox") or "").split()]
            except (TypeError, ValueError):
                vb = []
            if len(vb) != 4 or not (0 < vb[2] <= 4096 and 0 < vb[3] <= 4096):
                problems.append(f"viewBox 失界（{chart.get('viewBox')!r}，期望 4 个数且宽高在 (0, 4096]）")
            hits = chart.get("eventHits")
            if hits != CONTEXT_EVENT_COUNT:
                problems.append(f"压缩命中区 {hits!r} 个，期望 {CONTEXT_EVENT_COUNT}（夹具 compact-session 的压缩次数）")
            if problems:
                for problem in problems:
                    print(f"BAD|{label}：上下文曲线——{problem}")
            else:
                seen_context += 1
                print(f"OK|{label}：曲线 SVG 有界（viewBox {chart.get('viewBox')}），命中区 {hits} 个 = 夹具压缩次数")
        chip = ctx.get("coverageChip")
        if not isinstance(chip, dict) or "行未识别" not in (chip.get("text") or ""):
            print(f"BAD|{label}：解析覆盖率 chip 缺失或文本不含「行未识别」——夹具会话有 3 行未识别，M>0 时 chip 必须在场")
        else:
            print(f"OK|{label}：覆盖率 chip 在场（「{chip['text']}」）")

    # 错误档（Round N / N1）：趋势 SVG 有界且柱数 = 区间天数（零填充天也有
    # 短桩）、事件列表是真列表（行高 × 声明行数对总高的账，同被丢清单的判法）。
    # 几何事实由应用的探针收集（facts.error），阈值与判定只在这里。
    if label == ERROR_TAB_LABEL:
        err = data.get("error") or {}
        if err.get("view") is not True:
            print(f"BAD|{label}：错误档没有产出锚点（data-error-view）——分段没切过去，或整块没渲染")
        else:
            problems = []
            trend = err.get("trend")
            if not isinstance(trend, dict):
                problems.append("趋势 SVG 缺失（data-error-trend）")
            else:
                try:
                    vb = [float(part) for part in (trend.get("viewBox") or "").split()]
                except (TypeError, ValueError):
                    vb = []
                if len(vb) != 4 or not (0 < vb[2] <= 4096 and 0 < vb[3] <= 4096):
                    problems.append(f"趋势 viewBox 失界（{trend.get('viewBox')!r}）")
                bars = trend.get("bars")
                if bars != ERROR_WINDOW_DAYS:
                    problems.append(f"趋势柱 {bars!r} 根，期望 {ERROR_WINDOW_DAYS}（清单先点了「近 7 天」，零填充天也有短桩）")
            events = err.get("events")
            if not isinstance(events, dict) or not isinstance(events.get("declaredCount"), int):
                problems.append("事件列表没有产出滚动几何（data-error-events）或行数读不出")
            else:
                declared = events["declaredCount"]
                row_h = events.get("firstRowHeight")
                scroll_h = events.get("listScrollHeight")
                pads = [p for p in (events.get("padHeights") or []) if isinstance(p, (int, float))]
                visible = events.get("visibleRows")
                if declared != ERROR_EVENT_COUNT:
                    problems.append(f"事件声明 {declared!r} 条，期望 {ERROR_EVENT_COUNT}（夹具 error-session 的错误数）")
                if not isinstance(row_h, (int, float)) or row_h <= 0 or not isinstance(scroll_h, int):
                    problems.append(f"行高/总高缺失（firstRowHeight={row_h!r}，scrollHeight={scroll_h!r}）")
                elif abs(scroll_h - declared * row_h) > 4:
                    problems.append(f"事件列表总高 {scroll_h}px ≠ {declared} 行 × {row_h}px——声称的行数没有对应的内容高度")
                if pads:
                    if not isinstance(visible, int):
                        problems.append("窗口化生效但可见行数缺失")
                    elif abs(scroll_h - (sum(pads) + visible * row_h)) > 4:
                        problems.append(f"垫片 {sum(pads)}px + 可见 {visible} 行 × {row_h}px ≠ 总高 {scroll_h}px——垫片没按行数算")
                elif visible != declared:
                    problems.append(f"无垫片时可见行 {visible!r} ≠ 声明 {declared}——列表没铺全，或行数算错")
            if problems:
                for problem in problems:
                    print(f"BAD|{label}：错误档——{problem}")
            else:
                seen_error += 1
                print(f"OK|{label}：趋势 SVG 有界且 {ERROR_WINDOW_DAYS} 根柱，事件列表是真列表（{events['declaredCount']} 行 × {events['firstRowHeight']:.1f}px ≈ 总高 {events['listScrollHeight']}px）")

    # 错误档滚到底：事件面板要滚一次可达（docTop 对 main 滚动几何判，同用量
    # 页三块面板的判法）。
    if label.startswith("滚动=") and prev_label == ERROR_TAB_LABEL:
        err = data.get("error") or {}
        if err.get("view") is not True:
            print(f"BAD|{label}：上一步是错误档，这一步却不见了 data-error-view——切档状态丢了")
        else:
            problems = []
            main_info = data.get("main") or {}
            scroll_top, client_height = main_info.get("scrollTop"), main_info.get("clientHeight")
            hit = next((p for p in (data.get("panels") or []) if p.get("title") == "错误事件"), None)
            if hit is None:
                problems.append("面板「错误事件」不在文档里")
            elif isinstance(scroll_top, int) and isinstance(client_height, int) and isinstance(hit.get("docTop"), (int, float)) and hit["docTop"] > scroll_top + client_height + 1:
                problems.append(f"「错误事件」滚一次到不了（docTop {hit['docTop']:.0f} > scrollTop {scroll_top} + clientHeight {client_height}）")
            if not isinstance(err.get("events"), dict):
                problems.append("事件列表的滚动几何不见了（data-error-events）")
            if problems:
                for problem in problems:
                    print(f"BAD|{label}：错误档滚到底——{problem}")
            else:
                print(f"OK|{label}：错误事件面板滚一次可达，列表几何仍在（scrollTop {scroll_top} / scrollHeight {main_info.get('scrollHeight')}）")

    # 改动标签页（Round N / N2）：文件列表是真列表（行高 × 声明行数对总高的账，
    # 同被丢清单 / 错误事件列表的判法——li 承载行高、button 拉伸填满，N1 教训）。
    # 几何事实由应用的探针收集（facts.changes），阈值与判定只在这里。
    if label == CHANGES_TAB_LABEL:
        ch = data.get("changes") or {}
        if ch.get("view") is not True:
            print(f"BAD|{label}：改动视图没有产出锚点（data-changes-view）——标签页没切过去，或整块没渲染")
        else:
            problems = []
            files = ch.get("files")
            if not isinstance(files, dict) or not isinstance(files.get("declaredCount"), int):
                problems.append("文件列表没有产出滚动几何（data-changes-files）或行数读不出")
            else:
                declared = files["declaredCount"]
                row_h = files.get("firstRowHeight")
                scroll_h = files.get("listScrollHeight")
                pads = [p for p in (files.get("padHeights") or []) if isinstance(p, (int, float))]
                visible = files.get("visibleRows")
                if declared != CHANGES_FILE_COUNT:
                    problems.append(f"文件声明 {declared!r} 个，期望 {CHANGES_FILE_COUNT}（夹具 changed-files 的文件数）")
                if not isinstance(row_h, (int, float)) or row_h <= 0 or not isinstance(scroll_h, int):
                    problems.append(f"行高/总高缺失（firstRowHeight={row_h!r}，scrollHeight={scroll_h!r}）")
                elif abs(scroll_h - declared * row_h) > 4:
                    problems.append(f"文件列表总高 {scroll_h}px ≠ {declared} 行 × {row_h}px——声称的行数没有对应的内容高度")
                if pads:
                    if not isinstance(visible, int):
                        problems.append("窗口化生效但可见行数缺失")
                    elif abs(scroll_h - (sum(pads) + visible * row_h)) > 4:
                        problems.append(f"垫片 {sum(pads)}px + 可见 {visible} 行 × {row_h}px ≠ 总高 {scroll_h}px——垫片没按行数算")
                elif visible != declared:
                    problems.append(f"无垫片时可见行 {visible!r} ≠ 声明 {declared}——列表没铺全，或行数算错")
            if problems:
                for problem in problems:
                    print(f"BAD|{label}：改动视图——{problem}")
            else:
                seen_changes += 1
                print(f"OK|{label}：文件列表是真列表（{files['declaredCount']} 行 × {files['firstRowHeight']:.1f}px ≈ 总高 {files['listScrollHeight']}px）")

    # 点选改动文件行之后：展开区要真的渲染且记录数与夹具一致；账目把展开区
    # 的高度也算进去（它是紧跟文件行的变高 li）。
    if label.startswith("点选=") and prev_label == CHANGES_TAB_LABEL:
        ch = data.get("changes") or {}
        problems = []
        if ch.get("view") is not True:
            problems.append("改动视图不见了（data-changes-view）——切档状态丢了")
        records = ch.get("records")
        if not isinstance(records, dict) or not isinstance(records.get("rows"), int):
            problems.append("展开区没有渲染（data-changes-records）——文件行点击没生效")
        elif records["rows"] != CHANGES_RECORD_COUNT:
            problems.append(f"展开区记录 {records['rows']!r} 条，期望 {CHANGES_RECORD_COUNT}（夹具文件 A 的记录数）")
        elif not isinstance(records.get("height"), int) or records["height"] <= 0:
            problems.append("展开区高度为零——记录行没有铺开")
        files = ch.get("files")
        if (
            isinstance(files, dict)
            and isinstance(files.get("firstRowHeight"), (int, float))
            and isinstance(files.get("declaredCount"), int)
            and isinstance(records, dict)
            and isinstance(records.get("height"), int)
        ):
            expected = files["declaredCount"] * files["firstRowHeight"] + records["height"]
            if abs(files.get("listScrollHeight", 0) - expected) > 4:
                problems.append(
                    f"总高 {files.get('listScrollHeight')}px ≠ {files['declaredCount']} 行 × "
                    f"{files['firstRowHeight']:.1f}px + 展开 {records['height']}px——展开区没按行高入账"
                )
        if problems:
            for problem in problems:
                print(f"BAD|{label}：改动展开区——{problem}")
        else:
            seen_changes += 1
            print(f"OK|{label}：展开区可达（{records['rows']} 条记录，高 {records['height']}px），账目含展开高度")

    # 工具普查点选（Round N / N3）：点榜单首行（data-tool-census-row，值 = 行
    # label）后下钻区要在场——过滤态锚点的值就是被点的行名（「点击没落地」与
    # 「落地了但列表没渲染」靠它分辨），会话行是真列表（行高 × 行数对 <ul>
    # 自己总高的账，同被丢清单的判法），四栏清单不因下钻在场而消失。
    if label.startswith("点选=") and "tool-census" in label:
        census = data.get("toolCensus") or {}
        problems = []
        if census.get("view") is not True:
            problems.append("面板不见了（data-tool-census）——用量档状态丢了")
        else:
            if census.get("filter") != CENSUS_TOP_ROW:
                problems.append(f"下钻过滤态是 {census.get('filter')!r}，期望 {CENSUS_TOP_ROW!r}——点击没落地或选中丢失")
            sessions = census.get("sessions")
            if not isinstance(sessions, dict) or not isinstance(sessions.get("rows"), int):
                problems.append("下钻会话列表没有渲染（data-tool-census-sessions）")
            else:
                row_h, scroll_h = sessions.get("firstRowHeight"), sessions.get("listScrollHeight")
                if sessions["rows"] < 1:
                    problems.append("下钻会话行数 < 1——topSessions 没接上")
                elif not isinstance(row_h, (int, float)) or row_h <= 0 or not isinstance(scroll_h, int):
                    problems.append(f"下钻行高/总高缺失（firstRowHeight={row_h!r}，scrollHeight={scroll_h!r}）")
                elif abs(scroll_h - sessions["rows"] * row_h) > 4:
                    problems.append(f"下钻总高 {scroll_h}px ≠ {sessions['rows']} 行 × {row_h:.1f}px——声称的行数没有对应的内容高度")
            rank = next((l for l in census.get("lists") or [] if l.get("label") == CENSUS_RANK_LABEL), None)
            if rank is None:
                problems.append("主榜清单不见了——下钻在场不该让四栏位移或消失")
        if problems:
            for problem in problems:
                print(f"BAD|{label}：工具普查下钻——{problem}")
        else:
            seen_census += 1
            print(f"OK|{label}：下钻区在场（过滤 {census.get('filter')}，{census['sessions']['rows']} 行 × {census['sessions']['firstRowHeight']:.1f}px ≈ 总高 {census['sessions']['listScrollHeight']}px），主榜仍在")

    # 点选压缩事件 chip 之后：取证卡要在视口内、被丢清单不能是「假列表」。
    # 防「假列表」的核心判据是滚动内容的总高 ≈ 声明行数 × 行高——清单只铺
    # 几十行却声称几百条、或垫片高度不随行数变，都会在这里红。当前夹具 82 条
    # 低于窗口化阈值（120），走「无垫片、全量铺开」分支；垫片分支为更大的
    # 清单留判据（事实在应用、断言在此，两个分支都成立才叫防得住）。
    # （改动视图与工具普查各有自己的「点选=」步骤——前者由 prev_label 分流
    #   （见上面改动档），后者由选择器里的 tool-census 分流（见上面工具普查段）。）
    if label.startswith("点选=") and "tool-census" not in label and prev_label != CHANGES_TAB_LABEL:
        ctx = data.get("context") or {}
        viewport = data.get("viewport") or {}
        card = ctx.get("forensicCard")
        if not isinstance(card, dict):
            print(f"BAD|{label}：取证卡没有渲染——chip 点击没生效，或事件面板整个缺失")
        else:
            rect = card.get("rect") or {}
            inside = (
                isinstance(viewport.get("width"), (int, float))
                and rect.get("x", -1) >= -1
                and rect.get("y", -1) >= -1
                and rect.get("x", 0) + rect.get("width", 0) <= viewport.get("width", 0) + 1
                and rect.get("y", 0) + rect.get("height", 0) <= viewport.get("height", 0) + 1
            )
            if inside:
                print(f"OK|{label}：取证卡完整落在视口内（{rect.get('width', 0):.0f}×{rect.get('height', 0):.0f}px）")
            else:
                print(f"BAD|{label}：取证卡超出视口（rect x={rect.get('x')} y={rect.get('y')} w={rect.get('width')} h={rect.get('height')}，视口 {viewport.get('width')}×{viewport.get('height')}）")
        dropped = ctx.get("dropped")
        if not isinstance(dropped, dict) or not isinstance(dropped.get("declaredCount"), int):
            print(f"BAD|{label}：被丢清单没有产出滚动几何——清单没渲染，或标题里的行数读不出来")
        else:
            declared = dropped["declaredCount"]
            row_h = dropped.get("firstRowHeight")
            # 行数 × 行高的账对 <ul> 自己的总高（listScrollHeight）：滚动容器的
            # scrollHeight 含上下内边距（130% 字号实测 +32px），对容器对账会把
            # 内边距误判成「假列表」——量同一个元素，账才平（同「行高断言」教训）。
            scroll_h = dropped.get("listScrollHeight", dropped.get("scrollHeight"))
            pads = [p for p in (dropped.get("padHeights") or []) if isinstance(p, (int, float))]
            visible = dropped.get("visibleRows")
            problems = []
            if not isinstance(row_h, (int, float)) or row_h <= 0 or not isinstance(scroll_h, int):
                problems.append(f"行高/总高缺失（firstRowHeight={row_h!r}，scrollHeight={scroll_h!r}）")
            elif abs(scroll_h - declared * row_h) > 4:
                problems.append(f"清单总高 {scroll_h}px ≠ {declared} 行 × {row_h}px——声称的行数没有对应的内容高度")
            if pads:
                if not isinstance(visible, int) or not isinstance(row_h, (int, float)):
                    problems.append("窗口化生效但可见行数/行高缺失")
                elif abs(scroll_h - (sum(pads) + visible * row_h)) > 4:
                    problems.append(f"垫片 {sum(pads)}px + 可见 {visible} 行 × {row_h}px ≠ 总高 {scroll_h}px——垫片没按行数算")
            elif visible != declared:
                problems.append(f"无垫片时可见行 {visible!r} ≠ 声明 {declared}——清单没铺全，或行数算错")
            if problems:
                for problem in problems:
                    print(f"BAD|{label}：被丢清单——{problem}")
            else:
                print(f"OK|{label}：被丢清单是真列表（声明 {declared} 行，总高 {scroll_h}px ≈ {declared} × {row_h}px）")

    # 会话行是 `overflow: hidden` 的固定盒：字号放大最先在这里裁字。行高本身
    # 随档位走（`round(54 × --font-scale)`），所以判据是**相对当前档位**的。
    for row in data.get("session_rows") or []:
        seen_rows += 1
        height = row.get("height")
        ch, sh = row.get("clientHeight"), row.get("scrollHeight")
        if not all(isinstance(v, (int, float)) for v in (height, ch, sh)):
            print(f"BAD|{label}：会话行几何缺失")
            continue
        if sh > ch + 1:
            print(f"BAD|{label}：会话行裁字（内容 {sh}px > 行盒 {ch}px）——字号放大后行盒没跟上")
        elif font_scale is not None and abs(height - round(54 * font_scale)) > 1:
            print(
                f"BAD|{label}：会话行高与档位不符（实测 {height}px，"
                f"期望 round(54×{font_scale})={round(54 * font_scale)}px）"
            )
        else:
            print(f"OK|{label}：会话行不裁字且行高随档位（{height}px，内容 {sh} ≤ {ch}）")

    prev_label = label

if coverage and seen_gauge == 0:
    print("BAD|视图覆盖：没有任何视图产出表盘几何——用量总览没被覆盖")
if coverage and seen_table == 0:
    print("BAD|视图覆盖：没有任何视图产出记录表几何——日志表没被覆盖")
if coverage and seen_rows == 0:
    print("BAD|视图覆盖：没有任何视图产出会话行几何——会话列表没被覆盖")
if coverage and seen_billing == 0:
    print("BAD|视图覆盖：没有任何视图产出计费窗口几何——限额区没被覆盖")
if coverage and seen_usage_panels == 0:
    print("BAD|视图覆盖：没有任何视图产出三块用量面板的标题——用量页下半屏没被覆盖")
if coverage and seen_census == 0:
    print("BAD|视图覆盖：没有任何视图产出工具普查面板的锚点——「工具与 skill」面板没被覆盖")
if coverage and seen_context == 0:
    print("BAD|视图覆盖：没有任何视图产出上下文曲线几何——上下文标签页没被覆盖")
if coverage and seen_error == 0:
    print("BAD|视图覆盖：没有任何视图产出错误档几何——「错误」分段没被覆盖")
if coverage and seen_changes == 0:
    print("BAD|视图覆盖：没有任何视图产出改动档几何——「改动」标签页没被覆盖")
PY
)" || PROBE_STATUS=$?

if [[ "$PROBE_STATUS" != "0" ]]; then
  bad "几何探针解析脚本异常退出（码 ${PROBE_STATUS}）"
  printf '%s\n' "$PROBE_REPORT" | sed 's/^/    /'
elif [[ -z "$PROBE_REPORT" ]]; then
  bad "几何探针没有任何输出——应用没写探针 JSON，布局不变量无从判定"
else
  while IFS='|' read -r _kind _message; do
    case "$_kind" in
      OK)   [[ -n "$_message" ]] && ok "$_message" ;;
      BAD)  [[ -n "$_message" ]] && bad "$_message" ;;
      NOTE) [[ -n "$_message" ]] && note "$_message" ;;
      *)    [[ -n "$_kind" ]] && note "$_kind" ;;
    esac
  done <<< "$PROBE_REPORT"

  # 任何一项判失败，就把**每一步探针看到的事实**打出来：哪一步没有元素、有没有
  # 记录表、escaped_text 是多少。光说「某条不变量破了」定位不了是「页面还在加载」
  # 还是「点击没生效」——#118 排查时就是缺这份事实。
  if printf '%s\n' "$PROBE_REPORT" | grep -q '^BAD|'; then
    printf '  %s——失败项诊断：每一步探针看到的事实——%s\n' "$C_YELLOW" "$C_RESET"
    while IFS='|' read -r _line; do
      printf '    %s\n' "$_line"
    done <<< "$(python3 - "${PROBE_ENTRIES[@]}" <<'PROBEDIAG'
import json, pathlib, sys

for arg in sys.argv[1:]:
    label, _, path = arg.partition("::")
    probe = pathlib.Path(path)
    if not probe.is_file():
        print(f"{label}：探针文件不存在（{probe.name}）")
        continue
    try:
        data = json.loads(probe.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001 - 诊断，不判定
        print(f"{label}：探针无法解析（{exc}）")
        continue
    names = [el.get("name") for el in (data.get("elements") or [])]
    tables = data.get("tables") or []
    print(
        f"{label}：元素 {names or '无'}｜记录表 {'有' if tables else '无'}"
        f"｜escaped_text {data.get('escaped_text')}"
    )
PROBEDIAG
)"
  fi
fi

# ---------------------------------------------------------------------------
step "退出"
# ---------------------------------------------------------------------------
if [[ "$ALIVE" == "1" ]]; then
  # disown 见 cleanup() 处的说明：为的是不让 bash 播报作业终止。
  disown "$APP_PID" 2>/dev/null || true
  kill "$APP_PID" 2>/dev/null || true
  GONE=0
  for _ in 1 2 3 4 5; do
    sleep 1
    if ! kill -0 "$APP_PID" 2>/dev/null; then GONE=1; break; fi
  done
  if [[ "$GONE" == "1" ]]; then
    ok "收到 SIGTERM 后正常退出"
  else
    bad "SIGTERM 后 5 秒仍未退出"
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  APP_PID=""
fi

# ---------------------------------------------------------------------------
printf '\n%s──────────────────────────────────────────────%s\n' "$C_BOLD" "$C_RESET"
printf '通过 %s%d%s · 失败 %s%d%s · 跳过 %s%d%s\n' \
  "$C_GREEN" "$PASSED" "$C_RESET" \
  "$C_RED" "$FAILED" "$C_RESET" \
  "$C_YELLOW" "$SKIPPED" "$C_RESET"

if [[ ${#SKIPPED_NAMES[@]} -gt 0 ]]; then
  printf '\n%s以下检查被跳过（不算通过）：%s\n' "$C_YELLOW" "$C_RESET"
  for _n in "${SKIPPED_NAMES[@]}"; do
    printf '  • %s\n' "$_n"
  done
fi

if [[ "$FAILED" -gt 0 ]]; then
  printf '\n%s以下检查未通过：%s\n' "$C_RED" "$C_RESET"
  for _n in "${FAILED_NAMES[@]}"; do
    printf '  • %s\n' "$_n"
  done
  exit 1
fi

printf '\n%s✓ 真机 GUI 冒烟测试通过。%s\n' "$C_GREEN" "$C_RESET"
