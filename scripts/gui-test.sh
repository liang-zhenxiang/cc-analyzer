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
#   3. webview 真的初始化了（常驻内存达到量级阈值）
#
# 截图是**尽力而为**的：macOS 上截取窗口需要「屏幕录制」权限（TCC），
# 那是只能由使用者在「系统设置 → 隐私与安全性 → 屏幕录制」里手动授予的，
# 无法由脚本申请。拿不到权限时本脚本会明确报「跳过截图」并说明怎么开，
# 而不是假装通过——界面视觉验证请用 `npm --prefix web run test:e2e` 的截图。
#
# **隔离**：通过把 HOME 指向临时目录，应用只会看到我们放进去的夹具，
# 不会去读使用者真实的 ~/.claude 会话数据。这是有意的——会话内容属于敏感数据。
#
# 用法：
#   ./scripts/gui-test.sh                # 用已有产物跑
#   ./scripts/gui-test.sh --build        # 先构建再跑
#   ./scripts/gui-test.sh --app <path>   # 指定 .app
#
# 退出码：0 通过（截图跳过不算失败）／1 有检查项失败

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

BUILD=0
APP_PATH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) BUILD=1; shift ;;
    --app) APP_PATH="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
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
readonly APP_LOG="${WORK_DIR}/app.log"

APP_PID=""
PASSED=0
FAILED=0
SKIPPED=0
declare -a FAILED_NAMES=()
declare -a SKIPPED_NAMES=()

cleanup() {
  if [[ -n "$APP_PID" ]] && kill -0 "$APP_PID" 2>/dev/null; then
    # 先 disown 再 kill：否则 bash 会在回收这个后台作业时往 stderr 打一行
    # "Terminated: 15 <完整命令行>"。那不是失败，但混在测试输出里极像失败。
    disown "$APP_PID" 2>/dev/null || true
    kill "$APP_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$APP_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; PASSED=$((PASSED + 1)); }
bad()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1"; FAILED=$((FAILED + 1)); FAILED_NAMES+=("$1"); }
skip() { printf '  %s⚠ 跳过：%s%s\n' "$C_YELLOW" "$1" "$C_RESET"; SKIPPED=$((SKIPPED + 1)); SKIPPED_NAMES+=("$1"); }
step() { printf '\n%s▶ %s%s\n' "$C_BOLD" "$1" "$C_RESET"; }

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
  case "$(uname -m)" in
    arm64) TAURI_BUILD_FEATURES=gui-capture npm run --silent build:macos:arm64 ;;
    *)     TAURI_BUILD_FEATURES=gui-capture npm run --silent build:macos:intel ;;
  esac
fi

if [[ ! -d "$APP_PATH" ]]; then
  printf '  %s✗ 找不到应用产物：%s%s\n' "$C_RED" "$APP_PATH" "$C_RESET"
  printf '  %s  先运行 npm run build:macos:arm64，或加 --build%s\n' "$C_YELLOW" "$C_RESET"
  exit 1
fi

BIN="${APP_PATH}/Contents/MacOS/cc-analyzer"
if [[ ! -x "$BIN" ]]; then
  printf '  %s✗ 产物里没有可执行文件：%s%s\n' "$C_RED" "$BIN" "$C_RESET"
  exit 1
fi
printf '  应用：%s\n' "$APP_PATH"

# 夹具：把单测用的 JSONL 放进隔离家目录的 Claude Code 布局里
FIXTURE_SRC="${PROJECT_ROOT}/web/tests/fixtures"
readonly SESSION_UUID="3d2a5442-9c65-4b28-9c30-bb3d1a1b1a11"
PROJECT_DIR="${HOME_DIR}/.claude/projects/-repo-demo"
mkdir -p "$PROJECT_DIR"
cp "${FIXTURE_SRC}/session-basic.jsonl" "${PROJECT_DIR}/${SESSION_UUID}.jsonl"
cp "${FIXTURE_SRC}/session-subagent.jsonl" "${PROJECT_DIR}/3d2a5442-9c65-4b28-9c30-bb3d1a1b2a22.jsonl"
printf '  隔离家目录：%s\n' "$HOME_DIR"
printf '  夹具会话：2 个\n'

CACHE_PATH="${HOME_DIR}/Library/Application Support/${BUNDLE_ID}/meta-cache-v2.json"

