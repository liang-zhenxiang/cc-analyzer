#!/usr/bin/env bash
#
# check-gtk-unblock.sh —— 检查上游是否已解除 glib 告警（GHSA-wrw7-89jp-8q8g）的阻塞
#
# 背景：Issue #106 跟踪 glib 0.18.5 的安全告警，受影响范围是
# >=0.15.0,<0.20.0。当前 tauri / muda / tao 都要求 gtk ^0.18，而 gtk 0.18
# 依赖 glib 0.18，所以在依赖树上无法离开受影响范围。解除条件是上游任一
# crate 改用 gtk ^0.19 或更高（gtk 0.19 依赖 glib ^0.22）。
#
# 本脚本读取 crates.io 上三个 crate **最新稳定版**的 gtk 要求，判断阻塞是否
# 已经解除，并在状态变化时到 Issue #106 留言。
#
# 三种模式：
#   （默认）        查询 crates.io，打印三行小表与结论；不写任何东西
#   --dry-run      只把「将要发布的评论正文」打印到 stdout，不调用 gh
#   --comment      仅当 Issue 的现有评论里**没有相同状态标记**时留言
#
# **为什么不每周都留言**：状态每周都查，但大多数周结论不变。若每周都发一条
# 内容相同的评论，Issue 时间线会被无信息量的重复内容淹没，真正重要的「状态
# 变了」那条反而被埋掉。所以留言用下面的机器标记去重：只有 verdict 或任一
# gtk 要求变化时标记才会变，也才会新增一条评论。
#
# 标记格式（HTML 注释，渲染后的 Issue 里不可见）：
#   <!-- gtk-unblock-watch:verdict=<blocked|partial|unblocked>;tauri=<req>;muda=<req>;tao=<req> -->
# 不依赖 gtk 的 crate 记为 none（例如 muda=none）。
#
# 用法：
#   ./scripts/check-gtk-unblock.sh [--fixture FILE] [--dry-run] [--comment]
#
#   --fixture FILE  用本地 JSON 夹具代替网络，格式：
#                   {"tauri":{"version":"2.12.5","gtk":"^0.18"}, ...}
#                   gtk 为 null 表示该 crate 不再依赖 gtk。
#   --dry-run       打印评论正文，不调用 gh。
#                   与 --comment 同时给出时 dry-run 优先（永远不会调用 gh）。
#   --comment       状态变化时在 Issue 留言；需要 GH_TOKEN。
#
# 环境变量：
#   REPO          默认 ${GITHUB_REPOSITORY:-liang-zhenxiang/cc-analyzer}
#   ISSUE_NUMBER  默认 106
#   GH_TOKEN      --comment 模式必需（GitHub Actions 里用 secrets.GITHUB_TOKEN）
#
# 退出码：评估成功一律 0（无论 blocked / partial / unblocked）；
#         网络或解析失败 1；参数/环境错误 2。
#
# 兼容 macOS 自带 bash 3.2：不使用 declare -A、mapfile、wait -n、tac。

set -euo pipefail

REPO="${GITHUB_REPOSITORY:-liang-zhenxiang/cc-analyzer}"
ISSUE_NUMBER="${ISSUE_NUMBER:-106}"
readonly CRATES_USER_AGENT="cc-analyzer-maintainer"

FIXTURE=""
DRY_RUN=0
COMMENT=0

