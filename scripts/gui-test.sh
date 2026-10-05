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
# 默认的视图清单是「会话分析 → 打开首个会话 → 日志视图 → 终端转义夹具会话 →
# 日志视图 → 导出 → 关闭导出窗口 → 用量总览 → 实时监控」；每张图
# 都配一份几何探针 JSON（`CCA_GUI_PROBE`），脚本据它判定**布局不变量**：无横向溢出、表盘
# 有界且含于卡片、记录表末列可达。目标既可写可访问名/可见文本（标签页），也可写会话 cwd
# （会匹配按钮的 `title`）。**前两步显式切回「会话分析」与「日志视图」**——应用会把当前
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

默认视图清单：会话分析 → 打开首个会话 → 日志视图 → 终端转义夹具会话 →
日志视图 → 导出 → 关闭导出窗口 → 用量总览 → 实时监控。每张图都配一份
几何探针 JSON，脚本据它判定布局不变量（无横向溢出 / 表盘有界且含于卡片 / 记录表末列可达 / 文字里无 ESC 转义字节）。

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
FIXTURE_OFFSET="$(cat "${FIXTURE_SRC}"/session-basic.jsonl \
  "${FIXTURE_SRC}"/session-subagent.jsonl \
  "${FIXTURE_SRC}"/usage-dashboard-days.jsonl \
  "${FIXTURE_SRC}"/usage-dashboard-models.jsonl \
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
printf '  夹具会话：5 个（另有 1 个只剩归档副本的会话）\n'

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
  CAPTURE_TARGETS=("会话分析" "/repo/demo" "日志视图" "/repo/ansi" "日志视图" "导出" "关闭导出窗口" "用量总览" "实时监控")
fi

# 逐项计算输出文件名：默认视图 `app-capture.pdf`；单个目标沿用旧名 `app-capture-tab.pdf`；
# 多个目标各用 `app-capture-<slug>.pdf`。探针 JSON 同规则、后缀换 .json。
# 这套规则与 src-tauri/src/lib.rs 的 tab_output_path / probe_output_path 一一对应。
declare -a CAPTURE_LABELS=("默认视图")
declare -a CAPTURE_PDFS=("$CAPTURE_PDF")
declare -a CAPTURE_SHOTS=("${ARTIFACT_DIR}/app-window.png")
declare -a CAPTURE_PROBES=("$CAPTURE_PROBE")
for _target in "${CAPTURE_TARGETS[@]}"; do
  [[ -n "$_target" ]] || continue
  if [[ ${#CAPTURE_TARGETS[@]} -eq 1 ]]; then
    _suffix="-tab"
  else
    _suffix="-$(slug_of "$_target")"
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

  if [[ "${COUNT:-}" == "6" ]]; then
    ok "缓存条目数 = 6（5 个夹具 + 1 个归档副本）"
  else
    bad "缓存条目数 = ${COUNT:-解析失败}，期望 6"
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
coverage = os.environ.get("COVERAGE") == "1"
seen_gauge = 0
seen_table = 0

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
    viewport = data.get("viewport") or {}
    for el in data.get("elements") or []:
        if el.get("name") != "export-dialog":
            continue
        export_seen += 1
        rect = el.get("rect") or {}
        width, height = rect.get("width"), rect.get("height")
        if not isinstance(width, (int, float)) or not isinstance(height, (int, float)):
            print(f"BAD|{label}：导出浮层矩形缺失")
            continue
        inside = (
            isinstance(viewport.get("width"), (int, float))
            and isinstance(viewport.get("height"), (int, float))
            and rect.get("x", 0) >= -1
            and rect.get("y", 0) >= -1
            and rect.get("x", 0) + width <= viewport["width"] + 1
            and rect.get("y", 0) + height <= viewport["height"] + 1
        )
        if width <= EXPORT_DIALOG_MAX_WIDTH + 1 and inside:
            print(f"OK|{label}：导出浮层有界且完整在窗口内（{width:.0f}×{height:.0f}px ≤ {EXPORT_DIALOG_MAX_WIDTH}px）")
        else:
            print(f"BAD|{label}：导出浮层失界（宽 {width:.0f}px，上限 {EXPORT_DIALOG_MAX_WIDTH}px，在窗口内={inside}）")

    # 目标就是「导出」时，浮层出现是这一步的全部意义——没出现比尺寸错了更严重。
    if label == EXPORT_DIALOG_LABEL and export_seen == 0:
        print(f"BAD|{label}：探针里没有导出浮层——点击没有打开它，或面板整个没渲染出来")
    # 浮层是 `position: fixed`，而 `WKWebView.createPDF` **不会把它画进 PDF**：
    # 实测「导出」这一步的 PDF 只比前一张多 117 字节（480×424 的浮层若入图不可能
    # 只差这么点），设置面板同样不入图。所以这张截图的证据价值是「它背后的视图」，
    # 浮层本身由上面的几何不变量与端到端断言负责——别对着截图找浮层。
    if export_seen > 0:
        print(f"NOTE|{label}：浮层是 position: fixed，createPDF 不渲染它——这张截图看的是背后的视图，浮层证据是上面的几何不变量")

if coverage and seen_gauge == 0:
    print("BAD|视图覆盖：没有任何视图产出表盘几何——用量总览没被覆盖")
    # 光说「没覆盖」不够定位：把每份探针里到底看到了什么打出来（哪一步没有元素、
    # 有没有记录表），下次不必靠猜是「页面还在加载」还是「点击没生效」。
    for arg in sys.argv[1:]:
        label, _, path = arg.partition("::")
        probe = pathlib.Path(path)
        if not probe.is_file():
            print(f"NOTE|  诊断：{label} 的探针文件不存在（{probe.name}）")
            continue
        try:
            data = json.loads(probe.read_text(encoding="utf-8"))
        except Exception:
            print(f"NOTE|  诊断：{label} 的探针无法解析")
            continue
        names = [el.get("name") for el in (data.get("elements") or [])]
        print(
            f"NOTE|  诊断：{label} → 元素 {names or '无'}"
            f"，记录表 {(data.get('tables') or []) and '有' or '无'}"
            f"，escaped_text={data.get('escaped_text')}"
        )
if coverage and seen_table == 0:
    print("BAD|视图覆盖：没有任何视图产出记录表几何——日志表没被覆盖")
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