# ---------------------------------------------------------------------------
step "启动应用"
# ---------------------------------------------------------------------------
# 直接跑 bundle 里的可执行文件而不是 `open`：`open` 走 LaunchServices，
# 不会把自定义的 HOME 传进去，隔离就失效了。
# CCA_GUI_CAPTURE 让应用在渲染完成后把自己的 webview 渲染成 PDF（见 lib.rs 的
# gui_capture 模块）。这是**唯一**一条不需要「屏幕录制」权限的真机取图途径。
HOME="$HOME_DIR" CCA_GUI_CAPTURE="$CAPTURE_PDF" "$BIN" >"$APP_LOG" 2>&1 &
APP_PID=$!
printf '  PID %s\n' "$APP_PID"

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
step "断言：webview 真的初始化了（常驻内存量级）"
# ---------------------------------------------------------------------------
if [[ "$ALIVE" == "1" ]]; then
  RSS_KB="$(ps -o rss= -p "$APP_PID" 2>/dev/null | tr -d ' ')"
  # 空壳进程只有几 MB；WKWebView + React 起来后是几十上百 MB。
  # 阈值取 20MB：够宽松到不会误报，又足以把「webview 根本没加载」挡在外面。
  if [[ -n "$RSS_KB" && "$RSS_KB" -gt 20480 ]]; then
    ok "常驻内存 $((RSS_KB / 1024)) MB —— webview 已加载"
  else
    bad "常驻内存仅 ${RSS_KB:-未知} KB，webview 可能没有加载"
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
print(f"COUNT {len(paths)}")
print(f"OUTSIDE {len(outside)}")
PY
)"
  COUNT="$(printf '%s\n' "$CACHE_REPORT" | grep '^COUNT ' | awk '{print $2}')"
  OUTSIDE="$(printf '%s\n' "$CACHE_REPORT" | grep '^OUTSIDE ' | awk '{print $2}')"

  if [[ "${COUNT:-}" == "2" ]]; then
    ok "缓存条目数 = 2，与夹具一致"
  else
    bad "缓存条目数 = ${COUNT:-解析失败}，期望 2"
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
step "截图：应用真实窗口"
# ---------------------------------------------------------------------------
# 应用在渲染完成后会把**自己的 webview** 渲染成 PDF（`gui_capture` 模块）。
# 这条路走的是 WebKit 自身的渲染，**不经过截屏通道**，所以不需要「屏幕录制」权限。
#
# 早先这里用的是 `screencapture`，它必然失败——实测过，连「进程截自己的窗口」
# 都只能拿到一张尺寸正确但像素全透明的图。详见 .trellis/spec/testing/gui-tests.md。
mkdir -p "$ARTIFACT_DIR"
SHOT="${ARTIFACT_DIR}/app-window.png"
rm -f "$SHOT"

CAPTURED=0
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  [[ -f "$CAPTURE_PDF" ]] && { CAPTURED=1; break; }
  sleep 1
done

if [[ "$CAPTURED" != "1" ]]; then
  bad "应用没有产出取图 PDF——gui_capture 没跑起来（是不是构建时漏了 gui-capture feature？）"
  sed -n '1,20p' "$APP_LOG" | sed 's/^/    /'
else
  ok "应用已渲染自身窗口：$(wc -c < "$CAPTURE_PDF" | tr -d ' ') 字节"

  if out="$(sips -s format png --out "$SHOT" "$CAPTURE_PDF" 2>&1)"; then
    ok "已转换为 PNG：gui-artifacts/app-window.png"
  else
    bad "PDF 转 PNG 失败（${out}）"
  fi

  # **空白检测**：这是本项检查里最重要的一条。
  # 缺屏幕录制权限时 macOS 会给你一张「尺寸正确、内容全空」的图而不报错，
  # 光看「文件生成了吗」会被骗过去（挑图时实测过：那张图的像素全是 rgba(0,0,0,0)）。
  #
  # 判据用**不同颜色数**而不是方差：真实界面有几百种颜色，纯色图只有 1 种。
  # 方差曾经用过，但它对「大片同色背景 + 少量文字」的界面不敏感——
  # 一个完全正常的浅色界面算出来只有 167，而阈值定高了就会误报。
  if [[ -f "$SHOT" ]]; then
    VARIANCE="$(python3 - "$SHOT" <<'PY' 2>/dev/null || echo "ERR"
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
    DISTINCT="${VARIANCE%% *}"
    VARVAL="${VARIANCE##* }"
    case "$VARIANCE" in
      ERR|UNSUPPORTED|"")
        skip "无法解析截图做空白检测（结果 = ${VARIANCE:-空}）" ;;
      *)
        # 真实界面抽样出几百种颜色；空白图只有 1 种。
        # 阈值取 20：足够把「纯色」和「有内容的界面」分开，又不依赖具体配色。
        if [[ "$DISTINCT" =~ ^[0-9]+$ ]] && [[ "$DISTINCT" -gt 20 ]]; then
          ok "截图非空白（${DISTINCT} 种颜色，方差 ${VARVAL}）—— 拿到的确实是渲染后的界面"
        else
          bad "截图疑似空白（仅 ${DISTINCT} 种颜色）—— 文件生成了但内容为空"
        fi ;;
    esac
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
