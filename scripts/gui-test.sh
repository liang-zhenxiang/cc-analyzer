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
#                                        # 追加第二张取图：应用点击该可访问名的
#                                        # 标签页、等一轮渲染后再截一张，走与第一张
#                                        # 完全相同的转 PNG + 非空白判定
#
# 退出码：0 没有失败项／1 有检查项失败（取不到图计失败，不是跳过）

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
                                       # 额外截一张「点击该可访问名标签页后」的图
  -h, --help                           # 显示帮助

前提：产物必须带 `gui-capture` feature，否则取图那步必然失败。发布产物**不带**
它，所以 `npm run build:macos:*` 产出的常规产物不能直接拿来跑——请用 --build。

隔离：HOME 指向临时目录，应用只看得见我们放进去的夹具，不会读使用者的真实会话。

退出码：0 没有失败项；1 有检查项失败（取不到图计失败，不是跳过）。

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
# 第二张取图（CCA_GUI_CAPTURE_TAB）的落点：应用侧的规则是「第一张去 .pdf
# 后缀加 -tab.pdf」，两边必须一致——路径对不上时脚本会一直等不到文件。
readonly CAPTURE_TAB_PDF="${WORK_DIR}/app-capture-tab.pdf"
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
# 只陈述事实、不参与判定的行。用它而不是 ok 或 skip：ok 会把「其实什么都没
# 证明」说成「检查通过」，skip 会让人以为这项本该检查、只是这次没跑成。
note() { printf '  %s·%s %s\n' "$C_BLUE" "$C_RESET" "$1"; }
skip() { printf '  %s⚠ 跳过：%s%s\n' "$C_YELLOW" "$1" "$C_RESET"; SKIPPED=$((SKIPPED + 1)); SKIPPED_NAMES+=("$1"); }
step() { printf '\n%s▶ %s%s\n' "$C_BOLD" "$1" "$C_RESET"; }

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
printf '  隔离家目录：%s\n' "$HOME_DIR"
printf '  夹具会话：4 个\n'

CACHE_PATH="${HOME_DIR}/Library/Application Support/${BUNDLE_ID}/meta-cache-v2.json"

# ---------------------------------------------------------------------------
step "启动应用"
# ---------------------------------------------------------------------------
# 直接跑 bundle 里的可执行文件而不是 `open`：`open` 走 LaunchServices，
# 不会把自定义的 HOME 传进去，隔离就失效了。
# CCA_GUI_CAPTURE 让应用在渲染完成后把自己的 webview 渲染成 PDF（见 lib.rs 的
# gui_capture 模块）。这是**唯一**一条不需要「屏幕录制」权限的真机取图途径。
# CCA_GUI_CAPTURE_TAB（可选）再让应用点开该可访问名的标签页、截第二张——
# 默认不设，行为与从前完全一致。
GUI_TAB="${CCA_GUI_CAPTURE_TAB:-}"
if [[ -n "$GUI_TAB" ]]; then
  HOME="$HOME_DIR" CCA_GUI_CAPTURE="$CAPTURE_PDF" CCA_GUI_CAPTURE_TAB="$GUI_TAB" \
    "$BIN" >"$APP_LOG" 2>&1 &
else
  HOME="$HOME_DIR" CCA_GUI_CAPTURE="$CAPTURE_PDF" "$BIN" >"$APP_LOG" 2>&1 &
fi
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
print(f"COUNT {len(paths)}")
print(f"OUTSIDE {len(outside)}")
PY
)"
  COUNT="$(printf '%s\n' "$CACHE_REPORT" | grep '^COUNT ' | awk '{print $2}')"
  OUTSIDE="$(printf '%s\n' "$CACHE_REPORT" | grep '^OUTSIDE ' | awk '{print $2}')"

  if [[ "${COUNT:-}" == "4" ]]; then
    ok "缓存条目数 = 4，与夹具一致"
  else
    bad "缓存条目数 = ${COUNT:-解析失败}，期望 4"
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
  check_capture_pdf "$CAPTURE_PDF" "$SHOT" ""
fi

# ---------------------------------------------------------------------------
# 第二张取图（可选）：应用侧在第一张落盘后会点击 CCA_GUI_CAPTURE_TAB 指定的
# 标签页、等一轮渲染再写第二张 PDF。判定与第一张走同一个函数；取不到图
# 同样计失败而不是跳过。未设 TAB 时这一步整个不存在，输出与从前完全一致。
# ---------------------------------------------------------------------------
if [[ -n "$GUI_TAB" ]]; then
  step "截图：切换到「${GUI_TAB}」标签页后"

  SHOT_TAB="${ARTIFACT_DIR}/app-window-tab.png"
  rm -f "$SHOT_TAB"

  CAPTURED_TAB=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    [[ -f "$CAPTURE_TAB_PDF" ]] && { CAPTURED_TAB=1; break; }
    sleep 1
  done

  if [[ "$CAPTURED_TAB" != "1" ]]; then
    bad "「${GUI_TAB}」标签页：应用没有产出第二张取图 PDF——gui_capture 的 tab 流程没跑通"
    sed -n '1,30p' "$APP_LOG" | sed 's/^/    /'
  else
    ok "「${GUI_TAB}」标签页已渲染：$(wc -c < "$CAPTURE_TAB_PDF" | tr -d ' ') 字节"
    check_capture_pdf "$CAPTURE_TAB_PDF" "$SHOT_TAB" "「${GUI_TAB}」标签页"
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