usage() {
  cat <<'USAGE'
用法：
  ./scripts/check-gtk-unblock.sh                 # 真实查询 crates.io 并打印报告
  ./scripts/check-gtk-unblock.sh --dry-run       # 只打印评论正文，不调用 gh
  ./scripts/check-gtk-unblock.sh --comment       # 状态变化时在 Issue #106 留言
  ./scripts/check-gtk-unblock.sh --fixture FILE  # 用本地 JSON 夹具代替网络

选项：
  --fixture FILE  夹具格式：
                  {"tauri":{"version":"2.12.5","gtk":"^0.18"}, ...}
                  gtk 为 null 表示该 crate 不再依赖 gtk。
  --dry-run       打印将要发布的评论正文到 stdout，不调用 gh。
  --comment       仅当现有评论中没有相同状态标记时留言；需要 GH_TOKEN。
  -h, --help      显示本帮助。

环境变量：
  REPO          默认 ${GITHUB_REPOSITORY:-liang-zhenxiang/cc-analyzer}
  ISSUE_NUMBER  默认 106
  GH_TOKEN      --comment 模式必需
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixture)
      if [[ $# -lt 2 ]]; then
        printf 'check-gtk-unblock.sh: --fixture 需要一个文件参数\n' >&2
        exit 2
      fi
      FIXTURE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --comment)
      COMMENT=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'check-gtk-unblock.sh: 未知参数：%s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$ISSUE_NUMBER" in
  ''|*[!0-9]*)
    printf 'check-gtk-unblock.sh: ISSUE_NUMBER 必须是数字（收到：%s）\n' "$ISSUE_NUMBER" >&2
    exit 2
    ;;
esac

if ! command -v python3 >/dev/null 2>&1; then
  printf 'check-gtk-unblock.sh: 需要 python3 来解析 JSON\n' >&2
  exit 2
fi

# --comment 需要能写 Issue。放在评估之前：凭证缺失时先失败，不必白跑网络。
# --dry-run 优先，所以它不需要 GH_TOKEN。
if [[ "$COMMENT" -eq 1 && "$DRY_RUN" -eq 0 && -z "${GH_TOKEN:-}" ]]; then
  printf 'check-gtk-unblock.sh: --comment 需要 GH_TOKEN（GitHub Actions 里是 secrets.GITHUB_TOKEN）\n' >&2
  exit 1
fi

# 读本地夹具，输出三行 TSV：crate、version、gtk 要求（null 记作 none）。
read_fixture() {
  python3 - "$1" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
except (OSError, json.JSONDecodeError) as exc:
    print(f"无法读取或解析夹具 {path}：{exc}", file=sys.stderr)
    sys.exit(1)

expected = ["tauri", "muda", "tao"]
if not isinstance(data, dict):
    print("夹具顶层必须是 JSON 对象", file=sys.stderr)
    sys.exit(1)

unknown = sorted(set(data) - set(expected))
missing = [crate for crate in expected if crate not in data]
if unknown:
    print(f"夹具含未知 crate：{', '.join(unknown)}", file=sys.stderr)
    sys.exit(1)
if missing:
    print(f"夹具缺少 crate：{', '.join(missing)}", file=sys.stderr)
    sys.exit(1)

for crate in expected:
    item = data[crate]
    if not isinstance(item, dict):
        print(f"夹具里的 {crate} 必须是对象", file=sys.stderr)
        sys.exit(1)
    version = item.get("version")
    if not isinstance(version, str) or not version.strip():
        print(f"夹具里的 {crate}.version 必须是非空字符串", file=sys.stderr)
        sys.exit(1)
    gtk = item.get("gtk")
    if gtk is not None and (not isinstance(gtk, str) or not gtk.strip()):
        print(f"夹具里的 {crate}.gtk 必须是非空字符串或 null", file=sys.stderr)
        sys.exit(1)
    print(f"{crate}\t{version.strip()}\t{gtk.strip() if isinstance(gtk, str) else 'none'}")
PY
}

# 请求 crates.io。必须带 User-Agent，否则会被拒绝。
#
# 只有「curl 成功 + 非空 + 能解析为 JSON」才算拿到完整响应。曾两次观察到
# 网络抖动：一次是缓存节点返回 200 + 空 body，一次是连接在 152KB/214KB 处
# 断开（curl 报 28）却仍留下部分 body。若只看「非空」，截断的元数据会被当成
# 成功，最终报出与真实原因隔了好几层的 JSON 解析错误。重试只保留这一层，
# 不再叠加 curl 自己的 --retry，避免内外两层退避相乘。
crates_get() {
  local url="$1"
  local body attempt=1
  while [[ "$attempt" -le 3 ]]; do
    if body="$(curl -fsS --max-time 30 \
      -H "User-Agent: ${CRATES_USER_AGENT}" "$url")" \
      && [[ -n "$body" ]] \
      && printf '%s\n' "$body" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
      printf '%s\n' "$body"
      return 0
    fi
    if [[ "$attempt" -lt 3 ]]; then
      printf 'crates.io 响应不完整或不可解析，2 秒后重试（第 %d 次）：%s\n' "$attempt" "$url" >&2
      sleep 2
    fi
    attempt=$((attempt + 1))
  done
  printf '请求 crates.io 失败（已重试 3 次）：%s\n' "$url" >&2
  return 1
}

# 查询一个 crate 的最新稳定版及其 gtk 要求，输出 TSV：crate<TAB>version<TAB>gtk。
fetch_one() {
  local crate="$1"
  local meta deps version gtk

  if ! meta="$(crates_get "https://crates.io/api/v1/crates/${crate}")"; then
    printf '请求 crates.io（%s 元数据）失败\n' "$crate" >&2
    return 1
  fi

  if ! version="$(printf '%s\n' "$meta" | python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
    version = data["crate"]["max_stable_version"]
except Exception as exc:
    print(f"无法取得 max_stable_version：{exc}", file=sys.stderr)
    sys.exit(1)
if not isinstance(version, str) or not version:
    print("max_stable_version 不是非空字符串", file=sys.stderr)
    sys.exit(1)
print(version)
' 2>&1)"; then
    printf '解析 %s 元数据失败：%s\n' "$crate" "$version" >&2
    return 1
  fi

  # crates.io 的匿名 API 建议每秒不超过一次请求；周任务不差这几秒。
  sleep 1

  if ! deps="$(crates_get "https://crates.io/api/v1/crates/${crate}/${version}/dependencies")"; then
    printf '请求 crates.io（%s 依赖列表）失败\n' "$crate" >&2
    return 1
  fi

  if ! gtk="$(printf '%s\n' "$deps" | python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
    dependencies = data["dependencies"]
except Exception as exc:
    print(f"无法解析依赖列表：{exc}", file=sys.stderr)
    sys.exit(1)
for dep in dependencies:
    if dep.get("crate_id") != "gtk":
        continue
    req = dep.get("req")
    if not isinstance(req, str) or not req:
        print("gtk 依赖缺少 req", file=sys.stderr)
        sys.exit(1)
    print(req)
    sys.exit(0)
print("none")
' 2>&1)"; then
    printf '解析 %s 依赖列表失败：%s\n' "$crate" "$gtk" >&2
    return 1
  fi

  sleep 1
  printf '%s\t%s\t%s\n' "$crate" "$version" "$gtk"
}

TAURI_VERSION=""
TAURI_GTK=""
MUDA_VERSION=""
MUDA_GTK=""
TAO_VERSION=""
TAO_GTK=""

records=""
if [[ -n "$FIXTURE" ]]; then
  if ! records="$(read_fixture "$FIXTURE")"; then
    exit 1
  fi
else
  for crate in tauri muda tao; do
    if ! record="$(fetch_one "$crate")"; then
      exit 1
    fi
    records="${records}${record}"$'\n'
  done
fi

while IFS=$'\t' read -r crate version gtk; do
  [[ -z "$crate" ]] && continue
  case "$crate" in
    tauri)
      TAURI_VERSION="$version"
      TAURI_GTK="$gtk"
      ;;
    muda)
      MUDA_VERSION="$version"
      MUDA_GTK="$gtk"
      ;;
    tao)
      TAO_VERSION="$version"
      TAO_GTK="$gtk"
      ;;
    *)
      printf 'check-gtk-unblock.sh: 内部错误，未知 crate：%s\n' "$crate" >&2
      exit 1
      ;;
  esac
done <<< "$records"

if [[ -z "$TAURI_VERSION" || -z "$MUDA_VERSION" || -z "$TAO_VERSION" ]]; then
  printf 'check-gtk-unblock.sh: 没有取到全部三个 crate 的版本\n' >&2
  exit 1
fi

# 判定规则（与 Issue #106 的解除条件一致）：
#   gtk 要求包含 0.18 → 仍阻塞；null（不再依赖 gtk）→ 不阻塞。
#   三个都阻塞 → blocked；三个都不阻塞 → unblocked；其余 → partial。
blocking=0
for req in "$TAURI_GTK" "$MUDA_GTK" "$TAO_GTK"; do
  case "$req" in
    *0.18*) blocking=$((blocking + 1)) ;;
  esac
done

if [[ "$blocking" -eq 3 ]]; then
  VERDICT="blocked"
elif [[ "$blocking" -eq 0 ]]; then
  VERDICT="unblocked"
else
  VERDICT="partial"
fi

MARKER="<!-- gtk-unblock-watch:verdict=${VERDICT};tauri=${TAURI_GTK};muda=${MUDA_GTK};tao=${TAO_GTK} -->"

print_next_steps() {
  printf '  cargo tree --manifest-path src-tauri/Cargo.toml -i glib --target aarch64-apple-darwin\n'
  printf '  cargo tree --manifest-path src-tauri/Cargo.toml -i glib --target x86_64-apple-darwin\n'
  printf '  cargo tree --manifest-path src-tauri/Cargo.toml -i glib --target x86_64-pc-windows-msvc\n'
  printf '  （若报 “did not match any packages”，即表示该目标不含 glib。）\n'
}

print_detail() {
  printf '  %-6s %-12s %s\n' 'crate' '最新版本' 'gtk 要求'
  printf '  %-6s %-12s %s\n' 'tauri' "$TAURI_VERSION" "$TAURI_GTK"
  printf '  %-6s %-12s %s\n' 'muda' "$MUDA_VERSION" "$MUDA_GTK"
  printf '  %-6s %-12s %s\n' 'tao' "$TAO_VERSION" "$TAO_GTK"
  printf '\n'

  case "$VERDICT" in
    blocked)
      printf '结论：blocked —— tauri / muda / tao 仍要求 gtk 0.18，glib 告警（#106）的阻塞尚未解除。\n'
      printf '\n当前仍无用户影响：发布产物只有 macOS / Windows，而 glib 是 Linux 侧依赖。\n'
      printf '但不要 dismiss 这条告警——Linux 构建与依赖跟踪仍需要它。\n'
      ;;
    partial)
      printf '结论：partial —— 已有上游 crate 不再要求受影响的 gtk，但仍有阻塞项。\n'
      printf '\n下一步：先复核分发目标上 glib 是否仍在依赖树里，再评估升级。\n'
      print_next_steps
      ;;
    unblocked)
      printf '结论：unblocked —— tauri / muda / tao 都不再要求受影响的 gtk，可以评估解除 glib 告警。\n'
      printf '\n下一步：先复核分发目标上 glib 是否仍在依赖树里，再评估升级。\n'
      print_next_steps
      ;;
  esac
}

build_report() {
  printf '上游 gtk 要求检查（crates.io 最新稳定版）\n\n'
  print_detail
  printf '\n%s\n' "$MARKER"
}

build_comment() {
  printf '### 上游 gtk 要求检查\n\n'
  print_detail
  printf '\n%s\n' "$MARKER"
}

if [[ "$DRY_RUN" -eq 1 ]]; then
  build_comment
  exit 0
fi

build_report

if [[ "$COMMENT" -eq 1 ]]; then
  if ! existing="$(gh issue view "$ISSUE_NUMBER" --repo "$REPO" --json comments --jq '.comments[].body' 2>&1)"; then
    printf '读取 Issue #%s 的评论失败：%s\n' "$ISSUE_NUMBER" "$existing" >&2
    exit 1
  fi

  if printf '%s\n' "$existing" | grep -Fq -- "$MARKER"; then
    printf 'Issue #%s 已有相同状态的留言，跳过（避免重复刷屏）。\n' "$ISSUE_NUMBER"
  else
    body="$(build_comment)"
    if ! posted="$(printf '%s\n' "$body" | gh issue comment "$ISSUE_NUMBER" --repo "$REPO" --body-file - 2>&1)"; then
      printf '在 Issue #%s 发布留言失败：%s\n' "$ISSUE_NUMBER" "$posted" >&2
      exit 1
    fi
    printf '已在 Issue #%s 发布状态变化留言：%s\n' "$ISSUE_NUMBER" "$VERDICT"
  fi
fi

exit 0
